#!/usr/bin/env python3
"""One-shot backfill: normalize all existing carrier names in carrier_tactics
+ claim_outcomes via canonical_carrier_name(). E211 fix.

Before: 68 distinct carrier strings for ~20 actual insurers.
After: every row keyed on the canonical name; load_carrier_playbook can
match on the merged bucket regardless of which spelling came in on the
new claim.

Garbage rows (carrier in {?, NA, Unknown, "Insurance Company Name", ...})
are deleted rather than relabeled — they pollute win-rate denominators.

Usage:
    # Dry-run (default — reports what WOULD change, no writes)
    python3 backfill_canonical_carriers.py

    # Real run
    python3 backfill_canonical_carriers.py --apply
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


def _delete(sb_url: str, sk: str, path: str):
    req = urllib.request.Request(
        f"{sb_url}{path}",
        headers={"apikey": sk, "Authorization": f"Bearer {sk}",
                 "User-Agent": "Mozilla/5.0", "Prefer": "return=minimal"},
        method="DELETE",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        resp.read()


def _fetch_all(sb_url: str, sk: str, table: str, columns: str) -> list:
    """Paginate via Supabase Range header."""
    rows: list = []
    offset = 0
    while True:
        batch = _get(
            sb_url, sk,
            f"/rest/v1/{table}?select={columns}&order=created_at.asc&limit=1000&offset={offset}",
        )
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
    from carrier_normalizer import canonical_carrier_name  # type: ignore

    print(f"=== backfill_canonical_carriers (apply={args.apply}) ===")

    for table in ("carrier_tactics", "claim_outcomes"):
        # Policy: carrier_tactics rows with garbage carrier are DELETED (a
        # tactic without a known carrier teaches us nothing). claim_outcomes
        # rows with garbage carrier are NULLED instead — they may still be
        # legitimate wins/settlements where carrier extraction failed.
        # Audit confirmed 2,095 "Unknown" outcomes with 105 wins inside —
        # we must NOT lose those; just stop them polluting per-carrier rollups.
        delete_garbage = (table == "carrier_tactics")
        print(f"\n--- {table} ---")
        rows = _fetch_all(sb_url, sk, table, "id,carrier")
        print(f"  fetched {len(rows)} rows")

        rename_buckets: dict[tuple[str, str], list[str]] = defaultdict(list)
        delete_ids: list[str] = []
        null_ids: list[str] = []
        unchanged = 0

        for r in rows:
            raw = r.get("carrier") or ""
            row_id = r.get("id")
            canonical = canonical_carrier_name(raw)
            if not canonical:
                if not row_id:
                    continue
                if delete_garbage:
                    delete_ids.append(row_id)
                else:
                    null_ids.append(row_id)
                continue
            if canonical == raw:
                unchanged += 1
                continue
            rename_buckets[(raw, canonical)].append(row_id)

        print(f"  unchanged: {unchanged}")
        print(f"  rename buckets: {len(rename_buckets)}")
        for (raw, canonical), ids in sorted(rename_buckets.items(), key=lambda x: -len(x[1])):
            print(f"    {raw!r:80s} → {canonical!r:30s} ({len(ids)} rows)")
        if delete_garbage:
            print(f"  DELETE garbage: {len(delete_ids)} rows")
        else:
            print(f"  NULL garbage carrier: {len(null_ids)} rows (keep row, drop bad carrier label)")

        if not args.apply:
            continue

        # Consolidate garbage carriers into a single "_unknown" bucket where
        # we want to preserve the row data. claim_outcomes.carrier has a
        # NOT NULL constraint so we can't blank it; "_unknown" is a stable
        # placeholder that downstream analytics can filter via
        # `WHERE carrier NOT LIKE '\_%' ESCAPE '\'`. Underscore prefix also
        # ensures it sorts above real carrier names.
        if not delete_garbage and null_ids:
            placeholder = "_unknown"
            consolidated = 0
            for i in range(0, len(null_ids), 100):
                chunk = null_ids[i:i + 100]
                ids_filter = "(" + ",".join(chunk) + ")"
                try:
                    _patch(sb_url, sk, f"/rest/v1/{table}?id=in.{ids_filter}", {"carrier": placeholder})
                    consolidated += len(chunk)
                except Exception as e:
                    print(f"    Consolidate failed: {str(e)[:120]}")
            print(f"  TOTAL CONSOLIDATED to {placeholder!r}: {consolidated} (preserves row, segregates from real carriers)")

        # Apply renames in bulk per (raw, canonical) bucket
        total_renamed = 0
        for (raw, canonical), ids in rename_buckets.items():
            # Use bulk PATCH on all ids in this bucket. Supabase supports
            # `id=in.(uuid1,uuid2,...)` filters but the URL gets long; chunk to 100.
            for i in range(0, len(ids), 100):
                chunk = ids[i:i + 100]
                ids_filter = "(" + ",".join(chunk) + ")"
                try:
                    _patch(sb_url, sk, f"/rest/v1/{table}?id=in.{ids_filter}", {"carrier": canonical})
                    total_renamed += len(chunk)
                except Exception as e:
                    print(f"    PATCH failed for {raw} → {canonical}: {str(e)[:120]}")
            print(f"    renamed {len(ids)} rows: {raw[:60]!r:62s} → {canonical!r}")
        print(f"  TOTAL RENAMED: {total_renamed}")

        # Apply deletes
        deleted = 0
        for i in range(0, len(delete_ids), 100):
            chunk = delete_ids[i:i + 100]
            ids_filter = "(" + ",".join(chunk) + ")"
            try:
                _delete(sb_url, sk, f"/rest/v1/{table}?id=in.{ids_filter}")
                deleted += len(chunk)
            except Exception as e:
                print(f"    DELETE failed: {str(e)[:120]}")
        print(f"  TOTAL DELETED: {deleted}")

    print("\n=== done ===")


if __name__ == "__main__":
    main()
