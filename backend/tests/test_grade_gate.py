"""E271 — shingle GRADE evidence-gate tests.

Covers:
  1. processor._premium_grade_requested        — detects an explicit premium selection
  2. processor._premium_grade_corroborated      — evidence of a genuine premium roof
  3. processor._detect_roof_material gate       — premium STICKS only when corroborated
  4. downgrade-signal logic                     — the boolean persisted on config
  5. qa_auditor.compute_grade_confidence_flags  — MEDIUM-only GRADE_PREMIUM_UNCORROBORATED
  6. end-to-end build_line_items                — the shingle line flips standard <-> high grd

No pytest locally — plain asserts + a __main__ runner (also pytest-compatible).
Run: python3 backend/tests/test_grade_gate.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import processor  # noqa: E402
from processor import (  # noqa: E402
    _detect_roof_material,
    _premium_grade_requested,
    _premium_grade_corroborated,
    build_line_items,
)
from qa_auditor import compute_grade_confidence_flags  # noqa: E402

PREMIUM_MATERIAL = {"roof_material": "Premium Grade Laminate Comp Shingle"}
PREMIUM_TYPE = {"roof_type": "high_grade_laminate"}
STD_MATERIAL = {"roof_material": "Laminate Comp Shingle"}
NO_PHOTO = {"trades_identified": ["roofing"], "photo_annotations": {}, "photo_count": 0}

STD_INSTALL = "Laminated comp shingle roofing - w/out felt"
HIGH_INSTALL = "Laminated - High grd - comp. shingle rfg. - w/out felt"


# -------------------------------------------------------------------------
# 1. _premium_grade_requested
# -------------------------------------------------------------------------

def test_requested_true_for_explicit_premium():
    assert _premium_grade_requested(PREMIUM_MATERIAL) is True
    assert _premium_grade_requested(PREMIUM_TYPE) is True


def test_requested_false_for_standard_or_empty():
    assert _premium_grade_requested(STD_MATERIAL) is False
    assert _premium_grade_requested({"roof_type": "laminate"}) is False
    assert _premium_grade_requested({}) is False
    assert _premium_grade_requested(None) is False


# -------------------------------------------------------------------------
# 2. _premium_grade_corroborated
# -------------------------------------------------------------------------

def test_corroborated_by_named_product_in_notes():
    assert _premium_grade_corroborated({}, "Roof is GAF Grand Sequoia") is True
    assert _premium_grade_corroborated({}, "CertainTeed Grand Manor designer shingle") is True


def test_corroborated_by_generic_premium_terms():
    assert _premium_grade_corroborated({}, "designer shingle, dimensional premium look") is True
    assert _premium_grade_corroborated({}, "this is a luxury shingle roof") is True


def test_corroborated_by_photo_material_read():
    assert _premium_grade_corroborated({"shingle_type": "premium architectural designer"}, "") is True


def test_corroborated_by_carrier_scope_high_grade():
    cs = {"carrier_line_items": [{"item": "Laminated - High grd - comp. shingle rfg."}]}
    assert _premium_grade_corroborated({}, "", cs) is True


def test_NOT_corroborated_by_plain_architectural():
    # The whole point: ordinary architectural / dimensional / laminate is STANDARD.
    assert _premium_grade_corroborated({"shingle_type": "architectural laminated comp shingle"},
                                       "standard dimensional architectural shingle") is False
    assert _premium_grade_corroborated({}, "") is False
    assert _premium_grade_corroborated(None, None, None) is False


# -------------------------------------------------------------------------
# 3. _detect_roof_material gate — the core behavior
# -------------------------------------------------------------------------

def test_uncorroborated_premium_material_downgrades():
    assert _detect_roof_material(NO_PHOTO, "", None, PREMIUM_MATERIAL) == "laminated"


def test_uncorroborated_premium_type_downgrades():
    assert _detect_roof_material(NO_PHOTO, "", None, PREMIUM_TYPE) == "laminated"


def test_corroborated_premium_via_notes_preserved():
    assert _detect_roof_material(NO_PHOTO, "GAF Grand Sequoia", None, PREMIUM_MATERIAL) == "laminated_premium"


def test_corroborated_premium_via_photo_preserved():
    photo = dict(NO_PHOTO, shingle_type="designer shingle")
    assert _detect_roof_material(photo, "", None, PREMIUM_MATERIAL) == "laminated_premium"


def test_corroborated_premium_via_carrier_scope_preserved():
    cs = {"carrier_line_items": [{"item": "Laminated - High grd - comp. shingle rfg."}]}
    assert _detect_roof_material(NO_PHOTO, "", cs, PREMIUM_TYPE) == "laminated_premium"


def test_standard_selection_unchanged():
    assert _detect_roof_material(NO_PHOTO, "", None, STD_MATERIAL) == "laminated"


def test_3tab_selection_unchanged():
    assert _detect_roof_material(NO_PHOTO, "", None, {"roof_material": "3-Tab"}) == "3tab"


def test_non_premium_materials_unaffected_by_gate():
    # Slate selection must still return slate (gate only touches laminated_premium).
    assert _detect_roof_material(NO_PHOTO, "", None, {"roof_material": "Slate"}) == "slate"
    assert _detect_roof_material(NO_PHOTO, "", None, {"roof_type": "standing_seam_metal"}) == "metal_standing_seam"


# -------------------------------------------------------------------------
# 4. downgrade-signal logic (what processor persists on config)
# -------------------------------------------------------------------------

def _uncorroborated(estimate_request, photo_analysis, notes, carrier_scope=None):
    return bool(_premium_grade_requested(estimate_request)
                and not _premium_grade_corroborated(photo_analysis, notes, carrier_scope))


def test_signal_true_only_when_premium_and_uncorroborated():
    assert _uncorroborated(PREMIUM_MATERIAL, {}, "") is True          # premium, no evidence
    assert _uncorroborated(PREMIUM_MATERIAL, {}, "GAF Grand Sequoia") is False  # corroborated
    assert _uncorroborated(STD_MATERIAL, {}, "") is False              # not premium
    assert _uncorroborated({}, {}, "") is False                       # nothing selected


# -------------------------------------------------------------------------
# 5. compute_grade_confidence_flags (qa_auditor)
# -------------------------------------------------------------------------

def test_flag_fires_on_uncorroborated_signal():
    flags = compute_grade_confidence_flags({"roof_grade_premium_uncorroborated": True}, {})
    assert len(flags) == 1
    assert flags[0]["issue"] == "GRADE_PREMIUM_UNCORROBORATED"
    assert flags[0]["severity"] == "medium"


def test_flag_silent_when_not_set():
    assert compute_grade_confidence_flags({"roof_grade_premium_uncorroborated": False}, {}) == []
    assert compute_grade_confidence_flags({}, {}) == []


def test_flag_never_critical():
    flags = compute_grade_confidence_flags({"roof_grade_premium_uncorroborated": True}, {})
    assert all(f.get("severity") == "medium" for f in flags)
    assert all(f.get("severity") != "critical" for f in flags)


def test_flag_robust_to_garbage_input():
    # Non-dict / None / empty must never raise → empty list.
    assert compute_grade_confidence_flags(None, {}) == []
    assert compute_grade_confidence_flags("nope", {}) == []
    assert compute_grade_confidence_flags({}, {}) == []
    # A truthy non-bool (shouldn't occur — processor persists a real bool) must not
    # crash and, if it fires, must stay MEDIUM (never critical).
    f = compute_grade_confidence_flags({"roof_grade_premium_uncorroborated": "abc"}, {})
    assert all(x.get("severity") == "medium" for x in f)


# -------------------------------------------------------------------------
# 6. end-to-end build_line_items — the shingle line flips standard <-> high grd
# -------------------------------------------------------------------------

def _meas(area_sq=20.0):
    return {
        "structures": [{
            "name": "Main", "roof_area_sf": area_sq * 100, "roof_area_sq": area_sq,
            "predominant_pitch": "6/12", "facets": 6, "style": "gable",
            "measurements": {"ridge": 40, "hip": 0, "valley": 20, "rake": 60, "eave": 100},
            "penetrations": {"pipes": 2, "vents": 2, "skylights": 0, "chimneys": 0},
        }],
        "measurements": {"ridge": 40, "hip": 0, "valley": 20, "rake": 60, "eave": 100},
        "penetrations": {"pipes": 2, "vents": 2, "skylights": 0, "chimneys": 0},
        "total_roof_area_sf": area_sq * 100, "total_roof_area_sq": area_sq,
    }


def _descs(items):
    return [i.get("description", "") for i in items]


def test_e2e_uncorroborated_premium_prices_standard():
    items = build_line_items(_meas(), NO_PHOTO, "TX", "", PREMIUM_MATERIAL)
    descs = _descs(items)
    assert STD_INSTALL in descs, f"expected standard install line; got {descs}"
    assert HIGH_INSTALL not in descs, f"high-grade line must NOT appear when uncorroborated; got {descs}"


def test_e2e_corroborated_premium_prices_high_grade():
    items = build_line_items(_meas(), NO_PHOTO, "TX", "GAF Grand Sequoia premium designer shingle", PREMIUM_MATERIAL)
    descs = _descs(items)
    assert HIGH_INSTALL in descs, f"expected high-grade install line when corroborated; got {descs}"
    assert STD_INSTALL not in descs


def test_e2e_standard_selection_prices_standard():
    items = build_line_items(_meas(), NO_PHOTO, "TX", "", STD_MATERIAL)
    descs = _descs(items)
    assert STD_INSTALL in descs
    assert HIGH_INSTALL not in descs


# -------------------------------------------------------------------------

def _run():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in fns:
        fn()
        print(f"PASS {fn.__name__}")
        passed += 1
    print(f"\nALL {passed} E271 grade-gate assertions passed.")


if __name__ == "__main__":
    _run()
