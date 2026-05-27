#!/usr/bin/env python3
"""Ship 2.5 — prove scope comparison CONSUMES frozen USARM line-item prices, doesn't
re-derive them.

If pre_match_scope_comparison re-priced the USARM side from the registry/relational
source instead of reading the frozen line_item rows, it would be a 7th pricing path
(prioritize Ship 11). The test injects a SENTINEL price the relational/registry source
would never produce ($99.99 gutter) and asserts it survives into the comparison output
unchanged. Per the 2026-05-26 audit, scope comparison is downstream-only on the USARM
side — this locks that in as a regression guard.

Runs with pytest if present, else as a script:
    python3 backend/tests/test_scope_comparison.py
"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from xactimate_lookup import XactRegistry  # noqa: E402

SENTINEL = 99.99  # a price neither the relational tables nor the registry would ever emit

def _rows():
    reg = XactRegistry()
    usarm = [
        {"description": "R&R Seamless aluminum gutter & downspout", "category": "GUTTERS",
         "qty": 10, "unit": "LF", "unit_price": SENTINEL, "trade": "gutters"},
        {"description": "Laminated comp shingle roofing - w/out felt", "category": "ROOFING",
         "qty": 20, "unit": "SQ", "unit_price": SENTINEL, "trade": "roofing"},
    ]
    meas = {"eave": 120, "ridge": 40, "valley": 0, "rake": 30, "hip": 0}
    rows = reg.pre_match_scope_comparison(
        carrier_line_items=[], usarm_line_items=usarm, measurements=meas, state="TX")
    return usarm, rows


def test_pre_match_does_not_mutate_frozen_usarm_prices():
    usarm, _ = _rows()
    assert all(li["unit_price"] == SENTINEL for li in usarm), \
        "pre_match mutated the frozen usarm_line_items unit_price — it must consume, not overwrite"


def test_pre_match_consumes_frozen_sentinel_into_output():
    _, rows = _rows()
    blob = json.dumps(rows)
    # The frozen $99.99 (or its 10x/20x extension) must appear in the comparison output;
    # if scope comparison re-derived from the market, the sentinel would be gone.
    consumed = ("99.99" in blob) or ("999.9" in blob) or ("1999.8" in blob)
    assert consumed, (
        "frozen USARM sentinel price did not flow into the scope comparison output — "
        "pre_match may be RE-DERIVING prices (a 7th pricing path → prioritize Ship 11)"
    )


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t(); print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1; print(f"FAIL {t.__name__}: {e}")
    print(f"\n{len(tests)-failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
