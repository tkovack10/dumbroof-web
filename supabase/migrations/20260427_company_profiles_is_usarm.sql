-- 20260427_company_profiles_is_usarm.sql
-- ─────────────────────────────────────────────────────────────────────
-- Replace the string-pattern `"usa roof masters" in company_name` gate
-- in processor.py with an explicit `is_usarm` boolean on company_profiles.
--
-- Why: the string-pattern gate is fragile (rebrand, sister companies,
-- typos, locale variations all fail open or closed unpredictably). An
-- explicit boolean is unambiguous and self-documenting. Default false —
-- safe-by-default; existing USARM team rows are flipped to true via the
-- backfill below.
--
-- See: feedback_richard_agentic.md (E182), processor.py is_usarm_branded
-- block introduced in commit 1db6ace.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE company_profiles
  ADD COLUMN IF NOT EXISTS is_usarm BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN company_profiles.is_usarm IS
  'True for USA Roof Masters team members. Gates the bundled-USARM logo + identity fallback in processor.py. Replaces the string-pattern "usa roof masters" in company_name check (E182).';

-- ─── Backfill existing USARM team rows ─────────────────────────────────
-- Match the string-pattern logic in processor.py (1db6ace) so behavior
-- is preserved on rollout. Any future manual additions to the USARM
-- team should be flipped via UPDATE company_profiles SET is_usarm=true.
UPDATE company_profiles
   SET is_usarm = true
 WHERE is_usarm = false  -- idempotent — only flip rows that aren't already true
   AND (
       LOWER(company_name) LIKE '%usa roof masters%'
       OR LOWER(company_name) IN ('usarm', 'usa roof masters llc')
       OR LOWER(email) LIKE '%@usaroofmasters.com'
   );
