/**
 * UTM parameter capture and retrieval.
 *
 * Middleware stores UTM params + click IDs in a first-party cookie (dr_utm)
 * on first visit. Client and server helpers read the cookie back.
 *
 * Without this, ad spend is completely unattributed — we can't tell which
 * Meta ad set or Google campaign drove a signup.
 */

const UTM_COOKIE = "dr_utm";
const UTM_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

const UTM_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
const CLICK_IDS = ["fbclid", "gclid", "ttclid"] as const;

export type UtmData = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  fbclid?: string;
  gclid?: string;
  ttclid?: string;
};

/**
 * Extract UTM params and click IDs from a URL's search params.
 * Returns null if no tracking params are present.
 */
export function extractUtmFromUrl(url: URL): UtmData | null {
  const data: UtmData = {};
  let found = false;

  for (const key of UTM_PARAMS) {
    const val = url.searchParams.get(key);
    if (val) {
      data[key] = val;
      found = true;
    }
  }

  for (const key of CLICK_IDS) {
    const val = url.searchParams.get(key);
    if (val) {
      data[key] = val;
      found = true;
    }
  }

  return found ? data : null;
}

/**
 * Serialize UTM data to a cookie value (URL-encoded JSON).
 */
export function serializeUtm(data: UtmData): string {
  return encodeURIComponent(JSON.stringify(data));
}

/**
 * Parse UTM data from cookie value.
 */
export function parseUtmCookie(cookieValue: string | undefined): UtmData | null {
  if (!cookieValue) return null;
  try {
    return JSON.parse(decodeURIComponent(cookieValue)) as UtmData;
  } catch {
    return null;
  }
}

/**
 * Read UTM data from browser cookies (client-side).
 */
export function getUtmFromBrowser(): UtmData | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${UTM_COOKIE}=([^;]*)`));
  return match ? parseUtmCookie(match[1]) : null;
}

/**
 * Read UTM data from a request's cookie header (server-side).
 */
export function getUtmFromRequest(req: Request): UtmData | null {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`(?:^|; )${UTM_COOKIE}=([^;]*)`));
  return match ? parseUtmCookie(match[1]) : null;
}

export { UTM_COOKIE, UTM_MAX_AGE };
