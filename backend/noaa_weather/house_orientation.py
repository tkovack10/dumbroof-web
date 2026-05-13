"""
Derive the cardinal direction that the front of a house faces.

The "front" of a house faces the road it addresses. Given a geocoded
property centroid (lat/lon), we snap to the nearest road via the OSRM
public router and compute the bearing centroid → road snap. That bearing,
bucketed to one of 8 compass cardinals, is the front orientation.

This is the bridge between Claude Vision's house-relative photo tags
(front / rear / left / right) and EagleView roof facets which carry
absolute cardinals (N / S / E / W). Without it, every photo on a claim
where EXIF GPS/heading was stripped (AccuLynx, CompanyCam, browser
uploads) falls into "_unassigned" and the overhead roof map is empty.

Free public API, no key required. Cached via process-level dict.
"""

from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from typing import Optional


_CARDINAL_ORDER = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


def _bucket_bearing(bearing_deg: float) -> str:
    idx = int((bearing_deg % 360 + 22.5) // 45) % 8
    return _CARDINAL_ORDER[idx]


def _bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial compass bearing from (lat1,lon1) → (lat2,lon2), 0-360°."""
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    y = math.sin(dlon) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


_NEAREST_URL = "https://router.project-osrm.org/nearest/v1/driving/{lon},{lat}"


def _nearest_road(lat: float, lon: float, timeout: float = 8.0) -> Optional[tuple]:
    """Return (snap_lat, snap_lon) of the nearest road, or None on failure."""
    url = _NEAREST_URL.format(lat=lat, lon=lon)
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "USARM-Claims-Platform/1.0 (slope-mapping)",
        })
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
        waypoints = data.get("waypoints") or []
        if not waypoints:
            return None
        loc = waypoints[0].get("location")  # [lon, lat]
        if not loc or len(loc) < 2:
            return None
        return float(loc[1]), float(loc[0])
    except Exception:
        return None


def derive_front_of_house_cardinal(
    latitude: Optional[float],
    longitude: Optional[float],
) -> Optional[str]:
    """Return one of 'N','NE','E','SE','S','SW','W','NW' or None.

    Returns None when:
      - lat/lon is missing,
      - the nearest-road lookup fails (network/HTTP error),
      - the snap point is implausibly far (>200m — usually means the
        property is rural and the road snap is meaningless for this).
    """
    if latitude is None or longitude is None:
        return None
    try:
        lat_f = float(latitude)
        lon_f = float(longitude)
    except (TypeError, ValueError):
        return None
    snap = _nearest_road(lat_f, lon_f)
    if not snap:
        return None
    snap_lat, snap_lon = snap
    # Reject implausibly far snaps. 200m covers very large lots and most
    # rural addresses; beyond that the snap is likely a county road far from
    # the actual front of the house.
    if _haversine_m(lat_f, lon_f, snap_lat, snap_lon) > 200.0:
        return None
    return _bucket_bearing(_bearing(lat_f, lon_f, snap_lat, snap_lon))


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))
