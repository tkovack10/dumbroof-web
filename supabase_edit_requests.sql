-- ============================================================
-- EDIT REQUESTS SYSTEM — Team Members Email In Report Changes
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Created: 2026-03-03
-- ============================================================

-- ============================================================
-- TABLE: edit_requests — Emailed-in report change requests
-- ============================================================
CREATE TABLE IF NOT EXISTS edit_requests (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid REFERENCES claims(id) ON DELETE SET NULL,
    user_id uuid NOT NULL,
    from_email text,
    original_subject text,
    original_body text,
    request_type text DEFAULT 'other',           -- add_items | update_photos | carrier_scope | remove_items | other
    attachment_paths text[] DEFAULT '{}',
    ai_summary jsonb,                            -- {changes: [{action, item, details}], confidence}
    status text DEFAULT 'pending',               -- pending → approved → applied → rejected
    applied_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_er_claim_id ON edit_requests(claim_id);
CREATE INDEX IF NOT EXISTS idx_er_user_id ON edit_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_er_status ON edit_requests(status);

ALTER TABLE edit_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to edit_requests"
    ON edit_requests FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Users see their own edit_requests"
    ON edit_requests FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users update their own edit_requests"
    ON edit_requests FOR UPDATE
    USING (user_id = auth.uid());

-- ============================================================
-- CLAIMS TABLE ADDITION — Pending edit request count
-- ============================================================
ALTER TABLE claims ADD COLUMN IF NOT EXISTS pending_edits smallint DEFAULT 0;

-- ============================================================
-- AUTO-UPDATE updated_at
-- ============================================================
CREATE TRIGGER update_edit_requests_updated_at
    BEFORE UPDATE ON edit_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
