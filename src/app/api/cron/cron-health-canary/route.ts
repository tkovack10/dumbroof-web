import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend } from "@/lib/resend";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Cron Health Canary.
 *
 * Reads `cron_heartbeats` and alerts when any registered cron's last run is
 * older than 2× its expected interval, OR has 2+ consecutive failures.
 * Writes a row into `agent_recommendations` so the admin UI surfaces it,
 * and emails Tom on first alert (debounced via consecutive_failures field).
 *
 * The richard-health-canary pattern but for the entire cron fleet.
 *
 * Wire-up: each cron calls `recordHeartbeat(name, expectedIntervalMinutes,
 * status, summary, durationMs)` from src/lib/cron-heartbeat.ts at the end
 * of its run. Crons that don't call it never appear in this canary — they
 * need either a heartbeat call or a side-effect health check (TODO).
 *
 * Runs every 15 minutes. See vercel.json.
 */

interface HeartbeatRow {
  cron_name: string;
  last_ran_at: string;
  last_status: "ok" | "error" | "skipped";
  last_duration_ms: number | null;
  last_summary: string | null;
  expected_interval_minutes: number;
  consecutive_failures: number;
}

interface CronAlert {
  cron_name: string;
  reason: "stale" | "failing";
  last_ran_at: string;
  last_status: string;
  last_summary: string | null;
  hours_stale: number;
  expected_interval_minutes: number;
  consecutive_failures: number;
}

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  }
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function GETHandler(req: NextRequest): Promise<NextResponse> {
  if (!authorize(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("cron_heartbeats")
    .select("*");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data || []) as HeartbeatRow[];
  const now = Date.now();
  const alerts: CronAlert[] = [];

  for (const r of rows) {
    const lastRanMs = Date.parse(r.last_ran_at);
    const hoursStale = (now - lastRanMs) / 3_600_000;
    const staleThresholdHours = (r.expected_interval_minutes * 2) / 60;

    if (hoursStale > staleThresholdHours) {
      alerts.push({
        cron_name: r.cron_name,
        reason: "stale",
        last_ran_at: r.last_ran_at,
        last_status: r.last_status,
        last_summary: r.last_summary,
        hours_stale: Math.round(hoursStale * 10) / 10,
        expected_interval_minutes: r.expected_interval_minutes,
        consecutive_failures: r.consecutive_failures,
      });
      continue;
    }
    if (r.consecutive_failures >= 2) {
      alerts.push({
        cron_name: r.cron_name,
        reason: "failing",
        last_ran_at: r.last_ran_at,
        last_status: r.last_status,
        last_summary: r.last_summary,
        hours_stale: Math.round(hoursStale * 10) / 10,
        expected_interval_minutes: r.expected_interval_minutes,
        consecutive_failures: r.consecutive_failures,
      });
    }
  }

  if (alerts.length === 0) {
    return NextResponse.json({
      ok: true,
      checked: rows.length,
      alerts: 0,
    });
  }

  // Write an agent_recommendation so the admin UI surfaces this.
  const summary = alerts
    .map(
      (a) =>
        `${a.cron_name}: ${a.reason} (last ${a.hours_stale}h ago, status=${a.last_status}, fails=${a.consecutive_failures})`,
    )
    .join("\n");

  try {
    await supabaseAdmin.from("agent_recommendations").insert({
      agent: "cron_health_canary",
      target_type: "operations",
      target_path: "cron/health",
      summary: `${alerts.length} cron(s) unhealthy`,
      rationale: summary,
      proposed_diff: "(operational alert — no code diff)",
      evidence: { alerts, checked: rows.length },
      status: "urgent",
    });
  } catch (err) {
    console.error("[cron-health-canary] failed to write agent_recommendation:", err);
  }

  // Email Tom — debounced so we don't spam on every 15-min cycle.
  // Send only when at least one alert has consecutive_failures % 4 === 2
  // (so we alert at failure 2, 6, 10, etc.) OR when staleness just crossed
  // the 12h mark (a once-per-stale-day notification).
  const shouldAlertEmail = alerts.some(
    (a) =>
      (a.reason === "failing" && a.consecutive_failures % 4 === 2) ||
      (a.reason === "stale" && a.hours_stale > 12 && a.hours_stale < 12.5),
  );
  if (shouldAlertEmail) {
    try {
      const resend = getResend();
      const rowsHtml = alerts
        .map(
          (a) =>
            `<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;"><code>${a.cron_name}</code></td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${a.reason}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${a.hours_stale}h</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${a.consecutive_failures}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${a.last_summary || ""}</td></tr>`,
        )
        .join("");
      await resend.emails.send({
        from: "DumbRoof System <noreply@dumbroof.ai>",
        to: ["tom@dumbroof.ai"],
        subject: `[cron-canary] ${alerts.length} unhealthy cron(s)`,
        html: `<div style="font-family:-apple-system,sans-serif;max-width:720px;color:#1a1a2e;line-height:1.5;">
  <h2 style="margin:0 0 12px;">Cron Health Alert</h2>
  <p style="color:#6b7280;font-size:13px;">${alerts.length} of ${rows.length} monitored cron(s) failing or stale.</p>
  <table style="border-collapse:collapse;width:100%;font-size:13px;">
    <thead><tr style="background:#f3f4f6;text-align:left;">
      <th style="padding:8px 12px;">Cron</th><th>Reason</th><th>Stale</th><th>Fails</th><th>Summary</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <p style="margin-top:24px;font-size:13px;"><a href="https://vercel.com/tkovack10s-projects/dumbroof-web/logs">Open Vercel logs &rarr;</a></p>
</div>`,
        tags: [
          { name: "type", value: "cron-canary-alert" },
        ],
      });
    } catch (err) {
      console.error("[cron-health-canary] alert email failed:", err);
    }
  }

  return NextResponse.json({
    ok: false,
    checked: rows.length,
    alerts: alerts.length,
    detail: alerts,
  });
}

export async function GET(req: NextRequest) {
  return GETHandler(req);
}
export async function POST(req: NextRequest) {
  return GETHandler(req);
}
