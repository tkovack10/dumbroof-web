/**
 * 5-touch nurture sequence for signups who haven't created a claim yet.
 *
 * Sender is always `tom@dumbroof.ai` (per memory feedback_upgrade_email_sender.md).
 * Voice matches `src/app/api/cron/enrich-incomplete-profiles/route.ts`:
 * direct, written by Tom in first person, no marketing-speak, signed
 * "Tom / CEO, DumbRoof / 267-679-1504".
 *
 * Each function takes { first_name, company_name, email } and returns
 * { subject, html }. HTML uses the same inline-styled wrapper as the
 * existing outreach emails so it renders identically in Gmail/Outlook.
 */

export type NurtureTouchKey =
  | "day_0_welcome"
  | "day_3_proof"
  | "day_7_objection"
  | "day_10_demo_invite"
  | "day_14_lastcall";

export interface NurtureInput {
  first_name: string;
  company_name: string;
  email: string;
}

export interface NurtureEmail {
  subject: string;
  html: string;
}

/** Pull a clean first name. Falls back to email-local-part, then "there". */
export function deriveFirstName(opts: { contact_name?: string | null; email: string }): string {
  const raw = (opts.contact_name || opts.email.split("@")[0] || "there")
    .split(/\s+/)[0]
    .replace(/[^a-zA-Z]/g, "");
  return raw || "there";
}

/** Standard footer/signature block. Tom's voice. */
const SIGNOFF = `<p style="margin:24px 0 0;">— Tom<br>CEO, DumbRoof<br>267-679-1504</p>
<p style="font-size:12px;color:#9ca3af;margin:16px 0 0;">Reply to this email and it lands in my inbox. <a href="https://www.dumbroof.ai/unsubscribe" style="color:#9ca3af;text-decoration:underline;">unsubscribe</a></p>`;

/** Outer container — matches the enrich-incomplete-profiles voice. */
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

// ============================================================================
// Touch 1 — Day 0: Welcome / 60-second first claim
// ============================================================================

export function day_0_welcome(input: NurtureInput): NurtureEmail {
  const first = input.first_name || "there";
  const subject = "You're in — here's your 60-second first claim";
  const html = shell(`<p>Hey ${first},</p>

<p>Tom here. You just signed up for DumbRoof — thank you. I want to make sure the first hour you spend in here actually delivers something useful, so let me cut to it.</p>

<p><strong>Your fastest path to value is one of these two:</strong></p>

<ol>
  <li><strong>Upload any roof photos you've got</strong> — an old claim, a recent inspection, even your own house. You'll get a forensic causation report back in about 5 minutes. That's the easiest way to see what this thing actually produces on real photos.</li>
  <li><strong>Drop a carrier scope you're already fighting</strong> — email it to <a href="mailto:claims@dumbroof.ai">claims@dumbroof.ai</a> and we'll run the supplement for you. PDF set lands back in your inbox.</li>
</ol>

${cta("https://www.dumbroof.ai/dashboard/new-claim", "Start my first claim →")}

<p>Three claims are free, they never expire, and you don't need a credit card to use them. The point is to see what comes out before you decide if it's worth real money.</p>

<p>If you'd rather I walk you through it on a call, just reply with "demo" and I'll send you a 15-minute slot.</p>`);
  return { subject, html };
}

// ============================================================================
// Touch 2 — Day 3: Social proof / case study
// ============================================================================

export function day_3_proof(input: NurtureInput): NurtureEmail {
  const first = input.first_name || "there";
  const subject = "What Dominic at XPRO did with DumbRoof last week";
  const html = shell(`<p>Hey ${first},</p>

<p>Quick story while it's fresh.</p>

<p>Dominic Mantia runs XPRO Elite Roofing in Ohio. Last week he uploaded a carrier scope where State Farm came back at $8,400 RCV on a hail claim. He had photos, an EagleView, and the denial letter — that's it.</p>

<p>DumbRoof ran the photos, built the forensic causation report, generated a side-by-side scope comparison, and produced a supplement letter with 14 line-item adjustments backed by code citations. <strong>New total: $23,711.</strong> Net supplement to the homeowner: $15,300.</p>

<p>The piece that mattered: <strong>he didn't write a word of it.</strong> Upload, wait 5 minutes, download the PDF set, send it to the desk adjuster.</p>

<p>If you've got a claim sitting on your desk right now where the carrier scope feels light, run it through this. Worst case, you waste 5 minutes. Best case, you find $15K your customer is owed.</p>

${cta("https://www.dumbroof.ai/dashboard/new-claim", "Run my first claim →")}

<p>Want me to send you the actual PDF Dominic got back? Reply "send sample" and I'll forward it (with the customer info redacted).</p>`);
  return { subject, html };
}

// ============================================================================
// Touch 3 — Day 7: Objection handling — "I don't have photos yet"
// ============================================================================

export function day_7_objection(input: NurtureInput): NurtureEmail {
  const first = input.first_name || "there";
  const subject = "What if you don't have photos yet?";
  const html = shell(`<p>Hey ${first},</p>

<p>I noticed you signed up about a week ago and haven't started a claim. That usually means one of two things:</p>

<ul>
  <li>You don't have a claim ready to run.</li>
  <li>You have one but you're missing photos / EagleView / something.</li>
</ul>

<p>Both are fixable.</p>

<p><strong>If you don't have photos yet:</strong> use supplement-only mode. Upload just the carrier scope and your EagleView, and DumbRoof will build the side-by-side scope comparison + supplement letter without any property photos. We do this for hundreds of claims where the inspection already happened and nobody documented it well. It still works.</p>

<p><strong>If you don't have a claim ready at all:</strong> email me anything you're working on — even rough — and my team will run it for you, end-to-end, no charge. We've done this for ~40 contractors so far. The goal is to put a real PDF set from a real claim of yours into your hands so you can see whether it's worth using going forward.</p>

${cta("mailto:claims@dumbroof.ai?subject=Run%20this%20for%20me", "Email me your claim →")}

<p>Send to <a href="mailto:claims@dumbroof.ai">claims@dumbroof.ai</a>. Carrier name, address, anything you've got attached. We'll take it from there.</p>`);
  return { subject, html };
}

// ============================================================================
// Touch 4 — Day 10: Personal demo invite
// ============================================================================

export function day_10_demo_invite(input: NurtureInput): NurtureEmail {
  const first = input.first_name || "there";
  const company = input.company_name?.trim() || "your team";
  const subject = "15 min with Tom — let me build your first claim live";
  const html = shell(`<p>Hey ${first},</p>

<p>Straight ask: do you want to spend 15 minutes on Zoom with me where I build your first DumbRoof claim live, in front of you, on a real claim of yours?</p>

<p>Here's how it works:</p>

<ul>
  <li>You bring one claim you're working — any phase, any carrier.</li>
  <li>We share screens. I upload your photos / carrier scope into ${company === "your team" ? "your" : company + "'s"} DumbRoof account.</li>
  <li>You see exactly what comes out the other side, in real time.</li>
  <li>You leave with a finished PDF set you can send to the carrier today.</li>
</ul>

<p>I do these myself, not a sales rep. The reason I'm offering is selfish: I learn more from watching a contractor use this on a real claim for 15 minutes than I learn from a month of internal testing. So if you say yes, you're doing me a favor too.</p>

${cta("mailto:tom@dumbroof.ai?subject=Yes%2C%20let%27s%20do%20the%2015-min%20demo&body=Best%20day%2Ftime%20for%20me%3A%0AOne%20claim%20I%27d%20like%20to%20use%3A%0A", "Reply yes and pick a time →")}

<p>Just reply with a day/time that works (mornings ET are best on my side) and the claim you want to use. I'll send the Zoom link back.</p>`);
  return { subject, html };
}

// ============================================================================
// Touch 5 — Day 14: Last call / urgency
// ============================================================================

export function day_14_lastcall(input: NurtureInput): NurtureEmail {
  const first = input.first_name || "there";
  const subject = "I'm closing your invite Friday";
  const html = shell(`<p>Hey ${first},</p>

<p>This is the last email I'll send before your account goes quiet.</p>

<p>Here's where things stand: you signed up about two weeks ago, you've got 3 free claims sitting unused, and I haven't seen anything from you. That's fine — I'd rather you not use the tool than use it half-heartedly. But I do clean out idle invites on Fridays so my team isn't tracking ghosts.</p>

<p><strong>If you still want in:</strong> reply to this email with literally anything — even just the word "keep" — and I'll extend your 3 free claims indefinitely, no questions, no nudges. They were going to expire end-of-week.</p>

<p><strong>If you want to actually use them but something's blocking you:</strong> tell me what it is. Wrong fit, can't figure out the UI, don't have a claim ready, price is wrong, whatever it is. I read every reply personally and I'll either fix it or tell you straight up if it's not a fit.</p>

${cta("mailto:tom@dumbroof.ai?subject=keep&body=Keep%20my%20DumbRoof%20account%20active.%0A%0AOne%20thing%20I%27d%20want%20to%20see%20fixed%3A", "Reply 'keep' →")}

<p>Either way, thanks for taking a look. I appreciate it.</p>`);
  return { subject, html };
}

// ============================================================================
// Registry — ordered for sequential processing
// ============================================================================

export interface TouchSpec {
  key: NurtureTouchKey;
  /** Earliest signup-age (hours) at which this touch is eligible. */
  windowStartHours: number;
  /** Latest signup-age (hours) at which this touch is eligible (exclusive). */
  windowEndHours: number;
  build: (input: NurtureInput) => NurtureEmail;
}

/**
 * Windows are wide enough to absorb a missed cron run (24h+ slack) so we don't
 * skip a user just because the daily cron landed a few hours late.
 *
 * Touch 1 starts at 12h so a same-day signup gets the welcome the next morning,
 * not the same evening.
 */
export const TOUCH_SPECS: TouchSpec[] = [
  {
    key: "day_0_welcome",
    windowStartHours: 12,
    windowEndHours: 72, // ~Day 0–3
    build: day_0_welcome,
  },
  {
    key: "day_3_proof",
    windowStartHours: 60, // Day 2.5
    windowEndHours: 144, // Day 6
    build: day_3_proof,
  },
  {
    key: "day_7_objection",
    windowStartHours: 144, // Day 6
    windowEndHours: 216, // Day 9
    build: day_7_objection,
  },
  {
    key: "day_10_demo_invite",
    windowStartHours: 216, // Day 9
    windowEndHours: 312, // Day 13
    build: day_10_demo_invite,
  },
  {
    key: "day_14_lastcall",
    windowStartHours: 312, // Day 13
    windowEndHours: 480, // Day 20
    build: day_14_lastcall,
  },
];
