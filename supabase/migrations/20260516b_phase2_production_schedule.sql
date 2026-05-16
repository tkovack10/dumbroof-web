-- Phase 2 — Production Calendar + Homeowner Auto-Emails
-- ============================================================
-- Adds production-schedule layer on top of the claims platform.
-- Multiple schedules per claim are allowed (reschedule history); the
-- "current" schedule is the most-recent row where status='scheduled'.
--
-- Schema notes:
--   - production_schedules.claim_id → claims(id)
--   - production_schedules.crew_id  → crews(id) (nullable)
--   - production_schedules.status state machine:
--       scheduled → in_progress → completed
--                ↘ cancelled (terminal)
--                ↘ superseded (set when a new schedule is created for the
--                  same claim — preserves history without deleting)
--
-- Email trigger: API routes that create/update a schedule may call the
-- /api/admin/production/notify-homeowner endpoint to send a reschedule
-- notification. Following the existing send-now/route.ts pattern.
--
-- HARD CONSTRAINT: no edits to the claims table. The claim's current
-- production-schedule state is derived at read time from the latest
-- non-superseded production_schedules row.

-- ============================================================
-- 1. CREWS
-- ============================================================
CREATE TABLE IF NOT EXISTS crews (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id uuid NOT NULL,
    name text NOT NULL,
    -- Hex color (with leading #) used for calendar event chips
    color text NOT NULL DEFAULT '#22D8FF',
    lead_user_id uuid REFERENCES auth.users(id),
    -- Free-form member list (names or emails). Keeping it flexible so
    -- crews can include non-platform-user laborers without forcing every
    -- crew member to have a dumbroof account.
    members jsonb DEFAULT '[]'::jsonb,
    notes text,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_crews_company_active ON crews(company_id, active);

ALTER TABLE crews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team sees their company's crews"
    ON crews FOR SELECT
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND company_id IS NOT NULL
        )
    );

CREATE POLICY "Admins manage their company's crews"
    ON crews FOR ALL
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

GRANT ALL ON crews TO service_role;

-- ============================================================
-- 2. PRODUCTION SCHEDULES
-- ============================================================
CREATE TABLE IF NOT EXISTS production_schedules (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    company_id uuid NOT NULL,
    crew_id uuid REFERENCES crews(id) ON DELETE SET NULL,
    -- scheduled_at is the start of the install. end_at is optional and
    -- supports multi-day jobs (e.g. tear-off Mon, install Tue).
    scheduled_at timestamptz NOT NULL,
    end_at timestamptz,
    status text NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'superseded')),
    -- Whether to email the homeowner about this schedule change. The API
    -- writes the row regardless; the trigger or API consumer reads this
    -- flag and queues the email.
    notify_homeowner boolean NOT NULL DEFAULT true,
    notified_at timestamptz,
    homeowner_email_id uuid,
    notes text,
    created_by uuid REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedules_company_date
    ON production_schedules(company_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_schedules_claim
    ON production_schedules(claim_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_schedules_crew_date
    ON production_schedules(crew_id, scheduled_at);

ALTER TABLE production_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team sees their company's schedules"
    ON production_schedules FOR SELECT
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND company_id IS NOT NULL
        )
    );

CREATE POLICY "Admins manage their company's schedules"
    ON production_schedules FOR ALL
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

GRANT ALL ON production_schedules TO service_role;

-- ============================================================
-- 3. updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION production_schedules_touch_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS production_schedules_updated_at ON production_schedules;
CREATE TRIGGER production_schedules_updated_at
    BEFORE UPDATE ON production_schedules
    FOR EACH ROW EXECUTE FUNCTION production_schedules_touch_updated_at();

-- Also bump claims.last_touched_at when a schedule is created so the
-- Rep Scorecard / Command Center recent-activity surfaces light up.
CREATE OR REPLACE FUNCTION touch_claim_on_schedule()
RETURNS trigger AS $$
BEGIN
    UPDATE claims SET last_touched_at = now() WHERE id = NEW.claim_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS schedule_touch_claim ON production_schedules;
CREATE TRIGGER schedule_touch_claim
    AFTER INSERT ON production_schedules
    FOR EACH ROW EXECUTE FUNCTION touch_claim_on_schedule();

-- ============================================================
-- 4. Realtime (idempotent — see Phase 1 pattern)
-- ============================================================
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE production_schedules;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE crews;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 5. Notes
-- ============================================================
-- The claim_events table already has 'install_scheduled' in its
-- registry (see CLAIM_EVENT_TYPES in src/lib/claim-events.ts) — emit
-- that event from the API layer whenever a new production_schedules
-- row is inserted, and 'install_complete' when status flips to completed.
