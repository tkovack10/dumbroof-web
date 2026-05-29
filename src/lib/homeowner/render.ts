/**
 * Placeholder rendering for homeowner engagement emails.
 *
 * Shared by POST /api/homeowner/send-now (manual) and the
 * /api/cron/homeowner-sequences driver so both paths interpolate the
 * {{homeowner_name}} {{address}} {{claim_number}} {{carrier}} placeholders
 * identically. Mirrors the original inline logic in send-now/route.ts.
 *
 * HTML substitutions are escaped (the values come from editable Claim
 * fields and must not break or inject HTML). Template body_html itself is
 * admin-authored and trusted. Subject lines are plaintext — Resend handles
 * them safely, no escaping needed.
 */

export interface HomeownerClaimFields {
  homeowner_name?: string | null;
  address?: string | null;
  claim_number?: string | null;
  carrier?: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Strip any remaining {{...}} placeholders after interpolation so an unknown
 * or misspelled token (e.g. {{first_name}}) never reaches a homeowner as a
 * literal. Blanks the token rather than leaving it visible. Applied last, to
 * both HTML and plaintext outputs.
 */
function stripUnreplacedTokens(s: string): string {
  return s.replace(/\{\{\s*[\w.]+\s*\}\}/g, "");
}

/** Interpolate placeholders into an HTML body, escaping each substituted value. */
export function interpolateHtml(body: string, claim: HomeownerClaimFields): string {
  return stripUnreplacedTokens(
    body
      .replace(/\{\{\s*homeowner_name\s*\}\}/g, escapeHtml(claim.homeowner_name || "there"))
      .replace(/\{\{\s*address\s*\}\}/g, escapeHtml(claim.address || ""))
      .replace(/\{\{\s*claim_number\s*\}\}/g, escapeHtml(claim.claim_number || ""))
      .replace(/\{\{\s*carrier\s*\}\}/g, escapeHtml(claim.carrier || "your carrier")),
  );
}

/** Interpolate placeholders into a plaintext string (e.g. subject line). */
export function interpolatePlain(body: string, claim: HomeownerClaimFields): string {
  return stripUnreplacedTokens(
    body
      .replace(/\{\{\s*homeowner_name\s*\}\}/g, claim.homeowner_name || "there")
      .replace(/\{\{\s*address\s*\}\}/g, claim.address || "")
      .replace(/\{\{\s*claim_number\s*\}\}/g, claim.claim_number || "")
      .replace(/\{\{\s*carrier\s*\}\}/g, claim.carrier || "your carrier"),
  );
}

/**
 * Build the final subject + html for a homeowner email from a template.
 * Falls back to a minimal wrapper around body_text when body_html is empty
 * (mirrors send-now). body_text fallback is escaped then newline->br'd.
 */
export function renderHomeownerEmail(
  template: { subject?: string | null; body_html?: string | null; body_text?: string | null },
  claim: HomeownerClaimFields,
): { subject: string; html: string } {
  const subject = interpolatePlain(template.subject || "Update on your roof claim", claim);
  const html = template.body_html
    ? interpolateHtml(template.body_html, claim)
    : `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;padding:24px;">${interpolateHtml(
        escapeHtml(template.body_text || ""),
        claim,
      ).replace(/\n/g, "<br/>")}</div>`;
  return { subject, html };
}
