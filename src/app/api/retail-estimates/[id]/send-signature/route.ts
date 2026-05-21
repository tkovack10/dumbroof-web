import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getResend } from "@/lib/resend";

export const dynamic = "force-dynamic";

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * POST /api/retail-estimates/[id]/send-signature
 *
 * Generates a one-time signing token (32 bytes hex), saves it on the
 * estimate, and emails the customer a link to /sign/{token} where they
 * can review the quote and click to sign.
 *
 * E-signature record captures:
 *   - signed_at, signed_by_name, signed_by_ip, signed_by_user_agent
 *
 * That set (consent + identity + timestamp + record-keeping) satisfies
 * the ESIGN Act for ordinary commercial agreements. For real-estate /
 * regulated industries, use a dedicated e-sig provider (DocuSign, etc.).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;
  const { id } = await params;

  const [{ data: est }, { data: profile }] = await Promise.all([
    supabaseAdmin.from("retail_estimates").select("*").eq("id", id).eq("user_id", userId).maybeSingle(),
    supabaseAdmin
      .from("company_profiles")
      .select("company_name, contact_name, phone, email")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (!est) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
  if (!est.customer_email) {
    return NextResponse.json({ error: "Customer email required to send for signature" }, { status: 400 });
  }

  // Generate or reuse the sign token. Reuse so a contractor can re-send the
  // same link if the customer lost the email.
  let signToken = est.sign_token as string | null;
  if (!signToken) {
    signToken = randomBytes(32).toString("hex");
    await supabaseAdmin
      .from("retail_estimates")
      .update({ sign_token: signToken, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId);
  }

  const origin = new URL(req.url).origin;
  const signUrl = `${origin}/sign/${signToken}`;
  const companyName = (profile?.company_name as string) || "Your Roofing Contractor";
  const contactName = (profile?.contact_name as string) || "";
  const contractorEmail = (profile?.email as string) || "";

  const customerFirst = ((est.customer_name as string | null) || "").split(/\s+/)[0] || "there";

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;color:#1a1a2e;line-height:1.55;">
  <p>Hi ${customerFirst},</p>
  <p>${contactName ? `${contactName} from ${companyName}` : companyName} has prepared an estimate for the roof project at <strong>${est.customer_address || "your property"}</strong>:</p>

  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0;">
    <p style="margin:0;color:#6b7280;font-size:13px;">Total — All-Inclusive</p>
    <p style="margin:4px 0 0;font-size:24px;font-weight:700;color:#0d2137;">${fmtUsd(Number(est.total_amount))}</p>
  </div>

  <p>When you're ready to move forward, click below to review the full estimate and sign electronically. Takes about 60 seconds.</p>

  <p style="text-align:center;margin:24px 0;">
    <a href="${signUrl}" style="display:inline-block;background:#0d2137;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;">Review &amp; Sign Estimate &rarr;</a>
  </p>

  <p style="color:#6b7280;font-size:12px;">This link is unique to you. Don't share it. Signature is electronically time-stamped and legally binding under the U.S. ESIGN Act.</p>

  <p>Questions? Just reply to this email.</p>

  <p>&mdash; ${contactName || "The team at " + companyName}</p>
</div>`;

  const fromName = companyName.length <= 60 ? companyName : "DumbRoof";
  try {
    const resend = getResend();
    const { error } = await resend.emails.send({
      from: `${fromName} <noreply@dumbroof.ai>`,
      to: [est.customer_email as string],
      replyTo: contractorEmail || "tom@dumbroof.ai",
      bcc: ["claims@dumbroof.ai"],
      subject: `Review & sign your roof estimate — ${fmtUsd(Number(est.total_amount))}`,
      html,
      tags: [
        { name: "type", value: "retail-estimate-sign" },
        { name: "estimate_id", value: id },
      ],
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  await supabaseAdmin
    .from("retail_estimates")
    .update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);

  return NextResponse.json({ ok: true, sign_url: signUrl });
}
