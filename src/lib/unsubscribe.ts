/**
 * One-click unsubscribe — signed-token helpers.
 *
 * Email footers link to /unsubscribe?token=… so a recipient can opt out without
 * logging in, and we still know exactly who they are. The token is HMAC-signed
 * (not encrypted — it carries no secret, just a user_id + email) so it can't be
 * forged to unsubscribe a DIFFERENT user. We also emit RFC 8058 List-Unsubscribe
 * headers so Gmail/Yahoo render a native one-click unsubscribe (a hard
 * requirement of their 2024 bulk-sender rules — and a deliverability win for a
 * young sending domain).
 *
 * Secret: UNSUBSCRIBE_SECRET if set, else CRON_SECRET (already in prod, so this
 * works with zero new env). Tokens never expire — old emails must keep working.
 */
import crypto from "node:crypto";

const BASE_URL = "https://www.dumbroof.ai";

/** The exact bare URL hard-coded in every email template footer. */
export const BARE_UNSUB_URL = "https://www.dumbroof.ai/unsubscribe";

function secret(): string {
  const s = process.env.UNSUBSCRIBE_SECRET || process.env.CRON_SECRET;
  if (!s) throw new Error("UNSUBSCRIBE_SECRET / CRON_SECRET not configured");
  return s;
}

export interface UnsubPayload {
  /** company_profiles.user_id — the canonical opt-out key. */
  uid: string;
  /** Email, for display on the page + an audit trail. Optional. */
  e?: string;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Compact token: base64url(payloadJSON).base64url(hmacSHA256). */
export function signUnsubToken(payload: UnsubPayload): string {
  const body = b64url(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", secret()).update(body).digest();
  return `${body}.${b64url(mac)}`;
}

/** Verify + decode. Returns null on any tampering / malformed input. */
export function verifyUnsubToken(token: string): UnsubPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!decoded || typeof decoded.uid !== "string") return null;
    return decoded as UnsubPayload;
  } catch {
    return null;
  }
}

/** Visible footer link → the unsubscribe PAGE (confirm step, safe from prefetch). */
export function unsubPageUrl(payload: UnsubPayload): string {
  return `${BASE_URL}/unsubscribe?token=${encodeURIComponent(signUnsubToken(payload))}`;
}

/** One-click API URL → used only in the List-Unsubscribe header (Gmail POSTs here). */
export function unsubOneClickUrl(payload: UnsubPayload): string {
  return `${BASE_URL}/api/unsubscribe?token=${encodeURIComponent(signUnsubToken(payload))}`;
}

/** RFC 8058 headers for a recipient — add to resend.emails.send({ headers }). */
export function listUnsubscribeHeaders(payload: UnsubPayload): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubOneClickUrl(payload)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/** Swap the bare footer link for this recipient's tokenized page URL. */
export function personalizeUnsubLinks(html: string, payload: UnsubPayload): string {
  return html.split(BARE_UNSUB_URL).join(unsubPageUrl(payload));
}
