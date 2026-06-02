/**
 * Shared address-pairing utility — the canonical way to match any inbound record
 * (AccuLynx calendar event, expense-sheet row, issues-sheet row, AccuLynx job) to
 * an existing DumbRoof claim / production job.
 *
 * Per Tom (2026-06-01): "we primarily use address as the job identifier … make
 * sure everything is able to be synced and paired by address too." So every sync
 * and import in the Production Manager reuses THIS module as the address resolver
 * (callers may layer claim#/job# on top, but address must always work).
 *
 * Match key = house number + first street-name word, disambiguated by 5-digit zip
 * when both sides have one. Robust to "address in the title + scope suffix"
 * (e.g. "16 willard st greene ny 30 sq evergreen mist") and to street-type words
 * ("Rd" vs "Road") being absent on one side.
 */

const STREET_SUFFIX =
  /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|place|pl|circle|cir|terrace|ter|way|highway|hwy|route|rt|apartment|apt|unit|suite|ste)\b/g;

/** Normalize a free-form address for fuzzy comparison. */
export function normalizeAddress(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/,?\s*(usa|united states)\.?$/i, "")
    .replace(/[.,#]/g, " ")
    .replace(STREET_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ParsedAddr {
  norm: string;
  houseNo: string; // digits only (e.g. "52c" → "52")
  street: string; // first alpha street token (e.g. "crestmont")
  zip: string; // 5-digit zip if present
}

/** Parse an address-ish string into match-key parts. Returns null if it doesn't
 *  begin with a house number (i.e. it isn't a street address). */
export function parseAddr(raw: string | null | undefined): ParsedAddr | null {
  const norm = normalizeAddress(raw);
  if (!norm) return null;
  const tokens = norm.split(" ").filter(Boolean);
  if (tokens.length === 0) return null;
  const m = tokens[0].match(/^(\d+)[a-z]?$/);
  if (!m) return null;
  const houseNo = m[1];
  const zip = tokens.find((t) => /^\d{5}$/.test(t)) || "";
  const street = tokens.slice(1).find((t) => /^[a-z]{2,}$/.test(t)) || "";
  if (!street) return null;
  return { norm, houseNo, street, zip };
}

function houseStreetKey(p: ParsedAddr): string {
  return `${p.houseNo}|${p.street}`;
}

export interface AddressIndex {
  byHouseStreet: Map<string, Array<{ id: string; zip: string }>>;
  size: number;
}

/** Build an address index over any rows that carry an id + address (claims,
 *  retail_jobs, production_jobs). Reused by every importer/sync. */
export function buildAddressIndex(
  rows: Array<{ id: string; address: string | null }>
): AddressIndex {
  const byHouseStreet = new Map<string, Array<{ id: string; zip: string }>>();
  let size = 0;
  for (const r of rows) {
    const p = parseAddr(r.address);
    if (!p) continue;
    const key = houseStreetKey(p);
    const arr = byHouseStreet.get(key) || [];
    arr.push({ id: r.id, zip: p.zip });
    byHouseStreet.set(key, arr);
    size++;
  }
  return { byHouseStreet, size };
}

/** Match a free-form address (from a title, location, or sheet cell) to an indexed
 *  row. Zip disambiguates ties; ambiguous-without-zip returns null (safe). */
export function matchAddress(
  addressText: string | null | undefined,
  index: AddressIndex
): { id: string; method: "address" } | null {
  const p = parseAddr(addressText);
  if (!p) return null;
  const candidates = index.byHouseStreet.get(houseStreetKey(p));
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return { id: candidates[0].id, method: "address" };
  if (p.zip) {
    const z = candidates.find((c) => c.zip === p.zip);
    if (z) return { id: z.id, method: "address" };
  }
  return null;
}
