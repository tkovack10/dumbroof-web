/**
 * AccuLynx company-calendar → DumbRoof Production sync.
 *
 * Uses the AccuLynx public v2 API (Bearer token, fully headless — no browser /
 * stored session):
 *   GET /calendars                                      → list location calendars
 *   GET /calendars/{id}/appointments?startDate&endDate  → events (range ≤ 90 days)
 *
 * IMPORTANT (verified against USARM's live calendar, 2026-06-01): USARM does NOT
 * use AccuLynx's structured Production module. Roof installs are entered as plain
 * all-day appointments on the "Location Calendar" whose TITLE is the property
 * address + scope, e.g. "16 willard st greene ny 30 sq evergreen mist". So:
 *   - install detection is a TITLE-ADDRESS heuristic, NOT eventType='Labor Order'
 *     (these events are eventType='Personal'), and
 *   - the address usually lives in `title`, not the `location` field, and `jobId`
 *     is often empty → we pair by ADDRESS (Tom: address is the primary identifier).
 *
 * Matched installs upsert a production_schedules row (origin='acculynx') so they
 * render on the Production calendar and clear the claim from the "needs install"
 * bucket. Unmatched installs stay in acculynx_calendar_events (the "Unlinked
 * installs" panel) for one-click linking.
 *
 * Reusable by the daily cron (/api/cron/acculynx-calendar-sync) and the
 * admin-triggered endpoint (/api/integrations/acculynx/sync-calendar).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAddressIndex,
  matchAddress,
  normalizeAddress,
  parseAddr,
  type AddressIndex,
} from "@/lib/matching/address-match";

const ACCULYNX_BASE = "https://api.acculynx.com/api/v2";
const PAGE_SIZE = 25; // AccuLynx hard max page size
const API_WINDOW_DAYS = 90; // appointments request range limit
const API_DELAY_MS = 300; // recommended rate-limit spacing

// Structured order types are treated as installs too, on the chance a company DOES
// use them — but the primary signal is the title-address heuristic.
const STRUCTURED_INSTALL_TYPES = new Set(["Labor Order", "Material Order"]);

export interface CalendarSyncResult {
  company_id: string;
  calendars: number;
  events_seen: number;
  events_upserted: number;
  matched: number;
  unmatched: number;
  schedules_upserted: number;
  errors: string[];
}

interface AccuLynxCalendar {
  id: string;
  name: string;
}

interface AccuLynxEvent {
  id: string;
  title?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  jobId?: string;
  jobName?: string;
  location?: string;
  notes?: string;
  eventType?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The install address for an event. USARM enters installs as appointments whose
 *  TITLE is the property address (+ scope), e.g. "16 willard st greene ny 30 sq".
 *  Meetings / inspections / sales appts instead carry a DESCRIPTION title (e.g.
 *  "Pre con meeting", "Adjuster meeting", a person's name) plus the site in the
 *  `location` field — so we classify on the TITLE to avoid pulling those non-install
 *  site appointments onto the install board. Structured Labor/Material orders, if a
 *  company uses them, may instead carry the address in `location`. */
function installAddress(ev: AccuLynxEvent): string | null {
  if (parseAddr(ev.title)) return ev.title as string;
  if (ev.eventType && STRUCTURED_INSTALL_TYPES.has(ev.eventType) && parseAddr(ev.location)) {
    return ev.location as string;
  }
  return null;
}

/** Is this a roof install? (Its title is a street address, or it's a structured order.) */
function isInstallEvent(ev: AccuLynxEvent): boolean {
  return installAddress(ev) !== null;
}

async function accuFetch<T>(apiKey: string, path: string): Promise<T> {
  const res = await fetch(`${ACCULYNX_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AccuLynx ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function listCalendars(apiKey: string): Promise<AccuLynxCalendar[]> {
  const out: AccuLynxCalendar[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const body = await accuFetch<{ count?: number; items?: AccuLynxCalendar[] }>(
      apiKey,
      `/calendars?pageSize=${PAGE_SIZE}&recordStartIndex=${start}`
    );
    const items = body.items || [];
    out.push(...items);
    if (items.length < PAGE_SIZE || out.length >= (body.count ?? out.length)) break;
    await sleep(API_DELAY_MS);
  }
  return out;
}

async function listAppointments(
  apiKey: string,
  calendarId: string,
  startDate: string,
  endDate: string
): Promise<AccuLynxEvent[]> {
  const out: AccuLynxEvent[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const body = await accuFetch<{ count?: number; items?: AccuLynxEvent[] }>(
      apiKey,
      `/calendars/${calendarId}/appointments?startDate=${startDate}&endDate=${endDate}&pageSize=${PAGE_SIZE}&pageStartIndex=${start}`
    );
    const items = body.items || [];
    out.push(...items);
    if (items.length < PAGE_SIZE || out.length >= (body.count ?? out.length)) break;
    await sleep(API_DELAY_MS);
  }
  return out;
}

/** Split [from, to] into ≤90-day [startDate, endDate] windows (YYYY-MM-DD). */
function dateWindows(from: Date, to: Date): Array<{ startDate: string; endDate: string }> {
  const windows: Array<{ startDate: string; endDate: string }> = [];
  const cursor = new Date(from);
  while (cursor < to) {
    const end = new Date(Math.min(cursor.getTime() + (API_WINDOW_DAYS - 1) * 86_400_000, to.getTime()));
    windows.push({ startDate: cursor.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) });
    cursor.setTime(end.getTime() + 86_400_000);
  }
  return windows;
}

/**
 * Sync one company's AccuLynx calendar into DumbRoof.
 *
 * @param supabase  service-role client (bypasses RLS)
 * @param companyId company to sync
 * @param apiKey    that company's AccuLynx API key
 */
export async function syncCompanyCalendar(
  supabase: SupabaseClient,
  companyId: string,
  apiKey: string,
  opts: { lookbackDays?: number; lookaheadDays?: number; nowMs?: number } = {}
): Promise<CalendarSyncResult> {
  const result: CalendarSyncResult = {
    company_id: companyId,
    calendars: 0,
    events_seen: 0,
    events_upserted: 0,
    matched: 0,
    unmatched: 0,
    schedules_upserted: 0,
    errors: [],
  };

  const nowMs = opts.nowMs ?? Date.now();
  const from = new Date(nowMs - (opts.lookbackDays ?? 60) * 86_400_000);
  const to = new Date(nowMs + (opts.lookaheadDays ?? 150) * 86_400_000);
  const windows = dateWindows(from, to);

  // 1. Calendars
  let calendars: AccuLynxCalendar[];
  try {
    calendars = await listCalendars(apiKey);
  } catch (e) {
    result.errors.push(`listCalendars: ${e instanceof Error ? e.message : e}`);
    return result;
  }
  result.calendars = calendars.length;

  // 2. Gather install events across all calendars + windows (dedupe by event id).
  const eventsById = new Map<string, AccuLynxEvent & { calendarId: string; calendarName: string }>();
  for (const cal of calendars) {
    for (const w of windows) {
      try {
        const appts = await listAppointments(apiKey, cal.id, w.startDate, w.endDate);
        for (const ev of appts) {
          if (!ev.id || !isInstallEvent(ev)) continue;
          eventsById.set(ev.id, { ...ev, calendarId: cal.id, calendarName: cal.name });
        }
      } catch (e) {
        result.errors.push(`appts ${cal.name} ${w.startDate}: ${e instanceof Error ? e.message : e}`);
      }
      await sleep(API_DELAY_MS);
    }
  }
  const events = [...eventsById.values()];
  result.events_seen = events.length;
  if (events.length === 0) return result;

  // 3. Load company claims and index by address (the canonical pairing key).
  const { data: claimRows, error: claimErr } = await supabase
    .from("claims")
    .select("id, address")
    .eq("company_id", companyId)
    .limit(5000);
  if (claimErr) {
    result.errors.push(`claims load: ${claimErr.message}`);
    return result;
  }
  const idx: AddressIndex = buildAddressIndex(
    ((claimRows as Array<{ id: string; address: string | null }>) || []).filter(Boolean)
  );

  // 4. Upsert each event + match by address + (for matches) a production schedule.
  for (const ev of events) {
    const addr = installAddress(ev) ?? ev.title ?? "";
    const match = matchAddress(addr, idx);
    const matchedClaimId = match?.id ?? null;
    if (matchedClaimId) result.matched++;
    else result.unmatched++;

    const { data: upserted, error: upErr } = await supabase
      .from("acculynx_calendar_events")
      .upsert(
        {
          company_id: companyId,
          acculynx_event_id: ev.id,
          calendar_id: ev.calendarId,
          calendar_name: ev.calendarName,
          job_id: ev.jobId ?? null,
          job_name: ev.jobName ?? null,
          title: ev.title ?? null,
          location: ev.location ?? null,
          address_norm: normalizeAddress(addr) || null,
          notes: ev.notes ?? null,
          event_type: ev.eventType ?? null,
          is_production: true, // only install events are stored
          starts_at: ev.start ?? null,
          ends_at: ev.end ?? null,
          all_day: !!ev.allDay,
          matched_claim_id: matchedClaimId,
          match_method: match?.method ?? null,
          raw: ev,
          synced_at: new Date(nowMs).toISOString(),
        },
        { onConflict: "company_id,acculynx_event_id" }
      )
      .select("id, production_schedule_id")
      .maybeSingle();
    if (upErr) {
      result.errors.push(`event upsert ${ev.id}: ${upErr.message}`);
      continue;
    }
    result.events_upserted++;

    // Matched install with a start time → upsert a production_schedules row.
    if (matchedClaimId && ev.start) {
      const { data: existing } = await supabase
        .from("production_schedules")
        .select("id, status")
        .eq("company_id", companyId)
        .eq("acculynx_event_id", ev.id)
        .maybeSingle();

      let scheduleId: string | null = existing?.id ?? null;
      if (existing) {
        // Don't resurrect a manually cancelled/completed schedule; just keep dates fresh.
        if (existing.status === "scheduled") {
          const { error: updErr } = await supabase
            .from("production_schedules")
            .update({ scheduled_at: ev.start, end_at: ev.end ?? null })
            .eq("id", existing.id);
          if (updErr) result.errors.push(`sched update ${ev.id}: ${updErr.message}`);
          else result.schedules_upserted++;
        }
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from("production_schedules")
          .insert({
            claim_id: matchedClaimId,
            company_id: companyId,
            scheduled_at: ev.start,
            end_at: ev.end ?? null,
            origin: "acculynx",
            acculynx_event_id: ev.id,
            notify_homeowner: false, // AccuLynx-sourced — don't auto-email the homeowner
            notes: ev.title || ev.jobName || null,
          })
          .select("id")
          .maybeSingle();
        if (insErr) result.errors.push(`sched insert ${ev.id}: ${insErr.message}`);
        else {
          scheduleId = inserted?.id ?? null;
          result.schedules_upserted++;
        }
      }

      if (scheduleId && upserted?.id && upserted.production_schedule_id !== scheduleId) {
        await supabase
          .from("acculynx_calendar_events")
          .update({ production_schedule_id: scheduleId })
          .eq("id", upserted.id);
      }
    }
  }

  return result;
}

/** All companies that have an AccuLynx API key (the cron's working set). */
export async function getAccuLynxCompanies(
  supabase: SupabaseClient
): Promise<Array<{ company_id: string; api_key: string }>> {
  const { data, error } = await supabase
    .from("company_profiles")
    .select("company_id, acculynx_api_key")
    .not("acculynx_api_key", "is", null)
    .not("company_id", "is", null);
  if (error) throw new Error(error.message);
  const byCompany = new Map<string, string>();
  for (const r of (data as Array<{ company_id: string; acculynx_api_key: string }>) || []) {
    if (r.company_id && r.acculynx_api_key && !byCompany.has(r.company_id)) {
      byCompany.set(r.company_id, r.acculynx_api_key);
    }
  }
  return [...byCompany.entries()].map(([company_id, api_key]) => ({ company_id, api_key }));
}
