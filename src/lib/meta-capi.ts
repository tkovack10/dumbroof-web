import crypto from "crypto";

// .trim() is load-bearing: META_PIXEL_ID is configured as "766657346239697\n"
// (trailing newline). Without trimming, the pixel URL becomes .../766657346239697%0A/events
// and Meta 400s with "Object … does not exist", silently dropping every event.
// meta-conversions-api.ts already trims; this keeps the two CAPI paths consistent.
const PIXEL_ID = process.env.META_PIXEL_ID?.trim();
const ACCESS_TOKEN = process.env.META_CAPI_TOKEN?.trim();
const API_VERSION = "v21.0";

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

interface CAPIUserData {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;
  country?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
}

interface CAPIEvent {
  eventName: string;
  eventSourceUrl?: string;
  userData: CAPIUserData;
  customData?: Record<string, unknown>;
}

export async function sendCAPIEvent(event: CAPIEvent): Promise<void> {
  if (!PIXEL_ID || !ACCESS_TOKEN) return;

  const userData: Record<string, string> = {};
  if (event.userData.email) userData.em = sha256(event.userData.email);
  if (event.userData.phone) userData.ph = sha256(event.userData.phone.replace(/\D/g, ""));
  if (event.userData.firstName) userData.fn = sha256(event.userData.firstName);
  if (event.userData.lastName) userData.ln = sha256(event.userData.lastName);
  if (event.userData.city) userData.ct = sha256(event.userData.city);
  if (event.userData.state) userData.st = sha256(event.userData.state);
  if (event.userData.country) userData.country = sha256(event.userData.country);
  if (event.userData.clientIpAddress) userData.client_ip_address = event.userData.clientIpAddress;
  if (event.userData.clientUserAgent) userData.client_user_agent = event.userData.clientUserAgent;

  const payload = {
    data: [
      {
        event_name: event.eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "website",
        event_source_url: event.eventSourceUrl || "https://www.dumbroof.ai",
        user_data: userData,
        ...(event.customData ? { custom_data: event.customData } : {}),
      },
    ],
  };

  try {
    await fetch(
      `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
  } catch {
    // Fire-and-forget — don't break the request if CAPI fails
  }
}
