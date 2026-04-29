// Personal / consumer email domains — never indicate shared employer.
// Mirror of backend/brand_isolation.py PERSONAL_DOMAINS (kept in sync
// manually). When you add a domain here, add it there too.
//
// Used by:
// - /api/signup/check-domain (don't suggest "join your team" on personal emails)
// - components/company-profile-gate (warn that team auto-link is disabled)
// - any future cross-account brand-resolution code
export const PERSONAL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "aol.com", "live.com", "msn.com", "me.com", "protonmail.com",
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "cox.net",
  "charter.net", "earthlink.net", "ymail.com", "rocketmail.com",
  "googlemail.com", "duck.com", "hey.com", "fastmail.com",
]);

export function isPersonalDomain(emailOrDomain: string | null | undefined): boolean {
  if (!emailOrDomain) return false;
  let s = emailOrDomain.trim().toLowerCase();
  if (s.includes("@")) {
    s = s.split("@").pop() || "";
  }
  return PERSONAL_DOMAINS.has(s);
}
