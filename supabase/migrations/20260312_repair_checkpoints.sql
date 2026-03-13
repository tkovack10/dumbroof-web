-- Repair Checkpoints — Interactive multi-checkpoint repair system
-- Allows AI to stay with the roofer from diagnosis through completion

CREATE TABLE IF NOT EXISTS repair_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_id UUID NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  checkpoint_number INTEGER NOT NULL,
  checkpoint_type TEXT NOT NULL,  -- verify_diagnosis, expose_and_inspect, mid_repair_check, completion_verify
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, photos_uploaded, analyzing, passed, pivot, skipped

  -- AI instructions to the roofer
  instructions_en TEXT NOT NULL,
  instructions_es TEXT,
  what_to_photograph TEXT,
  expected_finding TEXT,

  -- Roofer response
  photo_files TEXT[] DEFAULT '{}',
  roofer_notes TEXT,

  -- AI analysis results (+ diagnosis snapshot for context continuity)
  diagnosis_snapshot JSONB,       -- snapshot of diagnosis state BEFORE this checkpoint
  ai_analysis TEXT,
  ai_analysis_es TEXT,
  ai_confidence REAL,
  ai_decision TEXT,  -- proceed, pivot, add_checkpoint, escalate
  pivot_reason TEXT,
  updated_diagnosis JSONB,        -- only populated if pivoting
  updated_repair_plan JSONB,      -- only populated if pivoting
  message_to_roofer_en TEXT,
  message_to_roofer_es TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  responded_at TIMESTAMPTZ,
  analyzed_at TIMESTAMPTZ,

  UNIQUE(repair_id, checkpoint_number)
);

-- RLS (matches annotation_feedback pattern)
ALTER TABLE repair_checkpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own repair checkpoints" ON repair_checkpoints FOR SELECT
  USING (repair_id IN (SELECT id FROM repairs WHERE user_id = auth.uid()));

CREATE POLICY "Service role full checkpoint access" ON repair_checkpoints FOR ALL
  USING (true) WITH CHECK (true);

CREATE INDEX idx_repair_checkpoints_repair_id ON repair_checkpoints(repair_id);
CREATE INDEX idx_repair_checkpoints_pending ON repair_checkpoints(status) WHERE status IN ('photos_uploaded');

-- Add checkpoint tracking columns to repairs
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS current_checkpoint_id UUID;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS checkpoint_count INTEGER DEFAULT 0;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS original_diagnosis_code TEXT;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS pivot_count INTEGER DEFAULT 0;
