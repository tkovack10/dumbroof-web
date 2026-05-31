/**
 * Repeat-usage / reactivation sequence — 7 touches for contractors who HAVE
 * built a claim but have gone quiet (most-recent claim is aging and they
 * haven't started a new one). Goal: pull them back to build the NEXT claim.
 *
 * Replaces the original 3-touch (~10/21/35d) cadence, which was too lax — too
 * few contact points, single-channel, same "come back" message reworded. This
 * version is denser (7 touches over ~50 days) and every touch carries a
 * DISTINCT angle: ride-the-high → money → speed → social proof → zero-friction
 * → soft → keep-warm/breakup.
 *
 * Channel: two touches (reuse_d12, reuse_d35) are designed as SMS. Until the
 * Twilio/A2P-10DLC path is live (Phase 3) the cron renders them as short
 * "text-style" emails so we keep all 7 contact points now; `smsBody` carries
 * the real text copy for the flip. Everything sends from `tom@dumbroof.ai`,
 * Tom/Richard voice, no marketing-speak — matches src/lib/nurture/templates.ts.
 *
 * Storm-trigger touches (Track B) live in repeat-usage-storm-templates.ts and
 * fire off NOAA hail/wind events, not this calendar drip.
 */

export type RepeatUsageTouchKey =
  | "reuse_d3"
  | "reuse_d7"
  | "reuse_d12"
  | "reuse_d18"
  | "reuse_d25"
  | "reuse_d35"
  | "reuse_d50";

export type Channel = "email" | "sms";

export interface RepeatUsageInput {
  first_name: string;
  company_name: string;
  email: string;
}

export interface RepeatUsageEmail {
  subject: string;
  html: string;
}

/**
 * Action CTA target — the `?richard=new` deep-link (#97) auto-opens Richard in
 * create mode on the dashboard, dropping the contractor straight into "start the
 * next claim." The completion email's CTA points here too.
 */
export const START_CLAIM_URL = "https://www.dumbroof.ai/dashboard?richard=new";

/**
 * Done-for-you reply CTA — the HIGHEST-response pattern in DumbRoof's own email
 * data: a reply-to-a-human mailto ("Email me your claim → we'll run it for you")
 * out-pulled every app-link CTA on reply rate, and generic one-way blasts got ~0%.
 * Routes to claims@dumbroof.ai with a prefilled skeleton so a slammed contractor
 * can just reply + attach files. Offered alongside the self-serve Richard CTA.
 */
export const REPLY_MAILTO =
  "mailto:claims@dumbroof.ai?subject=Build%20my%20next%20claim&body=Address%3A%0ACarrier%3A%0AWhat%20I%20have%20(photos%20%2F%20carrier%20scope%20%2F%20EagleView)%3A%0A%0A(You%20can%20attach%20files%20to%20this%20reply.)";

/** Secondary "or just reply, we'll build it for you" line — the done-for-you option under the primary CTA. */
function replyLine(): string {
  return `<p style="margin:-10px 0 0;font-size:14px;color:#6b7280;">Too slammed to do it yourself? Just <a href="${REPLY_MAILTO}" style="color:#0d2137;font-weight:600;">reply with the address + carrier</a> and my team builds it for you, end-to-end.</p>`;
}

/** Average net supplement we cite in the "money" touch. Conservative; update from Supabase. */
export const AVG_SUPPLEMENT = "9,400";

const SIGNOFF = `<p style="margin:24px 0 0;">— Tom<br>CEO, DumbRoof<br>267-679-1504</p>
<p style="font-size:12px;color:#9ca3af;margin:16px 0 0;">Reply to this email and it lands in my inbox. <a href="https://www.dumbroof.ai/unsubscribe" style="color:#9ca3af;text-decoration:underline;">unsubscribe</a></p>`;

/** Outer container — matches src/lib/nurture/templates.ts so it renders identically. */
function shell(body: string): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;color:#1a1a2e;line-height:1.55;">
  ${body}
  ${SIGNOFF}
</div>`;
}

/** Primary CTA button (dark navy, matches Tom's existing emails). */
function cta(href: string, label: string): string {
  return `<p style="margin:24px 0;"><a href="${href}" style="display:inline-block;background:#0d2137;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">${label}</a></p>`;
}

/** Compact "text-style" shell for the interim-SMS touches — short, no big chrome. */
function note(body: string): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;color:#1a1a2e;line-height:1.6;font-size:16px;">
  ${body}
  <p style="margin:18px 0 0;">— Richard</p>
  <p style="font-size:12px;color:#9ca3af;margin:14px 0 0;">Reply and it reaches Tom. <a href="https://www.dumbroof.ai/unsubscribe" style="color:#9ca3af;text-decoration:underline;">unsubscribe</a></p>
</div>`;
}

// ============================================================================
// Touch 1 — Day 3 · Email · ride the high (the next one's already half-built)
// ============================================================================

export function reuse_d3(input: RepeatUsageInput): RepeatUsageEmail {
  const first = input.first_name || "there";
  const subject = "That was the hard part. (It wasn't.)";
  const html = shell(`<p>Hey ${first},</p>

<p>You just turned a pile of roof photos into a forensic claim package that holds up. That's the hard part done.</p>

<p>And here's the thing — I kept everything. Your pricing, your templates, your logo, the carrier playbooks. So the next one isn't a fresh start. It's photos in, package out.</p>

<p>Got another roof in the pipe?</p>

${cta(START_CLAIM_URL, "Start the next claim →")}

${replyLine()}`);
  return { subject, html };
}

// ============================================================================
// Touch 2 — Day 7 · Email · money (the supplement you're leaving on the table)
// ============================================================================

export function reuse_d7(input: RepeatUsageInput): RepeatUsageEmail {
  const first = input.first_name || "there";
  const subject = `The average DumbRoof supplement adds $${AVG_SUPPLEMENT}`;
  const html = shell(`<p>Hey ${first},</p>

<p>Quick math. Our supplements pull back an average of <strong>$${AVG_SUPPLEMENT}</strong> the carrier tried to leave on the table.</p>

<p>Got a job that came back short — a denial, a lowball, a "we don't cover that"? That's not a dead deal. That's a four-minute supplement.</p>

${cta(START_CLAIM_URL, "Build a supplement →")}

${replyLine()}

<p>Drop the carrier scope into the chat and Richard writes the whole thing — line-item comparison, code citations, the letter. You review it and send. Or just forward me the scope and we'll do it for you.</p>`);
  return { subject, html };
}

// ============================================================================
// Touch 3 — Day 12 · SMS (interim: short email) · speed nudge
// ============================================================================

export function reuse_d12(input: RepeatUsageInput): RepeatUsageEmail {
  const first = input.first_name || "there";
  const subject = "Got a roof to write up?";
  const html = note(`<p>It's Richard 🧠</p>
<p>Got a roof to write up? Send me the photos and I'll have the claim package back before your coffee's cold.</p>
<p><a href="${START_CLAIM_URL}" style="color:#0d2137;font-weight:600;">Start one here →</a></p>`);
  return { subject, html };
}

/** Real SMS copy for reuse_d12 — used once the Twilio/10DLC path is live (Phase 3). */
export const reuse_d12_sms = (input: RepeatUsageInput): string =>
  `Richard here 🧠 Got a roof to write up, ${input.first_name || "there"}? Send the photos and I'll have the claim package back before your coffee's cold. ${START_CLAIM_URL} — Reply STOP to opt out`;

// ============================================================================
// Touch 4 — Day 18 · Email · social proof
// ============================================================================

export function reuse_d18(input: RepeatUsageInput): RepeatUsageEmail {
  const first = input.first_name || "there";
  const subject = "Roofers built a stack of claims with Richard this week 👀";
  const html = shell(`<p>Hey ${first},</p>

<p>Contractors ran a pile of claims through Richard this week. Storm season's moving and the work's stacking up.</p>

<p>Not here to nag — just a nudge. When the next roof lands, I'm one tap away and everything's still set up the way you left it.</p>

${cta(START_CLAIM_URL, "Open Richard →")}`);
  return { subject, html };
}

// ============================================================================
// Touch 5 — Day 25 · Email · zero friction (your setup is still loaded)
// ============================================================================

export function reuse_d25(input: RepeatUsageInput): RepeatUsageEmail {
  const first = input.first_name || "there";
  const subject = "Your settings are still warm";
  const html = shell(`<p>Hey ${first},</p>

<p>Nothing expired. Your pricing, your logo, your carrier playbooks, your templates — all still loaded exactly how you had them.</p>

<p>Which means your next claim is basically pre-built. Drop in photos, get the package. That's it.</p>

${cta(START_CLAIM_URL, "Pick up where you left off →")}

${replyLine()}`);
  return { subject, html };
}

// ============================================================================
// Touch 6 — Day 35 · SMS (interim: short email) · soft
// ============================================================================

export function reuse_d35(input: RepeatUsageInput): RepeatUsageEmail {
  const first = input.first_name || "there";
  const subject = "Whenever the next one lands";
  const html = note(`<p>Hey ${first} — Richard here.</p>
<p>Whenever the next roof lands, I've got you. Same four-minute turnaround, everything still set up.</p>
<p><a href="${START_CLAIM_URL}" style="color:#0d2137;font-weight:600;">Open Richard →</a></p>`);
  return { subject, html };
}

/** Real SMS copy for reuse_d35 — used once the Twilio/10DLC path is live (Phase 3). */
export const reuse_d35_sms = (input: RepeatUsageInput): string =>
  `Whenever the next roof lands, I've got you${input.first_name ? `, ${input.first_name}` : ""} — same 4-min turnaround, everything still set up. — Richard 🧠 ${START_CLAIM_URL}`;

// ============================================================================
// Touch 7 — Day 50 · Email · keep-warm / breakup
// ============================================================================

export function reuse_d50(input: RepeatUsageInput): RepeatUsageEmail {
  const first = input.first_name || "there";
  const subject = "I'll be here.";
  const html = shell(`<p>Hey ${first},</p>

<p>I'll stop crowding your inbox. But your account doesn't go anywhere — your pricing, playbooks, and templates stay saved for whenever the next claim shows up. One tap and we're rolling, no setup.</p>

${cta(START_CLAIM_URL, "Open Richard →")}

<p style="color:#6b7280;">P.S. Big storm rolls through your area, I might break my silence to let you know — seems like the kind of thing you'd want.</p>`);
  return { subject, html };
}

// ============================================================================
// Registry — ordered; windows are HOURS SINCE THE USER'S MOST-RECENT CLAIM.
// ============================================================================

export interface RepeatUsageTouchSpec {
  key: RepeatUsageTouchKey;
  /** Designed channel. Interim: "sms" touches render as short emails until Phase 3. */
  channel: Channel;
  /** Earliest last-claim age (hours) at which this touch is eligible. */
  windowStartHours: number;
  /** Latest last-claim age (hours) at which this touch is eligible (exclusive). */
  windowEndHours: number;
  build: (input: RepeatUsageInput) => RepeatUsageEmail;
  /** Real SMS body builder (Phase 3) for channel === "sms" touches. */
  smsBuild?: (input: RepeatUsageInput) => string;
}

/**
 * Windows are wide (84h+) so a missed/late daily cron still catches the user,
 * and they never overlap, so a user matches at most one touch per run.
 * Dedup is keyed on (user, touch, most-recent-claim timestamp), so the whole
 * sequence re-arms automatically the moment the user starts a new claim.
 */
export const REPEAT_USAGE_TOUCH_SPECS: RepeatUsageTouchSpec[] = [
  { key: "reuse_d3", channel: "email", windowStartHours: 72, windowEndHours: 156, build: reuse_d3 }, // D3–D6.5
  { key: "reuse_d7", channel: "email", windowStartHours: 168, windowEndHours: 264, build: reuse_d7 }, // D7–D11
  { key: "reuse_d12", channel: "sms", windowStartHours: 288, windowEndHours: 408, build: reuse_d12, smsBuild: reuse_d12_sms }, // D12–D17
  { key: "reuse_d18", channel: "email", windowStartHours: 432, windowEndHours: 552, build: reuse_d18 }, // D18–D23
  { key: "reuse_d25", channel: "email", windowStartHours: 600, windowEndHours: 744, build: reuse_d25 }, // D25–D31
  { key: "reuse_d35", channel: "sms", windowStartHours: 840, windowEndHours: 984, build: reuse_d35, smsBuild: reuse_d35_sms }, // D35–D41
  { key: "reuse_d50", channel: "email", windowStartHours: 1200, windowEndHours: 1344, build: reuse_d50 }, // D50–D56
];
