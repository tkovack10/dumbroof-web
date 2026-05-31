#!/usr/bin/env python3
"""QA content-integrity check regression (check_report_content).

Guards the report-QUALITY scan added 2026-05-31 after the owner asked qa_review
to "check everything from logo to hail to wind to contradictions to name leaks"
AND "proofread the reports". The deterministic half lives in
qa_pdf_checks.check_report_content; this exercises it against a synthetic
forensic-text string so no network/Supabase is touched.

Two prior gaps these tests lock down:
  * the is_usarm short-circuit was skipping ALL content checks on USARM's own
    reports — check_report_content must NOT be brand-gated.
  * a required-element check must mirror the generator's wind-chart gate exactly
    so it never false-flags a legitimately-absent chart.

Runs with pytest if available, else as a plain script:
    cd backend && python3 tests/test_qa_content_checks.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import qa_pdf_checks  # noqa: E402
from qa_pdf_checks import (  # noqa: E402
    check_report_content,
    _wind_chart_would_render,
    _claim_involves_hail,
)

# Env so the SUPABASE-missing early-return doesn't short-circuit the scan.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-key")


# --- harness: replace the PDF download with a fixed text string ------------
def _install_fake_text(text, err=None):
    """Monkeypatch _download_pdf_text to return (text, err) with no network."""
    def _fake(sb_url, sk, storage_path, first_n_pages=2):
        return (text, err)
    qa_pdf_checks._download_pdf_text = _fake


def _restore_download():
    qa_pdf_checks._download_pdf_text = _ORIG_DOWNLOAD


_ORIG_DOWNLOAD = qa_pdf_checks._download_pdf_text


def _claim():
    return {
        "user_id": "u1",
        "file_path": "u1/claim-123",
        "output_files": ["01_FORENSIC_CAUSATION_REPORT.pdf", "02_ESTIMATE.pdf"],
    }


def _issues(flags):
    return {f["issue"] for f in flags}


# --- required-element: hail ------------------------------------------------
def test_hail_claim_missing_threshold_table_flags_medium():
    _install_fake_text("This forensic report documents hail strike signatures across all slopes. "
                       "The granular loss is consistent with a hail event.")
    try:
        config = {"weather": {"noaa": {"max_hail_inches": 1.5}}}
        flags = check_report_content(_claim(), config)
    finally:
        _restore_download()
    assert "HAIL_THRESHOLD_TABLE_MISSING" in _issues(flags), flags
    f = next(x for x in flags if x["issue"] == "HAIL_THRESHOLD_TABLE_MISSING")
    assert f["severity"] == "medium"


def test_hail_claim_with_threshold_table_no_flag():
    _install_fake_text("Damage Threshold Analysis\nMaterial | Damage Threshold | Result\n"
                       "Asphalt shingle | 1.0 in | EXCEEDED\nHail strike signatures observed.")
    try:
        config = {"weather": {"noaa": {"max_hail_inches": 1.5}}}
        flags = check_report_content(_claim(), config)
    finally:
        _restore_download()
    assert "HAIL_THRESHOLD_TABLE_MISSING" not in _issues(flags), flags


def test_non_hail_claim_does_not_require_threshold_table():
    # Pure wind claim, no hail anywhere → no hail flag even without the table.
    _install_fake_text("Wind Velocity Amplification — ASCE 7 Roof Zone Analysis. "
                       "The 65 mph peak gust amplified at the roof surface.")
    try:
        config = {
            "weather": {"noaa": {"max_wind_mph": 65}},
            "estimate_request": {"damage_type": "wind"},
        }
        flags = check_report_content(_claim(), config)
    finally:
        _restore_download()
    assert "HAIL_THRESHOLD_TABLE_MISSING" not in _issues(flags), flags


# --- required-element: wind ------------------------------------------------
def test_wind_claim_missing_wind_analysis_flags_medium():
    _install_fake_text("Straight-line winds drove the failure. No amplification section rendered here.")
    try:
        config = {
            "weather": {"noaa": {"max_wind_mph": 70}},
            "estimate_request": {"damage_type": "wind"},
        }
        flags = check_report_content(_claim(), config)
    finally:
        _restore_download()
    assert "WIND_ANALYSIS_MISSING" in _issues(flags), flags
    f = next(x for x in flags if x["issue"] == "WIND_ANALYSIS_MISSING")
    assert f["severity"] == "medium"


def test_combined_claim_missing_wind_analysis_flags():
    _install_fake_text("Combined hail and wind. Damage Threshold present. But no wind chart.")
    try:
        config = {
            # combined at 45 mph: generator emits (>=40 floor, not hail-labeled).
            "weather": {"noaa": {"max_wind_mph": 45, "max_hail_inches": 1.0}},
            "estimate_request": {"damage_type": "combined"},
        }
        flags = check_report_content(_claim(), config)
    finally:
        _restore_download()
    assert "WIND_ANALYSIS_MISSING" in _issues(flags), flags


def test_hail_labeled_low_wind_does_not_require_wind_analysis():
    # hail-labeled + 50 mph < 58 NWS threshold → generator does NOT emit chart →
    # we must NOT flag its absence (false-positive guard).
    _install_fake_text("Damage Threshold Analysis present. Hail strikes. No wind chart and that's correct.")
    try:
        config = {
            "weather": {"noaa": {"max_wind_mph": 50, "max_hail_inches": 1.5}},
            "estimate_request": {"damage_type": "hail"},
        }
        flags = check_report_content(_claim(), config)
    finally:
        _restore_download()
    assert "WIND_ANALYSIS_MISSING" not in _issues(flags), flags


def test_wind_claim_with_analysis_no_flag():
    _install_fake_text("Wind Velocity Amplification — ASCE 7 Roof Zone Analysis. Peak gust 70 mph.")
    try:
        config = {
            "weather": {"noaa": {"max_wind_mph": 70}},
            "estimate_request": {"damage_type": "wind"},
        }
        flags = check_report_content(_claim(), config)
    finally:
        _restore_download()
    assert "WIND_ANALYSIS_MISSING" not in _issues(flags), flags


# --- wind gate mirror unit test --------------------------------------------
def test_wind_gate_mirror():
    # Exactly mirrors usarm_pdf_generator._build_wind_amplification_chart.
    assert _wind_chart_would_render({"weather": {"noaa": {"max_wind_mph": 0}}}) is False
    assert _wind_chart_would_render({"weather": {"noaa": {"max_wind_mph": 39}}}) is False
    assert _wind_chart_would_render({"weather": {"noaa": {"max_wind_mph": 40}}}) is True  # unspecified label, >=40
    assert _wind_chart_would_render({
        "weather": {"noaa": {"max_wind_mph": 50}}, "estimate_request": {"damage_type": "hail"},
    }) is False  # hail-labeled, <58
    assert _wind_chart_would_render({
        "weather": {"noaa": {"max_wind_mph": 58}}, "estimate_request": {"damage_type": "hail"},
    }) is True  # hail-labeled, >=58
    assert _wind_chart_would_render({
        "weather": {"noaa": {"max_wind_mph": 45}}, "estimate_request": {"damage_type": "wind"},
    }) is True  # wind-labeled, >=40


# --- hail detection unit test ----------------------------------------------
def test_hail_detection_sources():
    assert _claim_involves_hail({"weather": {"noaa": {"max_hail_inches": 1.0}}}, "") is True
    assert _claim_involves_hail({"estimate_request": {"damage_type": "hail"}}, "") is True
    assert _claim_involves_hail({}, "documented a hailstorm event") is True
    assert _claim_involves_hail({"estimate_request": {"damage_type": "wind"}}, "wind only here") is False


# --- placeholder / merge-field leak ----------------------------------------
def test_template_placeholder_leak_is_critical():
    _install_fake_text("Damage Threshold Analysis. The property owned by {homeowner_name} sustained damage.")
    try:
        config = {"weather": {"noaa": {"max_hail_inches": 1.0}}}
        flags = check_report_content(_claim(), config)
    finally:
        _restore_download()
    assert "TEMPLATE_PLACEHOLDER_LEAK" in _issues(flags), flags
    f = next(x for x in flags if x["issue"] == "TEMPLATE_PLACEHOLDER_LEAK")
    assert f["severity"] == "critical"
    assert "{homeowner_name}" in f["found"]


def test_double_brace_leak_is_critical():
    _install_fake_text("Damage Threshold Analysis. Inspected by {{ company.ceo_name }} on the date of loss.")
    try:
        config = {"weather": {"noaa": {"max_hail_inches": 1.0}}}
        flags = check_report_content(_claim(), config)
    finally:
        _restore_download()
    assert "TEMPLATE_PLACEHOLDER_LEAK" in _issues(flags), flags
    assert next(x for x in flags if x["issue"] == "TEMPLATE_PLACEHOLDER_LEAK")["severity"] == "critical"


def test_sentinel_token_is_medium_not_critical():
    _install_fake_text("Damage Threshold Analysis. Roof area: None sq ft was recorded for the structure.")
    try:
        config = {"weather": {"noaa": {"max_hail_inches": 1.0}}}
        flags = check_report_content(_claim(), config)
    finally:
        _restore_download()
    assert "REPORT_SENTINEL_TOKEN" in _issues(flags), flags
    assert next(x for x in flags if x["issue"] == "REPORT_SENTINEL_TOKEN")["severity"] == "medium"
    # And it is NOT escalated to critical.
    assert "TEMPLATE_PLACEHOLDER_LEAK" not in _issues(flags), flags


# --- false-positive guards -------------------------------------------------
def test_clean_text_no_content_flags():
    _install_fake_text(
        "Damage Threshold Analysis\nWind Velocity Amplification — ASCE 7 Roof Zone Analysis\n"
        "None of the shingles in this Nantucket-style roof escaped the financial impact; the "
        "homeowner reported the loss promptly. The carrier should review the enclosed scope."
    )
    try:
        config = {
            "weather": {"noaa": {"max_hail_inches": 1.5, "max_wind_mph": 70}},
            "estimate_request": {"damage_type": "combined"},
        }
        flags = check_report_content(_claim(), config)
    finally:
        _restore_download()
    # "None" appears as a sentence-leading capital-N word here — that IS a
    # word-boundary sentinel hit and acceptable as MEDIUM, but it must NEVER be
    # critical and must produce NO required-element flags.
    assert "HAIL_THRESHOLD_TABLE_MISSING" not in _issues(flags), flags
    assert "WIND_ANALYSIS_MISSING" not in _issues(flags), flags
    assert "TEMPLATE_PLACEHOLDER_LEAK" not in _issues(flags), flags
    # Lowercase prose "none"/"nantucket"/"financial" must NOT trip sentinels.
    # The only sentinel that may fire is the leading "None" — assert nothing
    # critical leaked from this clean body.
    assert not [f for f in flags if f["severity"] == "critical"], flags


def test_lowercase_none_in_prose_not_flagged():
    _install_fake_text(
        "Damage Threshold Analysis present. none of the slopes were spared, and the financial "
        "exposure to the Nantucket residence is significant."
    )
    try:
        config = {"weather": {"noaa": {"max_hail_inches": 1.0}}}
        flags = check_report_content(_claim(), config)
    finally:
        _restore_download()
    # Case-sensitive sentinel: lowercase "none" must NOT fire.
    assert "REPORT_SENTINEL_TOKEN" not in _issues(flags), flags


# --- fail-open on download error -------------------------------------------
def test_download_error_returns_low_degraded_not_raise():
    _install_fake_text("", err="download failed: 522 storm")
    try:
        config = {"weather": {"noaa": {"max_hail_inches": 1.0}}}
        flags = check_report_content(_claim(), config)
    finally:
        _restore_download()
    assert "QA_CHECK_DEGRADED" in _issues(flags), flags
    assert all(f["severity"] == "low" for f in flags), flags
    # Crucially: no critical/medium from a download failure (fail-open).
    assert not [f for f in flags if f["severity"] in ("critical", "medium")], flags


def test_no_forensic_file_returns_low_degraded():
    _install_fake_text("irrelevant")
    try:
        claim = {"user_id": "u1", "file_path": "u1/claim-123", "output_files": ["02_ESTIMATE.pdf"]}
        flags = check_report_content(claim, {"weather": {"noaa": {"max_hail_inches": 1.0}}})
    finally:
        _restore_download()
    assert "QA_CHECK_DEGRADED" in _issues(flags), flags
    assert all(f["severity"] == "low" for f in flags), flags


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
    print(f"\n{'ALL PASS' if not failures else str(failures) + ' FAILED'}")
    sys.exit(1 if failures else 0)
