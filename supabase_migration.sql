-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Adds columns needed for: user notes, photo integrity, additional documents

-- User notes — optional text from upload form
ALTER TABLE claims ADD COLUMN IF NOT EXISTS user_notes text;

-- Photo integrity — fraud detection results (stored as JSON)
ALTER TABLE claims ADD COLUMN IF NOT EXISTS photo_integrity jsonb;

-- Other files — additional documents uploaded after initial submission
ALTER TABLE claims ADD COLUMN IF NOT EXISTS other_files text[] DEFAULT '{}';
