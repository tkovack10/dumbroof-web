/**
 * Shared helpers for the 3 continuous-improvement agents
 * (damage-detective, carrier-analyst, richard-trainer).
 *
 * Each cron route imports these to avoid duplicating Anthropic fetch
 * logic, "since last run" window computation, and agent_recommendations
 * insertion.
 *
 * Anchor: ~/.claude/plans/proud-wiggling-hearth.md Phase 2.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export type AgentName =
  | "damage_detective"
  | "carrier_analyst"
  | "richard_trainer"
  | "qa_auditor";

export type RecommendationTargetType =
  | "carrier_playbook"
  | "system_prompt"
  | "photo_prompt"
  | "config"
  | "other";

export interface AgentRecommendation {
  agent: AgentName;
  target_type: RecommendationTargetType;
  target_path: string;
  summary: string;
  rationale?: string;
  proposed_diff: string;
  evidence?: Record<string, unknown>;
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-opus-4-6";

/**
 * Call the Anthropic Messages API via fetch (no SDK). Matches the pattern
 * in src/lib/funnel-monitor/ai-insight.ts so we don't ship @anthropic-ai/sdk.
 */
export async function callAnthropic(args: {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  maxTokens?: number;
}): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[agent] ANTHROPIC_API_KEY not set — skipping LLM call");
    return null;
  }

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: args.model || DEFAULT_MODEL,
        max_tokens: args.maxTokens ?? 4096,
        system: args.systemPrompt,
        messages: [{ role: "user", content: args.userPrompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[agent] Anthropic API ${res.status}: ${text.slice(0, 400)}`);
      return null;
    }

    const body = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const block = body.content?.find((c) => c.type === "text");
    return block?.text ?? null;
  } catch (err) {
    console.error("[agent] Anthropic fetch threw:", err);
    return null;
  }
}

/** Best-effort JSON extraction from a Claude response that may be wrapped in fences. */
export function parseJsonFromLlm<T = unknown>(raw: string | null): T | null {
  if (!raw) return null;
  let text = raw.trim();
  if (text.includes("```")) {
    const parts = text.split("```");
    for (const part of parts) {
      const clean = part.trim().replace(/^json\s*/i, "");
      if (clean.startsWith("{") || clean.startsWith("[")) {
        text = clean;
        break;
      }
    }
  }
  const start = Math.min(
    ...[text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0)
  );
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (!Number.isFinite(start) || start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch (err) {
    console.error("[agent] JSON parse failed:", err);
    return null;
  }
}

/** Compute the "since last run" window. Falls back to 7 days ago if no prior run. */
export async function computeWindow(
  runsTable: string,
  fallbackDays = 7
): Promise<{ windowStart: string; windowEnd: string }> {
  const windowEnd = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from(runsTable)
    .select("ran_at")
    .order("ran_at", { ascending: false })
    .limit(1);
  const windowStart =
    data && data[0]
      ? (data[0].ran_at as string)
      : new Date(Date.now() - fallbackDays * 24 * 60 * 60 * 1000).toISOString();
  return { windowStart, windowEnd };
}

/**
 * Insert a batch of recommendations into the review queue. Returns the
 * number successfully inserted.
 */
export async function insertRecommendations(
  recs: AgentRecommendation[],
  runId?: number | null
): Promise<number> {
  if (!recs || recs.length === 0) return 0;
  const rows = recs.map((r) => ({
    agent: r.agent,
    run_id: runId ?? null,
    target_type: r.target_type,
    target_path: r.target_path,
    summary: r.summary,
    rationale: r.rationale || null,
    proposed_diff: r.proposed_diff,
    evidence: r.evidence || {},
    status: "pending",
  }));
  const { error, count } = await supabaseAdmin
    .from("agent_recommendations")
    .insert(rows, { count: "exact" });
  if (error) {
    console.error("[agent] insertRecommendations failed:", error);
    return 0;
  }
  return count ?? rows.length;
}

/** Authorize a cron request — same shape as document-quality/funnel-monitor. */
export function authorizeCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  }
  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}
