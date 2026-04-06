import { createHash, randomUUID } from "crypto";

/**
 * Meta Conversions API (CAPI) — server-side event firing.
 *
 * Why this exists: iOS 14+ blocks the browser pixel for ~25-40% of users,
 * which means Meta's algorithm only "sees" a fraction of the conversions
 * that actually happen. The Conversions API fires the same events from
 * the server, where iOS can't block them. Combined with `event_id`
 * deduplication, Meta merges browser + server events into one canonical
 * conversion record.
 *
 * Without this, Meta's optimization algorithm cannot learn which audiences
 * actually convert. As of 2026-04-06, dumbroof.ai's "New Leads Campaign"
 * spent $64.53 with 0 reported conversions while Supabase shows real
 * signups in the same window. The signups never reached Meta. This module
 * fixes that.
 *
 * Env vars required:
 *   META_CAPI_TOKEN  — Conversions API access token (from Events Manager)
 *   META_PIXEL_ID    — Facebook pixel ID
 * Optional:
 *   META_TEST_EVENT_CODE — when set, events are flagged as test events in
 *                          Events Manager → Test Events tab. Useful for
 *                          development. NEVER set this in production.
 *
 * Usage:
 *   import { sendCapiEvent, CapiEventName } from "@/lib/meta-conversions-api";
 *   await sendCapiEvent({
 *     eventName: CapiEventName.Lead,
 *     email: user.email,
 *     eventSourceUrl: "https://www.dumbroof.ai/",
 *     clientIpAddress: req.headers.get("x-forwarded-for") || undefined,
 *     clientUserAgent: req.headers.get("user-agent") || undefined,
 *     customData: { content_name: "mobile_magic_link" },
 *   });
 *
 * All callers should treat CAPI sends as fire-and-forget. Failures here
 * MUST NOT block the auth or signup flow.
 */

const CAPI_BASE = "https://graph.facebook.com/v19.0";

/**
 * Standard Meta event names. Custom events also work but standard ones
 * plug into Meta's optimization algorithms more reliably.
 */
export const CapiEventName = {
  Lead: "Lead",
  CompleteRegistration: "CompleteRegistration",
  SubmitApplication: "SubmitApplication",
  StartTrial: "StartTrial",
  ViewContent: "ViewContent",
  Subscribe: "Subscribe",
  Purchase: "Purchase",
} as const;
export type CapiEventNameValue = (typeof CapiEventName)[keyof typeof CapiEventName];

export type CapiEventOptions = {
  /** Standard or custom Meta event name */
  eventName: CapiEventNameValue | string;
  /** Plain email — we hash it before sending */
  email?: string;
  /** Plain phone (E.164 ideally, but we normalize) */
  phone?: string;
  /** First name (lowercased + hashed) */
  firstName?: string;
  /** Last name (lowercased + hashed) */
  lastName?: string;
  /** ISO 3166-1 alpha-2 country code */
  country?: string;
  /** Postal/zip */
  zip?: string;
  /** Page URL where the event happened */
  eventSourceUrl?: string;
  /** Client IP — pass through from request headers */
  clientIpAddress?: string;
  /** Client user agent — pass through from request headers */
  clientUserAgent?: string;
  /** Facebook click ID (from `?fbclid` query param or _fbc cookie) */
  fbc?: string;
  /** Facebook browser ID (from _fbp cookie) */
  fbp?: string;
  /**
   * Unique event ID for deduplication with browser pixel. If you fire the
   * same event from both pixel and CAPI with the same event_id, Meta merges
   * them. If omitted, we generate a UUID — but pass an explicit one when
   * you want to dedupe with a corresponding browser-side fire.
   */
  eventId?: string;
  /** Unix timestamp of the event. Defaults to now. */
  eventTime?: number;
  /** Custom event-level data — `{ value, currency, content_name, ... }` */
  customData?: Record<string, unknown>;
};

/**
 * SHA256 hash a normalized string per Meta's customer info requirements.
 * https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
 */
function hash(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return createHash("sha256").update(s.trim().toLowerCase()).digest("hex");
}

/**
 * Send a server-side conversion event to Meta. Fire-and-forget — caller
 * should NOT await this in a way that blocks the user-facing response.
 *
 * Returns `{ ok: true }` on success, `{ ok: false, reason }` on failure.
 * Never throws — failures are logged and swallowed because we never want
 * a CAPI hiccup to break the signup flow.
 */
export async function sendCapiEvent(opts: CapiEventOptions): Promise<{ ok: boolean; reason?: string }> {
  const token = process.env.META_CAPI_TOKEN?.trim();
  const pixelId = process.env.META_PIXEL_ID?.trim();
  const testCode = process.env.META_TEST_EVENT_CODE?.trim();

  if (!token || !pixelId) {
    return { ok: false, reason: "META_CAPI_TOKEN or META_PIXEL_ID not configured" };
  }

  const eventTime = opts.eventTime ?? Math.floor(Date.now() / 1000);
  const eventId = opts.eventId ?? randomUUID();

  // Build user_data block. Meta requires AT LEAST one identifier
  // (email/phone/external_id/etc) for the event to count.
  const userData: Record<string, unknown> = {};
  if (opts.email) userData.em = [hash(opts.email)];
  if (opts.phone) {
    // Strip non-digits before hashing — Meta wants raw digits, no formatting
    const phoneDigits = opts.phone.replace(/[^\d]/g, "");
    if (phoneDigits) userData.ph = [hash(phoneDigits)];
  }
  if (opts.firstName) userData.fn = [hash(opts.firstName)];
  if (opts.lastName) userData.ln = [hash(opts.lastName)];
  if (opts.country) userData.country = [hash(opts.country)];
  if (opts.zip) userData.zp = [hash(opts.zip)];
  if (opts.clientIpAddress) userData.client_ip_address = opts.clientIpAddress.split(",")[0].trim();
  if (opts.clientUserAgent) userData.client_user_agent = opts.clientUserAgent;
  if (opts.fbc) userData.fbc = opts.fbc;
  if (opts.fbp) userData.fbp = opts.fbp;

  if (Object.keys(userData).length === 0) {
    return { ok: false, reason: "No user identifier provided (need at least email/phone/etc)" };
  }

  const event = {
    event_name: opts.eventName,
    event_time: eventTime,
    event_id: eventId,
    action_source: "website",
    ...(opts.eventSourceUrl && { event_source_url: opts.eventSourceUrl }),
    user_data: userData,
    ...(opts.customData && { custom_data: opts.customData }),
  };

  const body: Record<string, unknown> = {
    data: [event],
    ...(testCode && { test_event_code: testCode }),
  };

  try {
    const res = await fetch(`${CAPI_BASE}/${pixelId}/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      // Short timeout — we never want CAPI to slow down the signup flow
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("[CAPI] failed", res.status, errBody.slice(0, 300));
      return { ok: false, reason: `Meta returned ${res.status}` };
    }

    const json = (await res.json().catch(() => ({}))) as { events_received?: number; fbtrace_id?: string };
    if (json.events_received !== 1) {
      console.warn("[CAPI] unexpected response", json);
    }
    return { ok: true };
  } catch (err) {
    console.error("[CAPI] threw", err);
    return { ok: false, reason: err instanceof Error ? err.message : "unknown" };
  }
}

/**
 * Helper to extract Meta tracking cookies + fbclid from a Next.js Request.
 * Pass these to `sendCapiEvent` so Meta can dedupe with the browser pixel.
 */
export function extractMetaTracking(req: Request): { fbc?: string; fbp?: string } {
  const cookieHeader = req.headers.get("cookie") || "";
  const cookies = Object.fromEntries(
    cookieHeader
      .split(";")
      .map((c) => c.trim().split("="))
      .filter(([k]) => k)
  );

  // Standard Meta cookie names
  const fbp = cookies._fbp;
  let fbc = cookies._fbc;

  // If _fbc cookie isn't set but the URL has ?fbclid=, construct it
  if (!fbc) {
    try {
      const url = new URL(req.url);
      const fbclid = url.searchParams.get("fbclid");
      if (fbclid) {
        fbc = `fb.1.${Date.now()}.${fbclid}`;
      }
    } catch {
      // ignore
    }
  }

  return { fbp, fbc };
}
