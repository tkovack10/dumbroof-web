#!/usr/bin/env python3
"""Backfill carrier_brand for historical carrier_tactics + claim_outcomes
+ carrier_playbook_entries rows. E211 follow-up.

The previous canonical-name backfill overwrote `carrier` with the parent
canonical, losing the original spelling that disambiguated brand. This
script reverse-derives the brand by joining each row's claim_id back to
claims.carrier (which still has the raw spelling) and re-running the
normalizer to extract the parent + brand pair.

For rows whose canonical parent matches the original raw → brand defaults
to parent (no operational split). For the 6 known sub-brands (Safeco,
Foremost, Crestbrook, Mid-Century, Truck Exchange, Fidelity & Guaranty),
brand stays distinct.

Rows where claims.carrier no longer resolves to anything (or claim_id is
missing entirely — e.g. legacy "_unknown" outcome rows) get carrier_brand
set equal to carrier so analytics queries on carrier_brand always return
non-null.

Usage:
    # Dry-run — count + sample, no writes
    python3 backfill_carrier_brand.py

    # Apply
    python3 backfill_carrier_brand.py --apply
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from collections import Counter, defaultdict


def _get(sb_url: str, sk: str, path: str) -> list:
    req = urllib.request.Request(
        f"{sb_url}{path}",
        headers={"apikey": sk, "Authorization": f"Bearer {sk}",
                 "Accept": "application/json", "User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def _patch(sb_url: str, sk: str, path: str, body: dict):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{sb_url}{path}",
        data=data,
        headers={"apikey": sk, "Authorization": f"Bearer {sk}",
                 "Content-Type": "application/json", "Prefer": "return=minimal",
                 "User-Agent": "Mozilla/5.0"},
        method="PATCH",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        resp.read()


def _fetch_all(sb_url: str, sk: str, table: str, columns: str,
                filter_clause: str = "") -> list:
    rows: list = []
    offset = 0
    while True:
        url = f"/rest/v1/{table}?select={columns}&order=created_at.asc&limit=1000&offset={offset}"
        if filter_clause:
            url += f"&{filter_clause}"
        batch = _get(sb_url, sk, url)
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Take action. Default = dry-run.")
    args = parser.parse_args()

    sb_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    sk = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not sb_url or not sk:
        print("FATAL: SUPABASE_URL / SUPABASE_SERVICE_KEY missing.", file=sys.stderr)
        sys.exit(2)

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from carrier_normalizer import canonical_carrier_brand_pair  # type: ignore

    print(f"=== backfill_carrier_brand (apply={args.apply}) ===")

    # 1. Build claim_id → raw_carrier lookup from claims table
    print("\nStep 1: building claim_id → raw_carrier map from claims...")
    claims_rows = _fetch_all(sb_url, sk, "claims", "id,carrier")
    claim_carrier_map = {r["id"]: (r.get("carrier") or "") for r in claims_rows}
    print(f"  loaded {len(claim_carrier_map)} claims")

    # 2. For each table, compute the brand for every row + group by (current_carrier, target_brand)
    for table in ("carrier_tactics", "claim_outcomes", "carrier_playbook_entries"):
        print(f"\n--- {table} ---")
        rows = _fetch_all(sb_url, sk, table, "id,claim_id,carrier,carrier_brand")
        print(f"  fetched {len(rows)} rows")

        update_buckets: dict[tuple[str, str], list[str]] = defaultdict(list)
        already_set = 0
        no_claim_id = 0
        no_raw = 0

        for r in rows:
            row_id = r.get("id")
            current_brand = r.get("carrier_brand")
            current_carrier = r.get("carrier") or ""
            if not row_id:
                continue
            if current_brand:
                already_set += 1
                continue

            # If row has a claim_id and claims.carrier is set, use raw to derive brand.
            # Only trust the raw-derived brand when the raw-derived PARENT matches
            # the row's current canonical parent. Otherwise the row was already
            # written under a different parent (e.g. carrier extraction tagged a TPA
            # instead of the underwriter, then a previous backfill canonicalized it)
            # — encoding the raw's brand would inject a misattribution.
            cid = r.get("claim_id")
            target_brand = None
            if cid and cid in claim_carrier_map:
                raw = claim_carrier_map[cid]
                if raw:
                    parent, brand = canonical_carrier_brand_pair(raw)
                    if parent and parent == current_carrier:
                        target_brand = brand if brand else parent
                else:
                    no_raw += 1
            else:
                no_claim_id += 1

            # Fallback: brand defaults to current carrier (canonical parent).
            # Either there was no raw available, or the raw-derived parent disagreed
            # with the row's canonical parent (misattribution — see above).
            if not target_brand:
                target_brand = current_carrier or "_unknown"

            update_buckets[(current_carrier, target_brand)].append(row_id)

        print(f"  already_set: {already_set}")
        print(f"  rows missing claim_id: {no_claim_id}")
        print(f"  rows where claims.carrier is empty: {no_raw}")
        print(f"  update buckets: {len(update_buckets)}")
        # Show ALL splits where brand != parent (the operationally interesting ones)
        splits = [(k, ids) for k, ids in update_buckets.items() if k[0] != k[1]]
        if splits:
            print(f"  ── BRAND SPLITS (parent ≠ brand) — {len(splits)} buckets ──")
            for (carrier, brand), ids in sorted(splits, key=lambda x: -len(x[1])):
                print(f"    {carrier!r:30s} → brand: {brand!r:30s}  ({len(ids)} rows)")
        # Then top 5 same-as-parent for context
        same = sorted(((k, ids) for k, ids in update_buckets.items() if k[0] == k[1]), key=lambda x: -len(x[1]))[:5]
        if same:
            print(f"  ── Top 5 same-as-parent (brand defaults to parent) ──")
            for (carrier, brand), ids in same:
                print(f"    {carrier!r:30s}  ({len(ids)} rows)")

        if not args.apply:
            continue

        total_updated = 0
        for (carrier, brand), ids in update_buckets.items():
            for i in range(0, len(ids), 100):
                chunk = ids[i:i + 100]
                ids_filter = "(" + ",".join(chunk) + ")"
                try:
                    _patch(sb_url, sk, f"/rest/v1/{table}?id=in.{ids_filter}",
                           {"carrier_brand": brand})
                    total_updated += len(chunk)
                except Exception as e:
                    print(f"    PATCH failed ({carrier} → {brand}): {str(e)[:120]}")
        print(f"  TOTAL UPDATED: {total_updated}")

    print("\n=== done ===")


if __name__ == "__main__":
    main()
