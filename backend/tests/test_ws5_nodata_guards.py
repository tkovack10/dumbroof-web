#!/usr/bin/env python3
"""WS-5 — no-data / placeholder render-guard regression.

Covers:
  * has_measurements (E268) coerces string measurement values like '109 ft'
    instead of raising TypeError, and the structures[] fallback.
  * weather_verified keys ONLY on the production-stored shape
    ({hail_size, storm_date, storm_description} + weather.noaa.event_count),
    NOT on the rich keys (hail_size_algorithm/hailtrace_id) that prod never
    writes — so it is True on a real verified claim and False on truly-empty.
  * a 0-SF / no-measurement config suppresses the roof-spec metric rows and
    emits the "Forensic assessment — measurements not included" relabel.
  * a no-weather config softens the storm box / "confirmed" language.
  * Doc 02 estimate-pending: NO line-item table, an ESTIMATE PENDING notice,
    and the doc is NEVER dropped (E252).

Runs with pytest if available, else as a plain script:
    python3 backend/tests/test_ws5_nodata_guards.py
"""

import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from compliance_report import has_measurements, weather_verified  # noqa: E402
import usarm_pdf_generator as G  # noqa: E402


# ---------------------------------------------------------------------------
# has_measurements — E268 string coercion
# ---------------------------------------------------------------------------

def test_has_measurements_coerces_strings_no_crash():
    # '109 ft' would raise TypeError under the old `eave > 0` comparison.
    cfg = {"measurements": {"eave": "109 ft", "rake": "", "total_area": ""}}
    assert has_measurements(cfg) is True  # 109 > 0


def test_has_measurements_string_zero_and_blank_are_false():
    cfg = {"measurements": {"eave": "0 ft", "rake": "", "total_area": "0 SF"},
           "structures": [{"roof_area_sf": "0", "roof_area_sq": ""}]}
    assert has_measurements(cfg) is False


def test_has_measurements_structures_fallback_string():
    cfg = {"measurements": {}, "structures": [{"roof_area_sf": "2,847 SF"}]}
    assert has_measurements(cfg) is True


def test_has_measurements_thousands_separator_and_units():
    cfg = {"measurements": {"total_area": "1,250 SF"}}
    assert has_measurements(cfg) is True


def test_has_measurements_garbage_does_not_raise():
    for bad in ("n/a", None, "TBD", "  ", "ft", []):
        cfg = {"measurements": {"eave": bad, "rake": bad, "total_area": bad}}
        assert has_measurements(cfg) is False  # no exception


# ---------------------------------------------------------------------------
# weather_verified — prod shape only
# ---------------------------------------------------------------------------

def test_weather_verified_prod_shape_hail_size():
    cfg = {"weather": {"hail_size": "1.75 inches", "storm_date": "", "storm_description": ""}}
    assert weather_verified(cfg) is True


def test_weather_verified_prod_shape_storm_date():
    cfg = {"weather": {"hail_size": "", "storm_date": "March 16, 2026", "storm_description": ""}}
    assert weather_verified(cfg) is True


def test_weather_verified_prod_shape_storm_description():
    cfg = {"weather": {"hail_size": "", "storm_date": "", "storm_description": "Hail event near property"}}
    assert weather_verified(cfg) is True


def test_weather_verified_event_count():
    cfg = {"weather": {"hail_size": "", "storm_date": "", "storm_description": "",
                       "noaa": {"event_count": 3}}}
    assert weather_verified(cfg) is True


def test_weather_verified_real_verified_claim():
    """Mirror a real processor-written weather block + NOAA pre-seed."""
    cfg = {"weather": {
        "hail_size": "2.0 inches",
        "storm_date": "April 25, 2026",
        "storm_description": "Severe thunderstorm with hail near the subject property.",
        "noaa": {"event_count": 12, "max_hail_inches": 2.0, "max_wind_mph": 60},
    }}
    assert weather_verified(cfg) is True


def test_weather_verified_false_on_truly_empty():
    cfg = {"weather": {"hail_size": "", "storm_date": "", "storm_description": ""}}
    assert weather_verified(cfg) is False
    assert weather_verified({"weather": {}}) is False
    assert weather_verified({}) is False


def test_weather_verified_ignores_rich_keys_only():
    """A config with ONLY the rich keys (never written in prod) but no prod-shape
    field must NOT be considered verified — that was the prior draft's bug."""
    cfg = {"weather": {
        "hail_size": "", "storm_date": "", "storm_description": "",
        "hail_size_algorithm": "1.75 inches (HailTrace)",
        "hailtrace_id": "HT-12345",
        "verification_method": "Algorithmic",
    }}
    assert weather_verified(cfg) is False


def test_weather_verified_event_count_string_zero():
    cfg = {"weather": {"hail_size": "", "storm_date": "", "storm_description": "",
                       "noaa": {"event_count": "0"}}}
    assert weather_verified(cfg) is False


# ---------------------------------------------------------------------------
# Render harness for the forensic + estimate docs
# ---------------------------------------------------------------------------

def _base_config(**over):
    cfg = {
        "phase": "post-scope",
        "company": {"name": "USA ROOF MASTERS", "tagline": "", "ceo_name": "Tom Kovack Jr.",
                    "ceo_title": "CEO", "email": "t@x.com", "cell_phone": "267-679-1504",
                    "office_phone": "", "website": ""},
        "property": {"address": "1 Test St, Town, PA 19000", "city": "Town", "state": "PA", "zip": "19000"},
        "insured": {"name": "Jane Homeowner", "type": "homeowner"},
        "carrier": {"name": "State Farm", "claim_number": "CLM-1", "policy_number": "POL-9"},
        "dates": {"date_of_loss": "March 16, 2026", "report_date": "March 20, 2026",
                  "usarm_inspection_date": "March 18, 2026"},
        "inspectors": {"usarm_inspector": "Zach", "usarm_title": "Inspector"},
        "scope": {"trades": ["roofing"], "o_and_p": False},
        "financials": {"tax_rate": 0.0, "price_list": "PAPI26", "deductible": 0},
        "structures": [{"name": "Main Dwelling", "roof_area_sf": 2500, "roof_area_sq": 25,
                        "facets": 6, "predominant_pitch": "6/12", "style": "gable",
                        "shingle_type": "laminate", "shingle_condition": "fair"}],
        "weather": {"hail_size": "1.75 inches", "storm_date": "March 16, 2026",
                    "storm_description": "Hail event near property"},
        "measurements": {"eave": 120, "rake": 80, "total_area": 2500},
        "line_items": [{"category": "ROOFING", "description": "R&R Shingle", "qty": 25,
                        "unit": "SQ", "unit_price": 300.0, "trade": "roofing"}],
        "photo_annotations": {},
        "photo_sections": [],
        "forensic_findings": {"damage_summary": "Storm damage observed.",
                              "code_violations": [], "key_arguments": [], "total_photos": 5},
        "appeal_letter": {"demand_items": [], "enclosed_documents": [], "requested_actions": []},
        "cover_letter": {},
    }
    for k, v in over.items():
        cfg[k] = v
    return cfg


def _render(builder, cfg):
    tmp = tempfile.mkdtemp(prefix="ws5_")
    cfg = dict(cfg)
    cfg["_paths"] = {"claim_dir": tmp, "photos": tmp, "output": tmp, "source_docs": tmp}
    path = builder(cfg)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


# ---------------------------------------------------------------------------
# Guard 1 — roof-spec rows suppressed when no measurements
# ---------------------------------------------------------------------------

def test_forensic_no_measurements_suppresses_rows():
    cfg = _base_config(
        measurements={},
        structures=[{"name": "Main Dwelling", "roof_area_sf": 0, "roof_area_sq": 0,
                     "facets": 0, "predominant_pitch": "", "style": "gable",
                     "shingle_type": "laminate", "shingle_condition": ""}],
    )
    html = _render(G.build_forensic_report, cfg)
    assert "0 SF (0 SQ)" not in html
    assert "Facets</strong></td><td>0</td>" not in html
    assert "measurements not included" in html


def test_forensic_with_measurements_keeps_rows():
    html = _render(G.build_forensic_report, _base_config())
    assert "Total Roof Area" in html
    assert "2,500 SF (25 SQ)" in html
    assert "measurements not included" not in html


# ---------------------------------------------------------------------------
# Guard 2 — "confirmed" softened when not weather-verified
# ---------------------------------------------------------------------------

def test_forensic_no_weather_softens_storm_box():
    cfg = _base_config(weather={"hail_size": "", "storm_date": "", "storm_description": ""})
    html = _render(G.build_forensic_report, cfg)
    assert "Weather verification pending" in html
    assert "Storm Verified:" not in html


def test_cover_letter_no_weather_softens_confirmed():
    cfg = _base_config(phase="pre-scope",
                       weather={"hail_size": "", "storm_date": "", "storm_description": ""})
    html = _render(G.build_cover_letter, cfg)
    assert "a confirmed severe weather event" not in html
    assert "a reported severe weather event" in html


def test_cover_letter_verified_keeps_confirmed():
    cfg = _base_config(phase="pre-scope")
    html = _render(G.build_cover_letter, cfg)
    assert "a confirmed severe weather event" in html


# ---------------------------------------------------------------------------
# Guard 3 — placeholder owner suppressed
# ---------------------------------------------------------------------------

def test_forensic_placeholder_owner_suppressed():
    cfg = _base_config(insured={"name": "Property Owner", "type": "homeowner"})
    html = _render(G.build_forensic_report, cfg)
    assert "Property Owner</strong></td><td>Property Owner" not in html
    # cover-page line dropped too
    assert "<strong>Property Owner:</strong> Property Owner" not in html


# ---------------------------------------------------------------------------
# Guard 4 — Doc 02 estimate-pending, never dropped
# ---------------------------------------------------------------------------

def test_doc02_estimate_pending_notice():
    cfg = _base_config(measurements={}, line_items=[],
                       structures=[{"name": "Main Dwelling", "roof_area_sf": 0,
                                    "roof_area_sq": 0, "style": "gable"}])
    html = _render(G.build_xactimate_estimate, cfg)
    assert "ESTIMATE PENDING" in html
    assert "LINE ITEM TOTAL" not in html  # no $0 line-item table
    assert "TOTAL RCV" not in html
    # The document itself still rendered (never dropped — E252)
    assert "X STYLE BUILD SCOPE" in html
    assert "Pending — measurements not yet uploaded" in html


def test_doc02_priced_renders_table():
    html = _render(G.build_xactimate_estimate, _base_config())
    assert "ESTIMATE PENDING" not in html
    assert "LINE ITEM TOTAL" in html
    assert "TOTAL RCV" in html


# ---------------------------------------------------------------------------
# Guard 7 — QA detector (MEDIUM-only, never blocking — WS-0 posture)
# ---------------------------------------------------------------------------

def test_qa_detector_no_measurements_asserted():
    from qa_auditor import compute_ws5_nodata_flags
    cfg = {"measurements": {}, "structures": [{}], "insured": {"name": "Jane"},
           "weather": {"storm_date": "March 16, 2026"},
           "forensic_findings": {"key_arguments": ["Scope based on EagleView measurements."]}}
    flags = compute_ws5_nodata_flags(cfg, {})
    issues = [f["issue"] for f in flags]
    assert "WS5_NO_MEASUREMENTS_ASSERTED" in issues
    assert all(f["severity"] == "medium" for f in flags)


def test_qa_detector_weather_unverified_confirmed():
    from qa_auditor import compute_ws5_nodata_flags
    cfg = {"measurements": {"total_area": 2500}, "structures": [{"roof_area_sf": 2500}],
           "insured": {"name": "Jane"},
           "weather": {"hail_size": "", "storm_date": "", "storm_description": ""},
           "forensic_findings": {"executive_summary": ["We confirmed severe weather hail damage."]}}
    issues = [f["issue"] for f in compute_ws5_nodata_flags(cfg, {})]
    assert "WS5_WEATHER_UNVERIFIED_CONFIRMED" in issues


def test_qa_detector_placeholder_owner_medium_only():
    from qa_auditor import compute_ws5_nodata_flags
    cfg = {"measurements": {"total_area": 2500}, "structures": [{"roof_area_sf": 2500}],
           "insured": {"name": "Property Owner"},
           "weather": {"hail_size": "1.75 inches"}, "forensic_findings": {}}
    flags = compute_ws5_nodata_flags(cfg, {})
    assert [f["issue"] for f in flags] == ["WS5_PLACEHOLDER_OWNER"]
    assert flags[0]["severity"] == "medium"


def test_qa_detector_clean_verified_no_flags():
    from qa_auditor import compute_ws5_nodata_flags
    cfg = {"measurements": {"total_area": 2500}, "structures": [{"roof_area_sf": 2500}],
           "insured": {"name": "Jane"},
           "weather": {"hail_size": "1.75 inches", "storm_date": "March 16"},
           "forensic_findings": {"executive_summary": ["Storm damage observed across all slopes."]}}
    assert compute_ws5_nodata_flags(cfg, {}) == []


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
    print(f"\n{'ALL PASS' if not failures else str(failures) + ' FAILURES'}")
    sys.exit(1 if failures else 0)
