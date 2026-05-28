#!/usr/bin/env python3
"""Seed the downspout-extension item into the relational pricing catalog
(Ship 17 Tier B #16 — gutter add-on, measurement-driven, no vision).

A downspout extension / splash block carries roof runoff away from the foundation; it's
standard on a complete gutter R&R. Like the Tier A general-conditions items, it's NOT in
all-markets.json (a small commodity add-on, not an Alfonso material price), so
import_pricing_to_tables.py does NOT recreate it — this idempotent seed must be re-run
after any full re-import (same role as seed_steep_items.py / seed_general_conditions_items.py).
Run order after a fresh import: import_pricing_to_tables --commit, import_national_prices
--commit, seed_steep_items --commit, seed_general_conditions_items --commit,
seed_downspout_extension --commit, then validate_market_prices.

TIMING: INITIAL — knowable pre-work (it's an initial-estimate gutter add-on, stays in Doc 02),
NOT an install supplement. NATIONAL rate (uniform commodity, like the labor/debris items);
COALESCE serves it to every market.

Description matches build_line_items' emitted text EXACTLY (processor.py DOWNSPOUT EXTENSIONS
section) so the catalog and the builder agree — no description drift (E253-class).

Usage:
    python3 scripts/seed_downspout_extension.py            # dry run
    python3 scripts/seed_downspout_extension.py --commit
"""
from __future__ import annotations
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "..", "backend")
SOURCE_BATCH = "ship17-downspout-extension-2026-05-28"

# (short_key, description, unit, national_price)
ITEMS = [
    ("downspout_extension", "Downspout extension - aluminum", "EA", 22.00),
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

    print("\n=== seed downspout-extension item (Ship 17 Tier B, category GUTTERS, INITIAL-timing, national) ===")
    for sk, desc, unit, price in ITEMS:
        print(f"  {sk:<20} {('$'+format(price,'.2f')):>9} {unit:<3} {desc}")
    if not args.commit:
        print("\n(dry run — pass --commit to upsert catalog + national price)")
        return

    from supabase import create_client
    url, key = _load_env()
    if not url or not key:
        print("FATAL: SUPABASE creds missing", file=sys.stderr); sys.exit(1)
    sb = create_client(url, key)

    sb.table("pricing_line_items").upsert(
        [{"short_key": sk, "description": desc, "unit": unit, "category": "GUTTERS",
          "is_national_rate": True, "is_mandatory": False, "status": "active"}
         for sk, desc, unit, _ in ITEMS],
        on_conflict="short_key").execute()
    ids = {r["short_key"]: r["line_item_id"] for r in
           sb.table("pricing_line_items").select("line_item_id,short_key")
           .in_("short_key", [i[0] for i in ITEMS]).execute().data}
    sb.table("pricing_national_prices").upsert(
        [{"line_item_id": ids[sk], "unit_price": price, "source_batch": SOURCE_BATCH}
         for sk, _, _, price in ITEMS if sk in ids],
        on_conflict="line_item_id").execute()

    print(f"\nCOMMIT: {len(ITEMS)} downspout-extension item active + national price upserted.")

if __name__ == "__main__":
    main()
