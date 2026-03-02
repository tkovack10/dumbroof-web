-- ============================================================
-- DATA WAREHOUSE MIGRATION — DumbRoof Data Intelligence Platform
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Created: 2026-03-01
-- ============================================================

-- ============================================================
-- TABLE 1: photos — Universal photo registry with forensic tags
-- ============================================================
CREATE TABLE IF NOT EXISTS photos (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid REFERENCES claims(id) ON DELETE CASCADE,
    file_path text NOT NULL,
    storage_url text,
    annotation_key text,                    -- Legacy p03_01 format
    annotation_text text,                   -- Forensic description
    damage_type text,                       -- hail_dent | crack | missing | delamination | chalk_test | overview | none | wind_crease | lifted_tab | granule_loss | puncture | rust | corrosion | dent
    material text,                          -- aluminum_siding | vinyl_siding | comp_shingle_laminated | comp_shingle_3tab | metal_flashing | wood_trim | copper | slate | tile | tpo | etc.
    trade text,                             -- roofing | siding | gutters | window_wraps | flashing | general
    elevation text,                         -- front | rear | left | right | roof | detail | interior
    severity text,                          -- minor | moderate | severe | critical
    phash text,                             -- Perceptual hash for duplicate detection
    fraud_score smallint DEFAULT 0,         -- 0-100
    fraud_flags jsonb DEFAULT '[]'::jsonb,  -- Array of {type, tier, detail}
    gps_lat double precision,
    gps_lon double precision,
    exif_timestamp timestamptz,
    exif_software text,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_photos_claim_id ON photos(claim_id);
CREATE INDEX IF NOT EXISTS idx_photos_damage_type ON photos(damage_type);
CREATE INDEX IF NOT EXISTS idx_photos_material ON photos(material);
CREATE INDEX IF NOT EXISTS idx_photos_trade ON photos(trade);
CREATE INDEX IF NOT EXISTS idx_photos_phash ON photos(phash);

ALTER TABLE photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to photos"
    ON photos FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Users see their own claim photos"
    ON photos FOR SELECT
    USING (
        claim_id IN (SELECT id FROM claims WHERE user_id = auth.uid())
    );


-- ============================================================
-- TABLE 2: line_items — Every line item from every claim (dual-sided)
-- ============================================================
CREATE TABLE IF NOT EXISTS line_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid REFERENCES claims(id) ON DELETE CASCADE,
    category text NOT NULL,                 -- ROOFING | GUTTERS | SIDING | GENERAL | DEBRIS | ELEVATIONS | WINDOW_WRAPS
    description text NOT NULL,
    qty numeric NOT NULL DEFAULT 0,
    unit text NOT NULL DEFAULT 'EA',        -- SQ | SF | LF | EA | HR
    unit_price numeric NOT NULL DEFAULT 0,
    total numeric GENERATED ALWAYS AS (qty * unit_price) STORED,
    xactimate_code text,                    -- RFG LAMI, RFG REMV, etc.
    trade text,                             -- roofing | siding | gutters | window_wraps | flashing | general
    source text NOT NULL DEFAULT 'usarm',   -- usarm | carrier | settlement
    variance_note text,                     -- Why this differs from carrier's scope
    evidence_photos text[],                 -- Array of photo annotation keys
    price_list text,                        -- NYBI26, PAPI26, etc.
    region text,                            -- Binghamton NY, Philadelphia PA, etc.
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_items_claim_id ON line_items(claim_id);
CREATE INDEX IF NOT EXISTS idx_line_items_category ON line_items(category);
CREATE INDEX IF NOT EXISTS idx_line_items_source ON line_items(source);
CREATE INDEX IF NOT EXISTS idx_line_items_trade ON line_items(trade);

ALTER TABLE line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to line_items"
    ON line_items FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Users see their own claim line items"
    ON line_items FOR SELECT
    USING (
        claim_id IN (SELECT id FROM claims WHERE user_id = auth.uid())
    );


-- ============================================================
-- TABLE 3: carrier_tactics — Auto-learning carrier intelligence
-- ============================================================
CREATE TABLE IF NOT EXISTS carrier_tactics (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid REFERENCES claims(id) ON DELETE CASCADE,
    carrier text NOT NULL,                  -- State Farm, Allstate, NYCM, etc.
    tactic_type text NOT NULL,              -- denial | underpayment | spot_repair | partial_scope | depreciation | material_mismatch | code_dispute
    description text NOT NULL,              -- What the carrier did
    counter_argument text,                  -- What USARM argued back
    effective boolean,                      -- Did this argument work? NULL = unknown
    settlement_impact numeric DEFAULT 0,    -- Dollar impact of this argument
    trade text,                             -- Which trade this tactic targeted
    region text,                            -- Geographic region
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_carrier_tactics_carrier ON carrier_tactics(carrier);
CREATE INDEX IF NOT EXISTS idx_carrier_tactics_type ON carrier_tactics(tactic_type);
CREATE INDEX IF NOT EXISTS idx_carrier_tactics_effective ON carrier_tactics(effective);
CREATE INDEX IF NOT EXISTS idx_carrier_tactics_trade ON carrier_tactics(trade);

ALTER TABLE carrier_tactics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to carrier_tactics"
    ON carrier_tactics FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Authenticated users can read carrier tactics"
    ON carrier_tactics FOR SELECT
    USING (auth.role() = 'authenticated');


-- ============================================================
-- TABLE 4: claim_outcomes — Structured outcome data for predictions
-- ============================================================
CREATE TABLE IF NOT EXISTS claim_outcomes (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid REFERENCES claims(id) ON DELETE CASCADE UNIQUE,
    carrier text NOT NULL,
    region text,
    state text,                             -- NY, PA, NJ
    trades text[] DEFAULT '{}',             -- {roofing, siding, gutters}
    trade_count smallint DEFAULT 1,
    roof_area_sq numeric DEFAULT 0,
    wall_area_sf numeric DEFAULT 0,
    hail_size text,                         -- 1.00", 1.75", 2.50"
    original_carrier_rcv numeric DEFAULT 0, -- First carrier scope
    current_carrier_rcv numeric DEFAULT 0,  -- Latest carrier position
    usarm_rcv numeric DEFAULT 0,            -- Our scope total
    settlement_amount numeric DEFAULT 0,    -- Final settlement
    movement_amount numeric DEFAULT 0,      -- settlement - original_carrier
    movement_pct numeric DEFAULT 0,         -- (movement / original) * 100
    deductible numeric DEFAULT 0,
    o_and_p boolean DEFAULT false,
    win boolean DEFAULT false,
    went_to_appraisal boolean DEFAULT false,
    duration_days integer,                  -- Submission to settlement
    date_of_loss date,
    processing_date date DEFAULT CURRENT_DATE,
    source text DEFAULT 'web',              -- web | cli | manual
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claim_outcomes_carrier ON claim_outcomes(carrier);
CREATE INDEX IF NOT EXISTS idx_claim_outcomes_win ON claim_outcomes(win);
CREATE INDEX IF NOT EXISTS idx_claim_outcomes_state ON claim_outcomes(state);
CREATE INDEX IF NOT EXISTS idx_claim_outcomes_trades ON claim_outcomes USING GIN(trades);

ALTER TABLE claim_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to claim_outcomes"
    ON claim_outcomes FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Authenticated users can read claim outcomes"
    ON claim_outcomes FOR SELECT
    USING (auth.role() = 'authenticated');


-- ============================================================
-- TABLE 5: pricing_benchmarks — Dual-sided pricing intelligence
-- ============================================================
CREATE TABLE IF NOT EXISTS pricing_benchmarks (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid REFERENCES claims(id) ON DELETE SET NULL,
    region text NOT NULL,                   -- Binghamton NY, Philadelphia PA
    price_list text,                        -- NYBI26, PAPI26
    description text NOT NULL,              -- Line item description
    xactimate_code text,
    unit text NOT NULL,                     -- SQ, SF, LF, EA, HR
    unit_price numeric NOT NULL,
    source text NOT NULL,                   -- usarm | carrier | settlement
    category text,                          -- ROOFING, SIDING, GUTTERS, etc.
    effective_date date DEFAULT CURRENT_DATE,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_region ON pricing_benchmarks(region);
CREATE INDEX IF NOT EXISTS idx_pricing_source ON pricing_benchmarks(source);
CREATE INDEX IF NOT EXISTS idx_pricing_description ON pricing_benchmarks(description);
CREATE INDEX IF NOT EXISTS idx_pricing_price_list ON pricing_benchmarks(price_list);

ALTER TABLE pricing_benchmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to pricing_benchmarks"
    ON pricing_benchmarks FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Authenticated users can read pricing benchmarks"
    ON pricing_benchmarks FOR SELECT
    USING (auth.role() = 'authenticated');


-- ============================================================
-- TABLE 6: processing_logs — Telemetry for every Claude API call
-- ============================================================
CREATE TABLE IF NOT EXISTS processing_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid REFERENCES claims(id) ON DELETE CASCADE,
    step_name text NOT NULL,                -- extract_measurements | analyze_photos | extract_carrier_scope | extract_weather | build_config | synthesize_summary | synthesize_conclusion | diff_scopes | photo_integrity | weather_corroboration
    model text,                             -- claude-sonnet-4-6, claude-opus-4-6, etc.
    prompt_tokens integer DEFAULT 0,
    completion_tokens integer DEFAULT 0,
    total_cost numeric DEFAULT 0,           -- Estimated cost in USD
    duration_ms integer DEFAULT 0,
    success boolean DEFAULT true,
    error_message text,
    metadata jsonb DEFAULT '{}'::jsonb,     -- Extra context (batch number, photo count, etc.)
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_processing_logs_claim_id ON processing_logs(claim_id);
CREATE INDEX IF NOT EXISTS idx_processing_logs_step ON processing_logs(step_name);
CREATE INDEX IF NOT EXISTS idx_processing_logs_created ON processing_logs(created_at);

ALTER TABLE processing_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to processing_logs"
    ON processing_logs FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Users see their own processing logs"
    ON processing_logs FOR SELECT
    USING (
        claim_id IN (SELECT id FROM claims WHERE user_id = auth.uid())
    );


-- ============================================================
-- VIEWS — Pre-built analytics queries
-- ============================================================

-- Carrier win rates
CREATE OR REPLACE VIEW carrier_win_rates AS
SELECT
    carrier,
    COUNT(*) AS total_claims,
    COUNT(*) FILTER (WHERE win = true) AS wins,
    COUNT(*) FILTER (WHERE win = false) AS losses,
    ROUND(
        COUNT(*) FILTER (WHERE win = true)::numeric / NULLIF(COUNT(*), 0) * 100, 1
    ) AS win_rate_pct,
    ROUND(AVG(movement_pct) FILTER (WHERE win = true), 1) AS avg_win_movement_pct,
    ROUND(AVG(movement_amount) FILTER (WHERE win = true), 0) AS avg_win_movement_dollars,
    ROUND(AVG(usarm_rcv), 0) AS avg_usarm_rcv
FROM claim_outcomes
GROUP BY carrier
ORDER BY total_claims DESC;

-- Pricing comparison (USARM vs Carrier)
CREATE OR REPLACE VIEW pricing_comparison AS
SELECT
    description,
    unit,
    region,
    ROUND(AVG(unit_price) FILTER (WHERE source = 'usarm'), 2) AS avg_usarm_price,
    ROUND(AVG(unit_price) FILTER (WHERE source = 'carrier'), 2) AS avg_carrier_price,
    ROUND(
        AVG(unit_price) FILTER (WHERE source = 'usarm') -
        AVG(unit_price) FILTER (WHERE source = 'carrier'), 2
    ) AS price_gap,
    COUNT(*) FILTER (WHERE source = 'usarm') AS usarm_count,
    COUNT(*) FILTER (WHERE source = 'carrier') AS carrier_count
FROM pricing_benchmarks
GROUP BY description, unit, region
HAVING COUNT(*) > 1
ORDER BY price_gap DESC NULLS LAST;

-- Photo damage distribution
CREATE OR REPLACE VIEW photo_damage_distribution AS
SELECT
    damage_type,
    material,
    trade,
    COUNT(*) AS photo_count,
    ROUND(AVG(fraud_score), 1) AS avg_fraud_score
FROM photos
WHERE damage_type IS NOT NULL
GROUP BY damage_type, material, trade
ORDER BY photo_count DESC;

-- Processing cost per claim
CREATE OR REPLACE VIEW processing_cost_summary AS
SELECT
    claim_id,
    COUNT(*) AS total_steps,
    SUM(prompt_tokens) AS total_prompt_tokens,
    SUM(completion_tokens) AS total_completion_tokens,
    ROUND(SUM(total_cost)::numeric, 4) AS total_cost_usd,
    SUM(duration_ms) AS total_duration_ms,
    ROUND(SUM(duration_ms)::numeric / 1000, 1) AS total_duration_sec,
    COUNT(*) FILTER (WHERE success = false) AS failed_steps
FROM processing_logs
GROUP BY claim_id
ORDER BY total_cost_usd DESC;

-- Most effective arguments by carrier
CREATE OR REPLACE VIEW effective_arguments AS
SELECT
    carrier,
    tactic_type,
    counter_argument,
    COUNT(*) AS times_used,
    COUNT(*) FILTER (WHERE effective = true) AS times_effective,
    ROUND(
        COUNT(*) FILTER (WHERE effective = true)::numeric / NULLIF(COUNT(*), 0) * 100, 1
    ) AS effectiveness_pct,
    ROUND(AVG(settlement_impact) FILTER (WHERE effective = true), 0) AS avg_dollar_impact
FROM carrier_tactics
WHERE counter_argument IS NOT NULL
GROUP BY carrier, tactic_type, counter_argument
HAVING COUNT(*) >= 1
ORDER BY avg_dollar_impact DESC NULLS LAST;
