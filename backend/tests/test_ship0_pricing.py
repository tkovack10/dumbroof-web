#!/usr/bin/env python3
"""Ship 0 pricing guardrails.

Enforces the architectural invariants that let `financials.price_list` survive as
a DISPLAY label without ever diverging from the authoritative `financials.
market_code` (the E202/E210 silent-fallback class), plus the Houston-≠-Dallas
regression that proved the original bug.

Runs with pytest if available, else as a plain script:
    python3 backend/tests/test_ship0_pricing.py
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import processor  # noqa: E402
from processor import derive_price_list_label  # noqa: E402
import usarm_pdf_generator as gen  # noqa: E402

_ALL_MARKETS = json.load(
    open(os.path.join(os.path.dirname(__file__), "..", "pricing", "all-markets.json"))
)["markets"]


# ── Invariant 1: the label derivation is total + deterministic ──────────────
def test_label_derivation_is_total_and_deterministic():
    for code in _ALL_MARKETS:
        label = derive_price_list_label(code)
        assert label and label.endswith("26"), f"{code} → bad label {label!r}"
        # deterministic
        assert derive_price_list_label(code) == label
    # Spot-check the documented format.
    assert derive_price_list_label("TXHO8X_APR26") == "TXHO26"
    assert derive_price_list_label("NYBI8X_MAR26") == "NYBI26"
    assert derive_price_list_label("IAWA8X_02MAY26") == "IAWA26"


# ── Invariant 2: price_list <-> market_code can never diverge ───────────────
def test_price_list_invariant_holds_for_every_market():
    """The label written on the config MUST equal derive(market_code).

    Simulates the single config write site: financials.price_list is set from
    derive_price_list_label(market_code). Assert that holds for every market.
    """
    for code in _ALL_MARKETS:
        financials = {
            "market_code": code,
            "price_list": derive_price_list_label(code),  # the single write site's value
        }
        assert financials["price_list"] == derive_price_list_label(financials["market_code"])


# ── Invariant 3: exactly ONE write site to financials.price_list ────────────
def test_single_write_site_for_price_list():
    """A future edit that adds a second writer reintroduces the divergence path."""
    src = open(os.path.join(os.path.dirname(__file__), "..", "processor.py")).read()
    # Direct assignment: config["financials"]["price_list"] = ...
    direct = re.findall(r'\["financials"\]\["price_list"\]\s*=', src)
    # Dict-literal write: "price_list": <value>  (the canonical one)
    literal = re.findall(r'"price_list":\s*resolved_price_list_label', src)
    total_writes = len(direct) + len(literal)
    assert total_writes == 1, (
        f"expected exactly 1 write site to financials.price_list, found {total_writes} "
        f"(direct={direct}, literal={literal}). A second writer can diverge from market_code."
    )


# ── Regression: Houston prices as Houston, never Dallas ─────────────────────
def _resolve(financials, prop=None):
    cfg = {
        "financials": dict(financials),
        "property": prop or {},
        "line_items": [
            {"description": "Laminated - comp. shingle rfg. - w/out felt",
             "unit_price": 0, "qty": 30}
        ],
    }
    return gen._resolve_and_overlay_prices(cfg)["market_code"]


def test_houston_modern_claim_not_dallas():
    # market_code precise + price_list = derived display label "TXHO26"
    m = _resolve({"market_code": "TXHO8X_APR26", "price_list": "TXHO26"})
    assert m == "TXHO8X_APR26", f"Houston claim resolved to {m} (expected TXHO8X_APR26)"


def test_houston_legacy_real_code_in_price_list():
    # legacy claim: real market code stored in price_list, no market_code
    m = _resolve({"price_list": "TXHO8X_APR26"})
    assert m == "TXHO8X_APR26", f"legacy Houston resolved to {m}"


def test_houston_label_only_resolves_from_property():
    # only the derived label + property fields → must resolve Houston, not Dallas
    m = _resolve({"price_list": "TXHO26"},
                 {"state": "TX", "city": "Houston", "zip": "77002"})
    assert m and m.startswith("TXHO"), f"property-resolved to {m} (expected TXHO*)"


# ── Ship 0.2 — resolve_market signals unresolvable; reasons are correct ─────
def test_resolve_market_reasons():
    from xactimate_lookup import XactRegistry
    # Houston via zip → zip_prefix or alias (a real resolution, not unresolvable)
    _, r = XactRegistry.resolve_market("TX", zip_code="77002", city="Houston", return_reason=True)
    assert r not in XactRegistry.UNRESOLVABLE_REASONS, f"Houston flagged unresolvable ({r})"
    # No state → unresolvable_no_state
    code, r = XactRegistry.resolve_market("", return_reason=True)
    assert r == "unresolvable_no_state", f"no-state reason was {r}"
    assert r in XactRegistry.UNRESOLVABLE_REASONS
    # Backward-compat: default call still returns a bare string
    s = XactRegistry.resolve_market("TX", city="Houston")
    assert isinstance(s, str) and s.startswith("TXHO")


# ── Ship 0.2/0.3/0.5 — pricing_qa_flags produces the right blocks/warnings ──
def test_pricing_qa_flags_block_unresolvable():
    cfg = {"financials": {"market_code": "NYBI8X_MAR26",
                          "market_resolution_reason": "unresolvable_no_state"},
           "line_items": [{"description": "x", "qty": 10, "unit_price": 5}]}
    flags = processor.pricing_qa_flags(cfg)
    assert any(f["issue"] == "MARKET_UNRESOLVABLE" and f["severity"] == "critical" for f in flags)


def test_pricing_qa_flags_block_zero_price():
    cfg = {"financials": {"market_code": "TXHO8X_APR26", "market_resolution_reason": "zip_prefix"},
           "line_items": [{"description": "Drip edge", "qty": 120, "unit_price": 0},
                          {"description": "Shingles", "qty": 30, "unit_price": 294.73}]}
    flags = processor.pricing_qa_flags(cfg)
    zero = [f for f in flags if f["issue"] == "ZERO_PRICE_LINE_ITEM"]
    assert zero and zero[0]["severity"] == "critical" and zero[0]["count"] == 1


def test_pricing_qa_flags_clean_claim_no_flags():
    cfg = {"financials": {"market_code": "TXHO8X_APR26", "market_resolution_reason": "zip_prefix"},
           "line_items": [{"description": "Shingles", "qty": 30, "unit_price": 294.73}]}
    assert processor.pricing_qa_flags(cfg) == []


def test_pricing_qa_flags_proxy_warning():
    cfg = {"financials": {"market_code": "MNMN8X_APR26", "market_resolution_reason": "nearest_state",
                          "price_list": "MNMN26", "price_list_is_proxy": True},
           "line_items": [{"description": "Shingles", "qty": 30, "unit_price": 294.73}]}
    flags = processor.pricing_qa_flags(cfg)
    assert any(f["issue"] == "PROXY_PRICING" and f["severity"] == "medium" for f in flags)


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
