// Personal / consumer email domains — never indicate shared employer.
// The list lives in personal-domains.json (single source of truth).
// backend/brand_isolation.py reads the same file at import time so the
// Python and TS sets can never drift.
//
// Used by:
// - /api/signup/check-domain (don't suggest "join your team" on personal emails)
// - components/company-profile-gate (warn that team auto-link is disabled)
// - admin dashboard signup tab + brand-resolution backend code
import data from "./personal-domains.json";

// Normalize on construction so the Set never holds an uppercase entry that
// would silently miss a lookup. Mirrors the Python loader's strip+lower.
export const PERSONAL_DOMAINS: ReadonlySet<string> = new Set(
  (data.domains as string[]).map((d) => d.trim().toLowerCase()).filter(Boolean)
);

export function isPersonalDomain(emailOrDomain: string | null | undefined): boolean {
  if (!emailOrDomain) return false;
  let s = emailOrDomain.trim().toLowerCase();
  if (s.includes("@")) {
    s = s.split("@").pop() || "";
  }
  return PERSONAL_DOMAINS.has(s);
}
