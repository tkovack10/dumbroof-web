"""
Address-to-coordinates resolver with caching.
Gracefully degrades if geopy is not installed.
"""

import os
import sqlite3
from typing import Optional, Tuple

# Cache DB lives alongside the main fraud DB
CACHE_DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "fraud_detection_db",
    "geocode_cache.db",
)

try:
    from geopy.geocoders import Nominatim
    from geopy.exc import GeocoderTimedOut, GeocoderServiceError
    HAS_GEOPY = True
except ImportError:
    HAS_GEOPY = False


def _init_cache():
    """Create geocode cache table if needed."""
    os.makedirs(os.path.dirname(CACHE_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(CACHE_DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS geocode_cache (
            address TEXT PRIMARY KEY,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            cached_at TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


def _lookup_cache(address: str) -> Optional[Tuple[float, float]]:
    """Check cache for previously geocoded address."""
    if not os.path.exists(CACHE_DB_PATH):
        return None
    conn = sqlite3.connect(CACHE_DB_PATH)
    row = conn.execute(
        "SELECT latitude, longitude FROM geocode_cache WHERE address = ?",
        (address.strip().lower(),),
    ).fetchone()
    conn.close()
    if row:
        return (row[0], row[1])
    return None


def _store_cache(address: str, lat: float, lon: float):
    """Store geocoded result in cache."""
    _init_cache()
    from datetime import datetime
    conn = sqlite3.connect(CACHE_DB_PATH)
    conn.execute(
        """INSERT OR REPLACE INTO geocode_cache (address, latitude, longitude, cached_at)
           VALUES (?, ?, ?, ?)""",
        (address.strip().lower(), lat, lon, datetime.now().isoformat()),
    )
    conn.commit()
    conn.close()


def geocode_address(address: str) -> Optional[Tuple[float, float]]:
    """
    Resolve a street address to (latitude, longitude).
    Uses local cache first, then Nominatim (OpenStreetMap).
    Returns None if geocoding fails or geopy is not installed.
    """
    if not address:
        return None

    # Check cache first
    cached = _lookup_cache(address)
    if cached:
        return cached

    if not HAS_GEOPY:
        return None

    try:
        geolocator = Nominatim(user_agent="dumbroof-ai-fraud-detection/1.0")
        location = geolocator.geocode(address, timeout=10)
        if location:
            result = (location.latitude, location.longitude)
            _store_cache(address, result[0], result[1])
            return result
    except (GeocoderTimedOut, GeocoderServiceError):
        pass
    except Exception:
        pass

    return None


def get_property_coordinates(config: dict) -> Optional[Tuple[float, float]]:
    """
    Resolve property coordinates from claim config.
    Priority:
    1. Explicit config coords (property.latitude, property.longitude)
    2. Geocode from address
    """
    prop = config.get("property", {})

    # Priority 1: explicit coordinates in config
    lat = prop.get("latitude")
    lon = prop.get("longitude")
    if lat is not None and lon is not None:
        try:
            return (float(lat), float(lon))
        except (ValueError, TypeError):
            pass

    # Priority 2: geocode from address
    address_parts = []
    if prop.get("address"):
        address_parts.append(prop["address"])
    if prop.get("city"):
        address_parts.append(prop["city"])
    if prop.get("state"):
        address_parts.append(prop["state"])
    if prop.get("zip"):
        address_parts.append(prop["zip"])

    if address_parts:
        full_address = ", ".join(address_parts)
        return geocode_address(full_address)

    return None
