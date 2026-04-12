-- qa_audit_flags jsonb column for the inline QA auditor (Phase 1 of the
-- agent wiring plan at ~/.claude/plans/proud-wiggling-hearth.md).
--
-- When `qa_audit_flags.critical` is non-empty, the claim `status` is set to
-- the string 'qa_review_pending' (the status column is already text, no enum
-- change required), the customer completion email is suppressed, and an
-- alert is sent to the admin. Medium/low flags are stored but non-blocking.

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS qa_audit_flags jsonb DEFAULT NULL;

COMMENT ON COLUMN claims.qa_audit_flags IS
  'QA auditor result: {passed, critical[], medium[], low[], recommendation, summary, ground_truth, audited_at}. Written inline by backend/qa_auditor.py after each claim processes. When critical is non-empty, status is set to qa_review_pending and customer email is suppressed.';

-- Index for the admin queue page (fast lookup of blocked claims).
CREATE INDEX IF NOT EXISTS idx_claims_qa_review_pending
  ON claims (last_processed_at DESC)
  WHERE status = 'qa_review_pending';
