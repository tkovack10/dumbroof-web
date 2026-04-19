"""
Photo -> roof-slope (facet) assignment.

V1 heuristic uses two signals, in order of preference:

  1. EXIF compass heading (GPSImgDirection) — direction the camera was
     pointing. Camera heading of 0 (north) views the south slope, etc.
     Accurate but only present on phone-native uploads. Vendors like
     AccuLynx strip this tag when re-saving photos (keep GPS lat/lng,
     drop the direction).

  2. GPS triangulation from property centroid — if the photographer's
     GPS position is known AND the property centroid is known, the
     bearing from centroid-to-photographer tells us which side of the
     house they stood on, which is the slope they photographed.
     (Photographers stand at the slope they're capturing.) No inversion
     needed — this is the natural interpretation.

No polygon ray-cast yet — V2 will add that once we validate V1 accuracy
on real claims.
"""

from __future__ import annotations

import math
from typing import Optional

CARDINAL_BEARINGS = {
    "N":    0,
    "NE":  45,
    "E":   90,
    "SE": 135,
    "S":  180,
    "SW": 225,
    "W":  270,
    "NW": 315,
}

# Only true cardinal directions count. Claude's existing `elevation` tag on
# photos uses "front/rear/left/right" (relative to the house, not geographic)
# so it CANNOT be safely converted to N/S/E/W without a known house
# orientation. We explicitly reject non-geographic values here.
ELEVATION_TO_CARDINAL = {
    "n": "N", "north": "N",
    "s": "S", "south": "S",
    "e": "E", "east": "E",
    "w": "W", "west": "W",
    "ne": "NE", "northeast": "NE",
    "nw": "NW", "northwest": "NW",
    "se": "SE", "southeast": "SE",
    "sw": "SW", "southwest": "SW",
}
_NON_GEOGRAPHIC_ELEVATIONS = {
    "front", "rear", "back", "left", "right",
    "roof", "detail", "interior", "exterior",
}


def _bucket_bearing(bearing_deg: float) -> str:
    """Round a 0-360° bearing to the nearest 8-compass cardinal."""
    idx = int((bearing_deg % 360 + 22.5) // 45) % 8
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][idx]


def _camera_view_cardinal(heading_deg: float) -> str:
    """Convert a compass heading (direction camera was pointing) to an 8-way
    cardinal label for the *slope being photographed*.

    The slope facing the camera is on the OPPOSITE side from where the camera
    stands looking at it — i.e., if camera heading is 180° (pointing south),
    the slope visible in the photo faces *north* back at the lens. So the
    slope's cardinal = (heading + 180) mod 360, bucketed to the nearest
    8-compass direction.
    """
    return _bucket_bearing(float(heading_deg) + 180.0)


def _bearing_from_centroid(
    centroid_lat: float, centroid_lon: float,
    photo_lat: float, photo_lon: float,
) -> float:
    """Initial-compass-bearing from property centroid to photographer GPS.

    Returns degrees 0-360 clockwise from true north. Great-circle formula
    adapted from https://www.movable-type.co.uk/scripts/latlong.html.

    The returned bearing IS the cardinal of the visible slope: if the
    photographer stood north of the house (bearing = 0°), they were
    standing AT the north slope looking back at the house, photographing
    the north-facing slope of the roof.
    """
    lat1 = math.radians(centroid_lat)
    lat2 = math.radians(photo_lat)
    dlon = math.radians(photo_lon - centroid_lon)
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    bearing = math.degrees(math.atan2(y, x))
    return (bearing + 360.0) % 360.0


def _haversine_meters(
    lat1: float, lon1: float, lat2: float, lon2: float,
) -> float:
    """Great-circle distance in meters. Used to reject photos too far from
    the property centroid (e.g. inspector's car 500m away)."""
    R = 6_371_000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


# Photos more than this far from the property centroid are ignored for GPS
# triangulation — they're almost certainly taken from a road, staging area,
# or neighboring property, where bearing-from-centroid is meaningless.
GPS_TRIANGULATION_MAX_METERS = 100.0
# And too close: photos inside a tight radius could be taken from anywhere
# on the property and the centroid bearing is noise-dominated.
GPS_TRIANGULATION_MIN_METERS = 5.0


def _cardinal_distance(a: str, b: str) -> int:
    """Minimum hops between two 8-compass cardinals (0 = identical, 4 = opposite)."""
    order = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    try:
        ia = order.index(a.upper())
        ib = order.index(b.upper())
    except ValueError:
        return 99
    diff = abs(ia - ib)
    return min(diff, 8 - diff)


def synthesize_cardinal_facets() -> list:
    """Return a 4-cardinal skeleton of synthetic facets.

    Used as a fallback when Vision facet extraction returns empty or when
    the measurement PDF lacks an overhead diagram. A typical pitched roof
    has 2-6 planes distributed across N/E/S/W cardinals. Seeding with these
    4 directions lets GPS triangulation still bucket photos — the user
    sees "which side of the house was photographed" even without polygon
    geometry from the measurement report.

    Empty cardinals (no photos assigned) just stay empty — they don't hurt
    anything. Individual per-slope damage aggregation continues to work;
    the overhead map in the UI degrades to the side-panel slope list.
    """
    return [
        {"facet_id": card, "cardinal": card, "pitch": None,
         "area_pct": 25.0, "polygon_pixels": []}
        for card in ("N", "E", "S", "W")
    ]


def _normalize_cardinal(val: Optional[str]) -> Optional[str]:
    """Fold free-form direction strings into the 8-compass scheme.

    Returns None for house-relative tags like "front/rear/left/right" — those
    can't be converted to a geographic cardinal without knowing which face of
    the house is north, which we don't.
    """
    if not val:
        return None
    key = str(val).strip().lower()
    if key in _NON_GEOGRAPHIC_ELEVATIONS:
        return None
    if key in ELEVATION_TO_CARDINAL:
        return ELEVATION_TO_CARDINAL[key]
    upper = key.upper()
    if upper in CARDINAL_BEARINGS:
        return upper
    return None


def assign_photos_to_slopes(
    photos: list,
    roof_facets: list,
    property_lat: Optional[float] = None,
    property_lon: Optional[float] = None,
) -> dict:
    """Assign each photo to a roof facet (slope).

    Signal priority:
      1. EXIF compass heading (most accurate; phone-native photos only)
      2. GPS triangulation — bearing from property centroid to photo GPS
         (works when heading was stripped by upload vendors like AccuLynx)
      3. Claude Vision's existing elevation tag (only if geographic)

    Args:
        photos: list of photo dicts {annotation_key, heading?, gps_lat?,
                gps_lon?, elevation?, damage_type?}.
        roof_facets: list of facet dicts from claims.roof_facets payload
                with {facet_id, cardinal, ...}
        property_lat/lon: geocoded property centroid (from claims.latitude/
                longitude). Enables signal #2. Without this, GPS is ignored.

    Returns:
        dict mapping annotation_key -> facet_id. Photos that cannot be
        confidently assigned are omitted (caller can default to NULL).
    """
    if not photos or not roof_facets:
        return {}

    # Bucket facets by cardinal for fast lookup
    by_cardinal: dict = {}
    for facet in roof_facets:
        fid = facet.get("facet_id")
        card = _normalize_cardinal(facet.get("cardinal"))
        if not fid or not card:
            continue
        by_cardinal.setdefault(card, []).append(facet)

    if not by_cardinal:
        return {}

    have_centroid = (
        property_lat is not None and property_lon is not None
    )

    assignments: dict = {}
    for photo in photos:
        key = photo.get("annotation_key")
        if not key:
            continue

        # 1. Preferred signal: EXIF heading.
        target_cardinal = None
        heading = photo.get("heading")
        if heading is not None:
            try:
                target_cardinal = _camera_view_cardinal(float(heading))
            except (TypeError, ValueError):
                target_cardinal = None

        # 2. GPS triangulation from property centroid.
        if not target_cardinal and have_centroid:
            try:
                p_lat = photo.get("gps_lat")
                p_lon = photo.get("gps_lon")
                if p_lat is not None and p_lon is not None:
                    p_lat_f = float(p_lat)
                    p_lon_f = float(p_lon)
                    dist = _haversine_meters(property_lat, property_lon, p_lat_f, p_lon_f)  # type: ignore[arg-type]
                    if GPS_TRIANGULATION_MIN_METERS <= dist <= GPS_TRIANGULATION_MAX_METERS:
                        bearing = _bearing_from_centroid(
                            property_lat, property_lon, p_lat_f, p_lon_f,  # type: ignore[arg-type]
                        )
                        target_cardinal = _bucket_bearing(bearing)
            except (TypeError, ValueError):
                pass

        # 3. Fallback: Claude Vision's elevation tag on the photo itself.
        if not target_cardinal:
            target_cardinal = _normalize_cardinal(photo.get("elevation"))

        if not target_cardinal:
            continue  # Skip — no signal to assign

        # 3. Exact match first
        candidates = by_cardinal.get(target_cardinal)
        # 4. Nearest neighbour fallback (within 1 cardinal step, i.e., 45°)
        if not candidates:
            best_dist = 99
            for card, facets in by_cardinal.items():
                d = _cardinal_distance(target_cardinal, card)
                if d < best_dist:
                    best_dist = d
                    candidates = facets
            if best_dist > 1:  # more than 45° off = don't assign, ambiguous
                continue

        if not candidates:
            continue

        # Among same-cardinal candidates, pick the largest facet
        # (most-area-first is a reasonable tiebreaker when photos lack
        # finer disambiguating signal).
        chosen = max(
            candidates,
            key=lambda f: float(f.get("area_pct") or f.get("area_sf") or 0),
        )
        assignments[key] = chosen.get("facet_id")

    return assignments


# Carrier-standard full-reroof trigger: fire when the area-weighted damage
# fraction across the roof meets or exceeds this threshold. Matches how
# carriers/NTSRA argue "≥25% of the roof is damaged → full replacement"
# rather than the per-facet-independent interpretation (which would let a
# single 2-photo slope trigger reroof on a 6,000 SF roof).
FULL_REROOF_TRIGGER_THRESHOLD = 0.25

# Minimum damage-photo evidence on a single slope before it can contribute to
# the trigger. Prevents one stray "critical" annotation from auto-qualifying a
# whole roof for replacement.
MIN_DAMAGE_PHOTOS_PER_SLOPE = 3

# Severity -> damage weight multiplier. Tuned so max-possible per-photo
# contribution is 3 (critical). `weighted_damage_pct = sum(weights) / (N * 3)`
# keeps the metric normalized in [0, 1] regardless of severity distribution.
SEVERITY_WEIGHTS = {
    "critical": 3.0,
    "severe":   2.0,
    "moderate": 1.0,
    "minor":    0.5,
    "none":     0.0,
    "":         0.0,
}

# Damage types that count as "damage" for aggregation (vs overview/benign tags).
_DAMAGE_TYPES = {
    "hail_dent", "hail_hit", "crack", "missing", "delamination",
    "wind_crease", "lifted_tab", "granule_loss", "puncture",
    "rust", "corrosion", "dent", "blister",
}


def _is_damage_type(dtype) -> bool:
    if not dtype:
        return False
    return str(dtype).strip().lower() in _DAMAGE_TYPES


def aggregate_slope_damage(photos: list, roof_facets: list) -> tuple:
    """Aggregate per-slope damage from scored photos.

    Args:
        photos: list of photo rows with {slope_id, damage_type, severity}
        roof_facets: list of facets from claims.roof_facets[] (used to enumerate
                facets even if no photos landed on them — so the UI can show
                zero-damage slopes too)

    Returns:
        (slope_damage_list, full_reroof_trigger_bool)

        slope_damage_list: list of
            {facet_id, cardinal, pitch, total_photos, damage_photos,
             weighted_damage_pct, dominant_damage_type}

        full_reroof_trigger_bool: True if any slope's weighted_damage_pct
        meets or exceeds FULL_REROOF_TRIGGER_THRESHOLD.
    """
    # Index facets by id, preserve order
    facet_index: dict = {}
    facet_order: list = []
    for f in roof_facets or []:
        fid = f.get("facet_id")
        if not fid:
            continue
        facet_index[fid] = f
        facet_order.append(fid)

    # Bucket photos by slope_id
    buckets: dict = {fid: [] for fid in facet_order}
    unassigned = 0
    for p in photos or []:
        sid = p.get("slope_id")
        if sid and sid in buckets:
            buckets[sid].append(p)
        else:
            unassigned += 1

    results = []
    # Weighted area totals for the roof-level trigger.
    total_area_w = 0.0
    damaged_area_w = 0.0

    for fid in facet_order:
        pics = buckets[fid]
        total = len(pics)
        damage_pics = [p for p in pics if _is_damage_type(p.get("damage_type"))]
        dcount = len(damage_pics)

        # Weighted damage fraction — denominator is damage-candidate photos only
        # so overview/none-type photos don't dilute the severity signal. If
        # only overview photos exist (no damage_pics), weighted_damage_pct=0.
        if dcount == 0:
            weighted = 0.0
        else:
            severity_total = sum(
                SEVERITY_WEIGHTS.get(str(p.get("severity") or "").lower(), 0.0)
                for p in damage_pics
            )
            max_possible = dcount * SEVERITY_WEIGHTS["critical"]
            weighted = round(severity_total / max_possible, 4) if max_possible else 0.0

        # Most-common damage type among the damaged photos on this slope
        dominant = None
        if damage_pics:
            counts: dict = {}
            for p in damage_pics:
                dt = str(p.get("damage_type") or "").strip().lower()
                if dt:
                    counts[dt] = counts.get(dt, 0) + 1
            if counts:
                dominant = max(counts.items(), key=lambda kv: kv[1])[0]

        facet = facet_index[fid]
        # Contribution to roof-level trigger. Only slopes with enough damage
        # evidence (>= MIN_DAMAGE_PHOTOS_PER_SLOPE) count — this stops a single
        # stray critical photo from auto-qualifying the whole roof.
        try:
            area_pct = float(facet.get("area_pct") or 0.0)
        except (TypeError, ValueError):
            area_pct = 0.0
        if dcount >= MIN_DAMAGE_PHOTOS_PER_SLOPE:
            total_area_w += area_pct
            damaged_area_w += area_pct * weighted
        else:
            # Slope still counts toward total roof area even if we skip it for
            # trigger purposes — prevents "ignore the evidence-thin slopes and
            # triggering on the one heavily photographed slope" failure mode.
            total_area_w += area_pct

        results.append({
            "facet_id": fid,
            "cardinal": facet.get("cardinal"),
            "pitch": facet.get("pitch"),
            "area_pct": area_pct,
            "total_photos": total,
            "damage_photos": dcount,
            "weighted_damage_pct": weighted,
            "dominant_damage_type": dominant,
        })

    if unassigned:
        # Surface as a pseudo-slope so the UI can show how many photos
        # couldn't be placed. Doesn't contribute to the reroof trigger.
        results.append({
            "facet_id": "_unassigned",
            "cardinal": None,
            "pitch": None,
            "area_pct": 0.0,
            "total_photos": unassigned,
            "damage_photos": 0,
            "weighted_damage_pct": 0.0,
            "dominant_damage_type": None,
        })

    # Roof-level area-weighted damage fraction. When facet area_pct data is
    # missing (all zeros), fall back to unweighted mean so the trigger still
    # functions, but log it so we know EagleView facet extraction is thin.
    if total_area_w > 0:
        roof_damage_fraction = damaged_area_w / total_area_w
    else:
        qualifying = [
            r for r in results
            if r["facet_id"] != "_unassigned"
            and r["damage_photos"] >= MIN_DAMAGE_PHOTOS_PER_SLOPE
        ]
        roof_damage_fraction = (
            sum(r["weighted_damage_pct"] for r in qualifying) / len(qualifying)
            if qualifying else 0.0
        )

    trigger = roof_damage_fraction >= FULL_REROOF_TRIGGER_THRESHOLD
    return results, trigger
