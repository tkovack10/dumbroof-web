#!/usr/bin/env python3
"""
Full reprocess of 13 Chrisfield Ave — local claim, no Supabase.

Exercises:
  - Layer 1: Multi-EagleView extraction (3 files)
  - Layer 2: Per-structure measurements
  - Layer 3: Multi-structure line items with per-material detection
  - Layer 4: Flat roof material type
  - Fixed chalk test photo analysis prompt (skylights, downspouts)
"""

import os
import sys
import json
import asyncio
from datetime import datetime

# Load env — check backend/.env first, then ../.env.local
for env_path in [
    os.path.join(os.path.dirname(__file__), ".env"),
    os.path.join(os.path.dirname(__file__), "..", ".env.local"),
]:
    if os.path.exists(env_path):
        for line in open(env_path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

from processor import (
    extract_measurements,
    extract_weather_data,
    analyze_photos,
    analyze_photo_integrity,
    build_claim_config,
    build_multi_structure_line_items,
    compute_financials,
    generate_pdfs,
    get_anthropic_client,
    resize_photo,
    get_media_type,
)
from photo_utils import ingest_photos

CLAIM_DIR = os.path.expanduser("~/USARM-Claims-Platform/claims/13-chrisfield-ave")
SOURCE_DIR = os.path.join(CLAIM_DIR, "source_docs")
PHOTOS_DIR = os.path.join(CLAIM_DIR, "photos")
OUTPUT_DIR = os.path.join(CLAIM_DIR, "pdf_output")

EV_FILES = [
    os.path.join(SOURCE_DIR, "13 chrisfield church building 1 Eagleview.pdf"),
    os.path.join(SOURCE_DIR, "13 chrisfield church building 2 medium Eagleview .pdf"),
    os.path.join(SOURCE_DIR, "13 chrisfield CHURCH building 3 Easgleview.pdf"),
]

WEATHER_FILE = os.path.join(SOURCE_DIR, "HailTrace_WeatherHistory_RXbB7d8E_13_Chrisfield_Ave.pdf")

USER_NOTES = (
    "3-building church complex (Two Rivers Church). "
    "Building 1 is the main sanctuary — largest building with multiple roof materials: "
    "laminated comp shingle on steep slopes, modified bitumen/flat roof sections, "
    "and copper standing seam on sanctuary/tower. "
    "Building 2 is education/office wing — laminated architectural shingles. "
    "Building 3 is auxiliary building — laminated architectural shingles with flat rolled section. "
    "Inspector chalk-tested skylights, downspouts, gutters, and metal trim for hail damage."
)


async def main():
    claude = get_anthropic_client()
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # ========== 1. EXTRACT MEASUREMENTS (3 EagleViews) ==========
    print("=" * 60)
    print("STEP 1: Extracting measurements from 3 EagleViews")
    print("=" * 60)

    all_structures = []
    merged = {}
    for i, path in enumerate(EV_FILES):
        print(f"\n[EV {i+1}/3] {os.path.basename(path)}")
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

        for s in file_structs:
            print(f"  → {s.get('name')}: {s.get('roof_area_sf', 0)} SF, pitch={s.get('predominant_pitch', '?')}")

    merged["structures"] = all_structures
    merged["total_roof_area_sf"] = sum(s.get("roof_area_sf", 0) for s in all_structures)
    merged["total_roof_area_sq"] = sum(s.get("roof_area_sq", 0) for s in all_structures)
    print(f"\n[MERGED] {len(all_structures)} structures, {merged['total_roof_area_sf']} SF total")

    # ========== 2. ANALYZE PHOTOS ==========
    print("\n" + "=" * 60)
    print("STEP 2: Analyzing photos (with fixed chalk test prompt)")
    print("=" * 60)

    photo_paths = sorted([
        os.path.join(PHOTOS_DIR, f) for f in os.listdir(PHOTOS_DIR)
        if get_media_type(os.path.join(PHOTOS_DIR, f)).startswith("image/")
    ])
    photo_filenames = [os.path.basename(p) for p in photo_paths]
    print(f"[PHOTOS] {len(photo_paths)} photos to analyze")

    photo_analysis = await asyncio.to_thread(
        analyze_photos, claude, photo_paths, user_notes=USER_NOTES
    )
    print(f"[PHOTOS] Analysis complete: {photo_analysis.get('photo_count', 0)} photos, "
          f"trades: {photo_analysis.get('trades_identified', [])}")

    # ========== 3. EXTRACT WEATHER ==========
    print("\n" + "=" * 60)
    print("STEP 3: Extracting weather data")
    print("=" * 60)

    weather_data = {}
    if os.path.exists(WEATHER_FILE):
        weather_data = await asyncio.to_thread(extract_weather_data, claude, WEATHER_FILE)
        print(f"[WEATHER] Storm date: {weather_data.get('storm_date', '?')}, "
              f"hail: {weather_data.get('hail_size', '?')}")

    # ========== 4. BUILD CLAIM CONFIG ==========
    print("\n" + "=" * 60)
    print("STEP 4: Building claim config (multi-structure)")
    print("=" * 60)

    # Simulate the claim record (what would come from Supabase)
    claim = {
        "address": "13 Chrisfield Ave, Johnson City, NY 13790",
        "carrier": "GuideOne Insurance",
        "homeowner_name": "Pastor Will Hampton",
        "date_of_loss": "2023-07-16",
        "user_notes": USER_NOTES,
        "estimate_request": {
            "roof_material": "Laminate Comp Shingle",
            "siding": False,
            "gutters": True,
        },
    }

    company_profile = {
        "company_name": "USA ROOF MASTERS",
        "address": "3070 Bristol Pike, Building 1, Suite 122",
        "city_state_zip": "Bensalem, PA 19020",
        "contact_name": "Tom Kovack Jr.",
        "contact_title": "CEO",
        "email": "TKovack@USARoofMasters.com",
        "phone": "267-679-1504",
        "office_phone": "267-332-0197",
        "website": "www.USARoofMasters.com",
    }

    config = build_claim_config(
        claim, merged, photo_analysis, None, photo_filenames,
        weather_data, company_profile,
        user_notes=USER_NOTES,
    )

    # Print structure summary
    structs = config.get("structures", [])
    print(f"\n[CONFIG] {len(structs)} structures:")
    for s in structs:
        print(f"  {s.get('name', '?')}: {s.get('roof_area_sf', 0)} SF, "
              f"material={s.get('shingle_type', '?')}")

    line_items = config.get("line_items", [])
    print(f"\n[LINE ITEMS] {len(line_items)} total items")

    # Group by structure prefix
    struct_groups = {}
    for item in line_items:
        desc = item["description"]
        if "]" in desc:
            prefix = desc.split("]")[0] + "]"
        else:
            prefix = "Ungrouped"
        struct_groups.setdefault(prefix, []).append(item)

    for prefix, items in struct_groups.items():
        subtotal = sum(i["qty"] * i["unit_price"] for i in items)
        print(f"  {prefix}: {len(items)} items, ${subtotal:,.2f}")

    # Financials
    financials = compute_financials(config)
    print(f"\n[FINANCIALS]")
    print(f"  Line total:  ${financials['line_total']:,.2f}")
    print(f"  Tax:         ${financials['tax']:,.2f}")
    print(f"  RCV:         ${financials['rcv']:,.2f}")
    print(f"  O&P:         ${financials['o_and_p']:,.2f}")
    print(f"  Total:       ${financials['total']:,.2f}")

    # Check chalk test identification in annotations
    annots = config.get("photo_annotations", {})
    chalk_mentions = 0
    sealant_mentions = 0
    for key, val in annots.items():
        v = str(val).lower()
        if "chalk" in v:
            chalk_mentions += 1
        if any(w in v for w in ["sealant", "glazing", "paint", "caulk", "coating"]):
            sealant_mentions += 1
            print(f"  [WARN] {key} still mentions sealant/paint/glazing: {val[:100]}...")

    print(f"\n[CHALK TEST] {chalk_mentions} photos mention chalk, {sealant_mentions} still say sealant/paint/glazing")

    # ========== 5. SAVE CONFIG ==========
    config_path = os.path.join(CLAIM_DIR, "claim_config.json")
    # Backup old config
    backup_path = os.path.join(CLAIM_DIR, "claim_config_backup.json")
    if os.path.exists(config_path):
        import shutil
        shutil.copy2(config_path, backup_path)
        print(f"\n[BACKUP] Old config saved to {backup_path}")

    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
    print(f"[SAVED] New config: {config_path}")

    # ========== 6. GENERATE PDFs ==========
    print("\n" + "=" * 60)
    print("STEP 6: Generating PDFs")
    print("=" * 60)

    pdfs = generate_pdfs(config, CLAIM_DIR)
    print(f"\n[DONE] Generated {len(pdfs)} PDFs:")
    for pdf in pdfs:
        size = os.path.getsize(pdf) / 1024 / 1024
        print(f"  {os.path.basename(pdf)} ({size:.1f} MB)")

    print("\n" + "=" * 60)
    print(f"REPROCESS COMPLETE — 13 Chrisfield Ave")
    print(f"  Structures: {len(structs)}")
    print(f"  Line items: {len(line_items)}")
    print(f"  Total RCV: ${financials['total']:,.2f}")
    print(f"  PDFs: {len(pdfs)}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
