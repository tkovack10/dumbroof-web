import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend } from "@/lib/resend";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { deriveFirstName } from "@/lib/nurture/templates";
import {
  REPEAT_USAGE_TOUCH_SPECS,
  type RepeatUsageTouchKey,
} from "@/lib/nurture/repeat-usage-templates";
import { personalizeUnsubLinks, listUnsubscribeHeaders } from "@/lib/unsubscribe";

export const maxDuration = 300;

const FROM = "Tom Kovack <tom@dumbroof.ai>";
const REPLY_TO = "tom@dumbroof.ai";
const INTERNAL_DIGEST_RECIPIENT = "tom@dumbroof.ai";

const MS_PER_HOUR = 3_600_000;
/** Anyone whose most-recent claim is older than the last touch window can never qualify. */
const MAX_LOOKBACK_HOURS =
  REPEAT_USAGE_TOUCH_SPECS[REPEAT_USAGE_TOUCH_SPECS.length - 1].windowEndHours;

interface ProfileRow {
  user_id: string;
  email: string | null;
  company_name: string | null;
  contact_name: string | null;
  settings: { nurture_opted_out?: boolean } | null;
}

interface PerTouchResult {
  touch: RepeatUsageTouchKey;
  count_sent: number;
  count_skipped: number;
  errors: Array<{ email: string; error: string }>;
}

interface PlanRow {
  touch: RepeatUsageTouchKey;
  channel: string;
  email: string;
  company: string;
  age_days: number;
}

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  }
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Fetch every claim created within the lookback window and reduce to the
 * most-recent claim timestamp per user. Fetching the FULL window guarantees
 * correctness: any newer claim (which would disqualify the user) is captured
 * too, so the computed max is the true most-recent claim.
 */
async function lastClaimByUser(sinceIso: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("claims")
      .select("user_id, created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("[repeat-usage] claims fetch failed:", error.message);
      break;
    }
    const rows = (data || []) as Array<{ user_id: string | null; created_at: string | null }>;
    for (const r of rows) {
      if (!r.user_id || !r.created_at) continue;
      const prev = out.get(r.user_id);
      // Rows arrive newest-first; first one wins as the most-recent claim.
      if (!prev) out.set(r.user_id, r.created_at);
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Pull company_profiles for these user_ids (email/name/opt-out). */
async function getProfiles(userIds: string[]): Promise<Map<string, ProfileRow>> {
  const out = new Map<string, ProfileRow>();
  const CHUNK = 500;
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin
      .from("company_profiles")
      .select("user_id, email, company_name, contact_name, settings")
      .in("user_id", chunk);
    if (error) {
      console.error("[repeat-usage] company_profiles fetch failed:", error.message);
      continue;
    }
    for (const r of (data || []) as ProfileRow[]) out.set(r.user_id, r);
  }
  return out;
}

/** Existing sends for the candidate set → Set of `${user}|${touch}|${anchorEpoch}`. */
async function getSentKeys(userIds: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  const CHUNK = 500;
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin
      .from("repeat_usage_sends")
      .select("user_id, touch, anchor_claim_at")
      .in("user_id", chunk);
    if (error) {
      console.error("[repeat-usage] sends fetch failed:", error.message);
      continue;
    }
    for (const r of (data || []) as Array<{ user_id: string; touch: string; anchor_claim_at: string }>) {
      set.add(`${r.user_id}|${r.touch}|${Date.parse(r.anchor_claim_at)}`);
    }
  }
  return set;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const now = Date.now();
  const url = new URL(req.url);
  // Dormant by default: only sends when explicitly enabled. ?dryRun=1 forces a
  // no-send preview even when enabled.
  const liveEnabled = process.env.REPEAT_USAGE_ENABLED === "true";
  const dryRun = !liveEnabled || url.searchParams.get("dryRun") === "1";

  const sinceIso = new Date(now - MAX_LOOKBACK_HOURS * MS_PER_HOUR).toISOString();
  const lastClaim = await lastClaimByUser(sinceIso);

  // Candidate = most-recent claim aged into [first touch start, last touch end).
  const minAge = REPEAT_USAGE_TOUCH_SPECS[0].windowStartHours;
  const candidateIds: string[] = [];
  for (const [userId, claimIso] of lastClaim) {
    const ageHours = (now - Date.parse(claimIso)) / MS_PER_HOUR;
    if (ageHours >= minAge && ageHours < MAX_LOOKBACK_HOURS) candidateIds.push(userId);
  }

  if (candidateIds.length === 0) {
    const elapsedMs = Date.now() - startedAt;
    await recordHeartbeat("repeat-usage", 1440, "ok", "no candidates in window", elapsedMs);
    return NextResponse.json({ ok: true, dry_run: dryRun, candidates: 0, touches: [] });
  }

  const [profiles, sentKeys] = await Promise.all([
    getProfiles(candidateIds),
    getSentKeys(candidateIds),
  ]);

  const resend = getResend();
  const results: PerTouchResult[] = [];
  const plan: PlanRow[] = [];

  for (const spec of REPEAT_USAGE_TOUCH_SPECS) {
    const r: PerTouchResult = { touch: spec.key, count_sent: 0, count_skipped: 0, errors: [] };

    for (const userId of candidateIds) {
      const claimIso = lastClaim.get(userId)!;
      const ageHours = (now - Date.parse(claimIso)) / MS_PER_HOUR;
      if (ageHours < spec.windowStartHours || ageHours >= spec.windowEndHours) continue;

      const profile = profiles.get(userId);
      const recipientEmail = profile?.email || null;
      if (!recipientEmail) { r.count_skipped++; continue; }
      if (profile?.settings?.nurture_opted_out) { r.count_skipped++; continue; }

      const dedupKey = `${userId}|${spec.key}|${Date.parse(claimIso)}`;
      if (sentKeys.has(dedupKey)) { r.count_skipped++; continue; }

      const firstName = deriveFirstName({ contact_name: profile?.contact_name, email: recipientEmail });
      const companyName = (profile?.company_name || "").trim();
      const input = { first_name: firstName, company_name: companyName, email: recipientEmail };

      if (dryRun) {
        plan.push({
          touch: spec.key,
          channel: spec.channel,
          email: recipientEmail,
          company: companyName || "(no company)",
          age_days: Math.round(ageHours / 24),
        });
        r.count_sent++; // "would send"
        continue;
      }

      const built = spec.build(input);
      const subject = built.subject;
      const unsub = { uid: userId, e: recipientEmail };
      const html = personalizeUnsubLinks(built.html, unsub);
      try {
        const { data: sent, error: sendErr } = await resend.emails.send({
          from: FROM,
          to: [recipientEmail],
          replyTo: REPLY_TO,
          subject,
          html,
          headers: listUnsubscribeHeaders(unsub),
          tags: [
            { name: "type", value: "repeat-usage" },
            { name: "touch", value: spec.key },
            // NOTE: spec.channel "sms" touches render as interim email until Phase 3 (Twilio/10DLC).
            { name: "channel", value: spec.channel },
          ],
        });
        if (sendErr) { r.errors.push({ email: recipientEmail, error: sendErr.message }); continue; }

        const { error: recErr } = await supabaseAdmin
          .from("repeat_usage_sends")
          .insert({
            user_id: userId,
            touch: spec.key,
            anchor_claim_at: claimIso,
            channel: spec.channel,
            email_id: sent?.id,
          });
        if (recErr) {
          if (recErr.code === "23505") { r.count_skipped++; continue; } // parallel run already sent
          console.error(`[repeat-usage] record failed ${spec.key} ${recipientEmail}:`, recErr.message);
        }
        sentKeys.add(dedupKey);
        r.count_sent++;
      } catch (err) {
        r.errors.push({ email: recipientEmail, error: String(err) });
      }
    }

    results.push(r);
  }

  const totalSent = results.reduce((a, r) => a + r.count_sent, 0);
  const totalErrors = results.reduce((a, r) => a + r.errors.length, 0);

  // Internal digest to Tom (skipped in dry-run — the JSON response carries the plan).
  if (!dryRun && (totalSent > 0 || totalErrors > 0)) {
    try {
      const rows = results
        .map((r) => `<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${r.touch}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${r.count_sent}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${r.count_skipped}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:${r.errors.length ? "#dc2626" : "#6b7280"};">${r.errors.length}</td></tr>`)
        .join("");
      const errorList = results
        .flatMap((r) => r.errors.map((e) => `<li><strong>${r.touch}</strong> → ${e.email}: <code>${e.error}</code></li>`))
        .join("");
      const elapsedMs = Date.now() - startedAt;
      const digestHtml = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:680px;color:#1a1a2e;line-height:1.5;">
  <h2 style="margin:0 0 12px;">Repeat-usage drip — daily digest</h2>
  <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">Run completed in ${elapsedMs}ms · ${totalSent} sent · ${totalErrors} errors · ${candidateIds.length} candidates</p>
  <table style="border-collapse:collapse;width:100%;font-size:14px;">
    <thead><tr style="background:#f3f4f6;text-align:left;"><th style="padding:8px 12px;">Touch</th><th style="padding:8px 12px;text-align:right;">Sent</th><th style="padding:8px 12px;text-align:right;">Skipped</th><th style="padding:8px 12px;text-align:right;">Errors</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${errorList ? `<h3 style="margin:24px 0 8px;font-size:14px;color:#dc2626;">Errors</h3><ul style="margin:0;padding-left:20px;font-size:13px;">${errorList}</ul>` : ""}
</div>`;
      await resend.emails.send({
        from: FROM,
        to: [INTERNAL_DIGEST_RECIPIENT],
        replyTo: REPLY_TO,
        subject: `[repeat-usage] ${totalSent} sent, ${totalErrors} errors`,
        html: digestHtml,
        tags: [{ name: "type", value: "internal-digest" }, { name: "cron", value: "repeat-usage" }],
      });
    } catch (digestErr) {
      console.error("[repeat-usage] internal digest send failed:", digestErr);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  await recordHeartbeat(
    "repeat-usage",
    1440,
    totalErrors > 0 && totalSent === 0 ? "error" : "ok",
    `dry_run=${dryRun}, ${dryRun ? "would_send" : "sent"}=${totalSent}, errors=${totalErrors}, candidates=${candidateIds.length}`,
    elapsedMs,
  );

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    elapsed_ms: elapsedMs,
    candidates: candidateIds.length,
    [dryRun ? "would_send" : "total_sent"]: totalSent,
    total_errors: totalErrors,
    touches: results,
    ...(dryRun ? { plan } : {}),
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
