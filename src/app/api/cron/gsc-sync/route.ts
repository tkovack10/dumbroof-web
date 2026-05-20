/**
 * Daily Google Search Console sync.
 *
 * Pulls yesterday's top 1,000 queries (by impressions) joined with their
 * landing page, and upserts into `gsc_query_snapshots`. We pull
 * `[query, page]` together so a single query targeting multiple pages
 * keeps its per-page CTR/position separate.
 *
 * GSC data has a ~2-3 day lag; we therefore use a configurable lag (default
 * 2 days behind today). Re-running the same day is idempotent — the
 * (snapshot_date, query, page) unique key drives the upsert.
 *
 * Gracefully degrades if `GOOGLE_SERVICE_ACCOUNT_JSON` is absent.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isGscConfigured, searchAnalytics } from "@/lib/gsc/client";
import { recordHeartbeat } from "@/lib/cron-heartbeat";

export const maxDuration = 60;
const HEARTBEAT_NAME = "gsc-sync";
const EXPECTED_INTERVAL = 1440; // daily

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface SnapshotRow {
  snapshot_date: string;
  query: string;
  page: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
  avg_position: number;
}

async function run(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();

  if (!isGscConfigured()) {
    console.warn("[gsc-sync] GOOGLE_SERVICE_ACCOUNT_JSON not configured — skipping run");
    await recordHeartbeat(HEARTBEAT_NAME, EXPECTED_INTERVAL, "skipped", "GOOGLE_SERVICE_ACCOUNT_JSON not set", Date.now() - startedAt);
    return NextResponse.json({ skipped: true, reason: "GOOGLE_SERVICE_ACCOUNT_JSON not set" });
  }

  // Allow ?date=YYYY-MM-DD or ?lag_days=N for backfill / manual runs.
  const url = new URL(req.url);
  const dateOverride = url.searchParams.get("date");
  const lagDays = Number(url.searchParams.get("lag_days") ?? "2");

  let targetDate: string;
  if (dateOverride && /^\d{4}-\d{2}-\d{2}$/.test(dateOverride)) {
    targetDate = dateOverride;
  } else {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - lagDays);
    targetDate = isoDate(d);
  }

  let rows;
  try {
    rows = await searchAnalytics({
      startDate: targetDate,
      endDate: targetDate,
      dimensions: ["query", "page"],
      rowLimit: 1000,
    });
  } catch (err) {
    console.error("[gsc-sync] GSC API failed:", err);
    await recordHeartbeat(HEARTBEAT_NAME, EXPECTED_INTERVAL, "error", `GSC API failed: ${err instanceof Error ? err.message : String(err)}`, Date.now() - startedAt);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }

  if (rows.length === 0) {
    await recordHeartbeat(HEARTBEAT_NAME, EXPECTED_INTERVAL, "ok", `target=${targetDate} rows=0`, Date.now() - startedAt);
    return NextResponse.json({ ok: true, target_date: targetDate, rows: 0 });
  }

  const snapshotRows: SnapshotRow[] = rows.map((r) => ({
    snapshot_date: targetDate,
    query: r.keys[0] ?? "",
    page: r.keys[1] ?? null,
    impressions: Math.round(r.impressions),
    clicks: Math.round(r.clicks),
    ctr: Number(r.ctr.toFixed(4)),
    avg_position: Number(r.position.toFixed(2)),
  }));

  // Upsert in chunks; Supabase REST has a payload size practical limit.
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < snapshotRows.length; i += CHUNK) {
    const chunk = snapshotRows.slice(i, i + CHUNK);
    const { error } = await supabaseAdmin
      .from("gsc_query_snapshots")
      .upsert(chunk, { onConflict: "snapshot_date,query,page" });
    if (error) {
      console.error("[gsc-sync] upsert failed:", error);
      await recordHeartbeat(HEARTBEAT_NAME, EXPECTED_INTERVAL, "error", `upsert failed at row ${written}: ${error.message}`, Date.now() - startedAt);
      return NextResponse.json(
        { ok: false, error: error.message, written },
        { status: 500 }
      );
    }
    written += chunk.length;
  }

  await recordHeartbeat(HEARTBEAT_NAME, EXPECTED_INTERVAL, "ok", `target=${targetDate} fetched=${rows.length} written=${written}`, Date.now() - startedAt);
  return NextResponse.json({
    ok: true,
    target_date: targetDate,
    rows_fetched: rows.length,
    rows_written: written,
  });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
