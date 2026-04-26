-- 20260426_richard_chat_messages.sql
-- ─────────────────────────────────────────────────────────────────────
-- Persistent chat history for Richard.
--
-- Replaces the in-process Python dicts (`_admin_brain_conversations`,
-- `_claim_brain_conversations`) which were wiped on every Railway restart.
-- See feedback_richard_agentic.md → "Known gaps (not yet)" → persistence.
--
-- Scope tuple identifies a conversation thread:
--   ('user',    user_id)        — onboarding / settings Richard
--   ('company', user_id)        — owner/admin portfolio Richard
--   ('claim',   claim_id)       — per-claim Richard
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_messages (
  id            BIGSERIAL PRIMARY KEY,
  scope         TEXT NOT NULL CHECK (scope IN ('user', 'company', 'claim')),
  scope_key     TEXT NOT NULL,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content       TEXT NOT NULL,
  tool_actions  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_scope
  ON chat_messages (scope, scope_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user
  ON chat_messages (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at
  ON chat_messages (created_at);

-- ─── Row-Level Security ────────────────────────────────────────────────
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Users can read their own conversations.
-- Company-scope: a member can read messages where scope='company' AND
-- scope_key matches their company_id (resolved via company_profiles).
DROP POLICY IF EXISTS "chat_messages_read_own_user" ON chat_messages;
CREATE POLICY "chat_messages_read_own_user"
  ON chat_messages FOR SELECT
  USING (
    auth.uid() = user_id
    OR (
      scope = 'company'
      AND scope_key IN (
        SELECT company_id::text FROM company_profiles
        WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

-- Writes go through the backend (service role key bypasses RLS), so no
-- INSERT/UPDATE policy for end users — they cannot directly write rows.

-- ─── TTL cleanup helper (call from Vercel cron or pg_cron) ─────────────
-- Deletes chat messages older than 90 days. Conservative — long enough
-- for users to scroll back, short enough to keep table small.
CREATE OR REPLACE FUNCTION cleanup_old_chat_messages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM chat_messages
  WHERE created_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON TABLE chat_messages IS
  'Persistent conversation history for Richard agent (claim/user/company scopes). Replaces in-process Python dicts as of 2026-04-26.';
COMMENT ON COLUMN chat_messages.scope IS
  'Conversation namespace: user (onboarding), company (portfolio), claim (per-claim).';
COMMENT ON COLUMN chat_messages.scope_key IS
  'Identifier within the scope: user_id for user/company scopes, claim_id for claim scope.';
COMMENT ON COLUMN chat_messages.tool_actions IS
  'JSONB array of tool_action objects (preview/complete/error). Preserves tool-call cards across page reloads.';
