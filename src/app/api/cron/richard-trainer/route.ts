/**
 * Richard Trainer — weekly cron that analyzes Claim Brain chat conversations
 * and proposes improvements to Richard's system prompt.
 *
 * Reads: claim_brain_messages (persisted chat history — this table must be
 * populated by backend/main.py:claim_brain_chat() or the trainer has nothing
 * to read).
 *
 * Writes: richard_trainer_runs + agent_recommendations (proposed prompt
 * patches for _build_claim_brain_prompt in backend/main.py).
 *
 * Schedule: "0 20 * * 0" (Sundays 4pm ET)
 *
 * Subagent definition: ~/.claude/agents/richard-trainer.md
 * Plan: ~/.claude/plans/proud-wiggling-hearth.md Phase 2c
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

interface BrainMessageRow {
  id: number;
  claim_id: string;
  role: string;
  content: string;
  tool_calls: unknown;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
}

interface TrainerReport {
  window_start: string;
  window_end: string;
  duration_ms: number;
  conversations_reviewed: number;
  bad_answers_found: number;
  knowledge_gaps_found: number;
  recommendations_created: number;
  knowledge_gaps: string[];
  raw_llm_output: string | null;
}

const SYSTEM_PROMPT = `You are the Richard Trainer. Richard is DumbRoof's AI assistant on every claim detail page, answering questions about claim data, building codes, and carrier tactics.

Your single job: analyze Richard's recent conversations and identify where Richard gave wrong, unhelpful, or generic answers — then propose specific patches to Richard's system prompt (_build_claim_brain_prompt in backend/main.py) that would fix those failures.

Never invent gaps. Only flag issues supported by 2+ conversations.`;

function buildUserPrompt(messages: BrainMessageRow[]): string {
  // Group by claim_id to show conversation threads
  const threads = new Map<string, BrainMessageRow[]>();
  for (const m of messages) {
    if (!threads.has(m.claim_id)) threads.set(m.claim_id, []);
    threads.get(m.claim_id)!.push(m);
  }

  const blocks: string[] = [];
  let threadCount = 0;
  for (const [cid, msgs] of threads.entries()) {
    if (threadCount >= 20) break;
    msgs.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const transcript = msgs
      .slice(0, 16) // cap per thread
      .map((m) => `  ${m.role}: ${(m.content || "").slice(0, 400)}`)
      .join("\n");
    blocks.push(`THREAD ${cid.slice(0, 8)} (${msgs.length} turns):\n${transcript}`);
    threadCount++;
  }

  return `${messages.length} Richard chat messages from the last week, grouped by claim:

${blocks.join("\n\n")}

TASK:
1. Identify user questions where Richard gave a wrong, generic, or unhelpful answer. Group by pattern (e.g. "Richard doesn't know RCNYS codes", "Richard gives marketing-speak instead of technical facts", "Richard repeats the same supplement advice regardless of claim state").

2. Identify knowledge gaps — topics users ask about that Richard didn't answer correctly (building codes, specific carrier tactics, Xactimate line items, I&W formula, etc.).

3. For each gap, produce a unified diff against backend/main.py that adds context to _build_claim_brain_prompt. Each patch should be a specific, drop-in addition to the system prompt.

Return ONLY this JSON:
\`\`\`json
{
  "bad_answer_patterns": [
    {"pattern": "Richard doesn't cite code sections", "count": 5, "example": "User asked 'why does starter matter?' — Richard said 'it's important' instead of citing R905.2.8.3"}
  ],
  "knowledge_gaps": [
    "RCNYS R703.2 house wrap 4-sided coverage requirement",
    "State Farm 0% O&P template language"
  ],
  "recommendations": [
    {
      "target_path": "backend/main.py:_build_claim_brain_prompt",
      "summary": "Add RCNYS code citation requirements",
      "rationale": "5 conversations this week where Richard dodged code questions",
      "diff": "--- a/backend/main.py\\n+++ b/backend/main.py\\n@@ context @@\\n+ ## Code Citation Requirement"
    }
  ],
  "summary": "one-sentence assessment of Richard quality this week"
}
\`\`\``;
}

interface LlmOutput {
  bad_answer_patterns?: Array<{ pattern: string; count: number; example?: string }>;
  knowledge_gaps?: string[];
  recommendations?: Array<{
    target_path: string;
    summary: string;
    rationale?: string;
    diff: string;
  }>;
  summary?: string;
}

async function runRichardTrainer(): Promise<TrainerReport> {
  const startTime = Date.now();
  const { windowStart, windowEnd } = await computeWindow("richard_trainer_runs", 7);

  const { data, error } = await supabaseAdmin
    .from("claim_brain_messages")
    .select("id, claim_id, role, content, tool_calls, tokens_in, tokens_out, created_at")
    .gte("created_at", windowStart)
    .lt("created_at", windowEnd)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    throw new Error(`claim_brain_messages query failed: ${error.message}`);
  }

  const messages = (data || []) as unknown as BrainMessageRow[];
  const conversationsReviewed = new Set(messages.map((m) => m.claim_id)).size;

  if (messages.length === 0) {
    return {
      window_start: windowStart,
      window_end: windowEnd,
      duration_ms: Date.now() - startTime,
      conversations_reviewed: 0,
      bad_answers_found: 0,
      knowledge_gaps_found: 0,
      recommendations_created: 0,
      knowledge_gaps: [],
      raw_llm_output: null,
    };
  }

  const raw = await callAnthropic({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(messages),
    maxTokens: 3072,
  });

  const parsed = parseJsonFromLlm<LlmOutput>(raw);
  const patterns = parsed?.bad_answer_patterns || [];
  const gaps = parsed?.knowledge_gaps || [];

  const recs: AgentRecommendation[] = (parsed?.recommendations || [])
    .filter((r) => r.diff && r.target_path)
    .map((r) => ({
      agent: "richard_trainer" as const,
      target_type: "system_prompt" as const,
      target_path: r.target_path,
      summary: r.summary,
      rationale: r.rationale,
      proposed_diff: r.diff,
      evidence: {
        bad_answer_patterns: patterns,
        knowledge_gaps: gaps,
        window: { windowStart, windowEnd },
      },
    }));

  const createdCount = await insertRecommendations(recs);

  return {
    window_start: windowStart,
    window_end: windowEnd,
    duration_ms: Date.now() - startTime,
    conversations_reviewed: conversationsReviewed,
    bad_answers_found: patterns.length,
    knowledge_gaps_found: gaps.length,
    recommendations_created: createdCount,
    knowledge_gaps: gaps,
    raw_llm_output: raw,
  };
}

function renderEmail(report: TrainerReport): string {
  const gapsList = report.knowledge_gaps
    .slice(0, 10)
    .map((g) => `<li style="padding:6px 0;color:#374151">${escapeHtml(g)}</li>`)
    .join("");
  return `
<div style="font-family:-apple-system,system-ui,sans-serif;max-width:680px;margin:0 auto;padding:20px;background:#fff;color:#111">
  <div style="background:linear-gradient(135deg,#065f46,#10b981);color:#fff;padding:20px;border-radius:8px;margin-bottom:20px">
    <h1 style="margin:0;font-size:22px">🧠 Richard Trainer — Weekly Report</h1>
    <p style="margin:8px 0 0;opacity:0.9;font-size:14px">${escapeHtml(report.window_start.slice(0, 10))} → ${escapeHtml(report.window_end.slice(0, 10))}</p>
  </div>
  <div style="display:flex;gap:12px;margin-bottom:20px">
    ${tile("Conversations", report.conversations_reviewed, "#1e40af")}
    ${tile("Bad answers", report.bad_answers_found, "#b91c1c")}
    ${tile("Knowledge gaps", report.knowledge_gaps_found, "#b45309")}
    ${tile("Recommendations", report.recommendations_created, "#065f46")}
  </div>
  ${
    report.knowledge_gaps.length > 0
      ? `<h2 style="margin:24px 0 8px;font-size:16px">Top knowledge gaps</h2><ul style="padding-left:20px;margin:0;background:#f9fafb;border-radius:6px;padding:16px 16px 16px 32px">${gapsList}</ul>`
      : `<p style="color:#666">No knowledge gaps detected this week.</p>`
  }
  ${
    report.recommendations_created > 0
      ? `<div style="margin-top:24px;padding:16px;background:#ecfdf5;border-radius:6px"><p style="margin:0 0 8px;font-weight:600;color:#065f46">${report.recommendations_created} prompt update${report.recommendations_created === 1 ? "" : "s"} proposed</p><a href="https://www.dumbroof.ai/admin/agent-recommendations?agent=richard_trainer" style="display:inline-block;background:#10b981;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Review &amp; open PRs</a></div>`
      : ""
  }
  <p style="margin-top:24px;font-size:12px;color:#6b7280">Ran in ${report.duration_ms}ms</p>
</div>`;
}

const tile = emailTile;

async function persist(report: TrainerReport, emailSent: boolean, error?: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("richard_trainer_runs")
    .insert({
      ran_at: report.window_end,
      window_start: report.window_start,
      window_end: report.window_end,
      conversations_reviewed: report.conversations_reviewed,
      bad_answers_found: report.bad_answers_found,
      knowledge_gaps_found: report.knowledge_gaps_found,
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
    const report = await runRichardTrainer();

    let emailSent = false;
    if (report.conversations_reviewed > 0) {
      try {
        const resend = getResend();
        await resend.emails.send({
          from: EMAIL_FROM,
          to: RECIPIENTS,
          replyTo: EMAIL_REPLY_TO,
          subject: `🧠 Richard Trainer — ${report.bad_answers_found} bad answers, ${report.recommendations_created} rec${report.recommendations_created === 1 ? "" : "s"}`,
          html: renderEmail(report),
        });
        emailSent = true;
      } catch (sendErr) {
        console.error("richard-trainer send failed:", sendErr);
      }
    }

    await persist(report, emailSent);

    return NextResponse.json({
      ok: true,
      conversations_reviewed: report.conversations_reviewed,
      bad_answers_found: report.bad_answers_found,
      knowledge_gaps_found: report.knowledge_gaps_found,
      recommendations_created: report.recommendations_created,
      email_sent: emailSent,
      duration_ms: report.duration_ms,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("richard-trainer cron failed:", message);
    await supabaseAdmin.from("richard_trainer_runs").insert({
      error_message: message.slice(0, 500),
      email_sent: false,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
