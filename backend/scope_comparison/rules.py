"""
Rules Engine — Codifies every expert decision in scope comparison.

This is the BRAIN of the system. Every judgment call I made when comparing
the 80 Moeller scopes is captured here as a testable, repeatable rule.

Rule Categories:
  1. MEASUREMENT RULES — Is the carrier's quantity correct vs EagleView?
  2. CODE RULES — Does the scope meet building code requirements?
  3. COMPLETENESS RULES — Are all required items present?
  4. PRICING RULES — Are unit prices within acceptable range?
  5. UNDERPAYMENT PATTERNS — Known carrier tricks to watch for

Each rule returns a Finding object with severity, description, and
supplement value so the report generator can display them.
"""

from dataclasses import dataclass, field
from typing import List, Optional
from enum import Enum


class Severity(Enum):
    """Finding severity levels."""
    CRITICAL = "critical"      # Code violation or completely missing item
    HIGH = "high"              # Significant underpayment (>$200)
    MEDIUM = "medium"          # Moderate underpayment ($50-$200)
    LOW = "low"                # Minor discrepancy (<$50)
    INFO = "info"              # Measurement difference, FYI


class FindingType(Enum):
    """Types of findings."""
    MISSING = "missing"             # Item completely absent from carrier scope
    UNDER_QTY = "under_quantity"    # Item present but quantity too low
    UNDER_PRICE = "under_price"     # Item present but unit price too low
    WRONG_ITEM = "wrong_item"       # Carrier used wrong Xactimate line item
    CODE_VIOLATION = "code_violation"  # Scope doesn't meet building code
    MEASUREMENT = "measurement"     # Measurement source discrepancy
    OVERPAYMENT = "overpayment"     # Carrier paid more (rare but note it)


@dataclass
class Finding:
    """A single finding from the rules engine."""
    rule_id: str                    # e.g., "R001", "C003", "M002"
    finding_type: FindingType
    severity: Severity
    item_description: str           # What line item this applies to
    title: str                      # Short finding title
    detail: str                     # Full explanation with evidence
    carrier_value: float = 0.0      # What carrier scoped ($)
    correct_value: float = 0.0      # What it should be ($)
    supplement_value: float = 0.0   # Difference (correct - carrier)
    carrier_qty: float = 0.0
    correct_qty: float = 0.0
    unit: str = ""
    code_reference: str = ""        # IRC/RCNYS code citation
    eagleview_reference: str = ""   # EagleView measurement backing this up


@dataclass
class RulesResult:
    """Complete result from running all rules."""
    findings: List[Finding] = field(default_factory=list)
    total_supplement: float = 0.0
    critical_count: int = 0
    high_count: int = 0
    measurement_source: str = ""

    def add(self, finding: Finding):
        self.findings.append(finding)
        if finding.supplement_value > 0:
            self.total_supplement += finding.supplement_value
        if finding.severity == Severity.CRITICAL:
            self.critical_count += 1
        elif finding.severity == Severity.HIGH:
            self.high_count += 1

    def by_severity(self, sev: Severity) -> List[Finding]:
        return [f for f in self.findings if f.severity == sev]

    def by_type(self, ft: FindingType) -> List[Finding]:
        return [f for f in self.findings if f.finding_type == ft]


# ======================================================================
# STATE CODE REQUIREMENTS
# ======================================================================

# Ice & Water barrier requirements by state
# Key insight: This is where carriers cheat the most
IW_REQUIREMENTS = {
    "NY": {
        "description": "RCNYS R905.1.2 — Ice barrier required from eave edge "
                       "extending ≥24 inches inside exterior wall line. "
                       "Valleys require full I&W coverage.",
        "eave_courses": 2,      # 2 courses up from eave (each ~3ft = 6ft total)
        "valley_width_ft": 3,   # 3ft wide each side of valley
        "valley_sides": 2,      # Both sides
        "code_ref": "RCNYS R905.1.2",
    },
    "OH": {
        "description": "RCO R905.1.2 — Ice barrier consisting of at least two "
                       "layers of underlayment cemented together or of "
                       "self-adhering polymer-modified bitumen sheet shall "
                       "extend from the eave edge to a point at least 24 inches "
                       "inside the exterior wall line of the building. "
                       "Valleys require full I&W coverage.",
        "eave_courses": 2,
        "valley_width_ft": 3,
        "valley_sides": 2,
        "code_ref": "RCO R905.1.2",
    },
    "PA": {
        "description": "IRC R905.1.2 — Ice barrier from eave edge extending "
                       "≥24 inches past interior wall line.",
        "eave_courses": 2,
        "valley_width_ft": 3,
        "valley_sides": 2,
        "code_ref": "IRC R905.1.2",
    },
    "NJ": {
        "description": "IRC R905.1.2 — Ice barrier required in areas where "
                       "average January temperature ≤25°F.",
        "eave_courses": 2,
        "valley_width_ft": 3,
        "valley_sides": 2,
        "code_ref": "IRC R905.1.2",
    },
}

# Tax rates by state
STATE_TAX = {
    "NY": 0.08,
    "OH": 0.0575,   # Ohio state sales tax (5.75%); counties add 0.25-2.25% — not modeled
    "PA": 0.00,
    "NJ": 0.06625,
}

# Mandatory roofing items — every roof replacement MUST have these
MANDATORY_ROOFING_ITEMS = [
    {
        "canonical": "shingle_removal",
        "match_terms": ["tear off", "remove", "haul and dispose", "shingle roofing"],
        "unit": "SQ",
        "code_ref": "Standard practice",
    },
    {
        "canonical": "shingle_install",
        "match_terms": ["laminated", "comp. shingle", "comp shingle", "architectural"],
        "unit": "SQ",
        "code_ref": "IRC R905.2",
    },
    {
        "canonical": "ice_water_barrier",
        "match_terms": ["ice", "water barrier", "ice & water", "i&w", "ice and water"],
        "unit": "SF",
        "code_ref": "IRC R905.1.2",  # State-specific prefix swapped at render time via _STATE_CODE_PREFIX
    },
    {
        "canonical": "underlayment",
        "match_terms": ["felt", "underlayment", "roofing felt", "synthetic underlayment"],
        "unit": "SQ",
        "code_ref": "IRC R905.1.1",
    },
    {
        "canonical": "drip_edge",
        "match_terms": ["drip edge"],
        "unit": "LF",
        "code_ref": "IRC R905.2.8.5",
    },
    {
        "canonical": "starter_strip",
        "match_terms": ["starter strip", "starter course"],
        "unit": "LF",
        "code_ref": "Manufacturer specification",
    },
    {
        "canonical": "ridge_cap",
        "match_terms": ["ridge cap", "cap shingle", "hip/ridge"],
        "unit": "LF",
        "code_ref": "Manufacturer specification",
    },
    {
        "canonical": "ridge_vent",
        "match_terms": ["ridge vent", "continuous ridge vent"],
        "unit": "LF",
        "code_ref": "IRC R806.1",
    },
    {
        "canonical": "step_flashing",
        "match_terms": ["step flashing"],
        "unit": "LF",
        "code_ref": "IRC R903.2.1",
    },
    {
        "canonical": "counter_flashing",
        "match_terms": ["counter", "apron flashing", "counter flashing", "base flashing"],
        "unit": "LF",
        "code_ref": "IRC R903.2.1",
    },
    {
        "canonical": "pipe_jack",
        "match_terms": ["pipe jack", "pipe flashing", "vent flashing"],
        "unit": "EA",
        "code_ref": "IRC R903.2.1",
    },
]


# ======================================================================
# KNOWN CARRIER UNDERPAYMENT PATTERNS
# ======================================================================

# These are specific tricks carriers use to reduce payouts.
# Each pattern describes what they do and how to detect it.

UNDERPAYMENT_PATTERNS = [
    {
        "id": "UP001",
        "name": "3-Tab Line for Starter Strip",
        "description": "Carrier uses a 3-tab shingle line item (0.33 SQ) for "
                        "starter course instead of the proper RFG ASTR starter strip line. "
                        "This typically underpays by $400+.",
        "detect": lambda item: (
            "3 tab" in item.get("description", "").lower() and
            "starter" in item.get("description", "").lower()
        ),
        "correct_item": "starter_strip",
    },
    {
        "id": "UP002",
        "name": "3-Tab Line for Ridge Cap",
        "description": "Carrier uses a 3-tab shingle line item for cap shingles "
                        "instead of laminated ridge cap. Underpays by $400+.",
        "detect": lambda item: (
            "3 tab" in item.get("description", "").lower() and
            ("cap" in item.get("description", "").lower() or
             "ridge" in item.get("description", "").lower())
        ),
        "correct_item": "ridge_cap",
    },
    {
        "id": "UP003",
        "name": "HOVER Instead of EagleView",
        "description": "Carrier used HOVER measurements instead of certified "
                        "EagleView. HOVER typically undermeasures by 1-5%.",
        "detect": lambda text: "hover" in text.lower() and "eagleview" not in text.lower(),
        "severity": Severity.MEDIUM,
    },
    {
        "id": "UP004",
        "name": "Minimal I&W Coverage",
        "description": "Carrier scopes less I&W than code requires. Common in NY "
                        "where 2 courses + valleys is mandatory.",
        "detect": lambda carrier_iw_sf, required_iw_sf: carrier_iw_sf < required_iw_sf * 0.5,
    },
    {
        "id": "UP005",
        "name": "No Labor Minimum",
        "description": "Carrier omits labor minimum hours for complex roof "
                        "(steep, high, multi-facet).",
        "detect": lambda items: not any(
            "labor" in i.get("description", "").lower() and
            ("roofer" in i.get("description", "").lower() or
             "minimum" in i.get("description", "").lower())
            for i in items
        ),
    },
    {
        "id": "UP006",
        "name": "No Equipment Operator",
        "description": "Carrier omits equipment operator charge on 2+ story "
                        "steep roof requiring material staging equipment.",
        "detect": lambda items: not any(
            "equipment" in i.get("description", "").lower() and
            "operator" in i.get("description", "").lower()
            for i in items
        ),
    },
    {
        "id": "UP007",
        "name": "Steep Charges Applied to Partial Area",
        "description": "Carrier applies steep roof charges to fewer squares "
                        "than the actual roof area.",
        "detect": lambda steep_qty, total_sq: steep_qty < total_sq * 0.8,
    },
    {
        "id": "UP008",
        "name": "High Roof Charges Applied to Partial Area",
        "description": "Carrier applies high roof charges to fewer squares "
                        "than the actual roof area on 2+ story building.",
        "detect": lambda high_qty, total_sq: high_qty < total_sq * 0.8,
    },
]


# ======================================================================
# MEASUREMENT VALIDATION RULES
# ======================================================================

def validate_measurements(carrier_meas, eagleview_meas, tolerance_pct=5.0):
    """Compare carrier measurements against EagleView, return findings.

    Args:
        carrier_meas: dict from CarrierScopeParser
        eagleview_meas: dict from EagleViewParser
        tolerance_pct: Acceptable variance percentage

    Returns:
        List[Finding]
    """
    findings = []

    comparisons = [
        {
            "name": "Roof Area",
            "carrier_key": "surface_area",
            "ev_key": "total_area_sf",
            "unit": "SF",
            "rule_id": "M001",
        },
        {
            "name": "Squares",
            "carrier_key": "num_squares",
            "ev_key": "total_squares",
            "unit": "SQ",
            "rule_id": "M002",
        },
        {
            "name": "Ridge Length",
            "carrier_key": "total_ridge",
            "ev_key": "ridge_lf",
            "unit": "LF",
            "rule_id": "M003",
        },
    ]

    for comp in comparisons:
        carrier_val = carrier_meas.get(comp["carrier_key"], 0)
        ev_val = eagleview_meas.get(comp["ev_key"], 0)

        if carrier_val == 0 or ev_val == 0:
            continue

        diff = ev_val - carrier_val
        pct = abs(diff / ev_val * 100) if ev_val else 0

        if pct > tolerance_pct:
            sev = Severity.HIGH if pct > 10 else Severity.MEDIUM
            findings.append(Finding(
                rule_id=comp["rule_id"],
                finding_type=FindingType.MEASUREMENT,
                severity=sev,
                item_description=comp["name"],
                title=f"{comp['name']} Discrepancy: {pct:.1f}%",
                detail=(
                    f"Carrier measurement: {carrier_val:.1f} {comp['unit']} | "
                    f"EagleView certified: {ev_val:.1f} {comp['unit']} | "
                    f"Difference: {diff:+.1f} {comp['unit']} ({pct:.1f}%)"
                ),
                carrier_value=carrier_val,
                correct_value=ev_val,
                carrier_qty=carrier_val,
                correct_qty=ev_val,
                unit=comp["unit"],
                eagleview_reference=f"EagleView Report certified {ev_val:.1f} {comp['unit']}",
            ))

    return findings


def check_ice_water(carrier_items, eagleview_meas, state="NY"):
    """Check if Ice & Water barrier meets state code requirements.

    This is the single biggest source of carrier underpayment.
    The formula: I&W SF = (eave_lf × 6ft) + (valley_lf × 3ft × 2 sides)

    Returns: Finding or None
    """
    req = IW_REQUIREMENTS.get(state)
    if not req:
        return None

    eave_lf = eagleview_meas.get("eave_lf", 0)
    valley_lf = eagleview_meas.get("valley_lf", 0)

    # Required I&W: 2 courses (6ft) on eaves + full valleys (3ft × 2 sides)
    required_sf = (eave_lf * req["eave_courses"] * 3) + \
                  (valley_lf * req["valley_width_ft"] * req["valley_sides"])

    # Find carrier's I&W line item
    carrier_iw_sf = 0
    carrier_iw_ext = 0
    for item in carrier_items:
        desc = item.get("description", "").lower()
        if "ice" in desc and "water" in desc:
            carrier_iw_sf = item.get("qty", 0)
            carrier_iw_ext = item.get("extension", item.get("rcv", 0))
            break

    if carrier_iw_sf == 0:
        return Finding(
            rule_id="C001",
            finding_type=FindingType.MISSING,
            severity=Severity.CRITICAL,
            item_description="Ice & Water Barrier",
            title="Ice & Water Barrier COMPLETELY MISSING",
            detail=(
                f"Carrier scope has NO ice & water barrier. "
                f"{req['code_ref']} requires {required_sf:.0f} SF minimum "
                f"({eave_lf} LF eaves × 6ft + {valley_lf} LF valleys × 6ft)."
            ),
            carrier_value=0,
            correct_value=required_sf,
            carrier_qty=0,
            correct_qty=required_sf,
            unit="SF",
            code_reference=req["code_ref"],
        )

    if carrier_iw_sf < required_sf * 0.8:  # Allow 20% tolerance
        # Estimate the dollar impact
        # Typical I&W price ~$2.35/SF
        price_per_sf = carrier_iw_ext / carrier_iw_sf if carrier_iw_sf > 0 else 2.35
        correct_ext = required_sf * price_per_sf
        supplement = correct_ext - carrier_iw_ext

        return Finding(
            rule_id="C001",
            finding_type=FindingType.UNDER_QTY,
            severity=Severity.CRITICAL,
            item_description="Ice & Water Barrier",
            title=f"I&W Severely Under-Scoped: {carrier_iw_sf:.0f} SF vs {required_sf:.0f} SF required",
            detail=(
                f"Carrier scoped {carrier_iw_sf:.0f} SF of I&W barrier. "
                f"{req['code_ref']} requires minimum {required_sf:.0f} SF "
                f"({eave_lf} LF eaves × {req['eave_courses']} courses × 3ft = "
                f"{eave_lf * req['eave_courses'] * 3:.0f} SF eaves + "
                f"{valley_lf} LF valleys × {req['valley_width_ft']}ft × "
                f"{req['valley_sides']} sides = "
                f"{valley_lf * req['valley_width_ft'] * req['valley_sides']:.0f} SF valleys). "
                f"Carrier coverage is only {carrier_iw_sf/required_sf*100:.0f}% of code minimum."
            ),
            carrier_value=carrier_iw_ext,
            correct_value=correct_ext,
            supplement_value=round(supplement, 2),
            carrier_qty=carrier_iw_sf,
            correct_qty=required_sf,
            unit="SF",
            code_reference=req["code_ref"],
            eagleview_reference=f"Eaves: {eave_lf} LF, Valleys: {valley_lf} LF per EagleView",
        )

    return None


def check_quantity_vs_eagleview(carrier_items, eagleview_meas):
    """Check each carrier line item quantity against EagleView measurements.

    This catches items that are present but undermeasured. Maps each
    line item type to the EagleView measurement it should be based on.

    Returns: List[Finding]
    """
    findings = []

    # Map canonical item types to EagleView measurements and expected quantities
    qty_checks = [
        {
            "rule_id": "Q001",
            "name": "Drip Edge",
            "match_terms": ["drip edge"],
            "ev_formula": lambda m: m.get("eave_lf", 0) + m.get("rake_lf", 0),
            "ev_label": "Eaves + Rakes",
            "unit": "LF",
            "tolerance_pct": 10,
        },
        {
            "rule_id": "Q002",
            "name": "Ridge Vent",
            "match_terms": ["ridge vent", "continuous ridge"],
            "ev_formula": lambda m: m.get("ridge_lf", 0),
            "ev_label": "Ridge length",
            "unit": "LF",
            "tolerance_pct": 10,
        },
        {
            "rule_id": "Q003",
            "name": "Starter Strip",
            "match_terms": ["starter strip", "starter course"],
            "ev_formula": lambda m: m.get("eave_lf", 0) + m.get("rake_lf", 0),
            "ev_label": "Eaves + Rakes",
            "unit": "LF",
            "tolerance_pct": 10,
        },
        {
            "rule_id": "Q004",
            "name": "Step Flashing",
            "match_terms": ["step flashing"],
            "ev_formula": lambda m: m.get("step_flashing_lf", 0),
            "ev_label": "Step flashing length",
            "unit": "LF",
            "tolerance_pct": 15,
        },
        {
            "rule_id": "Q005",
            "name": "Counter/Apron Flashing",
            "match_terms": ["counter", "apron flashing"],
            "ev_formula": lambda m: m.get("flashing_lf", 0),
            "ev_label": "Flashing length",
            "unit": "LF",
            "tolerance_pct": 15,
        },
        {
            "rule_id": "Q006",
            "name": "Shingle Tear-Off",
            "match_terms": ["tear off", "remove", "haul and dispose"],
            "ev_formula": lambda m: m.get("total_squares", 0),
            "ev_label": "Total squares",
            "unit": "SQ",
            "tolerance_pct": 5,
        },
    ]

    for check in qty_checks:
        ev_qty = check["ev_formula"](eagleview_meas)
        if ev_qty == 0:
            continue

        # Find matching carrier line item
        carrier_item = None
        for item in carrier_items:
            desc = item.get("description", "").lower()
            if any(term in desc for term in check["match_terms"]):
                # For tear-off, make sure it's actually a removal item
                if check["rule_id"] == "Q006":
                    if not any(w in desc for w in ["tear", "remove", "haul"]):
                        continue
                carrier_item = item
                break

        if carrier_item is None:
            # Item missing entirely — handled by completeness check
            continue

        carrier_qty = carrier_item.get("qty", 0)
        diff = ev_qty - carrier_qty
        pct = abs(diff / ev_qty * 100) if ev_qty else 0

        if pct > check["tolerance_pct"] and diff > 0:
            unit_price = carrier_item.get("unit_price", 0)
            supplement = round(diff * unit_price, 2)

            sev = Severity.HIGH if supplement > 200 else Severity.MEDIUM

            findings.append(Finding(
                rule_id=check["rule_id"],
                finding_type=FindingType.UNDER_QTY,
                severity=sev,
                item_description=check["name"],
                title=f"{check['name']} Under-Measured: {carrier_qty:.1f} vs {ev_qty:.0f} {check['unit']}",
                detail=(
                    f"Carrier scoped {carrier_qty:.2f} {check['unit']}. "
                    f"EagleView {check['ev_label']}: {ev_qty:.0f} {check['unit']}. "
                    f"Short by {diff:.1f} {check['unit']} ({pct:.0f}%). "
                    f"At ${unit_price:.2f}/{check['unit']}, supplement = ${supplement:.2f}."
                ),
                carrier_value=round(carrier_qty * unit_price, 2),
                correct_value=round(ev_qty * unit_price, 2),
                supplement_value=supplement,
                carrier_qty=carrier_qty,
                correct_qty=ev_qty,
                unit=check["unit"],
                eagleview_reference=f"{check['ev_label']}: {ev_qty:.0f} {check['unit']}",
            ))

    return findings


def check_underpayment_patterns(carrier_items, carrier_text=""):
    """Detect known carrier underpayment tricks.

    Returns: List[Finding]
    """
    findings = []

    # UP001: 3-tab line for starter strip
    for item in carrier_items:
        desc = item.get("description", "").lower()

        # Check for notes/context indicating starter or cap usage
        if "3 tab" in desc or "3-tab" in desc:
            notes = item.get("notes", "").lower() if item.get("notes") else ""

            if "starter" in desc or "starter" in notes:
                findings.append(Finding(
                    rule_id="UP001",
                    finding_type=FindingType.WRONG_ITEM,
                    severity=Severity.HIGH,
                    item_description="Starter Strip",
                    title="Wrong Line Item for Starter: 3-Tab Used Instead of Starter Strip",
                    detail=(
                        f"Carrier used 3-tab shingle line ({item.get('qty', 0)} SQ @ "
                        f"${item.get('unit_price', 0):.2f}) for starter course. "
                        f"Proper Xactimate line is RFG ASTR (starter strip) measured in LF. "
                        f"This typically underpays by $400+."
                    ),
                    carrier_value=item.get("extension", item.get("rcv", 0)),
                ))

            if "cap" in desc or "cap" in notes or "ridge" in notes:
                findings.append(Finding(
                    rule_id="UP002",
                    finding_type=FindingType.WRONG_ITEM,
                    severity=Severity.HIGH,
                    item_description="Ridge Cap",
                    title="Wrong Line Item for Ridge Cap: 3-Tab Used Instead of Laminated Ridge Cap",
                    detail=(
                        f"Carrier used 3-tab shingle line ({item.get('qty', 0)} SQ @ "
                        f"${item.get('unit_price', 0):.2f}) for cap shingles. "
                        f"Proper Xactimate line is laminated ridge/hip cap measured in LF. "
                        f"This typically underpays by $400+."
                    ),
                    carrier_value=item.get("extension", item.get("rcv", 0)),
                ))

    # UP003: HOVER measurements
    if "hover" in carrier_text.lower():
        findings.append(Finding(
            rule_id="UP003",
            finding_type=FindingType.MEASUREMENT,
            severity=Severity.MEDIUM,
            item_description="Measurement Source",
            title="Carrier Used HOVER Measurements Instead of EagleView",
            detail=(
                "Carrier scope was generated from HOVER measurements. "
                "HOVER typically undermeasures roof area by 1-5% compared to "
                "EagleView certified measurements. All area-based line items "
                "may be affected."
            ),
        ))

    # UP005: No labor minimum
    has_labor_min = any(
        "labor" in i.get("description", "").lower() and
        ("roofer" in i.get("description", "").lower() or
         "per hour" in i.get("description", "").lower())
        for i in carrier_items
    )
    if not has_labor_min:
        findings.append(Finding(
            rule_id="UP005",
            finding_type=FindingType.MISSING,
            severity=Severity.HIGH,
            item_description="Roofer Labor Minimum",
            title="No Roofer Labor Minimum Included",
            detail=(
                "Carrier scope does not include roofer labor minimum (per hour). "
                "This is standard for complex roofs requiring additional labor "
                "beyond what's built into per-square pricing."
            ),
        ))

    # UP006: No equipment operator
    has_equip = any(
        "equipment" in i.get("description", "").lower() and
        "operator" in i.get("description", "").lower()
        for i in carrier_items
    )
    if not has_equip:
        findings.append(Finding(
            rule_id="UP006",
            finding_type=FindingType.MISSING,
            severity=Severity.MEDIUM,
            item_description="Equipment Operator",
            title="No Equipment Operator Charge",
            detail=(
                "Carrier scope does not include equipment operator charge. "
                "Required for 2+ story and/or steep roofs requiring material "
                "staging equipment."
            ),
        ))

    return findings


def check_completeness(carrier_items, eagleview_meas):
    """Check that all mandatory roofing items are present in carrier scope.

    Returns: List[Finding]
    """
    findings = []

    for mandatory in MANDATORY_ROOFING_ITEMS:
        # Check if carrier has this item
        found = False
        for item in carrier_items:
            desc = item.get("description", "").lower()
            if any(term in desc for term in mandatory["match_terms"]):
                found = True
                break

        if not found:
            # Determine if this item is actually needed based on measurements
            canonical = mandatory["canonical"]

            # Skip items that don't apply based on measurements
            if canonical == "step_flashing" and eagleview_meas.get("step_flashing_lf", 0) == 0:
                continue
            if canonical == "counter_flashing" and eagleview_meas.get("flashing_lf", 0) == 0:
                continue
            if canonical == "pipe_jack" and eagleview_meas.get("penetrations", 0) == 0:
                # Pipe jacks usually exist but might not be in EagleView — flag as info
                pass

            findings.append(Finding(
                rule_id=f"COMP_{mandatory['canonical'].upper()}",
                finding_type=FindingType.MISSING,
                severity=Severity.CRITICAL if canonical in [
                    "ice_water_barrier", "underlayment", "drip_edge",
                    "starter_strip", "ridge_cap"
                ] else Severity.HIGH,
                item_description=mandatory["canonical"].replace("_", " ").title(),
                title=f"{mandatory['canonical'].replace('_', ' ').title()} — MISSING from carrier scope",
                detail=(
                    f"Carrier scope does not include {mandatory['canonical'].replace('_', ' ')}. "
                    f"This is a mandatory roofing component per {mandatory['code_ref']}."
                ),
                code_reference=mandatory["code_ref"],
            ))

    return findings


# ======================================================================
# MASTER RULE RUNNER
# ======================================================================

def run_all_rules(carrier_data, eagleview_data, usarm_data=None, state="NY"):
    """Run all rules and return consolidated findings.

    Args:
        carrier_data: parsed carrier scope (from CarrierScopeParser)
        eagleview_data: parsed EagleView measurements (from EagleViewParser)
        usarm_data: parsed USARM estimate (from USARMEstimateParser), optional
        state: two-letter state code

    Returns:
        RulesResult with all findings
    """
    result = RulesResult()
    result.measurement_source = "eagleview"

    carrier_items = carrier_data.get("line_items", [])
    carrier_meas = carrier_data.get("measurements", {})
    carrier_text = ""  # Would come from raw PDF text

    # 1. Measurement validation
    meas_findings = validate_measurements(carrier_meas, eagleview_data)
    for f in meas_findings:
        result.add(f)

    # 2. I&W code compliance
    iw_finding = check_ice_water(carrier_items, eagleview_data, state)
    if iw_finding:
        result.add(iw_finding)

    # 3. Quantity vs EagleView
    qty_findings = check_quantity_vs_eagleview(carrier_items, eagleview_data)
    for f in qty_findings:
        result.add(f)

    # 4. Underpayment pattern detection
    up_findings = check_underpayment_patterns(carrier_items, carrier_text)
    for f in up_findings:
        result.add(f)

    # 5. Completeness check
    comp_findings = check_completeness(carrier_items, eagleview_data)
    for f in comp_findings:
        result.add(f)

    return result
