import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend, EMAIL_FROM, EMAIL_REPLY_TO } from "@/lib/resend";
import { gatherSupabase } from "@/lib/funnel-monitor/sources/supabase";
import { gatherResend } from "@/lib/funnel-monitor/sources/resend";
import { gatherStripe } from "@/lib/funnel-monitor/sources/stripe";
import { gatherVercelAnalytics } from "@/lib/funnel-monitor/sources/vercel-analytics";
import { gatherGA4 } from "@/lib/funnel-monitor/sources/ga4";
import { gatherMetaAds } from "@/lib/funnel-monitor/sources/meta-ads";
import { gatherRailwayHealth } from "@/lib/funnel-monitor/sources/railway";
import { generateAiInsight } from "@/lib/funnel-monitor/ai-insight";
import { renderReportHtml } from "@/lib/funnel-monitor/render-html";
import type { FunnelReport, Anomaly } from "@/lib/funnel-monitor/types";

/**
 * Twice-Daily Funnel Monitor — Vercel Cron at 9am and 5pm ET.
 *
 * Configured in vercel.json (`"schedule": "0 13,21 * * *"` UTC).
 *
 * Gathers data from every source (Supabase, Resend, Stripe, Vercel Analytics,
 * Meta Ads, Railway, optional GA4) since the last run, computes anomalies,
 * gets an AI insight from Claude, renders an HTML email, sends it to the
 * team via Resend, and logs the run to `funnel_monitor_runs`.
 *
 * Auth: requires Authorization header `Bearer ${CRON_SECRET}` matching the
 * env var. Vercel Cron sends this automatically. Manual invocations need
 * to set the header explicitly.
 *
 * On-demand trigger:
 *   curl -X POST https://www.dumbroof.ai/api/cron/funnel-monitor \
 *     -H "Authorization: Bearer $CRON_SECRET"
 *
 * Anchor: USARM-Claims-Platform funnel investigation 2026-04-06,
 * full plan at ~/.claude/plans/snazzy-jingling-petal.md (Phase 3).
 */

const RECIPIENTS = [
  "tkovack@usaroofmasters.com",
  "hello@dumbroof.ai",
  "tom@dumbroof.ai",
  "kristen@dumbroof.ai",
];

// Allow up to 60s for the cron to gather all data + send the email.
// Vercel Cron has its own per-plan limit, but our route should fit comfortably.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function runFunnelMonitor(): Promise<{ ok: boolean; report?: FunnelReport; error?: string }> {
  const startTime = Date.now();

  // Find last successful run for "since" computation. Falls back to 12 hours ago.
  const { data: lastRun } = await supabaseAdmin
    .from("funnel_monitor_runs")
    .select("ran_at")
    .order("ran_at", { ascending: false })
    .limit(1);
  const windowEnd = new Date().toISOString();
  const windowStart =
    lastRun && lastRun[0]
      ? (lastRun[0].ran_at as string)
      : new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

  const anomalies: Anomaly[] = [];
  const sourcesSucceeded: string[] = [];
  const sourcesFailed: string[] = [];

  // Run all sources in parallel — no source should block the others
  const [
    supabaseResult,
    resendResult,
    stripeResult,
    vercelResult,
    ga4Result,
    metaResult,
    railwayResult,
  ] = await Promise.allSettled([
    gatherSupabase(windowStart, windowEnd, anomalies),
    gatherResend(windowStart, windowEnd, anomalies),
    gatherStripe(windowStart, windowEnd, anomalies),
    gatherVercelAnalytics(windowStart, windowEnd, anomalies),
    gatherGA4(windowStart, windowEnd, anomalies),
    gatherMetaAds(windowStart, windowEnd, anomalies),
    gatherRailwayHealth(),
  ]);

  const unwrap = <T>(result: PromiseSettledResult<T | null>, name: string): T | null => {
    if (result.status === "fulfilled") {
      if (result.value === null) {
        // Source either has no env keys configured OR returned null after a soft
        // failure (e.g., 404). The source itself pushes a more specific anomaly
        // when it encounters a real API error — here we just label the slot.
        sourcesFailed.push(`${name} (skipped or unavailable)`);
        return null;
      }
      sourcesSucceeded.push(name);
      return result.value;
    }
    sourcesFailed.push(`${name} (threw)`);
    console.error(`funnel-monitor source ${name} failed:`, result.reason);
    anomalies.push({
      severity: "warning",
      code: `${name}_source_error`,
      message: `${name} source threw: ${result.reason instanceof Error ? result.reason.message : String(result.reason).slice(0, 100)}`,
      source: name,
    });
    return null;
  };

  const report: FunnelReport = {
    generated_at: windowEnd,
    window_start: windowStart,
    window_end: windowEnd,
    duration_ms: 0, // filled in below
    supabase: unwrap(supabaseResult, "supabase"),
    resend: unwrap(resendResult, "resend"),
    stripe: unwrap(stripeResult, "stripe"),
    vercel_analytics: unwrap(vercelResult, "vercel_analytics"),
    ga4: unwrap(ga4Result, "ga4"),
    meta_ads: unwrap(metaResult, "meta_ads"),
    railway: unwrap(railwayResult, "railway"),
    anomalies,
    ai_insight: null,
    sources_succeeded: sourcesSucceeded,
    sources_failed: sourcesFailed,
  };

  // Cross-source anomaly: high traffic + low signups (need both Vercel + Supabase)
  if (
    report.vercel_analytics &&
    report.supabase &&
    report.vercel_analytics.visitors >= 50 &&
    report.supabase.signups_count < 2
  ) {
    anomalies.push({
      severity: "critical",
      code: "homepage_conversion_broken",
      message: `${report.vercel_analytics.visitors} visitors but only ${report.supabase.signups_count} signups in this window. Homepage conversion is broken.`,
    });
  }

  // AI insight (only if Anthropic key present)
  report.ai_insight = await generateAiInsight(report);

  report.duration_ms = Date.now() - startTime;

  return { ok: true, report };
}

async function sendReport(report: FunnelReport): Promise<void> {
  const html = renderReportHtml(report);
  const criticalCount = report.anomalies.filter((a) => a.severity === "critical").length;
  const subject =
    criticalCount > 0
      ? `🚨 DumbRoof Funnel Report — ${criticalCount} CRITICAL`
      : `DumbRoof Funnel Report — ${report.supabase?.signups_count ?? 0} signups, ${report.supabase?.uploads_count ?? 0} uploads`;

  const resend = getResend();
  await resend.emails.send({
    from: EMAIL_FROM,
    to: RECIPIENTS,
    replyTo: EMAIL_REPLY_TO,
    subject,
    html,
  });
}

async function persistRun(report: FunnelReport, error?: string): Promise<void> {
  await supabaseAdmin.from("funnel_monitor_runs").insert({
    ran_at: report.generated_at,
    signups_count: report.supabase?.signups_count ?? 0,
    uploads_count: report.supabase?.uploads_count ?? 0,
    visitors_count: report.vercel_analytics?.visitors ?? null,
    bounce_rate: report.vercel_analytics?.bounce_rate ?? null,
    new_subscriptions: report.stripe?.new_subscriptions ?? 0,
    mrr_delta_cents: report.stripe?.mrr_delta_cents ?? 0,
    anomalies: report.anomalies,
    full_report: report as unknown as Record<string, unknown>,
    ai_insight: report.ai_insight,
    duration_ms: report.duration_ms,
    sources_succeeded: report.sources_succeeded,
    sources_failed: report.sources_failed,
    error_message: error || null,
  });
}

function authorize(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    // No secret configured = allow only in dev. Production deploys should always
    // have CRON_SECRET set; we treat its absence as a misconfiguration but still
    // allow Vercel Cron's own user-agent through.
    return req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  }
  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${cronSecret}`;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { report } = await runFunnelMonitor();
    if (!report) {
      return NextResponse.json({ error: "Report generation failed" }, { status: 500 });
    }
    await sendReport(report);
    await persistRun(report);
    return NextResponse.json({
      ok: true,
      signups: report.supabase?.signups_count ?? 0,
      uploads: report.supabase?.uploads_count ?? 0,
      anomalies: report.anomalies.length,
      duration_ms: report.duration_ms,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("funnel-monitor failed:", message);
    // Try to persist the failure so we have a trail
    try {
      await supabaseAdmin.from("funnel_monitor_runs").insert({
        anomalies: [],
        full_report: {},
        error_message: message.slice(0, 500),
      });
    } catch {
      // Already failing — don't cascade
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
