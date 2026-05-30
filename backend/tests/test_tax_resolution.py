"""E275 — per-state sales-tax resolution.

Root cause (fixed): build_config computed tax via a local `_tax_rates` dict
covering only 12 states, defaulting to 0.08 (NY) for everything else. The state
WAS resolved correctly (property.state -> "TX"), but TX wasn't in the dict, so
Claim B (Humble TX) was taxed at 8% instead of 6.25%. ~40 states had the same
8% NY default. Fix: `_resolve_tax_rate` keeps the hand-tuned overrides
authoritative (preserves live behavior) and routes every other state through
the canonical building_codes table (state_codes.json, 52 states).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import processor
from building_codes import lookup as bc


def test_tx_gets_canonical_rate_not_ny_default():
    # the actual Claim B bug: TX was 0.08, should be 0.0625
    assert processor._resolve_tax_rate("TX") == 0.0625


def test_hand_tuned_overrides_preserved_exactly():
    # zero regression for the 12 previously-configured states
    expected = {
        "NY": 0.08, "PA": 0.0, "NJ": 0.06625, "CT": 0.0635,
        "MD": 0.06, "DE": 0.0, "OH": 0.0725,   # OH stays combined 7.25%, not JSON 5.75%
        "MI": 0.06, "IL": 0.0625, "MN": 0.06875,
        "AZ": 0.056, "SC": 0.06,
    }
    for state, rate in expected.items():
        assert processor._resolve_tax_rate(state) == rate, f"{state} regressed"


def test_json_only_states_use_canonical_table():
    # states NOT in the overrides but modeled in state_codes.json
    for s in ("GA", "FL", "CA", "CO", "NC", "VA", "WA"):
        got = processor._resolve_tax_rate(s)
        assert got == bc.get_sales_tax(s), f"{s} should read the canonical table"


def test_no_priced_state_lands_on_the_old_8pct_default():
    # the regression we shipped: NO modeled state should silently get 0.08
    # unless its real rate IS 0.08 (only NY).
    for s in bc.all_states():
        rate = processor._resolve_tax_rate(s)
        if abs(rate - 0.08) < 1e-9:
            assert s.upper() == "NY", f"{s} resolved to 8% but isn't NY — stale default leaked"


def test_case_insensitive():
    assert processor._resolve_tax_rate("tx") == 0.0625
    assert processor._resolve_tax_rate("Ny") == 0.08


def test_unmodeled_state_is_zero_not_eight_percent():
    # safer to under-tax an unknown state than apply a wrong 8%
    assert processor._resolve_tax_rate("ZZ") == 0.0
    assert processor._resolve_tax_rate("") == 0.0
    assert processor._resolve_tax_rate(None) == 0.0


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"  PASS {name}")
    print("All E275 tax-resolution tests passed.")
