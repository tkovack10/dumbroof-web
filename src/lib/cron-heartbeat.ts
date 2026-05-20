import type { NextRequest, NextResponse } from "next/server";
import { NextResponse as NR } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Self-reporting cron heartbeat. Crons call this at the END of every run.
 * The cron-health-canary route reads `cron_heartbeats` and alerts if any
 * cron's `last_ran_at` is older than 2× its `expected_interval_minutes`.
 *
 * Upserts by cron_name (primary key). Never throws — heartbeat failures
 * must not break the calling cron. The canary will catch the gap.
 *
 * @param name e.g. "nurture-sequence" — match the cron route folder name
 * @param expectedIntervalMinutes how often this cron is supposed to run
 *   (e.g. 1440 for daily, 60 for hourly). Canary alerts at 2× this gap.
 * @param status "ok" | "error" | "skipped"
 * @param summary short human-readable summary written into the row
 * @param durationMs total run duration for trend tracking
 */
export async function recordHeartbeat(
  name: string,
  expectedIntervalMinutes: number,
  status: "ok" | "error" | "skipped" = "ok",
  summary?: string,
  durationMs?: number,
): Promise<void> {
  try {
    // Read prior row so we can roll consecutive_failures correctly.
    const { data: prior } = await supabaseAdmin
      .from("cron_heartbeats")
      .select("consecutive_failures")
      .eq("cron_name", name)
      .maybeSingle();

    const priorFailures = (prior as { consecutive_failures?: number } | null)?.consecutive_failures ?? 0;
    const consecutive_failures =
      status === "error" ? priorFailures + 1 : 0;

    await supabaseAdmin.from("cron_heartbeats").upsert(
      {
        cron_name: name,
        last_ran_at: new Date().toISOString(),
        last_status: status,
        last_duration_ms: durationMs ?? null,
        last_summary: summary ?? null,
        expected_interval_minutes: expectedIntervalMinutes,
        consecutive_failures,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "cron_name" },
    );
  } catch (err) {
    // Heartbeat failures must not break the calling cron.
    console.warn(`[cron-heartbeat] write failed for ${name}:`, err);
  }
}

/**
 * Wrapper for cron route handlers. Inspects the handler's NextResponse
 * status + body to derive the heartbeat status automatically:
 *   - HTTP 401 → no heartbeat (not a real run, just rejected auth)
 *   - HTTP 5xx → error
 *   - body.skipped === true → skipped
 *   - otherwise → ok
 *
 * Crons usage:
 *   export async function GET(req: NextRequest) {
 *     return withHeartbeat("my-cron", 1440, req, handle);
 *   }
 */
export async function withHeartbeat(
  name: string,
  expectedIntervalMinutes: number,
  req: NextRequest,
  handler: (req: NextRequest) => Promise<NextResponse>,
): Promise<NextResponse> {
  const startedAt = Date.now();
  let res: NextResponse;
  let status: "ok" | "error" | "skipped" = "ok";
  let summary = "";
  try {
    res = await handler(req);
    if (res.status === 401) {
      // Auth rejection — not a real run, don't heartbeat.
      return res;
    }
    if (res.status >= 500) {
      status = "error";
      summary = `HTTP ${res.status}`;
    } else if (res.status >= 400) {
      // 4xx is unusual but not a cron-health concern — record but mark error.
      status = "error";
      summary = `HTTP ${res.status}`;
    } else {
      try {
        const cloned = res.clone();
        const body = (await cloned.json()) as Record<string, unknown>;
        if (body.skipped === true) status = "skipped";
        summary = JSON.stringify(body).slice(0, 250);
      } catch {
        summary = `HTTP ${res.status}`;
      }
    }
  } catch (err) {
    status = "error";
    summary = `threw: ${err instanceof Error ? err.message : String(err)}`.slice(0, 250);
    res = NR.json({ error: String(err) }, { status: 500 });
  }
  await recordHeartbeat(name, expectedIntervalMinutes, status, summary, Date.now() - startedAt);
  return res;
}
