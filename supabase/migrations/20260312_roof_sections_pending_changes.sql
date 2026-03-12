-- Add roof_sections (jsonb) for the interactive slope/section editor
-- and last_processed_at (timestamptz) for pending changes tracking
ALTER TABLE claims ADD COLUMN IF NOT EXISTS roof_sections jsonb DEFAULT NULL;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS last_processed_at timestamptz DEFAULT NULL;

-- Backfill last_processed_at for claims that are already in "ready" status
UPDATE claims SET last_processed_at = created_at
WHERE status = 'ready' AND last_processed_at IS NULL;
