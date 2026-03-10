#!/usr/bin/env python3
"""
Reprocess test for 13 Chrisfield Ave — multi-structure + multi-EagleView.

Tests all 4 layers:
  1. Multi-EagleView extraction (3 files → merged structures)
  2. Per-structure measurements prompt
  3. Per-structure line items via build_multi_structure_line_items()
  4. Flat roof material detection

Usage:
  python3 test_multi_structure.py              # Full test (calls Claude API)
  python3 test_multi_structure.py --skip-api   # Skip extraction, test line items only with mock data
"""

import os
import sys
import json
import asyncio

# Load env from .env if present
env_path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
if os.path.exists(env_path):
    for line in open(env_path):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

from processor import (
    extract_measurements,
    build_multi_structure_line_items,
    build_line_items,
    _classify_from_text,
    _detect_roof_material,
    compute_financials,
    get_anthropic_client,
)

CLAIM_DIR = os.path.expanduser("~/USARM-Claims-Platform/claims/13-chrisfield-ave")
SOURCE_DIR = os.path.join(CLAIM_DIR, "source_docs")

EV_FILES = [
    os.path.join(SOURCE_DIR, "13 chrisfield church building 1 Eagleview.pdf"),
    os.path.join(SOURCE_DIR, "13 chrisfield church building 2 medium Eagleview .pdf"),
    os.path.join(SOURCE_DIR, "13 chrisfield CHURCH building 3 Easgleview.pdf"),
]


def test_classify_flat():
    """Test Layer 4: flat material detection."""
    print("\n=== TEST: _classify_from_text — flat material ===")
    cases = [
        ("modified bitumen roof", "flat"),
        ("mod bit roofing", "flat"),
        ("flat roof section", "flat"),
        ("TPO membrane", "flat"),
        ("EPDM rubber roof", "flat"),
        ("built-up roofing", "flat"),
        ("torch down roofing", "flat"),
        ("laminated comp shingle", "laminated"),
        ("standing seam metal", "metal_standing_seam"),
        ("copper roof panels", "copper"),
    ]
    passed = 0
    for text, expected in cases:
        result = _classify_from_text(text)
        status = "PASS" if result == expected else "FAIL"
        if status == "FAIL":
            print(f"  {status}: '{text}' → {result} (expected {expected})")
        else:
            passed += 1
    print(f"  {passed}/{len(cases)} passed")
    return passed == len(cases)


def test_multi_structure_line_items_mock():
    """Test Layer 3: per-structure line items with mock measurements."""
    print("\n=== TEST: build_multi_structure_line_items — mock data ===")

    # Simulate 3 structures from merged EagleView extraction
    mock_measurements = {
        "structures": [
            {
                "name": "Sanctuary — Shingle Section",
                "roof_area_sf": 15000,
                "roof_area_sq": 150.0,
                "predominant_pitch": "6/12",
                "facets": 12,
                "style": "combination",
                "shingle_type": "laminated comp shingle",
                "measurements": {"ridge": 80, "hip": 40, "valley": 60, "rake": 120, "eave": 180},
                "penetrations": {"pipes": 2, "vents": 4, "skylights": 0, "chimneys": 1},
            },
            {
                "name": "Sanctuary — Flat Roof",
                "roof_area_sf": 5000,
                "roof_area_sq": 50.0,
                "predominant_pitch": "0/12",
                "facets": 1,
                "style": "flat",
                "shingle_type": "flat roof modified bitumen",
                "measurements": {"ridge": 0, "hip": 0, "valley": 0, "rake": 0, "eave": 0},
                "penetrations": {"pipes": 1, "vents": 0, "skylights": 0, "chimneys": 0},
            },
            {
                "name": "Education Building",
                "roof_area_sf": 4752,
                "roof_area_sq": 47.52,
                "predominant_pitch": "5/12",
                "facets": 6,
                "style": "hip",
                "shingle_type": "laminated architectural shingle",
                "measurements": {"ridge": 40, "hip": 30, "valley": 20, "rake": 60, "eave": 100},
                "penetrations": {"pipes": 3, "vents": 2, "skylights": 0, "chimneys": 0},
            },
        ],
        "measurements": {},
        "penetrations": {},
        "total_roof_area_sf": 24752,
        "total_roof_area_sq": 247.52,
    }

    mock_photo = {"trades_identified": ["roofing"], "photo_annotations": {}, "photo_count": 0}

    items = build_multi_structure_line_items(mock_measurements, mock_photo, "NY", user_notes="church complex")

    # Verify structure labels
    sanctuary_shingle = [i for i in items if "[Sanctuary — Shingle Section]" in i["description"]]
    sanctuary_flat = [i for i in items if "[Sanctuary — Flat Roof]" in i["description"]]
    education = [i for i in items if "[Education Building]" in i["description"]]

    print(f"  Total items: {len(items)}")
    print(f"  Sanctuary Shingle: {len(sanctuary_shingle)} items")
    print(f"  Sanctuary Flat: {len(sanctuary_flat)} items")
    print(f"  Education: {len(education)} items")

    # Check flat roof got mod bit line items
    flat_descriptions = [i["description"] for i in sanctuary_flat]
    has_mod_bit = any("modified bitumen" in d.lower() for d in flat_descriptions)
    has_base_sheet = any("base sheet" in d.lower() for d in flat_descriptions)
    print(f"  Flat section has mod bit: {has_mod_bit}")
    print(f"  Flat section has base sheet: {has_base_sheet}")

    # Check shingle section got laminated line items
    shingle_descriptions = [i["description"] for i in sanctuary_shingle]
    has_laminated = any("laminated" in d.lower() for d in shingle_descriptions)
    print(f"  Shingle section has laminated: {has_laminated}")

    # Flat roof should NOT have starter strip or ridge cap (eave/ridge = 0)
    flat_has_starter = any("starter" in d.lower() for d in flat_descriptions)
    flat_has_ridge_cap = any("ridge cap" in d.lower() for d in flat_descriptions)
    print(f"  Flat section has starter strip (should be NO): {flat_has_starter}")
    print(f"  Flat section has ridge cap (should be NO): {flat_has_ridge_cap}")

    # Compute financials
    total = sum(i["qty"] * i["unit_price"] for i in items)
    print(f"  Line item total: ${total:,.2f}")

    ok = (len(sanctuary_shingle) > 0 and len(sanctuary_flat) > 0 and len(education) > 0
          and has_mod_bit and has_laminated and not flat_has_starter)
    print(f"  Result: {'PASS' if ok else 'FAIL'}")
    return ok


def test_single_structure_passthrough():
    """Test that single-structure claims pass through unchanged."""
    print("\n=== TEST: Single-structure passthrough ===")

    single = {
        "structures": [{"name": "Main Roof", "roof_area_sf": 2000, "roof_area_sq": 20,
                         "predominant_pitch": "6/12", "facets": 4, "style": "hip"}],
        "measurements": {"ridge": 30, "hip": 20, "valley": 10, "rake": 50, "eave": 80},
        "penetrations": {"pipes": 2, "vents": 1, "skylights": 0, "chimneys": 0},
        "total_roof_area_sf": 2000,
        "total_roof_area_sq": 20,
    }
    mock_photo = {"trades_identified": ["roofing"], "photo_annotations": {}, "photo_count": 0}

    multi_items = build_multi_structure_line_items(single, mock_photo, "NY")
    direct_items = build_line_items(single, mock_photo, "NY")

    # Should be identical — no structure prefix added
    has_bracket = any("[" in i["description"] for i in multi_items)
    same_count = len(multi_items) == len(direct_items)

    print(f"  Multi wrapper items: {len(multi_items)}, Direct items: {len(direct_items)}")
    print(f"  Same count: {same_count}")
    print(f"  No bracket prefix (should be True): {not has_bracket}")

    ok = same_count and not has_bracket
    print(f"  Result: {'PASS' if ok else 'FAIL'}")
    return ok


async def test_eagleview_extraction():
    """Test Layer 1: extract all 3 EagleViews and merge."""
    print("\n=== TEST: Multi-EagleView extraction (API calls) ===")

    for f in EV_FILES:
        if not os.path.exists(f):
            print(f"  SKIP: File not found: {f}")
            return None

    claude = get_anthropic_client()
    all_structures = []
    merged = {}

    for i, path in enumerate(EV_FILES):
        print(f"  Extracting {i+1}/3: {os.path.basename(path)}...")
        result = await asyncio.to_thread(extract_measurements, claude, path)

        if not merged:
            merged = dict(result)

        file_structs = result.get("structures", [])
        for s in file_structs:
            if not s.get("name") or s["name"] == "Main Roof":
                s["name"] = f"Structure {len(all_structures) + 1}"
            if not s.get("measurements") and result.get("measurements"):
                s["measurements"] = result["measurements"]
            if not s.get("penetrations") and result.get("penetrations"):
                s["penetrations"] = result["penetrations"]
            all_structures.append(s)

        area = file_structs[0].get("roof_area_sf", 0) if file_structs else 0
        print(f"    → {file_structs[0].get('name', '?') if file_structs else '?'}: {area} SF")

    merged["structures"] = all_structures
    merged["total_roof_area_sf"] = sum(s.get("roof_area_sf", 0) for s in all_structures)
    merged["total_roof_area_sq"] = sum(s.get("roof_area_sq", 0) for s in all_structures)

    print(f"\n  Merged: {len(all_structures)} structures, {merged['total_roof_area_sf']} SF total")
    for s in all_structures:
        pitch = s.get("predominant_pitch", "?")
        meas = s.get("measurements", {})
        print(f"    {s['name']}: {s.get('roof_area_sf', 0)} SF, pitch={pitch}, "
              f"eave={meas.get('eave', 0)}, ridge={meas.get('ridge', 0)}")

    # Now run multi-structure line items on real extracted data
    print(f"\n  Building per-structure line items...")
    mock_photo = {"trades_identified": ["roofing"], "photo_annotations": {}, "photo_count": 0}
    user_notes = "3-building church. Building 1 has shingle, flat roof, and copper standing seam sections."

    items = build_multi_structure_line_items(merged, mock_photo, "NY", user_notes=user_notes)
    total = sum(i["qty"] * i["unit_price"] for i in items)

    # Group by structure
    struct_counts = {}
    for item in items:
        desc = item["description"]
        bracket = desc.split("]")[0] + "]" if "]" in desc else "Unknown"
        struct_counts[bracket] = struct_counts.get(bracket, 0) + 1

    print(f"\n  Total: {len(items)} line items, ${total:,.2f}")
    for name, count in struct_counts.items():
        print(f"    {name}: {count} items")

    # Save results for inspection
    output = {
        "merged_measurements": merged,
        "line_items": items,
        "line_item_total": round(total, 2),
        "structure_counts": struct_counts,
    }
    out_path = os.path.join(os.path.dirname(__file__), "test_multi_structure_output.json")
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\n  Full output saved to: {out_path}")

    return len(all_structures) >= 3


def test_override_conflict():
    """Test that per-structure shingle_type wins over claim-wide estimate_request.roof_material."""
    print("\n=== TEST: Override conflict — struct shingle_type vs claim-wide estimate_request ===")

    mock_measurements = {
        "structures": [
            {
                "name": "Main Roof",
                "roof_area_sf": 2000, "roof_area_sq": 20.0,
                "predominant_pitch": "6/12", "facets": 4, "style": "hip",
                "shingle_type": "laminated comp shingle",
                "measurements": {"ridge": 30, "hip": 20, "valley": 10, "rake": 50, "eave": 80},
                "penetrations": {"pipes": 2, "vents": 1, "skylights": 0, "chimneys": 0},
            },
            {
                "name": "Flat Section",
                "roof_area_sf": 3000, "roof_area_sq": 30.0,
                "predominant_pitch": "0/12", "facets": 1, "style": "flat",
                "shingle_type": "flat roof modified bitumen",
                "measurements": {"ridge": 0, "hip": 0, "valley": 0, "rake": 0, "eave": 0},
                "penetrations": {"pipes": 1, "vents": 0, "skylights": 0, "chimneys": 0},
            },
        ],
        "measurements": {},
        "penetrations": {},
        "total_roof_area_sf": 5000,
        "total_roof_area_sq": 50.0,
    }
    mock_photo = {"trades_identified": ["roofing"], "photo_annotations": {}, "photo_count": 0}

    # Claim-wide override says "Laminate Comp Shingle" — should NOT force flat section to laminated
    estimate_request = {"roof_material": "Laminate Comp Shingle"}

    items = build_multi_structure_line_items(mock_measurements, mock_photo, "NY",
                                             user_notes="", estimate_request=estimate_request)

    flat_items = [i for i in items if "[Flat Section]" in i["description"]]
    main_items = [i for i in items if "[Main Roof]" in i["description"]]

    flat_descs = [i["description"].lower() for i in flat_items]
    main_descs = [i["description"].lower() for i in main_items]

    flat_has_mod_bit = any("modified bitumen" in d for d in flat_descs)
    flat_has_laminated = any("laminated" in d for d in flat_descs)
    main_has_laminated = any("laminated" in d for d in main_descs)

    print(f"  Main Roof items: {len(main_items)}, Flat Section items: {len(flat_items)}")
    print(f"  Main has laminated: {main_has_laminated}")
    print(f"  Flat has mod bit: {flat_has_mod_bit}")
    print(f"  Flat has laminated (should be NO): {flat_has_laminated}")

    ok = main_has_laminated and flat_has_mod_bit and not flat_has_laminated
    print(f"  Result: {'PASS' if ok else 'FAIL'}")
    return ok


def test_per_structure_override():
    """Test per-structure estimate_request.structures[i].roof_material override."""
    print("\n=== TEST: Per-structure estimate_request override ===")

    mock_measurements = {
        "structures": [
            {
                "name": "Building A",
                "roof_area_sf": 2000, "roof_area_sq": 20.0,
                "predominant_pitch": "6/12", "facets": 4, "style": "hip",
                "shingle_type": "laminated comp shingle",
                "measurements": {"ridge": 30, "hip": 20, "valley": 10, "rake": 50, "eave": 80},
                "penetrations": {"pipes": 2, "vents": 1, "skylights": 0, "chimneys": 0},
            },
            {
                "name": "Building B",
                "roof_area_sf": 1500, "roof_area_sq": 15.0,
                "predominant_pitch": "5/12", "facets": 4, "style": "gable",
                "shingle_type": "",
                "measurements": {"ridge": 25, "hip": 0, "valley": 5, "rake": 40, "eave": 60},
                "penetrations": {"pipes": 1, "vents": 1, "skylights": 0, "chimneys": 0},
            },
        ],
        "measurements": {},
        "penetrations": {},
        "total_roof_area_sf": 3500,
        "total_roof_area_sq": 35.0,
    }
    mock_photo = {"trades_identified": ["roofing"], "photo_annotations": {}, "photo_count": 0}

    # Per-structure override: Building B gets Slate via structures[1]
    estimate_request = {
        "roof_material": "Laminate Comp Shingle",
        "structures": [
            None,  # Building A: no per-struct override, uses shingle_type
            {"roof_material": "Slate"},  # Building B: explicit slate override
        ]
    }

    items = build_multi_structure_line_items(mock_measurements, mock_photo, "NY",
                                             user_notes="", estimate_request=estimate_request)

    bldg_a = [i for i in items if "[Building A]" in i["description"]]
    bldg_b = [i for i in items if "[Building B]" in i["description"]]

    a_descs = [i["description"].lower() for i in bldg_a]
    b_descs = [i["description"].lower() for i in bldg_b]

    a_has_laminated = any("laminated" in d for d in a_descs)
    b_has_slate = any("slate" in d for d in b_descs)
    b_has_laminated = any("laminated" in d for d in b_descs)

    print(f"  Building A items: {len(bldg_a)}, Building B items: {len(bldg_b)}")
    print(f"  A has laminated: {a_has_laminated}")
    print(f"  B has slate: {b_has_slate}")
    print(f"  B has laminated (should be NO): {b_has_laminated}")

    ok = a_has_laminated and b_has_slate and not b_has_laminated
    print(f"  Result: {'PASS' if ok else 'FAIL'}")
    return ok


def test_no_shingle_type_fallback():
    """Test that empty shingle_type on all structures falls back to claim-wide estimate_request."""
    print("\n=== TEST: No shingle_type fallback to claim-wide override ===")

    mock_measurements = {
        "structures": [
            {
                "name": "Building 1",
                "roof_area_sf": 2000, "roof_area_sq": 20.0,
                "predominant_pitch": "6/12", "facets": 4, "style": "hip",
                "shingle_type": "",
                "measurements": {"ridge": 30, "hip": 20, "valley": 10, "rake": 50, "eave": 80},
                "penetrations": {"pipes": 2, "vents": 1, "skylights": 0, "chimneys": 0},
            },
            {
                "name": "Building 2",
                "roof_area_sf": 1500, "roof_area_sq": 15.0,
                "predominant_pitch": "5/12", "facets": 4, "style": "gable",
                "shingle_type": "",
                "measurements": {"ridge": 25, "hip": 0, "valley": 5, "rake": 40, "eave": 60},
                "penetrations": {"pipes": 1, "vents": 1, "skylights": 0, "chimneys": 0},
            },
        ],
        "measurements": {},
        "penetrations": {},
        "total_roof_area_sf": 3500,
        "total_roof_area_sq": 35.0,
    }
    mock_photo = {"trades_identified": ["roofing"], "photo_annotations": {}, "photo_count": 0}

    # Claim-wide override should apply to both structures since neither has shingle_type
    estimate_request = {"roof_material": "3-Tab"}

    items = build_multi_structure_line_items(mock_measurements, mock_photo, "NY",
                                             user_notes="", estimate_request=estimate_request)

    bldg_1 = [i for i in items if "[Building 1]" in i["description"]]
    bldg_2 = [i for i in items if "[Building 2]" in i["description"]]

    all_descs = [i["description"].lower() for i in items]
    has_3tab = any("3-tab" in d or "3 tab" in d for d in all_descs)
    has_laminated = any("laminated" in d for d in all_descs)

    print(f"  Building 1 items: {len(bldg_1)}, Building 2 items: {len(bldg_2)}")
    print(f"  Has 3-tab items: {has_3tab}")
    print(f"  Has laminated (should be NO): {has_laminated}")

    ok = len(bldg_1) > 0 and len(bldg_2) > 0 and has_3tab and not has_laminated
    print(f"  Result: {'PASS' if ok else 'FAIL'}")
    return ok


def main():
    skip_api = "--skip-api" in sys.argv

    results = {}

    # Offline tests (no API calls)
    results["classify_flat"] = test_classify_flat()
    results["multi_structure_mock"] = test_multi_structure_line_items_mock()
    results["single_passthrough"] = test_single_structure_passthrough()
    results["override_conflict"] = test_override_conflict()
    results["per_structure_override"] = test_per_structure_override()
    results["no_shingle_type_fallback"] = test_no_shingle_type_fallback()

    # API tests (requires ANTHROPIC_API_KEY)
    if not skip_api:
        results["eagleview_extraction"] = asyncio.run(test_eagleview_extraction())
    else:
        print("\n=== SKIPPED: EagleView extraction (--skip-api) ===")

    # Summary
    print("\n" + "=" * 50)
    print("SUMMARY")
    print("=" * 50)
    for name, ok in results.items():
        status = "PASS" if ok else ("SKIP" if ok is None else "FAIL")
        print(f"  {name}: {status}")

    all_ok = all(v is not False for v in results.values())
    print(f"\nOverall: {'ALL PASSED' if all_ok else 'SOME FAILED'}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
