-- Replicates the in-memory _pending_tool_actions dict in main.py.
-- The dict was process-local, so a Tom-clicks-Approve hitting a different
-- Uvicorn worker than the one that streamed the preview returned 404.
-- Fixes Richard reprocess approve 404 issue (incident 2026-04-28 evening, E190).
--
-- TTL = 1h. Cleanup is "delete on read" plus a future cron sweep if needed.

CREATE TABLE IF NOT EXISTS pending_tool_actions (
    approval_id TEXT NOT NULL,
    scope TEXT NOT NULL,            -- claim_id (per-claim Richard) OR "admin:{scope}:{user_id}" (admin-brain)
    user_id UUID,                    -- caller user_id when known
    tool_result JSONB NOT NULL,      -- entire previewed tool result (preview, draft, message, type, etc.)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour'),
    PRIMARY KEY (scope, approval_id)
);

CREATE INDEX IF NOT EXISTS pending_tool_actions_expires_idx
    ON pending_tool_actions(expires_at);

-- Service-role only access. No RLS policies = no anon/authenticated access
-- (Postgres default deny). The backend uses the service key for reads/writes.
ALTER TABLE pending_tool_actions ENABLE ROW LEVEL SECURITY;
