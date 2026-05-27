#!/usr/bin/env python3
"""Seed the 6 steep-roof surcharge items into the relational pricing catalog.

Steep charges are NOT in all-markets.json (they're surcharges, not Alfonso material
prices — see processor.py:659), so import_pricing_to_tables.py does NOT recreate them.
This idempotent seed must be re-run after any full re-import (truncate + reimport),
same role import_national_prices.py plays for labor/equipment. Run order after a
fresh import: import_pricing_to_tables --commit, import_national_prices --commit,
seed_steep_items --commit, then validate_market_prices.

MARKET-PRICED (not national): steep varies by state in the legacy *.json — PA
(papi26) is ~3% below NY/NJ + the hardcoded fallback used by the other 12 priced
states. Matches build_line_items' current per-state behavior exactly (Ship-2 parity):
PA markets -> papi26 values; every other market -> nybi26 values.

Descriptions match build_line_items' emitted text EXACTLY (processor.py:5031-5043)
so the catalog and the builder agree — no description drift (E253-class).

Usage:
    python3 scripts/seed_steep_items.py            # dry run
    python3 scripts/seed_steep_items.py --commit
"""
from __future__ import annotations
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "..", "backend")
SOURCE_BATCH = "legacy-steep-2026-05-27"

# short_key -> (description, papi26_price, nybi26/default_price). short_keys reuse the
# exact _priced() keys build_line_items already looks up — no new naming variant.
STEEP = [
    ("steep_install_7_9",   "Additional charge for steep roof 7/12-9/12",            62.0,  64.07),
    ("steep_remove_7_9",    "Remove - Additional charge for steep roof 7/12-9/12",   17.5,  18.0),
    ("steep_install_10_12", "Additional charge for steep roof 10/12-12/12",          98.0,  100.73),
    ("steep_remove_10_12",  "Remove - Additional charge for steep roof 10/12-12/12", 27.5,  28.29),
    ("steep_install_gt12",  "Additional charge for steep roof >12/12",               128.0, 131.43),
    ("steep_remove_gt12",   "Remove - Additional charge for steep roof >12/12",      35.0,  36.24),
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

    print("\n=== seed steep-roof items (market-priced; PA=papi26, else nybi26) ===")
    for sk, desc, pa, dflt in STEEP:
        print(f"  {sk:<20} default ${dflt:<7} PA ${pa:<7} {desc}")
    if not args.commit:
        print("\n(dry run — pass --commit to upsert catalog + per-market prices)")
        return

    from supabase import create_client
    url, key = _load_env()
    sb = create_client(url, key)

    # 1. catalog (active — already validated 2026-05-27 via the firewall)
    sb.table("pricing_line_items").upsert(
        [{"short_key": sk, "description": desc, "unit": "SQ", "category": "ROOFING",
          "is_national_rate": False, "is_mandatory": False, "status": "active"}
         for sk, desc, _, _ in STEEP],
        on_conflict="short_key").execute()
    ids = {r["short_key"]: r["line_item_id"] for r in
           sb.table("pricing_line_items").select("line_item_id,short_key")
           .in_("short_key", [s[0] for s in STEEP]).execute().data}

    # 2. per-market prices (PA -> papi26, else nybi26)
    markets = sb.table("pricing_markets").select("market_id,state").execute().data
    payload = []
    for sk, _, pa, dflt in STEEP:
        for m in markets:
            payload.append({"market_id": m["market_id"], "line_item_id": ids[sk],
                            "unit_price": pa if m["state"] == "PA" else dflt,
                            "source_batch": SOURCE_BATCH,
                            "source_note": "papi26" if m["state"] == "PA" else "nybi26 / hardcoded fallback"})
    for i in range(0, len(payload), 500):
        sb.table("pricing_market_prices").upsert(payload[i:i+500],
            on_conflict="market_id,line_item_id").execute()
    print(f"\nCOMMIT: 6 steep items active + {len(payload)} market prices upserted.")

if __name__ == "__main__":
    main()
