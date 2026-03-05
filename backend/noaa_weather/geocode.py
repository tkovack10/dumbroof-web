"""
Address geocoding for NOAA weather queries.
Primary: US Census Bureau Geocoder (no API key required)
Fallback: Nominatim/OpenStreetMap (1 req/sec rate limit)
"""

import json
import time
import urllib.request
import urllib.parse
from dataclasses import dataclass
from typing import Optional, Tuple


@dataclass
class GeoResult:
    latitude: float
    longitude: float
    matched_address: str
    source: str  # "census" | "nominatim"

    def to_dict(self):
        return {
            "latitude": self.latitude,
            "longitude": self.longitude,
            "matched_address": self.matched_address,
            "source": self.source,
        }


def geocode_address(address: str) -> Optional[GeoResult]:
    """Geocode a US address to lat/lon. Tries Census Bureau first, then Nominatim."""
    result = _census_geocode(address)
    if result:
        return result
    return _nominatim_geocode(address)


def _census_geocode(address: str) -> Optional[GeoResult]:
    """US Census Bureau Geocoder — free, no API key, US addresses only."""
    params = urllib.parse.urlencode({
        "address": address,
        "benchmark": "Public_AR_Current",
        "format": "json",
    })
    url = f"https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?{params}"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "USARM-Claims-Platform/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())

        matches = data.get("result", {}).get("addressMatches", [])
        if not matches:
            return None

        match = matches[0]
        coords = match["coordinates"]
        return GeoResult(
            latitude=coords["y"],
            longitude=coords["x"],
            matched_address=match.get("matchedAddress", address),
            source="census",
        )
    except Exception:
        return None


def _nominatim_geocode(address: str) -> Optional[GeoResult]:
    """Nominatim/OpenStreetMap fallback — free, 1 req/sec rate limit."""
    params = urllib.parse.urlencode({
        "q": address,
        "format": "json",
        "limit": "1",
        "countrycodes": "us",
    })
    url = f"https://nominatim.openstreetmap.org/search?{params}"

    try:
        time.sleep(1)  # Respect rate limit
        req = urllib.request.Request(url, headers={
            "User-Agent": "USARM-Claims-Platform/1.0 (storm-damage-claims)"
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())

        if not data:
            return None

        result = data[0]
        return GeoResult(
            latitude=float(result["lat"]),
            longitude=float(result["lon"]),
            matched_address=result.get("display_name", address),
            source="nominatim",
        )
    except Exception:
        return None


def extract_coords_from_config(config: dict) -> Optional[Tuple[float, float]]:
    """Try to extract lat/lon from an existing claim config."""
    # Check weather.noaa.query_coords
    noaa = config.get("weather", {}).get("noaa", {})
    coords = noaa.get("query_coords")
    if coords and len(coords) == 2:
        return (coords[0], coords[1])

    # Check property section
    prop = config.get("property", {})
    lat = prop.get("latitude")
    lon = prop.get("longitude")
    if lat and lon:
        return (float(lat), float(lon))

    return None


def build_address_from_config(config: dict) -> str:
    """Build a geocodable address string from claim config."""
    prop = config.get("property", {})
    parts = [
        prop.get("address", ""),
        prop.get("city", ""),
        prop.get("state", ""),
        prop.get("zip", ""),
    ]
    return ", ".join(p for p in parts if p)
