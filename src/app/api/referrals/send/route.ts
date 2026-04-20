import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getResend, EMAIL_FROM, EMAIL_REPLY_TO } from "@/lib/resend";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { user } = auth;

  let body: { to_email?: string; personal_note?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const toEmail = (body.to_email || "").trim().toLowerCase();
  const personalNote = (body.personal_note || "").trim() || null;

  if (!toEmail || !toEmail.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  // Pull inviter's referral_code + profile info
  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("referral_code, contact_name, email, company_name")
    .eq("user_id", user.id)
    .limit(1);

  const profile = profileRows?.[0];
  if (!profile || !profile.referral_code) {
    return NextResponse.json(
      { error: "Your referral code isn't ready yet — try again in a moment." },
      { status: 400 }
    );
  }

  const referrerName = profile.contact_name || profile.email || user.email || "A friend";
  const referrerCompany = profile.company_name || "their roofing company";
  const link = `https://dumbroof.ai/r/${profile.referral_code}`;

  // Record the referral as 'pending' (will advance to 'signed_up' on auth callback,
  // 'paid' on first Pro invoice, 'reward_applied' on coupon mint).
  const { data: existing } = await supabaseAdmin
    .from("referrals")
    .select("id, status")
    .eq("referrer_user_id", user.id)
    .eq("referred_email", toEmail)
    .limit(1);

  if (!existing || existing.length === 0) {
    await supabaseAdmin.from("referrals").insert({
      referrer_user_id: user.id,
      referral_code: profile.referral_code,
      referred_email: toEmail,
      status: "pending",
    });
  }

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;">
      <h1 style="font-size:22px;margin:0 0 12px;">${escapeHtml(referrerName)} thinks you should see dumbroof.ai</h1>
      <p style="font-size:15px;line-height:1.5;color:#333;margin:0 0 16px;">
        ${escapeHtml(referrerCompany)} is using <strong>dumbroof.ai</strong> to run their insurance claims — AI forensic reports,
        automated supplements, and a system that actually gets claims approved faster.
      </p>
      ${
        personalNote
          ? `<blockquote style="border-left:3px solid #8b5cf6;padding:8px 14px;margin:16px 0;background:#f4f0ff;color:#222;font-size:14px;">
              ${escapeHtml(personalNote).replace(/\n/g, "<br/>")}
              <div style="margin-top:8px;font-size:12px;color:#666;">— ${escapeHtml(referrerName)}</div>
            </blockquote>`
          : ""
      }
      <p style="margin:24px 0;">
        <a href="${link}" style="display:inline-block;background:linear-gradient(90deg,#ec4899,#8b5cf6,#3b82f6);color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;font-size:15px;">
          Try it free — 3 claims on us
        </a>
      </p>
      <p style="font-size:13px;color:#555;margin:24px 0 0;">
        Starter: 3 free claims. Pro: $499/mo for 10 claims. No card required to start.
      </p>
      <p style="font-size:12px;color:#aaa;margin:24px 0 0;">
        This is a personal referral from ${escapeHtml(referrerName)}. You can unsubscribe or ignore — we only email when a real person refers you.
      </p>
    </div>
  `.trim();

  try {
    const resend = getResend();
    await resend.emails.send({
      from: EMAIL_FROM,
      to: [toEmail],
      replyTo: profile.email || EMAIL_REPLY_TO,
      subject: `${referrerName} sent you a dumbroof.ai invite`,
      html,
    });
  } catch (e) {
    console.error("[referrals/send] Resend failed", e);
    return NextResponse.json({ error: "Email send failed — try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, link });
}
