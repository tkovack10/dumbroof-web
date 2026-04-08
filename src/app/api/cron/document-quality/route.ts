import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend, EMAIL_FROM, EMAIL_REPLY_TO } from "@/lib/resend";
import { gradeClaim, type ClaimRow } from "@/lib/document-quality/qa-checks";
import { renderReportHtml } from "@/lib/document-quality/render-html";
import type { DocumentQualityReport, ClaimQuality } from "@/lib/document-quality/types";

/**
 * Twice-Daily Document Quality Review — Vercel Cron at 9am and 5pm ET.
 *
 * Configured in vercel.json (`"schedule": "0 13,21 * * *"` UTC, same as
 * the funnel monitor).
 *
 * Queries the `claims` table for every claim with `status='ready'` whose
 * `last_processed_at` falls inside the cron window, runs the QA check
 * pipeline (financial sanity, code citations, scope comparison, weather,
 * PDF generation, etc.), grades each claim A/B/C/F, sends Tom an HTML
 * digest via Resend, and persists the run to `document_quality_runs`.
 *
 * Auth: requires `Authorization: Bearer ${CRON_SECRET}` header. Vercel
 * Cron sends this automatically. Manual invocations need to set it.
 *
 * On-demand trigger:
 *   curl -X POST https://www.dumbroof.ai/api/cron/document-quality \
 *     -H "Authorization: Bearer $CRON_SECRET"
 *
 * Sibling architecture to /api/cron/funnel-monitor — same auth, same
 * Resend pattern, same window-from-last-run logic.
 *
 * Anchor: USARM-Claims-Platform Phase 9 of the funnel recovery plan.
 * Tom 2026-04-08: "didnt we set up loop agents to review all documents
 * generated from dumbroof on a daily basis? i am not seeing these reports"
 * — answer was no, this route is what fixes that.
 */

const RECIPIENTS = [
  "tkovack@usaroofmasters.com",
  "hello@dumbroof.ai",
  "tom@dumbroof.ai",
  "kristen@dumbroof.ai",
];

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function gradeRank(g: ClaimQuality["grade"]): number {
  // Worst-first sort: F → C → B → A
  return { F: 0, C: 1, B: 2, A: 3 }[g];
}

async function runDocumentQualityReview(): Promise<{
  ok: boolean;
  report?: DocumentQualityReport;
  error?: string;
}> {
  const startTime = Date.now();

  // Find the last successful run for "since" computation. Falls back to 12 hours ago.
  const { data: lastRun } = await supabaseAdmin
    .from("document_quality_runs")
    .select("ran_at")
    .order("ran_at", { ascending: false })
    .limit(1);
  const windowEnd = new Date().toISOString();
  const windowStart =
    lastRun && lastRun[0]
      ? (lastRun[0].ran_at as string)
      : new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

  // Pull every claim that became `ready` inside the window.
  // We select all the columns the QA checks read.
  const { data: claims, error: queryError } = await supabaseAdmin
    .from("claims")
    .select(
      "id, slug, address, carrier, status, phase, contractor_rcv, current_carrier_rcv, original_carrier_rcv, report_mode, output_files, trade_count, o_and_p_enabled, tax_rate, weather_data, scope_comparison, roof_sections, estimate_request, measurement_files, scope_files, photo_files, damage_score, damage_grade, approval_score, approval_grade, error_message, last_processed_at"
    )
    .eq("status", "ready")
    .gte("last_processed_at", windowStart)
    .lt("last_processed_at", windowEnd)
    .order("last_processed_at", { ascending: false });

  if (queryError) {
    return { ok: false, error: `Supabase query failed: ${queryError.message}` };
  }

  const claimRows = (claims || []) as unknown as ClaimRow[];

  // Run QA checks against each claim
  const claimGrades: ClaimQuality[] = claimRows.map(gradeClaim);

  // Sort worst-first so F+C show up at the top of the email
  claimGrades.sort((a, b) => {
    const rankDiff = gradeRank(a.grade) - gradeRank(b.grade);
    if (rankDiff !== 0) return rankDiff;
    return b.contractor_rcv - a.contractor_rcv;
  });

  // Aggregate counts
  const grades = { A: 0, B: 0, C: 0, F: 0 };
  for (const c of claimGrades) grades[c.grade]++;

  // Cross-cutting issues — flag patterns across the whole window
  const criticalIssues: string[] = [];
  if (grades.F > 0) {
    criticalIssues.push(`${grades.F} claim(s) graded F (2+ critical failures each)`);
  }
  if (grades.C >= 3) {
    criticalIssues.push(`${grades.C} claims graded C — investigate for systemic issues`);
  }
  const noWeatherCount = claimGrades.filter((c) =>
    c.checks.some((ch) => ch.name === "weather_data" && !ch.passed)
  ).length;
  if (noWeatherCount >= 2 && noWeatherCount === claimRows.length) {
    criticalIssues.push(
      `${noWeatherCount}/${claimRows.length} claims missing weather data — NOAA pipeline may be down`
    );
  }
  const oAndPFails = claimGrades.filter((c) =>
    c.checks.some((ch) => ch.name === "o_and_p" && !ch.passed)
  ).length;
  if (oAndPFails >= 2) {
    criticalIssues.push(`${oAndPFails} claims have O&P misconfiguration`);
  }
  const scopeCompFails = claimGrades.filter((c) =>
    c.checks.some((ch) => ch.name === "scope_comparison" && !ch.passed)
  ).length;
  if (scopeCompFails >= 2) {
    criticalIssues.push(
      `${scopeCompFails} post-scope claims have empty/incomplete scope_comparison`
    );
  }

  const report: DocumentQualityReport = {
    generated_at: windowEnd,
    window_start: windowStart,
    window_end: windowEnd,
    duration_ms: Date.now() - startTime,
    claims_reviewed: claimRows.length,
    grades,
    claim_grades: claimGrades,
    critical_issues: criticalIssues,
  };

  return { ok: true, report };
}

async function sendReport(report: DocumentQualityReport): Promise<void> {
  // Tom's directive: skip the email entirely when the window has 0 claims.
  // Empty windows = no email = no inbox noise.
  if (report.claims_reviewed === 0) return;

  const html = renderReportHtml(report);
  const failCount = report.grades.F + report.grades.C;
  const subject =
    failCount > 0
      ? `🚨 DumbRoof Quality Report — ${failCount} grade-C/F of ${report.claims_reviewed}`
      : `DumbRoof Quality Report — ${report.claims_reviewed} claim${report.claims_reviewed === 1 ? "" : "s"}, all A/B`;

  const resend = getResend();
  await resend.emails.send({
    from: EMAIL_FROM,
    to: RECIPIENTS,
    replyTo: EMAIL_REPLY_TO,
    subject,
    html,
  });
}

async function persistRun(
  report: DocumentQualityReport,
  emailSent: boolean,
  errorMessage?: string
): Promise<void> {
  await supabaseAdmin.from("document_quality_runs").insert({
    ran_at: report.generated_at,
    window_start: report.window_start,
    window_end: report.window_end,
    claims_reviewed: report.claims_reviewed,
    grade_a_count: report.grades.A,
    grade_b_count: report.grades.B,
    grade_c_count: report.grades.C,
    grade_f_count: report.grades.F,
    claim_grades: report.claim_grades as unknown as Record<string, unknown>[],
    critical_issues: report.critical_issues,
    duration_ms: report.duration_ms,
    error_message: errorMessage || null,
    email_sent: emailSent,
  });
}

function authorize(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    // Same posture as funnel-monitor: allow Vercel Cron's UA through if no secret set
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
    const { report, error } = await runDocumentQualityReview();
    if (error || !report) {
      return NextResponse.json({ error: error || "Report generation failed" }, { status: 500 });
    }

    let emailSent = false;
    try {
      await sendReport(report);
      emailSent = report.claims_reviewed > 0;
    } catch (sendErr) {
      console.error("document-quality send failed:", sendErr);
      // Don't fail the run — persist what we have
    }

    await persistRun(report, emailSent);

    return NextResponse.json({
      ok: true,
      claims_reviewed: report.claims_reviewed,
      grades: report.grades,
      critical_issues: report.critical_issues.length,
      email_sent: emailSent,
      duration_ms: report.duration_ms,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("document-quality cron failed:", message);
    try {
      await supabaseAdmin.from("document_quality_runs").insert({
        window_start: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
        window_end: new Date().toISOString(),
        error_message: message.slice(0, 500),
        email_sent: false,
      });
    } catch {
      // Already failing — don't cascade
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
