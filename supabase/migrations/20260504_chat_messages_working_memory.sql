-- Governance v2 Day 5: chat_messages.working_memory JSONB column
--
-- Cross-turn "what we're doing right now" state. Survives between Richard
-- chat turns so multi-step plans (e.g. "remove 3 hail photos AND adjust
-- estimate to $19,632.14") aren't lost when the user interrupts.
--
-- Shape: {"active_plan": str, "completed_steps": [str], "pending_steps": [str],
--         "updated_at": iso_timestamp}
-- NULL = no in-progress plan.
--
-- See backend/richard_post.py:WorkingMemory.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS working_memory JSONB;

COMMENT ON COLUMN public.chat_messages.working_memory IS
  'Cross-turn working memory for Richard. Persisted at end-of-turn, injected next turn. NULL = no active plan.';
