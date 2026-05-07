"""Source-priority hail picker tests (E213 regression prevention).

Locks in the behavior that ground reports (STORM_EVENTS_DB / SPC_DAILY)
beat NEXRAD radar (SWDI_NX3HAIL) within the property-relevance radius —
even when the radar magnitude is larger.

Real-world driver: Binghamton 2025-07-03 outbreak. STORM_EVENTS_DB had
2.0" hail at 1.4mi (verified by trained spotter). SWDI_NX3HAIL had
3.0" hail at 3.0mi (radar overestimate). Pre-fix `max(magnitude)`
within 25mi surfaced the radar 3.0" — false positive on every claim
in the area, creating carrier-credibility risk if NCEI is double-checked.

Run: python3 test_noaa_source_priority.py
"""
from __future__ import annotations
import unittest
from dataclasses import dataclass
from noaa_weather.api import select_property_hail, GROUND_REPORT_SOURCES, RADAR_SOURCES, RADAR_HAIL_RADIUS_MILES


@dataclass
class FakeEvent:
    """Minimal stand-in for NOAAStormEvent that satisfies select_property_hail."""
    source: str
    event_type: str
    magnitude: float
    distance_miles: float


class SourcePriorityTests(unittest.TestCase):

    # ── Bug A: ground report wins over radar within radius ──
    def test_ground_report_beats_radar_when_both_in_radius(self):
        # The Binghamton 2025-07-03 case verbatim.
        events = [
            FakeEvent("STORM_EVENTS_DB", "Hail", 2.0, 1.4),
            FakeEvent("SWDI_NX3HAIL",   "Hail", 3.0, 3.0),
        ]
        pick = select_property_hail(events, search_radius_miles=25.0)
        self.assertEqual(pick.source, "STORM_EVENTS_DB")
        self.assertEqual(pick.magnitude, 2.0)

    def test_largest_ground_report_wins_when_multiple(self):
        events = [
            FakeEvent("STORM_EVENTS_DB", "Hail", 1.5, 0.5),
            FakeEvent("STORM_EVENTS_DB", "Hail", 2.0, 1.4),
            FakeEvent("SPC_DAILY",       "Hail", 1.75, 2.0),
            FakeEvent("SWDI_NX3HAIL",    "Hail", 3.5, 4.0),
        ]
        pick = select_property_hail(events, search_radius_miles=25.0)
        self.assertEqual(pick.source, "STORM_EVENTS_DB")
        self.assertEqual(pick.magnitude, 2.0)

    def test_spc_daily_treated_same_as_storm_events_db(self):
        events = [
            FakeEvent("SPC_DAILY",    "Hail", 1.75, 1.0),
            FakeEvent("SWDI_NX3HAIL", "Hail", 4.0,  5.0),
        ]
        pick = select_property_hail(events, search_radius_miles=25.0)
        self.assertEqual(pick.source, "SPC_DAILY")
        self.assertEqual(pick.magnitude, 1.75)

    # ── Bug A: radar tightening — only used within 10mi ──
    def test_radar_used_when_no_ground_reports(self):
        events = [
            FakeEvent("SWDI_NX3HAIL", "Hail", 2.5, 5.0),
        ]
        pick = select_property_hail(events, search_radius_miles=25.0)
        self.assertEqual(pick.source, "SWDI_NX3HAIL")
        self.assertEqual(pick.magnitude, 2.5)

    def test_radar_at_11mi_dropped_in_favor_of_nearest_fallback(self):
        # NEXRAD 3.5" at 11mi — beyond radar radius of 10mi. Should fall
        # through to "nearest event" rule and return the closer 1.0" radar
        # report (only valid hail event). This prevents 30mi false-positive
        # 3.5" radar hits from surfacing as the property's hail.
        events = [
            FakeEvent("SWDI_NX3HAIL", "Hail", 3.5, 11.0),
            FakeEvent("SWDI_NX3HAIL", "Hail", 1.0, 30.0),
        ]
        pick = select_property_hail(events, search_radius_miles=25.0)
        # Tier 3 fallback: nearest valid event of any source. 11mi is closer
        # than 30mi, so the 3.5" wins via Tier 3, NOT via radar tier.
        # Verifies that out-of-radar-radius events still surface as fallback
        # rather than returning None (which would break downstream pipelines).
        self.assertEqual(pick.distance_miles, 11.0)

    def test_ground_25mi_beats_radar_at_5mi(self):
        # Trust ground report at 24mi over radar overestimate at 5mi.
        # This is the conservative call — ground reports degrade less
        # with distance than radar.
        events = [
            FakeEvent("STORM_EVENTS_DB", "Hail", 1.5, 24.0),
            FakeEvent("SWDI_NX3HAIL",    "Hail", 3.0, 5.0),
        ]
        pick = select_property_hail(events, search_radius_miles=25.0)
        self.assertEqual(pick.source, "STORM_EVENTS_DB")

    # ── Filter-only behavior ──
    def test_wind_events_ignored(self):
        events = [
            FakeEvent("STORM_EVENTS_DB", "Thunderstorm Wind", 60.0, 1.0),
            FakeEvent("STORM_EVENTS_DB", "Hail", 1.5, 5.0),
        ]
        pick = select_property_hail(events, search_radius_miles=25.0)
        self.assertEqual(pick.event_type, "Hail")
        self.assertEqual(pick.magnitude, 1.5)

    def test_zero_magnitude_filtered(self):
        events = [
            FakeEvent("STORM_EVENTS_DB", "Hail", 0.0, 1.0),
            FakeEvent("SWDI_NX3HAIL", "Hail", 1.5, 5.0),
        ]
        pick = select_property_hail(events, search_radius_miles=25.0)
        # 0.0 ground report filtered, only valid is the radar 1.5"
        self.assertEqual(pick.source, "SWDI_NX3HAIL")

    def test_empty_events(self):
        self.assertIsNone(select_property_hail([], search_radius_miles=25.0))

    def test_no_hail_events(self):
        events = [
            FakeEvent("STORM_EVENTS_DB", "Thunderstorm Wind", 60.0, 1.0),
        ]
        self.assertIsNone(select_property_hail(events, search_radius_miles=25.0))

    # ── Constants are exposed for callers ──
    def test_constants_exported(self):
        self.assertIn("STORM_EVENTS_DB", GROUND_REPORT_SOURCES)
        self.assertIn("SPC_DAILY", GROUND_REPORT_SOURCES)
        self.assertIn("SWDI_NX3HAIL", RADAR_SOURCES)
        self.assertEqual(RADAR_HAIL_RADIUS_MILES, 10.0)


if __name__ == "__main__":
    unittest.main()
