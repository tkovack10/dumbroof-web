/**
 * email-voice.ts — human, varied copy for the in-browser email composers
 * (the Supplement Composer and the Install-Supplement Builder).
 *
 * The AUTHORITATIVE AI-tell linter lives server-side in backend/email_voice.py:
 * send_claim_email() scrubs every carrier-facing body before it leaves. This
 * module's narrower job is to make the PREVIEW the user sees and edits already
 * read like a busy contractor wrote it — a warm greeting, a varied opener and
 * closer, no "Dear {carrier} Claims Department," and no ALL-CAPS letterhead.
 * Keep it light; the backend is the safety net.
 */

/** Deterministic per-seed variant pick (djb2 hash). Stable for one claim,
 *  varied across claims — so a high-volume sender doesn't repeat copy. */
export function pickVariant(seed: string, n: number): number {
  if (n <= 1) return 0;
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  return ((h % n) + n) % n;
}

// ── Supplement composer copy ────────────────────────────────────────────
const SUPPLEMENT_OPENERS: ((addr: string) => string)[] = [
  (a) => `We went back through the scope on ${a} and a few items the original estimate didn't pick up. Here's what we found and why each belongs in the repair:`,
  (a) => `Quick supplement on ${a}. Comparing the approved scope against the EagleView measurements and the actual conditions, these items should be added:`,
  (a) => `Following up on ${a} — once we walked the full scope against the measurements, a handful of items came up that aren't in the current estimate:`,
  (a) => `Wanted to get a supplement over to you on ${a}. A few storm- and code-driven items were missed on the first scope:`,
  (a) => `On ${a}: our scope and the approved one differ on a few line items the repair actually needs. They're documented below, tied to the measurements and code:`,
];

const SUPPLEMENT_CLOSERS: string[] = [
  "Could you take a look and get these added to the scope? Happy to walk through any line on it.",
  "Every quantity comes straight off the EagleView measurements and checks against code. Let me know what you need to get them added.",
  "Could you review and revise the scope when you get a chance? Glad to hop on a call if that's easier.",
  "Let me know if anything needs more backup and I'll get it right over to you.",
];

export function supplementOpener(seed: string, address: string): string {
  const pool = SUPPLEMENT_OPENERS;
  return pool[pickVariant(seed + "|sopener", pool.length)](address || "the property");
}
export function supplementCloser(seed: string): string {
  return SUPPLEMENT_CLOSERS[pickVariant(seed + "|scloser", SUPPLEMENT_CLOSERS.length)];
}

// ── Install-supplement builder copy ─────────────────────────────────────
const INSTALL_OPENERS: ((addr: string) => string)[] = [
  (a) => `Once we got into the tear-off on ${a}, a few items turned up that weren't visible before. Here's the install supplement:`,
  (a) => `Quick install supplement on ${a} — these came up after the crew opened things up:`,
  (a) => `Got an install supplement for you on ${a}. The items below were discovered during the work and are documented with photos:`,
];
export function installOpener(seed: string, address: string): string {
  return INSTALL_OPENERS[pickVariant(seed + "|iopener", INSTALL_OPENERS.length)](address || "the property");
}

// ── Shared sign-off ─────────────────────────────────────────────────────
const SIGN_OFFS = ["Thanks,", "Appreciate it,", "Thank you,", "Best,"];
export function signOff(seed: string): string {
  return SIGN_OFFS[pickVariant(seed + "|signoff", SIGN_OFFS.length)];
}

// ── Light client mirror of the server scrub ─────────────────────────────
// Only the few highest-confidence rewrites, so the preview matches what will
// actually send. The server gate (backend/email_voice.py) is authoritative.
const SCRUB_RULES: [RegExp, string][] = [
  [/I hope this (?:e-?mail|message|note|letter) finds you well[.,]?\s*/gi, ""],
  [/Please (?:do not|don'?t) hesitate to (?:contact|reach out to|call)\s+(?:us|me)[^.\n<]*\./gi, "Let me know if you need anything."],
  [/\bI wanted to reach out\b/gi, "I wanted to follow up"],
  [/We are writing (?:to you )?(?:regarding|in regard to|in reference to)\b/gi, "I'm writing about"],
];
export function scrubTells(text: string): string {
  let out = text;
  for (const [re, rep] of SCRUB_RULES) out = out.replace(re, rep);
  return out;
}
