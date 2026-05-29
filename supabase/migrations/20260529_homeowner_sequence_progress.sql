-- 20260529_homeowner_sequence_progress.sql
-- Adds the progress cursor the homeowner-sequences cron driver needs so it can
-- pick the NEXT due time-step without ever double-sending one.
--
-- Background: homeowner_sequences already tracks last_template_slug + last_sent_at
-- (display-only). Those are slug strings — not a robust ordering key. The cron
-- needs an integer cursor it can compare against email_templates.trigger_offset_days
-- to find "the smallest offset strictly greater than what we last sent that is now
-- due (started_at + offset days <= now)".
--
-- last_sent_offset_days:
--   NULL  → no time-step sent yet (sequence freshly started); first eligible step
--           is the smallest trigger_offset_days (typically Day 0).
--   N     → the Day-N step has already been sent; cron only considers offsets > N.
--
-- Idempotent. Run via: supabase db push  (or paste into Supabase SQL editor).
-- DO NOT auto-apply to prod from the PR — Tom runs this manually.

ALTER TABLE homeowner_sequences
    ADD COLUMN IF NOT EXISTS last_sent_offset_days int;

COMMENT ON COLUMN homeowner_sequences.last_sent_offset_days IS
    'Cron progress cursor: highest email_templates.trigger_offset_days already sent for this claim. NULL = none sent yet. The homeowner-sequences cron only sends steps with offset strictly greater than this.';

-- Backfill existing active/paused rows from their send history so the cron does
-- not re-send steps that already went out before this column existed. Maps
-- last_template_slug -> its trigger_offset_days when resolvable; otherwise leaves
-- NULL (worst case the Day-0 welcome could repeat once, which is benign and the
-- claim_events idempotency guard below also protects against same-day repeats).
UPDATE homeowner_sequences hs
SET last_sent_offset_days = sub.max_offset
FROM (
    SELECT s.claim_id,
           MAX(t.trigger_offset_days) AS max_offset
    FROM homeowner_sends s
    JOIN email_templates t
      ON t.slug = s.template_slug
     AND t.trigger_type = 'time'
     AND t.company_id IS NULL
    GROUP BY s.claim_id
) sub
WHERE hs.claim_id = sub.claim_id
  AND hs.last_sent_offset_days IS NULL;

-- ---------------------------------------------------------------------------
-- Idempotency guard for the cron driver.
--
-- The cron records a homeowner_sends row per (claim_id, template_slug) step.
-- Without a DB constraint, a crash between resend.send() and the cursor
-- advance re-sends the SAME step on the next run. This partial unique index
-- makes a duplicate successful send for the same (claim, template) physically
-- impossible: the cron does a SELECT-then-act check first, and even if two
-- runs race past that, the second INSERT hits this constraint and is swallowed
-- as "already sent" (see route.ts isUniqueViolation handling).
--
-- Scoped to error_message IS NULL so a FAILED send (error_message set) does NOT
-- block a later retry of the same step — only a clean prior send does.
-- Columns verified against 20260419_platform_expansion.sql: homeowner_sends has
-- claim_id (uuid), template_slug (text), error_message (text).
CREATE UNIQUE INDEX IF NOT EXISTS homeowner_sends_claim_template_uniq
    ON homeowner_sends (claim_id, template_slug)
    WHERE error_message IS NULL;
