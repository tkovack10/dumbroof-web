-- Phase 4 — Retail Jobs (separate from claims)
-- ============================================================
-- Per Tom 2026-05-16: retail = separate top-level entity (NOT a claim_type
-- discriminator on claims). Doubles supporting tables but keeps insurance
-- + retail flows independent and Richard tools focused.
--
-- Richard tools introduced alongside this migration:
--   - create_retail_estimate
--   - send_company_intro_email
--   - send_retail_invoice
--
-- HARD CONSTRAINT: no edits to claims, processor.py, or per-claim flow.

-- ============================================================
-- 1. RETAIL JOBS
-- ============================================================
CREATE TABLE IF NOT EXISTS retail_jobs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id uuid NOT NULL,
    created_by uuid REFERENCES auth.users(id),
    assigned_user_id uuid REFERENCES auth.users(id),

    customer_name text NOT NULL,
    customer_email text,
    customer_phone text,

    address text,
    city_state_zip text,
    scope_description text,
    line_items jsonb DEFAULT '[]'::jsonb,
    subtotal_cents bigint DEFAULT 0,
    tax_rate numeric(5,4) DEFAULT 0,
    tax_cents bigint DEFAULT 0,
    total_cents bigint DEFAULT 0,
    terms text,
    deposit_pct numeric(5,2) DEFAULT 0,
    payment_schedule text,

    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN (
            'draft',
            'proposal_sent',
            'accepted',
            'invoiced',
            'paid',
            'completed',
            'lost'
        )),

    proposal_pdf_path text,
    proposal_sent_at timestamptz,
    accepted_at timestamptz,
    intro_email_sent_at timestamptz,

    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retail_jobs_company_status
    ON retail_jobs(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retail_jobs_assigned
    ON retail_jobs(assigned_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retail_jobs_customer_email
    ON retail_jobs(company_id, customer_email);

ALTER TABLE retail_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team sees their company's retail jobs"
    ON retail_jobs FOR SELECT
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND company_id IS NOT NULL
        )
    );

CREATE POLICY "Team members create retail jobs for their company"
    ON retail_jobs FOR INSERT
    WITH CHECK (
        created_by = auth.uid()
        AND company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND company_id IS NOT NULL
        )
    );

CREATE POLICY "Team members update retail jobs in their company"
    ON retail_jobs FOR UPDATE
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND company_id IS NOT NULL
        )
    )
    WITH CHECK (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND company_id IS NOT NULL
        )
    );

CREATE POLICY "Admins delete retail jobs for their company"
    ON retail_jobs FOR DELETE
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid()
              AND is_admin = true
              AND company_id IS NOT NULL
        )
    );

GRANT ALL ON retail_jobs TO service_role;

-- ============================================================
-- 2. RETAIL INVOICES (1:N — multiple invoices per job)
-- ============================================================
CREATE TABLE IF NOT EXISTS retail_invoices (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    retail_job_id uuid NOT NULL REFERENCES retail_jobs(id) ON DELETE CASCADE,
    company_id uuid NOT NULL,
    created_by uuid REFERENCES auth.users(id),
    kind text NOT NULL DEFAULT 'full'
        CHECK (kind IN ('deposit', 'progress', 'balance', 'full')),
    amount_cents bigint NOT NULL,
    description text,
    payment_link text,
    stripe_price_id text,
    stripe_payment_link_id text,
    stripe_connect_account_id text,
    sent_to_email text,
    sent_at timestamptz,
    paid_at timestamptz,
    paid_amount_cents bigint,
    stripe_payment_intent_id text,
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'sent', 'paid', 'void')),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retail_invoices_job
    ON retail_invoices(retail_job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retail_invoices_status
    ON retail_invoices(company_id, status, created_at DESC);

ALTER TABLE retail_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team sees their company's retail invoices"
    ON retail_invoices FOR SELECT
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND company_id IS NOT NULL
        )
    );

CREATE POLICY "Admins manage retail invoices for their company"
    ON retail_invoices FOR ALL
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid()
              AND is_admin = true
              AND company_id IS NOT NULL
        )
    )
    WITH CHECK (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid()
              AND is_admin = true
              AND company_id IS NOT NULL
        )
    );

GRANT ALL ON retail_invoices TO service_role;

-- ============================================================
-- 3. updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION retail_jobs_touch_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS retail_jobs_updated_at ON retail_jobs;
CREATE TRIGGER retail_jobs_updated_at
    BEFORE UPDATE ON retail_jobs
    FOR EACH ROW EXECUTE FUNCTION retail_jobs_touch_updated_at();

CREATE OR REPLACE FUNCTION retail_invoices_touch_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS retail_invoices_updated_at ON retail_invoices;
CREATE TRIGGER retail_invoices_updated_at
    BEFORE UPDATE ON retail_invoices
    FOR EACH ROW EXECUTE FUNCTION retail_invoices_touch_updated_at();

-- ============================================================
-- 4. Realtime (idempotent)
-- ============================================================
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE retail_jobs;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE retail_invoices;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
