-- ============================================================
-- EMAIL INGESTION SYSTEM — Carrier Correspondence + AI Response Drafting
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Created: 2026-03-03
-- ============================================================

-- ============================================================
-- TABLE 1: carrier_correspondence — Every inbound carrier email
-- ============================================================
CREATE TABLE IF NOT EXISTS carrier_correspondence (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid REFERENCES claims(id) ON DELETE SET NULL,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    message_id text UNIQUE,                          -- RFC Message-ID for dedup
    from_email text NOT NULL,                        -- Who forwarded it
    original_from text,                              -- Actual carrier email
    original_subject text,                           -- Carrier's subject line
    original_date timestamptz,                       -- When carrier sent it
    text_body text,                                  -- Plain text content
    html_body text,                                  -- HTML content
    is_forwarded boolean DEFAULT false,              -- Was this forwarded by a rep?
    carrier_name text,                               -- Matched carrier name
    claim_number_parsed text,                        -- Extracted from email body/subject
    address_parsed text,                             -- Extracted from email body/subject
    attachment_paths text[] DEFAULT '{}',            -- Supabase Storage paths
    match_method text,                               -- thread | claim_number | policy | address | carrier_email | subject_keywords | manual
    match_confidence numeric DEFAULT 0,              -- 0-100
    carrier_position jsonb,                          -- AI analysis: {stance, key_arguments, weaknesses, tone, urgency}
    suggested_action text,                           -- escalate | respond_socratic | request_reinspection | factual_rebuttal | accept
    analysis_status text DEFAULT 'pending',          -- pending → analyzing → analyzed → error
    status text DEFAULT 'unmatched',                 -- unmatched → matched → response_drafted → response_sent → archived
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cc_claim_id ON carrier_correspondence(claim_id);
CREATE INDEX IF NOT EXISTS idx_cc_user_id ON carrier_correspondence(user_id);
CREATE INDEX IF NOT EXISTS idx_cc_status ON carrier_correspondence(status);
CREATE INDEX IF NOT EXISTS idx_cc_analysis_status ON carrier_correspondence(analysis_status);
CREATE INDEX IF NOT EXISTS idx_cc_message_id ON carrier_correspondence(message_id);
CREATE INDEX IF NOT EXISTS idx_cc_from_email ON carrier_correspondence(from_email);
CREATE INDEX IF NOT EXISTS idx_cc_carrier_name ON carrier_correspondence(carrier_name);

ALTER TABLE carrier_correspondence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to carrier_correspondence"
    ON carrier_correspondence FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Users see their own correspondence"
    ON carrier_correspondence FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users update their own correspondence"
    ON carrier_correspondence FOR UPDATE
    USING (user_id = auth.uid());


-- ============================================================
-- TABLE 2: email_drafts — AI-generated response drafts pending review
-- ============================================================
CREATE TABLE IF NOT EXISTS email_drafts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    correspondence_id uuid REFERENCES carrier_correspondence(id) ON DELETE CASCADE NOT NULL,
    claim_id uuid REFERENCES claims(id) ON DELETE SET NULL,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    to_email text,                                   -- Carrier email
    cc_email text,                                   -- CC recipients
    subject text,                                    -- Email subject
    body_html text,                                  -- AI-generated HTML body
    body_text text,                                  -- AI-generated plain text body
    selected_photos jsonb DEFAULT '[]'::jsonb,       -- [{path, annotation_key, description, reason, score}]
    response_strategy text,                          -- socratic | factual_rebuttal | escalation | reinspection_request
    carrier_weaknesses jsonb DEFAULT '[]'::jsonb,    -- [{weakness, evidence, suggested_question}]
    compliance_role text DEFAULT 'contractor',       -- contractor | public_adjuster | attorney | homeowner
    edited_body_html text,                           -- User's edits (NULL until edited)
    status text DEFAULT 'draft',                     -- draft → edited → approved → sent → rejected
    sent_at timestamptz,                             -- When actually sent
    gmail_thread_id text,                            -- For thread tracking
    generation_cost numeric DEFAULT 0,               -- Claude API cost in USD
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ed_correspondence_id ON email_drafts(correspondence_id);
CREATE INDEX IF NOT EXISTS idx_ed_claim_id ON email_drafts(claim_id);
CREATE INDEX IF NOT EXISTS idx_ed_user_id ON email_drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_ed_status ON email_drafts(status);

ALTER TABLE email_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to email_drafts"
    ON email_drafts FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Users see their own drafts"
    ON email_drafts FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users update their own drafts"
    ON email_drafts FOR UPDATE
    USING (user_id = auth.uid());


-- ============================================================
-- TABLE 3: authorized_forwarders — Maps sales rep emails to user accounts
-- ============================================================
CREATE TABLE IF NOT EXISTS authorized_forwarders (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    email text NOT NULL UNIQUE,                      -- Sales rep's email address
    name text,                                       -- Display name
    role text DEFAULT 'sales_rep',                   -- sales_rep | team_member | office_admin
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_af_user_id ON authorized_forwarders(user_id);
CREATE INDEX IF NOT EXISTS idx_af_email ON authorized_forwarders(email);

ALTER TABLE authorized_forwarders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to authorized_forwarders"
    ON authorized_forwarders FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Users see their own forwarders"
    ON authorized_forwarders FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users manage their own forwarders"
    ON authorized_forwarders FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update their own forwarders"
    ON authorized_forwarders FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY "Users delete their own forwarders"
    ON authorized_forwarders FOR DELETE
    USING (user_id = auth.uid());


-- ============================================================
-- CLAIMS TABLE ADDITIONS — Correspondence tracking columns
-- ============================================================
ALTER TABLE claims ADD COLUMN IF NOT EXISTS correspondence_count smallint DEFAULT 0;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS latest_carrier_position text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS pending_drafts smallint DEFAULT 0;


-- ============================================================
-- HELPER FUNCTION — Auto-update updated_at timestamp
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_carrier_correspondence_updated_at
    BEFORE UPDATE ON carrier_correspondence
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_email_drafts_updated_at
    BEFORE UPDATE ON email_drafts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- VIEW — Correspondence summary per claim
-- ============================================================
CREATE OR REPLACE VIEW correspondence_summary AS
SELECT
    cc.claim_id,
    COUNT(*) AS total_emails,
    COUNT(*) FILTER (WHERE cc.status = 'unmatched') AS unmatched,
    COUNT(*) FILTER (WHERE cc.status = 'matched') AS matched,
    COUNT(*) FILTER (WHERE cc.status = 'response_drafted') AS drafts_pending,
    COUNT(*) FILTER (WHERE cc.status = 'response_sent') AS sent,
    MAX(cc.created_at) AS latest_email_at,
    (SELECT carrier_position->>'stance'
     FROM carrier_correspondence sub
     WHERE sub.claim_id = cc.claim_id
     ORDER BY sub.created_at DESC LIMIT 1
    ) AS latest_stance
FROM carrier_correspondence cc
WHERE cc.claim_id IS NOT NULL
GROUP BY cc.claim_id;
