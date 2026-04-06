import type { VercelAnalyticsSection, Anomaly } from "../types";

/**
 * Funnel Monitor — Vercel Web Analytics REST API.
 *
 * STATUS: As of 2026-04-06, Vercel does NOT expose a public REST endpoint
 * for Web Analytics data. Confirmed by hitting /v1/web-analytics/views
 * with a valid token + team + project — returns 404. The Vercel dashboard
 * is the only first-party way to read these metrics.
 *
 * KEEP THIS FILE: it's the slot for when Vercel ships the public endpoint,
 * AND it's the place we'd swap in a workaround (e.g., scraping the dashboard
 * via a Playwright Vercel API endpoint, or a different undocumented path).
 *
 * For now, the funnel monitor reads visitor + engagement data from the
 * GA4 Data API instead — see sources/ga4.ts. GA4 has equivalent metrics
 * (visitors, page views, bounce rate, top pages, top referrers) plus
 * better engagement signals (scroll rate, conversions, geo).
 *
 * Requires VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID env vars.
 * Gracefully returns null if any are missing OR if the endpoint 404s.
 */
export async function gatherVercelAnalytics(
  windowStart: string,
  windowEnd: string,
  anomalies: Anomaly[]
): Promise<VercelAnalyticsSection | null> {
  const token = process.env.VERCEL_TOKEN?.trim();
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  const projectId = process.env.VERCEL_PROJECT_ID?.trim();
  if (!token || !teamId || !projectId) return null;

  // The Vercel Analytics REST API is in beta — exact endpoint subject
  // to change. We use the public read endpoint which returns aggregate
  // page view counts for a date range. If it 404s, fall back gracefully.
  const params = new URLSearchParams({
    teamId,
    projectId,
    from: new Date(windowStart).toISOString(),
    to: new Date(windowEnd).toISOString(),
  });

  let res: Response;
  try {
    res = await fetch(`https://api.vercel.com/v1/web-analytics/views?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch (err) {
    anomalies.push({
      severity: "warning",
      code: "vercel_analytics_unreachable",
      message: `Couldn't reach Vercel Analytics API: ${err instanceof Error ? err.message : "unknown"}`,
      source: "vercel_analytics",
    });
    return null;
  }

  if (!res.ok) {
    anomalies.push({
      severity: "info",
      code: "vercel_analytics_unavailable",
      message: `Vercel Analytics API returned ${res.status} (endpoint may be private beta)`,
      source: "vercel_analytics",
    });
    return null;
  }

  const json = (await res.json()) as Record<string, unknown>;

  // Defensive parsing — Vercel may change the response shape
  const visitors = Number(json.visitors ?? json.uniqueVisitors ?? 0);
  const pageViews = Number(json.pageViews ?? json.views ?? 0);
  const bounceRate = Number(json.bounceRate ?? 0);
  const topReferrers = Array.isArray(json.topReferrers)
    ? (json.topReferrers as Array<Record<string, unknown>>).map((r) => ({
        source: String(r.source || r.referrer || "unknown"),
        count: Number(r.count || r.visitors || 0),
      }))
    : [];
  const topPages = Array.isArray(json.topPages)
    ? (json.topPages as Array<Record<string, unknown>>).map((p) => ({
        path: String(p.path || p.url || "unknown"),
        count: Number(p.count || p.views || 0),
      }))
    : [];

  if (visitors >= 50 && bounceRate > 0.85) {
    anomalies.push({
      severity: "warning",
      code: "high_bounce_rate",
      message: `Bounce rate ${(bounceRate * 100).toFixed(0)}% across ${visitors} visitors. Above 85% threshold.`,
      source: "vercel_analytics",
    });
  }

  return {
    visitors,
    page_views: pageViews,
    bounce_rate: bounceRate,
    top_referrers: topReferrers,
    top_pages: topPages,
    device_split: {},
  };
}
