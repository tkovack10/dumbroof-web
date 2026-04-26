-- Phase B — Onboarding Checklist Widget
-- One column added to company_profiles so the dashboard can stop showing
-- the checklist once the user clicks ×. NULL = still showing; non-NULL = hidden.
--
-- Anchor: ~/.claude/plans/glimmering-scribbling-steele.md (Phase B)

ALTER TABLE company_profiles
  ADD COLUMN IF NOT EXISTS onboarding_dismissed_at TIMESTAMPTZ;

COMMENT ON COLUMN company_profiles.onboarding_dismissed_at IS
  'When the user dismissed the onboarding checklist widget on /dashboard. '
  'NULL = widget still showing if any of the 5 steps are incomplete. '
  'Non-NULL = user clicked the × dismiss button; widget never renders again.';
