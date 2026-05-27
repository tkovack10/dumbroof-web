/**
 * Ship 5 — canonical pricing lookup for the document-quality QA cron.
 *
 * Replaces the TS re-implementation in `market-prices.ts` (deleted) with a
 * direct Supabase query against the relational catalog (`pricing_market_prices`
 * COALESCE'd with `pricing_national_prices`). Same single source of truth the
 * backend's `pricing_db.get_prices_for_market()` reads from (Ship 2 + 3).
 *
 * Why direct DB query rather than a new REST endpoint: the cron already has
 * `supabaseAdmin` access (same row-level data). A REST endpoint would be one
 * more service to maintain + a network hop for no semantic gain. Direct query
 * IS the thin wrapper.
 *
 * The cron passes `supabaseAdmin` down to `checkLineItemPrices`, which calls
 * `fetchMarketPrices(supabase, marketCode)` once per claim. Result is cached
 * for the duration of the cron run (typically 1-5 claims per market).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Per-market price map keyed by short_key — the same shape the backend
 * `get_prices_for_market(market_id)` returns. */
export type MarketPrices = Record<string, number>;

// Module-level cache keyed by market_code. Cron run lifetime; cleared when
// the serverless function spins down.
const _cache = new Map<string, MarketPrices>();

/** Fetch all active priced line items for a market. Returns `{}` for unknown
 * markets. Mirrors the COALESCE(market, national) pattern in pricing_db.py. */
export async function fetchMarketPrices(
  supabase: SupabaseClient,
  marketCode: string | null | undefined,
): Promise<MarketPrices> {
  if (!marketCode) return {};
  const cached = _cache.get(marketCode);
  if (cached) return cached;

  // Two queries (parallelized): market-specific overrides + national defaults.
  // Client-side COALESCE matches the backend's get_prices_for_market.
  const [marketResp, nationalResp] = await Promise.all([
    supabase
      .from("pricing_market_prices")
      .select("unit_price, line_item:pricing_line_items!inner(short_key, status)")
      .eq("market_id", marketCode)
      .eq("line_item.status", "active"),
    supabase
      .from("pricing_national_prices")
      .select("unit_price, line_item:pricing_line_items!inner(short_key, status)")
      .eq("line_item.status", "active"),
  ]);

  const out: MarketPrices = {};
  // National first → market overrides win on conflict
  type Row = { unit_price: number; line_item: { short_key: string } | { short_key: string }[] };
  const apply = (rows: Row[] | null) => {
    if (!rows) return;
    for (const r of rows) {
      const li = Array.isArray(r.line_item) ? r.line_item[0] : r.line_item;
      if (!li?.short_key) continue;
      out[li.short_key] = Number(r.unit_price);
    }
  };
  apply((nationalResp.data as Row[] | null) ?? null);
  apply((marketResp.data as Row[] | null) ?? null);

  _cache.set(marketCode, out);
  return out;
}

/** True if the market exists in `pricing_markets` (active). */
export async function fetchMarketExists(
  supabase: SupabaseClient,
  marketCode: string | null | undefined,
): Promise<boolean> {
  if (!marketCode) return false;
  const { data, error } = await supabase
    .from("pricing_markets")
    .select("market_id")
    .eq("market_id", marketCode)
    .eq("status", "active")
    .maybeSingle();
  return Boolean(data && !error);
}

/** Market display name from `pricing_markets`. Empty string if unknown. */
export async function fetchMarketName(
  supabase: SupabaseClient,
  marketCode: string | null | undefined,
): Promise<string> {
  if (!marketCode) return "";
  const { data } = await supabase
    .from("pricing_markets")
    .select("name")
    .eq("market_id", marketCode)
    .maybeSingle();
  return (data?.name as string) ?? "";
}

/** Fallback description → short_key map for legacy claims (pre-Ship-3) whose
 * line_items don't carry `short_key`. Mirrors backend `_DESC_TO_PRICING_KEY`
 * for the items the QA cron actually sees in production. NOT exhaustive — a
 * line that doesn't match here is reported as "unmapped" by the cron (same
 * outcome as today's behavior). Post-Ship-3, every NEW line_item has
 * `short_key` stamped, so this table only matters for the legacy window. */
export const LEGACY_DESC_TO_SHORT_KEY: Readonly<Record<string, string>> = Object.freeze({
  "Remove 3 tab - 25 yr. - comp. shingle roofing - w/out felt": "3tab_remove",
  "3 tab - 25 yr. - comp. shingle roofing - w/out felt": "3tab_install",
  "Remove Laminated - comp. shingle rfg. - w/out felt": "laminated_remove",
  "Laminated - comp. shingle rfg. - w/out felt": "laminated_install",
  "Remove Laminated - High grd - comp. shingle rfg. - w/out felt": "laminated_high_remove",
  "Laminated - High grd - comp. shingle rfg. - w/out felt": "laminated_high_install",
  "Roofing felt - synthetic underlayment": "felt_synthetic",
  "Roofing felt - 30 lb.": "felt_30",
  "Ice & water barrier": "iws",
  "Drip edge - Install": "drip_edge",
  "Drip edge - Remove": "drip_edge_remove",
  "R&R Ridge cap - Standard profile - composition shingles": "ridge_cap_standard",
  "R&R Ridge cap - High profile - composition shingles": "ridge_cap_high",
  "Starter strip - universal": "starter_universal",
  "R&R Pipe jack": "pipe_jack",
  "R&R Roof vent - turtle type": "turtle_vent",
  "R&R Chimney flashing - average (32\" x 36\")": "chimney_flashing_ea",
  "R&R Chimney flashing - medium (32\" x 36\")": "chimney_flashing_ea", // French-batch alias
  "R&R Chimney flashing - large (32\" x 60\")": "chimney_flashing_large",
  "R&R Chimney flashing - small (24\" x 24\")": "chimney_flashing_small",
  "Step flashing - Install": "step_flashing",
  "Step flashing - Remove": "step_flashing_remove",
  "R&R Gutter / downspout - aluminum - up to 5\"": "gutter_aluminum",
  "R&R Gutter / downspout - aluminum - 6\"": "gutter_aluminum_6",
  "R&R Gutter / downspout - copper - up to 5\"": "gutter_copper",
  "R&R Gutter / downspout - copper - 6\"": "gutter_copper_6",
  "R&R Gutter / downspout - half round - aluminum - up to 5\"": "gutter_half_round_aluminum",
  "R&R Gutter / downspout - half round - aluminum - 6\"": "gutter_half_round_aluminum_6",
  "R&R Gutter / downspout - half round - copper - 6\"": "gutter_half_round_copper_6",
  "R&R Gutter guard/screen - High grade": "gutter_guard",
});

/** Resolve a line item to its short_key. Prefer the explicitly-stamped field
 * (Ship 3+); fall back to the legacy description map for pre-Ship-3 claims. */
export function resolveShortKey(li: {
  short_key?: string;
  description?: string;
}): string | null {
  if (li.short_key) return li.short_key;
  const desc = (li.description || "").trim();
  if (!desc) return null;
  return LEGACY_DESC_TO_SHORT_KEY[desc] ?? null;
}

/** Test seam — only use in tests. */
export function _clearCache(): void {
  _cache.clear();
}

/** Composite map indexed by [market_code][short_key] = unit_price. Lets the
 * cron run a single batch fetch upfront and then audit claims synchronously
 * (the existing qa-checks.ts pipeline stays sync — no Promise propagation). */
export type MarketPricesMap = Record<string, MarketPrices>;

/** Batch-fetch prices for a set of markets. The cron uses this to gather all
 * markets across the claims being audited in one async pass, then passes the
 * resulting map into gradeClaim. */
export async function fetchMarketPricesMap(
  supabase: SupabaseClient,
  marketCodes: ReadonlyArray<string>,
): Promise<MarketPricesMap> {
  const unique = Array.from(new Set(marketCodes.filter(Boolean)));
  const entries = await Promise.all(
    unique.map(async (code): Promise<[string, MarketPrices]> => {
      const prices = await fetchMarketPrices(supabase, code);
      return [code, prices];
    }),
  );
  return Object.fromEntries(entries);
}

/** Active market names (for display). Single query for all requested codes. */
export async function fetchMarketNameMap(
  supabase: SupabaseClient,
  marketCodes: ReadonlyArray<string>,
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(marketCodes.filter(Boolean)));
  if (unique.length === 0) return {};
  const { data } = await supabase
    .from("pricing_markets")
    .select("market_id, name")
    .in("market_id", unique);
  const out: Record<string, string> = {};
  for (const r of (data as Array<{ market_id: string; name: string }> | null) ?? []) {
    out[r.market_id] = r.name;
  }
  return out;
}
