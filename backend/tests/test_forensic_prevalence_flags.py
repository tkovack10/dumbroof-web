#!/usr/bin/env python3
"""WS-0 — unit tests for compute_forensic_prevalence_flags (qa_auditor.py).

These are MEDIUM-only detection flags. The tests assert:
  * each flag fires on a genuine defect,
  * each flag stays silent on a clean config,
  * EVERY emitted flag is severity == 'medium' (the layer can never block),
  * the documented edge rules: hail uses events[].magnitude gated on
    magnitude_type == 'hail_inches' (NOT a non-existent hail_size field), and
    WIND_GE_150 is scoped to 'mph' so it never matches 'N miles'.

Self-contained — NO pytest. Plain asserts + __main__.
    python3 backend/tests/test_forensic_prevalence_flags.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from qa_auditor import compute_forensic_prevalence_flags  # noqa: E402


def _issues(config, claim=None):
    flags = compute_forensic_prevalence_flags(config, claim or {})
    # Invariant: the layer is MEDIUM-only and can never block.
    for f in flags:
        assert f.get("severity") == "medium", f"non-medium flag leaked: {f}"
    return {f["issue"] for f in flags}


# -------------------------------------------------------------------------
# WRONG_STATE_CODE_LEAK
# -------------------------------------------------------------------------

def test_state_code_leak_fires_on_foreign_prefix():
    cfg = {
        "property": {"state": "SC"},
        "forensic_findings": {
            "code_violations": [
                {"code": "FBC-R R905.2.2", "requirement": "x", "status": "violated"}
            ]
        },
    }
    assert "WRONG_STATE_CODE_LEAK" in _issues(cfg)


def test_state_code_leak_silent_on_own_prefix():
    cfg = {
        "property": {"state": "SC"},
        "forensic_findings": {
            "code_violations": [
                {"code": "SCRC R905.2.2", "requirement": "x", "status": "violated"}
            ]
        },
    }
    assert "WRONG_STATE_CODE_LEAK" not in _issues(cfg)


def test_state_code_leak_scans_key_arguments_superset():
    # Leak hiding in key_arguments, not code_violations — superset must catch it.
    cfg = {
        "property": {"state": "NY"},
        "forensic_findings": {
            "key_arguments": ["Per RCO R905.2.8.5 the flashing must be replaced."]
        },
    }
    assert "WRONG_STATE_CODE_LEAK" in _issues(cfg)  # RCO is Ohio, property is NY


def test_state_code_leak_no_state_no_flag():
    cfg = {"property": {}, "forensic_findings": {"key_arguments": ["RCO R905"]}}
    assert "WRONG_STATE_CODE_LEAK" not in _issues(cfg)


# -------------------------------------------------------------------------
# ZERO_SF_ROOF_WITH_MEASUREMENT
# -------------------------------------------------------------------------

def test_zero_sf_with_facets_fires():
    cfg = {
        "property": {"state": "NY"},
        "structures": [{"roof_area_sf": None}],
        "roof_facets": [{"area": 100}],
    }
    assert "ZERO_SF_ROOF_WITH_MEASUREMENT" in _issues(cfg)


def test_zero_sf_with_measurement_files_on_claim_fires():
    cfg = {"property": {"state": "NY"}, "structures": [{"roof_area_sf": 0}]}
    claim = {"measurement_files": ["eagleview.pdf"]}
    assert "ZERO_SF_ROOF_WITH_MEASUREMENT" in _issues(cfg, claim)


def test_nonzero_sf_no_flag():
    cfg = {
        "property": {"state": "NY"},
        "structures": [{"roof_area_sf": 2762}],
        "roof_facets": [{"area": 100}],
    }
    assert "ZERO_SF_ROOF_WITH_MEASUREMENT" not in _issues(cfg)


def test_zero_sf_without_measurement_signal_no_flag():
    cfg = {"property": {"state": "NY"}, "structures": [{"roof_area_sf": None}]}
    assert "ZERO_SF_ROOF_WITH_MEASUREMENT" not in _issues(cfg)


# -------------------------------------------------------------------------
# THRESHOLD_HAIL_EXCEEDS_EVENTS
# -------------------------------------------------------------------------

def test_threshold_hail_exceeds_events_fires():
    cfg = {
        "property": {"state": "MO"},
        "weather": {"noaa": {
            "max_hail_inches": 4.5,
            "events": [
                {"magnitude": 2.0, "magnitude_type": "hail_inches"},
                {"magnitude": 2.5, "magnitude_type": "hail_inches"},
            ],
        }},
    }
    assert "THRESHOLD_HAIL_EXCEEDS_EVENTS" in _issues(cfg)


def test_threshold_hail_within_events_no_flag():
    cfg = {
        "property": {"state": "MO"},
        "weather": {"noaa": {
            "max_hail_inches": 2.0,
            "events": [
                {"magnitude": 2.0, "magnitude_type": "hail_inches"},
                {"magnitude": 2.5, "magnitude_type": "hail_inches"},
            ],
        }},
    }
    assert "THRESHOLD_HAIL_EXCEEDS_EVENTS" not in _issues(cfg)


def test_threshold_hail_ignores_hail_size_field():
    # hail_size does NOT exist in the schema; only magnitude+magnitude_type count.
    # Here the only per-event hail magnitude is 1.0, so 3.0 max exceeds it.
    cfg = {
        "property": {"state": "MO"},
        "weather": {"noaa": {
            "max_hail_inches": 3.0,
            "events": [
                {"hail_size": 3.0, "magnitude": 1.0, "magnitude_type": "hail_inches"},
                {"magnitude": 70.0, "magnitude_type": "wind_mph"},  # wind ignored
            ],
        }},
    }
    assert "THRESHOLD_HAIL_EXCEEDS_EVENTS" in _issues(cfg)


def test_threshold_hail_no_events_no_flag():
    cfg = {
        "property": {"state": "MO"},
        "weather": {"noaa": {"max_hail_inches": 3.0, "events": []}},
    }
    assert "THRESHOLD_HAIL_EXCEEDS_EVENTS" not in _issues(cfg)


# -------------------------------------------------------------------------
# WIND_GE_150
# -------------------------------------------------------------------------

def test_wind_ge_150_from_noaa_fires():
    cfg = {"property": {"state": "OK"}, "weather": {"noaa": {"max_wind_mph": 165}}}
    assert "WIND_GE_150" in _issues(cfg)


def test_wind_ge_150_from_narrative_fires():
    cfg = {
        "property": {"state": "OK"},
        "weather": {"noaa": {"max_wind_mph": 60}},
        "forensic_findings": {"executive_summary": ["Recorded gusts reached 152 mph."]},
    }
    assert "WIND_GE_150" in _issues(cfg)


def test_wind_below_150_no_flag():
    cfg = {"property": {"state": "OK"}, "weather": {"noaa": {"max_wind_mph": 102.4}}}
    assert "WIND_GE_150" not in _issues(cfg)


def test_wind_does_not_match_miles():
    # '200 miles' must NOT trip the mph-scoped wind regex.
    cfg = {
        "property": {"state": "OK"},
        "weather": {"noaa": {"max_wind_mph": 60}},
        "forensic_findings": {
            "conclusion_paragraphs": ["The storm front spanned 200 miles of coastline."]
        },
    }
    assert "WIND_GE_150" not in _issues(cfg)


# -------------------------------------------------------------------------
# Global invariants
# -------------------------------------------------------------------------

def test_clean_config_no_flags():
    cfg = {
        "property": {"state": "NY"},
        "structures": [{"roof_area_sf": 2762}],
        "weather": {"noaa": {
            "max_hail_inches": 2.0,
            "max_wind_mph": 60,
            "events": [{"magnitude": 2.0, "magnitude_type": "hail_inches"}],
        }},
        "forensic_findings": {
            "executive_summary": ["Per RCNYS R905.2.2 the roof requires replacement."],
            "conclusion_paragraphs": ["Confirmed hail damage."],
        },
    }
    assert _issues(cfg) == set()


def test_never_critical_and_handles_garbage():
    # Bad input must not raise and must not produce any non-medium flag.
    for bad in (None, "x", 5, {"property": "NY"}, {"structures": "x"}):
        flags = compute_forensic_prevalence_flags(bad, {})
        assert isinstance(flags, list)
        for f in flags:
            assert f.get("severity") == "medium"


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
            except Exception as e:  # noqa: BLE001
                failures += 1
                print(f"ERROR {name}: {type(e).__name__}: {e}")
    print(f"\n{'OK' if not failures else 'FAILURES: ' + str(failures)}")
    sys.exit(1 if failures else 0)
