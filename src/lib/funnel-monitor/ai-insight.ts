import type { FunnelReport } from "./types";

/**
 * Funnel Monitor — AI insight generator.
 *
 * Calls the Anthropic Messages API directly via fetch (no SDK dep) to get
 * 2-3 sentences of plain-English insight + 1-3 prioritized recommendations
 * on top of the structured report. Returns null if ANTHROPIC_API_KEY is missing.
 *
 * Model: Claude Sonnet 4.6 (the production-grade reasoning model as of 2026).
 */
export async function generateAiInsight(report: FunnelReport): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;

  // Trim the report to the parts that matter for the LLM — we don't want
  // to feed it 100 recent_signups rows. Keep aggregate counts and anomalies.
  const condensed = {
    window: { start: report.window_start, end: report.window_end },
    supabase: report.supabase
      ? {
          signups: report.supabase.signups_count,
          uploads: report.supabase.uploads_count,
          active_users_24h: report.supabase.active_users_24h,
          zero_claim_users: report.supabase.zero_claim_users,
          cohort_week1_retention: report.supabase.cohort_week1_retention,
        }
      : null,
    resend: report.resend,
    stripe: report.stripe,
    vercel_analytics: report.vercel_analytics,
    ga4: report.ga4,
    meta_ads: report.meta_ads
      ? {
          total_spend_cents: report.meta_ads.total_spend_24h_cents,
          total_conversions: report.meta_ads.total_conversions_24h,
          campaigns: report.meta_ads.campaigns.map((c) => ({
            name: c.name,
            spend_cents: c.spend_cents,
            conversions: c.conversions,
            cost_per_conversion_cents: c.cost_per_conversion_cents,
          })),
        }
      : null,
    railway: report.railway,
    anomalies: report.anomalies,
  };

  const systemPrompt = `You are the analytics brain for dumbroof.ai, a SaaS that builds AI-generated storm damage claim packages for roofing contractors.

You are given a structured funnel report covering a recent time window. Output exactly 2-3 sentences of plain-English insight followed by 1-3 prioritized recommendations as a bulleted list.

Tone: terse, practical, no marketing language. Address Tom (the founder/CEO) directly. Lead with what changed and what to do about it.

Context for interpreting the data:
- The audience is roofing contractors, sales reps, and company owners — NOT homeowners
- Most ad traffic is mobile (Instagram/Facebook). The product is desktop-grade
- Mobile in-app browser users get a magic-link save-my-spot flow that emails them a desktop link
- Currently the biggest funnel killer is mobile users bouncing because they can't upload from a phone in an Instagram WebView
- The plan for fixing the funnel is at ~/.claude/plans/snazzy-jingling-petal.md

Format:
**Insight:** [2-3 sentences]

**Recommendations:**
- [action 1]
- [action 2]
- [action 3]`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Funnel report for window ${report.window_start} → ${report.window_end}:\n\n${JSON.stringify(
              condensed,
              null,
              2
            )}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      console.error("Anthropic API failed:", res.status, await res.text().catch(() => ""));
      return null;
    }

    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (json.content || []).find((c) => c.type === "text")?.text;
    return text || null;
  } catch (err) {
    console.error("AI insight generation failed:", err);
    return null;
  }
}
