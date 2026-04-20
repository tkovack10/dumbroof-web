"""
Code upgrade & scope expansion trigger database.

State-specific code citations resolve dynamically from
`backend/building_codes/state_codes.json` — add a state to the JSON and
every trigger automatically cites the correct prefix. The `concept` field
on each trigger names which code_ref to pull (e.g. "ice_barrier").
"""

from typing import Dict, List, Optional, Any


# Triggers applicable to every state with a residential code (all 50 in our JSON).
# `concept` maps to a key in state_codes.json rows (ice_barrier, drip_edge,
# ventilation, house_wrap_corners, two_layer_tearoff). For ALL-state triggers
# that aren't code-specific (matching doctrine, manufacturer specs),
# `concept` is None and `static_codes` carries the fallback strings.
CODE_TRIGGERS = {
    "house_wrap_corner_rule": {
        "states": ["ALL"],
        "concept": "house_wrap_corners",
        "trigger": "Siding damage on ANY wall -> house wrap inspection -> often all 4 walls",
        "scope_multiplier": "1x->4x siding (biggest dollar driver)",
        "detection": "siding damage in scope + house wrap absent/damaged",
        "max_points": 6,
    },
    "two_layer_tearoff": {
        "states": ["ALL"],
        "concept": "two_layer_tearoff",
        "trigger": "2+ existing roof layers -> full tear-off mandatory on replacement",
        "scope_multiplier": "adds $2-5K for tear-off labor + disposal",
        "detection": "visible second layer OR edge cross-section photo",
        "max_points": 4,
    },
    "ice_water_shield": {
        "states": ["ALL"],
        "concept": "ice_barrier",
        "trigger": "I&W required at eaves on replacement even if not originally present",
        "scope_multiplier": "adds full eave perimeter I&W",
        "detection": "eave inspection - absent I&W = code upgrade",
        "max_points": 3,
    },
    "drip_edge": {
        "states": ["ALL"],
        "concept": "drip_edge",
        "trigger": "Drip edge required on replacement",
        "scope_multiplier": "adds full perimeter drip edge",
        "detection": "eave/rake inspection - absent drip edge",
        "max_points": 2,
    },
    "ventilation": {
        "states": ["ALL"],
        "concept": "ventilation",
        "trigger": "1:150 ratio NFA required on replacement",
        "scope_multiplier": "adds ridge vent, soffit vents, or both",
        "detection": "insufficient ventilation calculation",
        "max_points": 3,
    },
    "discontinued_product": {
        "states": ["ALL"],
        "concept": None,
        "static_codes": ["matching doctrine", "NAIC MDL-902"],
        "trigger": "Product discontinued -> spot repair impossible -> full replacement",
        "scope_multiplier": "repair->full replacement (10x+ scope)",
        "detection": "product_db.py identification",
        "max_points": 12,
    },
    "exposure_mismatch": {
        "states": ["ALL"],
        "concept": None,
        "static_codes": ["manufacturer specs", "aesthetic matching"],
        "trigger": '5" vs 5-5/8" exposure -> course lines misalign -> visible patch -> full replacement',
        "scope_multiplier": "repair->full replacement",
        "detection": "SHINGLE_IDENTIFICATION_PROMPT exposure_inches field",
        "max_points": 6,
    },
}


def get_triggers_for_state(state: str) -> Dict[str, dict]:
    """Return all triggers applicable to a given state. Every trigger in the
    dict runs for every state now (state-scoping happens at code-resolution
    time via get_codes_for_trigger), but the ALL-gate is kept for future
    regional triggers (e.g. a tornado-specific rule for TX/OK/KS only)."""
    result = {}
    state_upper = (state or "").upper()
    for name, trigger in CODE_TRIGGERS.items():
        if "ALL" in trigger["states"] or state_upper in trigger["states"]:
            result[name] = trigger
    return result


def get_codes_for_trigger(trigger_name: str, state: str) -> List[str]:
    """Return specific code references for a trigger in a given state.

    Resolution:
    1. If trigger has a `concept` key, resolve from state_codes.json for that state
       (e.g. "ice_barrier" → "RCO R905.1.2" for OH, "RCNYS R905.1.2" for NY).
    2. Otherwise return the trigger's `static_codes` list (matching doctrine,
       manufacturer specs, etc. — not jurisdictional).
    """
    trigger = CODE_TRIGGERS.get(trigger_name)
    if not trigger:
        return []
    # State-specific concept resolution
    concept = trigger.get("concept")
    if concept:
        # Late import to avoid circular refs at module load
        from building_codes import lookup as _bc_lookup
        ref = _bc_lookup.get_code_citation(state, concept)
        return [ref] if ref else []
    # Static / non-jurisdictional codes
    static = trigger.get("static_codes")
    if static:
        return list(static)
    return []


def evaluate_code_triggers(config: dict, state: str) -> Dict[str, Any]:
    """
    Evaluate all code triggers for a claim config.
    Returns dict with trigger results and total points.
    """
    triggers = get_triggers_for_state(state)
    results = {}
    total_points = 0
    triggered_codes = []

    forensic = config.get("forensic_findings", {})
    line_items = config.get("line_items", [])
    scope = config.get("scope_comparison", {})

    # CT1: House wrap corner rule
    if "house_wrap_corner_rule" in triggers:
        pts = _evaluate_house_wrap(config, line_items, forensic)
        results["house_wrap_corner_rule"] = {"points": pts, "max": 6}
        total_points += pts
        if pts > 0:
            triggered_codes.extend(get_codes_for_trigger("house_wrap_corner_rule", state))

    # CT2: Two-layer tear-off
    if "two_layer_tearoff" in triggers:
        pts = _evaluate_tearoff(config, forensic)
        results["two_layer_tearoff"] = {"points": pts, "max": 4}
        total_points += pts
        if pts > 0:
            triggered_codes.extend(get_codes_for_trigger("two_layer_tearoff", state))

    # CT3: Ice & water shield
    if "ice_water_shield" in triggers:
        pts = _evaluate_iw_shield(config, forensic)
        results["ice_water_shield"] = {"points": pts, "max": 3}
        total_points += pts
        if pts > 0:
            triggered_codes.extend(get_codes_for_trigger("ice_water_shield", state))

    # CT4: Drip edge
    if "drip_edge" in triggers:
        pts = _evaluate_drip_edge(config, forensic)
        results["drip_edge"] = {"points": pts, "max": 2}
        total_points += pts
        if pts > 0:
            triggered_codes.extend(get_codes_for_trigger("drip_edge", state))

    # CT5: Other code violations
    code_violations = forensic.get("code_violations", [])
    other_pts = min(5, len(code_violations))
    results["other_code_violations"] = {"points": other_pts, "max": 5}
    total_points += other_pts

    # Discontinued product (universal)
    if "discontinued_product" in triggers:
        pts = _evaluate_discontinued(config)
        results["discontinued_product"] = {"points": pts, "max": 12}
        total_points += pts
        if pts > 0:
            triggered_codes.extend(get_codes_for_trigger("discontinued_product", state))

    # Exposure mismatch (universal)
    if "exposure_mismatch" in triggers:
        pts = _evaluate_exposure_mismatch(config)
        results["exposure_mismatch"] = {"points": pts, "max": 6}
        total_points += pts
        if pts > 0:
            triggered_codes.extend(get_codes_for_trigger("exposure_mismatch", state))

    return {
        "triggers": results,
        "total_points": min(20, total_points),
        "triggered_codes": triggered_codes,
    }


def _evaluate_house_wrap(config: dict, line_items: list, forensic: dict) -> int:
    """Evaluate house wrap corner rule trigger (0-6)."""
    # Check for siding in line items
    siding_items = [li for li in line_items
                    if any(kw in str(li.get("description", "")).lower()
                           for kw in ["siding", "house wrap", "housewrap", "wall"])]
    if not siding_items:
        return 0

    # Check for house wrap in line items (full replacement indicator)
    has_house_wrap = any("house wrap" in str(li.get("description", "")).lower()
                         or "housewrap" in str(li.get("description", "")).lower()
                         for li in line_items)

    # Check forensic findings for house wrap mention
    forensic_text = str(forensic)
    house_wrap_mentioned = any(kw in forensic_text.lower()
                               for kw in ["house wrap", "housewrap", "r703", "water-resistive"])

    if has_house_wrap and house_wrap_mentioned:
        return 6  # Full trigger confirmed
    elif has_house_wrap or house_wrap_mentioned:
        return 3  # Siding damage, trigger possible
    elif siding_items:
        return 3  # Siding in scope, trigger possible
    return 0


def _evaluate_tearoff(config: dict, forensic: dict) -> int:
    """Evaluate tear-off requirement trigger (0-4)."""
    forensic_text = str(forensic).lower()
    line_items = config.get("line_items", [])
    li_text = str(line_items).lower()

    has_tearoff = any(kw in li_text for kw in ["tear off", "tear-off", "tearoff", "remove roofing"])
    two_layers = any(kw in forensic_text
                     for kw in ["two layer", "2 layer", "second layer", "multiple layer",
                                "double layer"])

    if has_tearoff and two_layers:
        return 4  # Confirmed 2+ layers
    elif has_tearoff or two_layers:
        return 2  # Possible second layer
    return 0


def _evaluate_iw_shield(config: dict, forensic: dict) -> int:
    """Evaluate ice & water shield trigger (0-3)."""
    line_items = config.get("line_items", [])
    li_text = str(line_items).lower()
    forensic_text = str(forensic).lower()

    has_iw = any(kw in li_text for kw in ["ice & water", "ice and water", "i&w", "ice/water"])

    if "no ice" in forensic_text or "absent" in forensic_text and "ice" in forensic_text:
        return 3  # No I&W present — code upgrade
    elif has_iw:
        return 1  # I&W in scope but status unknown
    return 0


def _evaluate_drip_edge(config: dict, forensic: dict) -> int:
    """Evaluate drip edge trigger (0-2)."""
    line_items = config.get("line_items", [])
    li_text = str(line_items).lower()
    forensic_text = str(forensic).lower()

    has_drip = "drip edge" in li_text

    if "no drip edge" in forensic_text or ("absent" in forensic_text and "drip" in forensic_text):
        return 2  # No drip edge — code upgrade
    elif has_drip:
        return 0  # Drip edge present/in scope
    return 0


def _evaluate_discontinued(config: dict) -> int:
    """Evaluate discontinued product trigger (0-12). Uses scoring_data if available."""
    scoring = config.get("_scoring_data", {})
    product = scoring.get("product_match", {})
    if product.get("matched"):
        return product.get("tas_boost", 0)

    # Fallback: check forensic findings for discontinuation mentions
    forensic_text = str(config.get("forensic_findings", {})).lower()
    if any(kw in forensic_text for kw in ["t-lock", "tlock", "organic mat"]):
        return 12
    elif "discontinued" in forensic_text:
        return 6
    return 0


def _evaluate_exposure_mismatch(config: dict) -> int:
    """Evaluate exposure mismatch trigger (0-6)."""
    scoring = config.get("_scoring_data", {})
    product = scoring.get("product_match", {})

    if product.get("matched"):
        exposure = product.get("exposure_inches", 0)
        # Standard modern 3-tab is 5-5/8". Old 3-tabs were 5".
        if exposure and exposure < 5.5:
            return 6  # Major mismatch (5" vs 5-5/8")
        elif exposure and abs(exposure - 5.625) > 0.125:
            return 4  # Moderate mismatch
    return 0
