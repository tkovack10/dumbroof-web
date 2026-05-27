#!/usr/bin/env python3
"""Ship 1.2.5 — import national-rate items (labor / equipment / debris) into
pricing_line_items (is_national_rate=true) + pricing_national_prices.

These items are NOT in all-markets.json's allItems — build_line_items injects
them from the legacy per-state JSON (nybi26/papi26/njbi26) or, for the 12 states
with no legacy JSON, from hardcoded _priced() fallbacks that equal the nybi26
values. Empirically: NY/NJ + all 12 unpriced states resolve to the nybi26 rate;
only PA (papi26) is ~3% lower. So a single national rate = nybi26 matches 14/15
states exactly. PA labor is a known ~3% Ship-2-parity item (accept national
canonicalization, or add PA market overrides later).

Source values are nybi26.json (the de-facto baseline). Same idempotent pattern
as Ship 1.2. Read-only w.r.t. consumer code paths.

Usage:
    python3 scripts/import_national_prices.py            # dry run
    python3 scripts/import_national_prices.py --commit    # upsert
"""
from __future__ import annotations
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "..", "backend")
sys.path.insert(0, BACKEND)
SOURCE_BATCH = "legacy-nybi26-national-2026-05-26"

# (short_key, description shown on the estimate, unit, category)
NATIONAL_ITEMS = [
    ("roofer_per_hour",        "Roofer - per hour (labor minimum)",            "HR", "ROOFING"),
    ("equipment_operator",     "Equipment operator",                            "EA", "ROOFING"),
    ("dumpster",               "Dumpster load - roofing debris",                "EA", "DEBRIS"),
    ("dumpster_heavy",         "Dumpster load - heavy debris",                  "EA", "DEBRIS"),
    ("slate_specialist_labor", "Slate roofing - additional labor (specialist)", "SQ", "ROOFING"),
    ("siding_labor_min",       "Siding labor minimum",                          "EA", "SIDING"),
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

def build():
    nybi = json.load(open(os.path.join(BACKEND, "pricing", "nybi26.json")))
    rows = []
    for short_key, desc, unit, cat in NATIONAL_ITEMS:
        price = nybi.get(short_key)
        if price is None:
            print(f"  WARN: {short_key} not in nybi26.json — skipping")
            continue
        rows.append((short_key, desc, unit, cat, round(float(price), 2)))
    return rows

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()
    rows = build()

    print("\n=== Ship 1.2.5 national_prices import ===")
    for sk, desc, unit, cat, price in rows:
        print(f"  {sk:<24} {('$'+format(price,'.2f')):>10}  {unit:<3} {cat:<8} {desc}")
    print(f"\n{len(rows)} national items (single rate, matches 14/15 states; PA labor ~3% lower)")

    if not args.commit:
        print("\n(dry run — pass --commit to write)")
        return

    from supabase import create_client
    url, key = _load_env()
    if not url or not key:
        print("FATAL: SUPABASE creds missing", file=sys.stderr); sys.exit(1)
    sb = create_client(url, key)

    sb.table("pricing_line_items").upsert(
        [{"short_key": sk, "description": desc, "unit": unit, "category": cat,
          "is_national_rate": True} for sk, desc, unit, cat, _ in rows],
        on_conflict="short_key",
    ).execute()
    ids = {r["short_key"]: r["line_item_id"] for r in
           sb.table("pricing_line_items").select("line_item_id,short_key")
           .in_("short_key", [r[0] for r in rows]).execute().data}
    sb.table("pricing_national_prices").upsert(
        [{"line_item_id": ids[sk], "unit_price": price, "source_batch": SOURCE_BATCH}
         for sk, _, _, _, price in rows if sk in ids],
        on_conflict="line_item_id",
    ).execute()
    print(f"\nCOMMIT: upserted {len(rows)} catalog items (is_national_rate) + national_prices rows")

if __name__ == "__main__":
    main()
