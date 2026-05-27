#!/usr/bin/env python3
"""QA auditor weather ground-truth regression.

Guards the FABRICATED_WEATHER_EVENT false-positive class fixed 2026-05-27:
`_build_ground_truth` used to omit all NOAA weather facts, so the prose audit
was told the ground truth had no hail/wind and flagged EVERY hail statement as
fabricated (Binghamton claim 6fab2acd: NOAA had max_hail_inches=2.0 + 229 hail
events, yet the report was flagged). The ground truth must surface the same NOAA
evidence the report generator and the deterministic check (qa_pdf_checks) read.

Runs with pytest if available, else as a plain script:
    python3 backend/tests/test_qa_auditor_weather.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from qa_auditor import _build_ground_truth  # noqa: E402


def test_noaa_facts_from_config_weather_noaa():
    """Confirmed hail in config["weather"]["noaa"] surfaces into ground truth."""
    config = {
        "weather": {
            "storm_date": "2025-07-03",
            "noaa": {"max_hail_inches": 2.0, "max_wind_mph": 60.0, "event_count": 248},
        }
    }
    gt = _build_ground_truth(config, {})
    assert gt["noaa_max_hail_inches"] == 2.0
    assert gt["noaa_max_wind_mph"] == 60.0
    assert gt["noaa_event_count"] == 248
    assert gt["noaa_confirmed_hail"] is True
    assert gt["noaa_confirmed_wind"] is True


def test_noaa_facts_fall_back_to_claim_weather_data():
    """When config has no noaa block, the persisted claims.weather_data is used."""
    config = {"weather": {}}
    claim = {"weather_data": {"max_hail_inches": 1.75, "max_wind_mph": 0, "event_count": 12}}
    gt = _build_ground_truth(config, claim)
    assert gt["noaa_max_hail_inches"] == 1.75
    assert gt["noaa_confirmed_hail"] is True
    # No wind in the data → wind not confirmed (legitimate fabrication guard stays).
    assert gt["noaa_confirmed_wind"] is False


def test_no_weather_yields_unconfirmed():
    """No NOAA data anywhere → confirmed flags False (real fabrication still catchable)."""
    gt = _build_ground_truth({"weather": {}}, {})
    assert gt["noaa_confirmed_hail"] is False
    assert gt["noaa_confirmed_wind"] is False
    assert gt["noaa_event_count"] == 0


def test_malformed_noaa_values_do_not_crash():
    """Garbage numeric strings degrade to 0 instead of raising."""
    config = {"weather": {"noaa": {"max_hail_inches": "", "max_wind_mph": None, "event_count": "x"}}}
    gt = _build_ground_truth(config, {})
    assert gt["noaa_max_hail_inches"] == 0.0
    assert gt["noaa_max_wind_mph"] == 0.0
    assert gt["noaa_event_count"] == 0
    assert gt["noaa_confirmed_hail"] is False


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except AssertionError as e:
                failures += 1
                print(f"FAIL {name}: {e}")
    sys.exit(1 if failures else 0)
