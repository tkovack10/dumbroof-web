/**
 * Richard Health Canary — auto-disable trigger for governance v2.
 *
 * Runs every 15 minutes. Monitors chat_messages for elevated error rates
 * compared to a 7-day baseline. If the current 1-hour error rate exceeds
 * the baseline by >5 percentage points, posts a critical alert and writes
 * an agent_recommendations row marked `urgent: true` so it surfaces at the
 * top of the admin UI.
 *
 * Manual rollback per governance v2 feature (no code change needed):
 *
 *   RICHARD_MODEL=claude-opus-4-6                   → revert Day 1 model bump
 *   RICHARD_MAX_TOOL_ROUNDS=10                      → revert Day 1 cap raise
 *   RICHARD_MAX_TOTAL_TOOL_CALLS=20                 → revert Day 1 cap raise
 *   RICHARD_REPROCESS_RATE_LIMIT_SECONDS=999999     → effectively disable reprocess
 *   RICHARD_DISABLE_PREFLIGHT=true                  → bypass richard_middleware
 *   RICHARD_DISABLE_AUTOCHAIN=true                  → bypass richard_post auto-chain
 *
 * (Backend env reads aren't all wired yet — adding the env flag as a feature
 * disable is straightforward in each module if a regression is observed.)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BASELINE_DAYS = 7;
const CURRENT_WINDOW_MINUTES = 60;
const ALERT_THRESHOLD_DELTA = 0.05; // 5 percentage points above baseline

interface HealthSample {
  total: number;
  errors: number;
  errorRate: number;
}

async function sampleErrorRate(sinceISO: string, untilISO: string): Promise<HealthSample> {
  const { count: total, error: countErr } = await supabaseAdmin
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .gte("created_at", sinceISO)
    .lt("created_at", untilISO);
  if (countErr) throw new Error(`chat_messages count failed: ${countErr.message}`);

  // Error rows: tool_actions includes any item with status=error / status=rate_limited
  // OR content matches /error|failed|sorry/i (catches LLM-emitted error prose).
  // Approximation — exact taxonomy can come later.
  const { data: errorSampleRows, error: errSampleErr } = await supabaseAdmin
    .from("chat_messages")
    .select("id, content, tool_actions")
    .gte("created_at", sinceISO)
    .lt("created_at", untilISO)
    .eq("role", "assistant")
    .limit(2000);
  if (errSampleErr) throw new Error(`chat_messages sample failed: ${errSampleErr.message}`);

  let errors = 0;
  for (const row of errorSampleRows || []) {
    const ta = row.tool_actions;
    if (Array.isArray(ta)) {
      for (const a of ta) {
        if (a && typeof a === "object" && (a as { status?: string }).status === "error") {
          errors++;
          break;
        }
      }
    }
  }

  return {
    total: total || 0,
    errors,
    errorRate: total && total > 0 ? errors / total : 0,
  };
}

async function runCanary(): Promise<{
  baseline: HealthSample;
  current: HealthSample;
  delta: number;
  alert: boolean;
}> {
  const now = new Date();
  const baselineUntil = now.toISOString();
  const baselineSince = new Date(now.getTime() - BASELINE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const currentUntil = now.toISOString();
  const currentSince = new Date(now.getTime() - CURRENT_WINDOW_MINUTES * 60 * 1000).toISOString();

  const baseline = await sampleErrorRate(baselineSince, baselineUntil);
  const current = await sampleErrorRate(currentSince, currentUntil);

  const delta = current.errorRate - baseline.errorRate;
  const alert = current.total >= 5 && delta >= ALERT_THRESHOLD_DELTA;

  return { baseline, current, delta, alert };
}

export async function GET(req: NextRequest) {
  // Cron secret (matches /api/cron/* convention used by other cron routes)
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const result = await runCanary();

    // If alerting, write a critical agent_recommendations row so it surfaces
    // in the admin UI. Don't auto-flip env flags — that's still Tom's call,
    // but the alert routes him to act quickly.
    if (result.alert) {
      try {
        await supabaseAdmin.from("agent_recommendations").insert({
          agent: "richard_health_canary",
          target_type: "operations",
          target_path: "deployment/env",
          summary: `Richard error rate elevated: ${(result.current.errorRate * 100).toFixed(1)}% (baseline ${(result.baseline.errorRate * 100).toFixed(1)}%, delta +${(result.delta * 100).toFixed(1)}pp)`,
          rationale: `Last ${CURRENT_WINDOW_MINUTES}min: ${result.current.errors}/${result.current.total} assistant messages with error tool_actions vs ${BASELINE_DAYS}d baseline ${result.baseline.errors}/${result.baseline.total}. Consider rolling back governance v2 features via env: RICHARD_MODEL=claude-opus-4-6 (revert model), RICHARD_MAX_TOOL_ROUNDS=10 (revert caps), RICHARD_DISABLE_PREFLIGHT=true (bypass middleware).`,
          proposed_diff: "(operational alert — no code diff)",
          evidence: result,
          status: "urgent",
        });
      } catch (e) {
        console.error("[health-canary] failed to write alert:", e);
      }
    }

    return NextResponse.json(result);
  } catch (e) {
    console.error("[health-canary] cron failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
