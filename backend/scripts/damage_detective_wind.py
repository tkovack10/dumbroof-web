#!/usr/bin/env python3
"""Focused Damage Detective: Wind Damage Detection Improvement.

Queries annotation_feedback for wind-related corrections, analyzes patterns
where the AI misidentifies or misses wind damage, and proposes prompt patches
to backend/processor.py:analyze_photos().

Usage:
    python3 backend/scripts/damage_detective_wind.py [--execute]

Without --execute: prints the analysis report.
With --execute: also writes proposed changes to references/wind-damage-patterns.md
and outputs a unified diff for processor.py.

Plan: ~/.claude/plans/proud-wiggling-hearth.md — Wind Damage Detection Focus
"""

import json
import os
import sys
import argparse

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from supabase import create_client


def get_sb():
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        # Try loading from .env.local
        env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env.local")
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    if "=" in line and not line.startswith("#"):
                        k, v = line.strip().split("=", 1)
                        v = v.strip("'\"").rstrip("\\n")
                        if k == "NEXT_PUBLIC_SUPABASE_URL":
                            url = v
                        elif k == "SUPABASE_SERVICE_KEY":
                            v = v.rstrip("\\n")
                            key = v
    return create_client(url, key)


def query_wind_corrections(sb) -> list:
    """Query annotation_feedback for wind-related corrections."""
    result = sb.table("annotation_feedback") \
        .select("id, photo_id, claim_id, status, original_annotation, corrected_annotation, original_tags, corrected_tags, created_at") \
        .eq("status", "corrected") \
        .order("created_at", desc=True) \
        .execute()

    rows = result.data or []

    # Filter for wind-related corrections
    wind_keywords = ["wind", "creas", "lift", "miss", "blown", "torn", "peel", "curl", "tab"]
    wind_rows = []
    for r in rows:
        combined = " ".join([
            str(r.get("original_annotation") or ""),
            str(r.get("corrected_annotation") or ""),
            json.dumps(r.get("original_tags") or {}),
            json.dumps(r.get("corrected_tags") or {}),
        ]).lower()
        if any(kw in combined for kw in wind_keywords):
            wind_rows.append(r)

    return wind_rows


def analyze_patterns(rows: list) -> dict:
    """Categorize wind-related corrections by error type."""
    categories = {
        "wind_called_hail": [],
        "hail_called_wind": [],
        "thermal_called_wind": [],
        "wind_called_thermal": [],
        "aging_called_wind": [],
        "wind_missed": [],
        "severity_wrong": [],
        "other_wind": [],
    }

    for r in rows:
        orig = (r.get("original_annotation") or "").lower()
        corr = (r.get("corrected_annotation") or "").lower()
        orig_tags = r.get("original_tags") or {}
        corr_tags = r.get("corrected_tags") or {}

        orig_type = str(orig_tags.get("damage_type", "")).lower()
        corr_type = str(corr_tags.get("damage_type", "")).lower()

        entry = {
            "id": r["id"],
            "photo_id": r.get("photo_id"),
            "claim_id": r.get("claim_id"),
            "original": orig[:200],
            "corrected": corr[:200],
            "orig_type": orig_type,
            "corr_type": corr_type,
        }

        if "hail" in orig_type and "wind" in corr_type:
            categories["hail_called_wind"].append(entry)
        elif "wind" in orig_type and "hail" in corr_type:
            categories["wind_called_hail"].append(entry)
        elif ("thermal" in orig or "crack" in orig) and "wind" in corr:
            categories["thermal_called_wind"].append(entry)
        elif "wind" in orig and ("thermal" in corr or "crack" in corr or "age" in corr):
            categories["wind_called_thermal"].append(entry)
        elif ("age" in orig or "wear" in orig) and "wind" in corr:
            categories["aging_called_wind"].append(entry)
        elif "wind" in corr and not any(kw in orig for kw in ["wind", "lift", "creas", "miss"]):
            categories["wind_missed"].append(entry)
        elif "wind" in orig and "wind" in corr:
            categories["severity_wrong"].append(entry)
        else:
            categories["other_wind"].append(entry)

    return categories


def print_report(categories: dict, total: int):
    """Print formatted analysis report."""
    print(f"\n{'='*70}")
    print(f"WIND DAMAGE DETECTION — FOCUSED ANALYSIS")
    print(f"{'='*70}")
    print(f"Total wind-related corrections: {total}")
    print()

    for cat_name, entries in categories.items():
        if not entries:
            continue
        print(f"\n--- {cat_name.upper()} ({len(entries)} corrections) ---")
        for e in entries[:5]:
            print(f"  [{e['id']}] claim={str(e['claim_id'])[:8]}...")
            print(f"    AI said:  {e['original'][:120]}")
            print(f"    Should be: {e['corrected'][:120]}")
            if e['orig_type'] != e['corr_type']:
                print(f"    Type: {e['orig_type']} → {e['corr_type']}")
            print()

    # Summary
    print(f"\n{'='*70}")
    print("PATTERN SUMMARY:")
    for cat_name, entries in sorted(categories.items(), key=lambda x: -len(x[1])):
        if entries:
            print(f"  {cat_name}: {len(entries)} corrections")
    print()

    # Recommendations
    print("RECOMMENDATIONS:")
    top = sorted(categories.items(), key=lambda x: -len(x[1]))
    for cat_name, entries in top[:3]:
        if not entries:
            continue
        print(f"\n  {cat_name} ({len(entries)}×):")
        if cat_name == "wind_missed":
            print("    → Add wind damage indicators to the prompt: creased tabs, lifted edges,")
            print("      linear missing patterns, debris impacts on soft metals")
        elif cat_name == "wind_called_hail":
            print("    → Add disambiguation: wind damage is linear/directional, hail is random circular.")
            print("      Creased tabs = wind. Circular dents = hail.")
        elif cat_name == "thermal_called_wind":
            print("    → Add negative example: straight-line cracks along tab edges = thermal expansion,")
            print("      NOT wind. Wind creases follow the lifting direction, not the tab seam.")
        elif cat_name == "aging_called_wind":
            print("    → Add: curled/cupped edges on old shingles = age. Wind lifts create a single crease")
            print("      across the tab, not gradual curling from all edges.")


def write_reference_doc(categories: dict, output_path: str):
    """Write the wind damage patterns reference document."""
    lines = [
        "# Wind Damage Detection Patterns",
        "",
        "> Auto-generated by damage_detective_wind.py from annotation_feedback corrections.",
        "> Used by processor.py:analyze_photos() and Richard (Claim Brain) for wind damage identification.",
        "",
        "## Disambiguation Rules",
        "",
        "### Wind vs Hail",
        "- **Wind:** Linear/directional damage — creased tabs along the lifting direction, lifted edges, missing shingles in linear patterns following wind direction, debris impact marks",
        "- **Hail:** Random circular pattern — round dents on soft metals, circular granule displacement, random hit distribution (not in lines)",
        "- **Key test:** Are the impacts in a consistent direction (wind) or randomly distributed (hail)?",
        "",
        "### Wind vs Thermal Cracking",
        "- **Wind:** Single crease across the tab body, perpendicular to the lifting direction. Tab may be partially lifted with exposed nail heads underneath",
        "- **Thermal:** Straight-line cracks along tab edges or seams. Follows the tab geometry, not the wind direction. No lifting — the tab lies flat with a crack through it",
        "- **Key test:** Is the crack at the tab seam (thermal) or across the tab body (wind)?",
        "",
        "### Wind vs Normal Aging",
        "- **Wind:** Discrete event damage — specific creases, lifts, or missing sections. Adjacent shingles may be undamaged",
        "- **Aging:** Gradual, uniform degradation — curling from all edges, cupping, granule loss everywhere, brittleness. Affects all shingles equally on the same slope",
        "- **Key test:** Is the damage selective/random (wind event) or uniform across the slope (aging)?",
        "",
        "## Common Wind Damage Signatures",
        "",
        "1. **Creased shingle tabs** — single fold/crease across the body of the tab. The tab may still be seated but has a visible bend line. NOT to be confused with thermal cracking (straight line at tab edge/seam)",
        "2. **Lifted/peeled tabs** — tab is partially or fully separated from the course below. May expose nail heads or the underlying course. Wind direction can be inferred from the lift direction",
        "3. **Missing shingles/tabs** — absent tab or full shingle. Pattern follows wind direction (e.g., all missing from the same side of the ridge). Exposed nail heads and underlayment visible",
        "4. **Debris impact marks** — irregular marks from wind-driven debris (branches, gravel). NOT circular (that's hail). May show directional scoring",
        "5. **Siding: blown-off sections** — vinyl or aluminum panels detached from the structure. J-channel and starter strip may be bent/damaged in the wind direction",
        "6. **Gutter: bent/displaced** — sections pushed out of alignment by wind, not by hail dents. Check if the deformation is directional (wind) vs random (hail)",
        "",
        "## Annotation Guidelines for Wind Damage",
        "",
        "Format: \"[Material]: [Wind damage type]. [Severity indicator].\"",
        "",
        "Examples:",
        "- \"Laminate shingle: Wind-creased tab with partial lift exposing nail head. Single event damage confirms storm origin.\"",
        "- \"3-tab shingle: 3 missing tabs in linear pattern along south-facing slope. Directional loss consistent with wind event.\"",
        "- \"Vinyl siding: Blown panel on west elevation with bent J-channel. Impact consistent with reported wind direction.\"",
        "",
    ]

    # Add correction examples from actual data
    for cat_name, entries in categories.items():
        if len(entries) >= 2:
            lines.append(f"## Correction Examples: {cat_name.replace('_', ' ').title()}")
            lines.append("")
            for e in entries[:3]:
                lines.append(f"- **AI said:** {e['original'][:150]}")
                lines.append(f"  **Should be:** {e['corrected'][:150]}")
                lines.append("")

    with open(output_path, "w") as f:
        f.write("\n".join(lines))
    print(f"\nWrote reference doc to {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Wind Damage Detection Analysis")
    parser.add_argument("--execute", action="store_true", help="Write reference doc + output diff")
    args = parser.parse_args()

    sb = get_sb()
    print("Querying annotation_feedback for wind-related corrections...")
    wind_rows = query_wind_corrections(sb)
    print(f"Found {len(wind_rows)} wind-related corrections")

    if not wind_rows:
        print("No wind corrections found. Run some claims with wind damage photos, then have users review annotations.")
        return

    categories = analyze_patterns(wind_rows)
    print_report(categories, len(wind_rows))

    if args.execute:
        ref_path = os.path.join(os.path.dirname(__file__), "..", "references", "wind-damage-patterns.md")
        os.makedirs(os.path.dirname(ref_path), exist_ok=True)
        write_reference_doc(categories, ref_path)
        print("\nNext steps:")
        print("1. Review references/wind-damage-patterns.md")
        print("2. Add disambiguation rules to analyze_photos() prompt in processor.py")
        print("3. Reprocess 5-10 wind-damage claims to measure before/after accuracy")
        print("4. Merge via PR when accuracy improves")


if __name__ == "__main__":
    main()
