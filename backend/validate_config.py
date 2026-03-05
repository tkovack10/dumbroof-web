#!/usr/bin/env python3
"""
USARM Config Validator — Anti-Hallucination Gate
=================================================
Codifies all known error patterns from ERRORS.md into executable checks.
Run before PDF generation to catch config mistakes before they hit the generator.

Usage:
    python3 validate_config.py claims/{slug}/claim_config.json       # Validate one claim
    python3 validate_config.py claims/{slug}/claim_config.json --fix  # Auto-fix known patterns
    python3 validate_config.py --all                                  # Validate all claims
    python3 validate_config.py --all --summary                        # Summary only (no detail)

Exit codes:
    0 = PASSED (no errors, warnings only)
    1 = ERRORS found (must fix before generation)
    2 = Fatal (file not found, invalid JSON, etc.)
"""

import os
import sys
import json
import glob
import argparse
from pathlib import Path


# ===================================================================
# ERROR/WARNING COLLECTION
# ===================================================================

class ValidationResult:
    def __init__(self, config_path):
        self.config_path = config_path
        self.errors = []    # Must fix before generation
        self.warnings = []  # Should fix but won't crash generator
        self.fixes = []     # Auto-fixes applied (--fix mode)
        self.info = []      # Informational notes

    def error(self, code, message):
        self.errors.append(f"[ERROR {code}] {message}")

    def warn(self, code, message):
        self.warnings.append(f"[WARN  {code}] {message}")

    def fix(self, code, message):
        self.fixes.append(f"[FIXED {code}] {message}")

    def note(self, message):
        self.info.append(f"[INFO] {message}")

    @property
    def passed(self):
        return len(self.errors) == 0

    def print_report(self, verbose=True):
        slug = os.path.basename(os.path.dirname(self.config_path))
        if self.passed and not self.warnings:
            if verbose:
                print(f"  PASS  {slug}")
            return

        status = "FAIL" if not self.passed else "WARN"
        print(f"\n  {status}  {slug}")
        if verbose:
            for e in self.errors:
                print(f"    {e}")
            for w in self.warnings:
                print(f"    {w}")
            for f in self.fixes:
                print(f"    {f}")
            for i in self.info:
                print(f"    {i}")


# ===================================================================
# INDIVIDUAL CHECKS
# ===================================================================

def check_required_sections(config, result):
    """Check that all required top-level sections exist."""
    required = [
        "property", "insured", "carrier", "dates", "company",
        "structures", "line_items", "forensic_findings", "weather"
    ]
    for section in required:
        if section not in config:
            result.error("REQ01", f"Missing required section: '{section}'")

    # photo_sections required for non-pre-scope
    phase = config.get("phase", "post-scope")
    if phase != "pre-scope" and "photo_sections" not in config:
        result.warn("REQ02", "Missing photo_sections (required for post-scope claims)")


def check_property_fields(config, result):
    """Check property section has required fields."""
    prop = config.get("property", {})
    for field in ["address", "city", "state", "zip"]:
        if not prop.get(field):
            result.error("PROP01", f"Missing property.{field}")


def check_insured_fields(config, result):
    """Check insured section."""
    ins = config.get("insured", {})
    if not ins.get("name"):
        result.error("INS01", "Missing insured.name")


def check_company_fields(config, result):
    """Check company section has all fields the generator reads."""
    company = config.get("company", {})
    required = ["name", "ceo_name", "ceo_title", "email", "cell_phone",
                "office_phone", "address", "city_state_zip"]
    for field in required:
        if not company.get(field):
            result.error("COMP01", f"Missing company.{field}")


def check_carrier_fields(config, result):
    """Check carrier section."""
    carrier = config.get("carrier", {})
    if not carrier.get("name"):
        result.error("CARR01", "Missing carrier.name")
    if not carrier.get("claim_number"):
        result.error("CARR02", "Missing carrier.claim_number")


def check_dates_fields(config, result):
    """Check dates section."""
    dates = config.get("dates", {})
    if not dates.get("date_of_loss"):
        result.error("DATE01", "Missing dates.date_of_loss")
    if not dates.get("report_date"):
        result.error("DATE02", "Missing dates.report_date")


def check_structures(config, result):
    """Check structures is a non-empty list with required fields."""
    structures = config.get("structures", [])
    if not isinstance(structures, list) or len(structures) == 0:
        result.error("STRC01", "structures must be a non-empty list")
        return
    for i, s in enumerate(structures):
        if not s.get("shingle_type"):
            result.warn("STRC02", f"structures[{i}] missing shingle_type")
        waste = s.get("waste_percent", 0)
        if waste == 0:
            style = s.get("style", "").lower()
            default = "14% (hip)" if "hip" in style else "10% (gable)"
            result.warn("STRC04", f"structures[{i}].waste_percent is 0 — generator will auto-default to {default}. Set explicitly for accuracy.")


def check_line_items(config, result):
    """Check line_items are valid."""
    items = config.get("line_items", [])
    if not isinstance(items, list) or len(items) == 0:
        result.error("LINE01", "line_items must be a non-empty list")
        return
    for i, item in enumerate(items):
        for field in ["description", "qty", "unit_price"]:
            if field not in item:
                result.error("LINE02", f"line_items[{i}] missing '{field}'")
        if "qty" in item and "unit_price" in item:
            try:
                float(item["qty"])
                float(item["unit_price"])
            except (TypeError, ValueError):
                result.error("LINE03", f"line_items[{i}] qty or unit_price is not numeric")


def check_forensic_findings(config, result):
    """Check forensic_findings required fields."""
    findings = config.get("forensic_findings", {})
    if not findings.get("damage_summary") and not findings.get("executive_summary"):
        result.error("FORE01", "Missing forensic_findings.damage_summary (or executive_summary)")


def check_weather(config, result):
    """Check weather section."""
    weather = config.get("weather", {})
    if not weather.get("storm_date"):
        result.error("WEAT01", "Missing weather.storm_date")


# ===================================================================
# ERROR PATTERN CHECKS (from ERRORS.md E001-E035)
# ===================================================================

def check_E004_deductible_location(config, result, fix_mode=False):
    """E004/E011: Deductible in financials but not carrier."""
    fin_ded = config.get("financials", {}).get("deductible")
    carr_ded = config.get("carrier", {}).get("deductible")

    if fin_ded is not None and fin_ded > 0 and (carr_ded is None or carr_ded == 0):
        if fix_mode and "carrier" in config:
            config["carrier"]["deductible"] = fin_ded
            result.fix("E004", f"Copied deductible ${fin_ded} from financials to carrier")
        else:
            result.error("E004", f"Deductible (${fin_ded}) is in financials but NOT in carrier. Generator reads carrier.deductible only.")


def check_E013_differentiation_table(config, result):
    """E013/E016/E019: differentiation_table wrong field names (3x repeated error)."""
    dt = config.get("forensic_findings", {}).get("differentiation_table")
    if not dt:
        return
    if not isinstance(dt, list) or len(dt) == 0:
        return

    row = dt[0]
    correct_fields = {"cause", "characteristics", "observed", "conclusion"}
    wrong_patterns = [
        {"characteristic", "hail_damage", "other_cause"},
        {"indicator", "storm_damage", "non_storm_cause"},
        {"indicator", "storm_cause", "non_storm_cause"},
    ]

    actual_fields = set(row.keys())
    if not correct_fields.issubset(actual_fields):
        for wrong in wrong_patterns:
            if wrong.issubset(actual_fields):
                result.error("E013", f"differentiation_table uses WRONG fields {sorted(wrong)}. Must be: cause, characteristics, observed, conclusion")
                return
        # Check for partial matches
        missing = correct_fields - actual_fields
        if missing:
            result.error("E013", f"differentiation_table missing required fields: {sorted(missing)}. Must have: cause, characteristics, observed, conclusion")


def check_E014_critical_observations(config, result):
    """E014: critical_observations needs title + content."""
    obs = config.get("forensic_findings", {}).get("critical_observations")
    if not obs:
        return
    if not isinstance(obs, list):
        return
    for i, o in enumerate(obs):
        if "title" not in o:
            result.error("E014", f"critical_observations[{i}] missing 'title' field (has: {list(o.keys())})")
        if "content" not in o:
            result.error("E014", f"critical_observations[{i}] missing 'content' field (has: {list(o.keys())})")


def check_E015_damage_thresholds(config, result):
    """E015: damage_thresholds needs result field."""
    dt = config.get("weather", {}).get("damage_thresholds") or \
         config.get("forensic_findings", {}).get("damage_thresholds")
    if not dt:
        return
    if not isinstance(dt, list):
        return
    for i, d in enumerate(dt):
        if "result" not in d:
            result.error("E015", f"damage_thresholds[{i}] missing 'result' field. Required: material, threshold, confirmed_size, result")


def check_E018_code_violations(config, result):
    """E018: code_violations needs separate code field."""
    cvs = config.get("forensic_findings", {}).get("code_violations")
    if not cvs:
        return
    if not isinstance(cvs, list):
        return
    for i, cv in enumerate(cvs):
        if "code" not in cv:
            result.error("E018", f"code_violations[{i}] missing 'code' field. Must have: code, requirement, status (3 separate fields)")
        if "requirement" not in cv:
            result.error("E018", f"code_violations[{i}] missing 'requirement' field")
        if "status" not in cv:
            result.error("E018", f"code_violations[{i}] missing 'status' field")


# ===================================================================
# FINANCIAL CONSISTENCY CHECKS
# ===================================================================

def check_financial_consistency(config, result):
    """Check O&P vs trade count, tax rate vs state."""
    scope = config.get("scope", {})
    trades = scope.get("trades", [])
    o_and_p = scope.get("o_and_p", False)

    # O&P vs trade count
    if len(trades) >= 3 and not o_and_p:
        result.warn("FIN01", f"3+ trades ({', '.join(trades)}) but o_and_p is false — should be true")
    if len(trades) < 3 and o_and_p:
        result.warn("FIN02", f"Only {len(trades)} trade(s) but o_and_p is true — should be false")

    # Tax rate vs state
    state = config.get("property", {}).get("state", "").upper()
    tax_rate = config.get("financials", {}).get("tax_rate")
    if tax_rate is not None and state:
        expected_rates = {"NY": 0.08, "PA": 0.0, "NJ": 0.06625}
        if state in expected_rates:
            expected = expected_rates[state]
            if abs(tax_rate - expected) > 0.001:
                result.warn("FIN03", f"Tax rate {tax_rate} doesn't match {state} expected rate {expected}")


# ===================================================================
# PHOTO VALIDATION
# ===================================================================

def check_photo_files(config, result):
    """Check that every photo_annotations key has a matching file."""
    annotations = config.get("photo_annotations", {})
    photo_map = config.get("photo_map", {})
    photos_dir = config.get("_paths", {}).get("photos", "")

    if not photos_dir or not os.path.isdir(photos_dir):
        return

    for key in annotations:
        if key.startswith("_"):
            continue  # Skip _note fields
        # Check photo_map first
        if key in photo_map:
            mapped = photo_map[key]
            if not os.path.exists(os.path.join(photos_dir, mapped)):
                result.warn("PHOT01", f"photo_map[{key}] -> '{mapped}' file not found in photos/")
            continue
        # Check glob pattern
        if not key.startswith("p") or "_" not in key:
            continue
        parts = key[1:].split("_")
        if len(parts) != 2:
            continue
        try:
            page = int(parts[0])
            img = int(parts[1])
        except ValueError:
            continue
        pattern = os.path.join(photos_dir, f"page{page:02d}_img{img:02d}_*.jpeg")
        if not glob.glob(pattern):
            # Also try PNG
            pattern_png = os.path.join(photos_dir, f"page{page:02d}_img{img:02d}_*.png")
            if not glob.glob(pattern_png):
                result.warn("PHOT02", f"Photo key '{key}' has no matching file (checked {os.path.basename(pattern)})")


# ===================================================================
# CROSS-FIELD LOGIC CHECKS
# ===================================================================

def check_cross_field_logic(config, result):
    """Check logical relationships between fields."""
    carrier = config.get("carrier", {})
    phase = config.get("phase", "post-scope")

    # Carrier RCV sanity (post-scope only)
    if phase != "pre-scope":
        carrier_rcv = carrier.get("carrier_rcv", 0)
        if carrier_rcv == 0:
            result.warn("LOGIC01", "carrier.carrier_rcv is 0 for a post-scope claim")

    # carrier_line_items format check (supplement report needs specific format)
    carrier_items = carrier.get("carrier_line_items", [])
    if carrier_items and isinstance(carrier_items, list) and len(carrier_items) > 0:
        first = carrier_items[0]
        if isinstance(first, dict):
            # Check for supplement report format
            has_supplement_fields = any(k in first for k in ["item", "carrier_desc", "usarm_desc", "note"])
            has_old_fields = all(k in first for k in ["description", "amount"])
            if has_old_fields and not has_supplement_fields:
                result.warn("LOGIC02", "carrier_line_items uses old format {description, amount}. Supplement report expects {item, carrier_desc, carrier_amount, usarm_desc, note}")


def check_pitches_format(config, result):
    """Check that pitches are objects, not strings."""
    structures = config.get("structures", [])
    if not structures:
        return
    for i, s in enumerate(structures):
        pitches = s.get("pitches", [])
        if pitches and isinstance(pitches[0], str):
            result.warn("STRC03", f"structures[{i}].pitches are strings (e.g., '{pitches[0]}'). Generator expects objects with pitch, area_sf, percent fields.")


# ===================================================================
# SIDING MANDATORY ITEMS CHECK
# ===================================================================

def check_siding_mandatory_items(config, result):
    """If siding is in trades, check for house wrap + wall flashing."""
    trades = [t.lower() for t in config.get("scope", {}).get("trades", [])]
    if "siding" not in trades:
        return

    items = config.get("line_items", [])
    descs = " ".join(str(item.get("description", "")).lower() for item in items)

    if "house wrap" not in descs and "tyvek" not in descs and "weather barrier" not in descs:
        result.warn("SID01", "Siding in trades but no house wrap/Tyvek line item — code-required per IRC R703.1/R703.2")

    if "wall flash" not in descs:
        result.warn("SID02", "Siding in trades but no wall flashing line item — code-required per IRC R703.4")


# ===================================================================
# ROOFING MANDATORY ITEMS CHECK
# ===================================================================

def check_roofing_mandatory_items(config, result):
    """If roofing is in trades, check for common mandatory items."""
    trades = [t.lower() for t in config.get("scope", {}).get("trades", [])]
    if "roofing" not in trades:
        return

    items = config.get("line_items", [])
    descs = " ".join(str(item.get("description", "")).lower() for item in items)

    mandatory = {
        "underlayment": ["underlayment", "synthetic felt", "felt paper"],
        "ice & water": ["ice", "water barrier", "i&w", "ice/water"],
        "drip edge": ["drip edge"],
        "starter strip": ["starter"],
    }

    for component, keywords in mandatory.items():
        if not any(kw in descs for kw in keywords):
            result.warn("ROOF01", f"Roofing in trades but no '{component}' line item found")


# ===================================================================
# SHINGLE EXPOSURE VALIDATION
# ===================================================================

def check_shingle_exposure(config, result):
    """Check shingle exposure data for roofing claims.

    The generator uses a 4-source waterfall for exposure:
      1. forensic_findings.repairability.measured_exposure_inches
      2. scoring.photo_analysis.exposure_inches_estimate
      3. scoring.photo_analysis.exposure_guess
      4. scoring.product_intelligence.exposure_inches

    If none exist on a roofing claim, the repairability section
    is silently omitted — potentially missing the strongest argument.
    """
    trades = [t.lower() for t in config.get("scope", {}).get("trades", [])]
    if "roofing" not in trades:
        return

    # Check all 4 waterfall sources
    repairability = config.get("forensic_findings", {}).get("repairability", {})
    scoring_photo = config.get("scoring", {}).get("photo_analysis", {})
    scoring_product = config.get("scoring", {}).get("product_intelligence", {})

    measured = repairability.get("measured_exposure_inches")
    estimate = scoring_photo.get("exposure_inches_estimate")
    guess = scoring_photo.get("exposure_guess")
    product_exp = scoring_product.get("exposure_inches")

    # Get the first non-None, non-zero value
    exposure = None
    source = None
    for val, src in [
        (measured, "forensic_findings.repairability.measured_exposure_inches"),
        (estimate, "scoring.photo_analysis.exposure_inches_estimate"),
        (guess, "scoring.photo_analysis.exposure_guess"),
        (product_exp, "scoring.product_intelligence.exposure_inches"),
    ]:
        if val is not None and val != 0:
            try:
                exposure = float(val)
                source = src
                break
            except (TypeError, ValueError):
                result.error("EXPO01", f"{src} value '{val}' is not numeric")
                return

    # No exposure data at all
    if exposure is None:
        result.warn("EXPO01", "No shingle exposure data found in any source. "
                     "Measure exposure (butt-to-butt) and populate "
                     "forensic_findings.repairability.measured_exposure_inches. "
                     "5\" = pre-metric = unrepairable = strongest argument.")
        return

    # Out-of-range sanity check
    if exposure < 3.0 or exposure > 8.0:
        result.error("EXPO02", f"Exposure value {exposure}\" from {source} is out of range (expected 4-7\"). Likely a typo.")
        return

    # Pre-metric detected — check that repairability section exists
    if exposure <= 5.25:
        if not repairability:
            result.warn("EXPO03", f"Exposure is {exposure}\" (pre-metric) but forensic_findings.repairability "
                         "section is missing. Generator will use scoring fallback, but the repairability "
                         "section should be explicitly populated for the strongest forensic argument.")

        if not measured and estimate:
            result.warn("EXPO04", f"Exposure {exposure}\" found in scoring estimate but NOT in "
                         "forensic_findings.repairability.measured_exposure_inches. "
                         "Copy the confirmed value to measured_exposure_inches for the forensic report.")

        # Check determination field
        determination = repairability.get("determination", "")
        if repairability and determination and determination != "unrepairable":
            result.error("EXPO05", f"Exposure is {exposure}\" (pre-metric) but repairability.determination "
                          f"is '{determination}' — should be 'unrepairable'. No manufacturer produces "
                          "shingles with this exposure.")

    # Promote estimate to measured if only estimate exists (info note)
    if not measured and exposure is not None and exposure > 0:
        result.note(f"Exposure {exposure}\" found in {source}. Consider confirming and copying "
                    "to forensic_findings.repairability.measured_exposure_inches for the forensic report.")


# ===================================================================
# DASHBOARD SECTION CHECK
# ===================================================================

def check_dashboard(config, result):
    """Check dashboard section exists and has required fields."""
    dash = config.get("dashboard")
    if not dash:
        result.warn("DASH01", "Missing dashboard section — required for sync pipeline")
        return
    for field in ["status", "phase"]:
        if not dash.get(field):
            result.warn("DASH02", f"Missing dashboard.{field}")


# ===================================================================
# NOAA WEATHER INTELLIGENCE CHECKS
# ===================================================================

def check_noaa_weather(config, result):
    """Check NOAA weather data consistency."""
    weather = config.get("weather", {})
    findings = config.get("forensic_findings", {})
    trades = config.get("scope", {}).get("trades", [])
    trade_str = " ".join(str(t) for t in trades).lower()
    has_roofing = "roof" in trade_str

    noaa = weather.get("noaa")
    hailtrace = weather.get("hailtrace_id", "")
    damage_thresholds = weather.get("damage_thresholds") or findings.get("damage_thresholds")

    # NOAA01: Roofing claim with no NOAA data and no HailTrace
    if has_roofing and not noaa and not hailtrace:
        result.warn("NOAA01", "Roofing claim with no NOAA data and no HailTrace ID. "
                     "Run: python3 -m noaa_weather apply <config> to auto-populate weather data.")

    if not noaa:
        return

    max_hail = noaa.get("max_hail_inches", 0)

    # NOAA02: NOAA hail exceeds thresholds but damage_thresholds not populated
    if max_hail > 0 and not damage_thresholds:
        result.error("NOAA02", f'NOAA reports {max_hail}" hail but damage_thresholds is empty. '
                      "Run: python3 -m noaa_weather apply <config> to auto-generate thresholds.")

    # NOAA03: damage_thresholds storm_actual doesn't match NOAA max_hail
    if max_hail > 0 and damage_thresholds:
        for dt in damage_thresholds:
            storm_actual = dt.get("storm_actual", "")
            # Extract numeric value from storm_actual string
            import re
            match = re.search(r'([\d.]+)"', storm_actual)
            if match:
                actual_val = float(match.group(1))
                if abs(actual_val - max_hail) > 0.01:
                    result.warn("NOAA03", f'damage_thresholds storm_actual ({actual_val}") '
                                 f'doesn\'t match NOAA max_hail ({max_hail}"). '
                                 "Data may be stale — re-run: python3 -m noaa_weather apply <config>")
                    break  # Only warn once


# ===================================================================
# MAIN VALIDATION RUNNER
# ===================================================================

def validate_config(config_path, fix_mode=False):
    """Run all validation checks on a single claim config."""
    result = ValidationResult(config_path)

    # Load JSON
    try:
        with open(config_path, "r") as f:
            config = json.load(f)
    except json.JSONDecodeError as e:
        result.error("FATAL", f"Invalid JSON: {e}")
        return result
    except FileNotFoundError:
        result.error("FATAL", f"File not found: {config_path}")
        return result

    # Inject _paths for photo checks
    claim_dir = os.path.dirname(os.path.abspath(config_path))
    config["_paths"] = {
        "claim_dir": claim_dir,
        "photos": os.path.join(claim_dir, "photos"),
        "output": os.path.join(claim_dir, "pdf_output"),
        "source_docs": os.path.join(claim_dir, "source_docs"),
    }

    # Run all checks
    check_required_sections(config, result)
    check_property_fields(config, result)
    check_insured_fields(config, result)
    check_company_fields(config, result)
    check_carrier_fields(config, result)
    check_dates_fields(config, result)
    check_structures(config, result)
    check_line_items(config, result)
    check_forensic_findings(config, result)
    check_weather(config, result)

    # Error pattern checks (E001-E035)
    check_E004_deductible_location(config, result, fix_mode)
    check_E013_differentiation_table(config, result)
    check_E014_critical_observations(config, result)
    check_E015_damage_thresholds(config, result)
    check_E018_code_violations(config, result)

    # Financial consistency
    check_financial_consistency(config, result)

    # Photo validation
    check_photo_files(config, result)

    # Cross-field logic
    check_cross_field_logic(config, result)
    check_pitches_format(config, result)

    # Trade-specific mandatory items
    check_siding_mandatory_items(config, result)
    check_roofing_mandatory_items(config, result)

    # Shingle exposure validation
    check_shingle_exposure(config, result)

    # Dashboard
    check_dashboard(config, result)

    # NOAA weather intelligence
    check_noaa_weather(config, result)

    # If fix mode and changes were made, save back
    if fix_mode and result.fixes:
        # Remove _paths before saving
        config.pop("_paths", None)
        with open(config_path, "w") as f:
            json.dump(config, f, indent=2)
        result.note(f"Config saved with {len(result.fixes)} fix(es)")

    return result


def validate_all_claims(claims_dir, fix_mode=False, summary_only=False):
    """Validate all claim configs in the claims directory."""
    results = []
    claim_dirs = sorted(glob.glob(os.path.join(claims_dir, "*/claim_config.json")))

    if not claim_dirs:
        print(f"No claim configs found in {claims_dir}/")
        return 2

    print(f"\nValidating {len(claim_dirs)} claim configs...")
    print("=" * 60)

    total_errors = 0
    total_warnings = 0
    passed = 0
    failed = 0

    for config_path in claim_dirs:
        result = validate_config(config_path, fix_mode)
        results.append(result)

        if result.passed:
            passed += 1
        else:
            failed += 1

        total_errors += len(result.errors)
        total_warnings += len(result.warnings)

        result.print_report(verbose=not summary_only)

    print("\n" + "=" * 60)
    print(f"VALIDATION SUMMARY")
    print(f"  Claims:   {len(claim_dirs)}")
    print(f"  Passed:   {passed}")
    print(f"  Failed:   {failed}")
    print(f"  Errors:   {total_errors}")
    print(f"  Warnings: {total_warnings}")
    print("=" * 60)

    return 1 if failed > 0 else 0


# ===================================================================
# CLI
# ===================================================================

def main():
    parser = argparse.ArgumentParser(description="USARM Config Validator")
    parser.add_argument("config_path", nargs="?", help="Path to claim_config.json")
    parser.add_argument("--all", action="store_true", help="Validate all claims")
    parser.add_argument("--fix", action="store_true", help="Auto-fix known patterns")
    parser.add_argument("--summary", action="store_true", help="Summary only (no detail)")
    parser.add_argument("--claims-dir", default=None, help="Claims directory (default: claims/)")
    args = parser.parse_args()

    # Find claims directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    claims_dir = args.claims_dir or os.path.join(script_dir, "claims")

    if args.all:
        exit_code = validate_all_claims(claims_dir, args.fix, args.summary)
        sys.exit(exit_code)

    if not args.config_path:
        parser.print_help()
        sys.exit(2)

    config_path = args.config_path
    if not os.path.exists(config_path):
        print(f"ERROR: File not found: {config_path}")
        sys.exit(2)

    result = validate_config(config_path, args.fix)

    # Print results
    slug = os.path.basename(os.path.dirname(config_path))
    print(f"\nValidation: {slug}")
    print("=" * 60)

    for e in result.errors:
        print(f"  {e}")
    for w in result.warnings:
        print(f"  {w}")
    for f in result.fixes:
        print(f"  {f}")
    for i in result.info:
        print(f"  {i}")

    if result.passed:
        print(f"\n  PASSED ({len(result.warnings)} warning(s))")
    else:
        print(f"\n  FAILED ({len(result.errors)} error(s), {len(result.warnings)} warning(s))")

    sys.exit(0 if result.passed else 1)


if __name__ == "__main__":
    main()
