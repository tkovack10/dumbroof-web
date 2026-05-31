/**
 * Extract a 2-letter US state code from a company_profiles location.
 *
 * company_profiles has no discrete state column — location lives in
 * `city_state_zip` free text (e.g. "Bensalem, PA 19020") and sometimes in
 * `address`. We parse the state so storm alerts can match by region.
 */

import { VALID_STATES } from "./state-adjacency";

/**
 * Returns the 2-letter USPS state code, or null if none can be found.
 * Strategy: prefer the canonical ", ST 12345" pattern, then any standalone
 * valid 2-letter token (scanning right-to-left, since state precedes ZIP).
 */
export function parseState(cityStateZip?: string | null, address?: string | null): string | null {
  for (const raw of [cityStateZip, address]) {
    if (!raw) continue;
    const s = raw.toUpperCase();

    // Canonical "City, ST 12345" or "City, ST".
    const m = s.match(/,\s*([A-Z]{2})\b(?:\s+\d{5}(?:-\d{4})?)?\s*$/);
    if (m && VALID_STATES.has(m[1])) return m[1];

    // Fallback: scan 2-letter tokens right-to-left for a valid code.
    const tokens = s.split(/[^A-Z]+/).filter(Boolean);
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (tokens[i].length === 2 && VALID_STATES.has(tokens[i])) return tokens[i];
    }
  }
  return null;
}
