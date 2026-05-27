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

from qa_auditor import (  # noqa: E402
    _build_ground_truth,
    _gate_fabricated_weather_severity,
    _max_hail_inches_in_text,
    _max_wind_mph_in_text,
)


def _fw(found="", quote="", expected=""):
    return {"issue": "FABRICATED_WEATHER_EVENT", "found": found, "quote": quote, "expected": expected}


def test_magnitude_parsers():
    assert _max_hail_inches_in_text('three-inch hail stones') == 3.0
    assert _max_hail_inches_in_text('hail up to 1.75 inches') == 1.75
    assert _max_hail_inches_in_text('2" impact marks and 1.5 inch dents') == 2.0
    assert _max_hail_inches_in_text('no measurable hail') is None
    assert _max_wind_mph_in_text('gusts to 120 mph') == 120.0
    assert _max_wind_mph_in_text('high winds') is None


def test_gate_keeps_genuine_contradiction():
    """Prose 3in hail vs confirmed NOAA 1.0in max → stays CRITICAL."""
    gt = {"noaa_confirmed_hail": True, "noaa_max_hail_inches": 1.0, "noaa_max_wind_mph": 0}
    res = {"critical": [_fw(found="three-inch hail", quote="three-inch hail drove through the mat")], "medium": []}
    out = _gate_fabricated_weather_severity(res, gt)
    assert len(out["critical"]) == 1
    assert out["critical"][0]["issue"] == "FABRICATED_WEATHER_EVENT"


def test_gate_downgrades_within_max():
    """Prose 1.75in hail vs confirmed NOAA 2.0in max → NOT a contradiction → medium."""
    gt = {"noaa_confirmed_hail": True, "noaa_max_hail_inches": 2.0, "noaa_max_wind_mph": 60}
    res = {"critical": [_fw(found="1.75 inches", quote="hail stones up to 1.75 inches")], "medium": []}
    out = _gate_fabricated_weather_severity(res, gt)
    assert out["critical"] == []
    assert out["passed"] is True
    assert any(m["issue"] == "WEATHER_CLAIM_UNCORROBORATED" for m in out["medium"])


def test_gate_downgrades_absence():
    """Hail claim with empty NOAA (absence) → medium, never critical."""
    gt = {"noaa_confirmed_hail": False, "noaa_max_hail_inches": 0.0, "noaa_max_wind_mph": 0.0}
    res = {"critical": [_fw(found="combined hail and wind event")], "medium": []}
    out = _gate_fabricated_weather_severity(res, gt)
    assert out["critical"] == []
    assert out["recommendation"] == "ship"


def test_gate_preserves_nonweather_criticals():
    """A real ADDRESS_MISMATCH critical is never touched by the weather gate."""
    gt = {"noaa_confirmed_hail": False, "noaa_max_hail_inches": 0.0}
    res = {"critical": [
        {"issue": "ADDRESS_MISMATCH", "found": "10 Elm", "expected": "8 Elm"},
        _fw(found="hail event"),
    ], "medium": []}
    out = _gate_fabricated_weather_severity(res, gt)
    assert [c["issue"] for c in out["critical"]] == ["ADDRESS_MISMATCH"]
    assert out["passed"] is False  # address mismatch still blocks


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
