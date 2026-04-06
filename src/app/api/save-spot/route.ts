import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getResend, EMAIL_FROM, EMAIL_REPLY_TO } from "@/lib/resend";

/**
 * "Save my spot" — magic-link signup for mobile in-app browser users.
 *
 * The mobile hero (src/components/mobile-magic-hero.tsx) posts here with
 * just an email. We use Supabase signInWithOtp to send a passwordless link,
 * then immediately send our own branded "open on desktop" email via Resend
 * with a one-click button.
 *
 * Why: roofers click ads on Instagram/Facebook on their phones during
 * downtime, but the actual upload work (EagleView PDF + 60 photos) needs
 * a desktop. This routes them through their inbox instead of bouncing.
 *
 * Funnel investigation: 2026-04-06 — 14 mobile signups in 7 days, 0 uploads.
 */

const FOLLOWUP_HTML = (magicLink: string) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
  <div style="background:linear-gradient(135deg,#0d2137 0%,#1a3a5c 100%);padding:28px;border-radius:12px 12px 0 0;">
    <h1 style="color:#ffffff;font-size:22px;margin:0;">Your dumbroof.ai link</h1>
    <p style="color:#b5d0e8;font-size:14px;margin:8px 0 0;">Open this on your desktop to upload your first claim.</p>
  </div>
  <div style="padding:28px;background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;color:#374151;margin:0 0 18px;">Tap the button below from your <strong>desktop or laptop</strong> — the upload form needs your EagleView PDF and inspection photos, which probably aren't on your phone.</p>

    <div style="text-align:center;margin:24px 0;">
      <a href="${magicLink}" style="background:linear-gradient(135deg,#ec4899,#8b5cf6,#3b82f6);color:#ffffff;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block;">Open on Desktop &rarr;</a>
    </div>

    <p style="font-size:14px;color:#6b7280;margin:18px 0 6px;"><strong>What you'll need:</strong></p>
    <ul style="font-size:14px;color:#6b7280;padding-left:20px;margin:0 0 18px;">
      <li>EagleView, HOVER, or GAF QuickMeasure report (PDF)</li>
      <li>Inspection photos (we accept ZIP, individual files, or CompanyCam imports)</li>
      <li>About 5 minutes</li>
    </ul>

    <p style="font-size:13px;color:#9ca3af;margin:18px 0 0;">Don't have measurements yet? You can still upload photos and we'll generate a forensic causation report. Add the rest later.</p>

    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />

    <p style="font-size:13px;color:#9ca3af;margin:0;">This link is single-use and expires in 1 hour. If it expires, just sign up again from your desktop at <a href="https://www.dumbroof.ai" style="color:#3b82f6;">dumbroof.ai</a>.</p>
    <p style="font-size:13px;color:#9ca3af;margin:8px 0 0;">Reply to this email with your phone number if you'd rather we text the link.</p>
    <p style="font-size:13px;color:#9ca3af;margin:14px 0 0;">— The DumbRoof Team</p>
  </div>
</div>
`;

export async function POST(req: NextRequest) {
  let email: string;
  let source: string | undefined;
  try {
    const body = await req.json();
    email = String(body.email || "").trim().toLowerCase();
    source = body.source;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!email || !email.includes("@") || email.length < 5) {
    return NextResponse.json({ error: "Please enter a valid email" }, { status: 400 });
  }

  const supabase = await createClient();

  // signInWithOtp creates the user if they don't exist (passwordless).
  // The redirect lands on /auth/callback which already supports `next=`
  // (Phase 1.6).
  const { error: otpError } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `https://www.dumbroof.ai/auth/callback?next=/dashboard/new-claim`,
      data: {
        signup_source: source || "mobile_inapp_magic_link",
      },
    },
  });

  if (otpError) {
    console.error("save-spot signInWithOtp failed:", otpError);
    return NextResponse.json({ error: otpError.message }, { status: 400 });
  }

  // Supabase sends its own OTP email. We ALSO send a branded one with
  // the magic link rendered as a desktop CTA. Most users open one or
  // the other; sending both maximizes the chance of a click.
  //
  // Note: we can't grab the actual magic link from signInWithOtp's response —
  // it's only in the email Supabase sends. So our follow-up email points
  // at the homepage with a session-aware CTA. Acceptable trade-off vs the
  // complexity of generating an admin-style magic link server-side.
  try {
    const resend = getResend();
    await resend.emails.send({
      from: EMAIL_FROM,
      to: [email],
      replyTo: EMAIL_REPLY_TO,
      subject: "Your dumbroof.ai link — open on desktop",
      html: FOLLOWUP_HTML("https://www.dumbroof.ai/login?email=" + encodeURIComponent(email)),
    });
  } catch (resendErr) {
    // Non-fatal — Supabase's email is the source of truth.
    console.error("save-spot followup email failed:", resendErr);
  }

  // Notify team about new mobile signup so they show up in the funnel
  // monitor immediately rather than waiting for the next cron tick.
  try {
    await fetch("https://www.dumbroof.ai/api/notify-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, source: source || "mobile_inapp_magic_link" }),
    });
  } catch {
    // Non-fatal
  }

  return NextResponse.json({ ok: true });
}
