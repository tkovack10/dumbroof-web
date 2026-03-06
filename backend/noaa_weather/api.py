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
    # State FIPS → state name mapping for NOAA URL
    _STATE_NAMES = {
        "36": "NEW YORK", "42": "PENNSYLVANIA", "34": "NEW JERSEY",
        "09": "CONNECTICUT", "25": "MASSACHUSETTS", "44": "RHODE ISLAND",
        "50": "VERMONT", "33": "NEW HAMPSHIRE", "23": "MAINE",
        "10": "DELAWARE", "24": "MARYLAND", "51": "VIRGINIA",
        "11": "DISTRICT OF COLUMBIA", "37": "NORTH CAROLINA", "45": "SOUTH CAROLINA",
        "13": "GEORGIA", "12": "FLORIDA", "01": "ALABAMA", "28": "MISSISSIPPI",
        "22": "LOUISIANA", "48": "TEXAS", "40": "OKLAHOMA", "05": "ARKANSAS",
        "47": "TENNESSEE", "21": "KENTUCKY", "54": "WEST VIRGINIA", "39": "OHIO",
        "18": "INDIANA", "17": "ILLINOIS", "55": "WISCONSIN", "26": "MICHIGAN",
        "27": "MINNESOTA", "19": "IOWA", "29": "MISSOURI", "20": "KANSAS",
        "31": "NEBRASKA", "46": "SOUTH DAKOTA", "38": "NORTH DAKOTA",
        "30": "MONTANA", "56": "WYOMING", "08": "COLORADO", "35": "NEW MEXICO",
        "04": "ARIZONA", "49": "UTAH", "32": "NEVADA", "06": "CALIFORNIA",
        "41": "OREGON", "53": "WASHINGTON", "16": "IDAHO",
    }
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

        Priority order:
        1. NOAA Storm Events Database (county-level verified reports) — AUTHORITATIVE
        2. SPC Daily Reports (for very recent events not yet in Storm Events DB)
        3. SWDI PLSR (fallback only if Storm Events + SPC return nothing)

        NX3HAIL (NEXRAD radar) is excluded — radar estimates consistently overstate hail size.
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

        # Calculate max hail ONLY from events within tight radius (local to property)
        local_hail = [e for e in all_events
                      if e.magnitude_type == "hail_inches" and e.distance_miles <= self.search_radius_miles]
        all_wind = [e for e in all_events if e.magnitude_type == "wind_mph"]

        if local_hail:
            max_hail_event = max(local_hail, key=lambda e: e.magnitude)
            storm_data.max_hail_inches = max_hail_event.magnitude
            storm_data.max_hail_distance_miles = max_hail_event.distance_miles
        elif all_events:
            # If no local hail, use nearest hail event but flag distance
            all_hail = [e for e in all_events if e.magnitude_type == "hail_inches"]
            if all_hail:
                nearest = min(all_hail, key=lambda e: e.distance_miles)
                storm_data.max_hail_inches = nearest.magnitude
                storm_data.max_hail_distance_miles = nearest.distance_miles
        storm_data.max_wind_mph = max((e.magnitude for e in all_wind), default=0.0)

        return storm_data

    def _query_storm_events_db(self, lat: float, lon: float, dol: datetime,
                                state_fips: str, county_fips: str, county_name: str,
                                storm_data: NOAAStormData) -> List[NOAAStormEvent]:
        """Query NOAA Storm Events Database — authoritative verified reports.
        Same data source as https://www.ncei.noaa.gov/stormevents/
        """
        # State FIPS → state name for URL
        _STATE_NAMES = {
            "36": "NEW YORK", "42": "PENNSYLVANIA", "34": "NEW JERSEY",
            "09": "CONNECTICUT", "25": "MASSACHUSETTS", "12": "FLORIDA",
            "13": "GEORGIA", "48": "TEXAS", "17": "ILLINOIS", "39": "OHIO",
            "06": "CALIFORNIA", "37": "NORTH CAROLINA", "51": "VIRGINIA",
        }
        state_name = _STATE_NAMES.get(state_fips, "")
        if not state_name:
            return []

        # Search ±2 days around DOL
        start = dol - timedelta(days=2)
        end = dol + timedelta(days=2)

        params = {
            "eventType": "(C) Hail",
            "beginDate_mm": f"{start.month:02d}",
            "beginDate_dd": f"{start.day:02d}",
            "beginDate_yyyy": str(start.year),
            "endDate_mm": f"{end.month:02d}",
            "endDate_dd": f"{end.day:02d}",
            "endDate_yyyy": str(end.year),
            "county": f"{county_name.replace(' COUNTY', '').replace(' PARISH', '')}:{county_fips.lstrip('0') or '0'}",
            "hailfilter": "0.00",
            "tornfilter": "0",
            "windfilter": "000",
            "sort": "DT",
            "submitbutton": "Search",
            "statefips": f"{state_fips},{state_name.replace(' ', '+')}",
        }

        # Also query wind events
        event_types = ["(C) Hail", "(Z) High Wind", "(C) Thunderstorm Wind"]
        all_events = []

        for evt_type in event_types:
            params["eventType"] = evt_type
            query_str = "&".join(f"{k}={urllib.parse.quote(str(v), safe='+:')}" for k, v in params.items())
            url = f"{self.STORM_EVENTS_BASE}/csv?{query_str}"
            storm_data.query_urls.append(url)

            try:
                content = _fetch_url(url)
                if not content or "EVENT_ID" not in content[:500]:
                    print(f"[NOAA] Storm Events response not CSV for {evt_type}: {content[:100] if content else 'empty'}")
                    continue

                reader = csv.DictReader(io.StringIO(content))
                for row in reader:
                    try:
                        evt_lat = float(row.get("BEGIN_LAT") or 0)
                        evt_lon = float(row.get("BEGIN_LON") or 0)
                        if evt_lat == 0 or evt_lon == 0:
                            continue

                        dist = _haversine_miles(lat, lon, evt_lat, evt_lon)

                        event_type = row.get("EVENT_TYPE", "").strip()
                        mag = float(row.get("MAGNITUDE") or 0)
                        mag_type_raw = row.get("MAGNITUDE_TYPE", "").strip()

                        if "hail" in event_type.lower():
                            mag_type = "hail_inches"
                        elif "wind" in event_type.lower():
                            mag_type = "wind_mph"
                            if "kt" in mag_type_raw.lower():
                                mag = round(mag * 1.15078, 1)
                        else:
                            continue

                        evt_date = row.get("BEGIN_DATE", "").strip()
                        evt_time = row.get("BEGIN_TIME", "").strip()
                        narrative = row.get("EVENT_NARRATIVE", "").strip()
                        location = row.get("BEGIN_LOCATION", "").strip()

                        # Capture episode narrative (storm-wide description from NWS)
                        ep_narr = row.get("EPISODE_NARRATIVE", "").strip()
                        if ep_narr and not storm_data.episode_narrative:
                            # Clean up double-pipe separators
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
                    except (KeyError, ValueError):
                        continue

            except Exception as e:
                storm_data.query_urls[-1] += f" (error: {e})"

        if all_events:
            print(f"[NOAA] Storm Events DB: {len(all_events)} events in {county_name} county")
        return all_events

    def _query_swdi_plsr(self, lat: float, lon: float, start: str, end: str,
                         storm_data: NOAAStormData) -> List[NOAAStormEvent]:
        """Query SWDI Preliminary Local Storm Reports (fallback only)."""
        # SWDI expects ext=minlon,minlat,maxlon,maxlat bounding box
        r = self.search_radius_deg
        url = f"{self.SWDI_BASE}/csv/plsr/{start}:{end}?ext={lon-r},{lat-r},{lon+r},{lat+r}"
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
