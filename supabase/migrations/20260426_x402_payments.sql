-- 20260426_x402_payments.sql
-- ─────────────────────────────────────────────────────────────────────
-- Public Richard API — x402 payment tracking + job queue
--
-- Pairs with backend/x402_auth.py + backend/public_richard.py.
-- Replay protection (one-shot payment_id) and async job state for
-- POST /v1/agent/process-claim live in these tables.
--
-- Design notes:
--   * `x402_payments.payment_id` is the wallet-signed nonce — uniquely
--     identifies a single x402 commitment. Re-presenting it returns 409.
--   * `signature` stored as TEXT (max 512 chars) for audit / forensics;
--     not used for verification after first acceptance.
--   * `x402_jobs` is the async queue for /v1/agent/process-claim.
--     synchronous endpoints (draft-supplement, annotate-photo) don't
--     write here — they return inline.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS x402_payments (
  payment_id      TEXT PRIMARY KEY,
  wallet_address  TEXT NOT NULL,
  amount_usd      NUMERIC NOT NULL CHECK (amount_usd >= 0),
  asset           TEXT NOT NULL DEFAULT 'USDC',
  network         TEXT NOT NULL DEFAULT 'base',
  endpoint        TEXT NOT NULL,
  signature       TEXT,
  expires_at      BIGINT,                          -- caller-side TTL (unix)
  status          TEXT NOT NULL DEFAULT 'verified' -- verified | refund_pending | refunded
                  CHECK (status IN ('verified', 'refund_pending', 'refunded')),
  refund_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  refunded_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_x402_payments_wallet
  ON x402_payments (wallet_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_x402_payments_endpoint
  ON x402_payments (endpoint, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_x402_payments_status
  ON x402_payments (status, created_at);


CREATE TABLE IF NOT EXISTS x402_jobs (
  job_id            TEXT PRIMARY KEY,
  payment_id        TEXT REFERENCES x402_payments(payment_id) ON DELETE SET NULL,
  endpoint          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  request_payload   JSONB,
  result_payload    JSONB,
  error_code        TEXT,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_x402_jobs_status
  ON x402_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS idx_x402_jobs_payment
  ON x402_jobs (payment_id);


-- ─── Row-Level Security ────────────────────────────────────────────────
-- Both tables are service-role-only (no end-user direct access). Callers
-- talk to backend routes which use the service key. RLS enabled with NO
-- read policies so accidental client-side queries return empty.
ALTER TABLE x402_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE x402_jobs ENABLE ROW LEVEL SECURITY;

-- Only service role bypasses RLS; no policies grant authenticated/anon
-- read or write access. (Service role bypass is automatic.)


-- ─── TTL cleanup helpers (call from cron) ──────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_expired_x402_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM x402_jobs
  WHERE expires_at < NOW()
    AND status IN ('succeeded', 'failed');
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION cleanup_old_x402_payments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  -- Keep payment audit for 1 year (compliance + refund disputes).
  DELETE FROM x402_payments
  WHERE created_at < NOW() - INTERVAL '365 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


COMMENT ON TABLE x402_payments IS
  'x402 payment receipts for the public Richard API. payment_id is single-use (replay protection).';
COMMENT ON TABLE x402_jobs IS
  'Async job queue for /v1/agent/process-claim. Synchronous endpoints (draft-supplement, annotate-photo) bypass this.';
