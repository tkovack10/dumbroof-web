-- Phase 3 — Job P&L + Receipts
-- ============================================================
-- Job-cost tracking. Reps/admins snap a photo of a receipt or invoice;
-- Richard OCRs vendor + amount (out of scope for this migration — the
-- field exists for the API to populate). Each expense is tagged by type
-- so the per-job P&L view can break down material vs labor vs dumpster
-- vs misc.
--
-- Per-job net margin =
--   claims.financials.total (or sum of paid check_uploads) - sum(job_expenses)
--
-- HARD CONSTRAINT: no edits to the claims table. Expenses are a new
-- table that references claims(id).

-- ============================================================
-- 1. JOB EXPENSES
-- ============================================================
CREATE TABLE IF NOT EXISTS job_expenses (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    company_id uuid NOT NULL,
    uploader_user_id uuid REFERENCES auth.users(id),
    type text NOT NULL CHECK (type IN (
        'material',
        'labor',
        'dumpster',
        'permit',
        'rental',
        'subcontractor',
        'misc'
    )),
    amount_cents bigint NOT NULL,
    vendor text,
    description text,
    receipt_path text,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    ocr_extracted jsonb,
    line_items jsonb,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_expenses_company ON job_expenses(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_expenses_claim ON job_expenses(claim_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_expenses_type ON job_expenses(company_id, type);

ALTER TABLE job_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team sees their company's expenses"
    ON job_expenses FOR SELECT
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND company_id IS NOT NULL
        )
    );

CREATE POLICY "Team members insert expenses for their company"
    ON job_expenses FOR INSERT
    WITH CHECK (
        uploader_user_id = auth.uid()
        AND company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND company_id IS NOT NULL
        )
    );

CREATE POLICY "Admins update expenses for their company"
    ON job_expenses FOR UPDATE
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid()
              AND is_admin = true
              AND company_id IS NOT NULL
        )
    );

CREATE POLICY "Admins delete expenses for their company"
    ON job_expenses FOR DELETE
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid()
              AND is_admin = true
              AND company_id IS NOT NULL
        )
    );

GRANT ALL ON job_expenses TO service_role;

-- ============================================================
-- 2. Trigger: touch claim on expense insert
-- ============================================================
CREATE OR REPLACE FUNCTION touch_claim_on_expense()
RETURNS trigger AS $$
BEGIN
    UPDATE claims SET last_touched_at = now() WHERE id = NEW.claim_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS expense_touch_claim ON job_expenses;
CREATE TRIGGER expense_touch_claim
    AFTER INSERT ON job_expenses
    FOR EACH ROW EXECUTE FUNCTION touch_claim_on_expense();

-- ============================================================
-- 3. Realtime (idempotent)
-- ============================================================
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE job_expenses;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 4. NOTES
-- ============================================================
-- claim_events emissions (from API layer):
--   expense_recorded  — when a job_expenses row is inserted
-- Net-margin is computed at read time (not stored) so price changes,
-- supplements, and additional expenses always reflect the latest truth.
