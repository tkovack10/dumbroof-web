/**
 * Damage Detective — weekly cron that analyzes photo annotation corrections
 * and proposes prompt improvements.
 *
 * Reads: annotation_feedback table (every swipe: approve/correct/reject
 * with original + corrected annotation/tags).
 * Writes: damage_detective_runs (run metadata) + agent_recommendations
 * (proposed prompt patches, one per pattern detected).
 *
 * Schedule: "0 13 * * 1" (Mondays 9am ET)
 *
 * Subagent definition: ~/.claude/agents/damage-detective.md
 * Plan: ~/.claude/plans/proud-wiggling-hearth.md Phase 2a
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend, EMAIL_FROM, EMAIL_REPLY_TO } from "@/lib/resend";
import {
  authorizeCron,
  callAnthropic,
  computeWindow,
  escapeHtml,
  emailTile,
  insertRecommendations,
  parseJsonFromLlm,
  type AgentRecommendation,
} from "@/lib/agent-common";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const RECIPIENTS = ["tkovack@usaroofmasters.com"];

interface AnnotationFeedbackRow {
  id: number;
  photo_id: string | null;
  claim_id: string | null;
  status: string;
  original_annotation: string | null;
  corrected_annotation: string | null;
  original_tags: unknown;
  corrected_tags: unknown;
  created_at: string;
}

interface DetectiveReport {
  window_start: string;
  window_end: string;
  duration_ms: number;
  corrections_reviewed: number;
  patterns_found: number;
  recommendations_created: number;
  top_patterns: Array<{ pattern: string; count: number; example: string }>;
  raw_llm_output: string | null;
}

const SYSTEM_PROMPT = `You are the DumbRoof Damage Detective agent. Your single job: analyze photo annotation corrections made by roofing experts and identify patterns where the AI damage-detection prompt is getting things wrong. You produce concrete prompt patches (unified diffs) that would fix the most common error patterns.

Your output goes directly into an engineering review queue — be precise, cite specific corrections, and propose changes that are drop-in applicable to the analyze_photos() prompt in backend/processor.py.

Never invent patterns. Only flag patterns supported by 3+ examples in the data.`;

function buildUserPrompt(rows: AnnotationFeedbackRow[]): string {
  const sample = rows.slice(0, 60); // cap to keep context manageable
  const lines = sample.map((r, i) => {
    const orig = (r.original_annotation || "").slice(0, 200);
    const corr = (r.corrected_annotation || "").slice(0, 200);
    const origTags = JSON.stringify(r.original_tags || {});
    const corrTags = JSON.stringify(r.corrected_tags || {});
    return `[${i + 1}] status=${r.status}
  original:     ${orig}
  corrected:    ${corr}
  origTags:     ${origTags.slice(0, 120)}
  corrTags:     ${corrTags.slice(0, 120)}`;
  });
  return `${sample.length} photo annotation corrections from the last week:

${lines.join("\n\n")}

TASK:
1. Identify the top 5 error patterns where the AI gets damage-detection wrong (material misID, damage-type confusion, non-damage marked as damage, missed damage, wrong severity, etc.). Only include patterns supported by 3+ examples.

2. For each pattern, produce a unified diff patch to be applied to backend/processor.py — specifically to the analyze_photos() prompt. The patch should add a disambiguation rule, a few-shot example, or a NEGATIVE example showing what NOT to flag.

3. Rank patterns by impact (count × severity).

Return ONLY this JSON shape:
\`\`\`json
{
  "top_patterns": [
    {
      "pattern": "short name (e.g. 'algae marked as hail damage')",
      "count": 5,
      "example": "brief example from the data",
      "severity": "high|medium|low",
      "proposed_fix": "concrete instruction to add to the prompt",
      "diff_target": "backend/processor.py:analyze_photos",
      "diff": "--- a/backend/processor.py\\n+++ b/backend/processor.py\\n@@ context @@\\n+ NEW LINE"
    }
  ],
  "summary": "one-sentence plain english assessment of annotation quality this week"
}
\`\`\``;
}

interface LlmOutput {
  top_patterns?: Array<{
    pattern: string;
    count: number;
    example?: string;
    severity?: string;
    proposed_fix?: string;
    diff_target?: string;
    diff?: string;
  }>;
  summary?: string;
}

async function runDamageDetective(): Promise<DetectiveReport> {
  const startTime = Date.now();
  const { windowStart, windowEnd } = await computeWindow("damage_detective_runs", 7);

  // Pull corrections in the window
  const { data, error } = await supabaseAdmin
    .from("annotation_feedback")
    .select("id, photo_id, claim_id, status, original_annotation, corrected_annotation, original_tags, corrected_tags, created_at")
    .eq("status", "corrected")
    .gte("created_at", windowStart)
    .lt("created_at", windowEnd)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`annotation_feedback query failed: ${error.message}`);
  }

  const rows = (data || []) as unknown as AnnotationFeedbackRow[];
  const correctionsReviewed = rows.length;

  if (correctionsReviewed === 0) {
    return {
      window_start: windowStart,
      window_end: windowEnd,
      duration_ms: Date.now() - startTime,
      corrections_reviewed: 0,
      patterns_found: 0,
      recommendations_created: 0,
      top_patterns: [],
      raw_llm_output: null,
    };
  }

  const raw = await callAnthropic({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(rows),
    maxTokens: 3072,
  });

  const parsed = parseJsonFromLlm<LlmOutput>(raw);
  const patterns = parsed?.top_patterns || [];

  // Convert each pattern into an agent_recommendations row
  const recs: AgentRecommendation[] = patterns
    .filter((p) => p.diff && p.count >= 3)
    .map((p) => ({
      agent: "damage_detective" as const,
      target_type: "photo_prompt" as const,
      target_path: p.diff_target || "backend/processor.py:analyze_photos",
      summary: `${p.pattern} (${p.count}× this week, severity=${p.severity || "?"})`,
      rationale: p.proposed_fix || "",
      proposed_diff: p.diff || "",
      evidence: {
        count: p.count,
        example: p.example,
        severity: p.severity,
        window: { windowStart, windowEnd },
      },
    }));

  const createdCount = await insertRecommendations(recs);

  return {
    window_start: windowStart,
    window_end: windowEnd,
    duration_ms: Date.now() - startTime,
    corrections_reviewed: correctionsReviewed,
    patterns_found: patterns.length,
    recommendations_created: createdCount,
    top_patterns: patterns.map((p) => ({
      pattern: p.pattern,
      count: p.count,
      example: p.example || "",
    })),
    raw_llm_output: raw,
  };
}

function renderEmail(report: DetectiveReport): string {
  const patternRows = report.top_patterns
    .map(
      (p, i) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;color:#111">${i + 1}. ${escapeHtml(p.pattern)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;color:#b91c1c;font-weight:700">${p.count}×</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:0 8px 12px 8px;border-bottom:1px solid #eee;color:#666;font-size:12px;font-style:italic">${escapeHtml(p.example.slice(0, 200))}</td>
      </tr>`
    )
    .join("");
  return `
<div style="font-family:-apple-system,system-ui,sans-serif;max-width:680px;margin:0 auto;padding:20px;background:#fff;color:#111">
  <div style="background:linear-gradient(135deg,#1e3a8a,#3b82f6);color:#fff;padding:20px;border-radius:8px;margin-bottom:20px">
    <h1 style="margin:0;font-size:22px">🔍 Damage Detective — Weekly Report</h1>
    <p style="margin:8px 0 0;opacity:0.9;font-size:14px">${escapeHtml(report.window_start.slice(0, 10))} → ${escapeHtml(report.window_end.slice(0, 10))}</p>
  </div>
  <div style="display:flex;gap:12px;margin-bottom:20px">
    ${tile("Corrections reviewed", report.corrections_reviewed, "#1e40af")}
    ${tile("Patterns found", report.patterns_found, "#b45309")}
    ${tile("Recommendations", report.recommendations_created, "#b91c1c")}
  </div>
  ${
    report.top_patterns.length > 0
      ? `
    <h2 style="margin:24px 0 8px;font-size:16px">Top error patterns</h2>
    <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:6px;overflow:hidden">
      ${patternRows}
    </table>
  `
      : `<p style="color:#666">No patterns detected this week — AI annotation accuracy is holding steady.</p>`
  }
  ${
    report.recommendations_created > 0
      ? `
    <div style="margin-top:24px;padding:16px;background:#eff6ff;border-radius:6px">
      <p style="margin:0 0 8px;font-weight:600;color:#1e40af">Review &amp; open PRs</p>
      <a href="https://www.dumbroof.ai/admin/agent-recommendations?agent=damage_detective" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Open review queue</a>
    </div>
  `
      : ""
  }
  <p style="margin-top:24px;font-size:12px;color:#6b7280">Ran in ${report.duration_ms}ms · damage-detective@dumbroof.ai</p>
</div>`;
}

const tile = emailTile;

async function persist(report: DetectiveReport, emailSent: boolean, error?: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("damage_detective_runs")
    .insert({
      ran_at: report.window_end,
      window_start: report.window_start,
      window_end: report.window_end,
      corrections_reviewed: report.corrections_reviewed,
      patterns_found: report.patterns_found,
      recommendations_created: report.recommendations_created,
      full_report: report as unknown as Record<string, unknown>,
      duration_ms: report.duration_ms,
      error_message: error || null,
      email_sent: emailSent,
    })
    .select("id")
    .limit(1);
  return data?.[0]?.id ?? null;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await runDamageDetective();

    let emailSent = false;
    if (report.corrections_reviewed > 0) {
      try {
        const resend = getResend();
        await resend.emails.send({
          from: EMAIL_FROM,
          to: RECIPIENTS,
          replyTo: EMAIL_REPLY_TO,
          subject: `🔍 Damage Detective — ${report.patterns_found} pattern${report.patterns_found === 1 ? "" : "s"}, ${report.recommendations_created} rec${report.recommendations_created === 1 ? "" : "s"}`,
          html: renderEmail(report),
        });
        emailSent = true;
      } catch (sendErr) {
        console.error("damage-detective send failed:", sendErr);
      }
    }

    await persist(report, emailSent);

    return NextResponse.json({
      ok: true,
      corrections_reviewed: report.corrections_reviewed,
      patterns_found: report.patterns_found,
      recommendations_created: report.recommendations_created,
      email_sent: emailSent,
      duration_ms: report.duration_ms,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("damage-detective cron failed:", message);
    await supabaseAdmin.from("damage_detective_runs").insert({
      error_message: message.slice(0, 500),
      email_sent: false,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
