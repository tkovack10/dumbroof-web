import type { ResendSection, Anomaly } from "../types";

/**
 * Funnel Monitor — Resend delivery stats.
 * Pulls the last 100 emails and computes per-status counts. Resend doesn't
 * yet have a date-range query, so we filter client-side by created_at.
 */
export async function gatherResend(
  windowStart: string,
  windowEnd: string,
  anomalies: Anomaly[]
): Promise<ResendSection | null> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;

  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails?limit=100", {
      headers: { Authorization: `Bearer ${apiKey}` },
      // Resend recommends short cache TTL, but for cron we want fresh
      cache: "no-store",
    });
  } catch (err) {
    anomalies.push({
      severity: "warning",
      code: "resend_unreachable",
      message: `Couldn't reach Resend API: ${err instanceof Error ? err.message : "unknown"}`,
      source: "resend",
    });
    return null;
  }

  if (!res.ok) {
    anomalies.push({
      severity: "warning",
      code: "resend_api_error",
      message: `Resend API returned ${res.status}`,
      source: "resend",
    });
    return null;
  }

  const json = (await res.json()) as { data?: Array<{ created_at: string; last_event: string }> };
  const all = json.data || [];

  // Filter to the window
  const inWindow = all.filter((e) => {
    const ts = e.created_at;
    return ts >= windowStart && ts < windowEnd;
  });

  let delivered = 0;
  let bounced = 0;
  let complained = 0;
  let opened = 0;
  let clicked = 0;
  for (const e of inWindow) {
    switch (e.last_event) {
      case "delivered":
        delivered++;
        break;
      case "bounced":
        bounced++;
        break;
      case "complained":
        complained++;
        break;
      case "opened":
        opened++;
        delivered++; // opened implies delivered
        break;
      case "clicked":
        clicked++;
        opened++;
        delivered++;
        break;
    }
  }

  const total = inWindow.length;
  const deliveryRate = total > 0 ? delivered / total : 0;
  const openRate = delivered > 0 ? opened / delivered : 0;
  const clickRate = delivered > 0 ? clicked / delivered : 0;

  // Anomalies
  if (complained > 0) {
    anomalies.push({
      severity: "critical",
      code: "resend_spam_complaint",
      message: `${complained} spam complaint(s) in this window. Domain reputation at risk.`,
      source: "resend",
    });
  }
  if (total >= 5 && deliveryRate < 0.9) {
    anomalies.push({
      severity: "critical",
      code: "resend_low_delivery",
      message: `Delivery rate is ${(deliveryRate * 100).toFixed(0)}% (${delivered}/${total}). Below 90% threshold.`,
      source: "resend",
    });
  }
  if (delivered >= 10 && openRate < 0.05) {
    anomalies.push({
      severity: "warning",
      code: "resend_low_open_rate",
      message: `Open rate is ${(openRate * 100).toFixed(1)}% across ${delivered} delivered emails. Likely landing in Promotions tab or being stripped.`,
      source: "resend",
    });
  }

  return {
    total_sent: total,
    delivered,
    bounced,
    complained,
    opened,
    clicked,
    delivery_rate: deliveryRate,
    open_rate: openRate,
    click_rate: clickRate,
  };
}
