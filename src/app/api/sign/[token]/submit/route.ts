import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend } from "@/lib/resend";

export const dynamic = "force-dynamic";

/**
 * POST /api/sign/[token]/submit — PUBLIC endpoint
 *
 * Captures customer e-signature on a retail estimate. No auth required —
 * the URL-embedded sign_token is the only credential (random 32-byte hex,
 * lives only in the contractor's account and the customer's inbox).
 *
 * Records: signed_at, signed_by_name, signed_by_ip, signed_by_user_agent.
 * Updates status to 'signed' and emails the contractor a notification.
 *
 * Idempotency: if already signed, returns 409 with the existing signature.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  let body: { name?: string; agreed?: boolean };
  try {
    body = (await req.json()) as { name?: string; agreed?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = (body.name || "").trim();
  if (!name || name.length < 2) {
    return NextResponse.json({ error: "Full name required to sign" }, { status: 400 });
  }
  if (!body.agreed) {
    return NextResponse.json({ error: "Must agree to the terms to sign" }, { status: 400 });
  }

  const { data: est, error: fetchErr } = await supabaseAdmin
    .from("retail_estimates")
    .select("id, user_id, signed_at, status, customer_name, customer_email, total_amount")
    .eq("sign_token", token)
    .maybeSingle();
  if (fetchErr || !est) {
    return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
  }
  if (est.signed_at) {
    return NextResponse.json(
      { error: "Estimate already signed", signed_at: est.signed_at },
      { status: 409 },
    );
  }

  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "";
  const ua = req.headers.get("user-agent") || "";
  const signedAt = new Date().toISOString();

  const { error: upErr } = await supabaseAdmin
    .from("retail_estimates")
    .update({
      signed_at: signedAt,
      signed_by_name: name,
      signed_by_ip: ip.split(",")[0].trim() || null,
      signed_by_user_agent: ua,
      status: "signed",
      updated_at: signedAt,
    })
    .eq("id", est.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Notify the contractor that their estimate just got signed.
  try {
    const { data: profile } = await supabaseAdmin
      .from("company_profiles")
      .select("email, contact_name")
      .eq("user_id", est.user_id)
      .maybeSingle();
    const contractorEmail = profile?.email as string | undefined;
    if (contractorEmail) {
      const resend = getResend();
      const fmtUsd = (n: number) =>
        n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
      const dashboardUrl = `${new URL(req.url).origin}/dashboard/retail-estimate?id=${est.id}`;
      await resend.emails.send({
        from: "DumbRoof <noreply@dumbroof.ai>",
        to: [contractorEmail],
        bcc: ["claims@dumbroof.ai"],
        subject: `✅ ${est.customer_name || "Customer"} signed your estimate (${fmtUsd(Number(est.total_amount))})`,
        html: `<div style="font-family:-apple-system,sans-serif;max-width:560px;line-height:1.5;">
  <h2 style="margin:0 0 12px;">Estimate signed</h2>
  <p><strong>${name}</strong> just signed your estimate for <strong>${fmtUsd(Number(est.total_amount))}</strong>.</p>
  <p style="color:#6b7280;font-size:13px;">Customer: ${est.customer_name || "(unnamed)"} · ${est.customer_email || "no email"}<br/>
  Signed at: ${signedAt}<br/>
  Signer IP: ${ip || "(unknown)"}<br/>
  </p>
  <p style="margin:20px 0;"><a href="${dashboardUrl}" style="background:#0d2137;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">View signed estimate &rarr;</a></p>
</div>`,
        tags: [
          { name: "type", value: "retail-estimate-signed-alert" },
          { name: "estimate_id", value: est.id },
        ],
      });
    }
  } catch (err) {
    console.error("[sign] contractor notification failed (non-fatal):", err);
  }

  return NextResponse.json({ ok: true, signed_at: signedAt, signed_by_name: name });
}
