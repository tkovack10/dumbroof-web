#!/usr/bin/env python3
"""Seed coverage-gap keys (chimney_flashing_ea + laminated_high_install) for
the 40 French-batch markets that have the prices in allItems[] under
non-canonical descriptions.

Shell A's parity_harness_ship3.py identified these as falling through to the
processor's hardcoded fallback for these 40 markets — which means TXHO Houston
laminated_high gets the NY-baseline $383.17 instead of TXHO's actual $306.46.

Root cause: French-batch (Apr-26) Verisk extract uses different canonical
naming than the clean (Mar-26 / 02May-26) batches:
  - "medium (32\" x 36\")" instead of "average (32\" x 36\")"
  - "High grade" instead of "High grd"

The descriptions match the SAME Verisk item — just different abbreviation
conventions. import_pricing_to_tables.py keys by `(cleaned_desc, action)` so
the abbreviation drift caused the silent miss.

This script:
  1. Walks all-markets.json for each of the 40 French-batch market codes
  2. Finds the (medium) chimney + (High grade) laminated install rows
  3. Upserts pricing_market_prices rows tying them to the existing
     chimney_flashing_ea + laminated_high_install line_item_ids
  4. Validates the prices fall within physical bounds before commit
     (chimney_ea between $200-$1500; laminated_high_install between $200-$600)

Two coverage-gap keys NOT addressed here:
  - ridge_vent + gutter_copper_half_round — USARM virtual items, zero
    occurrences in any market's allItems[]. processor.py hardcoded fallback
    already serves them correctly. Adding to relational catalog without a
    real per-market price would just add noise.

Usage:
    python3 scripts/seed_coverage_gap_keys.py            # dry run
    python3 scripts/seed_coverage_gap_keys.py --commit
"""
from __future__ import annotations
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "..", "backend")
SOURCE_BATCH = "french-batch-coverage-fill-2026-05-28"
ALL_MARKETS_PATH = os.path.join(BACKEND, "pricing", "all-markets.json")

# The 40 French-batch markets that fell through silently because their allItems[]
# uses different canonical naming. From the SQL audit earlier this morning:
FRENCH_BATCH = [
    # MI (5)
    'MIMA8X_APR26','MIMP8X_APR26','MIMU8X_APR26','MISA8X_APR26','MITC8X_APR26',
    # MN (11)
    'MNBE8X_APR26','MNBR8X_APR26','MNDL8X_APR26','MNDU8X_APR26','MNHI8X_APR26',
    'MNMA8X_APR26','MNMK8X_APR26','MNMN8X_APR26','MNRO8X_APR26','MNSC8X_APR26',
    'MNTR8X_APR26',
    # TX (24)
    'TXAB8X_APR26','TXAM8X_APR26','TXAU8X_APR26','TXBC8X_APR26','TXBM8X_APR26',
    'TXBT8X_APR26','TXCC8X_APR26','TXCS8X_APR26','TXDF8X_APR26','TXEP8X_APR26',
    'TXGA8X_APR26','TXHO8X_APR26','TXLB8X_APR26','TXMC8X_APR26','TXMI8X_APR26',
    'TXSA8X_APR26','TXSH8X_APR26','TXSN8X_APR26','TXTE8X_APR26','TXTW8X_APR26',
    'TXTY8X_APR26','TXVC8X_APR26','TXWA8X_APR26','TXWF8X_APR26',
]

# (short_key, [list of acceptable description patterns in allItems[]], bounds)
TARGETS = [
    ("chimney_flashing_ea",
     # Canonical (clean markets) is "average"; French batch uses "medium".
     # The (32" x 36") size is the same — both are "average/medium" in Verisk.
     ["R&R Chimney flashing - medium (32\" x 36\")",
      "R&R Chimney flashing - average (32\" x 36\")"],
     (200.0, 1500.0)),  # physical bounds: standard residential chimney flashing
    ("laminated_high_install",
     # Canonical (clean markets) is "High grd" (abbreviated); French batch uses "High grade".
     # Both refer to the same Verisk item — just naming drift.
     # MUST exclude "Remove" prefix (separate item) AND exclude "shake look" variant.
     ["Laminated - High grade - comp. shingle rfg. - w/out felt",
      "Laminated - High grd - comp. shingle rfg. - w/out felt"],
     (200.0, 600.0)),  # physical bounds: high-grade laminate install per SQ
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


def find_price(all_items, target_descs):
    """Look up the first allItems[] entry matching any target desc (exact match)."""
    for it in all_items:
        if it.get("description") in target_descs:
            p = it.get("price")
            if isinstance(p, (int, float)) and p > 0:
                return p
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    print("=== coverage-gap seed: French-batch (chimney_ea + laminated_high_install) ===")
    am = json.loads(open(ALL_MARKETS_PATH).read())["markets"]

    # Collect all per-market prices
    per_target = {sk: [] for sk, _, _ in TARGETS}  # sk -> [(market_code, price)]
    skipped = []
    bounds_failures = []

    for code in FRENCH_BATCH:
        mkt = am.get(code)
        if not mkt:
            skipped.append((code, "market not in all-markets.json"))
            continue
        all_items = mkt.get("allItems", [])
        for sk, target_descs, (lo, hi) in TARGETS:
            price = find_price(all_items, target_descs)
            if price is None:
                skipped.append((code, f"{sk}: none of {target_descs} present"))
                continue
            if not (lo <= price <= hi):
                bounds_failures.append((code, sk, price, lo, hi))
                continue
            per_target[sk].append((code, price))

    print()
    for sk, _, _ in TARGETS:
        print(f"  {sk:<28} {len(per_target[sk])}/40 markets sourced")

    if bounds_failures:
        print(f"\n⛔ BOUNDS FAILURES: {len(bounds_failures)}")
        for code, sk, p, lo, hi in bounds_failures:
            print(f"  {code} {sk}: ${p} outside [${lo}, ${hi}]")
        print("ABORT — investigate bounds failures.")
        return 1

    if skipped:
        print(f"\nNote: {len(skipped)} (code, key) combinations skipped (source desc not present):")
        for code, reason in skipped[:10]:
            print(f"  {code}: {reason}")
        if len(skipped) > 10:
            print(f"  ...and {len(skipped) - 10} more")

    # Sample summary so reader can sanity check the values
    print("\nSpot-checks (first 3 markets per key):")
    for sk, _, _ in TARGETS:
        for code, p in per_target[sk][:3]:
            print(f"  {sk:<28} {code}: ${p}")

    if not args.commit:
        print("\n(dry run — pass --commit to upsert)")
        return 0

    print("\n[COMMIT MODE] Upserting to pricing_market_prices...")
    from supabase import create_client
    url, key = _load_env()
    if not url or not key:
        print("ERROR: Supabase URL/key not found in env or backend/.env")
        return 1
    sb = create_client(url, key)

    # Resolve catalog ids for our 2 keys
    rows = sb.table("pricing_line_items").select("line_item_id,short_key") \
        .in_("short_key", [sk for sk, _, _ in TARGETS]).execute().data
    ids = {r["short_key"]: r["line_item_id"] for r in rows}
    missing = [sk for sk, _, _ in TARGETS if sk not in ids]
    if missing:
        print(f"ERROR: short_keys not in pricing_line_items catalog: {missing}")
        return 1

    # Build upsert payload
    payload = []
    for sk, _, _ in TARGETS:
        for code, p in per_target[sk]:
            payload.append({
                "market_id": code,
                "line_item_id": ids[sk],
                "unit_price": p,
                "source_batch": SOURCE_BATCH,
                "source_note": "all-markets.json allItems (French-batch naming alias resolved)",
            })

    # Batch upsert
    for i in range(0, len(payload), 500):
        sb.table("pricing_market_prices").upsert(
            payload[i:i+500], on_conflict="market_id,line_item_id"
        ).execute()
    print(f"COMMIT: {len(payload)} market_prices upserted across {len(FRENCH_BATCH)} markets.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
