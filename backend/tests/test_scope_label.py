"""Gutter-label fix: the Doc 02 'Scope' header must reflect BILLED trades.

External Claim B (RoofBuds/Humble TX) rendered "Scope: Roofing, Gutters" over a
roofing-only estimate — scope["trades"] carried "gutters" (requested/detected)
but build_line_items emitted no gutter line items. _billed_scope_label filters
the requested trades to those actually present in the line items.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from usarm_pdf_generator import _billed_scope_label


def test_claim_b_drops_unbilled_gutters():
    # the exact bug: roofing line items + a dumpster, scope says roofing+gutters
    items = [
        {"trade": "roofing", "category": "ROOFING", "qty": 17.43},
        {"trade": "roofing", "category": "ROOFING", "qty": 19.52},
        {"category": "DEBRIS", "qty": 1},  # dumpster, no trade field
    ]
    assert _billed_scope_label(items, ["roofing", "gutters"]) == "Roofing"


def test_real_gutters_claim_keeps_gutters():
    items = [{"trade": "roofing", "qty": 17}, {"trade": "gutters", "qty": 120}]
    assert _billed_scope_label(items, ["roofing", "gutters"]) == "Roofing, Gutters"


def test_estimate_pending_no_items_falls_back_to_requested_scope():
    # no line items (estimate-pending) — preserve the requested scope intent
    assert _billed_scope_label([], ["roofing", "gutters"]) == "Roofing, Gutters"
    assert _billed_scope_label(None, ["roofing", "siding"]) == "Roofing, Siding"


def test_requested_order_preserved():
    items = [{"trade": "gutters"}, {"trade": "siding"}, {"trade": "roofing"}]
    assert _billed_scope_label(items, ["roofing", "siding", "gutters"]) == "Roofing, Siding, Gutters"


def test_category_fallback_when_no_trade_field():
    items = [{"category": "ROOFING", "qty": 10}]
    assert _billed_scope_label(items, ["roofing"]) == "Roofing"


def test_requested_trade_with_no_line_items_dropped():
    items = [{"trade": "roofing"}]
    assert _billed_scope_label(items, ["roofing", "siding"]) == "Roofing"


def test_empty_scope_is_empty():
    assert _billed_scope_label([{"trade": "roofing"}], []) == ""


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"  PASS {name}")
    print("All scope-label tests passed.")
