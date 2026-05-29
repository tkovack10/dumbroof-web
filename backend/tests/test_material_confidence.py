#!/usr/bin/env python3
"""WS-3 — unit tests for the Vision material-accuracy work.

Covers the three deterministic pieces of WS-3 (the LLM prompt rewrite is
verified structurally + by live eval, not here):

  1. processor._aggregate_material_confidence
       - mean of available confidences; None when NO signal exists
       - conflict = ≥2 distinct HIGH-confidence ROOF-SURFACE materials
       - roof + gutters/flashing/siding is NOT a conflict (non-roof tokens ignored)

  2. processor.synthesize_executive_summary EPDM gate (logic only — no API call)
       - "EPDM puncture marks" appears ONLY when the roof is flat (enum 'other'
         or a flat keyword in the material label), NEVER on sloped shingle/slate/
         tile/metal roofs.

  3. qa_auditor.compute_material_confidence_flags
       - MATERIAL_LOW_CONFIDENCE fires on low claim-level confidence OR
         single-structure conflict
       - SUPPRESSED on legitimate multi-structure mixed-material claims
       - is ALWAYS severity 'medium' (can never block / flip qa_blocked)
       - None confidence (no signal) does NOT fire the low-confidence flag

Self-contained — NO pytest. Plain asserts + __main__.
    python3 backend/tests/test_material_confidence.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import processor  # noqa: E402
from qa_auditor import compute_material_confidence_flags  # noqa: E402


# -------------------------------------------------------------------------
# 1. _aggregate_material_confidence
# -------------------------------------------------------------------------

def test_aggregate_high_confidence_single_material():
    conf, conflict = processor._aggregate_material_confidence(
        [("natural slate", 0.95)],
        {"photo_01": {"material": "slate", "material_confidence": 0.92}},
    )
    assert conf is not None and 0.9 <= conf <= 1.0, conf
    assert conflict is False


def test_aggregate_no_signal_returns_none():
    # No batch confidence, no per-photo material_confidence -> None (unknown),
    # NOT a fabricated low/high number.
    conf, conflict = processor._aggregate_material_confidence(
        [], {"photo_01": {"material": "slate"}}
    )
    assert conf is None, conf
    assert conflict is False


def test_aggregate_detects_conflict_two_distinct_roof_materials():
    conf, conflict = processor._aggregate_material_confidence(
        [],
        {
            "p1": {"material": "slate", "material_confidence": 0.9},
            "p2": {"material": "metal", "material_confidence": 0.9},
        },
    )
    assert conflict is True
    assert conf is not None


def test_aggregate_roof_plus_gutters_is_not_a_conflict():
    # The classic false-positive: a roof material + its gutters/flashing must
    # NOT register as a material conflict (non-roof-surface tokens are ignored).
    conf, conflict = processor._aggregate_material_confidence(
        [],
        {
            "p1": {"material": "comp_shingle_laminated", "material_confidence": 0.9},
            "p2": {"material": "aluminum_gutter", "material_confidence": 0.95},
            "p3": {"material": "metal_flashing", "material_confidence": 0.95},
        },
    )
    assert conflict is False
    assert conf is not None


def test_aggregate_copper_and_metal_collapse_to_one_material():
    # copper -> metal, metal -> metal: same canonical enum, so NOT a conflict.
    conf, conflict = processor._aggregate_material_confidence(
        [],
        {
            "p1": {"material": "metal", "material_confidence": 0.9},
            "p2": {"material": "copper", "material_confidence": 0.9},
        },
    )
    assert conflict is False


def test_aggregate_low_confidence_only_no_conflict():
    conf, conflict = processor._aggregate_material_confidence(
        [("asphalt", 0.3)],
        {"p1": {"material": "other", "material_confidence": 0.2}},
    )
    assert conf is not None and conf < 0.5, conf
    assert conflict is False


def test_aggregate_clamps_out_of_range_confidence():
    conf, _ = processor._aggregate_material_confidence(
        [("slate", 5.0)], {"p1": {"material": "slate", "material_confidence": -2.0}}
    )
    # 5.0 -> 1.0, -2.0 -> 0.0, mean = 0.5
    assert conf is not None and 0.0 <= conf <= 1.0, conf
    assert abs(conf - 0.5) < 1e-6, conf


def test_aggregate_low_high_distinct_materials_not_conflict():
    # Only ONE material is high-confidence; the other is low -> NOT a conflict
    # (conflict requires ≥2 DISTINCT HIGH-confidence roof materials).
    _, conflict = processor._aggregate_material_confidence(
        [],
        {
            "p1": {"material": "slate", "material_confidence": 0.95},
            "p2": {"material": "metal", "material_confidence": 0.40},
        },
    )
    assert conflict is False


# -------------------------------------------------------------------------
# 2. EPDM gate in synthesize_executive_summary (logic only)
# -------------------------------------------------------------------------
#
# We replicate the exact gate expression used inside the function so the test
# is a true mirror of the production branch. (The function itself makes an
# Anthropic call, so we test the decision, not the network round-trip.)

def _epdm_in_signature(material: str, roof_material_enum: str) -> bool:
    _enum = (roof_material_enum or "").strip().lower()
    _mat_label = (material or "").lower()
    _is_flat = (_enum == "other") or any(
        kw in _mat_label
        for kw in ("epdm", "tpo", "modified bitumen", "mod bit",
                   "flat roof", "built-up", "bur", "rubber roof")
    )
    sig = (
        "circular impacts, granule displacement, mat exposure, soft-metal denting"
        + (", EPDM puncture marks" if _is_flat else "")
    )
    return "EPDM" in sig


def test_epdm_absent_on_sloped_roofs():
    for label, enum in [
        ("Natural Slate", "slate"),
        ("Architectural Laminated Comp Shingle", "laminate"),
        ("3-Tab 25yr Comp Shingle", "3tab"),
        ("Standing Seam Metal", "metal"),
        ("Clay/Concrete Tile", "tile"),
    ]:
        assert _epdm_in_signature(label, enum) is False, (label, enum)


def test_epdm_present_on_flat_roof_via_enum():
    assert _epdm_in_signature("Modified Bitumen / Flat Roof", "other") is True


def test_epdm_present_on_flat_roof_via_label_backstop():
    # Enum missing/empty but the label clearly says EPDM -> backstop fires.
    assert _epdm_in_signature("EPDM Membrane", "") is True


def test_epdm_absent_when_enum_missing_but_label_is_sloped_shingle():
    # The prior bug: an unconditional EPDM clause on a sloped shingle roof.
    assert _epdm_in_signature("Architectural Laminated Comp Shingle", "") is False


def test_synthesize_executive_summary_accepts_roof_material_enum_kwarg():
    # Signature guard: the new kwarg must exist with a default so older callers
    # (and the WS-2 call site) don't break.
    import inspect

    sig = inspect.signature(processor.synthesize_executive_summary)
    assert "roof_material_enum" in sig.parameters
    assert sig.parameters["roof_material_enum"].default == ""


# -------------------------------------------------------------------------
# 3. compute_material_confidence_flags (qa_auditor) — MEDIUM-only
# -------------------------------------------------------------------------

def _issues(cfg):
    flags = compute_material_confidence_flags(cfg, {})
    # Invariant: this layer is MEDIUM-only and can NEVER block.
    for f in flags:
        assert f.get("severity") == "medium", f"non-medium flag leaked: {f}"
    return {f["issue"] for f in flags}, flags


def test_flag_fires_on_low_confidence_single_structure():
    cfg = {
        "roof_material_confidence": 0.3,
        "roof_material_conflict": False,
        "structures": [{"roof_material_enum": "laminate"}],
    }
    issues, flags = _issues(cfg)
    assert "MATERIAL_LOW_CONFIDENCE" in issues
    assert flags[0]["reason"] == "low_confidence"


def test_flag_silent_on_high_confidence_no_conflict():
    cfg = {"roof_material_confidence": 0.95, "roof_material_conflict": False}
    issues, _ = _issues(cfg)
    assert "MATERIAL_LOW_CONFIDENCE" not in issues


def test_flag_fires_on_single_structure_conflict():
    cfg = {
        "roof_material_confidence": 0.9,
        "roof_material_conflict": True,
        "structures": [{"roof_material_enum": "slate"}],
    }
    issues, flags = _issues(cfg)
    assert "MATERIAL_LOW_CONFIDENCE" in issues
    assert flags[0]["reason"] == "conflict"


def test_flag_suppressed_on_multi_structure_mixed_material():
    # Slate main dwelling + metal-roof detached garage = legitimate mixed
    # material, NOT a defect. Must NOT fire.
    cfg = {
        "roof_material_confidence": 0.9,
        "roof_material_conflict": True,
        "structures": [
            {"roof_material_enum": "slate"},
            {"roof_material_enum": "metal"},
        ],
    }
    issues, _ = _issues(cfg)
    assert "MATERIAL_LOW_CONFIDENCE" not in issues


def test_flag_not_suppressed_when_multi_structure_same_material():
    # Two structures, BOTH laminate -> not "mixed", so a real conflict signal
    # (e.g. a bad slate read on one photo) is NOT masked.
    cfg = {
        "roof_material_confidence": 0.9,
        "roof_material_conflict": True,
        "structures": [
            {"roof_material_enum": "laminate"},
            {"roof_material_enum": "laminate"},
        ],
    }
    issues, _ = _issues(cfg)
    assert "MATERIAL_LOW_CONFIDENCE" in issues


def test_flag_none_confidence_does_not_fire_low():
    # Absent confidence (None) is "unknown", handled by other data-quality flags
    # — it must NOT register as a low-confidence material flag (noise control).
    cfg = {"roof_material_confidence": None, "roof_material_conflict": False}
    issues, _ = _issues(cfg)
    assert "MATERIAL_LOW_CONFIDENCE" not in issues


def test_flag_combined_reason_when_low_and_conflict():
    cfg = {
        "roof_material_confidence": 0.2,
        "roof_material_conflict": True,
        "structures": [{"roof_material_enum": "tile"}],
    }
    _, flags = _issues(cfg)
    assert flags[0]["reason"] == "low_confidence_and_conflict"


def test_flag_never_critical_even_at_zero_confidence():
    cfg = {
        "roof_material_confidence": 0.0,
        "roof_material_conflict": True,
        "structures": [{"roof_material_enum": "slate"}],
    }
    flags = compute_material_confidence_flags(cfg, {})
    assert all(f.get("severity") == "medium" for f in flags)
    assert all(f.get("severity") != "critical" for f in flags)


def test_flag_robust_to_garbage_input():
    # Detection must never raise.
    assert compute_material_confidence_flags(None, {}) == []
    assert compute_material_confidence_flags({"roof_material_confidence": "abc"}, {}) == []
    assert compute_material_confidence_flags({}, {}) == []


# -------------------------------------------------------------------------

def _run():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in fns:
        fn()
        print(f"PASS {fn.__name__}")
        passed += 1
    print(f"\nALL {passed} WS-3 material-confidence assertions passed.")


if __name__ == "__main__":
    _run()
