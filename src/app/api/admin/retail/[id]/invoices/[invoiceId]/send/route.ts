import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import {
  getResend,
  EMAIL_FROM_CLAIMS,
  EMAIL_REPLY_TO,
  teamBccFor,
} from "@/lib/resend";

/**
 * POST /api/admin/retail/[id]/invoices/[invoiceId]/send
 *
 * Executes a staged retail invoice (status='draft'): creates a Stripe
 * Connect payment link on the company's connected account and emails it
 * to the customer. Mirrors the claim-side /api/invoices/payment-link
 * pattern. Idempotent: re-calling on a 'sent' or 'paid' row returns the
 * existing payment_link without re-sending.
 *
 * Auth: admin in the company that owns the retail job.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; invoiceId: string }> }
) {
  const { id: retailJobId, invoiceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, company_id, stripe_connect_account_id, stripe_connect_status")
    .eq("user_id", user.id)
    .limit(1);
  if (!profileRows?.[0]?.is_admin) {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  const companyId = profileRows[0].company_id;

  // Load invoice + job + company
  const { data: invoice } = await supabaseAdmin
    .from("retail_invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (
    !invoice ||
    invoice.company_id !== companyId ||
    invoice.retail_job_id !== retailJobId
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (invoice.status === "paid") {
    return NextResponse.json({
      ok: true,
      already_paid: true,
      payment_link: invoice.payment_link,
    });
  }
  if (invoice.status === "sent" && invoice.payment_link) {
    return NextResponse.json({
      ok: true,
      already_sent: true,
      payment_link: invoice.payment_link,
    });
  }

  const { data: job } = await supabaseAdmin
    .from("retail_jobs")
    .select("*")
    .eq("id", retailJobId)
    .maybeSingle();
  if (!job || job.company_id !== companyId) {
    return NextResponse.json({ error: "Retail job not found" }, { status: 404 });
  }

  const toEmail = invoice.sent_to_email || job.customer_email;
  if (!toEmail) {
    return NextResponse.json(
      { error: "No customer email on invoice or job" },
      { status: 400 }
    );
  }

  const connectAccountId =
    invoice.stripe_connect_account_id ||
    profileRows[0].stripe_connect_account_id;
  const connectStatus = profileRows[0].stripe_connect_status;
  if (connectStatus !== "active" || !connectAccountId) {
    return NextResponse.json(
      {
        error:
          "Stripe Connect is not active — connect a payout account in Company Settings before sending retail invoices.",
      },
      { status: 400 }
    );
  }

  const { data: company } = await supabaseAdmin
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle();
  const companyName = company?.name || "Your Roofing Team";

  // Idempotency: if a Stripe link already exists on this invoice (e.g. the
  // email send failed on a previous attempt and the row is still 'draft'),
  // reuse it instead of creating a second link.
  let paymentLinkUrl: string;
  if (invoice.payment_link && invoice.stripe_payment_link_id) {
    paymentLinkUrl = invoice.payment_link;
  } else {
    try {
      const stripe = getStripe();
      const stripeOpts = { stripeAccount: connectAccountId };

      const price = await stripe.prices.create(
        {
          unit_amount: invoice.amount_cents,
          currency: "usd",
          product_data: {
            name:
              invoice.description ||
              `${companyName} — ${invoice.kind} invoice for ${job.customer_name}`,
          },
        },
        stripeOpts
      );

      const paymentLink = await stripe.paymentLinks.create(
        {
          line_items: [{ price: price.id, quantity: 1 }],
          metadata: {
            retail_job_id: retailJobId,
            retail_invoice_id: invoiceId,
            kind: invoice.kind,
            customer_email: toEmail,
          },
          after_completion: {
            type: "redirect",
            redirect: {
              url: `${process.env.NEXT_PUBLIC_APP_URL || "https://www.dumbroof.ai"}/dashboard/retail?paid=${invoiceId}`,
            },
          },
        },
        stripeOpts
      );

      paymentLinkUrl = paymentLink.url;

      // Persist link fields IMMEDIATELY so a subsequent email-failure retry
      // doesn't create a duplicate Stripe payment link.
      await supabaseAdmin
        .from("retail_invoices")
        .update({
          stripe_price_id: price.id,
          stripe_payment_link_id: paymentLink.id,
          payment_link: paymentLinkUrl,
        })
        .eq("id", invoiceId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Stripe error";
      return NextResponse.json(
        { error: `Failed to create Stripe payment link: ${msg}` },
        { status: 500 }
      );
    }
  }

  // Send email
  const firstName = (job.customer_name || "there").split(/\s+/)[0] || "there";
  const amountStr = `$${(invoice.amount_cents / 100).toFixed(2)}`;
  const subjectMap: Record<string, string> = {
    deposit: `Deposit invoice — ${companyName}`,
    progress: `Progress invoice — ${companyName}`,
    balance: `Balance due — ${companyName}`,
    full: `Invoice — ${companyName}`,
  };
  const subject = subjectMap[invoice.kind] || subjectMap.full;

  const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, system-ui, sans-serif; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h2 style="margin: 0 0 16px;">Hi ${escapeHtml(firstName)},</h2>
  <p>Your ${escapeHtml(invoice.kind)} invoice from <strong>${escapeHtml(companyName)}</strong> is ready:</p>
  <div style="background: #f5f5f5; border-left: 4px solid #22c55e; padding: 16px; border-radius: 6px; margin: 16px 0;">
    <p style="margin: 0; font-size: 24px;"><strong>${escapeHtml(amountStr)}</strong></p>
    ${invoice.description ? `<p style="margin: 8px 0 0; color: #555;">${escapeHtml(invoice.description)}</p>` : ""}
  </div>
  <p>
    <a href="${escapeAttr(paymentLinkUrl)}" style="display:inline-block;background:#22c55e;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Pay invoice</a>
  </p>
  <p style="color:#666;font-size:12px;margin-top:24px;">Payment is processed securely by Stripe.</p>
  <p>Thanks,<br/>${escapeHtml(companyName)}</p>
</body></html>`;

  let resendId: string | null = null;
  try {
    const resend = getResend();
    const bcc = teamBccFor({
      recipientEmail: toEmail,
      companyName: company?.name ?? null,
    });
    const { data } = await resend.emails.send({
      from: EMAIL_FROM_CLAIMS,
      to: [toEmail],
      bcc,
      replyTo: EMAIL_REPLY_TO,
      subject,
      html,
    });
    resendId = data?.id || null;
  } catch (e) {
    // Stripe link is created, just the email failed — surface but don't roll back.
    return NextResponse.json(
      {
        ok: false,
        payment_link: paymentLinkUrl,
        error: `Payment link created but email failed: ${e instanceof Error ? e.message : "unknown"}`,
      },
      { status: 500 }
    );
  }

  await supabaseAdmin
    .from("retail_invoices")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_to_email: toEmail,
    })
    .eq("id", invoiceId);

  // Bump the parent retail_job into 'invoiced' if it was draft/proposal_sent/accepted
  if (["draft", "proposal_sent", "accepted"].includes(job.status)) {
    await supabaseAdmin
      .from("retail_jobs")
      .update({ status: "invoiced" })
      .eq("id", retailJobId);
  }

  return NextResponse.json({
    ok: true,
    payment_link: paymentLinkUrl,
    resend_id: resendId,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
