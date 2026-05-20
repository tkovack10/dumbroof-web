import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend } from "@/lib/resend";

export const dynamic = "force-dynamic";

/**
 * Inbound reply webhook for the nurture sequence.
 *
 * When a user replies to one of Tom's nurture emails (e.g. "demo", "keep",
 * a question, anything), this webhook:
 *   1. Looks up the user by their from-email address
 *   2. Sets company_profiles.settings.nurture_opted_out = true so the cron
 *      stops sending them touches
 *   3. Logs the reply in nurture_replies for Tom's review
 *   4. Forwards an alert email to tom@dumbroof.ai so Tom can respond in
 *      real time (these replies are the highest-intent signal we get)
 *
 * Auth: shared-secret bearer token (NURTURE_INBOUND_SECRET env var) so the
 * endpoint can't be abused by random POSTs. Set the same secret in your
 * email-forwarding provider (Resend Inbound, Zapier, Cloudflare Email
 * Workers, Pipedream, etc.).
 *
 * ---------------------------------------------------------------------------
 * Setup paths (pick one — all hit the same endpoint with the same payload):
 *
 * PATH A — Resend Inbound (cleanest, requires MX change)
 *   1. resend.com/dashboard → Inbound → add domain dumbroof.ai → copy MX records
 *   2. Update Cloudflare DNS for dumbroof.ai with the new MX records
 *   3. Create an inbound endpoint for "tom@dumbroof.ai" with webhook URL:
 *      https://www.dumbroof.ai/api/webhooks/nurture-reply
 *   4. Set the webhook signing secret in NURTURE_INBOUND_SECRET (Vercel env)
 *   Payload Resend sends: { from, to, subject, text, html, headers }
 *
 * PATH B — Gmail filter + Zapier (no DNS change)
 *   1. Gmail filter: from:* to:tom@dumbroof.ai subject:(Re:*nurture*) → label "nurture-reply"
 *   2. Zapier zap: trigger "Gmail new email matching search" → action "Webhook POST"
 *      URL: https://www.dumbroof.ai/api/webhooks/nurture-reply
 *      Headers: Authorization: Bearer {NURTURE_INBOUND_SECRET}
 *      Body (JSON): { "from": "{from_email}", "subject": "{subject}", "body": "{body_plain}" }
 *
 * PATH C — Cloudflare Email Workers (if dumbroof.ai DNS is on Cloudflare)
 *   Free, no SaaS dependency. Worker code lives in dumbroof-cf-workers (TBD).
 * ---------------------------------------------------------------------------
 *
 * Expected JSON body (provider-agnostic — any of these fields work):
 *   { from: string, subject?: string, body?: string, text?: string, headers?: object }
 */

interface InboundPayload {
  from?: string;
  subject?: string;
  body?: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
}

function authorize(req: NextRequest): boolean {
  const secret = process.env.NURTURE_INBOUND_SECRET?.trim();
  if (!secret) {
    // If env unset, only allow when localhost (dev/testing).
    const host = req.headers.get("host") || "";
    return host.startsWith("localhost") || host.startsWith("127.0.0.1");
  }
  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}

function extractEmail(raw: string | undefined): string | null {
  if (!raw) return null;
  // Handles "Name <email@example.com>" or bare "email@example.com"
  const match = raw.match(/<([^>]+)>/) || raw.match(/([^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+)/);
  return match?.[1]?.trim().toLowerCase() || null;
}

function guessMatchedTouch(subject: string | undefined): string | null {
  if (!subject) return null;
  const s = subject.toLowerCase();
  // Match against the day-N subject lines from src/lib/nurture/templates.ts
  if (s.includes("60-second first claim") || s.includes("you're in")) return "day_0_welcome";
  if (s.includes("dominic") || s.includes("xpro")) return "day_3_proof";
  if (s.includes("don't have photos") || s.includes("photos yet")) return "day_7_objection";
  if (s.includes("15 min with tom") || s.includes("build your first claim live")) return "day_10_demo_invite";
  if (s.includes("closing your invite") || s.includes("keep")) return "day_14_lastcall";
  return null;
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: InboundPayload;
  try {
    payload = (await req.json()) as InboundPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fromEmail = extractEmail(payload.from);
  if (!fromEmail) {
    return NextResponse.json({ error: "Missing or unparseable 'from' address" }, { status: 400 });
  }

  // Look up user by email via the SECURITY DEFINER RPC (auth.admin.getUserByEmail
  // hits the same broken endpoint as listUsers — see E171).
  const { data: usersData, error: usersErr } = await supabaseAdmin.rpc("list_platform_users");
  if (usersErr) {
    console.error("[nurture-reply] list_platform_users RPC failed:", usersErr.message);
    return NextResponse.json({ error: "User lookup failed" }, { status: 500 });
  }
  type RpcRow = { id: string; email: string | null };
  const user = ((usersData as RpcRow[] | null) || []).find(
    (u) => (u.email || "").toLowerCase() === fromEmail,
  );

  const bodyText = (payload.text || payload.body || payload.html || "").slice(0, 2000);
  const matchedTouch = guessMatchedTouch(payload.subject);

  // Log the reply regardless of whether we found the user — useful for forensics.
  await supabaseAdmin.from("nurture_replies").insert({
    user_id: user?.id ?? null,
    from_email: fromEmail,
    subject: payload.subject ?? null,
    body_excerpt: bodyText,
    raw_payload: payload as unknown as Record<string, unknown>,
    matched_touch: matchedTouch,
    opted_out: !!user,
  });

  // If we matched the user, flip their nurture_opted_out flag.
  let optedOut = false;
  if (user) {
    type Settings = { nurture_opted_out?: boolean } & Record<string, unknown>;
    const { data: profile } = await supabaseAdmin
      .from("company_profiles")
      .select("settings")
      .eq("user_id", user.id)
      .maybeSingle();
    const prevSettings: Settings = (profile?.settings as Settings | null) || {};
    const newSettings: Settings = { ...prevSettings, nurture_opted_out: true };

    if (profile) {
      const { error } = await supabaseAdmin
        .from("company_profiles")
        .update({ settings: newSettings })
        .eq("user_id", user.id);
      if (error) console.error("[nurture-reply] settings update failed:", error.message);
      else optedOut = true;
    } else {
      const { error } = await supabaseAdmin
        .from("company_profiles")
        .insert({ user_id: user.id, email: fromEmail, settings: newSettings });
      if (error) console.error("[nurture-reply] settings stub insert failed:", error.message);
      else optedOut = true;
    }
  }

  // Forward a heads-up to Tom — these replies are high-intent signal.
  try {
    const resend = getResend();
    const matchedLabel = matchedTouch ? ` (replying to <strong>${matchedTouch}</strong>)` : "";
    const userLabel = user ? `<a href="https://www.dumbroof.ai/admin/users/${user.id}">view user</a>` : "<em>(no matching auth.users row)</em>";
    await resend.emails.send({
      from: "DumbRoof Inbound <noreply@dumbroof.ai>",
      to: ["tom@dumbroof.ai"],
      replyTo: fromEmail,
      subject: `[reply] ${payload.subject || "(no subject)"} — from ${fromEmail}`,
      html: `<div style="font-family:-apple-system,sans-serif;max-width:640px;color:#1a1a2e;line-height:1.5;">
  <p><strong>${fromEmail}</strong> just replied${matchedLabel}.</p>
  <p style="color:#6b7280;font-size:13px;">${userLabel} · nurture_opted_out flipped: <strong>${optedOut ? "yes" : "no (user not found)"}</strong></p>
  <p><strong>Subject:</strong> ${payload.subject || "(none)"}</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
  <pre style="white-space:pre-wrap;background:#f9fafb;padding:12px;border-radius:6px;font-size:13px;line-height:1.4;">${bodyText.replace(/</g, "&lt;")}</pre>
  <p style="font-size:12px;color:#9ca3af;margin-top:24px;">Just hit Reply on this email — your reply goes to ${fromEmail} directly.</p>
</div>`,
      tags: [
        { name: "type", value: "inbound-alert" },
        { name: "matched_touch", value: matchedTouch || "unknown" },
      ],
    });
  } catch (err) {
    console.error("[nurture-reply] Tom alert send failed:", err);
  }

  return NextResponse.json({
    ok: true,
    matched_user: !!user,
    matched_touch: matchedTouch,
    opted_out: optedOut,
  });
}
