-- ============================================================
-- Platform Expansion Migration — 2026-04-19
--
-- Adds:
--   1. Team invites (company_invites + role/invited_by on company_profiles)
--   2. Referral program (referrals + company_profiles.referral_code + settings)
--   3. Dashboard filter columns on claims (company_id, assigned_user_id,
--      last_touched_at, homeowner_comms_count, marketing_eligible)
--   4. Homeowner communications (marketing_assets, email_templates,
--      homeowner_sequences, homeowner_sends, homeowner_events)
--   5. Production handoff (claim_selections, production_handoffs,
--      company_crm_connections)
--   6. Contact registry columns on claims (homeowner/adjuster contacts,
--      policy_number, contact_source)
--   7. Wins tracking (claim_wins — dual forensic/supplement)
--   8. Event-sourced timeline (claim_events)
--   9. RLS widening on new + key existing tables for team access
--
-- Idempotent — uses IF NOT EXISTS / DO blocks throughout.
-- Run: supabase db push  (or Supabase Dashboard SQL editor)
-- ============================================================


-- ============================================================
-- 1. TEAM INVITES — extend company_profiles + add company_invites
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'company_profiles' AND column_name = 'role') THEN
        ALTER TABLE company_profiles ADD COLUMN role text DEFAULT 'owner';
        -- roles: owner | admin | member | rep | readonly
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'company_profiles' AND column_name = 'invited_by') THEN
        ALTER TABLE company_profiles ADD COLUMN invited_by uuid REFERENCES auth.users(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'company_profiles' AND column_name = 'invite_accepted_at') THEN
        ALTER TABLE company_profiles ADD COLUMN invite_accepted_at timestamptz;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'company_profiles' AND column_name = 'referral_code') THEN
        ALTER TABLE company_profiles ADD COLUMN referral_code text UNIQUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'company_profiles' AND column_name = 'settings') THEN
        ALTER TABLE company_profiles ADD COLUMN settings jsonb DEFAULT '{}'::jsonb;
        -- settings shape: {
        --   "override_yellow_roles": ["rep","admin","owner"],
        --   "override_red_roles": ["admin","owner"],
        --   "auto_start_comms_on_aob": true,
        --   "richard_dry_run": false
        -- }
    END IF;
END $$;

-- Backfill referral_code for every existing profile that doesn't have one.
-- 8-char uppercase alphanumeric via substring of MD5(user_id||created).
UPDATE company_profiles
SET referral_code = UPPER(SUBSTRING(MD5(user_id::text || COALESCE(created_at::text, now()::text)) FROM 1 FOR 8))
WHERE referral_code IS NULL;

-- Backfill role for existing admin/owner rows
UPDATE company_profiles SET role = 'owner' WHERE role IS NULL AND is_admin = true;
UPDATE company_profiles SET role = 'member' WHERE role IS NULL;


CREATE TABLE IF NOT EXISTS company_invites (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id uuid NOT NULL,
    email text NOT NULL,
    role text NOT NULL DEFAULT 'member',
    token text NOT NULL UNIQUE,
    invited_by uuid NOT NULL REFERENCES auth.users(id),
    message text,
    created_at timestamptz DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
    accepted_at timestamptz,
    accepted_by uuid REFERENCES auth.users(id),
    revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_invites_token ON company_invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_email ON company_invites(email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invites_company ON company_invites(company_id);

ALTER TABLE company_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can view invites for their company"
    ON company_invites FOR SELECT
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND company_id IS NOT NULL
        )
    );

CREATE POLICY "Admins can create invites"
    ON company_invites FOR INSERT
    WITH CHECK (
        invited_by = auth.uid() AND
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
    );

CREATE POLICY "Admins can update invites"
    ON company_invites FOR UPDATE
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
    );

GRANT ALL ON company_invites TO service_role;


-- ============================================================
-- 2. REFERRALS — refer a company, get 1 month free at Pro tier
-- ============================================================

CREATE TABLE IF NOT EXISTS referrals (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    referrer_user_id uuid NOT NULL REFERENCES auth.users(id),
    referral_code text NOT NULL,
    referred_email text,
    referred_user_id uuid REFERENCES auth.users(id),
    status text NOT NULL DEFAULT 'pending',
    -- status: pending | signed_up | paid | reward_applied | expired
    signed_up_at timestamptz,
    first_paid_at timestamptz,
    reward_applied_at timestamptz,
    stripe_coupon_id text,
    stripe_invoice_id text,
    reward_amount_cents int,
    notes text,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_user_id) WHERE referred_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see their own referrals (sent)"
    ON referrals FOR SELECT
    USING (referrer_user_id = auth.uid() OR referred_user_id = auth.uid());

GRANT ALL ON referrals TO service_role;


-- ============================================================
-- 3. DASHBOARD FILTER COLUMNS + TRIGGER
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'claims' AND column_name = 'company_id') THEN
        ALTER TABLE claims ADD COLUMN company_id uuid;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'claims' AND column_name = 'assigned_user_id') THEN
        ALTER TABLE claims ADD COLUMN assigned_user_id uuid REFERENCES auth.users(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'claims' AND column_name = 'last_touched_at') THEN
        ALTER TABLE claims ADD COLUMN last_touched_at timestamptz DEFAULT now();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'claims' AND column_name = 'homeowner_comms_count') THEN
        ALTER TABLE claims ADD COLUMN homeowner_comms_count smallint DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'claims' AND column_name = 'marketing_eligible') THEN
        ALTER TABLE claims ADD COLUMN marketing_eligible boolean DEFAULT false;
    END IF;
END $$;

-- Backfill company_id on claims from claims.user_id -> company_profiles.company_id
UPDATE claims c
SET company_id = cp.company_id
FROM company_profiles cp
WHERE c.user_id = cp.user_id
  AND c.company_id IS NULL
  AND cp.company_id IS NOT NULL;

-- Backfill assigned_user_id = claims.user_id (claim creator is default rep)
UPDATE claims SET assigned_user_id = user_id WHERE assigned_user_id IS NULL;

-- Backfill last_touched_at = created_at (claims table has no updated_at column)
UPDATE claims SET last_touched_at = COALESCE(created_at, now()) WHERE last_touched_at IS NULL;

-- Trigger: any UPDATE to claims bumps last_touched_at
CREATE OR REPLACE FUNCTION bump_claim_last_touched() RETURNS trigger AS $$
BEGIN
    NEW.last_touched_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS claims_last_touched_trigger ON claims;
CREATE TRIGGER claims_last_touched_trigger
    BEFORE UPDATE ON claims
    FOR EACH ROW
    WHEN (OLD.* IS DISTINCT FROM NEW.*)
    EXECUTE FUNCTION bump_claim_last_touched();

CREATE INDEX IF NOT EXISTS idx_claims_company_id ON claims(company_id);
CREATE INDEX IF NOT EXISTS idx_claims_assigned_user ON claims(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_claims_last_touched ON claims(last_touched_at DESC);


-- ============================================================
-- 4. HOMEOWNER COMMUNICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS marketing_assets (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    title text NOT NULL,
    description text,
    category text NOT NULL,
    -- category: shingle_sample | siding_sample | faq | what_to_expect | nearby_jobs | other
    manufacturer text,
    file_path text,           -- Supabase storage path
    file_size_bytes int,
    mime_type text DEFAULT 'application/pdf',
    thumbnail_path text,
    active boolean DEFAULT true,
    sort_order int DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_assets_slug ON marketing_assets(slug);
CREATE INDEX IF NOT EXISTS idx_marketing_assets_category ON marketing_assets(category) WHERE active = true;

ALTER TABLE marketing_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view active marketing assets"
    ON marketing_assets FOR SELECT
    USING (active = true);

GRANT ALL ON marketing_assets TO service_role;

-- Seed 13 known asset slugs (files uploaded later)
INSERT INTO marketing_assets (slug, title, category, manufacturer, sort_order) VALUES
    ('oc-duration',          'Owens Corning Duration',          'shingle_sample', 'Owens Corning', 10),
    ('oc-duration-designer', 'Owens Corning Duration Designer', 'shingle_sample', 'Owens Corning', 20),
    ('gaf-timberline',       'GAF Timberline',                  'shingle_sample', 'GAF',           30),
    ('gaf-timberline-hd',    'GAF Timberline HD',               'shingle_sample', 'GAF',           40),
    ('gaf-camelot-ii',       'GAF Camelot II',                  'shingle_sample', 'GAF',           50),
    ('atlas',                'Atlas Shingles',                  'shingle_sample', 'Atlas',         60),
    ('certainteed-shingles', 'Certainteed Shingles',            'shingle_sample', 'Certainteed',   70),
    ('cert-grand-manor',     'Certainteed Grand Manor',         'shingle_sample', 'Certainteed',   80),
    ('malarkey',             'Malarkey Shingles',               'shingle_sample', 'Malarkey',      90),
    ('hardie-siding',        'James Hardie Siding',             'siding_sample',  'James Hardie', 100),
    ('cert-siding',          'Certainteed Siding',              'siding_sample',  'Certainteed',  110),
    ('faq-insurance-claim',  'FAQ — Insurance Claim Process',   'faq',            NULL,           200),
    ('what-to-expect',       'What to Expect',                  'what_to_expect', NULL,           210)
ON CONFLICT (slug) DO NOTHING;


CREATE TABLE IF NOT EXISTS email_templates (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    slug text NOT NULL,
    company_id uuid,             -- NULL = global default; non-null = per-company override
    subject text NOT NULL,
    body_html text,
    body_text text,
    default_attachments uuid[] DEFAULT '{}',
    -- trigger_type: manual (always), time (days after started_at), event (fires on claim_events)
    trigger_type text NOT NULL DEFAULT 'manual',
    trigger_offset_days int,
    trigger_event text,
    active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(slug, company_id)
);

CREATE INDEX IF NOT EXISTS idx_email_templates_slug ON email_templates(slug);
CREATE INDEX IF NOT EXISTS idx_email_templates_company ON email_templates(company_id);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see global and their company's templates"
    ON email_templates FOR SELECT
    USING (
        company_id IS NULL OR
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND company_id IS NOT NULL
        )
    );

CREATE POLICY "Admins manage their company templates"
    ON email_templates FOR ALL
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
    );

GRANT ALL ON email_templates TO service_role;


-- Seed 7 global default templates (cadence Day 0/2/5/7/10/14/21)
-- Bodies left blank for now — admin UI populates
INSERT INTO email_templates (slug, subject, trigger_type, trigger_offset_days, trigger_event, body_text) VALUES
    ('welcome_what_to_expect', 'Welcome — What to Expect With Your Insurance Claim',
     'time', 0, 'sequence_started',
     'Thank you for choosing us to help with your roof claim. Attached is a guide on what to expect...'),
    ('adjuster_meeting_prep', 'Important: Your Adjuster Meeting — What to Do',
     'time', 2, NULL,
     'Your insurance adjuster will be contacting you to schedule an inspection. When they do, please tell them your contractor must be present...'),
    ('sample_books_pick_colors', 'Pick Your Roof Colors — Sample Books Attached',
     'time', 5, NULL,
     'Start picturing your new roof! Attached are sample books from top manufacturers...'),
    ('nearby_jobs_showcase', 'See Our Recent Projects Near You',
     'time', 7, NULL,
     'Take a look at some recent installations in your area...'),
    ('adjuster_status_checkin', 'Quick Check-in — Has the Adjuster Reached Out?',
     'time', 10, NULL,
     'Just checking in — has your adjuster scheduled the inspection yet? Let us know so we can coordinate being present...'),
    ('scope_status_checkin', 'Have You Received the Scope from the Insurance Company?',
     'time', 14, NULL,
     'Please forward any scope documents you receive from the insurance company right away...'),
    ('first_check_guidance', 'What to Do When the First Insurance Check Arrives',
     'time', 21, NULL,
     'When your first insurance check arrives, here''s exactly what to do...')
ON CONFLICT (slug, company_id) DO NOTHING;


CREATE TABLE IF NOT EXISTS homeowner_sequences (
    claim_id uuid PRIMARY KEY REFERENCES claims(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'not_started',
    -- status: not_started | active | paused | complete
    started_at timestamptz,
    started_by uuid REFERENCES auth.users(id),
    next_send_at timestamptz,
    last_template_slug text,
    last_sent_at timestamptz,
    completed_at timestamptz,
    pause_reason text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sequences_active ON homeowner_sequences(next_send_at)
    WHERE status = 'active' AND next_send_at IS NOT NULL;

ALTER TABLE homeowner_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team sees sequences for their company claims"
    ON homeowner_sequences FOR SELECT
    USING (
        claim_id IN (
            SELECT id FROM claims
            WHERE user_id = auth.uid() OR company_id IN (
                SELECT company_id FROM company_profiles
                WHERE user_id = auth.uid() AND company_id IS NOT NULL
            )
        )
    );

GRANT ALL ON homeowner_sequences TO service_role;


CREATE TABLE IF NOT EXISTS homeowner_sends (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    template_slug text,
    to_email text NOT NULL,
    subject text,
    body_preview text,
    attachments text[] DEFAULT '{}',        -- marketing_assets slugs
    sent_at timestamptz DEFAULT now(),
    sent_by uuid REFERENCES auth.users(id),  -- NULL for cron
    resend_email_id text,                     -- for tracking opens/replies
    opened_at timestamptz,
    clicked_at timestamptz,
    replied_at timestamptz,
    bounced_at timestamptz,
    error_message text,
    metadata jsonb DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sends_claim ON homeowner_sends(claim_id);
CREATE INDEX IF NOT EXISTS idx_sends_template ON homeowner_sends(template_slug);
CREATE INDEX IF NOT EXISTS idx_sends_resend_id ON homeowner_sends(resend_email_id) WHERE resend_email_id IS NOT NULL;

ALTER TABLE homeowner_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team sees sends for their company claims"
    ON homeowner_sends FOR SELECT
    USING (
        claim_id IN (
            SELECT id FROM claims
            WHERE user_id = auth.uid() OR company_id IN (
                SELECT company_id FROM company_profiles
                WHERE user_id = auth.uid() AND company_id IS NOT NULL
            )
        )
    );

GRANT ALL ON homeowner_sends TO service_role;


CREATE TABLE IF NOT EXISTS homeowner_events (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    -- event_type: adjuster_contacted | adjuster_scheduled | scope_received |
    --             check_received | color_picked | installed | other
    metadata jsonb DEFAULT '{}',
    reported_at timestamptz DEFAULT now(),
    reported_by text
    -- reported_by: homeowner_link | homeowner_reply | rep_manual | gmail_poller | system
);

CREATE INDEX IF NOT EXISTS idx_hevents_claim ON homeowner_events(claim_id, reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_hevents_type ON homeowner_events(event_type);

ALTER TABLE homeowner_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team sees events for their company claims"
    ON homeowner_events FOR SELECT
    USING (
        claim_id IN (
            SELECT id FROM claims
            WHERE user_id = auth.uid() OR company_id IN (
                SELECT company_id FROM company_profiles
                WHERE user_id = auth.uid() AND company_id IS NOT NULL
            )
        )
    );

GRANT ALL ON homeowner_events TO service_role;


-- ============================================================
-- 5. PRODUCTION HANDOFF
-- ============================================================

CREATE TABLE IF NOT EXISTS claim_selections (
    claim_id uuid PRIMARY KEY REFERENCES claims(id) ON DELETE CASCADE,
    roof_manufacturer text,
    roof_product text,
    roof_color text,
    drip_edge_color text,
    flashing_color text,
    gutter_color text,
    siding_manufacturer text,
    siding_product text,
    siding_color text,
    skylights_keep boolean,
    gate_code text,
    pets text,
    driveway_access text,
    site_notes text,
    selected_at timestamptz,
    selected_by text,
    -- selected_by: homeowner_link | homeowner_reply | rep_manual | import
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE claim_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team sees selections for their company claims"
    ON claim_selections FOR SELECT
    USING (
        claim_id IN (
            SELECT id FROM claims
            WHERE user_id = auth.uid() OR company_id IN (
                SELECT company_id FROM company_profiles
                WHERE user_id = auth.uid() AND company_id IS NOT NULL
            )
        )
    );

GRANT ALL ON claim_selections TO service_role;


CREATE TABLE IF NOT EXISTS production_handoffs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'draft',
    -- status: draft | pending_validation | ready | sent | crm_pushed | cancelled
    document_path text,
    scope_validation jsonb DEFAULT '[]',
    -- scope_validation row shape: {trade, scope_qty, eagleview_qty, requested_qty,
    --                              status: ok|over_minor|over_major|partial|not_paid,
    --                              override_reason, override_by, override_at}
    submitted_by uuid REFERENCES auth.users(id),
    submitted_at timestamptz,
    crm_pushed_at timestamptz,
    crm_external_id text,
    crm_type text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_handoffs_claim ON production_handoffs(claim_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_status ON production_handoffs(status);

ALTER TABLE production_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team sees handoffs for their company claims"
    ON production_handoffs FOR SELECT
    USING (
        claim_id IN (
            SELECT id FROM claims
            WHERE user_id = auth.uid() OR company_id IN (
                SELECT company_id FROM company_profiles
                WHERE user_id = auth.uid() AND company_id IS NOT NULL
            )
        )
    );

GRANT ALL ON production_handoffs TO service_role;


CREATE TABLE IF NOT EXISTS company_crm_connections (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id uuid NOT NULL,
    crm_type text NOT NULL,
    -- crm_type: acculynx | jobnimbus | roofhub | companycam | other
    direction text NOT NULL DEFAULT 'push_only',
    -- direction: push_only | pull | both
    credentials_encrypted text,
    api_key_hash text,
    endpoint_override text,
    field_mapping jsonb DEFAULT '{}',
    active boolean DEFAULT true,
    last_sync_at timestamptz,
    last_sync_status text,
    last_sync_error text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(company_id, crm_type)
);

CREATE INDEX IF NOT EXISTS idx_crm_company ON company_crm_connections(company_id);

ALTER TABLE company_crm_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team views their CRM connections"
    ON company_crm_connections FOR SELECT
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND company_id IS NOT NULL
        )
    );

CREATE POLICY "Admins manage CRM connections"
    ON company_crm_connections FOR ALL
    USING (
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
    );

GRANT ALL ON company_crm_connections TO service_role;


-- ============================================================
-- 6. CONTACT REGISTRY — contact fields on claims
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'claims' AND column_name = 'homeowner_name') THEN
        ALTER TABLE claims ADD COLUMN homeowner_name text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'claims' AND column_name = 'homeowner_email') THEN
        ALTER TABLE claims ADD COLUMN homeowner_email text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'claims' AND column_name = 'homeowner_phone') THEN
        ALTER TABLE claims ADD COLUMN homeowner_phone text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'claims' AND column_name = 'adjuster_name') THEN
        ALTER TABLE claims ADD COLUMN adjuster_name text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'claims' AND column_name = 'adjuster_email') THEN
        ALTER TABLE claims ADD COLUMN adjuster_email text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'claims' AND column_name = 'adjuster_phone') THEN
        ALTER TABLE claims ADD COLUMN adjuster_phone text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'claims' AND column_name = 'policy_number') THEN
        ALTER TABLE claims ADD COLUMN policy_number text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'claims' AND column_name = 'contact_source') THEN
        ALTER TABLE claims ADD COLUMN contact_source jsonb DEFAULT '{}'::jsonb;
        -- contact_source shape: {"homeowner_email": "manual",
        --                        "adjuster_email": "scope_2026-04-15"}
    END IF;
END $$;


-- ============================================================
-- 7. CLAIM WINS — dual tracking (forensic approval + supplement)
-- ============================================================

CREATE TABLE IF NOT EXISTS claim_wins (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    win_type text NOT NULL,
    -- win_type: forensic_approval | supplement
    amount numeric DEFAULT 0,
    previous_rcv numeric,
    new_rcv numeric,
    triggered_by text,
    -- triggered_by: scope_upload | manual | carrier_correspondence | backfill
    scope_revision_index int,
    detected_at timestamptz DEFAULT now(),
    notes text,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wins_claim ON claim_wins(claim_id);
CREATE INDEX IF NOT EXISTS idx_wins_type ON claim_wins(win_type);
CREATE INDEX IF NOT EXISTS idx_wins_detected ON claim_wins(detected_at DESC);

ALTER TABLE claim_wins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team sees wins for their company claims"
    ON claim_wins FOR SELECT
    USING (
        claim_id IN (
            SELECT id FROM claims
            WHERE user_id = auth.uid() OR company_id IN (
                SELECT company_id FROM company_profiles
                WHERE user_id = auth.uid() AND company_id IS NOT NULL
            )
        )
    );

GRANT ALL ON claim_wins TO service_role;

-- Backfill: for every existing claim_outcome='won' claim, insert one
-- claim_wins row (type defaults to supplement since that's what the old
-- detector captured). If settlement_amount is 0, still create the row
-- so UI can render the win — reviewer can set win_type to 'forensic_approval'
-- manually if appropriate.
INSERT INTO claim_wins (claim_id, win_type, amount, previous_rcv, new_rcv, triggered_by, detected_at, notes)
SELECT
    id,
    'supplement',
    COALESCE(settlement_amount, 0),
    COALESCE(original_carrier_rcv, 0),
    COALESCE(original_carrier_rcv, 0) + COALESCE(settlement_amount, 0),
    'backfill',
    COALESCE(created_at, now()),
    'Backfilled from claim_outcome=won on 2026-04-19 migration'
FROM claims
WHERE claim_outcome = 'won'
  AND NOT EXISTS (SELECT 1 FROM claim_wins w WHERE w.claim_id = claims.id);


-- ============================================================
-- 8. CLAIM EVENTS — event-sourced timeline
-- ============================================================

CREATE TABLE IF NOT EXISTS claim_events (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    event_category text NOT NULL,
    -- event_category: milestone | communication | document | action | system
    title text NOT NULL,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL,
    created_at timestamptz DEFAULT now(),
    created_by uuid REFERENCES auth.users(id),
    source text NOT NULL DEFAULT 'system',
    -- source: user | system | homeowner_reply | carrier_email | processor | cron | backfill
    UNIQUE(claim_id, event_type, occurred_at)
);

CREATE INDEX IF NOT EXISTS idx_events_claim_time ON claim_events(claim_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON claim_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_category ON claim_events(event_category);

ALTER TABLE claim_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team sees events for their company claims"
    ON claim_events FOR SELECT
    USING (
        claim_id IN (
            SELECT id FROM claims
            WHERE user_id = auth.uid() OR company_id IN (
                SELECT company_id FROM company_profiles
                WHERE user_id = auth.uid() AND company_id IS NOT NULL
            )
        )
    );

GRANT ALL ON claim_events TO service_role;


-- Backfill claim_events from existing data
-- 8a. claim_opened for every claim
INSERT INTO claim_events (claim_id, event_type, event_category, title, occurred_at, source)
SELECT
    id,
    'claim_opened',
    'milestone',
    'Claim opened',
    COALESCE(created_at, now()),
    'backfill'
FROM claims
ON CONFLICT (claim_id, event_type, occurred_at) DO NOTHING;

-- 8b. forensic_generated for every claim with last_processed_at set
INSERT INTO claim_events (claim_id, event_type, event_category, title, occurred_at, source)
SELECT
    id,
    'forensic_generated',
    'document',
    'Forensic report generated',
    last_processed_at,
    'backfill'
FROM claims
WHERE last_processed_at IS NOT NULL
ON CONFLICT (claim_id, event_type, occurred_at) DO NOTHING;

-- 8c. scope_received for each entry in scope_revisions jsonb array
INSERT INTO claim_events (claim_id, event_type, event_category, title, metadata, occurred_at, source)
SELECT
    c.id,
    'scope_received',
    'milestone',
    'Carrier scope received',
    jsonb_build_object(
        'revision_index', ord - 1,
        'previous_rcv', rev->>'previous_rcv',
        'new_rcv', rev->>'new_rcv',
        'movement', rev->>'movement'
    ),
    COALESCE(
        (rev->>'revision_date')::timestamptz,
        c.created_at,
        now()
    ),
    'backfill'
FROM claims c
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.scope_revisions, '[]'::jsonb)) WITH ORDINALITY AS rev(rev, ord)
WHERE jsonb_typeof(c.scope_revisions) = 'array'
ON CONFLICT (claim_id, event_type, occurred_at) DO NOTHING;

-- 8d. carrier_email_received for every matched carrier_correspondence
INSERT INTO claim_events (claim_id, event_type, event_category, title, metadata, occurred_at, source)
SELECT
    claim_id,
    'carrier_email_received',
    'communication',
    COALESCE('Carrier email: ' || LEFT(original_subject, 80), 'Carrier email received'),
    jsonb_build_object(
        'from_email', original_from,
        'carrier_name', carrier_name,
        'correspondence_id', id
    ),
    COALESCE(original_date, created_at, now()),
    'backfill'
FROM carrier_correspondence
WHERE claim_id IS NOT NULL
ON CONFLICT (claim_id, event_type, occurred_at) DO NOTHING;

-- 8e. win_detected for every claim_wins row (after backfill in step 7)
INSERT INTO claim_events (claim_id, event_type, event_category, title, metadata, occurred_at, source)
SELECT
    claim_id,
    'win_detected',
    'milestone',
    CASE win_type
        WHEN 'forensic_approval' THEN 'Forensic-driven approval'
        WHEN 'supplement' THEN 'Supplement win'
        ELSE 'Claim win'
    END,
    jsonb_build_object(
        'win_type', win_type,
        'amount', amount,
        'previous_rcv', previous_rcv,
        'new_rcv', new_rcv
    ),
    detected_at,
    'backfill'
FROM claim_wins
ON CONFLICT (claim_id, event_type, occurred_at) DO NOTHING;


-- ============================================================
-- 9. RLS WIDENING — widen claims SELECT to team access
-- ============================================================

-- Claims: new policy allowing team members via company_id
-- Existing "own claims" policies are preserved (OR condition below).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'claims' AND policyname = 'Team members see company claims'
    ) THEN
        CREATE POLICY "Team members see company claims"
            ON claims FOR SELECT
            USING (
                user_id = auth.uid() OR
                assigned_user_id = auth.uid() OR
                company_id IN (
                    SELECT company_id FROM company_profiles
                    WHERE user_id = auth.uid() AND company_id IS NOT NULL
                )
            );
    END IF;
END $$;

-- Photos: widen via claim_id -> claims.company_id check
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'photos' AND policyname = 'Team members see company photos'
    ) THEN
        CREATE POLICY "Team members see company photos"
            ON photos FOR SELECT
            USING (
                claim_id IN (
                    SELECT id FROM claims
                    WHERE user_id = auth.uid()
                       OR assigned_user_id = auth.uid()
                       OR company_id IN (
                           SELECT company_id FROM company_profiles
                           WHERE user_id = auth.uid() AND company_id IS NOT NULL
                       )
                )
            );
    END IF;
END $$;


-- ============================================================
-- 10. UPDATED_AT TRIGGERS on new tables
-- ============================================================

CREATE OR REPLACE FUNCTION bump_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS marketing_assets_updated ON marketing_assets;
CREATE TRIGGER marketing_assets_updated BEFORE UPDATE ON marketing_assets
    FOR EACH ROW EXECUTE FUNCTION bump_updated_at();

DROP TRIGGER IF EXISTS email_templates_updated ON email_templates;
CREATE TRIGGER email_templates_updated BEFORE UPDATE ON email_templates
    FOR EACH ROW EXECUTE FUNCTION bump_updated_at();

DROP TRIGGER IF EXISTS homeowner_sequences_updated ON homeowner_sequences;
CREATE TRIGGER homeowner_sequences_updated BEFORE UPDATE ON homeowner_sequences
    FOR EACH ROW EXECUTE FUNCTION bump_updated_at();

DROP TRIGGER IF EXISTS claim_selections_updated ON claim_selections;
CREATE TRIGGER claim_selections_updated BEFORE UPDATE ON claim_selections
    FOR EACH ROW EXECUTE FUNCTION bump_updated_at();

DROP TRIGGER IF EXISTS production_handoffs_updated ON production_handoffs;
CREATE TRIGGER production_handoffs_updated BEFORE UPDATE ON production_handoffs
    FOR EACH ROW EXECUTE FUNCTION bump_updated_at();

DROP TRIGGER IF EXISTS crm_connections_updated ON company_crm_connections;
CREATE TRIGGER crm_connections_updated BEFORE UPDATE ON company_crm_connections
    FOR EACH ROW EXECUTE FUNCTION bump_updated_at();


-- ============================================================
-- Migration complete.
-- Expected row counts after apply (for verification):
--   SELECT COUNT(*) FROM marketing_assets;           -- 13 (seed)
--   SELECT COUNT(*) FROM email_templates;            --  7 (seed)
--   SELECT COUNT(*) FROM claim_wins;                 -- count of claims with claim_outcome='won'
--   SELECT COUNT(*) FROM claim_events
--      WHERE event_type='claim_opened';              -- count of claims
--   SELECT COUNT(*) FROM claims WHERE company_id IS NULL
--      AND user_id IN (SELECT user_id FROM company_profiles
--                      WHERE company_id IS NOT NULL);  -- 0 (all backfilled)
-- ============================================================
