-- Carrier general claims email on claims.
-- ============================================================
-- The deliverable address we send a supplement or COC to when no adjuster is
-- assigned yet. Required (alongside adjuster_email) by the $100 signed-AOB
-- commission gate (see src/lib/aob-eligibility.ts) so a rep can never bank the
-- $100 on a claim we have no way to correspond with.
--
-- Applied live via Supabase MCP apply_migration on 2026-05-29; this file is the
-- repo record. Nullable + additive; safe to re-run.

ALTER TABLE claims ADD COLUMN IF NOT EXISTS carrier_email text;
