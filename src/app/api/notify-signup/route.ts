import { NextRequest, NextResponse } from "next/server";

const SAMPLE_REPORT_URL = "https://www.dumbroof.ai/sample/forensic-report-sample.pdf";

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
 * Send welcome email with sample report attachment.
 * Runs server-side so browser navigation can't kill it.
 */
async function sendWelcome(resendKey: string, email: string): Promise<void> {
  try {
    const pdfRes = await fetch(SAMPLE_REPORT_URL, { signal: AbortSignal.timeout(10000) });
    if (!pdfRes.ok) {
      // PDF fetch failed — send welcome without attachment rather than not sending at all
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "DumbRoof <noreply@dumbroof.ai>",
          to: [email],
          subject: "Your 3 free claims are ready",
          html: WELCOME_HTML,
        }),
      });
      return;
    }
    const pdfBuffer = await pdfRes.arrayBuffer();
    const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "DumbRoof <noreply@dumbroof.ai>",
        to: [email],
        subject: "Your 3 free claims are ready",
        html: WELCOME_HTML,
        attachments: [
          { filename: "DumbRoof-Sample-Forensic-Report.pdf", content: pdfBase64 },
        ],
      }),
    });
  } catch (err) {
    console.error("Welcome email failed:", err);
  }
}

export async function POST(req: NextRequest) {
  const RESEND_KEY = process.env.RESEND_API_KEY?.trim();
  if (!RESEND_KEY) {
    return NextResponse.json({ error: "No Resend key" }, { status: 500 });
  }

  const { email, source } = await req.json();
  if (!email) {
    return NextResponse.json({ error: "No email" }, { status: 400 });
  }

  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const sourceLabel = typeof source === "string" && source.length > 0 ? source : "unknown";

  // Send team notification AND welcome email in parallel, both server-side.
  // Previously welcome email was fired client-side via a separate fetch() call,
  // but window.location.href navigation killed 87% of those requests on mobile
  // before the PDF download + email send could complete.
  //
  // Using allSettled so a failure in one (e.g. Resend network blip) doesn't
  // prevent the other from completing or cause a 500 response.
  const results = await Promise.allSettled([
    // Team notification (fast — small HTML, no attachments)
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "DumbRoof <noreply@dumbroof.ai>",
        to: ["tkovack@usaroofmasters.com", "hello@dumbroof.ai", "arivera@usaroofmasters.com", "tom@dumbroof.ai", "kristen@dumbroof.ai"],
        subject: `New User Signup: ${email}`,
        html: `<h2>New User Registered on dumbroof.ai</h2>
          <p><strong>${email}</strong> just created an account.</p>
          <p>Source: <strong>${sourceLabel}</strong></p>
          <p>Time: ${timestamp} ET</p>
          <p><a href="https://www.dumbroof.ai/dashboard/admin" style="background-color:#2563eb;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">View Admin Dashboard</a></p>`,
      }),
    }),
    // Welcome email to user (slow — downloads PDF sample report, then sends with attachment)
    sendWelcome(RESEND_KEY, email),
  ]);

  // Log failures but always return 200 — the client already navigated away
  for (const r of results) {
    if (r.status === "rejected") {
      console.error("notify-signup partial failure:", r.reason);
    }
  }

  return NextResponse.json({ ok: true });
}
