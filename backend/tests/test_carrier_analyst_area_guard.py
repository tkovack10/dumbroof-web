"""E273 — carrier-analyst phantom additive-area regression guard.

Root cause (fixed): `_build_ground_truth` read the roof area from
`m.get("total_area_sq")/m.get("total_area")`, but the real `measurements` dict
(processor.py:1560) keys it `total_roof_area_sf`/`total_roof_area_sq` (the
carrier-reconstruction fallback uses `total_area_sf`, processor.py:5186), and
the LF values are nested under `measurements["measurements"]` as eave/valley/...
So in production the model received roof area = 0 and, with no denominator and
no rule against it, SUMMED distinct same-surface SQ line items
(tear-off 17.43 + shingle 19.52 + felt 6.29 = 43.24) into a phantom
"43.24 SQ vs carrier 17.3 SQ -> 60% underscoped, +$5,800" — but those three
items all cover the SAME ~17.4 SQ roof, which MATCHES the carrier.

Fix: (1) read the canonical roof-area + nested LF keys; (2) prompt forbids
summing same-surface items; (3) _apply_area_sanity_guard flags any tactic OR
summary text citing a roofing area (SQ or SF) implausibly larger than the
measured roof. Tests exercise the deterministic pieces (no LLM call).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import carrier_analyst as ca


# ---- 1. ground truth reads the REAL extraction schema (Defect-1 regression) ----
def test_ground_truth_reads_canonical_roof_area_and_nested_lf():
    # The exact shape processor.py builds: total_roof_area_sf at top level,
    # LF nested under measurements["measurements"].
    real_measurements = {
        "total_roof_area_sf": 1743,
        "total_roof_area_sq": 17.43,
        "measurements": {"eave": 175.42, "valley": 20.58, "ridge": 16.42, "rake": 6.25},
    }
    gt = ca._build_ground_truth(
        measurements=real_measurements,
        config={"line_items": [], "property": {"state": "TX"}},
        carrier_name="State Farm",
        carrier_rcv=10053.27,
        carrier_items=[],
    )
    assert gt["total_roof_area_sf"] == 1743, gt
    assert gt["total_roof_area_sq"] == 17.43, gt   # would be 0.0 under the old bug
    assert gt["eave_lf"] == 175.42, gt              # would be 0 under the old bug
    assert gt["valley_lf"] == 20.58, gt


def test_ground_truth_handles_reconstruction_fallback_schema():
    # _reconstruct_measurements_from_carrier writes total_area_sf (processor.py:5186)
    gt = ca._build_ground_truth(
        measurements={"total_area_sf": 2000},
        config={"line_items": [], "property": {"state": "OH"}},
        carrier_name="Allstate", carrier_rcv=5000, carrier_items=[],
    )
    assert gt["total_roof_area_sf"] == 2000
    assert gt["total_roof_area_sq"] == 20.0


def test_ground_truth_derives_sf_from_sq_only():
    gt = ca._build_ground_truth(
        measurements={"total_roof_area_sq": 25.0},  # only SQ present
        config={"line_items": [], "property": {}}, carrier_name="X",
        carrier_rcv=0, carrier_items=[],
    )
    assert gt["total_roof_area_sf"] == 2500.0
    assert gt["total_roof_area_sq"] == 25.0


def test_ground_truth_reads_structures_when_no_top_level_total():
    # Carrier-reconstruction fallback (processor.py:4993): area lives ONLY in
    # structures[0].roof_area_sf, with NO top-level total_* key. This is the
    # path that runs precisely when a carrier scope is being analyzed.
    gt = ca._build_ground_truth(
        measurements={"structures": [{"roof_area_sf": 1500, "roof_area_sq": 15.0}], "measurements": {}},
        config={"line_items": [], "property": {"state": "TX"}},
        carrier_name="State Farm", carrier_rcv=9000, carrier_items=[],
    )
    assert gt["total_roof_area_sf"] == 1500, gt   # would be 0 without the structures fallback
    assert gt["total_roof_area_sq"] == 15.0, gt


def test_ground_truth_sums_multi_structure_area():
    gt = ca._build_ground_truth(
        measurements={"structures": [{"roof_area_sf": 1000}, {"roof_area_sf": 800}]},
        config={"line_items": [], "property": {}}, carrier_name="X",
        carrier_rcv=0, carrier_items=[],
    )
    assert gt["total_roof_area_sf"] == 1800
    assert gt["total_roof_area_sq"] == 18.0


# ---- 2. the prompt teaches the model not to sum same-surface items ----
def test_prompt_forbids_summing_same_surface_items():
    prompt = ca._build_analysis_prompt({"total_roof_area_sq": 17.43, "total_roof_area_sf": 1743})
    assert "17.43 squares" in prompt
    assert "NOT additive" in prompt
    assert "NEVER sum" in prompt


# ---- 3. the guard FLAGS the exact Claim B phantom (43.24 SQ vs a 17.43 roof) ----
def test_guard_flags_phantom_additive_area_sq():
    gt = {"total_roof_area_sq": 17.43, "total_roof_area_sf": 1743}
    parsed = {"tactics_found": [{
        "tactic": "Severe roof-area underscope", "severity": "high",
        "detail": "Our measurements total 43.24 SQ; carrier paid only 17.3 SQ.",
        "counter_argument": "Demand the missing area.", "dollar_impact_estimate": 5800,
    }]}
    ca._apply_area_sanity_guard(parsed, gt)
    assert "_sanity_warnings" in parsed, parsed
    assert "43.24 SQ" in parsed["tactics_found"][0]["_area_sanity_flag"]


# ---- 3b. Defect-3: an SF-unit phantom is also caught ----
def test_guard_flags_phantom_in_square_feet():
    gt = {"total_roof_area_sq": 17.43, "total_roof_area_sf": 1743}
    parsed = {"tactics_found": [{
        "tactic": "area", "detail": "Our scope is 4,324 SF vs carrier 1,730 SF.",
        "counter_argument": "",
    }]}
    ca._apply_area_sanity_guard(parsed, gt)
    assert "_sanity_warnings" in parsed, "SF-unit phantom (4324 SF > 1743) must flag"


# ---- 3c. Defect-2: a phantom parked in the summary fields is caught ----
def test_guard_scans_overall_assessment_and_supplement_priority():
    gt = {"total_roof_area_sq": 17.43, "total_roof_area_sf": 1743}
    parsed = {
        "tactics_found": [],
        "overall_assessment": "Carrier underscoped the roof by ~26 SQ (43.24 SQ required).",
        "supplement_priority": ["Recover the missing 43.24 SQ of roofing"],
    }
    ca._apply_area_sanity_guard(parsed, gt)
    assert "_sanity_warnings" in parsed, "phantom in summary fields must flag"


# ---- 4. a LEGIT area finding within the roof is NOT flagged ----
def test_guard_leaves_legitimate_area_finding_alone():
    gt = {"total_roof_area_sq": 17.43, "total_roof_area_sf": 1743}
    parsed = {"tactics_found": [{
        "tactic": "Spot repair instead of full replacement",
        "detail": "Carrier scoped 8 SQ partial vs the full 17.43 SQ roof.",
        "counter_argument": "Full replacement warranted.",
    }]}
    ca._apply_area_sanity_guard(parsed, gt)
    assert "_sanity_warnings" not in parsed, parsed


# ---- 4b. Defect-4: a per-square DOLLAR figure is not mistaken for an area ----
def test_guard_ignores_dollar_prefixed_figures():
    gt = {"total_roof_area_sq": 17.43, "total_roof_area_sf": 1743}
    parsed = {"tactics_found": [{
        "tactic": "Underpriced shingles",
        "detail": "Carrier used $43 SQ pricing instead of Xactimate $306/SQ.",
        "counter_argument": "",
    }]}
    ca._apply_area_sanity_guard(parsed, gt)
    assert "_sanity_warnings" not in parsed, "$-prefixed unit price must NOT trip the area guard"


# ---- 5. guard is a no-op when roof area is unknown (no false flags) ----
def test_guard_noop_without_roof_area():
    parsed = {"tactics_found": [{"tactic": "x", "detail": "99 SQ", "counter_argument": ""}]}
    ca._apply_area_sanity_guard(parsed, {"total_roof_area_sq": 0, "total_roof_area_sf": 0})
    assert "_sanity_warnings" not in parsed


# ---- 6. guard tolerates a normal waste-inflated shingle qty (19.52 on a 17.43 roof) ----
def test_guard_tolerates_waste_factor():
    gt = {"total_roof_area_sq": 17.43, "total_roof_area_sf": 1743}  # max = 22.66 SQ
    parsed = {"tactics_found": [{"tactic": "y", "detail": "shingles 19.52 SQ with waste", "counter_argument": ""}]}
    ca._apply_area_sanity_guard(parsed, gt)
    assert "_sanity_warnings" not in parsed, "19.52 SQ (waste) must NOT trip the guard"


# ---- 7. guard is crash-safe on malformed tactics ----
def test_guard_survives_malformed_tactics():
    gt = {"total_roof_area_sq": 17.43, "total_roof_area_sf": 1743}
    parsed = {"tactics_found": [None, "a string", 42, {"detail": None, "counter_argument": None}]}
    ca._apply_area_sanity_guard(parsed, gt)  # must not raise
    assert "_sanity_warnings" not in parsed


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"  PASS {name}")
    print("All E273 guard tests passed.")
