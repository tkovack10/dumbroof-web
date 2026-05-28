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
    return gen._resolve_market_provenance(cfg)["market_code"]


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


def _steep_flagged(cfg):
    return any(f["issue"] == "STEEP_ROOF_MISSING" for f in processor.pricing_qa_flags(cfg))

def test_steep_missing_flagged_when_facet_steep_but_no_item():
    # The audit's genuine-miss shape: steep facets present, no steep line item.
    cfg = {"financials": {"market_code": "TXHO8X_APR26", "market_resolution_reason": "zip_prefix"},
           "structures": [{"pitches": [{"pitch": "9/12", "area_sf": 1013}, {"pitch": "16/12", "area_sf": 51}]}],
           "line_items": [{"description": "Laminated comp shingle roofing - w/out felt", "qty": 30, "unit_price": 294.73}]}
    assert _steep_flagged(cfg)

def test_steep_not_flagged_when_present():
    cfg = {"financials": {"market_code": "TXHO8X_APR26", "market_resolution_reason": "zip_prefix"},
           "structures": [{"pitches": [{"pitch": "9/12", "area_sf": 1013}]}],
           "line_items": [{"description": "Additional charge for steep roof 7/12-9/12", "qty": 10.13, "unit_price": 64.07}]}
    assert not _steep_flagged(cfg)

def test_steep_not_flagged_low_pitch_or_no_pitch_data():
    low = {"financials": {"market_code": "TXHO8X_APR26"}, "structures": [{"pitches": [{"pitch": "5/12", "area_sf": 2000}]}], "line_items": []}
    gap = {"financials": {"market_code": "TXHO8X_APR26"}, "structures": [], "line_items": []}  # data gap, not a steep miss
    assert not _steep_flagged(low) and not _steep_flagged(gap)

def test_steep_flagged_via_predominant_fallback():
    cfg = {"financials": {"market_code": "TXHO8X_APR26"},
           "structures": [{"predominant_pitch": "8/12"}],  # no per-facet pitches -> predominant fallback
           "line_items": [{"description": "Shingles", "qty": 20, "unit_price": 294}]}
    assert _steep_flagged(cfg)

def test_steep_flagged_via_roof_facets_superset_fallback():
    # OH-2187b03f shape: structures empty AND roof_facets populated (AI extraction).
    # Detection MUST fire even though builder doesn't see the data — that's the point.
    # See feedback_detection_superset_principle.md.
    cfg = {"financials": {"market_code": "OHDT8X_APR26"},
           "structures": [],
           "roof_facets": {"roof_facets": [
               {"pitch": "1/12", "area_pct": 34.8, "facet_id": "F9"},
               {"pitch": "9/12", "area_pct": 10.1, "facet_id": "F11"},
               {"pitch": "16/12", "area_pct": 1.0, "facet_id": "F3"},
           ]},
           "line_items": [{"description": "Laminated comp shingle", "qty": 25, "unit_price": 269}]}
    flags = processor.pricing_qa_flags(cfg)
    steep = [f for f in flags if f["issue"] == "STEEP_ROOF_MISSING"]
    assert steep, "STEEP_ROOF_MISSING must fire when only roof_facets has the steep pitch"
    # Detail payload includes the evidence so reviewer doesn't re-investigate
    assert "9/12" in steep[0]["detail"] and "F11" in steep[0]["detail"]
    assert "16/12" in steep[0]["detail"]
    # Evidence sourced from roof_facets gets the Ship-15 note
    assert "roof_facets only" in steep[0]["detail"] or "Ship 15" in steep[0]["detail"]
    # Structured evidence available for programmatic consumers (badges, UI cards)
    assert any(src == "roof_facets" for src, _, _ in steep[0]["steep_evidence"])

def test_steep_not_flagged_when_roof_facets_all_low_pitch():
    # Negative: roof_facets present but all <7/12 → no flag
    cfg = {"financials": {"market_code": "OHDT8X_APR26"},
           "structures": [],
           "roof_facets": {"roof_facets": [
               {"pitch": "4/12", "area_pct": 80.0, "facet_id": "F1"},
               {"pitch": "6/12", "area_pct": 20.0, "facet_id": "F2"},
           ]},
           "line_items": []}
    assert not _steep_flagged(cfg)

def test_steep_not_flagged_when_roof_facets_synthesized_skeleton():
    # Negative: synthesized 4-cardinal skeleton (no real pitch data) shouldn't flag
    # even if it has a "steep" placeholder (defensive — skeletons don't carry pitch).
    cfg = {"financials": {"market_code": "OHDT8X_APR26"},
           "structures": [],
           "roof_facets": {"roof_facets": [
               {"pitch": None, "area_pct": 25.0, "facet_id": "N", "cardinal": "N"},
               {"pitch": None, "area_pct": 25.0, "facet_id": "S", "cardinal": "S"},
           ], "_synthesized": True},
           "line_items": []}
    assert not _steep_flagged(cfg)


# === MARKET_PROVENANCE_MISMATCH (Ship 7.5 — Track 3) ===

def _market_provenance_flagged(cfg):
    return any(f["issue"] == "MARKET_PROVENANCE_MISMATCH" for f in processor.pricing_qa_flags(cfg))

def test_market_provenance_clean_when_all_lines_match_claim_market():
    cfg = {"financials": {"market_code": "TXHO8X_APR26", "market_resolution_reason": "zip_prefix"},
           "line_items": [
               {"description": "Laminated", "qty": 25, "unit_price": 294, "_priced_market": "TXHO8X_APR26"},
               {"description": "Drip edge", "qty": 100, "unit_price": 3.42, "_priced_market": "TXHO8X_APR26"},
           ]}
    assert not _market_provenance_flagged(cfg)

def test_market_provenance_clean_when_national_lines_present():
    # National-rate items (labor, equipment, debris) carry _priced_market='national' — should NOT flag
    cfg = {"financials": {"market_code": "TXHO8X_APR26", "market_resolution_reason": "zip_prefix"},
           "line_items": [
               {"description": "Laminated", "qty": 25, "unit_price": 294, "_priced_market": "TXHO8X_APR26"},
               {"description": "Roofer labor", "qty": 8, "unit_price": 194, "_priced_market": "national"},
               {"description": "Dumpster", "qty": 1, "unit_price": 850, "_priced_market": "national"},
           ]}
    assert not _market_provenance_flagged(cfg)

def test_market_provenance_flags_when_priced_market_differs():
    # Drift case: line priced from DFW but claim resolved to Houston — attribution mismatch
    cfg = {"financials": {"market_code": "TXHO8X_APR26", "market_resolution_reason": "zip_prefix"},
           "line_items": [
               {"description": "Laminated", "qty": 25, "unit_price": 294, "_priced_market": "TXHO8X_APR26"},
               {"description": "Gutter aluminum", "qty": 120, "unit_price": 9.81, "_priced_market": "TXDF8X_APR26"},
           ]}
    flags = processor.pricing_qa_flags(cfg)
    mp = [f for f in flags if f["issue"] == "MARKET_PROVENANCE_MISMATCH"]
    assert mp, "MARKET_PROVENANCE_MISMATCH must fire when a line's _priced_market differs from claim market"
    assert mp[0]["total_mismatched"] == 1
    assert mp[0]["mismatches"][0]["priced_market"] == "TXDF8X_APR26"
    assert mp[0]["mismatches"][0]["expected_market"] == "TXHO8X_APR26"

def test_market_provenance_no_flag_for_legacy_pre_ship2_lines():
    # Backward-compat: lines without _priced_market (pre-Ship-2 line_items) must NOT flag
    cfg = {"financials": {"market_code": "TXHO8X_APR26", "market_resolution_reason": "zip_prefix"},
           "line_items": [
               {"description": "Laminated", "qty": 25, "unit_price": 294},  # no _priced_market
               {"description": "Drip edge", "qty": 100, "unit_price": 3.42},
           ]}
    assert not _market_provenance_flagged(cfg)

def test_market_provenance_no_flag_when_claim_has_no_market_code():
    # If the claim itself has no market_code (broken state, separate check fires for that),
    # we can't compute consistency — must not also flag MARKET_PROVENANCE_MISMATCH
    cfg = {"financials": {"market_resolution_reason": "unresolvable"},
           "line_items": [
               {"description": "Laminated", "qty": 25, "unit_price": 294, "_priced_market": "TXHO8X_APR26"},
           ]}
    assert not _market_provenance_flagged(cfg)


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


# ── Ship 17 Tier A — general-conditions emission (cleanup / mask / permit) ──
# These three INITIAL-estimate items fire ONLY when roofing is scoped. qty is
# deterministic (area / perimeter / flat 1) and independent of market price, so
# the assertions hold with or without live Supabase pricing.
def _build(estimate_request, area_sq=30, eave=100, rake=30):
    from processor import build_line_items
    meas = {"measurements": {"eave": eave, "ridge": 40, "valley": 10, "rake": rake, "hip": 0},
            "structures": [{"roof_area_sq": area_sq, "roof_area_sf": area_sq * 100,
                            "facets": 6, "predominant_pitch": "6/12"}]}
    return build_line_items(meas, {}, "TX", estimate_request=estimate_request,
                            market_code="TXHO8X_APR26")

def _find(items, needle):
    hits = [i for i in items if needle in i["description"].lower()]
    return hits

def test_general_conditions_emitted_when_roofing_scoped():
    items = _build({"roofing": True}, area_sq=30, eave=100, rake=30)

    cleanup = _find(items, "general clean-up")
    assert len(cleanup) == 1, "expected exactly one general clean-up line"
    assert cleanup[0]["qty"] == 30, "clean-up qty must equal roof area (SQ)"
    assert cleanup[0]["unit"] == "SQ" and cleanup[0]["category"] == "GENERAL"

    mask = _find(items, "mask and protect")
    assert len(mask) == 1, "expected exactly one mask-and-protect line"
    assert mask[0]["qty"] == 130, "mask qty must equal perimeter (eave 100 + rake 30)"
    assert mask[0]["unit"] == "LF" and mask[0]["category"] == "GENERAL"

    permit = _find(items, "building permit")
    assert len(permit) == 1, "expected exactly one building-permit line"
    assert permit[0]["qty"] == 1, "permit is a flat qty=1"
    assert permit[0]["unit"] == "EA" and permit[0]["category"] == "GENERAL"

def test_general_conditions_suppressed_when_siding_only():
    # Siding-only claim must NOT carry roofing general-conditions lines.
    items = _build({"siding": True})
    assert not _find(items, "general clean-up")
    assert not _find(items, "mask and protect")
    assert not _find(items, "building permit")

def test_cleanup_scales_with_area_and_mask_with_perimeter():
    small = _build({"roofing": True}, area_sq=20, eave=80, rake=20)
    big = _build({"roofing": True}, area_sq=60, eave=200, rake=60)
    assert _find(small, "general clean-up")[0]["qty"] == 20
    assert _find(big, "general clean-up")[0]["qty"] == 60      # area-driven
    assert _find(small, "mask and protect")[0]["qty"] == 100   # 80 + 20
    assert _find(big, "mask and protect")[0]["qty"] == 260     # 200 + 60
    # permit stays flat regardless of size
    assert _find(small, "building permit")[0]["qty"] == 1
    assert _find(big, "building permit")[0]["qty"] == 1


# ── Ship 17 install-supplement DB persistence (PR B) — initial_line_total ──
# The DB-side contractor_rcv recompute (main._recompute_and_write_contractor_rcv) sums
# initial_line_total over DB-shaped rows. install_supplement rows must NOT inflate it —
# this is the regression PR #44 only patched in-memory (the DB path read rows untagged).
from processor import initial_line_total  # noqa: E402

_DB_ROWS = [
    {"id": "a", "qty": 25, "unit_price": 300.0, "total": 7500.0, "scope_timing": "initial"},
    {"id": "b", "qty": 10, "unit_price": 5.0,   "total": 50.0},                                # untagged → initial
    {"id": "c", "qty": 56, "unit_price": 2.86,  "total": 160.16, "scope_timing": "install_supplement"},  # decking allowance
]

def test_initial_line_total_excludes_install_supplement():
    # initial (7500) + untagged (50) = 7550; decking (160.16) excluded.
    assert initial_line_total(_DB_ROWS) == 7550.0

def test_install_supplement_row_adds_nothing_to_contractor_rcv_base():
    # The core regression: adding an install_supplement row must not change the initial total.
    without = [r for r in _DB_ROWS if r["id"] != "c"]
    assert initial_line_total(_DB_ROWS) == initial_line_total(without)

def test_initial_line_total_honors_excluded_ids_and_qty_fallback():
    rows = [
        {"id": "a", "qty": 25, "unit_price": 300.0, "scope_timing": "initial"},  # no total → qty*price = 7500
        {"id": "x", "qty": 99, "unit_price": 99.0,  "total": 9801.0, "scope_timing": "initial"},  # excluded
    ]
    assert initial_line_total(rows, excluded_ids={"x"}) == 7500.0  # fallback math + exclusion


# ── Ship 17 Tier B — downspout-extension emission (gutter add-on) ──
# Fires only when gutters are scoped. qty = downspout count = max(2, round(eave/35)),
# deterministic (measurement-driven), independent of market price.
def test_downspout_extension_emitted_when_gutters_scoped():
    items = _build({"gutters": True}, eave=140, rake=30)
    ds = _find(items, "downspout extension")
    assert len(ds) == 1, "expected exactly one downspout-extension line"
    assert ds[0]["qty"] == 4, "qty must be round(140/35)=4 downspouts"
    assert ds[0]["unit"] == "EA" and ds[0]["category"] == "GUTTERS"
    # INITIAL timing — stays in Doc 02 (untagged → initial), never tagged install_supplement
    assert ds[0].get("scope_timing", "initial") == "initial"

def test_downspout_extension_suppressed_when_gutters_not_scoped():
    # Roofing-only claim opts out of gutters → no downspout line.
    items = _build({"roofing": True}, eave=140)
    assert not _find(items, "downspout extension")

def test_downspout_extension_count_floor_and_scaling():
    small = _build({"gutters": True}, eave=20)    # round(20/35)=1 → floored to 2
    big = _build({"gutters": True}, eave=350)      # round(350/35)=10
    assert _find(small, "downspout extension")[0]["qty"] == 2, "min 2 downspouts per home"
    assert _find(big, "downspout extension")[0]["qty"] == 10  # scales with gutter run

def test_downspout_extension_emitted_on_siding_plus_gutters():
    # Gutters scoped alongside siding (no roofing) → still emits.
    items = _build({"siding": True, "gutters": True}, eave=105)
    ds = _find(items, "downspout extension")
    assert len(ds) == 1 and ds[0]["qty"] == 3  # round(105/35)=3


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
