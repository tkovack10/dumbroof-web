import { createSign } from "crypto";
import type { GA4Section, Anomaly } from "../types";

/**
 * Funnel Monitor — Google Analytics 4 Data API source.
 *
 * Auth: hand-rolled JWT signed with the service account private key (RS256),
 * exchanged at https://oauth2.googleapis.com/token for a 1-hour access token.
 * No SDK dependency — same raw-fetch pattern as the Anthropic AI insights
 * module. Keeps cold starts fast and the bundle small.
 *
 * Reads from a single batchRunReports call covering aggregate metrics, geo,
 * top pages, and a scroll event count. Returns null gracefully if either
 * GA4_SERVICE_ACCOUNT_B64 or GA4_PROPERTY_ID is missing.
 *
 * Setup: see ~/.claude/plans/snazzy-jingling-petal.md Phase 3.6.
 * Critical: the service account email must be granted Viewer access to
 * the GA4 property in Property Access Management or every call returns 403.
 */

type ServiceAccountJSON = {
  client_email: string;
  private_key: string;
  private_key_id: string;
};

let _accessTokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(sa: ServiceAccountJSON): Promise<string> {
  // Reuse cached token if it's still valid for >5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (_accessTokenCache && _accessTokenCache.expiresAt - now > 300) {
    return _accessTokenCache.token;
  }

  const header = { alg: "RS256", typ: "JWT", kid: sa.private_key_id };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const b64u = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64u(header)}.${b64u(payload)}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const signature = sign.sign(sa.private_key, "base64url");
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google OAuth token exchange failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  _accessTokenCache = {
    token: json.access_token,
    expiresAt: now + json.expires_in,
  };
  return json.access_token;
}

type RowMetric = { value: string };
type Row = { dimensionValues?: RowMetric[]; metricValues?: RowMetric[] };
type ReportResponse = { reports?: Array<{ rows?: Row[] }> };

export async function gatherGA4(
  windowStart: string,
  windowEnd: string,
  anomalies: Anomaly[]
): Promise<GA4Section | null> {
  const b64 = process.env.GA4_SERVICE_ACCOUNT_B64?.trim();
  const propertyId = process.env.GA4_PROPERTY_ID?.trim();
  if (!b64 || !propertyId) return null;

  let sa: ServiceAccountJSON;
  try {
    sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    anomalies.push({
      severity: "warning",
      code: "ga4_credentials_invalid",
      message: "GA4_SERVICE_ACCOUNT_B64 is not valid base64-encoded JSON.",
      source: "ga4",
    });
    return null;
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(sa);
  } catch (err) {
    anomalies.push({
      severity: "warning",
      code: "ga4_auth_failed",
      message: `GA4 auth failed: ${err instanceof Error ? err.message : "unknown"}`,
      source: "ga4",
    });
    return null;
  }

  // GA4 expects YYYY-MM-DD dates
  const since = windowStart.split("T")[0];
  const until = windowEnd.split("T")[0];

  // batchRunReports is more efficient than 4 separate calls
  const body = {
    requests: [
      // [0] Aggregate metrics for the window
      {
        dateRanges: [{ startDate: since, endDate: until }],
        metrics: [
          { name: "activeUsers" },
          { name: "screenPageViews" },
          { name: "engagementRate" },
          { name: "averageSessionDuration" },
          { name: "bounceRate" },
          { name: "conversions" },
        ],
      },
      // [1] Top 5 cities (Texas concentration check)
      {
        dateRanges: [{ startDate: since, endDate: until }],
        dimensions: [{ name: "city" }],
        metrics: [{ name: "activeUsers" }],
        orderBys: [{ desc: true, metric: { metricName: "activeUsers" } }],
        limit: 5,
      },
      // [2] Scroll event count (so we can compute scroll rate vs activeUsers)
      {
        dateRanges: [{ startDate: since, endDate: until }],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
        dimensionFilter: {
          filter: {
            fieldName: "eventName",
            stringFilter: { value: "scroll" },
          },
        },
      },
    ],
  };

  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    anomalies.push({
      severity: "warning",
      code: "ga4_unreachable",
      message: `Couldn't reach GA4 Data API: ${err instanceof Error ? err.message : "unknown"}`,
      source: "ga4",
    });
    return null;
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    anomalies.push({
      severity: "warning",
      code: "ga4_api_error",
      message: `GA4 Data API returned ${res.status}: ${errBody.slice(0, 200)}`,
      source: "ga4",
    });
    return null;
  }

  const data = (await res.json()) as ReportResponse;
  const reports = data.reports || [];

  // Report 0: aggregate metrics
  const aggRow = reports[0]?.rows?.[0]?.metricValues || [];
  const activeUsers = Number(aggRow[0]?.value || 0);
  // const pageViews = Number(aggRow[1]?.value || 0); // available if needed
  const engagementRate = Number(aggRow[2]?.value || 0);
  const avgSessionDuration = Number(aggRow[3]?.value || 0);
  // const bounceRate = Number(aggRow[4]?.value || 0); // available if needed
  const conversions = Number(aggRow[5]?.value || 0);

  // Report 1: top geo
  const topGeo = (reports[1]?.rows || []).map((r) => ({
    city: r.dimensionValues?.[0]?.value || "unknown",
    users: Number(r.metricValues?.[0]?.value || 0),
  }));

  // Report 2: scroll events. scrollUsers / activeUsers = scroll rate
  const scrollRow = reports[2]?.rows?.[0];
  const scrollUsers = Number(scrollRow?.metricValues?.[1]?.value || 0);
  const scrollRate = activeUsers > 0 ? scrollUsers / activeUsers : 0;

  // Anomalies
  if (activeUsers >= 100 && avgSessionDuration < 5) {
    anomalies.push({
      severity: "critical",
      code: "ga4_low_engagement_time",
      message: `Avg session duration ${avgSessionDuration.toFixed(1)}s across ${activeUsers} users. Above-the-fold isn't landing.`,
      source: "ga4",
    });
  }
  if (activeUsers >= 50 && scrollRate < 0.05) {
    anomalies.push({
      severity: "warning",
      code: "ga4_low_scroll_rate",
      message: `${(scrollRate * 100).toFixed(1)}% of ${activeUsers} users scrolled. Homepage is too long for the audience or the hero isn't compelling enough to read past.`,
      source: "ga4",
    });
  }
  if (activeUsers >= 50 && conversions === 0) {
    anomalies.push({
      severity: "info",
      code: "ga4_no_conversions",
      message: `${activeUsers} users in window but 0 GA4 conversions. Confirm key events are configured in GA4 dashboard (Phase 2.3 of the plan).`,
      source: "ga4",
    });
  }

  return {
    engagement_rate: engagementRate,
    avg_engagement_time_seconds: avgSessionDuration,
    scroll_rate: scrollRate,
    conversions,
    top_geo: topGeo,
  };
}
