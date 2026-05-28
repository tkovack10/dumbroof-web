-- Drop the dead recalculate_contractor_rcv(uuid) RPC (defined 20260311_scope_review.sql).
--
-- It SUMs line_items into claims.contractor_rcv WITHOUT a scope_timing filter, so under the
-- Ship 17 install-supplement model it would over-count by including install_supplement rows
-- (decking allowance etc.). It has ZERO callers (verified: no .rpc("recalculate_contractor_rcv")
-- in src/ or backend/) — the live recompute paths are main._recompute_and_write_contractor_rcv
-- (PR B) and the TS recalculateContractorRcv (PR C), both of which now filter scope_timing.
--
-- DROP rather than add a filter: a filtered-but-unused SQL function is a SECOND, untested source
-- of truth for "what counts as initial scope" (parallel to the canonical processor.initial_line_total
-- / _is_initial_scope). If contractor_rcv ever needs a DB-side RPC again, the reviver should write a
-- fresh one mirroring initial_line_total — and a missing-function error is far safer than a silently
-- wrong sum. Verified signature: exactly one overload, recalculate_contractor_rcv(claim_id_param uuid).

DROP FUNCTION IF EXISTS public.recalculate_contractor_rcv(uuid);
