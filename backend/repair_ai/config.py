"""
Central configuration for the repair diagnostic engine.
Labor rates, material costs, thresholds, and constants.
"""

# --- Skill Levels ---
SKILL_LEVELS = {
    "laborer": {
        "label": "Laborer",
        "detail": "maximum",
        "description": "Step-by-step with tool names, safety reminders, common mistake warnings",
    },
    "journeyman": {
        "label": "Journeyman",
        "detail": "standard",
        "description": "Professional-level steps, assumes basic competency",
    },
    "technician": {
        "label": "Technician",
        "detail": "concise",
        "description": "Checklist with quantities and specs only",
    },
}

# --- Severity Levels ---
SEVERITY_LEVELS = {
    "minor": {
        "label": "Minor",
        "urgency": "Schedule within 30 days",
        "color": "#4caf50",  # green
    },
    "moderate": {
        "label": "Moderate",
        "urgency": "Repair within 1-2 weeks",
        "color": "#ff9800",  # orange
    },
    "major": {
        "label": "Major",
        "urgency": "Repair within 3-5 days",
        "color": "#f44336",  # red
    },
    "critical": {
        "label": "Critical",
        "urgency": "Immediate attention — active water intrusion",
        "color": "#b71c1c",  # dark red
    },
    "emergency": {
        "label": "Emergency",
        "urgency": "Same-day emergency repair or tarp required",
        "color": "#880e4f",  # deep red
    },
}

# --- Leak Families (8 families, priority order) ---
LEAK_FAMILIES = {
    "chimney":      {"label": "Chimney",        "priority": 1},
    "roof_to_wall": {"label": "Roof-to-Wall",   "priority": 2},
    "penetration":  {"label": "Penetration",     "priority": 3},
    "skylight":     {"label": "Skylight",        "priority": 4},
    "valley":       {"label": "Valley",          "priority": 5},
    "edge_weather": {"label": "Edge / Weather",  "priority": 6},
    "field_shingle":{"label": "Field Shingle",   "priority": 7},
    "fastener":     {"label": "Fastener",        "priority": 8},
}

# --- 22 Repair Codes (evidence-based, from scope library) ---
# Each code maps to: description, family, crew_skill, cost_range, escalation_note
REPAIR_TYPES = {
    # Chimney family
    "CHM-FRONT":    {"desc": "Chimney apron/front face failure",              "family": "chimney",      "crew": "Repair crew",                      "cost": "$400-$700",      "escalation": "Masonry defects above flashing; rotten deck"},
    "CHM-SIDE":     {"desc": "Chimney sidewall step/counter flashing failure","family": "chimney",      "crew": "Repair crew",                      "cost": "$500-$900",      "escalation": "Mason if reglet, mortar, or crown work required"},
    "CHM-BACK":     {"desc": "Chimney back pan/cricket failure",             "family": "chimney",      "crew": "Lead repair crew",                 "cost": "$700-$1,200",    "escalation": "Framing/deck repair if cricket area deteriorated"},
    "CHM-MASONRY":  {"desc": "Chimney masonry failure above roofline",       "family": "chimney",      "crew": "Diagnostic / masonry coordination","cost": "$250-$500+",     "escalation": "Chimney/masonry specialist required"},
    # Roof-to-wall family
    "WALL-STEP":    {"desc": "Sidewall step flashing failure",               "family": "roof_to_wall", "crew": "Repair crew",                      "cost": "$350-$900",      "escalation": "Envelope trade if WRB/stucco defective"},
    "WALL-KICKOUT": {"desc": "Kickout diverter failure",                     "family": "roof_to_wall", "crew": "Lead repair crew",                 "cost": "$400-$700",      "escalation": "Envelope trade if cladding/WRB repair required"},
    "HEADWALL":     {"desc": "Headwall/dormer front flashing failure",       "family": "roof_to_wall", "crew": "Repair crew",                      "cost": "$350-$600",      "escalation": "Envelope work if siding/stucco termination defective"},
    "STUCCO-ABOVE-ROOF": {"desc": "Wall drainage failure above roofline",    "family": "roof_to_wall", "crew": "Roof + envelope coordination",     "cost": "$500-$1,200+",   "escalation": "Stucco/envelope specialist required"},
    # Penetration family
    "VENT-BOOT":    {"desc": "Plumbing vent boot/collar failure",            "family": "penetration",  "crew": "Repair crew",                      "cost": "$250-$400",      "escalation": "Deck repair if long-term rot"},
    "VENT-METAL":   {"desc": "Metal vent/roof jack failure",                 "family": "penetration",  "crew": "Repair crew",                      "cost": "$250-$450",      "escalation": "HVAC/appliance trade if vent termination wrong"},
    # Skylight family
    "SKYLIGHT-FLASH": {"desc": "Skylight flashing failure",                  "family": "skylight",     "crew": "Lead repair crew",                 "cost": "$400-$700",      "escalation": "Skylight replacement if unit failed"},
    "SKYLIGHT-UNIT":  {"desc": "Failed skylight unit/curb",                  "family": "skylight",     "crew": "Lead repair / replacement crew",   "cost": "$800-$2,000+",   "escalation": "Carpentry if curb/shaft rotten"},
    # Valley family
    "VALLEY-OPEN-METAL": {"desc": "Open metal valley failure",               "family": "valley",       "crew": "Lead repair crew",                 "cost": "$300-$500",      "escalation": "Deck replacement if rot follows valley"},
    "VALLEY-CLOSED-CUT": {"desc": "Closed-cut/woven valley failure",         "family": "valley",       "crew": "Lead repair crew",                 "cost": "$500-$900",      "escalation": "Deck replacement if rot present"},
    "VALLEY-DEBRIS-ICE": {"desc": "Valley debris/ice backup",                "family": "valley",       "crew": "Repair crew",                      "cost": "$250-$400",      "escalation": "Gutter/ventilation if recurrence risk high"},
    # Edge / weather family
    "EAVE-ICE-DAM":  {"desc": "Ice dam leak",                               "family": "edge_weather", "crew": "Repair crew + recommendation",     "cost": "$300-$3,000",    "escalation": "Attic ventilation/insulation trade"},
    "EAVE-DRIP-EDGE":{"desc": "Drip edge/edge failure",                     "family": "edge_weather", "crew": "Repair crew",                      "cost": "$250-$500",      "escalation": "Fascia/gutter repair if substrate damaged"},
    "GUTTER-BACKUP": {"desc": "Gutter overflow/standing water",             "family": "edge_weather", "crew": "Repair / gutter crew",              "cost": "$200-$500",      "escalation": "Gutter replacement if undersized/failing"},
    # Field shingle family
    "FIELD-SHINGLE": {"desc": "Field shingle damage (puncture/missing/slip)","family": "field_shingle","crew": "Repair crew",                      "cost": "$250-$400",      "escalation": "Replacement if failures widespread"},
    # Fastener family
    "NAIL-POP":      {"desc": "Fastener failure (popped/exposed/angled)",    "family": "fastener",     "crew": "Repair crew",                      "cost": "$250-$400",      "escalation": "Replacement if fastener errors systemic"},
    # Special codes
    "CONDENSATION":  {"desc": "Non-roof moisture (attic condensation)",      "family": None,           "crew": "Diagnostic / ventilation",         "cost": "$250-$500+",     "escalation": "HVAC/insulation/building-science specialist"},
    "LOW-CONFIDENCE-VERIFY": {"desc": "Conflicting evidence — needs verification", "family": None,     "crew": "Senior diagnostic",                "cost": "$250-$500",      "escalation": "Senior tech or destructive verification required"},
}

# --- Legacy code mapping (old 11 types → new 22 codes) ---
LEGACY_REPAIR_TYPE_MAP = {
    "pipe_boot":         "VENT-BOOT",
    "step_flashing":     "WALL-STEP",
    "chimney_flashing":  "CHM-SIDE",
    "exposed_nails":     "NAIL-POP",
    "missing_shingles":  "FIELD-SHINGLE",
    "valley_leak":       "VALLEY-OPEN-METAL",
    "vent_boot":         "VENT-BOOT",
    "skylight_flashing": "SKYLIGHT-FLASH",
    "ridge_cap":         "FIELD-SHINGLE",
    "ice_dam":           "EAVE-ICE-DAM",
    "temporary_tarp":    "FIELD-SHINGLE",
}

# --- Default Pricing ---
# Service calls have HIGH margins. The money is made by being the contractor
# who shows up and gets the repair done. $250 diagnostic flat fee is always
# charged. Material unit prices are 2x retail — service call pricing.
DIAGNOSTIC_FEE = 250.00              # Flat fee — always charged, covers the visit
DEFAULT_LABOR_RATE_PER_HOUR = 85.00  # $/hr — configurable per contractor
DEFAULT_MARKUP_PERCENT = 0.20        # 20% markup on top of doubled material costs
MINIMUM_JOB_CHARGE = 450.00          # Minimum repair ticket ($250 diag + minimum repair)

# --- Material Costs (SERVICE CALL pricing — 2x retail) ---
# These are 2x retail costs. Service call margins are where the money is.
# The contractor who shows up and fixes it TODAY commands premium pricing.
DEFAULT_MATERIAL_COSTS = {
    "pipe_boot_neoprene": 24.00,            # EA  (retail $12)
    "pipe_boot_lead": 70.00,                # EA  (retail $35)
    "step_flashing_aluminum_4x4": 5.00,     # EA  (retail $2.50)
    "counter_flashing_aluminum": 19.00,      # LF  (retail $9.50)
    "roofing_cement": 16.00,                 # tube (retail $8)
    "mortar_mix": 24.00,                     # bag (retail $12)
    "roofing_nails_1lb": 12.00,             # lb  (retail $6)
    "shingle_laminated_bundle": 70.00,       # bundle (retail $35)
    "shingle_3tab_bundle": 56.00,            # bundle (retail $28)
    "ice_water_shield": 4.48,               # SF  (retail $2.24)
    "drip_edge_aluminum": 8.50,             # LF  (retail $4.25)
    "ridge_cap_laminated": 14.98,            # LF  (retail $7.49)
    "ridge_vent_aluminum": 17.00,            # LF  (retail $8.50)
    "exhaust_vent": 90.00,                  # EA  (retail $45)
    "valley_flashing_w_style": 13.00,        # LF  (retail $6.50)
    "skylight_flashing_kit": 170.00,         # EA  (retail $85)
    "tarp_heavy_duty_20x30": 90.00,          # EA  (retail $45)
    "tarp_anchor_2x4": 10.00,               # EA  (retail $5)
    "sealant_tube": 12.00,                   # tube (retail $6)
    "starter_strip": 7.00,                  # LF  (retail $3.50)
}

# --- Confidence Thresholds ---
CONFIDENCE_HIGH = 0.85     # Clear diagnosis — proceed
CONFIDENCE_MEDIUM = 0.60   # Probable — flag for review
CONFIDENCE_LOW = 0.40      # Insufficient — request more photos

# --- Supported Languages ---
LANGUAGES = {
    "en": "English",
    "es": "Spanish",
}

# --- Reference Files (loaded as AI context) ---
REFERENCE_FILES = [
    "references/repair-diagnostic-standard.md",
    "references/leak-repair-guide.md",
    "references/damage-identification.md",
    "references/installation-techniques.md",
    "references/products-and-materials.md",
]

# --- Decision Tree (loaded as CSV for structured triage) ---
DECISION_TREE_FILE = "repair_knowledge/training/roof_decision_tree.csv"

# --- Scope Library (loaded as CSV for code-level detail) ---
SCOPE_LIBRARY_FILE = "repair_knowledge/training/roof_repair_scope_library.csv"
