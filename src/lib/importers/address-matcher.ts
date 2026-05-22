/**
 * Address matcher — proven on 240 contact backfills (78% hit rate).
 * Port of /tmp/bulk_update.py's addr_key + city disambiguation logic.
 *
 * Strategy:
 *   1. Normalize address: lowercase, strip USA suffix, collapse whitespace,
 *      drop punctuation, expand abbreviations (street→st, avenue→ave, etc.)
 *   2. Build a coarse key: house_num + first non-directional street word
 *      e.g. "9 S Seward Ave" → "9 seward" (skips the "s" directional)
 *   3. Match by key; if multiple candidates, disambiguate by ZIP then city.
 *   4. If all candidates share the same canonical address (just formatting
 *      differences), pick the first.
 */

const DIRECTIONALS = new Set([
  "n", "s", "e", "w",
  "north", "south", "east", "west",
  "ne", "nw", "se", "sw",
]);

const ABBR_PAIRS: Array<[RegExp, string]> = [
  [/\bstreet\b/g, "st"],
  [/\bavenue\b/g, "ave"],
  [/\bdrive\b/g, "dr"],
  [/\broad\b/g, "rd"],
  [/\bboulevard\b/g, "blvd"],
  [/\blane\b/g, "ln"],
  [/\bcourt\b/g, "ct"],
  [/\bplace\b/g, "pl"],
  [/\bhwy\b/g, "route"],
  [/\bhighway\b/g, "route"],
  [/\bsaint\b/g, "st"],
];

export function normalizeAddr(s: string | null | undefined): string {
  if (!s) return "";
  let out = String(s).toLowerCase().trim();
  out = out.replace(/,\s*us(a)?\s*$/i, "");
  out = out.replace(/\s+/g, " ");
  out = out.replace(/[.,]/g, "");
  for (const [pat, repl] of ABBR_PAIRS) out = out.replace(pat, repl);
  return out;
}

/**
 * Coarse address key: house_num + first non-directional street word.
 * Returns null if the input doesn't start with a number.
 */
export function addrKey(s: string | null | undefined): string | null {
  if (!s) return null;
  const norm = normalizeAddr(s);
  const m = norm.match(/^(\d+)[-/]?\d*[a-z]?\s+(.+)/);
  if (!m) return null;
  const house = m[1];
  for (const token of m[2].split(" ")) {
    if (DIRECTIONALS.has(token)) continue;
    if (/^[a-z]/.test(token)) return `${house} ${token}`;
  }
  return null;
}

/** Extract the city token (parts after the first comma, before state). */
export function addrCity(s: string | null | undefined): string {
  if (!s) return "";
  const parts = normalizeAddr(s).split(",").map(p => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1] : "";
}

/** Extract a 5-digit ZIP if present anywhere in the string. */
export function addrZip(s: string | null | undefined): string {
  if (!s) return "";
  const m = String(s).match(/\b(\d{5})\b/);
  return m ? m[1] : "";
}

export type Claim = {
  id: string;
  slug: string | null;
  address: string;
  company_id: string;
  claim_number?: string | null;
  homeowner_name?: string | null;
};

export type MatchResult =
  | { status: "matched"; claim: Claim; note?: string }
  | { status: "ambiguous"; candidates: Claim[] }
  | { status: "unmatched"; reason: string };

/**
 * Build a lookup index from a list of claims. Returns:
 *   { byKey: Map<addrKey, Claim[]> }
 */
export function indexClaims(claims: Claim[]): Map<string, Claim[]> {
  const byKey = new Map<string, Claim[]>();
  for (const c of claims) {
    const k = addrKey(c.address);
    if (!k) continue;
    const arr = byKey.get(k) ?? [];
    arr.push(c);
    byKey.set(k, arr);
  }
  return byKey;
}

/**
 * Match one address (from an import row) against the indexed claims.
 *
 * @param sourceAddr - address from the CSV/XLSX row
 * @param sourceClaimNumber - optional claim number; if provided and matches,
 *                            short-circuits ambiguity
 * @param byKey - the addrKey index from indexClaims()
 * @param allClaims - the full claim list (for claim-number lookup)
 */
export function matchAddress(
  sourceAddr: string,
  sourceClaimNumber: string | null | undefined,
  byKey: Map<string, Claim[]>,
  allClaims: Claim[]
): MatchResult {
  // 1. Claim number exact match wins (covers cases where address differs in formatting).
  if (sourceClaimNumber) {
    const cn = sourceClaimNumber.trim().toLowerCase();
    if (cn) {
      const hit = allClaims.find(
        c => (c.claim_number || "").trim().toLowerCase() === cn
      );
      if (hit) return { status: "matched", claim: hit, note: "by claim_number" };
    }
  }

  // 2. Address-based key match.
  const key = addrKey(sourceAddr);
  if (!key) return { status: "unmatched", reason: "no_addr_key" };

  const cands = byKey.get(key) ?? [];
  if (cands.length === 0) return { status: "unmatched", reason: "no_candidates" };
  if (cands.length === 1) return { status: "matched", claim: cands[0] };

  // 3. Disambiguate multiple candidates by ZIP, then city, then canonical address.
  const sZip = addrZip(sourceAddr);
  if (sZip) {
    const zipHits = cands.filter(c => addrZip(c.address) === sZip);
    if (zipHits.length === 1) return { status: "matched", claim: zipHits[0], note: "zip" };
  }
  const sCity = addrCity(sourceAddr);
  if (sCity) {
    const cityHits = cands.filter(c => addrCity(c.address) === sCity);
    if (cityHits.length === 1) return { status: "matched", claim: cityHits[0], note: "city" };
    const loose = cands.filter(c => {
      const cc = addrCity(c.address);
      return cc && (cc.startsWith(sCity) || sCity.startsWith(cc));
    });
    if (loose.length === 1) return { status: "matched", claim: loose[0], note: "city-loose" };
  }

  // 4. If all candidates have the same normalized address, take the first.
  const normSet = new Set(cands.map(c => normalizeAddr(c.address)));
  if (normSet.size === 1) {
    return { status: "matched", claim: cands[0], note: "same-canonical" };
  }

  return { status: "ambiguous", candidates: cands };
}
