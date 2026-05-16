-- Phase 1 — Rep Workspace + $-lights-up + Commission Flow
-- ============================================================
-- Adds operational layer on top of the existing claims platform:
--   1. check_uploads    — photos of physical/digital checks collected for claims
--   2. commission_requests — rep-submitted commission requests (10% of check, $100/AOB)
--
-- Checkpoint icons (forensic / supplement / coc / engagement) reuse the existing
-- claim_events table — no new event tables needed. Documented event_types:
--   - forensic_sent_to_carrier        (already used in production)
--   - forensic_sent_to_homeowner      (already used in production)
--   - supplement_sent_to_carrier      (NEW — extends pattern)
--   - coc_sent_to_homeowner           (NEW — extends pattern)
--   - homeowner_engagement_sent       (NEW — extends pattern)
--   - check_received                  (NEW — emitted on check_uploads insert)
--   - commission_requested            (NEW — emitted on commission_requests insert)
--   - commission_approved             (NEW — emitted on approval)
--   - commission_paid                 (NEW — emitted on mark-paid)
--
-- HARD CONSTRAINT (Tom 2026-05-16): no edits to the claims table or any
-- existing per-claim flow. This migration is additive only.

-- ============================================================
-- 1. CHECK UPLOADS
-- ============================================================
CREATE TABLE IF NOT EXISTS check_uploads (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    -- company_id intentionally has no FK: matches claims.company_id pattern
    -- (companies table is platform-canonical but not registered as a FK target
    -- in migrations; see 20260513 / commit 655062c).
    company_id uuid NOT NULL,
    uploader_user_id uuid REFERENCES auth.users(id),
    photo_path text NOT NULL,
    amount_cents bigint,
    source text NOT NULL CHECK (source IN ('insurance', 'homeowner', 'stripe_invoice', 'other')),
    payor text,
    received_at timestamptz NOT NULL DEFAULT now(),
    confirmed_at timestamptz,
    confirmed_by uuid REFERENCES auth.users(id),
    ocr_extracted jsonb,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_check_uploads_company ON check_uploads(company_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_check_uploads_claim ON check_uploads(claim_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_check_uploads_uploader ON check_uploads(uploader_user_id, received_at DESC);

ALTER TABLE check_uploads ENABLE ROW LEVEL SECURITY;

-- Team sees check uploads for their company
CREATE POLICY "Team sees check uploads for their company"
    ON check_uploads FOR SELECT
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND company_id IS NOT NULL
        )
        OR uploader_user_id = auth.uid()
    );

-- Reps insert checks they upload themselves
CREATE POLICY "Reps insert their own check uploads"
    ON check_uploads FOR INSERT
    WITH CHECK (
        uploader_user_id = auth.uid()
        AND company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND company_id IS NOT NULL
        )
    );

-- Admins/owners update (confirm/edit) check uploads in their company
CREATE POLICY "Admins update check uploads for their company"
    ON check_uploads FOR UPDATE
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid()
              AND is_admin = true
              AND company_id IS NOT NULL
        )
    );

GRANT ALL ON check_uploads TO service_role;

-- ============================================================
-- 2. COMMISSION REQUESTS
-- ============================================================
CREATE TABLE IF NOT EXISTS commission_requests (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    -- company_id intentionally has no FK (see check_uploads comment).
    company_id uuid NOT NULL,
    rep_user_id uuid NOT NULL REFERENCES auth.users(id),
    type text NOT NULL CHECK (type IN ('check_10pct', 'aob_100', 'other')),
    -- check_10pct: 10% of a collected check ($X * 0.10)
    -- aob_100: flat $100 for a signed AOB
    -- other: company-defined, amount specified explicitly
    amount_cents bigint NOT NULL,
    photo_path text,
    related_check_upload_id uuid REFERENCES check_uploads(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    decided_at timestamptz,
    decided_by uuid REFERENCES auth.users(id),
    paid_at timestamptz,
    paid_by uuid REFERENCES auth.users(id),
    payment_method text,
    payment_reference text,
    notes text,
    decision_notes text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commission_requests_company_status ON commission_requests(company_id, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_commission_requests_rep ON commission_requests(rep_user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_commission_requests_claim ON commission_requests(claim_id);

ALTER TABLE commission_requests ENABLE ROW LEVEL SECURITY;

-- Reps see their own requests; admins see all in their company
CREATE POLICY "Reps see own requests, admins see all in company"
    ON commission_requests FOR SELECT
    USING (
        rep_user_id = auth.uid()
        OR company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid()
              AND is_admin = true
              AND company_id IS NOT NULL
        )
    );

-- Reps insert their own commission requests
CREATE POLICY "Reps insert their own commission requests"
    ON commission_requests FOR INSERT
    WITH CHECK (
        rep_user_id = auth.uid()
        AND company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND company_id IS NOT NULL
        )
    );

-- Admins approve / reject / mark paid in their company
CREATE POLICY "Admins update commission requests in their company"
    ON commission_requests FOR UPDATE
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid()
              AND is_admin = true
              AND company_id IS NOT NULL
        )
    );

GRANT ALL ON commission_requests TO service_role;

-- ============================================================
-- 3. TRIGGER: bump claims.last_touched_at on check_upload / commission_request inserts
-- ============================================================
-- Reuses the existing claim-touch pattern so the Command Center's "Recent Activity"
-- and Rep Scorecard's "Last Active" surfaces pick up these events automatically.

CREATE OR REPLACE FUNCTION touch_claim_on_phase1_event()
RETURNS trigger AS $$
BEGIN
    UPDATE claims
       SET last_touched_at = now()
     WHERE id = NEW.claim_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_upload_touch_claim ON check_uploads;
CREATE TRIGGER check_upload_touch_claim
    AFTER INSERT ON check_uploads
    FOR EACH ROW EXECUTE FUNCTION touch_claim_on_phase1_event();

DROP TRIGGER IF EXISTS commission_request_touch_claim ON commission_requests;
CREATE TRIGGER commission_request_touch_claim
    AFTER INSERT ON commission_requests
    FOR EACH ROW EXECUTE FUNCTION touch_claim_on_phase1_event();

-- ============================================================
-- 4. REALTIME SUBSCRIPTIONS (for $-lights-up money-strip)
-- ============================================================
-- The money-strip widget subscribes to INSERT events on check_uploads
-- and UPDATE events on commission_requests via supabase-js Realtime.
-- Realtime is on by default for all tables in supabase_realtime publication.

-- ALTER PUBLICATION is not idempotent — wrap in a DO block that swallows
-- duplicate_object so re-runs and Supabase's auto-add don't fail the migration.
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE check_uploads;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE commission_requests;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 5. NOTES
-- ============================================================
-- check_received / commission_requested / commission_approved / commission_paid
-- claim_events rows are emitted from the API layer (see app/api/claim/[id]/upload-check
-- and app/api/admin/commissions) so we can keep them transactional with the
-- write that triggers them. This mirrors the _record_email_send_side_effects
-- pattern from the email subsystem.
