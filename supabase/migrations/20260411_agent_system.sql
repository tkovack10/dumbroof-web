-- Agent system: recommendations queue + weekly run tables + Claim Brain persistence.
-- Implements Phase 2 of the agent wiring plan at ~/.claude/plans/proud-wiggling-hearth.md.

-- ============================================================
-- 1. agent_recommendations — unified review queue
-- ============================================================
-- All 3 continuous-improvement agents (damage-detective, carrier-analyst,
-- richard-trainer) write here. Tom reviews pending rows at
-- /admin/agent-recommendations and clicks "Open PR" to create a GitHub PR
-- with the proposed diff.

CREATE TABLE IF NOT EXISTS agent_recommendations (
  id            bigserial PRIMARY KEY,
  agent         text NOT NULL CHECK (agent IN ('damage_detective','carrier_analyst','richard_trainer','qa_auditor')),
  run_id        bigint,                              -- optional FK to {agent}_runs.id
  target_type   text NOT NULL CHECK (target_type IN ('carrier_playbook','system_prompt','photo_prompt','config','other')),
  target_path   text NOT NULL,                       -- e.g. 'carrier_playbooks/state-farm.md'
  summary       text NOT NULL,                       -- one-line "why"
  rationale     text,                                -- longer explanation with evidence
  proposed_diff text NOT NULL,                       -- unified diff
  evidence      jsonb DEFAULT '{}'::jsonb,           -- claim IDs, metrics, patterns
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','applied','superseded','deferred')),
  reviewed_by   text,
  reviewed_at   timestamptz,
  rejection_reason text,
  deferred_until timestamptz,
  github_pr_url text,
  github_branch text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_recs_status_created
  ON agent_recommendations (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_recs_agent_status
  ON agent_recommendations (agent, status);

COMMENT ON TABLE agent_recommendations IS
  'Unified review queue for all continuous-improvement agents. Each row is one proposed change to a playbook, prompt, or config. Admin reviews at /admin/agent-recommendations and clicks Open PR to create a GitHub PR.';

-- ============================================================
-- 2. Weekly run tables (one per scheduled agent)
-- ============================================================
-- Copies the shape of document_quality_runs from 20260408 — keeps the same
-- "since last run" window logic working with minimal new code.

CREATE TABLE IF NOT EXISTS damage_detective_runs (
  id               bigserial PRIMARY KEY,
  ran_at           timestamptz NOT NULL DEFAULT now(),
  window_start     timestamptz,
  window_end       timestamptz,
  corrections_reviewed integer DEFAULT 0,
  patterns_found   integer DEFAULT 0,
  recommendations_created integer DEFAULT 0,
  full_report      jsonb DEFAULT '{}'::jsonb,
  duration_ms      integer,
  error_message    text,
  email_sent       boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_damage_detective_runs_ran_at
  ON damage_detective_runs (ran_at DESC);

CREATE TABLE IF NOT EXISTS carrier_analyst_runs (
  id               bigserial PRIMARY KEY,
  ran_at           timestamptz NOT NULL DEFAULT now(),
  window_start     timestamptz,
  window_end       timestamptz,
  scopes_reviewed  integer DEFAULT 0,
  carriers_analyzed integer DEFAULT 0,
  new_tactics_found integer DEFAULT 0,
  recommendations_created integer DEFAULT 0,
  full_report      jsonb DEFAULT '{}'::jsonb,
  duration_ms      integer,
  error_message    text,
  email_sent       boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_carrier_analyst_runs_ran_at
  ON carrier_analyst_runs (ran_at DESC);

CREATE TABLE IF NOT EXISTS richard_trainer_runs (
  id               bigserial PRIMARY KEY,
  ran_at           timestamptz NOT NULL DEFAULT now(),
  window_start     timestamptz,
  window_end       timestamptz,
  conversations_reviewed integer DEFAULT 0,
  bad_answers_found integer DEFAULT 0,
  knowledge_gaps_found integer DEFAULT 0,
  recommendations_created integer DEFAULT 0,
  full_report      jsonb DEFAULT '{}'::jsonb,
  duration_ms      integer,
  error_message    text,
  email_sent       boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_richard_trainer_runs_ran_at
  ON richard_trainer_runs (ran_at DESC);

-- ============================================================
-- 3. claim_brain_messages — persistence for Claim Brain chat
-- ============================================================
-- Fixes the in-memory _brain_conversations dict in backend/main.py that
-- loses history on Railway restart. Required prerequisite for
-- richard-trainer — the trainer has nothing to read until chats persist.
-- Also fixes a user-facing bug: chat history now survives page refreshes.

CREATE TABLE IF NOT EXISTS claim_brain_messages (
  id            bigserial PRIMARY KEY,
  claim_id      uuid NOT NULL,
  user_id       uuid,
  role          text NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content       text NOT NULL,
  tool_calls    jsonb,
  model         text,
  tokens_in     integer,
  tokens_out    integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_claim_brain_messages_claim_created
  ON claim_brain_messages (claim_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_claim_brain_messages_created
  ON claim_brain_messages (created_at DESC);

-- ============================================================
-- 4. Per-claim carrier analyst flags
-- ============================================================
-- Written by backend/carrier_analyst.py after scope extraction. Contains
-- detected underpayment tactics, recommended supplement arguments, and
-- code citations specific to this claim.

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS carrier_analyst_flags jsonb DEFAULT NULL;

COMMENT ON COLUMN claims.carrier_analyst_flags IS
  'Per-claim carrier analyst findings written by processor.py after scope extraction. Includes underpayment tactics, supplement arguments, code citations, and playbook deltas.';
