-- Backfill claim_events with `forensic_sent_to_carrier` and
-- `forensic_sent_to_homeowner` rows from existing claim_emails data.
--
-- Why: dashboard supplement-win % needs an honest denominator
-- (only claims where work was actually shipped). Per-claim badge strip
-- needs to render which communications have gone out. Going forward the
-- backend writes these events at send time via _record_email_send_side_effects;
-- this catches up history.
--
-- Heuristic (conservative — false negatives over false positives):
--   * forensic_sent_to_carrier:
--       email_type IN supplement / carrier-facing types,
--       AND a forensic_pdf_generated event existed for the claim before sent_at,
--       AND to_email is NOT the homeowner_email.
--   * forensic_sent_to_homeowner:
--       to_email = claims.homeowner_email,
--       AND a forensic_pdf_generated event existed before sent_at.
--
-- Idempotent: NOT EXISTS guard against (claim_id, event_type, occurred_at).
-- Safe to re-run.

-- ─── forensic_sent_to_carrier ────────────────────────────────────────────
INSERT INTO claim_events (
    claim_id, created_by, event_type, event_category, title, metadata, occurred_at, source
)
SELECT
    e.claim_id,
    e.user_id AS created_by,
    'forensic_sent_to_carrier' AS event_type,
    'milestone' AS event_category,
    'Forensic sent to carrier' AS title,
    jsonb_build_object(
        'to', e.to_email,
        'cc', e.cc_email,
        'subject', e.subject,
        'claim_email_id', e.id::text,
        'email_type', e.email_type,
        'send_method', e.send_method,
        'inferred_from_backfill', true
    ) AS metadata,
    COALESCE(e.sent_at, e.created_at) AS occurred_at,
    'backfill_2026_05_10_forensic_sent' AS source
FROM claim_emails e
JOIN claims c ON c.id = e.claim_id
WHERE e.status = 'sent'
  AND e.claim_id IS NOT NULL
  AND COALESCE(e.sent_at, e.created_at) IS NOT NULL
  -- Carrier-facing email types that historically bundled the forensic report.
  -- Excludes 'aob' / 'send_aob_to_carrier' (often homeowner-bound or no forensic),
  -- 'coc' (post-completion, no forensic), and 'invoice' (financial, no forensic).
  AND e.email_type IN (
    'supplement',
    'send_supplement_email',
    'carrier_custom',
    'send_to_carrier',
    'send_custom_email',
    'install_supplement'
  )
  -- Recipient is NOT the homeowner (carrier-facing only).
  AND (c.homeowner_email IS NULL OR LOWER(e.to_email) <> LOWER(c.homeowner_email))
  -- A forensic PDF was generated for this claim before the send.
  AND EXISTS (
    SELECT 1 FROM claim_events fpe
    WHERE fpe.claim_id = e.claim_id
      AND fpe.event_type IN ('forensic_pdf_generated', 'forensic_generated')
      AND fpe.occurred_at <= COALESCE(e.sent_at, e.created_at)
  )
  -- Dedupe by the originating email row (its UUID is the natural primary key
  -- for "this send triggered this event") rather than by occurred_at, which
  -- can have sub-microsecond drift between insert and re-read.
  AND NOT EXISTS (
    SELECT 1 FROM claim_events ce
    WHERE ce.claim_id = e.claim_id
      AND ce.event_type = 'forensic_sent_to_carrier'
      AND (ce.metadata->>'claim_email_id') = e.id::text
  );

-- ─── forensic_sent_to_homeowner ──────────────────────────────────────────
INSERT INTO claim_events (
    claim_id, created_by, event_type, event_category, title, metadata, occurred_at, source
)
SELECT
    e.claim_id,
    e.user_id AS created_by,
    'forensic_sent_to_homeowner' AS event_type,
    'milestone' AS event_category,
    'Forensic sent to homeowner' AS title,
    jsonb_build_object(
        'to', e.to_email,
        'cc', e.cc_email,
        'subject', e.subject,
        'claim_email_id', e.id::text,
        'email_type', e.email_type,
        'send_method', e.send_method,
        'inferred_from_backfill', true
    ) AS metadata,
    COALESCE(e.sent_at, e.created_at) AS occurred_at,
    'backfill_2026_05_10_forensic_sent' AS source
FROM claim_emails e
JOIN claims c ON c.id = e.claim_id
WHERE e.status = 'sent'
  AND e.claim_id IS NOT NULL
  AND COALESCE(e.sent_at, e.created_at) IS NOT NULL
  AND c.homeowner_email IS NOT NULL
  AND (
    -- Direct To: homeowner.
    LOWER(e.to_email) = LOWER(c.homeowner_email)
    -- Or homeowner CC'd alongside carrier (we still credit the homeowner
    -- because they received the doc).
    OR LOWER(COALESCE(e.cc_email, '')) LIKE '%' || LOWER(c.homeowner_email) || '%'
  )
  AND EXISTS (
    SELECT 1 FROM claim_events fpe
    WHERE fpe.claim_id = e.claim_id
      AND fpe.event_type IN ('forensic_pdf_generated', 'forensic_generated')
      AND fpe.occurred_at <= COALESCE(e.sent_at, e.created_at)
  )
  AND NOT EXISTS (
    SELECT 1 FROM claim_events ce
    WHERE ce.claim_id = e.claim_id
      AND ce.event_type = 'forensic_sent_to_homeowner'
      AND (ce.metadata->>'claim_email_id') = e.id::text
  );
