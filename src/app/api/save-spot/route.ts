import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend, EMAIL_FROM, EMAIL_REPLY_TO } from "@/lib/resend";
import { sendCapiEvent, CapiEventName, extractMetaTracking } from "@/lib/meta-conversions-api";

/**
 * "Save my spot" — magic-link signup for mobile in-app browser users.
 *
 * The mobile hero (src/components/mobile-magic-hero.tsx) posts here with
 * just an email. We use Supabase admin generateLink() to mint a REAL
 * magic link server-side (which also creates the user if they don't
 * exist), then send our own branded "open on desktop" email via Resend
 * containing that link. We do NOT call signInWithOtp because that would
 * also fire Supabase's default email — leading to two emails that confuse
 * the user.
 *
 * Why: roofers click ads on Instagram/Facebook on their phones during
 * downtime, but the actual upload work (EagleView PDF + 60 photos) needs
 * a desktop. This routes them through their inbox to a desktop session.
 *
 * Funnel investigation: 2026-04-06 — 14 mobile signups in 7 days, 0 uploads.
 */

const APP_URL = "https://www.dumbroof.ai";

const FOLLOWUP_HTML = (magicLink: string) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
  <div style="background:linear-gradient(135deg,#0d2137 0%,#1a3a5c 100%);padding:28px;border-radius:12px 12px 0 0;">
    <h1 style="color:#ffffff;font-size:22px;margin:0;">Your dumbroof.ai link</h1>
    <p style="color:#b5d0e8;font-size:14px;margin:8px 0 0;">Open this on your desktop to upload your first claim.</p>
  </div>
  <div style="padding:28px;background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;color:#374151;margin:0 0 18px;">Tap the button below from your <strong>desktop or laptop</strong> &mdash; the upload form needs your EagleView PDF and inspection photos, which probably aren't on your phone.</p>

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

    <p style="font-size:13px;color:#9ca3af;margin:0;">This link is single-use and expires in 1 hour. If it expires, just sign up again from your desktop at <a href="${APP_URL}" style="color:#3b82f6;">dumbroof.ai</a>.</p>
    <p style="font-size:13px;color:#9ca3af;margin:8px 0 0;">Reply to this email with your phone number if you'd rather we text the link.</p>
    <p style="font-size:13px;color:#9ca3af;margin:14px 0 0;">&mdash; The DumbRoof Team</p>
  </div>
</div>
`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let email: string;
  let source: string | undefined;
  try {
    const body = await req.json();
    email = String(body.email || "").trim().toLowerCase();
    source = typeof body.source === "string" ? body.source : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email" }, { status: 400 });
  }

  // Mint a real magic link via the admin API. This:
  //   1. Creates the user if they don't exist (magiclink type creates by default)
  //   2. Returns the actual signed action_link we can put in our own email
  //   3. Does NOT trigger Supabase's default email
  // Docs: https://supabase.com/docs/reference/javascript/auth-admin-generatelink
  const { data, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: `${APP_URL}/auth/callback?next=/dashboard/new-claim`,
      data: {
        signup_source: source || "mobile_inapp_magic_link",
      },
    },
  });

  if (linkError || !data?.properties?.action_link) {
    console.error("save-spot generateLink failed:", linkError);
    // Don't leak Supabase error messages to the client — they sometimes
    // include internal details. Use a friendly fallback.
    return NextResponse.json(
      { error: "Couldn't send your link. Please try again or sign up from your desktop." },
      { status: 500 }
    );
  }

  const magicLink = data.properties.action_link;

  // Send our own branded email containing the real magic link.
  try {
    const resend = getResend();
    await resend.emails.send({
      from: EMAIL_FROM,
      to: [email],
      replyTo: EMAIL_REPLY_TO,
      subject: "Your dumbroof.ai link — open on desktop",
      html: FOLLOWUP_HTML(magicLink),
    });
  } catch (resendErr) {
    console.error("save-spot Resend send failed:", resendErr);
    // The user has been created in Supabase but didn't get our email.
    // They can still sign up again — return success so they see the
    // "check your inbox" UI. Tom will see the failure in Resend dashboard.
  }

  // Notify team about new mobile signup. Fire-and-forget.
  fetch(`${APP_URL}/api/notify-signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, source: source || "mobile_inapp_magic_link" }),
  }).catch(() => {});

  // Fire Meta CAPI Lead event server-side. iOS 14+ blocks the browser pixel
  // for ~25-40% of users — without this, Meta's algorithm sees a fraction of
  // our actual conversions. Fire-and-forget; never blocks the response.
  // The browser pixel ALSO fires a Lead event from mobile-magic-hero.tsx —
  // event_id (auto UUID here) is unique per side, so Meta keeps both as
  // separate events. For exact dedup we'd need to thread the same UUID
  // through to the client, which is a follow-up.
  const tracking = extractMetaTracking(req);
  sendCapiEvent({
    eventName: CapiEventName.Lead,
    email,
    eventSourceUrl: `${APP_URL}/`,
    clientIpAddress: req.headers.get("x-forwarded-for") || undefined,
    clientUserAgent: req.headers.get("user-agent") || undefined,
    fbc: tracking.fbc,
    fbp: tracking.fbp,
    customData: {
      content_name: "mobile_magic_link",
      content_category: source || "mobile_inapp_magic_link",
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
