import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getCallerCompanyId } from "@/lib/company-scope";
import { getStripe } from "@/lib/stripe";
import { getResend, EMAIL_FROM, EMAIL_REPLY_TO } from "@/lib/resend";
import { generateRetailEstimatePdf } from "@/lib/retail/pdf-generator";
import type { RetailTemplate } from "@/lib/retail/templates-types";

export const dynamic = "force-dynamic";
// Allow up to 45s for the Stripe Connect round-trip + PDF gen + Resend send.
// Single-trip Stripe ops are usually <2s but cold-start + PDF can push it.
export const maxDuration = 45;

interface InvoiceBody {
  /** Optional override of customer_email persisted on the row. */
  to_email?: string;
  /** Optional message that gets dropped above the payment CTA in the email. */
  custom_message?: string;
  /** If false (default), do NOT email — just create the link and return it. */
  send_email?: boolean;
}

const ALLOWED_CONTENT_TYPES = ["application/json"];

function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return Buffer.from(binary, "binary").toString("base64");
}

/**
 * POST /api/retail-estimates/[id]/invoice — create a Stripe Connect
 * payment link for the estimate's total amount and (optionally) email it
 * to the customer with the PDF estimate attached.
 *
 * Strict isolation from the claims pipeline: this route does not import
 * or call anything in processor.py / claim_brain_email / claim PDF gen.
 * It reuses ONLY foundational SDK init (getStripe, getResend) and the
 * retail-specific PDF generator built in Phase 8.
 *
 * Idempotency: if the row already has stripe_invoice_url, return it
 * unchanged. Tom can manually clear via a future "regenerate" tool if
 * the link gets stale.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { id } = await params;

  const companyId = await getCallerCompanyId(auth.user.id);
  if (!companyId) {
    return NextResponse.json({ error: "No company profile" }, { status: 403 });
  }

  let body: InvoiceBody = {};
  if (req.headers.get("content-type") && ALLOWED_CONTENT_TYPES.some((c) => req.headers.get("content-type")!.includes(c))) {
    try {
      body = (await req.json()) as InvoiceBody;
    } catch {
      // empty body is fine — defaults to send_email=false
    }
  }
  const sendEmail = body.send_email !== false; // default true

  // Load estimate (company-scoped)
  const { data: est, error: estErr } = await supabaseAdmin
    .from("retail_estimates")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (estErr) return NextResponse.json({ error: estErr.message }, { status: 500 });
  if (!est) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const totalAmount = Number(est.total_amount || 0);
  if (totalAmount <= 0) {
    return NextResponse.json(
      { error: "Cannot invoice a $0 estimate — set quantities or pricing first" },
      { status: 400 },
    );
  }

  // Load the sender's profile (their personal email/phone) AND the
  // company's Stripe Connect status. Each user has their own
  // company_profiles row; both rows in the same company share the same
  // stripe_connect_account_id once any teammate connects (it's stored
  // per profile but represents the company-level account).
  const { data: profile } = await supabaseAdmin
    .from("company_profiles")
    .select("company_name, phone, email, stripe_connect_account_id, stripe_connect_status")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  // If THIS user hasn't connected their Stripe, fall back to any
  // teammate's connected account in the company. (Connect onboarding
  // is admin-driven; non-admin teammates can still issue invoices
  // through the company account.)
  let connectAccountId = profile?.stripe_connect_account_id || null;
  let connectStatus = profile?.stripe_connect_status || null;
  if (!connectAccountId || connectStatus !== "active") {
    const { data: companyConnect } = await supabaseAdmin
      .from("company_profiles")
      .select("stripe_connect_account_id, stripe_connect_status")
      .eq("company_id", companyId)
      .eq("stripe_connect_status", "active")
      .not("stripe_connect_account_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (companyConnect?.stripe_connect_account_id) {
      connectAccountId = companyConnect.stripe_connect_account_id;
      connectStatus = companyConnect.stripe_connect_status;
    }
  }

  if (!connectAccountId || connectStatus !== "active") {
    return NextResponse.json(
      {
        error:
          "Stripe Connect is not active for this company. Have an admin connect a payout account in Dashboard → Settings → Payouts before sending retail invoices.",
        needs_connect: true,
      },
      { status: 400 },
    );
  }

  const companyName = profile?.company_name || "Your Roofer";
  const customerEmail = body.to_email || est.customer_email || null;
  if (sendEmail && !customerEmail) {
    return NextResponse.json(
      { error: "Customer email required to email the invoice" },
      { status: 400 },
    );
  }

  // ─── Idempotency: reuse existing payment link if already created ────
  let paymentLinkUrl: string | null = est.stripe_invoice_url || null;
  let paymentLinkId: string | null = est.stripe_invoice_id || null;
  let priceId: string | null = null;
  let alreadyCreated = false;

  if (paymentLinkUrl && paymentLinkId) {
    alreadyCreated = true;
  } else {
    const snap = (est.template_snapshot || {}) as RetailTemplate | Record<string, unknown>;
    const productName =
      (snap as RetailTemplate)?._meta?.template_name || "Roof Replacement";

    try {
      const stripe = getStripe();
      const stripeOpts = { stripeAccount: connectAccountId };

      const price = await stripe.prices.create(
        {
          unit_amount: Math.round(totalAmount * 100),
          currency: "usd",
          product_data: {
            name: `${companyName} — ${productName}${est.customer_name ? ` for ${est.customer_name}` : ""}`,
          },
        },
        stripeOpts,
      );
      priceId = price.id;

      const paymentLink = await stripe.paymentLinks.create(
        {
          line_items: [{ price: price.id, quantity: 1 }],
          metadata: {
            retail_estimate_id: id,
            company_id: companyId,
            customer_email: customerEmail || "",
          },
          after_completion: {
            type: "redirect",
            redirect: {
              url: `${process.env.NEXT_PUBLIC_APP_URL || "https://www.dumbroof.ai"}/dashboard/retail-estimate?id=${id}&paid=1`,
            },
          },
        },
        stripeOpts,
      );

      paymentLinkUrl = paymentLink.url;
      paymentLinkId = paymentLink.id;

      // Persist link IMMEDIATELY so a subsequent retry doesn't double-create
      await supabaseAdmin
        .from("retail_estimates")
        .update({
          stripe_invoice_id: paymentLinkId,
          stripe_invoice_url: paymentLinkUrl,
          stripe_invoice_status: "open",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("company_id", companyId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Stripe error";
      return NextResponse.json(
        { error: `Stripe payment link creation failed: ${msg}` },
        { status: 502 },
      );
    }
  }

  // ─── If caller asked to skip the email, return now ──────────────────
  if (!sendEmail) {
    return NextResponse.json({
      ok: true,
      payment_link_url: paymentLinkUrl,
      payment_link_id: paymentLinkId,
      stripe_price_id: priceId,
      already_created: alreadyCreated,
      sent: false,
    });
  }

  // ─── Build PDF + email body, send via Resend ────────────────────────
  const snap = (est.template_snapshot || {}) as RetailTemplate | null;
  const productName = snap?._meta?.template_name || "Roof Replacement";
  const manufacturer = snap?._meta?.manufacturer || "";
  const manufacturerSeries = snap?._meta?.product_line || null;

  // Rebuild measurements + addon line items for the PDF (same logic as
  // /send route — duplicated here to keep this endpoint self-contained).
  const MEASUREMENT_LABELS: Record<string, { label: string; unit: string }> = {
    roof_area_sq: { label: "Roof area", unit: "SQ" },
    eave_lf: { label: "Eave", unit: "LF" },
    rake_lf: { label: "Rake", unit: "LF" },
    ridge_lf: { label: "Ridge", unit: "LF" },
    hip_lf: { label: "Hip", unit: "LF" },
    valley_lf: { label: "Valley", unit: "LF" },
    ridge_lf_vented: { label: "Ridge vented", unit: "LF" },
    pipe_count_standard: { label: "Standard pipes", unit: "EA" },
    step_flash_lf: { label: "Step flashing", unit: "LF" },
    counter_flash_lf: { label: "Counter flashing", unit: "LF" },
  };
  const measurementsSummary: Array<{ label: string; value: number; unit: string }> = [];
  for (const [code, value] of Object.entries((est.measurements || {}) as Record<string, number>)) {
    const v = Number(value || 0);
    if (v <= 0) continue;
    const meta = MEASUREMENT_LABELS[code];
    if (!meta) continue;
    measurementsSummary.push({ label: meta.label, value: v, unit: meta.unit });
  }
  const addonLineItems: Array<{ description: string; qty: number; lineTotal: number }> = [];
  const addonQtys = (est.addon_qtys || {}) as Record<string, number>;
  for (const a of snap?.add_ons || []) {
    const qty = Number(addonQtys[a.code] || 0);
    if (qty <= 0) continue;
    addonLineItems.push({
      description: a.description,
      qty,
      lineTotal: Number(a.unit_price || 0) * qty,
    });
  }

  let pdfBase64: string | null = null;
  try {
    const pdfBytes = await generateRetailEstimatePdf({
      customerName: est.customer_name,
      customerAddress: est.customer_address,
      customerEmail,
      companyName,
      companyPhone: profile?.phone || null,
      companyEmail: profile?.email || null,
      companyAddress: null,
      companyLicense: null,
      productName,
      manufacturer,
      manufacturerSeries,
      warrantyDisclosure: snap?.warranty_disclosure || null,
      totalAmount,
      baseAmount: Number(est.base_amount || 0),
      addonsAmount: Number(est.addons_amount || 0),
      subtotalAmount: Number(est.subtotal_amount || 0),
      markupPct: Number(est.markup_pct || 0),
      markupAmount: Number(est.markup_amount || 0),
      measurementsSummary,
      addonLineItems,
      estimateDate: est.created_at ? new Date(est.created_at) : new Date(),
      paymentLinkUrl,
      signLinkUrl: est.sign_token
        ? `${process.env.NEXT_PUBLIC_APP_URL || "https://www.dumbroof.ai"}/sign/retail/${est.sign_token}`
        : null,
    });
    pdfBase64 = bytesToBase64(pdfBytes);
  } catch (err) {
    console.warn("[retail invoice] PDF generation failed, sending HTML-only:", err);
  }

  // Compose the email
  const firstName = (est.customer_name || "there").split(/\s+/)[0] || "there";
  const amountStr = totalAmount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  const subject = `Invoice — ${productName} from ${companyName}`;
  const customMsgBlock = body.custom_message
    ? `<p style="margin:0 0 16px 0;color:#333;">${escapeHtml(body.custom_message).replace(/\n/g, "<br/>")}</p>`
    : "";

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;color:#111;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #eaeaea;overflow:hidden;">
    <tr><td style="padding:24px 28px;border-bottom:1px solid #eaeaea;">
      <p style="margin:0 0 4px 0;font-size:11px;color:#777;text-transform:uppercase;letter-spacing:1px;">Invoice from</p>
      <h1 style="margin:0;font-size:22px;font-weight:700;">${escapeHtml(companyName)}</h1>
      ${profile?.phone || profile?.email
        ? `<p style="margin:6px 0 0 0;font-size:13px;color:#555;">${escapeHtml(profile?.phone || "")}${profile?.phone && profile?.email ? " · " : ""}${escapeHtml(profile?.email || "")}</p>`
        : ""}
    </td></tr>
    <tr><td style="padding:24px 28px;">
      <p style="margin:0 0 12px 0;font-size:14px;">Hi ${escapeHtml(firstName)},</p>
      ${customMsgBlock}
      <p style="margin:0 0 16px 0;font-size:14px;line-height:1.5;color:#333;">
        Your invoice for <strong>${escapeHtml(productName)}</strong>${est.customer_address ? ` at <strong>${escapeHtml(est.customer_address)}</strong>` : ""} is ready.
        The full estimate PDF is attached for your records.
      </p>
      <div style="background:#fafaf7;border-left:4px solid #22c55e;padding:16px;border-radius:6px;margin:16px 0;">
        <p style="margin:0;font-size:11px;color:#777;text-transform:uppercase;letter-spacing:1px;">Amount due</p>
        <p style="margin:6px 0 0 0;font-size:28px;font-weight:800;">${escapeHtml(amountStr)}</p>
      </div>
      <p style="margin:24px 0 8px 0;">
        <a href="${escapeHtml(paymentLinkUrl || "")}" style="display:inline-block;background:#22c55e;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;font-size:15px;">Pay Invoice</a>
      </p>
      <p style="margin:16px 0 0 0;font-size:11px;color:#888;">Payment is processed securely by Stripe. Reply to this email with any questions.</p>
    </td></tr>
    <tr><td style="padding:18px 28px;border-top:1px solid #eaeaea;background:#fafaf7;">
      <p style="margin:0;font-size:11px;color:#888;">Sent on behalf of <strong style="color:#444;">${escapeHtml(companyName)}</strong> via Dumb Roof.</p>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Hi ${firstName},`,
    "",
    body.custom_message || "",
    `Your invoice from ${companyName} for ${productName}${est.customer_address ? ` at ${est.customer_address}` : ""} is ready.`,
    "",
    `Amount due: ${amountStr}`,
    "",
    `Pay online: ${paymentLinkUrl}`,
    "",
    "Reply to this email with any questions.",
  ]
    .filter(Boolean)
    .join("\n");

  const fromName = `${companyName} via Dumb Roof <${EMAIL_FROM.match(/<([^>]+)>/)?.[1] || "hello@dumbroof.ai"}>`;
  const replyEmail = profile?.email || auth.user.email || EMAIL_REPLY_TO;
  const pdfFilename = `${(est.customer_name || est.customer_address || "Estimate").replace(/[^A-Za-z0-9 _-]/g, "")}.pdf`;

  try {
    const result = await getResend().emails.send({
      from: fromName,
      to: customerEmail!,
      replyTo: replyEmail,
      subject,
      html,
      text,
      ...(pdfBase64
        ? {
            attachments: [
              {
                filename: pdfFilename || "Retail-Estimate.pdf",
                content: pdfBase64,
              },
            ],
          }
        : {}),
    });
    if (result.error) {
      return NextResponse.json(
        {
          ok: false,
          payment_link_url: paymentLinkUrl,
          error: `Payment link created but email failed: ${result.error.message}`,
        },
        { status: 502 },
      );
    }

    await supabaseAdmin
      .from("retail_estimates")
      .update({
        stripe_invoice_status: "sent",
        status: est.status === "draft" ? "sent" : est.status,
        sent_at: est.sent_at || new Date().toISOString(),
        customer_email: customerEmail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("company_id", companyId);

    return NextResponse.json({
      ok: true,
      payment_link_url: paymentLinkUrl,
      payment_link_id: paymentLinkId,
      already_created: alreadyCreated,
      sent: true,
      message_id: result.data?.id,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        payment_link_url: paymentLinkUrl,
        error: `Payment link created but email failed: ${String(err)}`,
      },
      { status: 502 },
    );
  }
}
