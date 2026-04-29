/**
 * Meta Pixel — signup-side helper.
 *
 * Standardizes the browser-pixel half of our signup CAPI dedup pair:
 *
 *   1. Generates a stable `eventID` per signup so the same value can be
 *      passed to both the browser pixel AND the server-side CAPI fire
 *      via /api/notify-signup. Meta merges the two events into one.
 *   2. Re-inits the pixel with the user's email so this CompleteRegistration
 *      and any subsequent pixel events carry advanced-matching data
 *      (Meta auto-hashes when `em` is passed plain). Higher match quality
 *      = more events Meta can attribute = better optimizer signal = lower CPS.
 *   3. Fires the CompleteRegistration event with the dedup eventID.
 *
 * Why a helper: this exact 3-step is needed in 4 signup entry points
 * (signup page, hero form, mobile magic hero, login signup mode). Inlining
 * it everywhere drifts. One helper = one place to update.
 *
 * Caller still needs to:
 *   - Send `{ email, eventId }` to /api/notify-signup so CAPI fires with
 *     the SAME eventId. The server-side CAPI fire is what reaches iOS users
 *     where the pixel is blocked.
 */

const PIXEL_ID = "766657346239697"; // matches src/app/layout.tsx initial init

/** Generate a uuid for one CompleteRegistration event. crypto.randomUUID is universal in modern browsers. */
function newEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for ancient browsers — not cryptographically random but unique enough for dedup.
  return `er_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Fire the browser-side CompleteRegistration with eventID dedup + advanced
 * matching, AND return the eventId so the caller can forward it to CAPI.
 *
 * Returns the eventId regardless of whether fbq is loaded, so /api/notify-signup
 * gets called consistently on every signup. If fbq isn't loaded (ad blocker,
 * iOS, etc.) we still rely on CAPI to register the conversion server-side.
 */
export function firePixelSignup(params: { email: string; source?: string }): {
  eventId: string;
} {
  const eventId = newEventId();
  if (typeof window === "undefined") return { eventId };

  try {
    // Re-init the pixel with the email so every event in this session
    // (this CompleteRegistration plus any later pageviews) carries the
    // advanced-matching `em` field. Pixel SDK auto-hashes plain emails.
    window.fbq?.("init", PIXEL_ID, { em: params.email });
    window.fbq?.(
      "track",
      "CompleteRegistration",
      params.source ? { content_name: params.source } : {},
      { eventID: eventId }
    );
  } catch {
    // Never break the signup flow because of pixel issues.
  }

  return { eventId };
}
