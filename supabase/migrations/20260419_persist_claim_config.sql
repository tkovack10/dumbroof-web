-- Persist claim_config JSONB so DS/TAS component subscores can be
-- recomputed offline for calibration (today the config is only written to
-- ephemeral work_dir on Railway and lost after each run).
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS claim_config jsonb;

COMMENT ON COLUMN claims.claim_config IS
  'Full claim_config.json blob written by processor.py at end of pipeline. Enables offline re-scoring for DS/TAS calibration + any future deterministic analysis. Previously only written to ephemeral work_dir on Railway, lost after each run.';
