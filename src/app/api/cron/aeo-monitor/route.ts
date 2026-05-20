/**
 * Daily AEO (Answer Engine Optimization) monitor.
 *
 * Runs a fixed list of category queries against Claude with web_search
 * enabled, then inspects each answer for dumbroof.ai citations and known
 * competitor mentions. Writes one row per (query, source) into
 * `aeo_check_results` so we can chart "cited / not cited" over time.
 *
 * No native API tells you "is dumbroof.ai cited in ChatGPT today" — running
 * live queries is the only honest signal. We start with Anthropic (one
 * source) because `ANTHROPIC_API_KEY` is already present. Additional
 * sources (Perplexity, Brave search, etc.) can be added by extending the
 * `runQueryAgainstSource` ladder without touching the schema.
 *
 * Gracefully degrades if `ANTHROPIC_API_KEY` is absent.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";

export const maxDuration = 120;
const HEARTBEAT_NAME = "aeo-monitor";
const EXPECTED_INTERVAL = 1440; // daily

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const TARGET_QUERIES = [
  "best AI software for roofing insurance supplement claims",
  "how to automate roofing insurance supplement",
  "best roofing claim software for contractors",
  "how to fight insurance company underpayment on roof claim",
  "AI tool for roofing insurance estimates",
  "best xactimate alternative for roofers",
  "roofing supplement software comparison",
  "how to write a roofing supplement",
  "AI for property damage forensic reports",
  "insurance claim automation software",
];

/**
 * Known competitor brand tokens we care about tracking. Matching is
 * substring-based against the lowercased answer text — fine for distinctive
 * brand strings; deliberately loose (e.g. "roofr" matches "roofr.com").
 */
const COMPETITOR_TOKENS: Record<string, string> = {
  acculynx: "acculynx",
  jobnimbus: "jobnimbus",
  companycam: "companycam",
  eagleview: "eagleview",
  hover: "hover",
  roofr: "roofr",
  symbility: "symbility",
  xactimate: "xactimate",
  restorationai: "restorationai",
  servicetitan: "servicetitan",
  buildertrend: "buildertrend",
  roofsnap: "roofsnap",
};

const DUMBROOF_TOKENS = ["dumbroof.ai", "dumbroof"];

interface SourceResult {
  source: string;
  query: string;
  dumbroof_cited: boolean;
  dumbroof_position: number | null;
  competitors_cited: string[];
  raw_answer_excerpt: string;
}

/**
 * Detect dumbroof.ai citation position. Position = order-of-first-mention
 * among "branded mentions" (dumbroof + tracked competitors). Returns null
 * if dumbroof is not mentioned.
 */
function analyzeAnswer(answer: string): {
  dumbroofCited: boolean;
  dumbroofPosition: number | null;
  competitorsCited: string[];
} {
  const lower = answer.toLowerCase();

  // Find first-mention index of each tracked brand.
  const mentions: Array<{ brand: string; index: number; isDumbroof: boolean }> = [];
  for (const token of DUMBROOF_TOKENS) {
    const idx = lower.indexOf(token);
    if (idx !== -1) {
      mentions.push({ brand: "dumbroof", index: idx, isDumbroof: true });
      break; // dedupe — one entry for dumbroof
    }
  }
  for (const [key, token] of Object.entries(COMPETITOR_TOKENS)) {
    const idx = lower.indexOf(token);
    if (idx !== -1) mentions.push({ brand: key, index: idx, isDumbroof: false });
  }
  mentions.sort((a, b) => a.index - b.index);

  let dumbroofPosition: number | null = null;
  for (let i = 0; i < mentions.length; i++) {
    if (mentions[i].isDumbroof) {
      dumbroofPosition = i + 1; // 1-indexed
      break;
    }
  }

  const dumbroofCited = dumbroofPosition !== null;
  const competitorsCited = Array.from(
    new Set(mentions.filter((m) => !m.isDumbroof).map((m) => m.brand))
  );

  return { dumbroofCited, dumbroofPosition, competitorsCited };
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
}

async function runAnthropicWebSearch(query: string): Promise<SourceResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  // Use Anthropic's server-side web_search tool. Model decides when to
  // search and produces a synthesized answer; we then scan the final
  // text block for citations.
  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: `Answer this query using web search. Cite the specific products / companies you recommend by name. Question: ${query}`,
      },
    ],
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 4,
      },
    ],
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[aeo-monitor] Anthropic failed:", res.status, text.slice(0, 500));
      return null;
    }

    const json = (await res.json()) as AnthropicResponse;
    const textBlocks = (json.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n\n")
      .trim();

    if (!textBlocks) return null;

    const analysis = analyzeAnswer(textBlocks);
    return {
      source: "anthropic_web_search",
      query,
      dumbroof_cited: analysis.dumbroofCited,
      dumbroof_position: analysis.dumbroofPosition,
      competitors_cited: analysis.competitorsCited,
      raw_answer_excerpt: textBlocks.slice(0, 500),
    };
  } catch (err) {
    console.error("[aeo-monitor] runAnthropicWebSearch error:", err);
    return null;
  }
}

async function run(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[aeo-monitor] ANTHROPIC_API_KEY not configured — skipping run");
    await recordHeartbeat(HEARTBEAT_NAME, EXPECTED_INTERVAL, "skipped", "ANTHROPIC_API_KEY not set", Date.now() - startedAt);
    return NextResponse.json({ skipped: true, reason: "ANTHROPIC_API_KEY not set" });
  }

  const checkDate = new Date().toISOString().slice(0, 10);
  const results: SourceResult[] = [];
  const errors: Array<{ query: string; error: string }> = [];

  // Sequential to avoid burning through Anthropic rate limits and to
  // stay well under the 120-second function ceiling.
  for (const q of TARGET_QUERIES) {
    try {
      const r = await runAnthropicWebSearch(q);
      if (r) results.push(r);
      else errors.push({ query: q, error: "no answer returned" });
    } catch (err) {
      errors.push({ query: q, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (results.length > 0) {
    const insertRows = results.map((r) => ({
      check_date: checkDate,
      source: r.source,
      query: r.query,
      dumbroof_cited: r.dumbroof_cited,
      dumbroof_position: r.dumbroof_position,
      competitors_cited: r.competitors_cited,
      raw_answer_excerpt: r.raw_answer_excerpt,
    }));
    const { error } = await supabaseAdmin.from("aeo_check_results").insert(insertRows);
    if (error) {
      console.error("[aeo-monitor] insert failed:", error);
      await recordHeartbeat(HEARTBEAT_NAME, EXPECTED_INTERVAL, "error", `insert failed: ${error.message}`, Date.now() - startedAt);
      return NextResponse.json(
        { ok: false, error: error.message, results_count: results.length },
        { status: 500 }
      );
    }
  }

  const citedCount = results.filter((r) => r.dumbroof_cited).length;
  const status = results.length === 0 && errors.length > 0 ? "error" : "ok";
  await recordHeartbeat(
    HEARTBEAT_NAME,
    EXPECTED_INTERVAL,
    status,
    `queries=${TARGET_QUERIES.length} succeeded=${results.length} cited=${citedCount} errors=${errors.length}`,
    Date.now() - startedAt,
  );
  return NextResponse.json({
    ok: true,
    check_date: checkDate,
    queries_run: TARGET_QUERIES.length,
    queries_succeeded: results.length,
    dumbroof_cited_count: citedCount,
    errors_count: errors.length,
    errors,
  });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
