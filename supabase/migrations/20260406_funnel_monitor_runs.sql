-- Funnel Monitor — twice-daily Vercel Cron stores run history here so deltas
-- can be computed across runs. See ~/USARM-Claims-Platform/.claude/plans/snazzy-jingling-petal.md
-- (Phase 3) and src/app/api/cron/funnel-monitor/route.ts.

CREATE TABLE IF NOT EXISTS funnel_monitor_runs (
    id bigserial PRIMARY KEY,
    ran_at timestamptz NOT NULL DEFAULT now(),

    -- Window metrics (since previous run)
    signups_count integer NOT NULL DEFAULT 0,
    uploads_count integer NOT NULL DEFAULT 0,
    visitors_count integer,
    bounce_rate numeric(5, 2),
    new_subscriptions integer NOT NULL DEFAULT 0,
    mrr_delta_cents bigint NOT NULL DEFAULT 0,

    -- Anomalies flagged in this run (severity, code, message)
    anomalies jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- Full structured report (one row per data source) — used for week-over-week
    full_report jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- AI-generated insight (if Anthropic key present)
    ai_insight text,

    -- Runtime metadata
    duration_ms integer,
    sources_succeeded text[],
    sources_failed text[],
    error_message text
);

CREATE INDEX IF NOT EXISTS funnel_monitor_runs_ran_at_idx
    ON funnel_monitor_runs (ran_at DESC);

-- RLS: only service role can read/write — never exposed to clients
ALTER TABLE funnel_monitor_runs ENABLE ROW LEVEL SECURITY;
