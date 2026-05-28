-- Ship 17 install-supplement architecture — persist scope_timing at the DB layer.
--
-- PR #42 introduced a `scope_timing` enum on in-memory line_items ('initial' |
-- 'install_supplement'); PRs #44/#45 made the in-memory consumers (compute_financials,
-- scope comparison) filter to 'initial'. But scope_timing was NEVER persisted to this
-- per-claim `line_items` table (telemetry.write_line_items dropped it, no column existed),
-- so every DB-side recompute of claims.contractor_rcv re-inflated by silently including
-- install_supplement rows it couldn't see the tag on. This column closes that gap: it is
-- the prerequisite for PR B (Python persist + filter) and PR C (TypeScript persist + filter).
--
-- Default 'initial' backfills every existing row — correct, because all production line
-- items pre-PR-#42 are initial-estimate scope. NOT-NULL with a constant DEFAULT is a
-- metadata-only add on PG15 (no full-table rewrite). CHECK keeps the enum honest at the DB.
-- IF NOT EXISTS guards make re-application idempotent (manual-apply project, no CI db push).

ALTER TABLE line_items
  ADD COLUMN IF NOT EXISTS scope_timing TEXT NOT NULL DEFAULT 'initial'
  CHECK (scope_timing IN ('initial', 'install_supplement'));

-- Recompute paths filter WHERE claim_id = ? AND scope_timing = 'initial' on the SUM,
-- so index the exact access pattern.
CREATE INDEX IF NOT EXISTS line_items_scope_timing_idx
  ON line_items (claim_id, scope_timing);
