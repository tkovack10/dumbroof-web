#!/usr/bin/env python3
"""Seed the 3 general-conditions surcharge items into the relational pricing catalog
(Ship 17 Tier A — the "maximize SCOPE" backlog).

These are general-conditions lines nearly every roofing job carries but the builder
previously omitted: general clean-up, mask & protect, and the building permit. Like the
steep surcharges, they are NOT in all-markets.json (not Alfonso material prices), so
import_pricing_to_tables.py does NOT recreate them — this idempotent seed must be re-run
after any full re-import, same role import_national_prices.py / seed_steep_items.py play.
Run order after a fresh import: import_pricing_to_tables --commit, import_national_prices
--commit, seed_steep_items --commit, seed_general_conditions_items --commit, then
validate_market_prices.

TIMING DIMENSION (Tom 2026-05-28): all three are INITIAL-estimate items — known pre-work,
so they belong in Doc 02 at claim creation, NOT in an install supplement. They are distinct
from install-supplement items (decking allowance, hidden damage) discovered during tear-off.
See project_ship17_scope_completeness.md.

NATIONAL vs MARKET:
  - general_cleanup, mask_protect: national-rate labor (is_national_rate=True), uniform like
    roofer_per_hour / dumpster. One national price covers every market.
  - permit: JURISDICTION-AWARE (is_national_rate=False). Permit fees vary by municipality, not
    by Xactimate market. We seed a $250 national BASELINE so every market resolves a price via
    COALESCE(market_price, national_price); the jurisdiction-aware layer is per-market rows in
    pricing_market_prices, to be populated with real municipal fees later. is_national_rate=False
    means "default behavior is a baseline that SHOULD be overridden per jurisdiction," NOT "no
    overrides" (same convention import_national_prices.py uses for PA labor).

Descriptions match build_line_items' emitted text EXACTLY (processor.py GENERAL CONDITIONS
section) so the catalog and the builder agree — no description drift (E253-class).

Usage:
    python3 scripts/seed_general_conditions_items.py            # dry run
    python3 scripts/seed_general_conditions_items.py --commit
"""
from __future__ import annotations
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "..", "backend")
SOURCE_BATCH = "ship17-general-conditions-2026-05-28"

# (short_key, description, unit, national_baseline_price, is_national_rate)
# description MUST match processor.build_line_items emitted text exactly.
ITEMS = [
    ("general_cleanup", "General clean-up",                                                          "SQ", 12.00, True),
    ("mask_protect",    "Mask and protect - landscaping, exterior walls & A/C units (perimeter)",    "LF",  2.50, True),
    ("permit",          "Residential building permit - roofing",                                     "EA", 250.00, False),
]

def _load_env():
    env = {}
    p = os.path.join(BACKEND, ".env")
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    return (os.environ.get("SUPABASE_URL") or env.get("SUPABASE_URL"),
            os.environ.get("SUPABASE_SERVICE_KEY") or env.get("SUPABASE_SERVICE_KEY"))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    print("\n=== seed general-conditions items (Ship 17 Tier A, category GENERAL, INITIAL-timing) ===")
    for sk, desc, unit, price, nat in ITEMS:
        kind = "national" if nat else "jurisdiction-aware (baseline)"
        print(f"  {sk:<16} {('$'+format(price,'.2f')):>9} {unit:<3} {kind:<28} {desc}")
    if not args.commit:
        print("\n(dry run — pass --commit to upsert catalog + national baseline prices)")
        return

    from supabase import create_client
    url, key = _load_env()
    if not url or not key:
        print("FATAL: SUPABASE creds missing", file=sys.stderr); sys.exit(1)
    sb = create_client(url, key)

    # 1. catalog rows (active)
    sb.table("pricing_line_items").upsert(
        [{"short_key": sk, "description": desc, "unit": unit, "category": "GENERAL",
          "is_national_rate": nat, "is_mandatory": False, "status": "active"}
         for sk, desc, unit, _, nat in ITEMS],
        on_conflict="short_key").execute()
    ids = {r["short_key"]: r["line_item_id"] for r in
           sb.table("pricing_line_items").select("line_item_id,short_key")
           .in_("short_key", [i[0] for i in ITEMS]).execute().data}

    # 2. national baseline prices (COALESCE source for every market; permit's per-market
    #    jurisdiction overrides, when seeded later, win over this baseline).
    sb.table("pricing_national_prices").upsert(
        [{"line_item_id": ids[sk], "unit_price": price, "source_batch": SOURCE_BATCH}
         for sk, _, _, price, _ in ITEMS if sk in ids],
        on_conflict="line_item_id").execute()

    print(f"\nCOMMIT: {len(ITEMS)} general-conditions items active + national baseline prices upserted.")
    print("  NOTE: permit is jurisdiction-aware — seed real per-market municipal fees into")
    print("        pricing_market_prices to override the $250 baseline.")

if __name__ == "__main__":
    main()
