"""
Technical Approval Score algorithm — claim viability scoring (0-100%).
Factors in damage + product + code triggers + carrier intelligence + scope.

Config-only mode mines key_arguments, code_violations, conclusion_findings,
and line_items for technical leverage signals.
"""

import os
import json
import re
from typing import Dict, Any, Optional, List

from damage_scoring.models import (
    TechnicalApprovalResult,
    ProductFactor,
    CodeTriggerFactor,
    CarrierFactor,
    ScopeFactor,
    DamageScoreResult,
    ProductMatch,
)
from damage_scoring.code_triggers import evaluate_code_triggers
from damage_scoring.product_db import match_product


def _get_all_forensic_text(config: dict) -> str:
    """Combine all forensic text fields for keyword mining."""
    forensic = config.get("forensic_findings", {})
    parts = []
    for key in ("damage_summary", "recommended_scope"):
        val = forensic.get(key, "")
        if isinstance(val, str):
            parts.append(val)
    for key in ("key_arguments", "conclusion_findings"):
        val = forensic.get(key, [])
        if isinstance(val, list):
            for item in val:
                if isinstance(item, str):
                    parts.append(item)
    for key in ("critical_observations",):
        val = forensic.get(key, [])
        if isinstance(val, list):
            for item in val:
                if isinstance(item, dict):
                    parts.extend(str(v) for v in item.values())
    return " ".join(parts).lower()


def compute_approval_score(
    config: dict,
    damage_result: DamageScoreResult,
    product_match: Optional[ProductMatch] = None,
    analysis: Optional[dict] = None,
) -> TechnicalApprovalResult:
    """
    Compute Technical Approval Score from all available factors.

    Args:
        config: Full claim_config.json dict
        damage_result: Computed DamageScoreResult
        product_match: Product DB match result (if available)
        analysis: EnhancedAnalyzer results (if available)

    Returns:
        TechnicalApprovalResult with all component breakdowns
    """
    result = TechnicalApprovalResult()

    # Component 1: Damage Factor (35% of TAS)
    result.damage_factor_pts = _damage_to_factor(damage_result.score)

    # Component 2: Product Factor (25% of TAS)
    result.product = _score_product_factor(config, product_match, analysis)

    # Component 3: Code Trigger Factor (20% of TAS)
    result.code_triggers = _score_code_triggers(config)

    # Component 4: Carrier Factor (10% of TAS)
    result.carrier = _score_carrier_factor(config)

    # Component 5: Scope Factor (10% of TAS)
    result.scope = _score_scope_factor(config)

    return result


def _damage_to_factor(ds: int) -> int:
    """Convert Damage Score to TAS damage factor points (0-35)."""
    if ds >= 90:
        return 35
    elif ds >= 80:
        return 30
    elif ds >= 70:
        return 25
    elif ds >= 60:
        return 20
    elif ds >= 50:
        return 15
    elif ds >= 35:
        return 10
    elif ds >= 20:
        return 5
    return 0


def _score_product_factor(
    config: dict,
    product_match: Optional[ProductMatch],
    analysis: Optional[dict],
) -> ProductFactor:
    """Component 2: Product Factor (0-25 pts)."""
    pf = ProductFactor()

    # Try to get product match from analysis if not provided
    if not product_match and analysis:
        shingle_id = analysis.get("shingle_id", {})
        if shingle_id:
            product_match = match_product(
                manufacturer=shingle_id.get("manufacturer_guess", ""),
                product_line=shingle_id.get("product_line_guess", ""),
                product_type=shingle_id.get("shingle_type", ""),
                exposure_inches=shingle_id.get("exposure_inches", 0),
            )

    # Try from config forensic findings
    if not product_match or not product_match.matched:
        forensic = config.get("forensic_findings", {})
        roof_material = forensic.get("roof_material", "")
        if roof_material:
            # Parse material string for clues
            parts = roof_material.lower().split()
            mfr = ""
            line = ""
            ptype = ""
            if "three-tab" in roof_material.lower() or "3-tab" in roof_material.lower():
                ptype = "three_tab"
            elif "architectural" in roof_material.lower():
                ptype = "architectural"
            elif "t-lock" in roof_material.lower():
                ptype = "t_lock"
            product_match = match_product(
                manufacturer=mfr,
                product_line=line,
                product_type=ptype,
            )

    if product_match and product_match.matched:
        pf.manufacturer = product_match.manufacturer
        pf.product_name = product_match.product_line
        pf.status = product_match.status

        # P1: Discontinuation Status (0-12)
        pf.discontinuation_status = product_match.tas_boost

        # P2: Exposure Mismatch (0-6)
        if product_match.exposure_inches:
            exp = product_match.exposure_inches
            if exp < 5.25:
                pf.exposure_mismatch = 6  # Major: 5" vs 5-5/8"
            elif exp < 5.5:
                pf.exposure_mismatch = 4  # Moderate
            elif abs(exp - 5.625) > 0.125:
                pf.exposure_mismatch = 2  # Minor

        # P3: Color/Style Match (0-4)
        diff = product_match.matching_difficulty
        if diff == "impossible":
            pf.color_style_match = 4
        elif diff == "hard":
            pf.color_style_match = 2
        elif diff == "moderate":
            pf.color_style_match = 1

        # P4: ITEL/NTS Confirmation (0-3)
        # Check config for lab reports
        forensic = config.get("forensic_findings", {})
        forensic_text = str(forensic).lower()
        if "itel" in forensic_text:
            pf.itel_nts_confirmation = 3
        elif "nts" in forensic_text and "discontinu" in forensic_text:
            pf.itel_nts_confirmation = 2
        elif "nts" in forensic_text or "lab report" in forensic_text:
            pf.itel_nts_confirmation = 1

    return pf


def _score_code_triggers(config: dict) -> CodeTriggerFactor:
    """Component 3: Code Trigger Factor (0-20 pts)."""
    ct = CodeTriggerFactor()

    # Determine state
    property_info = config.get("property", {})
    state = property_info.get("state", "")
    if not state:
        # Try to infer from address
        address = property_info.get("address", "") + " " + property_info.get("city_state_zip", "")
        if "NY" in address or "New York" in address:
            state = "NY"
        elif "PA" in address or "Pennsylvania" in address:
            state = "PA"
        elif "NJ" in address or "New Jersey" in address:
            state = "NJ"

    if not state:
        state = "NY"  # Default to NY (primary market)

    # Evaluate code triggers from structured data
    trigger_results = evaluate_code_triggers(config, state)
    triggers = trigger_results.get("triggers", {})

    ct.house_wrap_corner_rule = triggers.get("house_wrap_corner_rule", {}).get("points", 0)
    ct.tearoff_requirement = triggers.get("two_layer_tearoff", {}).get("points", 0)
    ct.ice_water_shield = triggers.get("ice_water_shield", {}).get("points", 0)
    ct.drip_edge = triggers.get("drip_edge", {}).get("points", 0)
    ct.other_code_violations = triggers.get("other_code_violations", {}).get("points", 0)
    ct.triggered_codes = trigger_results.get("triggered_codes", [])

    # Boost from key_arguments and forensic text mining
    all_text = _get_all_forensic_text(config)

    # House wrap detection from text
    if ct.house_wrap_corner_rule == 0:
        if any(kw in all_text for kw in ["house wrap", "housewrap", "water-resistive",
                                           "r703", "corner rule"]):
            ct.house_wrap_corner_rule = 3
            if "all wall" in all_text or "all four" in all_text or "4 wall" in all_text:
                ct.house_wrap_corner_rule = 6

    # Tear-off from text
    if ct.tearoff_requirement == 0:
        if any(kw in all_text for kw in ["tear-off", "tear off", "tearoff",
                                           "two layer", "2 layer", "second layer"]):
            ct.tearoff_requirement = 2
            if "mandatory" in all_text or "required" in all_text:
                ct.tearoff_requirement = 4

    # I&W from text
    if ct.ice_water_shield == 0:
        if "ice" in all_text and "water" in all_text and "shield" in all_text:
            ct.ice_water_shield = 1
            if "code upgrade" in all_text or "not present" in all_text:
                ct.ice_water_shield = 3

    # Drip edge from text
    if ct.drip_edge == 0:
        if "drip edge" in all_text and any(kw in all_text for kw in ["absent", "missing", "code"]):
            ct.drip_edge = 2

    # Code violations from text
    code_violations = config.get("forensic_findings", {}).get("code_violations", [])
    if len(code_violations) > ct.other_code_violations:
        ct.other_code_violations = min(5, len(code_violations))

    return ct


def _score_carrier_factor(config: dict) -> CarrierFactor:
    """Component 4: Carrier Factor (0-10 pts)."""
    cf = CarrierFactor()

    carrier = config.get("carrier", {})
    carrier_name = carrier.get("name", "")
    cf.carrier_name = carrier_name

    if not carrier_name:
        return cf

    # Load carrier playbook intelligence
    playbook = _load_carrier_playbook(carrier_name)

    # CF1: Carrier Win Rate (0-5)
    win_rate = playbook.get("win_rate")
    if win_rate is not None:
        if win_rate > 80:
            cf.win_rate = 5
        elif win_rate > 60:
            cf.win_rate = 4
        elif win_rate > 40:
            cf.win_rate = 3
        elif win_rate > 20:
            cf.win_rate = 2
    else:
        # Default based on known carriers
        carrier_lower = carrier_name.lower()
        if "state farm" in carrier_lower:
            cf.win_rate = 4  # 71.4% historical
            cf.historical_wins = 5
            cf.historical_losses = 2
        elif "liberty mutual" in carrier_lower:
            cf.win_rate = 2  # Tends to fully deny
        elif "allstate" in carrier_lower:
            cf.win_rate = 3
        elif "nycm" in carrier_lower:
            cf.win_rate = 3
        elif "assurant" in carrier_lower:
            cf.win_rate = 2  # CRU inspectors, aggressive depreciation
        else:
            cf.win_rate = 3  # Default middle

    # CF2: Carrier Behavior (0-5)
    behavior = playbook.get("behavior")
    if behavior:
        behavior_map = {
            "aggressive": 0,
            "selective": 2,
            "negotiator": 3,
            "reasonable": 5,
        }
        cf.behavior = behavior_map.get(behavior, 3)
    else:
        carrier_lower = carrier_name.lower()
        if "liberty mutual" in carrier_lower:
            cf.behavior = 0  # Aggressive — full denials
        elif "assurant" in carrier_lower:
            cf.behavior = 1  # Aggressive with CRU
        elif "state farm" in carrier_lower:
            cf.behavior = 3  # Negotiator — will revise with evidence
        elif "progressive" in carrier_lower:
            cf.behavior = 2  # Selective
        else:
            cf.behavior = 3  # Default

    return cf


def _load_carrier_playbook(carrier_name: str) -> dict:
    """Try to load carrier playbook JSON for intelligence."""
    base_dir = os.path.join(os.path.dirname(__file__), "..", "carrier_playbooks")
    slug = carrier_name.lower().replace(" ", "-").replace(",", "").replace(".", "")

    # Try JSON first (most structured)
    json_path = os.path.join(base_dir, f"{slug}.json")
    if os.path.isfile(json_path):
        try:
            with open(json_path, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass

    return {}


def _score_scope_factor(config: dict) -> ScopeFactor:
    """Component 5: Scope Factor (0-10 pts)."""
    sf = ScopeFactor()

    line_items = config.get("line_items", [])
    all_text = _get_all_forensic_text(config)
    li_text = str(line_items).lower()

    # SF1: Trade Count (0-5)
    trades = _identify_trades(line_items)
    # Also check key_arguments for trade mentions not in line items
    if "siding" in all_text and "siding" not in trades:
        trades.append("siding")
    if "gutter" in all_text and "gutters" not in trades:
        trades.append("gutters")
    if "window" in all_text and "windows" not in trades:
        # Only add if damage context, not just "window wrap"
        if any(kw in all_text for kw in ["window damage", "window replacement", "window screen"]):
            trades.append("windows")
    sf.trades_identified = sorted(set(trades))
    trade_count = len(sf.trades_identified)
    if trade_count >= 4:
        sf.trade_count = 5
    elif trade_count >= 3:
        sf.trade_count = 4  # O&P trigger!
    elif trade_count >= 2:
        sf.trade_count = 2
    elif trade_count >= 1:
        sf.trade_count = 1

    # Also check for explicit O&P arguments
    if "overhead" in all_text and "profit" in all_text:
        sf.trade_count = max(sf.trade_count, 4)
    if "o&p" in all_text or "o & p" in all_text:
        sf.trade_count = max(sf.trade_count, 4)

    # SF2: Collateral Damage (0-3)
    combined = all_text + " " + li_text
    has_gutters = "gutter" in combined or "downspout" in combined
    has_siding = "siding" in combined
    has_windows_interior = any(kw in combined for kw in
                                ["window", "interior", "drywall", "ceiling"])

    collateral = 0
    if has_gutters:
        collateral += 1
    if has_siding:
        collateral += 1
    if has_windows_interior:
        collateral += 1
    sf.collateral_damage = min(3, collateral)

    # SF3: Matching Arguments (0-2)
    if any(kw in all_text for kw in ["full matching", "all elevations",
                                       "naic", "mdl-902", "uniform appearance"]):
        sf.matching_arguments = 2
    elif "matching" in all_text:
        sf.matching_arguments = 1

    return sf


def _identify_trades(line_items: list) -> List[str]:
    """Identify unique trades from line items."""
    trades = set()
    for li in line_items:
        desc = str(li.get("description", "")).lower()
        category = str(li.get("category", "")).lower()
        combined = desc + " " + category

        if any(kw in combined for kw in ["roof", "shingle", "underlayment", "ridge",
                                          "starter", "drip edge", "flashing", "ice & water",
                                          "felt", "deck", "ventilation"]):
            trades.add("roofing")
        if any(kw in combined for kw in ["siding", "house wrap", "wall"]):
            trades.add("siding")
        if any(kw in combined for kw in ["gutter", "downspout"]):
            trades.add("gutters")
        if any(kw in combined for kw in ["window", "glass"]):
            trades.add("windows")
        if any(kw in combined for kw in ["interior", "drywall", "ceiling", "paint", "plaster"]):
            trades.add("interior")
        if any(kw in combined for kw in ["fascia", "soffit", "trim"]):
            trades.add("trim")
        if any(kw in combined for kw in ["fence", "shed", "garage", "screen"]):
            trades.add("exterior_structures")

    return sorted(trades)
