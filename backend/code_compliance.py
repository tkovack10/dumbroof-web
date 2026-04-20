from __future__ import annotations

"""Code Compliance Engine — Jurisdiction-Aware Citations for Line Items.

Each line item that carries a building code requirement gets a 4-layer citation:
  1. Code Tag — jurisdiction-prefixed section (e.g., RCNYS R905.1.2)
  2. Code Requirement — actual code text
  3. Supplement Argument — carrier negotiation language
  4. Manufacturer Specs — 1-5 manufacturers with bulletin refs + warranty VOID warnings

Per IRC/RCNYS R905.1, manufacturer installation instructions carry the FORCE OF LAW.
Every manufacturer spec IS a code requirement — two-pronged argument is really one prong
with legal reinforcement.
"""

# ── Jurisdiction Mapping ──────────────────────────────────────────────
# State-specific jurisdiction data is now resolved via building_codes/state_codes.json.
# This helper preserves the legacy `{"prefix", "name", "tax"}` shape that
# enrich_line_items_with_citations() consumes. Add states to the JSON,
# not this file.
from building_codes import lookup as _bc_lookup


def _get_jurisdiction_dict(state: str) -> dict:
    """Return {"prefix", "name", "tax"} for a state. Unknown → IRC default."""
    row = _bc_lookup.get_state_codes(state)
    return {
        "prefix": row.get("prefix", "IRC"),
        "name":   row.get("full_name", "International Residential Code"),
        "tax":    float(row.get("sales_tax", 0.0) or 0.0),
    }


class _JurisdictionCodesProxy:
    """Legacy .get(state, default) dict contract over state_codes.json."""
    def get(self, state, default=None):
        if not state:
            return default
        st = state.upper()
        if st in _bc_lookup.all_states() or st == "IRC":
            return _get_jurisdiction_dict(state)
        return default

    def __getitem__(self, state):
        return _get_jurisdiction_dict(state)

    def __contains__(self, state):
        return (state or "").strip().upper() in set(_bc_lookup.all_states())


JURISDICTION_CODES = _JurisdictionCodesProxy()

# ── Manufacturer Specs Database ──────────────────────────────────────
MANUFACTURER_SPECS = {
    "gaf_timberline_hdz": {
        "manufacturer": "GAF",
        "document": "Timberline HDZ Installation Instructions",
        "applies_to": ["shingles", "starter", "nailing"],
        "requirement": "4-6 nails per shingle, ProStart starter required at eaves and rakes",
        "warranty_void": True,
        "warranty_text": "GAF System Plus/Silver Pledge warranty VOID without proper starter and nailing pattern",
    },
    "gaf_weatherwatch": {
        "manufacturer": "GAF",
        "document": "WeatherWatch Mineral-Surfaced Leak Barrier",
        "applies_to": ["ice_water_barrier"],
        "requirement": "Required at eaves, valleys, and around penetrations per GAF system requirements",
        "warranty_void": True,
        "warranty_text": "GAF warranty VOID without WeatherWatch/StormGuard at eaves and valleys",
    },
    "gaf_tab_r_2011_126": {
        "manufacturer": "GAF",
        "document": "TAB-R 2011-126 (Technical Advisory Bulletin)",
        "applies_to": ["damage_assessment"],
        "requirement": "Full replacement required when hail damage exceeds functional threshold",
        "warranty_void": False,
    },
    "oc_tb_10024261": {
        "manufacturer": "Owens Corning",
        "document": "TB-10024261 (Hail Damage Assessment)",
        "applies_to": ["damage_assessment"],
        "requirement": "Functional damage (mat fracture, granule loss exposing substrate) = full replacement",
        "warranty_void": False,
    },
    "oc_duration_10024264": {
        "manufacturer": "Owens Corning",
        "document": "Duration Series Install 10024264",
        "applies_to": ["starter"],
        "requirement": "OC Starter Course required at eaves and rakes",
        "warranty_void": True,
        "warranty_text": "SureNail Technology warranty VOID without OC-approved starter",
    },
    "certainteed_tis_130": {
        "manufacturer": "CertainTeed",
        "document": "TIS #130 (Hail Damage Assessment)",
        "applies_to": ["damage_assessment"],
        "requirement": "Mat fracture from hail impact = functional damage requiring replacement",
        "warranty_void": False,
    },
    "certainteed_landmark": {
        "manufacturer": "CertainTeed",
        "document": "Landmark Series Installation Instructions",
        "applies_to": ["starter"],
        "requirement": "SwiftStart starter required at eaves and rakes",
        "warranty_void": True,
        "warranty_text": "SureStart warranty VOID without CertainTeed-approved starter",
    },
    "atlas_hail_damage": {
        "manufacturer": "Atlas",
        "document": "Detecting Hail Damage to Asphalt Shingles",
        "applies_to": ["damage_assessment"],
        "requirement": "Systematic hail damage assessment criteria for functional vs cosmetic",
        "warranty_void": False,
    },
    "velux_v_usa_1_0_10": {
        "manufacturer": "VELUX",
        "document": "V-USA-1-0-10 (Skylight Replacement Guide)",
        "applies_to": ["skylights"],
        "requirement": "Replace when cladding sealed to glazing is compromised by impact damage",
        "warranty_void": False,
    },
    # ── Siding Manufacturer Specs ──
    "certainteed_siding": {
        "manufacturer": "CertainTeed",
        "document": "CertainTeed Siding Installation Manual (7th Edition)",
        "applies_to": ["house_wrap", "siding"],
        "requirement": "CertainTeed-approved WRB required behind all siding. CertaWrap or equivalent with min 2\" horizontal overlap, 6\" vertical overlap. WRB must cover ALL sheathing before siding install.",
        "warranty_void": True,
        "warranty_text": "SureStart PLUS warranty VOID without approved WRB behind siding",
    },
    "certainteed_siding_flashing": {
        "manufacturer": "CertainTeed",
        "document": "CertainTeed Siding Installation Manual (7th Edition)",
        "applies_to": ["wall_flashing"],
        "requirement": "Head flashing required above all windows, doors, and penetrations. Kick-out flashing at roof-to-wall/gutter junctions. Z-flashing between dissimilar materials.",
        "warranty_void": True,
        "warranty_text": "Warranty VOID if moisture intrusion results from missing flashing",
    },
    "james_hardie_house_wrap": {
        "manufacturer": "James Hardie",
        "document": "HardiePlank Installation Instructions (HZ10)",
        "applies_to": ["house_wrap"],
        "requirement": "WRB required — James Hardie-approved house wrap with min 2\" shingle laps. Tyvek HomeWrap, DrainWrap, or equivalent. WRB continuity at corners is MANDATORY — cannot terminate at building corners.",
        "warranty_void": True,
        "warranty_text": "ColorPlus warranty VOID without approved WRB. 30-year substrate warranty requires continuous WRB",
    },
    "james_hardie_flashing": {
        "manufacturer": "James Hardie",
        "document": "HardiePlank Installation Instructions (HZ10)",
        "applies_to": ["wall_flashing"],
        "requirement": "Head flashing at all horizontal joints, above openings, and at wall-to-roof intersections. Kick-out flashing mandatory. Must use corrosion-resistant flashing material.",
        "warranty_void": True,
        "warranty_text": "Warranty VOID without proper flashing at all intersections",
    },
    "alside_vinyl": {
        "manufacturer": "Alside / Associated Materials",
        "document": "Alside Vinyl Siding Installation Guide",
        "applies_to": ["house_wrap", "siding"],
        "requirement": "WRB required behind all vinyl siding per manufacturer specs. House wrap must be installed prior to siding. Cannot reuse existing WRB if damaged during siding removal.",
        "warranty_void": True,
        "warranty_text": "Lifetime Limited warranty requires code-compliant WRB installation",
    },
    "dupont_tyvek": {
        "manufacturer": "DuPont",
        "document": "Tyvek HomeWrap Installation Guidelines",
        "applies_to": ["house_wrap"],
        "requirement": "Install over sheathing BEFORE siding. Min 6\" overlap at horizontal seams, 12\" at vertical seams. Tape all seams with Tyvek tape. Must wrap around corners min 12\".",
        "warranty_void": True,
        "warranty_text": "Tyvek 10-year warranty VOID with improper installation",
    },
}


# ── Line Item → Code Section Mapping ─────────────────────────────────
# Keys use format: "XACT_CODE|action" or description keyword
# Each entry has: section, requirement, supplement_argument, manufacturer_specs[]
LINE_ITEM_CODE_MAP = {
    "RFG 300S|remove": {
        "section": "R908.3",
        "title": "Reroofing — Tear-Off Requirement",
        "requirement": "Existing roofing materials shall be removed before applying new roofing when existing roof has two or more applications of any type of roof covering",
        "supplement_argument": "Complete tear-off is required per code for a code-compliant installation. Overlay is not code-compliant when damage necessitates deck inspection.",
        "manufacturer_specs": ["gaf_timberline_hdz"],
    },
    "RFG 300S|install": {
        "section": "R905.1",
        "title": "Manufacturer Installation Instructions = Law",
        "requirement": "Roofing shall be applied in accordance with manufacturer's installation instructions. Manufacturer instructions carry the force of building code.",
        "supplement_argument": "Per R905.1, manufacturer installation instructions are legally binding building code. All components specified by the manufacturer (starter, underlayment, flashing) are code-required, not optional upgrades.",
        "manufacturer_specs": ["gaf_timberline_hdz", "oc_tb_10024261", "certainteed_tis_130", "atlas_hail_damage"],
    },
    "RFG IWS|install": {
        "section": "R905.1.2",
        "title": "Ice Barrier Requirement",
        "requirement": "Ice barrier required at eaves extending from eave edge to at least 24 inches past interior wall line, and in valleys",
        "supplement_argument": "Ice & water barrier is required by code at all eaves and valleys. This is not an optional upgrade — it is a mandatory building code requirement for a code-compliant installation.",
        "manufacturer_specs": ["gaf_weatherwatch"],
    },
    "RFG FELT15|install": {
        "section": "R905.1.1",
        "title": "Underlayment Requirement",
        "requirement": "Underlayment required over entire roof deck area not covered by ice barrier",
        "supplement_argument": "Underlayment is code-mandated over the entire roof deck. Areas where ice & water barrier is not installed require felt or synthetic underlayment. Omission does not meet code requirements.",
        "manufacturer_specs": [],
    },
    "RFG ASTR-|install": {
        "section": "R905.1",
        "title": "Starter Course (Manufacturer Required)",
        "requirement": "Starter course required at eaves and rakes per manufacturer installation instructions (R905.1 — manufacturer instructions = code)",
        "supplement_argument": "Starter course is required by ALL major manufacturers (GAF, OC, CertainTeed). Per R905.1, manufacturer instructions carry the force of code. Omitting starter voids the manufacturer warranty.",
        "manufacturer_specs": ["gaf_timberline_hdz", "oc_duration_10024264", "certainteed_landmark"],
    },
    "RFG DRIP|install": {
        "section": "R905.2.8.5",
        "title": "Drip Edge Requirement",
        "requirement": "Drip edge shall be provided at eaves and gable rake edges of shingle roofs",
        "supplement_argument": "Drip edge is required at all eaves and rakes per code. Protects fascia and deck edge from water damage. Not an optional upgrade.",
        "manufacturer_specs": [],
    },
    "RFG RIDGCS|install": {
        "section": "R806",
        "title": "Roof Ventilation",
        "requirement": "Enclosed attics shall have cross ventilation. Ridge vent provides exhaust ventilation per R806.1",
        "supplement_argument": "Ridge ventilation is required for proper attic ventilation per code. When ridge cap is replaced, ridge vent must be replaced to maintain code-compliant ventilation.",
        "manufacturer_specs": [],
    },
    "RFG STEP|install": {
        "section": "R905.2.8.3",
        "title": "Step Flashing at Wall Junctions",
        "requirement": "Step flashing shall be used where roof planes intersect vertical walls",
        "supplement_argument": "Step flashing is code-required at every wall-to-roof junction. When roofing is replaced, step flashing must be replaced to maintain weathertight integrity per code.",
        "manufacturer_specs": [],
    },
    "RFG FLPIPE|install": {
        "section": "R905.2.8",
        "title": "Flashing — General (Pipe Penetrations)",
        "requirement": "Flashing shall be installed at wall and roof intersections, at gutters, around roof openings, and at penetrations through the roof plane",
        "supplement_argument": "Pipe jack flashing is code-required at every roof penetration. When roofing is replaced, all pipe boots must be replaced — reusing old pipe boots on new roofing is a code violation.",
        "manufacturer_specs": [],
    },
    "RFG DDFL+|install": {
        "section": "R905.2.8",
        "title": "Skylight Flashing",
        "requirement": "Flashing required at all roof openings including skylights. Manufacturer flashing kits required for warranty compliance.",
        "supplement_argument": "Skylight flashing is code-required. When the surrounding roofing is replaced, skylight flashing must be replaced to maintain weathertight seal. VELUX requires OEM flashing kit.",
        "manufacturer_specs": ["velux_v_usa_1_0_10"],
    },
    "RFG FLCH|install": {
        "section": "R905.2.8",
        "title": "Chimney Flashing",
        "requirement": "Flashing required at chimney-to-roof intersections including step flashing, counter-flashing, and cricket/saddle where applicable",
        "supplement_argument": "Chimney flashing is code-required at all chimney-roof intersections. Full replacement includes step flashing, counter-flashing, and apron. Reusing old chimney flashing on new roofing is a code violation.",
        "manufacturer_specs": [],
    },
    # ── SIDING TRADE ──────────────────────────────────────────────────
    # House wrap / WRB — R703.2 + corner rule R703.1
    "house_wrap|r&r": {
        "section": "R703.2",
        "title": "Weather-Resistive Barrier (House Wrap)",
        "requirement": "WRB required on ALL exterior walls. Min 2\" horizontal laps, 6\" joint laps. Must wrap around corners per R703.1 — corner rule forces adjacent elevation if one elevation approved.",
        "supplement_argument": "House wrap is mandatory per R703.2 on all exterior walls. The corner rule (R703.1) requires continuous weather barrier around corners — if the carrier approves siding on one elevation, the WRB must continue around the corner to the adjacent elevation to maintain continuity. This is not 'additional scope' — it is a code-required installation method.",
        "manufacturer_specs": ["certainteed_siding", "james_hardie_house_wrap", "alside_vinyl", "dupont_tyvek"],
    },
    "house_wrap|install": {
        "section": "R703.2",
        "title": "Weather-Resistive Barrier (House Wrap)",
        "requirement": "WRB required on ALL exterior walls. Min 2\" horizontal laps, 6\" joint laps. Must wrap around corners per R703.1.",
        "supplement_argument": "House wrap is mandatory per R703.2 on all exterior walls. The corner rule (R703.1) requires continuous weather barrier around corners — if the carrier approves siding on one elevation, the WRB must continue around the corner to the adjacent elevation.",
        "manufacturer_specs": ["certainteed_siding", "james_hardie_house_wrap", "alside_vinyl", "dupont_tyvek"],
    },
    # Siding installation — R703.3 (triggers house wrap R703.2 too)
    "SDG VNYL|r&r": {
        "section": "R703.3",
        "title": "Exterior Wall Covering — Vinyl Siding",
        "requirement": "Siding must be installed per manufacturer instructions AND R703.1 (flashing at intersections). Attachment per Table R703.3.2. Must maintain 6\" min clearance from grade.",
        "supplement_argument": "Siding installation requires compliance with R703.3 AND manufacturer installation instructions per R703.1. A code-compliant installation includes: house wrap (R703.2), wall flashing at all intersections (R703.8), and proper attachment per Table R703.3.2. Partial siding replacement that doesn't maintain weather barrier continuity does not meet code requirements.",
        "manufacturer_specs": ["certainteed_siding", "alside_vinyl"],
    },
    "SDG ALUM|r&r": {
        "section": "R703.3",
        "title": "Exterior Wall Covering — Aluminum Siding",
        "requirement": "Siding must be installed per manufacturer instructions AND R703.1. Attachment per Table R703.3.2.",
        "supplement_argument": "Aluminum siding installation must comply with R703.3 AND manufacturer specs per R703.1. House wrap (R703.2) and wall flashing (R703.8) are mandatory components.",
        "manufacturer_specs": [],
    },
    "SDG WD|r&r": {
        "section": "R703.3",
        "title": "Exterior Wall Covering — Wood Siding",
        "requirement": "Siding must be installed per manufacturer instructions AND R703.1. Attachment per Table R703.3.2.",
        "supplement_argument": "Wood siding installation must comply with R703.3. House wrap (R703.2) and wall flashing (R703.8) are mandatory. Cedar requires back-priming per most manufacturer specs.",
        "manufacturer_specs": [],
    },
    "SDG FBRCEM|r&r": {
        "section": "R703.3",
        "title": "Exterior Wall Covering — Fiber Cement Siding",
        "requirement": "Siding must be installed per manufacturer instructions AND R703.1. HardiePlank requires specific fastener specs and WRB.",
        "supplement_argument": "Fiber cement siding must comply with R703.3 AND James Hardie installation instructions per R703.1. Requires approved WRB, head flashing, and corrosion-resistant fasteners.",
        "manufacturer_specs": ["james_hardie_house_wrap", "james_hardie_flashing"],
    },
    "SDG CSH|r&r": {
        "section": "R703.3",
        "title": "Exterior Wall Covering — Cedar Shingle Siding",
        "requirement": "Cedar shingle siding per R703.3. Requires WRB and proper ventilation behind siding.",
        "supplement_argument": "Cedar shingle siding must comply with R703.3. House wrap (R703.2) mandatory. Cedar requires ventilation gap behind siding per manufacturer specs.",
        "manufacturer_specs": [],
    },
    # Wall flashing — R703.8 (the #1 siding item carriers omit)
    "wall_flashing|r&r": {
        "section": "R703.8",
        "title": "Wall Flashing",
        "requirement": "Required at ALL wall-to-roof, wall-to-wall, and wall-to-deck intersections. Head flashing above windows/doors mandatory. Kick-out flashing required where roof-to-wall meets gutter.",
        "supplement_argument": "Wall flashing is mandatory per R703.8 at ALL intersections: roof-to-wall, wall-to-wall, above openings, and where roof terminates at a wall/gutter junction (kick-out flashing). This is the #1 siding item carriers omit. Without proper wall flashing, water infiltration is inevitable and the installation violates code.",
        "manufacturer_specs": ["certainteed_siding_flashing", "james_hardie_flashing"],
    },
    "wall_flashing|install": {
        "section": "R703.8",
        "title": "Wall Flashing",
        "requirement": "Required at ALL intersections. Head flashing, kick-out flashing at gutter/wall junctions.",
        "supplement_argument": "Wall flashing is mandatory per R703.8 at all intersections. Kick-out flashing at gutter-to-wall junctions is standard of care — omitting it is a known moisture intrusion failure point.",
        "manufacturer_specs": ["certainteed_siding_flashing", "james_hardie_flashing"],
    },
    # Window wraps / J-channel — R703.4
    "window_wrap|r&r": {
        "section": "R703.4",
        "title": "Window & Door Flashing/Wraps",
        "requirement": "Flashing required at ALL window and door openings per R703.4. Openings must be sealed to prevent water intrusion behind WRB. J-channel/window wraps are the method of compliance for vinyl and aluminum siding.",
        "supplement_argument": "Window and door flashing is mandatory per R703.4. When siding is replaced, existing window wraps and J-channel are disturbed and must be replaced to maintain the water-resistant seal between the window frame and the weather-resistive barrier. This is not cosmetic — it is the primary defense against water infiltration at openings.",
        "manufacturer_specs": ["certainteed_siding_flashing"],
    },
    "SDG JCHNL|install": {
        "section": "R703.4",
        "title": "J-Channel at Windows/Doors",
        "requirement": "J-channel required at all window/door openings for vinyl and aluminum siding per R703.4.",
        "supplement_argument": "J-channel is the code-required method for sealing vinyl siding at window and door openings per R703.4. Must be replaced when siding is R&R'd.",
        "manufacturer_specs": [],
    },
    # Shutters — no direct code, but part of siding scope
    "SHT VNYL|r&r": {
        "section": "R703.3",
        "title": "Decorative Shutters (Siding Scope)",
        "requirement": "Shutters must be removed for siding installation and reinstalled per R703.3 requirements.",
        "supplement_argument": "Shutters must be removed and replaced as part of siding scope. If damaged during removal or by storm, R&R is included in the authorized repair.",
        "manufacturer_specs": [],
    },
}

# ── Description keyword → code map key fallback ──────────────────────
# For items that don't have xact_code set, match by description keywords
_DESC_TO_CODE_KEY = {
    "ice & water": "RFG IWS|install",
    "ice water": "RFG IWS|install",
    "i&w": "RFG IWS|install",
    "felt": "RFG FELT15|install",
    "underlayment": "RFG FELT15|install",
    "starter": "RFG ASTR-|install",
    "drip edge": "RFG DRIP|install",
    "ridge vent": "RFG RIDGCS|install",
    "ridge cap": "RFG RIDGCS|install",
    "step flash": "RFG STEP|install",
    "pipe jack": "RFG FLPIPE|install",
    "pipe boot": "RFG FLPIPE|install",
    "skylight flash": "RFG DDFL+|install",
    "chimney flash": "RFG FLCH|install",
    # Siding trade
    "house wrap": "house_wrap|r&r",
    "housewrap": "house_wrap|r&r",
    "tyvek": "house_wrap|r&r",
    "weather-resistive": "house_wrap|r&r",
    "vinyl sid": "SDG VNYL|r&r",
    "aluminum sid": "SDG ALUM|r&r",
    "cedar sid": "SDG CSH|r&r",
    "cedar shingle sid": "SDG CSH|r&r",
    "fiber cement": "SDG FBRCEM|r&r",
    "hardiplank": "SDG FBRCEM|r&r",
    "wall flash": "wall_flashing|r&r",
    "kick-out": "wall_flashing|r&r",
    "kickout": "wall_flashing|r&r",
    "window wrap": "window_wrap|r&r",
    "wrap window": "window_wrap|r&r",
    "wrap wood window": "window_wrap|r&r",
    "j-channel": "SDG JCHNL|install",
    "j channel": "SDG JCHNL|install",
    "shutter": "SHT VNYL|r&r",
    "insulation board": "house_wrap|r&r",
    "fanfold": "house_wrap|r&r",
}


def get_code_citation(xact_code: str, action: str, state: str, description: str = "") -> dict | None:
    """Look up the 4-layer code citation for a line item.

    Args:
        xact_code: Xactimate code (e.g., "RFG IWS")
        action: "install", "remove", "r&r"
        state: 2-letter state code
        description: Line item description (fallback matching)

    Returns:
        Citation dict with: code_tag, section, title, requirement,
        supplement_argument, manufacturer_specs[], or None if no citation.
    """
    jurisdiction = JURISDICTION_CODES.get(state.upper(), JURISDICTION_CODES.get("NY"))
    prefix = jurisdiction["prefix"]

    # Try exact code|action match first
    code_key = f"{xact_code}|{action}" if xact_code else ""
    citation_data = LINE_ITEM_CODE_MAP.get(code_key)

    # For R&R items, try install (most R&R items carry install code requirements)
    if not citation_data and action == "r&r" and xact_code:
        citation_data = LINE_ITEM_CODE_MAP.get(f"{xact_code}|install")

    # Fallback: match by description keywords
    if not citation_data and description:
        desc_lower = description.lower()
        for keyword, fallback_key in _DESC_TO_CODE_KEY.items():
            if keyword in desc_lower:
                citation_data = LINE_ITEM_CODE_MAP.get(fallback_key)
                break

    if not citation_data:
        return None

    # Build manufacturer specs
    mfr_specs = []
    for spec_key in citation_data.get("manufacturer_specs", []):
        spec = MANUFACTURER_SPECS.get(spec_key)
        if spec:
            mfr_specs.append({
                "manufacturer": spec["manufacturer"],
                "document": spec["document"],
                "requirement": spec["requirement"],
                "warranty_void": spec.get("warranty_void", False),
                "warranty_text": spec.get("warranty_text", ""),
            })

    section = citation_data["section"]
    return {
        "code_tag": f"{prefix} {section}",
        "section": section,
        "title": citation_data["title"],
        "requirement": citation_data["requirement"],
        "supplement_argument": citation_data["supplement_argument"],
        "manufacturer_specs": mfr_specs,
        "has_warranty_void": any(s.get("warranty_void") for s in mfr_specs),
        "jurisdiction": jurisdiction["name"],
    }


def enrich_line_items_with_citations(line_items: list, state: str) -> int:
    """Add code_citation objects to line items that carry building code requirements.

    Modifies line_items in place. Returns count of items enriched.
    """
    enriched = 0
    for li in line_items:
        xact_code = li.get("code", "")
        # Determine action from description
        desc_lower = (li.get("description") or "").lower()
        if "remove" in desc_lower and "r&r" not in desc_lower:
            action = "remove"
        elif "r&r" in desc_lower or "replace" in desc_lower:
            action = "r&r"
        else:
            action = "install"

        citation = get_code_citation(xact_code, action, state, li.get("description", ""))
        if citation:
            li["code_citation"] = citation
            # Also update the simple irc_code field for backward compatibility
            if not li.get("irc_code"):
                li["irc_code"] = citation["code_tag"]
            # Upgrade supplement_argument with code-backed version if current is empty/generic
            if not li.get("supplement_argument") or len(li.get("supplement_argument", "")) < len(citation["supplement_argument"]):
                li["supplement_argument"] = citation["supplement_argument"]
            enriched += 1

    return enriched
