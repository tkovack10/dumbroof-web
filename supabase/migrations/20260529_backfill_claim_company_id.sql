-- Backfill claims.company_id from the owner's company_profiles.company_id.
--
-- Foundation for company-scoped access enforcement (see backend/main.py
-- _user_can_access_claim: a user may access a claim iff they OWN it OR share
-- its company_id). Without this backfill, the unconditional ownership check
-- would OVER-restrict the handful of claims whose owner belongs to a company
-- but whose company_id was never written — the owner still passes (user_id
-- match), but their teammates would be wrongly 403'd.
--
-- Solo-owner claims whose owner has NO company_profiles.company_id are LEFT
-- NULL on purpose: NULL company_id = owner-only access, which is the correct
-- behavior for a single-operator account.
--
-- Idempotent: the `c.company_id is null` guard means re-running is a no-op,
-- and it never overwrites a company_id that is already set.

update claims c
set company_id = cp.company_id
from company_profiles cp
where cp.user_id = c.user_id
  and cp.company_id is not null
  and c.company_id is null;
