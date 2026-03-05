"""
Claim config integration — merge scores into claim_config.json.
"""

import json
import os
from typing import Dict, Any

from damage_scoring.models import DualScoreResult


def merge_scores_to_config(result: DualScoreResult, config_path: str) -> bool:
    """
    Merge dual scores into claim_config.json.
    Writes to the 'scoring' section of the config.

    Returns True on success.
    """
    if not os.path.isfile(config_path):
        print(f"  Error: Config not found: {config_path}")
        return False

    with open(config_path, "r") as f:
        config = json.load(f)

    # Build scoring section
    scoring = {
        "damage_score": result.damage.score,
        "damage_grade": result.damage.grade,
        "approval_score": result.approval.score,
        "approval_grade": result.approval.grade,
        "damage_breakdown": result.damage.to_dict(),
        "approval_breakdown": result.approval.to_dict(),
    }

    # Product intelligence
    if result.product_match and result.product_match.matched:
        pm = result.product_match
        scoring["product_intelligence"] = {
            "manufacturer": pm.manufacturer,
            "product_line": pm.product_line,
            "product_type": pm.product_type,
            "exposure_inches": pm.exposure_inches,
            "status": pm.status,
            "discontinuation_year": pm.discontinuation_year,
            "matching_difficulty": pm.matching_difficulty,
            "car_repairability": pm.car_repairability,
            "tas_boost": pm.tas_boost,
            "forensic_language": _generate_product_language(pm),
        }

    scoring["scorer_version"] = "1.1.0"

    config["scoring"] = scoring

    # Auto-populate repairability section if exposure data indicates unrepairable
    _auto_populate_repairability(config, result)

    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)

    print(f"  Scores merged into {config_path}")
    return True


def _generate_product_language(pm) -> str:
    """
    Generate forensic-appropriate product identification language.
    Uses 'this appears to be' phrasing per USARM forensic standards.
    """
    parts = []

    if pm.manufacturer and pm.product_line:
        parts.append(
            f"Based on visual characteristics including tab geometry, granule blend, "
            f"and exposure measurement, this appears to be a {pm.manufacturer} "
            f"{pm.product_line} {pm.product_type.replace('_', ' ')} shingle"
        )
    elif pm.product_type:
        parts.append(
            f"This appears to be a {pm.product_type.replace('_', ' ')} shingle"
        )

    if pm.exposure_inches:
        parts.append(f"with approximately {pm.exposure_inches}\" exposure")

    if pm.status in ("discontinued", "universally_discontinued"):
        year = f" (circa {pm.discontinuation_year})" if pm.discontinuation_year else ""
        parts.append(
            f". This product appears to be discontinued{year}. "
            f"No compatible replacement with matching profile and exposure is currently available"
        )
        if pm.matching_difficulty == "impossible":
            parts.append(
                ", making spot repair impossible without creating a visible "
                "mismatch in course alignment and aesthetic appearance"
            )

    return ". ".join(p.strip(". ") for p in parts if p) + "."


def _auto_populate_repairability(config: dict, result: DualScoreResult) -> None:
    """
    Auto-populate forensic_findings.repairability from scoring data
    when exposure indicates an unrepairable condition.
    Does NOT overwrite manually-set repairability data.
    """
    findings = config.setdefault("forensic_findings", {})
    if findings.get("repairability"):
        return  # Already set manually — don't overwrite

    # Get exposure from scoring data
    scoring = config.get("scoring", {})
    photo_analysis = scoring.get("photo_analysis", {})
    product_intel = scoring.get("product_intelligence", {})

    exposure = None
    for src in [photo_analysis, product_intel]:
        for key in ("measured_exposure_inches", "exposure_inches", "exposure_inches_estimate", "exposure_guess"):
            val = src.get(key)
            if val and isinstance(val, (int, float)) and val > 0:
                exposure = float(val)
                break
        if exposure:
            break

    if not exposure:
        return

    is_old_exposure = exposure <= 5.25

    if not is_old_exposure:
        return  # Current metric — no repairability section needed

    # Determine product type
    shingle_type = photo_analysis.get("shingle_type", "")
    structures = config.get("structures", [{}])
    struct_type = structures[0].get("shingle_type", "").lower() if structures else ""

    is_three_tab = shingle_type == "three_tab" or "3-tab" in struct_type or "three-tab" in struct_type
    is_laminate = shingle_type in ("architectural", "laminate") or "architectural" in struct_type or "laminate" in struct_type

    product_label = "three-tab" if is_three_tab else "laminate/architectural" if is_laminate else "asphalt"

    mfr = product_intel.get("manufacturer", photo_analysis.get("manufacturer_guess", ""))
    product_name = product_intel.get("product_line", photo_analysis.get("product_line_guess", ""))

    reasons = [
        f"No manufacturer currently produces {product_label} shingles with {exposure}-inch exposure",
        "Nailing zones incompatible between standard (5\") and metric (5-5/8\") dimensions (ref: GAF Technical Details SS-TS-03 vs SS-TS-03a)",
        "Self-sealing adhesive strips misalign, compromising wind resistance",
        f"5/8-inch per-course offset compounds to 12.5 inches over 20 courses",
        "Field cutting does not resolve nailing zone incompatibility and voids manufacturer warranty",
        "Haag Engineering (May 2024) study confirmed mismatched nailing patterns, exposed nails, and compromised wind resistance in this exact repair scenario",
    ]

    if is_three_tab:
        reasons.append("All major manufacturers have discontinued three-tab shingle production entirely")

    bulletins = ["GAF SS-TS-03 vs SS-TS-03a", "Haag Engineering May 2024", "CertainTeed NailTrak Installation Guide", "IKO Exposure Warning"]

    repairability = {
        "measured_exposure_inches": exposure,
        "exposure_type": "pre_metric_standard",
        "determination": "unrepairable",
        "reasons": reasons,
        "manufacturer_bulletins_cited": bulletins,
        "conclusion": f"Full replacement of the roof system is the only method of repair that restores the property to its pre-loss condition in compliance with manufacturer installation requirements and applicable building codes.",
    }

    if mfr:
        repairability["manufacturer"] = mfr
    if product_name:
        repairability["product_line"] = product_name
        repairability["product_identified"] = f"{mfr} {product_name}".strip()

    findings["repairability"] = repairability


def build_db_record(result: DualScoreResult, config: dict) -> dict:
    """Build a flat dict suitable for Supabase upsert."""
    pm = result.product_match

    record = {
        "claim_slug": result.claim_slug,
        "address": result.address,
        "city": result.city,
        "state": result.state,
        "zip_code": result.zip_code,
        "county": result.county,
        "lat": result.lat,
        "lon": result.lon,

        "damage_score": result.damage.score,
        "damage_grade": result.damage.grade,
        "ds_roof_surface": result.damage.roof_surface.total,
        "ds_evidence_cascade": result.damage.evidence_cascade.total,
        "ds_soft_metal": result.damage.soft_metal.total,
        "ds_documentation": result.damage.documentation.total,

        "approval_score": result.approval.score,
        "approval_grade": result.approval.grade,
        "tas_damage_factor": result.approval.damage_factor_pts,
        "tas_product_factor": result.approval.product.total,
        "tas_code_triggers": result.approval.code_triggers.total,
        "tas_carrier_factor": result.approval.carrier.total,
        "tas_scope_factor": result.approval.scope.total,

        "product_manufacturer": pm.manufacturer if pm else None,
        "product_line": pm.product_line if pm else None,
        "product_status": pm.status if pm else None,
        "product_discontinuation_year": pm.discontinuation_year if pm else None,
        "exposure_inches": pm.exposure_inches if pm else None,

        "triggered_codes": result.approval.code_triggers.triggered_codes,
        "house_wrap_triggered": result.approval.code_triggers.house_wrap_corner_rule > 0,
        "tearoff_required": result.approval.code_triggers.tearoff_requirement > 0,

        "carrier_name": result.approval.carrier.carrier_name,

        "carrier_initial_rcv": config.get("carrier", {}).get("carrier_1st_scope"),
        "carrier_final_rcv": config.get("carrier", {}).get("carrier_current"),
        "usarm_rcv": config.get("financials", {}).get("total_rcv"),

        "full_breakdown": json.dumps(result.to_dict()),
        "photos_analyzed": result.analysis_metadata.get("photos_found", 0),
        "analysis_mode": result.analysis_metadata.get("mode", "config_only"),
    }

    # Set outcome from dashboard
    dashboard = config.get("dashboard", {})
    status = dashboard.get("status", "")
    if status in ("won", "lost"):
        record["outcome"] = status
    else:
        record["outcome"] = "pending"

    return record
