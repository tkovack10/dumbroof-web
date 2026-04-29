-- Backfill claim_events with email-send rows from existing claim_emails data
-- (E193 fix). Pre-2026-04-29 the runtime didn't insert claim_events when an
-- email shipped, so Richard's get_claim_timeline was missing every supplement,
-- COC, AOB, and custom email ever sent. This catches them up retroactively.
--
-- Idempotent: NOT EXISTS guard against (claim_id, claim_email_id) so a re-run
-- is a no-op. Maps email_type to event_type per the registry in
-- backend/claim_events.py:CLAIM_EVENT_TYPES.

INSERT INTO claim_events (
    claim_id, created_by, event_type, event_category, title, metadata, occurred_at, source
)
SELECT
    e.claim_id,
    e.user_id AS created_by,
    CASE
        WHEN e.email_type = 'supplement'              THEN 'supplement_sent'
        WHEN e.email_type = 'coc'                     THEN 'coc_sent'
        WHEN e.email_type = 'aob'                     THEN 'aob_sent'
        WHEN e.email_type ILIKE '%signature%'         THEN 'aob_for_signature_sent'
        WHEN e.email_type = 'carrier_custom'          THEN 'carrier_email_sent'
        WHEN e.email_type ILIKE '%homeowner%'         THEN 'homeowner_email_sent'
        ELSE 'carrier_email_sent'
    END AS event_type,
    -- Match the registry in backend/claim_events.py:CLAIM_EVENT_TYPES.
    -- supplement_sent / coc_sent / aob_sent / aob_for_signature_sent are
    -- business-process milestones; the generic *_email_sent are 'communication'.
    CASE
        WHEN e.email_type IN ('supplement', 'coc', 'aob') THEN 'milestone'
        WHEN e.email_type ILIKE '%signature%'             THEN 'milestone'
        ELSE 'communication'
    END AS event_category,
    -- Human-readable title — registry will override on display, but we set
    -- something useful in case a later reader queries title directly.
    CASE
        WHEN e.email_type = 'supplement'              THEN 'Supplement sent'
        WHEN e.email_type = 'coc'                     THEN 'Certificate of Completion sent'
        WHEN e.email_type = 'aob'                     THEN 'AOB sent to carrier'
        WHEN e.email_type ILIKE '%signature%'         THEN 'AOB sent for signature'
        ELSE INITCAP(REPLACE(COALESCE(e.email_type, 'email'), '_', ' ')) || ' sent'
    END AS title,
    jsonb_build_object(
        'to', e.to_email,
        'cc', e.cc_email,
        'subject', e.subject,
        'claim_email_id', e.id::text,
        'email_type', e.email_type,
        'send_method', e.send_method
    ) AS metadata,
    COALESCE(e.sent_at, e.created_at) AS occurred_at,
    'backfill_2026_04_29_email_events' AS source
FROM claim_emails e
WHERE e.status = 'sent'
  AND e.claim_id IS NOT NULL
  AND COALESCE(e.sent_at, e.created_at) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM claim_events ce
    WHERE ce.claim_id = e.claim_id
      AND (ce.metadata->>'claim_email_id') = e.id::text
  );
