"""
GPS coordinate verification — compares photo GPS to property location.
Uses Haversine formula for distance calculation (no external dependency).
"""

import math
from typing import Optional, Tuple

from fraud_detection.config import (
    GPS_MAX_DISTANCE_METERS,
    GPS_REVIEW_DISTANCE_METERS,
    GPS_CRITICAL_DISTANCE_METERS,
    TIER_1_INFORMATIONAL,
    TIER_2_REVIEW,
    TIER_3_CRITICAL,
    CHECK_GPS_DISTANCE,
    CHECK_GPS_MISSING,
)
from fraud_detection.models import PhotoMetadata, FraudFlag


# Earth's radius in meters
EARTH_RADIUS_M = 6_371_000


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great-circle distance between two GPS coordinates.
    Returns distance in meters.
    """
    lat1_r, lon1_r = math.radians(lat1), math.radians(lon1)
    lat2_r, lon2_r = math.radians(lat2), math.radians(lon2)

    dlat = lat2_r - lat1_r
    dlon = lon2_r - lon1_r

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return EARTH_RADIUS_M * c


def meters_to_miles(meters: float) -> float:
    """Convert meters to miles."""
    return meters / 1609.344


def check_gps_distance(
    metadata: PhotoMetadata,
    property_lat: Optional[float],
    property_lon: Optional[float],
) -> Optional[FraudFlag]:
    """
    Validate photo GPS coordinates against property location.
    Returns FraudFlag if distance exceeds threshold, None if clean.
    """
    # No GPS in photo
    if metadata.gps_lat is None or metadata.gps_lon is None:
        return FraudFlag(
            photo_key=metadata.photo_key,
            check_type=CHECK_GPS_MISSING,
            tier=TIER_1_INFORMATIONAL,
            message="No GPS coordinates in photo EXIF — location cannot be verified",
            details={"field": "GPSLatitude/GPSLongitude"},
        )

    # No property coordinates to compare against
    if property_lat is None or property_lon is None:
        return None  # Can't check — skip silently

    distance_m = haversine_distance(
        metadata.gps_lat, metadata.gps_lon,
        property_lat, property_lon,
    )
    distance_miles = meters_to_miles(distance_m)

    # Critical: > 2 miles
    if distance_m > GPS_CRITICAL_DISTANCE_METERS:
        return FraudFlag(
            photo_key=metadata.photo_key,
            check_type=CHECK_GPS_DISTANCE,
            tier=TIER_3_CRITICAL,
            message=f"Photo taken {distance_miles:.2f} miles from property (>{meters_to_miles(GPS_CRITICAL_DISTANCE_METERS):.1f} mi threshold)",
            details={
                "photo_lat": metadata.gps_lat,
                "photo_lon": metadata.gps_lon,
                "property_lat": property_lat,
                "property_lon": property_lon,
                "distance_meters": round(distance_m, 1),
                "distance_miles": round(distance_miles, 2),
            },
        )

    # Review: 0.5-2 miles
    if distance_m > GPS_REVIEW_DISTANCE_METERS:
        return FraudFlag(
            photo_key=metadata.photo_key,
            check_type=CHECK_GPS_DISTANCE,
            tier=TIER_2_REVIEW,
            message=f"Photo taken {distance_miles:.2f} miles from property (>{meters_to_miles(GPS_REVIEW_DISTANCE_METERS):.1f} mi threshold)",
            details={
                "photo_lat": metadata.gps_lat,
                "photo_lon": metadata.gps_lon,
                "property_lat": property_lat,
                "property_lon": property_lon,
                "distance_meters": round(distance_m, 1),
                "distance_miles": round(distance_miles, 2),
            },
        )

    # Informational: 0.25-0.5 miles
    if distance_m > GPS_MAX_DISTANCE_METERS:
        return FraudFlag(
            photo_key=metadata.photo_key,
            check_type=CHECK_GPS_DISTANCE,
            tier=TIER_1_INFORMATIONAL,
            message=f"Photo taken {distance_miles:.2f} miles from property (marginally outside {meters_to_miles(GPS_MAX_DISTANCE_METERS):.2f} mi threshold)",
            details={
                "photo_lat": metadata.gps_lat,
                "photo_lon": metadata.gps_lon,
                "property_lat": property_lat,
                "property_lon": property_lon,
                "distance_meters": round(distance_m, 1),
                "distance_miles": round(distance_miles, 2),
            },
        )

    return None


def compute_gps_consensus(
    metadata_list: list,
) -> Optional[Tuple[float, float]]:
    """
    Compute median GPS coordinates from all photos with GPS data.
    Useful as a fallback property location when config doesn't have coordinates.
    Returns (lat, lon) tuple or None if insufficient data.
    """
    coords = [
        (m.gps_lat, m.gps_lon)
        for m in metadata_list
        if m.gps_lat is not None and m.gps_lon is not None
    ]
    if len(coords) < 3:
        return None

    lats = sorted(c[0] for c in coords)
    lons = sorted(c[1] for c in coords)
    mid = len(lats) // 2
    return (lats[mid], lons[mid])
