-- Phase 1 — AccuLynx company-calendar sync
-- ============================================================
-- Pulls the AccuLynx "Location Calendar" install events (via the public v2 API:
-- GET /calendars + GET /calendars/{id}/appointments) into DumbRoof so they render
-- on the Production calendar. Matched events also upsert a production_schedules row
-- so a matched claim leaves the "needs install" bucket. Unmatched events are still
-- tracked (the "Unlinked installs" panel) for one-click linking.
--
-- Design notes:
--   - acculynx_calendar_events is the raw mirror, keyed (company_id, acculynx_event_id)
--     for idempotent re-sync. matched_claim_id is nullable (null = unlinked).
--   - production_schedules gains `origin` ('manual'|'acculynx') + `acculynx_event_id`
--     so synced installs render on the existing calendar and dedupe across syncs.
--   - No edits to the claims table (hard constraint). Company-scoped RLS throughout.

-- ============================================================
-- 1. production_schedules: origin + acculynx linkage
-- ============================================================
ALTER TABLE production_schedules
    ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual'
        CHECK (origin IN ('manual', 'acculynx')),
    ADD COLUMN IF NOT EXISTS acculynx_event_id text;

-- One schedule per AccuLynx event per company (idempotent upsert target).
CREATE UNIQUE INDEX IF NOT EXISTS uq_schedules_acculynx_event
    ON production_schedules(company_id, acculynx_event_id)
    WHERE acculynx_event_id IS NOT NULL;

-- ============================================================
-- 2. acculynx_calendar_events (raw mirror of company-calendar events)
-- ============================================================
CREATE TABLE IF NOT EXISTS acculynx_calendar_events (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id uuid NOT NULL,
    -- AccuLynx appointment id (calendarEvent.id). Unique per company for upsert.
    acculynx_event_id text NOT NULL,
    calendar_id text,
    calendar_name text,
    -- AccuLynx job linkage (calendarEvent.jobId / jobName) — the strong match key.
    job_id text,
    job_name text,
    title text,
    -- calendarEvent.location = the property address.
    location text,
    -- Normalized address used for fallback matching to claims.address.
    address_norm text,
    notes text,
    -- calendarEvent.eventType: Personal | Initial Appointment | Material Order | Labor Order
    event_type text,
    -- Derived: a roof install / production event (eventType='Labor Order').
    is_production boolean NOT NULL DEFAULT false,
    starts_at timestamptz,
    ends_at timestamptz,
    all_day boolean NOT NULL DEFAULT false,
    -- Match result. matched_claim_id null = unlinked (shown in the Unlinked panel).
    matched_claim_id uuid REFERENCES claims(id) ON DELETE SET NULL,
    match_method text CHECK (match_method IN ('claim_number', 'job_id', 'address', 'manual')),
    -- The production_schedules row created for a matched production event (if any).
    production_schedule_id uuid REFERENCES production_schedules(id) ON DELETE SET NULL,
    raw jsonb,
    synced_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (company_id, acculynx_event_id)
);

CREATE INDEX IF NOT EXISTS idx_acculynx_cal_company_start
    ON acculynx_calendar_events(company_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_acculynx_cal_unlinked
    ON acculynx_calendar_events(company_id, is_production, matched_claim_id);
CREATE INDEX IF NOT EXISTS idx_acculynx_cal_addr
    ON acculynx_calendar_events(company_id, address_norm);
CREATE INDEX IF NOT EXISTS idx_acculynx_cal_matched
    ON acculynx_calendar_events(matched_claim_id);

ALTER TABLE acculynx_calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team sees their company's calendar events"
    ON acculynx_calendar_events FOR SELECT
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND company_id IS NOT NULL
        )
    );

CREATE POLICY "Admins manage their company's calendar events"
    ON acculynx_calendar_events FOR ALL
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

GRANT ALL ON acculynx_calendar_events TO service_role;

-- ============================================================
-- 3. Realtime (idempotent — see Phase 1/2 pattern)
-- ============================================================
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE acculynx_calendar_events;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
