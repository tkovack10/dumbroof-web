-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Creates the repairs table for the DumbRoof Repair AI module

-- ============================================================
-- REPAIRS TABLE (separate from claims — different pipeline)
-- ============================================================

CREATE TABLE IF NOT EXISTS repairs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users NOT NULL,
    address text NOT NULL,
    homeowner_name text NOT NULL DEFAULT '',
    slug text NOT NULL,
    status text DEFAULT 'uploaded' NOT NULL,  -- uploaded | processing | ready | error
    file_path text NOT NULL,
    photo_files text[] DEFAULT '{}',
    leak_description text,
    roofer_name text DEFAULT '',
    skill_level text DEFAULT 'journeyman',      -- laborer | journeyman | technician
    preferred_language text DEFAULT 'en',        -- en | es
    output_files text[] DEFAULT '{}',
    repair_type text,                            -- pipe_boot, step_flashing, etc.
    severity text,                               -- minor | moderate | major | critical | emergency
    total_price numeric DEFAULT 0,
    error_message text,
    created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE repairs ENABLE ROW LEVEL SECURITY;

-- Users can read their own repairs
CREATE POLICY "Users can read own repairs" ON repairs
    FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own repairs
CREATE POLICY "Users can insert own repairs" ON repairs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own repairs
CREATE POLICY "Users can update own repairs" ON repairs
    FOR UPDATE USING (auth.uid() = user_id);

-- Service role can do everything (for backend processing)
CREATE POLICY "Service role full access on repairs" ON repairs
    FOR ALL USING (auth.role() = 'service_role');
