-- Governance v2 Day 4: claims.op_override JSONB column
--
-- Lets Richard's set_op_override tool override the default 3+-trades
-- O&P rule. processor.py reads this column before computing default O&P;
-- if present, it wins over the trade-count heuristic.
--
-- Shape: {"enabled": bool, "overhead_pct": float, "profit_pct": float,
--         "manual_override": bool, "reason": text}
-- NULL = no override, use platform default rule.

ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS op_override JSONB;

COMMENT ON COLUMN public.claims.op_override IS
  'Manual O&P override — when set, overrides the 3+-trades default rule. Set via Richard set_op_override tool. NULL = use default.';
