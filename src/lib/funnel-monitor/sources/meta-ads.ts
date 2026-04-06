import type { MetaAdsSection, Anomaly } from "../types";

/**
 * Funnel Monitor — Meta Marketing API.
 *
 * Requires META_ACCESS_TOKEN + META_AD_ACCOUNT_ID env vars.
 * Returns null gracefully if missing — Phase 6 will add the full
 * Meta Ads automation platform that uses this same token.
 *
 * Docs: https://developers.facebook.com/docs/marketing-api/insights
 */
export async function gatherMetaAds(
  windowStart: string,
  windowEnd: string,
  anomalies: Anomaly[]
): Promise<MetaAdsSection | null> {
  const token = process.env.META_ACCESS_TOKEN?.trim();
  const adAccount = process.env.META_AD_ACCOUNT_ID?.trim();
  if (!token || !adAccount) return null;

  // Meta uses YYYY-MM-DD for time_range
  const since = windowStart.split("T")[0];
  const until = windowEnd.split("T")[0];

  const fields = [
    "campaign_name",
    "campaign_id",
    "spend",
    "impressions",
    "clicks",
    "actions",
    "cost_per_action_type",
  ].join(",");

  const url = `https://graph.facebook.com/v19.0/${adAccount}/insights?level=campaign&fields=${fields}&time_range=${encodeURIComponent(
    JSON.stringify({ since, until })
  )}&access_token=${encodeURIComponent(token)}`;

  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (err) {
    anomalies.push({
      severity: "warning",
      code: "meta_unreachable",
      message: `Couldn't reach Meta Marketing API: ${err instanceof Error ? err.message : "unknown"}`,
      source: "meta_ads",
    });
    return null;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    anomalies.push({
      severity: "warning",
      code: "meta_api_error",
      message: `Meta Marketing API returned ${res.status}: ${body.slice(0, 200)}`,
      source: "meta_ads",
    });
    return null;
  }

  const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
  const rows = json.data || [];

  let totalSpend = 0;
  let totalConversions = 0;
  const campaigns = rows.map((row) => {
    const spendDollars = Number(row.spend || 0);
    const spendCents = Math.round(spendDollars * 100);
    const impressions = Number(row.impressions || 0);
    const clicks = Number(row.clicks || 0);
    const actions = (row.actions as Array<{ action_type: string; value: string }>) || [];
    // Pull conversions from a few likely action types
    let conversions = 0;
    for (const a of actions) {
      if (
        a.action_type === "complete_registration" ||
        a.action_type === "lead" ||
        a.action_type === "offsite_conversion.fb_pixel_complete_registration" ||
        a.action_type === "offsite_conversion.fb_pixel_lead"
      ) {
        conversions += Number(a.value || 0);
      }
    }
    const costPerConv = conversions > 0 ? Math.round(spendCents / conversions) : null;

    totalSpend += spendCents;
    totalConversions += conversions;

    // Anomaly: campaign spending >$50/day with <1 conversion
    if (spendCents >= 5000 && conversions < 1) {
      anomalies.push({
        severity: "critical",
        code: "meta_wasted_spend",
        message: `"${row.campaign_name}" spent $${(spendCents / 100).toFixed(2)} with 0 conversions in this window.`,
        source: "meta_ads",
      });
    } else if (costPerConv !== null && costPerConv > 5000) {
      anomalies.push({
        severity: "warning",
        code: "meta_high_cost_per_conversion",
        message: `"${row.campaign_name}" cost per conversion is $${(costPerConv / 100).toFixed(2)}.`,
        source: "meta_ads",
      });
    }

    return {
      name: String(row.campaign_name || row.campaign_id || "unknown"),
      status: "ACTIVE",
      spend_cents: spendCents,
      impressions,
      clicks,
      conversions,
      cost_per_conversion_cents: costPerConv,
    };
  });

  return {
    campaigns,
    total_spend_24h_cents: totalSpend,
    total_conversions_24h: totalConversions,
  };
}
