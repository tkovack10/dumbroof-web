-- ============================================================
-- Imports v1 — generic CSV / AccuLynx live importer for installs + payments
-- ============================================================
-- Adds two new tables (import_runs, import_unmatched_rows) plus minor
-- columns on production_schedules + check_uploads so we can:
--   1. Audit every import (counts, file, user, when)
--   2. Roll back an import by deleting all rows tagged with the run_id
--   3. Persist unmatched rows so Tom can triage them (promote to claim /
--      retail estimate / dismiss) instead of silently dropping them
--   4. Allow check_uploads rows without a photo (CSV imports have no photo)
--
-- All RLS policies follow the same pattern as Phase 1 — service role
-- writes (importer impersonates admin via supabaseAdmin), team-scoped reads.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. import_runs — one row per import attempt (preview or applied)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_runs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id uuid NOT NULL,
    created_by uuid REFERENCES auth.users(id),
    kind text NOT NULL CHECK (kind IN ('installs', 'payments')),
    source text NOT NULL CHECK (source IN ('csv', 'acculynx_live', 'xlsx')),
    source_filename text,
    row_count int DEFAULT 0,
    matched_count int DEFAULT 0,
    skipped_count int DEFAULT 0,
    dedup_count int DEFAULT 0,
    unmatched_count int DEFAULT 0,
    error_count int DEFAULT 0,
    status text NOT NULL DEFAULT 'preview'
        CHECK (status IN ('preview', 'applied', 'rolled_back', 'failed')),
    summary jsonb,
    applied_at timestamptz,
    rolled_back_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_runs_company
    ON import_runs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_runs_status
    ON import_runs(company_id, status);

ALTER TABLE import_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins see import runs for their company"
    ON import_runs FOR SELECT
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid()
              AND is_admin = true
              AND company_id IS NOT NULL
        )
    );


-- ─────────────────────────────────────────────────────────────
-- 2. import_unmatched_rows — rows whose address could not be matched
--    to a claim or retail estimate. Tom triages these manually.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_unmatched_rows (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    import_run_id uuid NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
    company_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('installs', 'payments')),
    -- Raw source row (CSV row dict or AccuLynx record) — preserved so the
    -- triage UI can show the user the full original context.
    raw jsonb NOT NULL,
    -- Extracted fields for the triage UI (so we don't have to dig in raw):
    address text,
    homeowner_name text,
    payment_amount_cents bigint,
    payment_date date,
    install_date date,
    carrier text,
    job_number text,
    claim_number text,
    -- Triage state.
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'dismissed', 'converted_claim', 'converted_retail')),
    resolved_claim_id uuid REFERENCES claims(id),
    resolved_retail_job_id uuid,   -- retail_jobs FK omitted (no FK target registered in migrations; matches claims pattern)
    resolved_at timestamptz,
    resolved_by uuid REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unmatched_company_status
    ON import_unmatched_rows(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unmatched_run
    ON import_unmatched_rows(import_run_id);

ALTER TABLE import_unmatched_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins see unmatched rows for their company"
    ON import_unmatched_rows FOR SELECT
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid()
              AND is_admin = true
              AND company_id IS NOT NULL
        )
    );

CREATE POLICY "Admins update unmatched rows for their company"
    ON import_unmatched_rows FOR UPDATE
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid()
              AND is_admin = true
              AND company_id IS NOT NULL
        )
    );


-- ─────────────────────────────────────────────────────────────
-- 3. production_schedules — add import_run_id for rollback + provenance
-- ─────────────────────────────────────────────────────────────
ALTER TABLE production_schedules
    ADD COLUMN IF NOT EXISTS import_run_id uuid REFERENCES import_runs(id);

CREATE INDEX IF NOT EXISTS idx_production_schedules_import_run
    ON production_schedules(import_run_id)
    WHERE import_run_id IS NOT NULL;

-- Note: a partial unique index on `(claim_id, scheduled_at::date) where status='completed'`
-- would be nice for dedup, but timestamptz::date is not IMMUTABLE so Postgres rejects
-- it. Application-level dedup at insert time covers re-runs; revisit with a generated
-- column if double-inserts ever show up in practice.


-- ─────────────────────────────────────────────────────────────
-- 4. check_uploads — make photo nullable + add import + dedup fields
-- ─────────────────────────────────────────────────────────────
ALTER TABLE check_uploads
    ALTER COLUMN photo_path DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS import_run_id uuid REFERENCES import_runs(id),
    -- Dedup key — for CSV imports we set this to e.g. "ny_scope_install:row12"
    -- or the source check number, so re-uploading the same file doesn't
    -- create duplicate check_uploads rows for the same payment.
    ADD COLUMN IF NOT EXISTS external_ref text;

CREATE INDEX IF NOT EXISTS idx_check_uploads_import_run
    ON check_uploads(import_run_id)
    WHERE import_run_id IS NOT NULL;

-- Dedup: same claim + amount + received_at + external_ref => same row.
-- Partial index because external_ref is nullable for legacy rows.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_check_uploads_dedup
    ON check_uploads(claim_id, amount_cents, received_at, external_ref)
    WHERE external_ref IS NOT NULL;
