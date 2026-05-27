-- Ship 1 of the pricing architecture rebuild (plan: lively-spinning-squid.md).
-- Relational pricing model that REPLACES the flat-JSON source of truth
-- (backend/pricing/all-markets.json). Created read-only ALONGSIDE the JSON:
-- the importer (scripts/import_pricing_to_tables.py) populates these from the
-- JSON, validate_market_prices flips bad markets to status='pending', and JSON
-- stays authoritative in production until Ships 2-7 cut reads over.
--
-- Core property (the whole point): one query owns (market, line_item) ->
-- unit_price. priced_market is market_id | 'national' | NULL. There is no code
-- path that returns NY for a Houston claim — the silent-fallback class (E202,
-- E210, E230, E251) becomes architecturally impossible.
--
-- NAMING: tables are prefixed `pricing_` because a per-claim `line_items` table
-- already exists (claim_id/qty/total/... — the normalized per-claim rows). The
-- pricing CATALOG is a different concept; prefixing avoids the collision and
-- groups all pricing reference tables. (Plan B.1/B.2 used bare names; reality
-- required the prefix.)
--
-- All pricing is GLOBAL platform reference data (NOT company-scoped): every
-- authenticated user reads the same catalog; only service_role (the importer /
-- admin ingestion endpoint) writes. Applied via Supabase MCP; kept here for
-- repo history + branch replay.

-- ── pricing_line_items: canonical catalog (~99, grows slowly) ──────────────
CREATE TABLE IF NOT EXISTS pricing_line_items (
    line_item_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    short_key           text UNIQUE NOT NULL,           -- stable internal id (reuse _DESC_TO_PRICING_KEY)
    xact_code           text,                            -- Xactimate catalog code if known
    description         text NOT NULL,                   -- DISPLAY ONLY — never matched on
    unit                text,                            -- LF, SQ, EA, HR, SF, BX
    category            text,                            -- ROOFING, SIDING, GUTTERS, DEBRIS, ...
    is_national_rate    boolean NOT NULL DEFAULT false,  -- true = price does not vary by market
    is_mandatory        boolean NOT NULL DEFAULT false,  -- true = claim cannot ship if in scope unpriced
    -- Ship 14 reservation (code compliance as a build-time scope input). Doc 06
    -- writes into these instead of a parallel structure. Per-claim jurisdiction-
    -- resolved values live on the frozen line_item row in claims.claim_config.
    code_basis          text[],                          -- e.g. {'IRC R905.1.1','TX WPI-8 §3.2'}
    code_citation_text  text,
    -- Lifecycle: draft (in catalog, prices not yet validated, firewall ignores) ->
    -- active (production, firewall watches) -> inactive (unused — e.g. specialty
    -- roofing USARM never claims; kept for historical reads, firewall ignores, never
    -- priced onto a claim so a corrupt value can't ship). Add a new item later:
    -- insert as 'draft' -> populate market_prices -> validate -> flip to 'active'.
    status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft','inactive','deprecated')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ── pricing_markets: one row per priced market (~145) ──────────────────────
CREATE TABLE IF NOT EXISTS pricing_markets (
    market_id     text PRIMARY KEY,                      -- e.g. 'TXHO8X_APR26'
    name          text,                                  -- 'Houston Texas'
    state         char(2),
    region        text,                                  -- for nearest-priced-state fallback
    latitude      numeric,
    longitude     numeric,
    status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','archived')),
    source_batch  text,                                  -- 'alfonso_french_2026_04' — corruption tracing
    last_updated  timestamptz NOT NULL DEFAULT now()
);

-- ── pricing_market_prices: the actual prices (~99 x 145 ≈ 14k) ─────────────
CREATE TABLE IF NOT EXISTS pricing_market_prices (
    market_id     text NOT NULL REFERENCES pricing_markets(market_id) ON DELETE CASCADE,
    line_item_id  uuid NOT NULL REFERENCES pricing_line_items(line_item_id) ON DELETE CASCADE,
    unit_price    numeric(10,2) NOT NULL,
    source_batch  text,
    source_note   text,                                  -- 'scraped from Alfonso PDF p.14'
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (market_id, line_item_id)                -- exactly one price per item per market
);
CREATE INDEX IF NOT EXISTS idx_pricing_market_prices_line_item ON pricing_market_prices(line_item_id);

-- ── pricing_national_prices: for is_national_rate items ────────────────────
CREATE TABLE IF NOT EXISTS pricing_national_prices (
    line_item_id  uuid PRIMARY KEY REFERENCES pricing_line_items(line_item_id) ON DELETE CASCADE,
    unit_price    numeric(10,2) NOT NULL,
    source_batch  text,
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── pricing_address_resolver: zip -> market (replaces zip_to_market.json) ──
CREATE TABLE IF NOT EXISTS pricing_address_resolver (
    zip          text PRIMARY KEY,                       -- 5-digit, or 3-digit prefix rows (see importer)
    county_fips  text,
    market_id    text REFERENCES pricing_markets(market_id) ON DELETE SET NULL
);

-- ── RLS: global reference data — authenticated read, service_role write ────
ALTER TABLE pricing_line_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_markets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_market_prices   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_national_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_address_resolver ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read pricing_line_items" ON pricing_line_items;
CREATE POLICY "auth read pricing_line_items" ON pricing_line_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth read pricing_markets" ON pricing_markets;
CREATE POLICY "auth read pricing_markets" ON pricing_markets FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth read pricing_market_prices" ON pricing_market_prices;
CREATE POLICY "auth read pricing_market_prices" ON pricing_market_prices FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth read pricing_national_prices" ON pricing_national_prices;
CREATE POLICY "auth read pricing_national_prices" ON pricing_national_prices FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth read pricing_address_resolver" ON pricing_address_resolver;
CREATE POLICY "auth read pricing_address_resolver" ON pricing_address_resolver FOR SELECT TO authenticated USING (true);
