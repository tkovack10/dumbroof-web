#!/usr/bin/env python3
"""Ship 2 parity harness — THE gate before cutting the processor's price reads
from JSON to the relational tables.

For every market, compute:
  OLD = get_pricing_for_state(...)        # current JSON-path PRICING (all-markets + legacy)
  NEW = get_prices_for_market(...) + legacy-fallback   # the proposed relational PRICING
and diff key-by-key after rounding to cents. Pass criterion: 0 diffs (markets
intentionally pending/inactive excepted — handled by status filters upstream).

Read-only: does NOT modify the processor. Run before and after the cutover.

Usage: python3 scripts/parity_harness.py [--verbose]
"""
from __future__ import annotations
import os, sys, argparse
HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "..", "backend")
sys.path.insert(0, BACKEND)

import processor
from processor import get_pricing_for_state, _load_pricing, STATE_PRICE_LIST
from pricing_db import get_prices_for_market
from xactimate_lookup import _get_all_markets

def new_pricing(market_id, state):
    """What the swapped get_pricing_for_state WOULD return: relational keys, then the
    SAME legacy-JSON fallback for keys the relational tables don't carry."""
    rel = dict(get_prices_for_market(market_id))
    legacy = _load_pricing(STATE_PRICE_LIST.get(state.upper(), "NYBI26").lower()) or {}
    for k, v in legacy.items():
        if k not in rel and not k.startswith("_"):
            rel[k] = v
    return rel

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    markets = list(_get_all_markets().get("markets", {}).keys())
    total_keys = mismatches = missing_in_new = missing_in_old = 0
    markets_with_diffs = []

    for mid in markets:
        state = mid[:2]
        processor._PRICING_CACHE.clear()  # force fresh JSON-path build per market
        old = {k: v for k, v in get_pricing_for_state(state, market_code=mid).items()
               if not k.startswith("_")}
        new = new_pricing(mid, state)
        diffs = []
        for k in set(old) | set(new):
            ov, nv = old.get(k), new.get(k)
            if ov is None:
                missing_in_old += 1; diffs.append((k, ov, nv)); continue
            if nv is None:
                missing_in_new += 1; diffs.append((k, ov, nv)); continue
            total_keys += 1
            if round(float(ov), 2) != round(float(nv), 2):
                mismatches += 1; diffs.append((k, ov, nv))
        if diffs:
            markets_with_diffs.append((mid, diffs))

    print(f"\n=== Ship 2 parity: {len(markets)} markets ===")
    print(f"keys compared: {total_keys} | price mismatches: {mismatches} | "
          f"missing-in-relational: {missing_in_new} | missing-in-JSON: {missing_in_old}")
    print(f"markets with ANY diff: {len(markets_with_diffs)}")

    # Aggregate which keys cause diffs (the actionable signal)
    from collections import Counter
    key_diffs = Counter()
    for mid, diffs in markets_with_diffs:
        for k, ov, nv in diffs:
            tag = "MISMATCH" if (ov is not None and nv is not None) else ("MISSING_REL" if nv is None else "MISSING_JSON")
            key_diffs[(k, tag)] += 1
    if key_diffs:
        print("\ndiff drivers (key, type, #markets):")
        for (k, tag), n in key_diffs.most_common(40):
            print(f"  {n:>4}  {tag:<12} {k}")
    if args.verbose and markets_with_diffs:
        mid, diffs = markets_with_diffs[0]
        print(f"\nsample market {mid}:")
        for k, ov, nv in diffs[:20]:
            print(f"    {k}: JSON={ov} REL={nv}")

    clean = (mismatches == 0 and missing_in_new == 0 and missing_in_old == 0)
    print("\n" + ("PARITY CLEAN — safe to cut over." if clean else "PARITY DIFFS — investigate before cutover."))
    sys.exit(0 if clean else 1)

if __name__ == "__main__":
    main()
