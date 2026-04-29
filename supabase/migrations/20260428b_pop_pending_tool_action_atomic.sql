-- Atomic delete-and-return for pending_tool_actions.
-- Solves two issues from the initial 20260428_pending_tool_actions migration:
-- 1. Race: read-then-delete in the application code wasn't atomic, so two
--    concurrent approve POSTs could both see the row, both delete, both
--    execute the underlying action.
-- 2. Caller can now distinguish "Supabase reachable, no row" (RPC succeeded
--    with NULL result) from "Supabase unreachable" (exception). The former
--    means the action was already consumed; the latter means try L1 cache.
--
-- Returns NULL when:
--   - The row doesn't exist at all
--   - The row is expired (expires_at <= now())
-- Returns the tool_result jsonb when present and valid.

CREATE OR REPLACE FUNCTION pop_pending_tool_action(
    p_scope TEXT,
    p_approval_id TEXT
) RETURNS JSONB
LANGUAGE sql
AS $$
    DELETE FROM pending_tool_actions
    WHERE scope = p_scope
      AND approval_id = p_approval_id
      AND expires_at > now()
    RETURNING tool_result;
$$;

GRANT EXECUTE ON FUNCTION pop_pending_tool_action(TEXT, TEXT) TO service_role;
