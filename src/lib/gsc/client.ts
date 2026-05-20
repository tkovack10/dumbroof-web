/**
 * Google Search Console (Webmasters) API client.
 *
 * Auth: service-account JSON key, supplied via the `GOOGLE_SERVICE_ACCOUNT_JSON`
 * env var. Plain JSON or base64-encoded JSON are both accepted (Vercel env vars
 * mangle multi-line strings, so base64 is the safer Vercel pattern).
 *
 * Setup steps (one-time, Tom-side):
 *   1. Google Cloud Console -> APIs & Services -> Library: enable
 *      "Google Search Console API".
 *   2. IAM & Admin -> Service Accounts -> Create. Download JSON key.
 *   3. In Search Console (https://search.google.com/search-console),
 *      open the `dumbroof.ai` property -> Settings -> Users and permissions
 *      -> Add user. Paste the service account's email (looks like
 *      `name@project-id.iam.gserviceaccount.com`). Grant "Restricted" role.
 *   4. Base64-encode the JSON key:
 *        base64 -i service-account.json | pbcopy
 *      and paste it into Vercel as `GOOGLE_SERVICE_ACCOUNT_JSON`.
 *   5. (Optional) set `GSC_SITE_URL` to override the default
 *      `sc-domain:dumbroof.ai` site identifier.
 *
 * No domain-wide delegation is needed — GSC accepts the service account
 * directly as a verified property user.
 */
import { google, type webmasters_v3 } from "googleapis";

export const DEFAULT_SITE_URL = "sc-domain:dumbroof.ai";

/**
 * Returns true when the env var is present and decodes to JSON that looks
 * like a service account key. Cron routes call this to decide whether to
 * gracefully skip the run vs. attempt the GSC call.
 */
export function isGscConfigured(): boolean {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return false;
  try {
    const decoded = decodeServiceAccountJson(raw);
    return typeof decoded?.client_email === "string" && typeof decoded?.private_key === "string";
  } catch {
    return false;
  }
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  [k: string]: unknown;
}

function decodeServiceAccountJson(raw: string): ServiceAccountKey {
  // Try plain JSON first.
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as ServiceAccountKey;
  }
  // Otherwise treat as base64.
  const decoded = Buffer.from(trimmed, "base64").toString("utf8");
  return JSON.parse(decoded) as ServiceAccountKey;
}

let cachedClient: webmasters_v3.Webmasters | null = null;

function getClient(): webmasters_v3.Webmasters {
  if (cachedClient) return cachedClient;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  const credentials = decodeServiceAccountJson(raw);
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    // Vercel env vars escape newlines as literal `\n` — restore them.
    key: credentials.private_key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
  cachedClient = google.webmasters({ version: "v3", auth });
  return cachedClient;
}

export type GscDimension = "query" | "page" | "country" | "device" | "date" | "searchAppearance";

export interface SearchAnalyticsParams {
  /** ISO date string YYYY-MM-DD. */
  startDate: string;
  /** ISO date string YYYY-MM-DD. */
  endDate: string;
  /** GSC groups rows by these dimensions. */
  dimensions: GscDimension[];
  /** Max 25,000 per page; default 1000. */
  rowLimit?: number;
  /** Optional pagination cursor. */
  startRow?: number;
  /** Site identifier. Defaults to `sc-domain:dumbroof.ai`. */
  siteUrl?: string;
  /** "web" | "image" | "video" | "news" | "discover" | "googleNews". */
  searchType?: "web" | "image" | "video" | "news" | "discover" | "googleNews";
}

export interface GscRow {
  keys: string[];
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
}

export async function searchAnalytics(params: SearchAnalyticsParams): Promise<GscRow[]> {
  const client = getClient();
  const siteUrl = params.siteUrl ?? process.env.GSC_SITE_URL ?? DEFAULT_SITE_URL;
  const requestBody: webmasters_v3.Schema$SearchAnalyticsQueryRequest = {
    startDate: params.startDate,
    endDate: params.endDate,
    dimensions: params.dimensions,
    rowLimit: params.rowLimit ?? 1000,
    startRow: params.startRow ?? 0,
    searchType: params.searchType ?? "web",
  };
  const res = await client.searchanalytics.query({ siteUrl, requestBody });
  const rows: webmasters_v3.Schema$ApiDataRow[] = res.data.rows ?? [];
  return rows.map((r) => ({
    keys: (r.keys ?? []).map(String),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    ctr: Number(r.ctr ?? 0),
    position: Number(r.position ?? 0),
  }));
}
