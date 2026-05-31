/**
 * Storm-trigger email templates (Track B of the repeat-usage system).
 *
 * Fires off NOAA SPC hail/wind events, NOT the calendar drip. When a qualifying
 * event hits a past user's state (or an adjacent one), we send an immediate
 * "there's work in your backyard" nudge. State-level copy (Tom: region, not
 * zip). Hail and wind read differently, so each has its own variant.
 *
 * From `tom@dumbroof.ai`, Richard/Tom voice. SMS variants (smsBuild) are used
 * once the Twilio/10DLC path is live (Phase 3); until then the cron sends the
 * email variant.
 */

import { START_CLAIM_URL } from "./repeat-usage-templates";

export interface StormEmailInput {
  first_name: string;
  /** 2-letter state the event hit (e.g. "TX"). */
  state: string;
  /** County name as published by SPC (e.g. "MCCLAIN"). */
  county: string;
  /** Hail: inches (e.g. 1.75). Wind: mph (e.g. 70). */
  magnitude: number;
  /** Human date the event occurred (e.g. "May 30"). */
  date: string;
}

export interface StormEmail {
  subject: string;
  html: string;
}

const SIGNOFF = `<p style="margin:24px 0 0;">— Tom<br>CEO, DumbRoof<br>267-679-1504</p>
<p style="font-size:12px;color:#9ca3af;margin:16px 0 0;">You're getting this because there's a qualifying storm near you. Reply and it lands in my inbox. <a href="https://www.dumbroof.ai/unsubscribe" style="color:#9ca3af;text-decoration:underline;">unsubscribe</a></p>`;

function shell(body: string): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;color:#1a1a2e;line-height:1.55;">
  ${body}
  ${SIGNOFF}
</div>`;
}

function cta(label: string): string {
  return `<p style="margin:24px 0;"><a href="${START_CLAIM_URL}" style="display:inline-block;background:#0d2137;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">${label}</a></p>`;
}

/** Title-case a SPC county name ("ROGER MILLS" -> "Roger Mills"). */
function tc(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// ============================================================================
// Hail
// ============================================================================

export function storm_hail(input: StormEmailInput): StormEmail {
  const first = input.first_name || "there";
  const county = tc(input.county);
  const size = input.magnitude.toFixed(2).replace(/\.?0+$/, "");
  const subject = `Hail just hit ${input.state}. There's work coming.`;
  const html = shell(`<p>Hey ${first},</p>

<p>Heads up. NOAA just logged <strong>${size}" hail in ${county} County, ${input.state}</strong> on ${input.date}.</p>

<p>Storms like this don't stay in one zip — they kick off claims across the whole region. Homeowners near you are about to need exactly what you do, and whoever knocks first wins the job.</p>

<p>Get ahead of it. Prep a claim now so you're ready the second they say yes — tell Richard the address, drop in the photos, and the package is built in minutes.</p>

${cta("Start a storm claim →")}`);
  return { subject, html };
}

export const storm_hail_sms = (input: StormEmailInput): string =>
  `Richard 🧠 — ${input.magnitude.toFixed(2).replace(/\.?0+$/, "")}" hail just hit ${tc(input.county)} County, ${input.state} (${input.date}). New roofs across the area. Want me to prep a claim? ${START_CLAIM_URL}`;

// ============================================================================
// Wind
// ============================================================================

export function storm_wind(input: StormEmailInput): StormEmail {
  const first = input.first_name || "there";
  const county = tc(input.county);
  const mph = Math.round(input.magnitude);
  const subject = `${mph} mph winds just tore through ${input.state}.`;
  const html = shell(`<p>Hey ${first},</p>

<p>NOAA just clocked <strong>${mph} mph winds in ${county} County, ${input.state}</strong> on ${input.date}.</p>

<p>That's lifted shingles, torn flashing, and a lot of homeowners who don't know they've got a claim yet. You do.</p>

<p>Get ahead of it — tell Richard the address, drop in the photos, and you've got the full claim package in minutes, ready to send the second the homeowner signs.</p>

${cta("Start a storm claim →")}`);
  return { subject, html };
}

export const storm_wind_sms = (input: StormEmailInput): string =>
  `Richard 🧠 — ${Math.round(input.magnitude)} mph winds just hit ${input.state} (${input.date}). Claim territory. Want me to prep one? ${START_CLAIM_URL}`;

/** Pick the right variant for an event type. */
export function buildStormEmail(type: "hail" | "wind", input: StormEmailInput): StormEmail {
  return type === "hail" ? storm_hail(input) : storm_wind(input);
}
