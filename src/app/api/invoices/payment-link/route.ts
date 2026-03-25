import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";
import { getStripe } from "@/lib/stripe";

/**
 * POST — Create a Stripe Payment Link for an invoice.
 * The link can be embedded in the invoice email so homeowners can pay online.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const body = await req.json();
  const { invoice_id } = body;

  if (!invoice_id) {
    return NextResponse.json({ error: "invoice_id required" }, { status: 400 });
  }

  // Get the invoice
  const { data: invoice, error: invErr } = await supabaseAdmin
    .from("invoices")
    .select("*")
    .eq("id", invoice_id)
    .single();

  if (invErr || !invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const authorized = await canAccessClaim(userId, invoice.claim_id);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  if (invoice.amount_due <= 0) {
    return NextResponse.json({ error: "No amount due" }, { status: 400 });
  }

  try {
    const stripe = getStripe();

    // Get claim address for the description
    const { data: claim } = await supabaseAdmin
      .from("claims")
      .select("address")
      .eq("id", invoice.claim_id)
      .single();

    const address = claim?.address || "Property";

    // Create a Stripe Payment Link via a Price (one-time)
    const price = await stripe.prices.create({
      unit_amount: Math.round(invoice.amount_due * 100), // cents
      currency: "usd",
      product_data: {
        name: `Invoice ${invoice.invoice_number} — ${address}`,
      },
    });

    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: {
        invoice_id: invoice.id,
        claim_id: invoice.claim_id,
        invoice_number: invoice.invoice_number,
      },
      after_completion: {
        type: "redirect",
        redirect: {
          url: `${process.env.NEXT_PUBLIC_APP_URL || "https://www.dumbroof.ai"}/dashboard/claim/${invoice.claim_id}?paid=true`,
        },
      },
    });

    // Save payment link to invoice
    await supabaseAdmin
      .from("invoices")
      .update({ payment_link: paymentLink.url })
      .eq("id", invoice_id);

    return NextResponse.json({
      ok: true,
      payment_link: paymentLink.url,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create payment link";
    console.error("Stripe payment link error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
