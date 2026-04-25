import { Resend } from "resend";

let _resend: Resend | null = null;

export function getResend(): Resend {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY not configured");
    }
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

/** Default "from" for transactional emails */
export const EMAIL_FROM = "Dumb Roof <hello@dumbroof.ai>";

/** Default "from" for claim-related notifications */
export const EMAIL_FROM_CLAIMS = "Dumb Roof Claims <claims@dumbroof.ai>";

/** Reply-to address */
export const EMAIL_REPLY_TO = "hello@dumbroof.ai";

/**
 * Platform team — always BCC'd on customer-facing notification emails.
 * Mirrors backend/claim_brain_email.py:DUMBROOF_TEAM_BCC. Source of truth
 * is Python; keep both lists in sync.
 */
const DUMBROOF_TEAM_BCC = [
  "claims@dumbroof.ai",
  "tom@dumbroof.ai",
  "matt@dumbroof.ai",
  "kristen@dumbroof.ai",
  "alfonso@dumbroof.ai",
];

const USARM_TEAM_BCC = ["tkovack@usaroofmasters.com"];

/**
 * BCC list for customer-facing notification emails. Mirrors Python
 * team_bcc_for(). USARM mailbox added only when recipient IS USARM.
 * Returns BCC only — platform addresses must NEVER appear on CC (E166).
 */
export function teamBccFor(opts: {
  recipientEmail?: string | null;
  companyName?: string | null;
}): string[] {
  const bcc = [...DUMBROOF_TEAM_BCC];
  const email = (opts.recipientEmail || "").toLowerCase();
  const company = (opts.companyName || "").trim().toUpperCase();
  const isUsarm =
    email.includes("@usaroofmasters.com") ||
    ["USA ROOF MASTERS", "USA ROOFMASTERS", "USAROOFMASTERS"].includes(company);
  if (isUsarm) bcc.push(...USARM_TEAM_BCC);
  return bcc;
}
