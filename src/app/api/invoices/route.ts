import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

/** GET — fetch invoices for a claim */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const { searchParams } = new URL(req.url);
  const claimId = searchParams.get("claim_id");

  if (!claimId) {
    return NextResponse.json({ error: "claim_id required" }, { status: 400 });
  }

  const authorized = await canAccessClaim(userId, claimId);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from("invoices")
    .select("*")
    .eq("claim_id", claimId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ invoices: data || [] });
}

/** POST — create a new invoice, auto-populated from line items */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const body = await req.json();
  const { claim_id, invoice_type, recipient_name, recipient_email, notes, due_date } = body;

  if (!claim_id) {
    return NextResponse.json({ error: "claim_id required" }, { status: 400 });
  }

  const authorized = await canAccessClaim(userId, claim_id);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Get claim financial data
  const { data: claimRows } = await supabaseAdmin
    .from("claims")
    .select("contractor_rcv, original_carrier_rcv, current_carrier_rcv, settlement_amount, o_and_p_enabled, tax_rate, excluded_line_items, address, slug")
    .eq("id", claim_id)
    .limit(1);

  const claim = claimRows?.[0] || null;
  if (!claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  // Get line items
  const excludedIds = new Set<string>((claim.excluded_line_items as string[]) || []);
  const { data: lineItems } = await supabaseAdmin
    .from("line_items")
    .select("id, description, qty, unit, unit_price")
    .eq("claim_id", claim_id)
    .in("source", ["usarm", "user_added"]);

  const items = (lineItems || [])
    .filter((li) => !excludedIds.has(li.id))
    .map((li) => ({
      description: li.description,
      qty: li.qty,
      unit: li.unit,
      unit_price: li.unit_price,
      total: Math.round(li.qty * li.unit_price * 100) / 100,
    }));

  // Calculate financials
  const subtotal = items.reduce((sum, i) => sum + i.total, 0);
  const taxRate = claim.tax_rate ?? 0.08;
  const tax = Math.round(subtotal * taxRate * 100) / 100;
  const oAndP = claim.o_and_p_enabled ? Math.round(subtotal * 0.21 * 100) / 100 : 0;
  const total = Math.round((subtotal + tax + oAndP) * 100) / 100;

  // Determine amount due based on invoice type
  const type = invoice_type || "carrier_supplement";
  let deductible = 0;
  let amountDue = total;

  if (type === "homeowner_deductible") {
    // Just the deductible amount
    amountDue = claim.settlement_amount ? 0 : total; // placeholder
  } else if (type === "homeowner_balance") {
    const carrierPaid = claim.current_carrier_rcv ?? claim.original_carrier_rcv ?? 0;
    deductible = 0;
    amountDue = Math.max(0, total - carrierPaid);
  }

  // Generate invoice number
  const slug = claim.slug || claim.address?.replace(/\s+/g, "-").toLowerCase().slice(0, 20) || "claim";
  const { count } = await supabaseAdmin
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("claim_id", claim_id);
  const invoiceNumber = `INV-${slug.toUpperCase()}-${(count || 0) + 1}`;

  const defaultDueDate = due_date || new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

  const { data, error } = await supabaseAdmin
    .from("invoices")
    .insert({
      claim_id,
      user_id: userId,
      invoice_number: invoiceNumber,
      invoice_type: type,
      recipient_name: recipient_name || null,
      recipient_email: recipient_email || null,
      line_items: items,
      subtotal,
      tax,
      o_and_p: oAndP,
      total,
      deductible_applied: deductible,
      amount_due: Math.round(amountDue * 100) / 100,
      notes: notes || null,
      due_date: defaultDueDate,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, invoice: data });
}

/** PUT — update invoice (mark as sent/paid, update notes) */
export async function PUT(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const body = await req.json();
  const { id, status, notes, recipient_email, amount_due } = body;

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { data: existingRows } = await supabaseAdmin
    .from("invoices")
    .select("claim_id")
    .eq("id", id)
    .limit(1);

  const existing = existingRows?.[0] || null;
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const authorized = await canAccessClaim(userId, existing.claim_id);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const updates: Record<string, unknown> = {};
  if (status) {
    updates.status = status;
    if (status === "sent") updates.sent_at = new Date().toISOString();
    if (status === "paid") updates.paid_at = new Date().toISOString();
  }
  if (notes !== undefined) updates.notes = notes;
  if (recipient_email !== undefined) updates.recipient_email = recipient_email;
  if (amount_due != null) updates.amount_due = amount_due;

  const { data, error } = await supabaseAdmin
    .from("invoices")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update lifecycle phase + send email if marking as sent
  if (status === "sent" && recipient_email && data) {
    await supabaseAdmin
      .from("claims")
      .update({ lifecycle_phase: "invoiced" })
      .eq("id", existing.claim_id);

    // Get claim address for email
    const { data: claimRows } = await supabaseAdmin
      .from("claims")
      .select("address, claim_number, file_path")
      .eq("id", existing.claim_id)
      .limit(1);
    const claimInfo = claimRows?.[0] || { address: "", claim_number: "", file_path: "" };

    // Build invoice email HTML
    const lineItems = (data.line_items as Array<{ description: string; qty: number; unit: string; unit_price: number; total: number }>) || [];
    const itemRows = lineItems.map((li) =>
      `<tr><td style="padding:6px 8px;border:1px solid #ddd;">${li.description}</td><td style="padding:6px 8px;border:1px solid #ddd;text-align:right;">${li.qty} ${li.unit}</td><td style="padding:6px 8px;border:1px solid #ddd;text-align:right;">$${li.unit_price.toFixed(2)}</td><td style="padding:6px 8px;border:1px solid #ddd;text-align:right;">$${li.total.toFixed(2)}</td></tr>`
    ).join("");

    const invoiceHtml = `
      <p>Please find the invoice for storm damage restoration work at <strong>${claimInfo.address}</strong>.</p>
      <p><strong>Invoice #:</strong> ${data.invoice_number}<br/>
      <strong>Due Date:</strong> ${data.due_date || "Upon receipt"}</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0;">
        <thead><tr style="background:#f3f4f6;">
          <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">Description</th>
          <th style="padding:6px 8px;border:1px solid #ddd;text-align:right;">Qty</th>
          <th style="padding:6px 8px;border:1px solid #ddd;text-align:right;">Price</th>
          <th style="padding:6px 8px;border:1px solid #ddd;text-align:right;">Total</th>
        </tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <p><strong>Subtotal:</strong> $${(data.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}<br/>
      ${data.tax > 0 ? `<strong>Tax:</strong> $${data.tax.toLocaleString(undefined, { minimumFractionDigits: 2 })}<br/>` : ""}
      ${data.o_and_p > 0 ? `<strong>O&amp;P:</strong> $${data.o_and_p.toLocaleString(undefined, { minimumFractionDigits: 2 })}<br/>` : ""}
      <strong>Total:</strong> $${(data.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
      <p style="font-size:18px;font-weight:bold;">Amount Due: $${(data.amount_due || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
      ${data.payment_link ? `<p><a href="${data.payment_link}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Pay Online</a></p>` : ""}
      ${data.notes ? `<p><strong>Notes:</strong> ${data.notes}</p>` : ""}
    `;

    const subject = claimInfo.claim_number
      ? `Claim #${claimInfo.claim_number} — Invoice ${data.invoice_number}`
      : `Invoice ${data.invoice_number} — ${claimInfo.address}`;

    // Send via backend email endpoint
    try {
      await fetch(`${BACKEND_URL}/api/supplement-email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim_id: existing.claim_id,
          user_id: userId,
          to_email: recipient_email,
          subject,
          body_html: invoiceHtml,
          email_type: "invoice",
          attachment_paths: data.pdf_path ? [data.pdf_path] : undefined,
        }),
      });
    } catch (emailErr) {
      console.error("Invoice email send failed:", emailErr);
    }
  } else if (status === "sent") {
    await supabaseAdmin
      .from("claims")
      .update({ lifecycle_phase: "invoiced" })
      .eq("id", existing.claim_id);
  } else if (status === "paid") {
    await supabaseAdmin
      .from("claims")
      .update({ lifecycle_phase: "paid" })
      .eq("id", existing.claim_id);
  }

  return NextResponse.json({ ok: true, invoice: data });
}
