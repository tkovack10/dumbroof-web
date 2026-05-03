/**
 * Market-aware price lookup for the document-quality cron.
 *
 * Loads `data/all-markets.json` (a copy of backend/pricing/all-markets.json,
 * refreshed manually when Alfonso publishes new data) and exposes a
 * description+action keyed lookup matching the backend's
 * xactimate_lookup.get_market_prices() helper.
 *
 * Used by qa-checks.ts:checkLineItemPrices to verify each line_item's
 * unit_price matches the resolved market for that claim.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const allMarketsRaw: AllMarketsFile = require("./data/all-markets.json");

type AllItemEntry = {
  description: string;
  unit?: string;
  price: number | null;
};

type Market = {
  name: string;
  zip: string | string[];
  pending: boolean;
  items: Record<string, { price: number | null; unit: string; description: string; xactCode: string }>;
  allItems: AllItemEntry[];
};

type AllMarketsFile = {
  generated: string;
  priceListVersion: string;
  markets: Record<string, Market>;
};

// Action prefix patterns matching XactRegistry._infer_action in xactimate_lookup.py
function inferAction(rawDesc: string): "remove" | "install" | "r&r" {
  if (!rawDesc) return "install";
  const s = rawDesc.trimStart().toLowerCase();
  if (s.startsWith("r&r ") || s.startsWith("r & r ")) return "r&r";
  if (s.startsWith("remove ") || s.startsWith("tear off ") || s.startsWith("tear out ") || s.startsWith("detach")) return "remove";
  return "install";
}

// Mirror of backend _clean_desc — strip action prefix, qualifiers, brackets, hyphen runs.
const PFX_RE = /^(r&r\s+|remove\s+|tear\s*off\s+|tear\s*out\s+|install\s+|detach\s*&?\s*reset\s+)/i;
const QUALIFIER_RE = /\s*[-–—]\s*(?:\d+["″]?\s*to\s*\d+["″]?\s*tall|w\/(?:out)?\s+felt|premium\s+grade|high\s+grade|standard\s+grade|red|gray|grey|black|green|brown|\d+\s*(?:lb|oz|mil|mm)\b\.?)/gi;
const SECTION_RE = /^(shed|dwelling\s*roof|front\s*elevation|rear\s*elevation|left\s*elevation|right\s*elevation|debris\s*removal|interior|garage|porch)\s*[-–—]\s*/i;
const ITEM_NUM_RE = /\s*[-–—]?\s*item\s*\d+\s*$/i;
const STRUCT_PREFIX_RE = /^\[.*?\]\s*/i;
const HYPHEN_RUN_RE = /(?<=\S{2})\s*[-–—]\s*(?=\S{2})/g;

export function cleanDesc(desc: string): string {
  let d = desc.toLowerCase().trim();
  d = d.replace(STRUCT_PREFIX_RE, "").trim();
  d = d.replace(SECTION_RE, "").trim();
  d = d.replace(ITEM_NUM_RE, "").trim();
  d = d.replace(PFX_RE, "").trim();
  d = d.replace(QUALIFIER_RE, "").trim();
  d = d.replace(/\s*\(revised[^)]*\)/gi, "").trim();
  d = d.replace(/\s*\(pre-appraisal[^)]*\)/gi, "").trim();
  d = d.replace(HYPHEN_RUN_RE, " ");
  d = d.replace(/\s+/g, " ").trim();
  return d;
}

const _marketPriceCache = new Map<string, Map<string, number>>();

/** Load market prices keyed by `${cleanedDesc}|${action}`. Returns empty map if market_code unknown. */
export function getMarketPrices(marketCode: string | null | undefined): Map<string, number> {
  if (!marketCode) return new Map();
  const cached = _marketPriceCache.get(marketCode);
  if (cached) return cached;

  const market = allMarketsRaw.markets?.[marketCode];
  if (!market || !market.allItems) {
    _marketPriceCache.set(marketCode, new Map());
    return new Map();
  }

  const out = new Map<string, number>();
  for (const ai of market.allItems) {
    if (!ai.description || ai.price == null) continue;
    const action = inferAction(ai.description);
    const cleaned = cleanDesc(ai.description);
    out.set(`${cleaned}|${action}`, ai.price);
    // also index without action for callers without prefix
    const fallbackKey = `${cleaned}|*`;
    if (!out.has(fallbackKey)) out.set(fallbackKey, ai.price);
  }
  _marketPriceCache.set(marketCode, out);
  return out;
}

/** Look up a single line item's expected price. Returns null if no match. */
export function expectedPrice(
  marketCode: string | null | undefined,
  description: string,
  explicitAction?: "remove" | "install" | "r&r" | null,
): number | null {
  const prices = getMarketPrices(marketCode);
  if (prices.size === 0) return null;
  const action = explicitAction || inferAction(description);
  const cleaned = cleanDesc(description);
  return prices.get(`${cleaned}|${action}`) ?? prices.get(`${cleaned}|*`) ?? null;
}

export function marketExists(marketCode: string | null | undefined): boolean {
  if (!marketCode) return false;
  return Boolean(allMarketsRaw.markets?.[marketCode]);
}

export function getMarketName(marketCode: string | null | undefined): string {
  if (!marketCode) return "";
  return allMarketsRaw.markets?.[marketCode]?.name ?? "";
}
