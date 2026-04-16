"""
NOAA Storm Events Database + SPC API client for storm data retrieval.
No API key required. No documented rate limits.

Primary: NOAA Storm Events Database (county-level verified reports) — AUTHORITATIVE
Fallback: SPC Daily CSVs — for recent events not yet in Storm Events DB (75-90 day lag)
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


# Full state FIPS → state name mapping (used by both _lookup_county_fips and Storm Events queries)
_STATE_NAMES = {
    "01": "ALABAMA", "02": "ALASKA", "04": "ARIZONA", "05": "ARKANSAS",
    "06": "CALIFORNIA", "08": "COLORADO", "09": "CONNECTICUT", "10": "DELAWARE",
    "11": "DISTRICT OF COLUMBIA", "12": "FLORIDA", "13": "GEORGIA", "15": "HAWAII",
    "16": "IDAHO", "17": "ILLINOIS", "18": "INDIANA", "19": "IOWA",
    "20": "KANSAS", "21": "KENTUCKY", "22": "LOUISIANA", "23": "MAINE",
    "24": "MARYLAND", "25": "MASSACHUSETTS", "26": "MICHIGAN", "27": "MINNESOTA",
    "28": "MISSISSIPPI", "29": "MISSOURI", "30": "MONTANA", "31": "NEBRASKA",
    "32": "NEVADA", "33": "NEW HAMPSHIRE", "34": "NEW JERSEY", "35": "NEW MEXICO",
    "36": "NEW YORK", "37": "NORTH CAROLINA", "38": "NORTH DAKOTA", "39": "OHIO",
    "40": "OKLAHOMA", "41": "OREGON", "42": "PENNSYLVANIA", "44": "RHODE ISLAND",
    "45": "SOUTH CAROLINA", "46": "SOUTH DAKOTA", "47": "TENNESSEE", "48": "TEXAS",
    "49": "UTAH", "50": "VERMONT", "51": "VIRGINIA", "53": "WASHINGTON",
    "54": "WEST VIRGINIA", "55": "WISCONSIN", "56": "WYOMING",
}


@dataclass
class NOAAStormEvent:
    source: str           # "STORM_EVENTS_DB" | "SPC_DAILY"
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
    episode_narrative: str = ""  # NWS storm description (from Storm Events DB)
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
            "episode_narrative": self.episode_narrative,
            "events": [e.to_dict() for e in self.events],
        }

    def to_summary(self):
        lines = [
            f"NOAA Storm Data for {self.property_address}",
            f"Date of Loss: {self.date_of_loss}",
            f"Events found: {self.event_count}",
        ]
        if self.max_hail_inches > 0:
            lines.append(f'Max hail near property: {self.max_hail_inches}" ({self.max_hail_distance_miles:.1f} mi)')
        if self.max_wind_mph > 0:
            lines.append(f"Max wind: {self.max_wind_mph} mph")
        if self.events:
            # Group by location to show surrounding towns
            locations = {}
            for e in self.events:
                loc = e.source_detail.replace("NOAA Storm Events — ", "").strip() or "Unknown"
                if loc not in locations:
                    locations[loc] = []
                locations[loc].append(e)
            lines.append(f"\nStorm reports across {len(locations)} locations:")
            for loc, evts in locations.items():
                hail_evts = [e for e in evts if e.magnitude_type == "hail_inches"]
                wind_evts = [e for e in evts if e.magnitude_type == "wind_mph"]
                parts = []
                if hail_evts:
                    max_h = max(e.magnitude for e in hail_evts)
                    parts.append(f'{max_h}" hail')
                if wind_evts:
                    max_w = max(e.magnitude for e in wind_evts)
                    parts.append(f"{max_w} mph wind")
                dist = min(e.distance_miles for e in evts)
                lines.append(f"  - {loc} ({dist:.1f} mi): {', '.join(parts)}")
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


def _lookup_county_fips(lat: float, lon: float) -> tuple:
    """Look up state FIPS, county FIPS, and county name from lat/lon using Census Bureau.
    Returns (state_fips, county_fips, county_name) or (None, None, None) on failure.
    """
    try:
        params = urllib.parse.urlencode({
            "x": lon, "y": lat,
            "benchmark": "Public_AR_Current",
            "vintage": "Current_Current",
            "format": "json",
        })
        url = f"https://geocoding.geo.census.gov/geocoder/geographies/coordinates?{params}"
        req = urllib.request.Request(url, headers={"User-Agent": "USARM-Claims-Platform/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())

        geos = data.get("result", {}).get("geographies", {})
        counties = geos.get("Counties", geos.get("2020 Census Counties", []))
        if not counties:
            return (None, None, None)

        county = counties[0]
        state_fips = county.get("STATE", "")
        county_fips = county.get("COUNTY", "")
        county_name = county.get("NAME", "").upper()

        return (state_fips, county_fips, county_name)
    except Exception as e:
        print(f"[NOAA] County FIPS lookup failed: {e}")
        return (None, None, None)


class NOAAClient:
    """Query NOAA Storm Events Database + SPC for storm event data."""

    STORM_EVENTS_BASE = "https://www.ncei.noaa.gov/stormevents"
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
        Query NOAA sources for storm data near a property.

        Priority:
        1. NOAA Storm Events Database (county-level verified reports) — AUTHORITATIVE
        2. SPC Daily Reports (fallback for recent events not yet in Storm Events DB)
        """
        dol = _parse_date(date_of_loss)
        storm_data = NOAAStormData(
            property_address=address,
            property_coords=(lat, lon),
            date_of_loss=dol.strftime("%Y-%m-%d"),
            search_radius_miles=round(self.search_radius_miles, 1),
        )

        # 1. Try NOAA Storm Events Database first (authoritative, county-level)
        state_fips, county_fips, county_name = _lookup_county_fips(lat, lon)
        storm_events = []
        if state_fips and county_fips:
            print(f"[NOAA] County lookup: {county_name} (state={state_fips}, county={county_fips})")
            storm_events = self._query_storm_events_db(
                lat, lon, dol, state_fips, county_fips, county_name, storm_data
            )
        else:
            print(f"[NOAA] County FIPS lookup failed for ({lat}, {lon})")

        # 2. If Storm Events DB returned nothing, try SPC daily (recent events)
        spc_events = []
        if not storm_events:
            print("[NOAA] Storm Events DB returned nothing — trying SPC daily")
            spc_events = self._query_spc_daily(lat, lon, dol, storm_data)

        all_events = storm_events + spc_events

        # Keep ALL county-level events (surrounding towns show storm significance)
        # but sort by distance so nearest events are first
        all_events.sort(key=lambda e: e.distance_miles)

        storm_data.events = all_events
        storm_data.event_count = len(all_events)

        # Calculate max hail from nearest events (prefer within tight radius, fallback to nearest)
        all_hail = [e for e in all_events if e.magnitude_type == "hail_inches" and e.magnitude > 0]
        all_wind = [e for e in all_events if e.magnitude_type == "wind_mph"]

        if all_hail:
            # Use nearest hail event for max (closest to property = most relevant)
            local_hail = [e for e in all_hail if e.distance_miles <= self.search_radius_miles]
            if local_hail:
                max_hail_event = max(local_hail, key=lambda e: e.magnitude)
            else:
                max_hail_event = min(all_hail, key=lambda e: e.distance_miles)
            storm_data.max_hail_inches = max_hail_event.magnitude
            storm_data.max_hail_distance_miles = max_hail_event.distance_miles
            print(f"[NOAA] Hail: {len(all_hail)} reports, max near property: "
                  f'{max_hail_event.magnitude}" at {max_hail_event.distance_miles:.1f} mi')
        storm_data.max_wind_mph = max((e.magnitude for e in all_wind), default=0.0)

        return storm_data

    # Distance threshold (miles) for the state-wide fallback query. Adjacent
    # counties are typically 15-40 mi away; storms straddle county lines so we
    # cast a wide net but exclude the other end of the state.
    _STATEWIDE_FALLBACK_RADIUS_MI = 50.0

    def _query_storm_events_db(self, lat: float, lon: float, dol: datetime,
                                state_fips: str, county_fips: str, county_name: str,
                                storm_data: NOAAStormData) -> List[NOAAStormEvent]:
        """Query NOAA Storm Events Database — authoritative verified reports.
        Same data source as https://www.ncei.noaa.gov/stormevents/
        Filters: county, date range, event type (hail + thunderstorm wind).

        If the target county has zero events (common for storm tracks that
        graze one county and hit the next — e.g. Laura, OH [Miami County]
        missed a 59mph event 22 mi south in Vandalia [Montgomery County]),
        falls back to a state-wide query filtered by haversine distance
        (<= _STATEWIDE_FALLBACK_RADIUS_MI from the property).
        """
        state_name = _STATE_NAMES.get(state_fips, "")
        if not state_name:
            print(f"[NOAA] Unknown state FIPS: {state_fips}")
            return []

        start = dol - timedelta(days=2)
        end = dol + timedelta(days=2)
        common_params = {
            "beginDate_mm": f"{start.month:02d}",
            "beginDate_dd": f"{start.day:02d}",
            "beginDate_yyyy": str(start.year),
            "endDate_mm": f"{end.month:02d}",
            "endDate_dd": f"{end.day:02d}",
            "endDate_yyyy": str(end.year),
            "hailfilter": "0.00",
            "tornfilter": "0",
            "windfilter": "000",
            "sort": "DT",
            "submitbutton": "Search",
            "statefips": f"{state_fips},{state_name.replace(' ', '+')}",
        }
        county_clean = county_name.replace(" COUNTY", "").replace(" PARISH", "")
        county_fips_short = county_fips.lstrip("0") or "0"

        county_params = dict(common_params)
        county_params["county"] = f"{county_clean}:{county_fips_short}"
        events = self._fetch_storm_events(lat, lon, county_params, storm_data, max_distance_mi=None)

        # Fallback: widen to state-wide with distance filter when county is empty.
        # This catches storm tracks that deposited damage in adjacent counties.
        if not events:
            print(f"[NOAA] {county_clean} county query empty — widening to statewide within {self._STATEWIDE_FALLBACK_RADIUS_MI:.0f} mi")
            events = self._fetch_storm_events(
                lat, lon, common_params, storm_data,
                max_distance_mi=self._STATEWIDE_FALLBACK_RADIUS_MI,
            )

        hail_count = sum(1 for e in events if e.magnitude_type == "hail_inches")
        wind_count = sum(1 for e in events if e.magnitude_type == "wind_mph")
        print(f"[NOAA] Storm Events DB: {len(events)} events ({hail_count} hail, {wind_count} wind)")
        return events

    def _fetch_storm_events(self, lat: float, lon: float, base_params: dict,
                             storm_data: NOAAStormData,
                             max_distance_mi: Optional[float] = None) -> List[NOAAStormEvent]:
        """Fetch & parse one Storm Events CSV query. Filters rows by distance
        when max_distance_mi is supplied (statewide fallback)."""
        query_parts = []
        for k, v in base_params.items():
            query_parts.append(f"{k}={urllib.parse.quote(str(v), safe='+:')}")
        for evt_type in ["(C) Hail", "(C) Thunderstorm Wind"]:
            query_parts.append(f"eventType={urllib.parse.quote(evt_type, safe='+')}")
        url = f"{self.STORM_EVENTS_BASE}/csv?{'&'.join(query_parts)}"
        storm_data.query_urls.append(url)
        print(f"[NOAA] Storm Events URL: {url}")

        all_events: List[NOAAStormEvent] = []
        try:
            content = _fetch_url(url)
            if not content:
                print("[NOAA] Storm Events: empty response")
                return all_events
            first_line = content.split("\n")[0] if content else ""
            if "EVENT_ID" not in first_line:
                print(f"[NOAA] Storm Events response not CSV. First 200 chars: {content[:200]}")
                return all_events
            reader = csv.DictReader(io.StringIO(content))
            rows = list(reader)
            if not rows:
                print("[NOAA] CSV parsed but 0 data rows")
                return all_events
            print(f"[NOAA] CSV: {len(rows)} rows")
            for row in rows:
                try:
                    evt_lat = float(row.get("BEGIN_LAT") or 0)
                    evt_lon = float(row.get("BEGIN_LON") or 0)
                    if evt_lat == 0 or evt_lon == 0:
                        continue
                    dist = _haversine_miles(lat, lon, evt_lat, evt_lon)
                    if max_distance_mi is not None and dist > max_distance_mi:
                        continue
                    event_type = row.get("EVENT_TYPE", "").strip()
                    mag = float(row.get("MAGNITUDE") or 0)
                    if "hail" in event_type.lower():
                        mag_type = "hail_inches"
                    elif "wind" in event_type.lower():
                        mag_type = "wind_mph"
                    else:
                        continue
                    evt_date = row.get("BEGIN_DATE", row.get("BEGIN_DATE_TIME", "")).strip()
                    evt_time = row.get("BEGIN_TIME", "").strip()
                    narrative = row.get("EVENT_NARRATIVE", "").strip()
                    location = row.get("BEGIN_LOCATION", row.get("CZ_NAME", "")).strip()
                    ep_narr = row.get("EPISODE_NARRATIVE", "").strip()
                    if ep_narr and not storm_data.episode_narrative:
                        storm_data.episode_narrative = ep_narr.replace("||", " ")
                    all_events.append(NOAAStormEvent(
                        source="STORM_EVENTS_DB",
                        event_type=event_type,
                        date=evt_date,
                        time_utc=evt_time,
                        latitude=evt_lat,
                        longitude=evt_lon,
                        distance_miles=dist,
                        magnitude=mag,
                        magnitude_type=mag_type,
                        narrative=narrative,
                        source_detail=f"NOAA Storm Events — {location}",
                        noaa_url=url,
                    ))
                except (KeyError, ValueError) as e:
                    print(f"[NOAA] Row parse error: {e}")
                    continue
        except Exception as e:
            print(f"[NOAA] Storm Events DB error: {e}")
            storm_data.query_urls[-1] += f" (error: {e})"
        return all_events

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
                    if dist > 50.0:  # SPC is nationwide — only keep within 50 miles
                        continue

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
                    if dist > 50.0:  # SPC is nationwide — only keep within 50 miles
                        continue
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
