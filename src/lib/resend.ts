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
