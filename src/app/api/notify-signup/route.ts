import { readFileSync } from "fs";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { getResend } from "@/lib/resend";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendCapiEvent, CapiEventName } from "@/lib/meta-conversions-api";
import { getUtmFromRequest } from "@/lib/utm";
import { day_0_welcome, deriveFirstName } from "@/lib/nurture/templates";

const EMAIL_FROM_NOREPLY = "DumbRoof <noreply@dumbroof.ai>";
const EMAIL_FROM_TOM = "Tom Kovack <tom@dumbroof.ai>";

const TEAM_EMAILS = [
  "tkovack@usaroofmasters.com",
  "hello@dumbroof.ai",
  "arivera@usaroofmasters.com",
  "tom@dumbroof.ai",
  "kristen@dumbroof.ai",
  "matt@dumbroof.ai",
];

// Cache the base64-encoded PDF across invocations within the same cold start.
// The file is 10 MB — encoding it once per cold start instead of per request
// saves ~100-500ms and avoids the HTTP round-trip of fetching from our own CDN.
let _pdfBase64: string | null = null;
function getSamplePdfBase64(): string | null {
  if (_pdfBase64) return _pdfBase64;
  try {
    const buf = readFileSync(join(process.cwd(), "public/sample/forensic-report-sample.pdf"));
    _pdfBase64 = buf.toString("base64");
    return _pdfBase64;
  } catch {
    return null;
  }
}

const WELCOME_HTML = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a2e;">
  <div style="background: linear-gradient(135deg, #0d2137 0%, #1a3a5c 100%); padding: 32px; border-radius: 12px 12px 0 0;">
    <h1 style="color: white; font-size: 24px; margin: 0;">Your 3 free claims are ready</h1>
  </div>

  <div style="padding: 32px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none;">
    <p style="font-size: 16px; color: #374151;">Hey!</p>

    <p style="font-size: 16px; color: #374151;">Your account is set up. Here's how to get your first forensic report in 5 minutes:</p>

    <p style="font-size: 16px; color: #374151;"><strong>Step 1:</strong> Upload your inspection photos<br/><strong>Step 2:</strong> That's it. There is no step 2.</p>

    <p style="font-size: 14px; color: #6b7280;">The AI annotates every photo, pulls weather data, cites building codes, and builds a forensic report automatically.</p>

    <div style="text-align: center; margin: 28px 0;">
      <a href="https://www.dumbroof.ai/dashboard/new-claim" style="background: linear-gradient(135deg, #ec4899, #8b5cf6, #3b82f6); color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">Upload Photos &rarr; Get Your Report</a>
    </div>

    <p style="font-size: 14px; color: #6b7280;">We attached a sample forensic report to this email so you can see exactly what you'll get.</p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 28px 0;" />

    <h3 style="color: #0d2137; font-size: 16px;">Your claim grows with you.</h3>

    <p style="font-size: 14px; color: #6b7280;">A claim isn't a one-time event &mdash; it's a lifecycle. Start with photos and add documents as you get them:</p>

    <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin: 16px 0;">
      <tr style="background: #f9fafb;">
        <td style="padding: 10px 12px; border: 1px solid #e5e7eb; font-weight: 600; color: #374151;">Photos only</td>
        <td style="padding: 10px 12px; border: 1px solid #e5e7eb; color: #6b7280;">Forensic Causation Report (~5 min)</td>
      </tr>
      <tr>
        <td style="padding: 10px 12px; border: 1px solid #e5e7eb; font-weight: 600; color: #374151;">+ Measurements</td>
        <td style="padding: 10px 12px; border: 1px solid #e5e7eb; color: #6b7280;">Xactimate Estimate + Code Compliance Report</td>
      </tr>
      <tr style="background: #f9fafb;">
        <td style="padding: 10px 12px; border: 1px solid #e5e7eb; font-weight: 600; color: #374151;">+ Carrier scope</td>
        <td style="padding: 10px 12px; border: 1px solid #e5e7eb; color: #6b7280;">Full 6-doc package + Scope Comparison + Supplement Composer + Automation Dashboard</td>
      </tr>
    </table>

    <p style="font-size: 14px; color: #6b7280;">Upload measurements anytime &mdash; any source works (EagleView, HOVER, GAF QuickMeasure, hand-drawn, whatever you've got). Upload the carrier scope when you receive it. Every document you add unlocks more automation. Your claim is never &ldquo;done&rdquo; until the homeowner is paid and the job is complete.</p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 28px 0;" />

    <p style="font-size: 16px; color: #374151; font-weight: 600;">3 claims free. No credit card. No training required.</p>

    <div style="text-align: center; margin: 24px 0;">
      <a href="https://www.dumbroof.ai/dashboard/new-claim" style="background: linear-gradient(135deg, #ec4899, #8b5cf6, #3b82f6); color: white; padding: 12px 28px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">Get started &rarr;</a>
    </div>

    <p style="font-size: 13px; color: #9ca3af;">&mdash; The DumbRoof Team</p>
  </div>
</div>
`;

/**
 * Send welcome email with cached PDF attachment. Falls back to no-attachment
 * if the PDF can't be read (e.g. deployed without the public/ file).
 */
async function sendWelcome(email: string): Promise<void> {
  try {
    const resend = getResend();
    const pdfBase64 = getSamplePdfBase64();

    await resend.emails.send({
      from: EMAIL_FROM_NOREPLY,
      to: [email],
      subject: "Your 3 free claims are ready",
      html: WELCOME_HTML,
      ...(pdfBase64 && {
        attachments: [
          { filename: "DumbRoof-Sample-Forensic-Report.pdf", content: pdfBase64 },
        ],
      }),
    });
  } catch (err) {
    console.error("Welcome email failed:", err);
  }
}

/**
 * Send the day-0 nurture touch from Tom's personal address — instantly on
 * signup, not 12-72h later via the cron. Records nurture_sent_at.day_0_welcome
 * in company_profiles.settings so the daily nurture cron skips this touch
 * for this user (idempotent dedupe).
 *
 * Distinct from the transactional sendWelcome above — the noreply welcome is
 * the formal account-confirmation with the sample PDF; this is the personal
 * "what to do in the next 5 minutes" follow-up. Different sender, different
 * voice, different purpose. Both fire in parallel.
 */
async function sendInstantNurtureWelcome(email: string): Promise<void> {
  try {
    // Find the user_id for this email via the list_platform_users RPC
    // (the broken auth.admin.listUsers replacement — see E171).
    const { data: users, error: usersErr } = await supabaseAdmin.rpc("list_platform_users");
    if (usersErr) {
      console.warn("[notify-signup] list_platform_users failed:", usersErr.message);
      return;
    }
    type RpcRow = { id: string; email: string | null };
    const user = ((users as RpcRow[] | null) || []).find(
      (u) => (u.email || "").toLowerCase() === email.toLowerCase()
    );
    if (!user) {
      console.warn("[notify-signup] day_0 nurture: no user row for", email);
      return;
    }

    // Pull existing profile for personalization + idempotent dedupe.
    const { data: profile } = await supabaseAdmin
      .from("company_profiles")
      .select("user_id, contact_name, company_name, settings, email")
      .eq("user_id", user.id)
      .maybeSingle();

    type Settings = {
      nurture_sent_at?: Record<string, string>;
      nurture_opted_out?: boolean;
    };
    const settings: Settings = (profile?.settings as Settings | null) || {};
    if (settings.nurture_opted_out) return;
    if (settings.nurture_sent_at?.day_0_welcome) return; // already fired (e.g. cron beat us)

    const firstName = deriveFirstName({ contact_name: profile?.contact_name, email });
    const companyName = (profile?.company_name || "").trim();
    const { subject, html } = day_0_welcome({
      first_name: firstName,
      company_name: companyName,
      email,
    });

    const resend = getResend();
    const { error: sendErr } = await resend.emails.send({
      from: EMAIL_FROM_TOM,
      to: [email],
      replyTo: "tom@dumbroof.ai",
      subject,
      html,
      tags: [
        { name: "type", value: "nurture" },
        { name: "touch", value: "day_0_welcome" },
        { name: "trigger", value: "instant_on_signup" },
      ],
    });
    if (sendErr) {
      console.error("[notify-signup] day_0 nurture send failed:", sendErr.message);
      return;
    }

    // Record sent timestamp so the daily nurture cron won't re-fire this touch.
    const newSettings: Settings = {
      ...settings,
      nurture_sent_at: {
        ...(settings.nurture_sent_at || {}),
        day_0_welcome: new Date().toISOString(),
      },
    };
    if (profile) {
      const { error } = await supabaseAdmin
        .from("company_profiles")
        .update({ settings: newSettings })
        .eq("user_id", user.id);
      if (error) console.error("[notify-signup] day_0 settings update failed:", error.message);
    } else {
      // No profile row yet — insert a stub so the dedupe survives.
      const { error } = await supabaseAdmin
        .from("company_profiles")
        .insert({ user_id: user.id, email, settings: newSettings });
      if (error) console.error("[notify-signup] day_0 settings stub insert failed:", error.message);
    }
  } catch (err) {
    console.error("[notify-signup] sendInstantNurtureWelcome threw:", err);
  }
}

export async function POST(req: NextRequest) {
  const { email, source, eventId } = await req.json();
  if (!email) {
    return NextResponse.json({ error: "No email" }, { status: 400 });
  }

  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const sourceLabel = typeof source === "string" && source.length > 0 ? source : "unknown";

  // Extract UTM attribution + Meta tracking cookies for CAPI
  const utm = getUtmFromRequest(req);
  const cookieHeader = req.headers.get("cookie") || "";
  const fbpMatch = cookieHeader.match(/(?:^|; )_fbp=([^;]*)/);
  const fbcMatch = cookieHeader.match(/(?:^|; )_fbc=([^;]*)/);

  // Send team notification, transactional welcome, instant day-0 nurture,
  // AND CAPI CompleteRegistration in parallel.
  //
  // CAPI CompleteRegistration is critical — browser pixel fires this event but
  // iOS 14+ blocks it for 25-40% of users. Server-side ensures Meta sees every signup.
  //
  // Day-0 nurture is fired here (not via the daily cron) so the personal
  // tom@dumbroof.ai touch lands in the same minute as the transactional
  // noreply@ welcome. The cron's day_0 window (12-72h) becomes a backstop
  // for any signup where this in-line send failed.
  const resend = getResend();
  const results = await Promise.allSettled([
    resend.emails.send({
      from: EMAIL_FROM_NOREPLY,
      to: TEAM_EMAILS,
      subject: `New User Signup: ${email}`,
      html: `<h2>New User Registered on dumbroof.ai</h2>
        <p><strong>${email}</strong> just created an account.</p>
        <p>Source: <strong>${sourceLabel}</strong></p>
        ${utm?.utm_campaign ? `<p>Campaign: <strong>${utm.utm_campaign}</strong> (${utm.utm_source || "?"} / ${utm.utm_medium || "?"})</p>` : ""}
        <p>Time: ${timestamp} ET</p>
        <p><a href="https://www.dumbroof.ai/dashboard/admin" style="background-color:#2563eb;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">View Admin Dashboard</a></p>`,
    }),
    sendWelcome(email),
    sendInstantNurtureWelcome(email),
    // CAPI CompleteRegistration — iOS 14+ can't block server-side events.
    // `eventId` (when provided by the client-side pixel call) makes Meta
    // dedupe the browser + server fires into one canonical event. Without
    // it we double-count on desktop and rely on luck on iOS.
    sendCapiEvent({
      eventName: CapiEventName.CompleteRegistration,
      email,
      eventId: typeof eventId === "string" && eventId.length > 0 ? eventId : undefined,
      eventSourceUrl: "https://www.dumbroof.ai/",
      clientIpAddress: req.headers.get("x-forwarded-for") || undefined,
      clientUserAgent: req.headers.get("user-agent") || undefined,
      fbc: fbcMatch?.[1],
      fbp: fbpMatch?.[1],
      customData: {
        content_name: sourceLabel,
        content_category: "signup",
        ...(utm?.utm_source && { utm_source: utm.utm_source }),
        ...(utm?.utm_campaign && { utm_campaign: utm.utm_campaign }),
      },
    }),
  ]);

  for (const r of results) {
    if (r.status === "rejected") {
      console.error("notify-signup partial failure:", r.reason);
    }
  }

  return NextResponse.json({ ok: true });
}
