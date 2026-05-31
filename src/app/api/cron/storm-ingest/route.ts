/**
 * Daily NOAA SPC storm ingest — pulls yesterday's hail + wind reports at/above
 * our severity gates into `storm_events`. Pure data, no user contact, so this
 * cron is NOT gated by a feature flag: storm history accumulates immediately and
 * the storm-alerts cron (which IS gated) reads from it.
 *
 * Idempotent: upsert on event_key, so re-runs the same day are no-ops.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import {
  fetchSpcReports,
  stormEventKey,
  type StormReport,
  type StormType,
} from "@/lib/storm/noaa-spc";

export const maxDuration = 120;

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** SPC "yesterday" file covers yesterday's UTC convective day. */
function yesterdayUtc(now: number): string {
  return new Date(now - 24 * 3600 * 1000).toISOString().slice(0, 10);
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorize(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const startedAt = Date.now();
  const eventDate = yesterdayUtc(startedAt);
  const counts = { hail: 0, wind: 0, inserted: 0, skipped: 0 };
  const errors: string[] = [];

  for (const type of ["hail", "wind"] as StormType[]) {
    let reports: StormReport[] = [];
    try {
      reports = await fetchSpcReports(type, "yesterday");
    } catch (e) {
      errors.push(`fetch ${type}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    counts[type] = reports.length;
    if (reports.length === 0) continue;

    const rows = reports.map((r) => ({
      event_key: stormEventKey(r, eventDate),
      event_type: r.type,
      event_date: eventDate,
      state: r.state,
      county: r.county,
      location: r.location,
      magnitude: r.magnitude,
      magnitude_raw: r.magnitudeRaw,
      lat: r.lat,
      lon: r.lon,
      source: "spc",
    }));

    const { data, error } = await supabaseAdmin
      .from("storm_events")
      .upsert(rows, { onConflict: "event_key", ignoreDuplicates: true })
      .select("id");
    if (error) {
      errors.push(`upsert ${type}: ${error.message}`);
      continue;
    }
    const inserted = data?.length ?? 0;
    counts.inserted += inserted;
    counts.skipped += rows.length - inserted;
  }

  const elapsedMs = Date.now() - startedAt;
  const status = errors.length && counts.inserted === 0 ? "error" : "ok";
  await recordHeartbeat(
    "storm-ingest",
    1440,
    status,
    `date=${eventDate} hail=${counts.hail} wind=${counts.wind} inserted=${counts.inserted} skipped=${counts.skipped} errors=${errors.length}`,
    elapsedMs,
  );

  return NextResponse.json({ ok: errors.length === 0, event_date: eventDate, ...counts, errors });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
