/**
 * Storm-alert cron (Track B). Reads recent `storm_events`, matches past users to
 * each event by region (event state + adjacent states), and sends ONE alert per
 * user per run — the most significant nearby event — respecting a 5-day per-user
 * throttle. Email from tom@dumbroof.ai (Richard/Tom voice).
 *
 * Dormant by default: only sends when STORM_ALERTS_ENABLED=true. ?dryRun=1
 * returns a no-send plan (who would get what) for review.
 *
 * "Past user" = a contractor who has created >=1 claim. No age cap — even users
 * the calendar drip has aged out of get storm alerts (that's the whole point).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend } from "@/lib/resend";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { deriveFirstName } from "@/lib/nurture/templates";
import { stormRadius } from "@/lib/storm/state-adjacency";
import { parseState } from "@/lib/storm/location";
import { buildStormEmail } from "@/lib/nurture/repeat-usage-storm-templates";

export const maxDuration = 300;

const FROM = "Tom Kovack <tom@dumbroof.ai>";
const REPLY_TO = "tom@dumbroof.ai";
const INTERNAL_DIGEST_RECIPIENT = "tom@dumbroof.ai";

const MS_DAY = 86_400_000;
/** How far back to consider freshly-ingested events worth alerting on. */
const EVENT_LOOKBACK_DAYS = 3;
/** Per-user throttle: at most one storm alert per this many days. */
const THROTTLE_DAYS = 5;

interface StormEventRow {
  id: string;
  event_type: "hail" | "wind";
  event_date: string;
  state: string;
  county: string;
  magnitude: number;
}

interface ProfileRow {
  user_id: string;
  email: string | null;
  contact_name: string | null;
  city_state_zip: string | null;
  address: string | null;
  settings: { nurture_opted_out?: boolean } | null;
}

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Distinct user_ids that have ever created a claim. */
async function getClaimOwnerIds(): Promise<string[]> {
  const ids = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("claims")
      .select("user_id")
      .not("user_id", "is", null)
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("[storm-alerts] claims fetch failed:", error.message);
      break;
    }
    const rows = (data || []) as Array<{ user_id: string }>;
    for (const r of rows) ids.add(r.user_id);
    if (rows.length < PAGE) break;
  }
  return [...ids];
}

async function getProfiles(userIds: string[]): Promise<Map<string, ProfileRow>> {
  const out = new Map<string, ProfileRow>();
  const CHUNK = 500;
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin
      .from("company_profiles")
      .select("user_id, email, contact_name, city_state_zip, address, settings")
      .in("user_id", chunk);
    if (error) {
      console.error("[storm-alerts] profiles fetch failed:", error.message);
      continue;
    }
    for (const r of (data || []) as ProfileRow[]) out.set(r.user_id, r);
  }
  return out;
}

/** Most-recent storm-alert timestamp per user (for the throttle). */
async function getLastAlertAt(userIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const sinceIso = new Date(Date.now() - THROTTLE_DAYS * MS_DAY).toISOString();
  const CHUNK = 500;
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin
      .from("storm_alert_sends")
      .select("user_id, sent_at")
      .in("user_id", chunk)
      .gte("sent_at", sinceIso);
    if (error) {
      console.error("[storm-alerts] throttle fetch failed:", error.message);
      continue;
    }
    for (const r of (data || []) as Array<{ user_id: string; sent_at: string }>) {
      const t = Date.parse(r.sent_at);
      const prev = out.get(r.user_id) ?? 0;
      if (t > prev) out.set(r.user_id, t);
    }
  }
  return out;
}

/** A storm "weight" so we can pick the single most significant nearby event per user. */
function severity(e: StormEventRow): number {
  // Normalize hail (inches) and wind (mph) onto a comparable scale; weight by how
  // far each exceeds its gate. Hail tends to drive more roof claims, so nudge it up.
  return e.event_type === "hail" ? (e.magnitude / 1.0) * 1.5 : e.magnitude / 58;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorize(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const startedAt = Date.now();
  const url = new URL(req.url);
  const liveEnabled = process.env.STORM_ALERTS_ENABLED === "true";
  const dryRun = !liveEnabled || url.searchParams.get("dryRun") === "1";

  // 1) Recent events worth alerting on.
  const sinceDate = new Date(Date.now() - EVENT_LOOKBACK_DAYS * MS_DAY).toISOString().slice(0, 10);
  const { data: evData, error: evErr } = await supabaseAdmin
    .from("storm_events")
    .select("id, event_type, event_date, state, county, magnitude")
    .gte("event_date", sinceDate);
  if (evErr) {
    await recordHeartbeat("storm-alerts", 1440, "error", `events fetch: ${evErr.message}`, Date.now() - startedAt);
    return NextResponse.json({ error: evErr.message }, { status: 500 });
  }
  const events = (evData || []) as StormEventRow[];
  if (events.length === 0) {
    await recordHeartbeat("storm-alerts", 1440, "ok", "no recent storm events", Date.now() - startedAt);
    return NextResponse.json({ ok: true, dry_run: dryRun, events: 0, would_send: 0 });
  }

  // 2) For each state, the single highest-severity event affecting it (own + adjacent).
  //    Map: affectedState -> headline event.
  const headlineByState = new Map<string, StormEventRow>();
  for (const e of events) {
    for (const st of stormRadius(e.state)) {
      const cur = headlineByState.get(st);
      if (!cur || severity(e) > severity(cur)) headlineByState.set(st, e);
    }
  }

  // 3) Past users + profiles + throttle state.
  const ownerIds = await getClaimOwnerIds();
  if (ownerIds.length === 0) {
    await recordHeartbeat("storm-alerts", 1440, "ok", "no claim owners", Date.now() - startedAt);
    return NextResponse.json({ ok: true, dry_run: dryRun, events: events.length, would_send: 0 });
  }
  const [profiles, lastAlert] = await Promise.all([getProfiles(ownerIds), getLastAlertAt(ownerIds)]);

  const resend = getResend();
  const now = Date.now();
  let sent = 0;
  let skippedNoState = 0;
  let skippedNoEvent = 0;
  let skippedThrottle = 0;
  let skippedOptOut = 0;
  let errors = 0;
  const plan: Array<{ email: string; state: string; type: string; magnitude: number; county: string }> = [];

  for (const userId of ownerIds) {
    const profile = profiles.get(userId);
    const email = profile?.email;
    if (!email) { skippedNoState++; continue; }
    if (profile?.settings?.nurture_opted_out) { skippedOptOut++; continue; }

    const userState = parseState(profile?.city_state_zip, profile?.address);
    if (!userState) { skippedNoState++; continue; }

    const headline = headlineByState.get(userState);
    if (!headline) { skippedNoEvent++; continue; }

    const last = lastAlert.get(userId) ?? 0;
    if (now - last < THROTTLE_DAYS * MS_DAY) { skippedThrottle++; continue; }

    const firstName = deriveFirstName({ contact_name: profile?.contact_name, email });
    const humanDate = new Date(`${headline.event_date}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short", day: "numeric", timeZone: "UTC",
    });

    if (dryRun) {
      plan.push({ email, state: userState, type: headline.event_type, magnitude: headline.magnitude, county: headline.county });
      sent++; // "would send"
      // Reserve the throttle slot in-memory so dry-run counts mirror live behavior.
      lastAlert.set(userId, now);
      continue;
    }

    const { subject, html } = buildStormEmail(headline.event_type, {
      first_name: firstName,
      state: headline.state,
      county: headline.county,
      magnitude: headline.magnitude,
      date: humanDate,
    });

    try {
      const { data: sentRes, error: sendErr } = await resend.emails.send({
        from: FROM,
        to: [email],
        replyTo: REPLY_TO,
        subject,
        html,
        tags: [
          { name: "type", value: "storm-alert" },
          { name: "storm_type", value: headline.event_type },
        ],
      });
      if (sendErr) { errors++; console.error(`[storm-alerts] send failed ${email}:`, sendErr.message); continue; }

      const { error: recErr } = await supabaseAdmin
        .from("storm_alert_sends")
        .insert({ user_id: userId, storm_event_id: headline.id, channel: "email", email_id: sentRes?.id });
      if (recErr && recErr.code !== "23505") {
        console.error(`[storm-alerts] record failed ${email}:`, recErr.message);
      }
      lastAlert.set(userId, now);
      sent++;
    } catch (e) {
      errors++;
      console.error(`[storm-alerts] exception ${email}:`, e);
    }
  }

  // Internal digest to Tom (live runs only).
  if (!dryRun && (sent > 0 || errors > 0)) {
    try {
      await resend.emails.send({
        from: FROM,
        to: [INTERNAL_DIGEST_RECIPIENT],
        replyTo: REPLY_TO,
        subject: `[storm-alerts] ${sent} sent, ${errors} errors`,
        html: `<div style="font-family:-apple-system,sans-serif;max-width:600px;color:#1a1a2e;">
  <h2 style="margin:0 0 12px;">Storm-alert run</h2>
  <p style="color:#6b7280;font-size:13px;">${events.length} recent events · ${sent} sent · ${errors} errors · throttled ${skippedThrottle} · no-region ${skippedNoState} · no-event-nearby ${skippedNoEvent} · opted-out ${skippedOptOut}</p>
</div>`,
        tags: [{ name: "type", value: "internal-digest" }, { name: "cron", value: "storm-alerts" }],
      });
    } catch (e) {
      console.error("[storm-alerts] digest failed:", e);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  await recordHeartbeat(
    "storm-alerts",
    1440,
    errors > 0 && sent === 0 ? "error" : "ok",
    `dry_run=${dryRun} ${dryRun ? "would_send" : "sent"}=${sent} events=${events.length} throttled=${skippedThrottle} no_region=${skippedNoState} no_event=${skippedNoEvent} opt_out=${skippedOptOut} errors=${errors}`,
    elapsedMs,
  );

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    elapsed_ms: elapsedMs,
    events: events.length,
    affected_states: headlineByState.size,
    claim_owners: ownerIds.length,
    [dryRun ? "would_send" : "sent"]: sent,
    skipped: { throttle: skippedThrottle, no_region: skippedNoState, no_event_nearby: skippedNoEvent, opt_out: skippedOptOut },
    errors,
    ...(dryRun ? { plan: plan.slice(0, 100) } : {}),
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
