/**
 * Carrier Analyst — weekly aggregate cron.
 *
 * Reads: last 7 days of claims.carrier_analyst_flags (written per-claim
 * by backend/carrier_analyst.py during processing) AND the raw carrier
 * scope data from claims.carrier + current_carrier_rcv.
 *
 * Writes: carrier_analyst_runs + agent_recommendations (one recommendation
 * per carrier with new tactic patterns detected).
 *
 * Schedule: "0 14 * * 1" (Mondays 10am ET)
 *
 * Subagent definition: ~/.claude/agents/carrier-analyst.md
 * Plan: ~/.claude/plans/proud-wiggling-hearth.md Phase 2b
 *
 * Recommend-only: this cron never auto-writes to carrier_playbooks/*.md.
 * Tom approves via GitHub PR from the /admin/agent-recommendations queue.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend, EMAIL_FROM, EMAIL_REPLY_TO } from "@/lib/resend";
import {
  authorizeCron,
  callAnthropic,
  computeWindow,
  insertRecommendations,
  parseJsonFromLlm,
  type AgentRecommendation,
} from "@/lib/agent-common";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const RECIPIENTS = ["tkovack@usaroofmasters.com"];

interface ClaimWithFlags {
  id: string;
  slug: string | null;
  address: string | null;
  carrier: string | null;
  contractor_rcv: number | null;
  current_carrier_rcv: number | null;
  carrier_analyst_flags: Record<string, unknown> | null;
  last_processed_at: string | null;
}

interface CarrierReport {
  window_start: string;
  window_end: string;
  duration_ms: number;
  scopes_reviewed: number;
  carriers_analyzed: number;
  new_tactics_found: number;
  recommendations_created: number;
  carriers: Array<{
    carrier: string;
    claim_count: number;
    avg_variance_pct: number;
    new_tactics: string[];
    summary: string;
  }>;
  raw_llm_output: string | null;
}

const SYSTEM_PROMPT = `You are the DumbRoof Carrier Intelligence Analyst. You study how insurance carriers underpay storm damage claims across a portfolio and identify tactic patterns that warrant playbook updates.

Your output goes to the admin review queue — concrete playbook diffs a human will merge via GitHub PR. Never auto-apply changes. Never invent tactics — only flag patterns supported by 2+ claims.`;

function buildUserPrompt(claims: ClaimWithFlags[]): string {
  const byCarrier = new Map<string, ClaimWithFlags[]>();
  for (const c of claims) {
    const k = (c.carrier || "unknown").trim() || "unknown";
    if (!byCarrier.has(k)) byCarrier.set(k, []);
    byCarrier.get(k)!.push(c);
  }

  const blocks: string[] = [];
  for (const [carrier, group] of byCarrier.entries()) {
    if (group.length < 2) continue; // need 2+ claims per carrier for pattern detection
    const lines: string[] = [`CARRIER: ${carrier} (${group.length} claims)`];
    for (const c of group.slice(0, 15)) {
      const variance = c.contractor_rcv && c.current_carrier_rcv
        ? ((c.contractor_rcv - c.current_carrier_rcv) / c.contractor_rcv * 100).toFixed(0)
        : "?";
      lines.push(`  - ${c.address}: carrier $${c.current_carrier_rcv}, contractor $${c.contractor_rcv} (${variance}% variance)`);
      if (c.carrier_analyst_flags) {
        const flagSummary = JSON.stringify(c.carrier_analyst_flags).slice(0, 400);
        lines.push(`    flags: ${flagSummary}`);
      }
    }
    blocks.push(lines.join("\n"));
  }

  return `Portfolio of recently processed claims with carrier scope data:

${blocks.join("\n\n")}

TASK:
1. For each carrier, identify any NEW underpayment tactic pattern supported by 2+ claims — e.g. "0% O&P when 3+ trades", "partial elevation siding", "starter at eaves only, not rakes", "spot repair on shingle systems", "ITEL/Cotality pricing".

2. For each new pattern, produce a unified diff against carrier_playbooks/<carrier-slug>.md that adds the tactic under the appropriate section (e.g. "Known Tactics", "Underpayment Patterns").

3. Also identify the strongest supplement counter-argument for each tactic, citing building codes (RCNYS for NY, IRC for others) where applicable.

Return ONLY this JSON:
\`\`\`json
{
  "carriers": [
    {
      "carrier": "State Farm",
      "claim_count": 5,
      "avg_variance_pct": 68,
      "new_tactics": ["partial-elevation siding on hip roofs"],
      "summary": "one sentence portfolio assessment",
      "recommendations": [
        {
          "target_path": "carrier_playbooks/state-farm.md",
          "summary": "Add partial-elevation siding tactic",
          "rationale": "5 State Farm claims this week showed carrier approving 1 of 4 elevations on hip roofs. Cite R703.1 for 4-side requirement.",
          "diff": "--- a/carrier_playbooks/state-farm.md\\n+++ b/carrier_playbooks/state-farm.md\\n@@ context @@\\n+ ### Partial Elevation Siding (NEW 2026-04)"
        }
      ]
    }
  ],
  "summary": "portfolio-wide plain english assessment"
}
\`\`\``;
}

interface LlmOutput {
  carriers?: Array<{
    carrier: string;
    claim_count: number;
    avg_variance_pct: number;
    new_tactics?: string[];
    summary?: string;
    recommendations?: Array<{
      target_path: string;
      summary: string;
      rationale?: string;
      diff: string;
    }>;
  }>;
  summary?: string;
}

async function runCarrierAnalyst(): Promise<CarrierReport> {
  const startTime = Date.now();
  const { windowStart, windowEnd } = await computeWindow("carrier_analyst_runs", 7);

  const { data, error } = await supabaseAdmin
    .from("claims")
    .select("id, slug, address, carrier, contractor_rcv, current_carrier_rcv, carrier_analyst_flags, last_processed_at")
    .gte("last_processed_at", windowStart)
    .lt("last_processed_at", windowEnd)
    .not("carrier", "is", null)
    .not("current_carrier_rcv", "is", null)
    .order("last_processed_at", { ascending: false });

  if (error) {
    throw new Error(`claims query failed: ${error.message}`);
  }

  const claims = (data || []) as unknown as ClaimWithFlags[];
  const scopesReviewed = claims.length;

  if (scopesReviewed === 0) {
    return {
      window_start: windowStart,
      window_end: windowEnd,
      duration_ms: Date.now() - startTime,
      scopes_reviewed: 0,
      carriers_analyzed: 0,
      new_tactics_found: 0,
      recommendations_created: 0,
      carriers: [],
      raw_llm_output: null,
    };
  }

  const uniqueCarriers = new Set(claims.map((c) => (c.carrier || "").trim()).filter(Boolean));

  const raw = await callAnthropic({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(claims),
    maxTokens: 4096,
  });

  const parsed = parseJsonFromLlm<LlmOutput>(raw);
  const carriers = parsed?.carriers || [];

  const recs: AgentRecommendation[] = [];
  let totalTactics = 0;
  for (const c of carriers) {
    totalTactics += (c.new_tactics || []).length;
    for (const rec of c.recommendations || []) {
      if (!rec.diff || !rec.target_path) continue;
      recs.push({
        agent: "carrier_analyst",
        target_type: "carrier_playbook",
        target_path: rec.target_path,
        summary: `[${c.carrier}] ${rec.summary}`,
        rationale: rec.rationale,
        proposed_diff: rec.diff,
        evidence: {
          carrier: c.carrier,
          claim_count: c.claim_count,
          avg_variance_pct: c.avg_variance_pct,
          window: { windowStart, windowEnd },
        },
      });
    }
  }

  const createdCount = await insertRecommendations(recs);

  return {
    window_start: windowStart,
    window_end: windowEnd,
    duration_ms: Date.now() - startTime,
    scopes_reviewed: scopesReviewed,
    carriers_analyzed: uniqueCarriers.size,
    new_tactics_found: totalTactics,
    recommendations_created: createdCount,
    carriers: carriers.map((c) => ({
      carrier: c.carrier,
      claim_count: c.claim_count,
      avg_variance_pct: c.avg_variance_pct,
      new_tactics: c.new_tactics || [],
      summary: c.summary || "",
    })),
    raw_llm_output: raw,
  };
}

function renderEmail(report: CarrierReport): string {
  const rows = report.carriers
    .map(
      (c) => `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #eee;font-weight:600;color:#111">${escapeHtml(c.carrier)}</td>
        <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;color:#6b7280">${c.claim_count}</td>
        <td style="padding:10px;border-bottom:1px solid #eee;text-align:right;color:${c.avg_variance_pct >= 50 ? "#b91c1c" : "#b45309"};font-weight:700">${c.avg_variance_pct}%</td>
      </tr>
      ${
        c.new_tactics.length > 0
          ? `<tr><td colspan="3" style="padding:0 10px 10px;border-bottom:1px solid #eee;color:#b91c1c;font-size:12px">⚠ New tactics: ${c.new_tactics.map(escapeHtml).join(", ")}</td></tr>`
          : ""
      }
      ${c.summary ? `<tr><td colspan="3" style="padding:0 10px 10px;border-bottom:1px solid #eee;color:#666;font-size:12px;font-style:italic">${escapeHtml(c.summary)}</td></tr>` : ""}`
    )
    .join("");
  return `
<div style="font-family:-apple-system,system-ui,sans-serif;max-width:680px;margin:0 auto;padding:20px;background:#fff;color:#111">
  <div style="background:linear-gradient(135deg,#7c2d12,#dc2626);color:#fff;padding:20px;border-radius:8px;margin-bottom:20px">
    <h1 style="margin:0;font-size:22px">📋 Carrier Analyst — Weekly Report</h1>
    <p style="margin:8px 0 0;opacity:0.9;font-size:14px">${escapeHtml(report.window_start.slice(0, 10))} → ${escapeHtml(report.window_end.slice(0, 10))}</p>
  </div>
  <div style="display:flex;gap:12px;margin-bottom:20px">
    ${tile("Scopes reviewed", report.scopes_reviewed, "#1e40af")}
    ${tile("Carriers", report.carriers_analyzed, "#0891b2")}
    ${tile("New tactics", report.new_tactics_found, "#b45309")}
    ${tile("Recommendations", report.recommendations_created, "#b91c1c")}
  </div>
  ${
    report.carriers.length > 0
      ? `
    <h2 style="margin:24px 0 8px;font-size:16px">Portfolio by carrier</h2>
    <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:6px;overflow:hidden">
      <thead><tr><th style="padding:10px;text-align:left;background:#e5e7eb;color:#111">Carrier</th><th style="padding:10px;background:#e5e7eb;color:#111">Claims</th><th style="padding:10px;text-align:right;background:#e5e7eb;color:#111">Avg Variance</th></tr></thead>
      ${rows}
    </table>
  `
      : `<p style="color:#666">No carrier portfolio data this week.</p>`
  }
  ${
    report.recommendations_created > 0
      ? `
    <div style="margin-top:24px;padding:16px;background:#fef2f2;border-radius:6px">
      <p style="margin:0 0 8px;font-weight:600;color:#991b1b">${report.recommendations_created} playbook update${report.recommendations_created === 1 ? "" : "s"} proposed</p>
      <a href="https://www.dumbroof.ai/admin/agent-recommendations?agent=carrier_analyst" style="display:inline-block;background:#dc2626;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Review &amp; open PRs</a>
    </div>
  `
      : ""
  }
  <p style="margin-top:24px;font-size:12px;color:#6b7280">Ran in ${report.duration_ms}ms</p>
</div>`;
}

function tile(label: string, value: number, color: string): string {
  return `<div style="flex:1;background:#fff;padding:14px;border-radius:6px;border:1px solid #e5e7eb">
    <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;color:#6b7280;font-weight:600">${label}</p>
    <p style="margin:0;font-size:28px;font-weight:900;color:${color}">${value}</p>
  </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function persist(report: CarrierReport, emailSent: boolean, error?: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("carrier_analyst_runs")
    .insert({
      ran_at: report.window_end,
      window_start: report.window_start,
      window_end: report.window_end,
      scopes_reviewed: report.scopes_reviewed,
      carriers_analyzed: report.carriers_analyzed,
      new_tactics_found: report.new_tactics_found,
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
    const report = await runCarrierAnalyst();

    let emailSent = false;
    if (report.scopes_reviewed > 0) {
      try {
        const resend = getResend();
        await resend.emails.send({
          from: EMAIL_FROM,
          to: RECIPIENTS,
          replyTo: EMAIL_REPLY_TO,
          subject: `📋 Carrier Analyst — ${report.carriers_analyzed} carriers, ${report.new_tactics_found} new tactics, ${report.recommendations_created} rec${report.recommendations_created === 1 ? "" : "s"}`,
          html: renderEmail(report),
        });
        emailSent = true;
      } catch (sendErr) {
        console.error("carrier-analyst send failed:", sendErr);
      }
    }

    await persist(report, emailSent);

    return NextResponse.json({
      ok: true,
      scopes_reviewed: report.scopes_reviewed,
      carriers_analyzed: report.carriers_analyzed,
      new_tactics_found: report.new_tactics_found,
      recommendations_created: report.recommendations_created,
      email_sent: emailSent,
      duration_ms: report.duration_ms,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("carrier-analyst cron failed:", message);
    await supabaseAdmin.from("carrier_analyst_runs").insert({
      error_message: message.slice(0, 500),
      email_sent: false,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
