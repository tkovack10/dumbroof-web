-- Photo Review: annotation_feedback table + photos.filename column
-- Run via psql against Supabase

-- 1. Create annotation_feedback table for photo review training data
CREATE TABLE IF NOT EXISTS annotation_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  claim_id uuid REFERENCES claims(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('approved', 'corrected', 'rejected')),
  original_annotation text,
  corrected_annotation text,
  original_tags jsonb,
  corrected_tags jsonb,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(photo_id)
);

ALTER TABLE annotation_feedback ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users read own annotation feedback" ON annotation_feedback FOR SELECT
    USING (claim_id IN (SELECT id FROM claims WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full annotation access" ON annotation_feedback FOR ALL
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_annotation_feedback_claim ON annotation_feedback(claim_id);
CREATE INDEX IF NOT EXISTS idx_annotation_feedback_photo ON annotation_feedback(photo_id);

-- 2. Add filename column to photos table (stores actual filename for URL construction)
ALTER TABLE photos ADD COLUMN IF NOT EXISTS filename text;
