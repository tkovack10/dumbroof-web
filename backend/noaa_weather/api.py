"""
NOAA SWDI + SPC API client for storm data retrieval.
No API key required. No documented rate limits.

Primary: SWDI (Severe Weather Data Inventory) — NEXRAD hail + Local Storm Reports
Fallback: SPC Daily CSVs — for recent events when SWDI hasn't updated (75-90 day lag)
"""

import csv
import io
import json
import math
import urllib.request
import urllib.parse
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import List, Optional


@dataclass
class NOAAStormEvent:
    source: str           # "SWDI_PLSR" | "SWDI_NX3HAIL" | "SPC_DAILY"
    event_type: str       # "Hail" | "Thunderstorm Wind" | "Tornado"
    date: str             # ISO date
    time_utc: str         # Time in UTC (if available)
    latitude: float
    longitude: float
    distance_miles: float  # Distance from property
    magnitude: float       # Hail size (inches) or wind speed (mph)
    magnitude_type: str    # "hail_inches" | "wind_mph"
    narrative: str         # Event description (if available)
    source_detail: str     # "Trained Spotter" | "Law Enforcement" | etc.
    noaa_url: str          # Direct URL to verify the data

    def to_dict(self):
        return {
            "source": self.source,
            "event_type": self.event_type,
            "date": self.date,
            "time_utc": self.time_utc,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "distance_miles": round(self.distance_miles, 1),
            "magnitude": self.magnitude,
            "magnitude_type": self.magnitude_type,
            "narrative": self.narrative,
            "source_detail": self.source_detail,
            "noaa_url": self.noaa_url,
        }

    def to_summary(self):
        if self.magnitude_type == "hail_inches":
            return f'{self.magnitude}" hail @ {self.distance_miles:.1f} mi ({self.source_detail})'
        else:
            return f'{self.magnitude} mph wind @ {self.distance_miles:.1f} mi ({self.source_detail})'


@dataclass
class NOAAStormData:
    property_address: str
    property_coords: tuple  # (lat, lon)
    date_of_loss: str
    events: List[NOAAStormEvent] = field(default_factory=list)
    max_hail_inches: float = 0.0
    max_hail_distance_miles: float = 0.0
    max_wind_mph: float = 0.0
    event_count: int = 0
    search_radius_miles: float = 10.0
    query_urls: List[str] = field(default_factory=list)

    def to_dict(self):
        return {
            "query_date": datetime.now().strftime("%Y-%m-%d"),
            "query_coords": [self.property_coords[0], self.property_coords[1]],
            "search_radius_miles": self.search_radius_miles,
            "query_urls": self.query_urls,
            "max_hail_inches": self.max_hail_inches,
            "max_hail_distance_miles": self.max_hail_distance_miles,
            "max_wind_mph": self.max_wind_mph,
            "event_count": self.event_count,
            "events": [e.to_dict() for e in self.events],
        }

    def to_summary(self):
        lines = [
            f"NOAA Storm Data for {self.property_address}",
            f"Date of Loss: {self.date_of_loss}",
            f"Search: ±{self.search_radius_miles} mi of ({self.property_coords[0]:.4f}, {self.property_coords[1]:.4f})",
            f"Events found: {self.event_count}",
        ]
        if self.max_hail_inches > 0:
            lines.append(f'Max hail: {self.max_hail_inches}" diameter ({self.max_hail_distance_miles:.1f} mi from property)')
        if self.max_wind_mph > 0:
            lines.append(f"Max wind: {self.max_wind_mph} mph")
        if self.events:
            lines.append("\nEvents:")
            for e in self.events:
                lines.append(f"  - {e.to_summary()}")
        return "\n".join(lines)


def _haversine_miles(lat1, lon1, lat2, lon2):
    """Calculate distance between two coordinates in miles."""
    R = 3958.8  # Earth radius in miles
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def _fetch_url(url: str) -> str:
    """Fetch URL content with timeout and user agent."""
    req = urllib.request.Request(url, headers={
        "User-Agent": "USARM-Claims-Platform/1.0 (storm-damage-insurance-claims)",
        "Accept": "text/csv, application/json, */*",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _parse_date(date_str: str) -> datetime:
    """Parse various date formats to datetime."""
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(date_str.strip(), fmt)
        except ValueError:
            continue
    raise ValueError(f"Cannot parse date: {date_str}")


class NOAAClient:
    """Query NOAA SWDI and SPC for storm event data."""

    SWDI_BASE = "https://www.ncei.noaa.gov/swdiws"
    SPC_BASE = "https://www.spc.noaa.gov/climo/reports"

    def __init__(self, search_radius_deg: float = 0.05):
        """
        Args:
            search_radius_deg: Search radius in degrees (~0.05° ≈ 3.5 miles at mid-latitudes)
        """
        self.search_radius_deg = search_radius_deg
        self.search_radius_miles = search_radius_deg * 69.0  # Approximate

    def query(self, lat: float, lon: float, date_of_loss: str,
              address: str = "") -> NOAAStormData:
        """
        Query all NOAA sources for storm data near a property.

        Args:
            lat: Property latitude
            lon: Property longitude
            date_of_loss: Date string (various formats accepted)
            address: Property address for display
        """
        dol = _parse_date(date_of_loss)
        storm_data = NOAAStormData(
            property_address=address,
            property_coords=(lat, lon),
            date_of_loss=dol.strftime("%Y-%m-%d"),
            search_radius_miles=round(self.search_radius_miles, 1),
        )

        # Query SWDI sources — ±1 day window
        start = (dol - timedelta(days=1)).strftime("%Y%m%d")
        end = (dol + timedelta(days=1)).strftime("%Y%m%d")

        # Try SWDI first (PLSR + NX3HAIL)
        plsr_events = self._query_swdi_plsr(lat, lon, start, end, storm_data)
        hail_events = self._query_swdi_nx3hail(lat, lon, start, end, storm_data)

        # If SWDI returned nothing, try SPC daily reports (for recent events)
        spc_events = []
        if not plsr_events and not hail_events:
            spc_events = self._query_spc_daily(lat, lon, dol, storm_data)

        all_events = plsr_events + hail_events + spc_events

        # Filter by distance
        filtered = [e for e in all_events if e.distance_miles <= self.search_radius_miles]
        # Sort by distance
        filtered.sort(key=lambda e: e.distance_miles)

        storm_data.events = filtered
        storm_data.event_count = len(filtered)

        # Calculate maximums
        hail_events_only = [e for e in filtered if e.magnitude_type == "hail_inches"]
        wind_events_only = [e for e in filtered if e.magnitude_type == "wind_mph"]
        if hail_events_only:
            max_hail_event = max(hail_events_only, key=lambda e: e.magnitude)
            storm_data.max_hail_inches = max_hail_event.magnitude
            storm_data.max_hail_distance_miles = max_hail_event.distance_miles
        storm_data.max_wind_mph = max((e.magnitude for e in wind_events_only), default=0.0)

        return storm_data

    def _query_swdi_plsr(self, lat: float, lon: float, start: str, end: str,
                         storm_data: NOAAStormData) -> List[NOAAStormEvent]:
        """Query SWDI Preliminary Local Storm Reports."""
        # SWDI expects center=lon,lat (note: lon first)
        url = f"{self.SWDI_BASE}/csv/plsr/{start}:{end}?center={lon},{lat}"
        storm_data.query_urls.append(url)
        events = []

        try:
            content = _fetch_url(url)
            reader = csv.DictReader(io.StringIO(content))

            for row in reader:
                try:
                    evt_lat = float(row.get("LAT", row.get("lat", row.get("BEGIN_LAT", 0))))
                    evt_lon = float(row.get("LON", row.get("lon", row.get("BEGIN_LON", 0))))
                    dist = _haversine_miles(lat, lon, evt_lat, evt_lon)

                    # Parse event type and magnitude
                    event_type = row.get("EVENT_TYPE", row.get("event_type", "")).strip()
                    magnitude = 0.0
                    mag_type = "hail_inches"

                    # PLSR can have different field names
                    mag_str = row.get("MAGNITUDE", row.get("magnitude", row.get("MAG", "0")))
                    try:
                        magnitude = float(mag_str)
                    except (ValueError, TypeError):
                        magnitude = 0.0

                    if "hail" in event_type.lower():
                        mag_type = "hail_inches"
                    elif "wind" in event_type.lower() or "tstm" in event_type.lower():
                        mag_type = "wind_mph"
                        # Convert knots to mph if needed
                        units = row.get("MAGNITUDE_TYPE", row.get("magnitude_type", ""))
                        if "kt" in units.lower() or "knot" in units.lower():
                            magnitude = round(magnitude * 1.15078, 1)

                    evt_date = row.get("EVENT_DATE", row.get("BEGIN_DATE", row.get("date", "")))
                    evt_time = row.get("EVENT_TIME", row.get("BEGIN_TIME", row.get("time", "")))
                    narrative = row.get("NARRATIVE", row.get("narrative", row.get("REMARK", "")))
                    source_detail = row.get("SOURCE", row.get("source", "NWS Report"))

                    events.append(NOAAStormEvent(
                        source="SWDI_PLSR",
                        event_type="Hail" if mag_type == "hail_inches" else "Thunderstorm Wind",
                        date=evt_date.strip() if evt_date else "",
                        time_utc=evt_time.strip() if evt_time else "",
                        latitude=evt_lat,
                        longitude=evt_lon,
                        distance_miles=dist,
                        magnitude=magnitude,
                        magnitude_type=mag_type,
                        narrative=narrative.strip() if narrative else "",
                        source_detail=source_detail.strip() if source_detail else "",
                        noaa_url=url,
                    ))
                except (KeyError, ValueError):
                    continue

        except Exception as e:
            # SWDI may not have data — this is expected for recent events
            storm_data.query_urls[-1] += f" (error: {e})"

        return events

    def _query_swdi_nx3hail(self, lat: float, lon: float, start: str, end: str,
                            storm_data: NOAAStormData) -> List[NOAAStormEvent]:
        """Query SWDI NEXRAD Level-3 Hail signatures."""
        url = f"{self.SWDI_BASE}/csv/nx3hail/{start}:{end}?center={lon},{lat}"
        storm_data.query_urls.append(url)
        events = []

        try:
            content = _fetch_url(url)
            reader = csv.DictReader(io.StringIO(content))

            for row in reader:
                try:
                    # NX3HAIL uses WSR_ID, CELL_ID, etc.
                    evt_lat = float(row.get("LAT") or row.get("lat") or 0)
                    evt_lon = float(row.get("LON") or row.get("lon") or 0)
                    dist = _haversine_miles(lat, lon, evt_lat, evt_lon)

                    # MAXSIZE is max estimated hail size in inches
                    max_size = float(row.get("MAXSIZE") or row.get("maxsize") or 0)
                    prob = row.get("PROB") or row.get("prob") or ""
                    severity = row.get("SEVPROB") or row.get("sevprob") or ""

                    if max_size <= 0:
                        continue

                    ztime = row.get("ZTIME") or row.get("ztime") or ""
                    evt_date = ztime[:10] if ztime else ""
                    evt_time = ztime[11:] if len(ztime) > 11 else ""

                    detail_parts = []
                    if prob:
                        detail_parts.append(f"Prob: {prob}%")
                    if severity:
                        detail_parts.append(f"Severe Prob: {severity}%")

                    events.append(NOAAStormEvent(
                        source="SWDI_NX3HAIL",
                        event_type="Hail",
                        date=evt_date,
                        time_utc=evt_time,
                        latitude=evt_lat,
                        longitude=evt_lon,
                        distance_miles=dist,
                        magnitude=max_size,
                        magnitude_type="hail_inches",
                        narrative=f"NEXRAD radar hail signature — {', '.join(detail_parts)}" if detail_parts else "NEXRAD radar hail signature",
                        source_detail=f"NEXRAD {row.get('WSR_ID') or row.get('wsr_id') or ''}".strip(),
                        noaa_url=url,
                    ))
                except (KeyError, ValueError):
                    continue

        except Exception as e:
            storm_data.query_urls[-1] += f" (error: {e})"

        return events

    def _query_spc_daily(self, lat: float, lon: float, dol: datetime,
                         storm_data: NOAAStormData) -> List[NOAAStormEvent]:
        """Query SPC filtered daily storm reports (fallback for recent events)."""
        date_str = dol.strftime("%y%m%d")
        url = f"{self.SPC_BASE}/{date_str}_rpts_filtered_hail.csv"
        storm_data.query_urls.append(url)
        events = []

        try:
            content = _fetch_url(url)
            lines = content.strip().split("\n")
            if len(lines) < 2:
                return events

            # SPC CSVs: Time,Speed,Location,County,State,Lat,Lon,Comments
            # Hail CSV: Time,Size,Location,County,State,Lat,Lon,Comments
            reader = csv.reader(io.StringIO(content))
            header = next(reader, None)
            if not header:
                return events

            for row_vals in reader:
                try:
                    if len(row_vals) < 7:
                        continue
                    evt_time = row_vals[0].strip()
                    size_str = row_vals[1].strip()
                    location = row_vals[2].strip()
                    state = row_vals[4].strip()
                    evt_lat = float(row_vals[5])
                    evt_lon = float(row_vals[6])
                    comments = row_vals[7].strip() if len(row_vals) > 7 else ""

                    dist = _haversine_miles(lat, lon, evt_lat, evt_lon)

                    # SPC hail size is in hundredths of inches (e.g., 175 = 1.75")
                    size = float(size_str)
                    if size > 10:  # Likely in hundredths
                        size = size / 100.0

                    events.append(NOAAStormEvent(
                        source="SPC_DAILY",
                        event_type="Hail",
                        date=dol.strftime("%Y-%m-%d"),
                        time_utc=evt_time,
                        latitude=evt_lat,
                        longitude=evt_lon,
                        distance_miles=dist,
                        magnitude=size,
                        magnitude_type="hail_inches",
                        narrative=comments,
                        source_detail=f"SPC Report — {location}, {state}",
                        noaa_url=url,
                    ))
                except (ValueError, IndexError):
                    continue

        except Exception as e:
            storm_data.query_urls[-1] += f" (error: {e})"

        # Also try wind reports
        wind_url = f"{self.SPC_BASE}/{date_str}_rpts_filtered_wind.csv"
        storm_data.query_urls.append(wind_url)
        try:
            content = _fetch_url(wind_url)
            reader = csv.reader(io.StringIO(content))
            header = next(reader, None)

            for row_vals in reader:
                try:
                    if len(row_vals) < 7:
                        continue
                    evt_time = row_vals[0].strip()
                    speed_str = row_vals[1].strip()
                    location = row_vals[2].strip()
                    state = row_vals[4].strip()
                    evt_lat = float(row_vals[5])
                    evt_lon = float(row_vals[6])
                    comments = row_vals[7].strip() if len(row_vals) > 7 else ""

                    dist = _haversine_miles(lat, lon, evt_lat, evt_lon)
                    speed = float(speed_str) if speed_str else 0.0
                    # SPC wind speeds are in knots
                    speed_mph = round(speed * 1.15078, 1) if speed > 0 else 0.0

                    if speed_mph <= 0:
                        continue

                    events.append(NOAAStormEvent(
                        source="SPC_DAILY",
                        event_type="Thunderstorm Wind",
                        date=dol.strftime("%Y-%m-%d"),
                        time_utc=evt_time,
                        latitude=evt_lat,
                        longitude=evt_lon,
                        distance_miles=dist,
                        magnitude=speed_mph,
                        magnitude_type="wind_mph",
                        narrative=comments,
                        source_detail=f"SPC Report — {location}, {state}",
                        noaa_url=wind_url,
                    ))
                except (ValueError, IndexError):
                    continue

        except Exception:
            pass

        return events
