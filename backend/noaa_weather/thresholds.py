"""
Master damage threshold registry — scientifically-backed thresholds per material.
Sources: HAAG Engineering, Koontz/White Research, IBHS, UL 2218, manufacturer testing.
"""

import re
from typing import Optional, List, Dict


DAMAGE_THRESHOLDS = {
    # ========================
    # ROOFING — ASPHALT SHINGLES
    # ========================
    "3-tab_shingle_new": {
        "material": "3-Tab Asphalt Shingles",
        "threshold_inches": 1.00,
        "display": '1.00" diameter hail',
        "source": "HAAG Engineering — functional mat fracture threshold for standard asphalt shingles",
        "notes": "New condition. Aged shingles (15+ years) fracture at 0.75\" per Koontz/White aging study",
    },
    "3-tab_shingle_aged": {
        "material": "3-Tab Asphalt Shingles (Aged 15+ Years)",
        "threshold_inches": 0.75,
        "display": '0.75" diameter hail',
        "source": "Koontz/White Research — 3 of 5 aged specimens fractured at 1\" (threshold onset ~0.75\")",
        "notes": "Age is the dominant variable in hail vulnerability per peer-reviewed research",
    },
    "laminate_shingle_new": {
        "material": "Laminate/Architectural Shingles",
        "threshold_inches": 1.00,
        "display": '1.00" diameter hail',
        "source": "HAAG Engineering — functional damage threshold for laminated asphalt shingles",
        "notes": "Laminate overlay provides slightly more impact resistance than 3-tab but same threshold",
    },
    "laminate_shingle_aged": {
        "material": "Laminate/Architectural Shingles (Aged 15+ Years)",
        "threshold_inches": 0.75,
        "display": '0.75" diameter hail',
        "source": "IBHS Sub-Severe Hail Study (2025) — 10x susceptibility after prior impacts + Koontz/White aging data",
        "notes": "IBHS: decade of aging equivalent in 2 years from repeated sub-severe impacts",
    },
    # ========================
    # SOFT METALS
    # ========================
    "aluminum_siding": {
        "material": "Aluminum Siding",
        "threshold_inches": 0.75,
        "display": '0.75" diameter hail',
        "source": "Industry standard — soft aluminum permanently deforms at low impact energy",
        "notes": "Cannot be un-dented. Replacement required.",
    },
    "aluminum_gutters": {
        "material": "Aluminum Gutters & Downspouts",
        "threshold_inches": 0.75,
        "display": '0.75" diameter hail',
        "source": "Industry standard — .027\"-.032\" aluminum deforms readily",
        "notes": "Best corroborating evidence for hail claims — horizontal and fully exposed",
    },
    "aluminum_window_wraps": {
        "material": "Aluminum Window Wraps/Capping",
        "threshold_inches": 0.75,
        "display": '0.75" diameter hail',
        "source": "Industry standard — thin gauge aluminum coil stock",
        "notes": "Commonly missed by adjusters — always check",
    },
    "aluminum_fascia": {
        "material": "Aluminum Fascia/Trim Metal",
        "threshold_inches": 0.75,
        "display": '0.75" diameter hail',
        "source": "Industry standard",
        "notes": "",
    },
    # ========================
    # SIDING
    # ========================
    "vinyl_siding": {
        "material": "Vinyl Siding",
        "threshold_inches": 1.00,
        "display": '1.00" diameter hail',
        "source": "Industry standard — vinyl becomes brittle below 40\u00b0F, reducing threshold significantly",
        "notes": "Cold weather events: threshold drops to ~0.75\". Check storm temperature.",
    },
    "vinyl_siding_cold": {
        "material": "Vinyl Siding (Storm Temp Below 40\u00b0F)",
        "threshold_inches": 0.75,
        "display": '0.75" diameter hail',
        "source": "Vinyl brittleness below 40\u00b0F — shattering vs. denting behavior change",
        "notes": "Document storm temperature. Vinyl cracks/shatters instead of flexing.",
    },
    "cedar_shake_siding": {
        "material": "Cedar Shake Siding",
        "threshold_inches": 1.25,
        "display": '1.25" diameter hail',
        "source": "HAAG Engineering — wood fiber resilience provides moderate impact resistance",
        "notes": "Aged/dry cedar is more vulnerable. Check moisture content.",
    },
    # ========================
    # SPECIALTY ROOFING
    # ========================
    "metal_roof_29ga": {
        "material": "Metal Roofing (29-Gauge)",
        "threshold_inches": 0.75,
        "display": '0.75" diameter hail',
        "source": "Lightest residential gauge — dents from even small hail",
        "notes": "Check for cosmetic damage exclusion endorsement in policy",
    },
    "metal_roof_26ga": {
        "material": "Metal Roofing (26-Gauge)",
        "threshold_inches": 1.00,
        "display": '1.00" diameter hail',
        "source": "Standard residential gauge — moderate dent resistance",
        "notes": "If PVDF/Kynar coating cracked at dent = functional damage (corrosion pathway)",
    },
    "metal_roof_24ga": {
        "material": "Metal Roofing (24-Gauge)",
        "threshold_inches": 1.25,
        "display": '1.25" diameter hail',
        "source": "Heaviest residential gauge — most dent-resistant",
        "notes": "",
    },
    "clay_tile": {
        "material": "Clay Tile (Ludowici/Similar)",
        "threshold_inches": 1.25,
        "display": '1.25" diameter hail',
        "source": "Varies by profile thickness. Thin profiles vulnerable to cracking/spalling.",
        "notes": "Check underside for hidden fractures. Damage frequently on under-surface.",
    },
    "slate_soft": {
        "material": "Soft Slate (PA/NY Quarries)",
        "threshold_inches": 1.00,
        "display": '1.00" diameter hail',
        "source": "Higher water absorption = lower impact resistance. Aged soft slate is very vulnerable.",
        "notes": "40+ year soft slate may fracture at 0.75\"",
    },
    "slate_hard": {
        "material": "Hard Slate (VT/VA Quarries)",
        "threshold_inches": 1.50,
        "display": '1.50" diameter hail',
        "source": "Dense, low absorption. Highly hail-resistant but not immune.",
        "notes": "Punctures from large hail are definitive functional damage",
    },
}


# ========================
# KEYWORD → THRESHOLD KEY MAPPING
# ========================

# Each tuple: (regex_pattern, threshold_key_new, threshold_key_aged)
MATERIAL_PATTERNS = [
    # 3-tab shingles
    (r"3[\-\s]?tab|three[\-\s]?tab|strip\s+shingle", "3-tab_shingle_new", "3-tab_shingle_aged"),
    # Laminate/architectural shingles
    (r"laminate|architectural|dimensional|timberline|landmark|duration|owens\s*corning|certainteed|iko\s+cambridge",
     "laminate_shingle_new", "laminate_shingle_aged"),
    # Aluminum siding
    (r"aluminum\s+siding|aluminium\s+siding", "aluminum_siding", "aluminum_siding"),
    # Vinyl siding
    (r"vinyl\s+siding", "vinyl_siding", "vinyl_siding"),
    # Cedar
    (r"cedar\s+shake|wood\s+shake|wood\s+siding", "cedar_shake_siding", "cedar_shake_siding"),
    # Gutters
    (r"gutter|downspout", "aluminum_gutters", "aluminum_gutters"),
    # Window wraps
    (r"window\s+wrap|window\s+cap|aluminum\s+cap", "aluminum_window_wraps", "aluminum_window_wraps"),
    # Fascia
    (r"fascia|trim\s+metal|drip\s+edge", "aluminum_fascia", "aluminum_fascia"),
    # Metal roofing
    (r"29[\-\s]?ga(?:uge)?|metal\s+roof.*29", "metal_roof_29ga", "metal_roof_29ga"),
    (r"26[\-\s]?ga(?:uge)?|metal\s+roof.*26", "metal_roof_26ga", "metal_roof_26ga"),
    (r"24[\-\s]?ga(?:uge)?|metal\s+roof.*24", "metal_roof_24ga", "metal_roof_24ga"),
    # Generic metal roof defaults to 26ga
    (r"metal\s+roof|standing\s+seam", "metal_roof_26ga", "metal_roof_26ga"),
    # Tile
    (r"clay\s+tile|ludowici|terra\s*cotta", "clay_tile", "clay_tile"),
    # Slate
    (r"soft\s+slate|pa\s+slate|ny\s+slate", "slate_soft", "slate_soft"),
    (r"hard\s+slate|vt\s+slate|va\s+slate|vermont\s+slate", "slate_hard", "slate_hard"),
    (r"slate", "slate_soft", "slate_soft"),  # Default slate = soft (conservative)
]


def get_threshold(key: str) -> Optional[Dict]:
    """Look up a threshold by its registry key."""
    return DAMAGE_THRESHOLDS.get(key)


def detect_materials_from_config(config: dict) -> List[Dict]:
    """
    Auto-detect materials from a claim config and return matching thresholds.
    Reads from structures, line_items, and scope.trades.
    Returns list of {key, material, threshold_inches, source, ...}
    """
    materials_found = {}  # key -> threshold dict (dedup by key)

    # Determine age
    is_aged = _is_aged_roof(config)

    # Source 1: structures[].shingle_type
    for struct in config.get("structures", []):
        shingle = struct.get("shingle_type", "")
        if shingle:
            _match_material(shingle, is_aged, materials_found)
        material = struct.get("material", "")
        if material:
            _match_material(material, is_aged, materials_found)

    # Source 2: line_items[].description
    for item in config.get("line_items", []):
        desc = str(item.get("description", ""))
        _match_material(desc, is_aged, materials_found)

    # Source 3: scope.trades — infer materials from trade types
    trades = config.get("scope", {}).get("trades", [])
    trade_str = " ".join(str(t) for t in trades).lower()
    if "gutter" in trade_str and "aluminum_gutters" not in materials_found:
        key = "aluminum_gutters"
        materials_found[key] = DAMAGE_THRESHOLDS[key].copy()
        materials_found[key]["key"] = key
    if "siding" in trade_str:
        # Try to detect siding type from line items, default to vinyl
        has_siding = any(k.startswith("aluminum_siding") or k.startswith("vinyl_siding")
                        or k.startswith("cedar_shake") for k in materials_found)
        if not has_siding:
            key = "vinyl_siding"
            materials_found[key] = DAMAGE_THRESHOLDS[key].copy()
            materials_found[key]["key"] = key

    # If roofing is in trades but no roofing material detected, default to laminate
    if "roof" in trade_str:
        has_roof = any(k.startswith("3-tab") or k.startswith("laminate") or k.startswith("metal_roof")
                       or k.startswith("clay") or k.startswith("slate") for k in materials_found)
        if not has_roof:
            key = "laminate_shingle_aged" if is_aged else "laminate_shingle_new"
            materials_found[key] = DAMAGE_THRESHOLDS[key].copy()
            materials_found[key]["key"] = key

    return list(materials_found.values())


def _is_aged_roof(config: dict) -> bool:
    """Determine if roof is aged (15+ years) from config data."""
    # Check structures for age
    for struct in config.get("structures", []):
        age = struct.get("age")
        if age is not None:
            try:
                return int(age) >= 15
            except (ValueError, TypeError):
                pass

    # Check year_built
    year_built = config.get("property", {}).get("year_built")
    if year_built:
        try:
            age = 2026 - int(year_built)  # Current year
            return age >= 15
        except (ValueError, TypeError):
            pass

    # Default: assume aged (conservative — lower thresholds favor the claim)
    return True


def _match_material(text: str, is_aged: bool, found: dict):
    """Match text against material patterns and add to found dict."""
    text_lower = text.lower()
    for pattern, key_new, key_aged in MATERIAL_PATTERNS:
        if re.search(pattern, text_lower):
            key = key_aged if is_aged else key_new
            if key not in found:
                found[key] = DAMAGE_THRESHOLDS[key].copy()
                found[key]["key"] = key


def format_threshold_table() -> str:
    """Format the full threshold registry as a display table."""
    lines = [
        "DAMAGE THRESHOLD REGISTRY",
        "=" * 80,
        f"{'Material':<45} {'Threshold':>12}  Source",
        "-" * 80,
    ]
    for key, t in DAMAGE_THRESHOLDS.items():
        lines.append(f"{t['material']:<45} {t['display']:>12}  {t['source'][:40]}")
    lines.append("-" * 80)
    lines.append(f"{len(DAMAGE_THRESHOLDS)} materials registered")
    return "\n".join(lines)
