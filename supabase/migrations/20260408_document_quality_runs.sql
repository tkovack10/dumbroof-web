-- Twice-Daily Document Quality Review — Vercel Cron stores each run here so
-- the cron can compute "since last run" window and we have grade trend history
-- across runs. See src/app/api/cron/document-quality/route.ts and Phase 9 of
-- ~/.claude/plans/snazzy-jingling-petal.md.
--
-- Applied via Supabase MCP on 2026-04-08. This file is kept in sync with the
-- applied migration so local supabase db push + remote are identical.

CREATE TABLE IF NOT EXISTS document_quality_runs (
    id bigserial PRIMARY KEY,
    ran_at timestamptz NOT NULL DEFAULT now(),

    -- Window covered by this run
    window_start timestamptz NOT NULL,
    window_end timestamptz NOT NULL,

    -- Aggregate counts
    claims_reviewed integer NOT NULL DEFAULT 0,
    grade_a_count integer NOT NULL DEFAULT 0,
    grade_b_count integer NOT NULL DEFAULT 0,
    grade_c_count integer NOT NULL DEFAULT 0,
    grade_f_count integer NOT NULL DEFAULT 0,

    -- Per-claim grades (jsonb array — one entry per claim reviewed)
    claim_grades jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- Cross-cutting issues found in the window
    critical_issues jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- Runtime metadata
    duration_ms integer,
    error_message text,
    email_sent boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS document_quality_runs_ran_at_idx
    ON document_quality_runs (ran_at DESC);

ALTER TABLE document_quality_runs ENABLE ROW LEVEL SECURITY;
