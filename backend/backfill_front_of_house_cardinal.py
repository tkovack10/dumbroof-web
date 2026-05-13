"""
Backfill claims.front_of_house_cardinal for existing geocoded claims.

For every claim that has latitude/longitude but no front_of_house_cardinal,
query OSRM for the nearest road and persist the bearing-bucketed cardinal.
Pace at ~1 req/sec to stay polite to the public OSRM router.

Run: python3 backfill_front_of_house_cardinal.py
"""
from __future__ import annotations

import os
import sys
import time

# Allow running from backend/ directly without PYTHONPATH gymnastics.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from supabase import create_client  # type: ignore
from noaa_weather.house_orientation import derive_front_of_house_cardinal


def main() -> int:
    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"],
    )

    page_size = 500
    offset = 0
    total_updated = 0
    total_skipped = 0

    while True:
        resp = (
            sb.table("claims")
            .select("id, address, latitude, longitude")
            .is_("front_of_house_cardinal", "null")
            .not_.is_("latitude", "null")
            .not_.is_("longitude", "null")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            break

        for row in rows:
            claim_id = row["id"]
            lat = row.get("latitude")
            lon = row.get("longitude")
            try:
                cardinal = derive_front_of_house_cardinal(lat, lon)
            except Exception as e:
                print(f"[{claim_id}] derive failed: {e}", flush=True)
                cardinal = None

            if cardinal:
                sb.table("claims").update({
                    "front_of_house_cardinal": cardinal,
                }).eq("id", claim_id).execute()
                print(f"[{claim_id}] {row.get('address')} → {cardinal}", flush=True)
                total_updated += 1
            else:
                print(f"[{claim_id}] {row.get('address')} → (no snap)", flush=True)
                total_skipped += 1

            time.sleep(1.0)  # OSRM public courtesy rate limit

        offset += page_size

    print(f"\nDone. Updated: {total_updated}, skipped: {total_skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
