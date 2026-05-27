/**
 * Canonical, relational price source for the document-quality cron.
 *
 * Ship 5: this REPLACES the old `market-prices.ts`, which re-implemented the
 * backend's price lookup against a hand-copied `data/all-markets.json`. That
 * JSON copy was a second source of truth and drifted from the backend (the
 * Houston-as-Dallas class of bug). After Ship 2+3 the backend prices
 * EXCLUSIVELY from the relational Supabase tables via
 * `backend/pricing_db.py:get_prices_for_market(market_id)`:
 *
 *     pricing_line_items (active catalog) -> short_key, description
 *     pricing_market_prices  (per market) -> unit_price
 *     pricing_national_prices (fallback)  -> unit_price
 *     price = COALESCE(market_price, national_price)   # absent => unpriceable
 *
 * This module reads that SAME source for the QA price audit. It does NOT ship a
 * JSON copy of the price list — the only data it holds is whatever it reads from
 * Supabase at cron time, so it cannot drift.
 *
 * Matching: a claim's `line_items[].description` is free text (carries structure
 * brackets, section headers, item numbers, grade qualifiers). The catalog's
 * `description` column is the full Xactimate description including its action
 * prefix. We key both sides by `${cleanDesc(desc)}|${inferAction(desc)}` — the
 * SAME normalization the backend's `xactimate_lookup._clean_desc` / `_infer_action`
 * use to invert a description back to a catalog row. This is normalization of the
 * claim's own input, not a duplicate price table: the price values themselves come
 * straight from the relational tables.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/* ----------------------------------------------------------------------------
 * Description normalizers — mirror backend xactimate_lookup._infer_action /
 * _clean_desc. These normalize free-text descriptions (both the claim's and the
 * catalog's) so the same line item keys identically on both sides. They carry NO
 * price data.
 * ------------------------------------------------------------------------- */

export type Action = "remove" | "install" | "r&r";

/** Mirror of backend XactRegistry._infer_action. */
export function inferAction(rawDesc: string): Action {
  if (!rawDesc) return "install";
  const s = rawDesc.trimStart().toLowerCase();
  if (s.startsWith("r&r ") || s.startsWith("r & r ")) return "r&r";
  if (
    s.startsWith("remove ") ||
    s.startsWith("tear off ") ||
    s.startsWith("tear out ") ||
    s.startsWith("detach")
  ) {
    return "remove";
  }
  return "install";
}

// Mirror of backend _clean_desc — strip action prefix, qualifiers, brackets, hyphen runs.
const PFX_RE = /^(r&r\s+|remove\s+|tear\s*off\s+|tear\s*out\s+|install\s+|detach\s*&?\s*reset\s+)/i;
const QUALIFIER_RE = /\s*[-–—]\s*(?:\d+["″]?\s*to\s*\d+["″]?\s*tall|w\/(?:out)?\s+felt|premium\s+grade|high\s+grade|standard\s+grade|red|gray|grey|black|green|brown|\d+\s*(?:lb|oz|mil|mm)\b\.?)/gi;
const SECTION_RE = /^(shed|dwelling\s*roof|front\s*elevation|rear\s*elevation|left\s*elevation|right\s*elevation|debris\s*removal|interior|garage|porch)\s*[-–—]\s*/i;
const ITEM_NUM_RE = /\s*[-–—]?\s*item\s*\d+\s*$/i;
const STRUCT_PREFIX_RE = /^\[.*?\]\s*/i;
const HYPHEN_RUN_RE = /(?<=\S{2})\s*[-–—]\s*(?=\S{2})/g;

/** Mirror of backend _clean_desc. */
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

/* ----------------------------------------------------------------------------
 * Relational fetch + index
 * ------------------------------------------------------------------------- */

/**
 * A frozen, synchronous lookup over the relational price source for a fixed set
 * of markets. Built once per cron run by `fetchMarketPriceIndex`, then handed to
 * the (synchronous) QA checks. Mirrors get_prices_for_market's per-market
 * {short_key: COALESCE(market, national)} dict, re-keyed by `${clean}|${action}`
 * so a claim's free-text description can resolve to its market price.
 */
export class MarketPriceIndex {
  /** marketCode -> ("${clean}|${action}" -> price) */
  private readonly byMarket = new Map<string, Map<string, number>>();
  /** marketCode -> display name (from pricing_markets) */
  private readonly names = new Map<string, string>();

  constructor(
    byMarket: Map<string, Map<string, number>>,
    names: Map<string, string>,
  ) {
    this.byMarket = byMarket;
    this.names = names;
  }

  /** A market is "known" iff it has at least one priced active catalog item. */
  marketExists(marketCode: string | null | undefined): boolean {
    if (!marketCode) return false;
    return this.byMarket.has(marketCode);
  }

  getMarketName(marketCode: string | null | undefined): string {
    if (!marketCode) return "";
    return this.names.get(marketCode) ?? "";
  }

  /**
   * Expected unit price for a claim line item in this market, or null if the
   * description doesn't map to any priced active catalog item (legitimately
   * unmapped — e.g. siding/interior items outside the residential roofing
   * catalog, exactly as get_prices_for_market omits them).
   */
  expectedPrice(
    marketCode: string | null | undefined,
    description: string,
    explicitAction?: Action | null,
  ): number | null {
    if (!marketCode) return null;
    const prices = this.byMarket.get(marketCode);
    if (!prices || prices.size === 0) return null;
    const action = explicitAction || inferAction(description);
    const cleaned = cleanDesc(description);
    return prices.get(`${cleaned}|${action}`) ?? prices.get(`${cleaned}|*`) ?? null;
  }
}

type CatalogRow = { line_item_id: string; short_key: string; description: string };

/**
 * Fetch the relational price source for the given market codes and build a
 * synchronous index. This is the TS analog of pricing_db.get_prices_for_market,
 * but batched across the markets present in one cron window.
 *
 * Reads:
 *   - pricing_line_items (status='active')         -> catalog descriptions
 *   - pricing_national_prices                      -> national fallback price
 *   - pricing_market_prices (market_id IN markets) -> per-market price
 *   - pricing_markets (market_id IN markets)       -> display name + existence
 *
 * price = COALESCE(market_price, national_price); items with neither are omitted
 * (so they read as "unmapped", never as a $0 or NY-baseline price).
 */
export async function fetchMarketPriceIndex(
  client: SupabaseClient,
  marketCodes: string[],
): Promise<MarketPriceIndex> {
  const markets = Array.from(new Set(marketCodes.filter(Boolean)));
  if (markets.length === 0) {
    return new MarketPriceIndex(new Map(), new Map());
  }

  // 1. Active catalog — shared across all markets.
  const { data: catData, error: catErr } = await client
    .from("pricing_line_items")
    .select("line_item_id, short_key, description")
    .eq("status", "active");
  if (catErr) throw new Error(`pricing_line_items read failed: ${catErr.message}`);
  const catalog = (catData || []) as CatalogRow[];

  // 2. National fallback prices: line_item_id -> price.
  const { data: natData, error: natErr } = await client
    .from("pricing_national_prices")
    .select("line_item_id, unit_price");
  if (natErr) throw new Error(`pricing_national_prices read failed: ${natErr.message}`);
  const national = new Map<string, number>();
  for (const r of natData || []) {
    national.set(r.line_item_id as string, Number(r.unit_price));
  }

  // 3. Per-market prices for just the markets we need: (market, item) -> price.
  //    Paginate — a single market can have ~130 rows, and a window may span many.
  const marketPrices = new Map<string, Map<string, number>>();
  const PAGE = 1000;
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data: mpData, error: mpErr } = await client
      .from("pricing_market_prices")
      .select("market_id, line_item_id, unit_price")
      .in("market_id", markets)
      .range(from, from + PAGE - 1);
    if (mpErr) throw new Error(`pricing_market_prices read failed: ${mpErr.message}`);
    const rows = mpData || [];
    for (const r of rows) {
      const mid = r.market_id as string;
      let m = marketPrices.get(mid);
      if (!m) {
        m = new Map<string, number>();
        marketPrices.set(mid, m);
      }
      m.set(r.line_item_id as string, Number(r.unit_price));
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  // 4. Market display names + existence.
  const { data: mktData, error: mktErr } = await client
    .from("pricing_markets")
    .select("market_id, name")
    .in("market_id", markets);
  if (mktErr) throw new Error(`pricing_markets read failed: ${mktErr.message}`);
  const names = new Map<string, string>();
  for (const r of mktData || []) {
    names.set(r.market_id as string, (r.name as string) || "");
  }

  // 5. Build per-market `${clean}|${action}` -> price using COALESCE(market, national).
  const byMarket = new Map<string, Map<string, number>>();
  for (const market of markets) {
    const mp = marketPrices.get(market);
    // COALESCE: an item is priced if it has a market price OR a national price.
    // If the market has zero priced items, it stays out of byMarket -> marketExists=false.
    const out = new Map<string, number>();
    for (const item of catalog) {
      let price = mp?.get(item.line_item_id);
      if (price == null) price = national.get(item.line_item_id);
      if (price == null) continue;
      const action = inferAction(item.description);
      const cleaned = cleanDesc(item.description);
      // setdefault — first catalog row wins (matches backend out.setdefault).
      const key = `${cleaned}|${action}`;
      if (!out.has(key)) out.set(key, price);
      const fallback = `${cleaned}|*`;
      if (!out.has(fallback)) out.set(fallback, price);
    }
    if (out.size > 0) byMarket.set(market, out);
  }

  return new MarketPriceIndex(byMarket, names);
}
