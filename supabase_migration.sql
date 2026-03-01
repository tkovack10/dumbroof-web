-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Adds columns needed for: user notes, photo integrity, additional documents, scope revisions

-- User notes — optional text from upload form
ALTER TABLE claims ADD COLUMN IF NOT EXISTS user_notes text;

-- Photo integrity — fraud detection results (stored as JSON)
ALTER TABLE claims ADD COLUMN IF NOT EXISTS photo_integrity jsonb;

-- Other files — additional documents uploaded after initial submission
ALTER TABLE claims ADD COLUMN IF NOT EXISTS other_files text[] DEFAULT '{}';

-- ============================================================
-- SCOPE REVISION TRACKING (Added 2026-02-26)
-- Enables: revised scope comparison, win recording, playbook learning
-- ============================================================

-- Claim outcome tracking (pending → won/denied/appraisal/settled)
ALTER TABLE claims ADD COLUMN IF NOT EXISTS claim_outcome text DEFAULT 'pending';

-- Scope revision history — array of revision records with line-item diffs
-- Each element: {revision_date, previous_rcv, new_rcv, movement, movement_pct, type, items_added[], items_increased[], items_still_missing[]}
ALTER TABLE claims ADD COLUMN IF NOT EXISTS scope_revisions jsonb DEFAULT '[]';

-- Settlement amount — final settlement or appraisal award amount
ALTER TABLE claims ADD COLUMN IF NOT EXISTS settlement_amount numeric DEFAULT 0;

-- Previous carrier RCV — preserved from first processing (carrier_1st_scope equivalent)
ALTER TABLE claims ADD COLUMN IF NOT EXISTS original_carrier_rcv numeric DEFAULT 0;

-- Previous carrier data — full carrier line items from prior processing (for diff)
ALTER TABLE claims ADD COLUMN IF NOT EXISTS previous_carrier_data jsonb;

-- ============================================================
-- ERROR TRACKING (Added 2026-02-28)
-- Stores error message when claim processing fails
-- ============================================================
ALTER TABLE claims ADD COLUMN IF NOT EXISTS error_message text;

-- ============================================================
-- INSPECTOR APPLICATIONS (Added 2026-03-01)
-- Public form — no auth required, RLS allows anonymous inserts
-- ============================================================
CREATE TABLE IF NOT EXISTS inspector_applications (
  id bigint primary key generated always as identity,
  name text not null,
  email text not null,
  phone text not null,
  city text not null,
  state text not null,
  experience text not null,
  haag_certified text not null,
  willing_to_travel text not null,
  insurance_carrier text,
  notes text,
  status text default 'pending',
  created_at timestamptz default now()
);

ALTER TABLE inspector_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can submit inspector applications"
  ON inspector_applications FOR INSERT
  WITH CHECK (true);
