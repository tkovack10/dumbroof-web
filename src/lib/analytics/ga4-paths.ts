import { createSign } from "crypto";

// Server-side GA4 Data API path queries for the live funnel monitor.
// Reuses the funnel-monitor's proven service-account JWT auth pattern
// (hand-rolled RS256 → token exchange, no SDK). Returns graceful empties if
// GA4_SERVICE_ACCOUNT_B64 / GA4_PROPERTY_ID are missing so the monitor never
// hard-fails. Vercel Web Analytics has no public API (dashboard only), so GA4
// is the queryable source for visitor paths — see funnel-monitor/sources/vercel-analytics.ts.

type SA = { client_email: string; private_key: string; private_key_id: string };
let _tok: { token: string; exp: number } | null = null;

async function accessToken(sa: SA): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_tok && _tok.exp - now > 300) return _tok.token;
  const b64u = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned =
    `${b64u({ alg: "RS256", typ: "JWT", kid: sa.private_key_id })}.` +
    b64u({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const jwt = `${unsigned}.${signer.sign(sa.private_key, "base64url")}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`GA4 token exchange ${r.status}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  _tok = { token: j.access_token, exp: now + j.expires_in };
  return j.access_token;
}

export type PathRow = { path: string; views: number; users: number; sessions: number };
export type VisitorPaths = {
  ok: boolean;
  activeNow: number;
  realtime: { page: string; users: number; views: number }[];
  topPaths: PathRow[];
  landingPages: { page: string; sessions: number; users: number }[];
  fbWhoopsUsers7d: number;
};

const num = (v?: string) => Number(v ?? 0) || 0;

export async function getVisitorPaths(): Promise<VisitorPaths> {
  const empty: VisitorPaths = { ok: false, activeNow: 0, realtime: [], topPaths: [], landingPages: [], fbWhoopsUsers7d: 0 };
  const b64 = process.env.GA4_SERVICE_ACCOUNT_B64?.trim();
  const propertyId = process.env.GA4_PROPERTY_ID?.trim();
  if (!b64 || !propertyId) return empty;
  let sa: SA;
  try {
    sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return empty;
  }
  let tok: string;
  try {
    tok = await accessToken(sa);
  } catch {
    return empty;
  }

  type Resp = { rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[] };
  const ga = async (method: string, body: object): Promise<Resp> => {
    try {
      const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:${method}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      return (await r.json()) as Resp;
    } catch {
      return {};
    }
  };

  const [rt, top, land, activeTotal] = await Promise.all([
    ga("runRealtimeReport", {
      dimensions: [{ name: "unifiedScreenName" }],
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
      limit: 20,
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
    }),
    ga("runReport", {
      dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }, { name: "sessions" }],
      limit: 30,
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    }),
    ga("runReport", {
      dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
      dimensions: [{ name: "landingPagePlusQueryString" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
      limit: 15,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    }),
    ga("runRealtimeReport", { metrics: [{ name: "activeUsers" }] }),
  ]);

  const topPaths: PathRow[] = (top.rows || []).map((r) => ({
    path: r.dimensionValues?.[0]?.value || "(unknown)",
    views: num(r.metricValues?.[0]?.value),
    users: num(r.metricValues?.[1]?.value),
    sessions: num(r.metricValues?.[2]?.value),
  }));

  return {
    ok: true,
    activeNow: num(activeTotal.rows?.[0]?.metricValues?.[0]?.value),
    realtime: (rt.rows || []).map((r) => ({
      page: r.dimensionValues?.[0]?.value || "(unknown)",
      users: num(r.metricValues?.[0]?.value),
      views: num(r.metricValues?.[1]?.value),
    })),
    topPaths,
    landingPages: (land.rows || []).map((r) => ({
      page: r.dimensionValues?.[0]?.value || "(unknown)",
      sessions: num(r.metricValues?.[0]?.value),
      users: num(r.metricValues?.[1]?.value),
    })),
    // FB ad landing = the biggest top-of-funnel leak; sum any /fb/* path users.
    fbWhoopsUsers7d: topPaths.filter((p) => p.path.startsWith("/fb")).reduce((s, p) => s + p.users, 0),
  };
}
