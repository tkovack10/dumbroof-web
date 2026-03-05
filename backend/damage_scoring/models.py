"""
Data models for the USARM Dual Score System.
Damage Score (0-100) + Technical Approval Score (0-100%).
"""

from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any


# --- Damage Score Components ---

@dataclass
class RoofSurfaceDamage:
    """Component A: Roof surface damage (0-40 pts)."""
    damage_confirmation: int = 0       # A1: 0-10
    severity_spectrum: int = 0         # A2: 0-12
    hit_density: int = 0              # A3: 0-10
    cross_photo_consistency: int = 0   # A4: 0-5
    aging_freshness: int = 0          # A5: 0-3

    @property
    def total(self) -> int:
        return min(40, self.damage_confirmation + self.severity_spectrum +
                   self.hit_density + self.cross_photo_consistency +
                   self.aging_freshness)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["total"] = self.total
        return d


@dataclass
class EvidenceCascadeCompleteness:
    """Component B: Evidence cascade completeness (0-25 pts)."""
    environmental_evidence: int = 0    # B1: 0-5
    soft_metal_documentation: int = 0  # B2: 0-7
    chalk_protocol: int = 0           # B3: 0-5
    directional_pattern: int = 0      # B4: 0-5
    roof_test_areas: int = 0          # B5: 0-3

    @property
    def total(self) -> int:
        return min(25, self.environmental_evidence + self.soft_metal_documentation +
                   self.chalk_protocol + self.directional_pattern +
                   self.roof_test_areas)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["total"] = self.total
        return d


@dataclass
class SoftMetalCorroboration:
    """Component C: Soft metal corroboration (0-20 pts)."""
    component_diversity: int = 0   # C1: 0-7
    dent_volume: int = 0          # C2: 0-5
    size_correlation: int = 0     # C3: 0-4
    elevation_coverage: int = 0   # C4: 0-4

    @property
    def total(self) -> int:
        return min(20, self.component_diversity + self.dent_volume +
                   self.size_correlation + self.elevation_coverage)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["total"] = self.total
        return d


@dataclass
class DocumentationQuality:
    """Component D: Documentation quality (0-15 pts)."""
    photo_count: int = 0       # D1: 0-4
    coverage_breadth: int = 0  # D2: 0-4
    photo_integrity: int = 0   # D3: 0-3
    technique: int = 0         # D4: 0-4

    @property
    def total(self) -> int:
        return min(15, self.photo_count + self.coverage_breadth +
                   self.photo_integrity + self.technique)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["total"] = self.total
        return d


@dataclass
class DamageScoreResult:
    """Complete Damage Score result (0-100)."""
    roof_surface: RoofSurfaceDamage = field(default_factory=RoofSurfaceDamage)
    evidence_cascade: EvidenceCascadeCompleteness = field(default_factory=EvidenceCascadeCompleteness)
    soft_metal: SoftMetalCorroboration = field(default_factory=SoftMetalCorroboration)
    documentation: DocumentationQuality = field(default_factory=DocumentationQuality)

    @property
    def score(self) -> int:
        return min(100, self.roof_surface.total + self.evidence_cascade.total +
                   self.soft_metal.total + self.documentation.total)

    @property
    def grade(self) -> str:
        s = self.score
        if s >= 90: return "A"
        if s >= 80: return "B"
        if s >= 70: return "C+"
        if s >= 60: return "C"
        if s >= 50: return "C-"
        if s >= 35: return "D"
        if s >= 20: return "D-"
        return "F"

    def to_dict(self) -> dict:
        return {
            "score": self.score,
            "grade": self.grade,
            "roof_surface": self.roof_surface.to_dict(),
            "evidence_cascade": self.evidence_cascade.to_dict(),
            "soft_metal": self.soft_metal.to_dict(),
            "documentation": self.documentation.to_dict(),
        }

    def print_summary(self):
        print(f"  Damage Score: {self.score}/100 (Grade: {self.grade})")
        print(f"    A. Roof Surface Damage:    {self.roof_surface.total}/40")
        print(f"    B. Evidence Cascade:        {self.evidence_cascade.total}/25")
        print(f"    C. Soft Metal Corroboration:{self.soft_metal.total}/20")
        print(f"    D. Documentation Quality:   {self.documentation.total}/15")


# --- Technical Approval Score Components ---

@dataclass
class ProductFactor:
    """TAS Component 2: Product factor (0-25 pts)."""
    discontinuation_status: int = 0   # P1: 0-12
    exposure_mismatch: int = 0        # P2: 0-6
    color_style_match: int = 0        # P3: 0-4
    itel_nts_confirmation: int = 0    # P4: 0-3
    product_name: str = ""
    manufacturer: str = ""
    status: str = "unknown"

    @property
    def total(self) -> int:
        return min(25, self.discontinuation_status + self.exposure_mismatch +
                   self.color_style_match + self.itel_nts_confirmation)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["total"] = self.total
        return d


@dataclass
class CodeTriggerFactor:
    """TAS Component 3: Code trigger factor (0-20 pts)."""
    house_wrap_corner_rule: int = 0   # CT1: 0-6
    tearoff_requirement: int = 0      # CT2: 0-4
    ice_water_shield: int = 0         # CT3: 0-3
    drip_edge: int = 0               # CT4: 0-2
    other_code_violations: int = 0    # CT5: 0-5
    triggered_codes: List[str] = field(default_factory=list)

    @property
    def total(self) -> int:
        return min(20, self.house_wrap_corner_rule + self.tearoff_requirement +
                   self.ice_water_shield + self.drip_edge +
                   self.other_code_violations)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["total"] = self.total
        return d


@dataclass
class CarrierFactor:
    """TAS Component 4: Carrier factor (0-10 pts)."""
    win_rate: int = 0        # CF1: 0-5
    behavior: int = 0        # CF2: 0-5
    carrier_name: str = ""
    historical_wins: int = 0
    historical_losses: int = 0

    @property
    def total(self) -> int:
        return min(10, self.win_rate + self.behavior)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["total"] = self.total
        return d


@dataclass
class ScopeFactor:
    """TAS Component 5: Scope factor (0-10 pts)."""
    trade_count: int = 0         # SF1: 0-5
    collateral_damage: int = 0   # SF2: 0-3
    matching_arguments: int = 0  # SF3: 0-2
    trades_identified: List[str] = field(default_factory=list)

    @property
    def total(self) -> int:
        return min(10, self.trade_count + self.collateral_damage +
                   self.matching_arguments)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["total"] = self.total
        return d


@dataclass
class TechnicalApprovalResult:
    """Complete Technical Approval Score result (0-100%)."""
    damage_factor_pts: int = 0  # From DS conversion (0-35)
    product: ProductFactor = field(default_factory=ProductFactor)
    code_triggers: CodeTriggerFactor = field(default_factory=CodeTriggerFactor)
    carrier: CarrierFactor = field(default_factory=CarrierFactor)
    scope: ScopeFactor = field(default_factory=ScopeFactor)

    @property
    def score(self) -> int:
        return min(100, self.damage_factor_pts + self.product.total +
                   self.code_triggers.total + self.carrier.total +
                   self.scope.total)

    @property
    def grade(self) -> str:
        s = self.score
        if s >= 90: return "A"
        if s >= 80: return "B"
        if s >= 70: return "C"
        if s >= 60: return "C-"
        if s >= 50: return "D"
        return "F"

    def to_dict(self) -> dict:
        return {
            "score": self.score,
            "grade": self.grade,
            "damage_factor_pts": self.damage_factor_pts,
            "product": self.product.to_dict(),
            "code_triggers": self.code_triggers.to_dict(),
            "carrier": self.carrier.to_dict(),
            "scope": self.scope.to_dict(),
        }

    def print_summary(self):
        print(f"  Technical Approval Score: {self.score}% (Grade: {self.grade})")
        print(f"    1. Damage Factor:     {self.damage_factor_pts}/35")
        print(f"    2. Product Factor:    {self.product.total}/25")
        print(f"    3. Code Triggers:     {self.code_triggers.total}/20")
        print(f"    4. Carrier Factor:    {self.carrier.total}/10")
        print(f"    5. Scope Factor:      {self.scope.total}/10")


# --- Product Match ---

@dataclass
class ProductMatch:
    """Result from product discontinuation database lookup."""
    matched: bool = False
    manufacturer: str = ""
    product_line: str = ""
    product_type: str = ""
    exposure_inches: float = 0.0
    status: str = "unknown"
    discontinuation_year: Optional[int] = None
    compatible_replacements: List[str] = field(default_factory=list)
    matching_difficulty: str = "unknown"
    car_compatibility: bool = True
    car_availability: bool = True
    car_repairability: bool = True
    tas_boost: int = 0
    confidence: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)


# --- Combined Result ---

@dataclass
class DualScoreResult:
    """Combined Damage Score + Technical Approval Score."""
    claim_slug: str = ""
    address: str = ""
    city: str = ""
    state: str = ""
    zip_code: str = ""
    county: str = ""
    lat: Optional[float] = None
    lon: Optional[float] = None
    damage: DamageScoreResult = field(default_factory=DamageScoreResult)
    approval: TechnicalApprovalResult = field(default_factory=TechnicalApprovalResult)
    product_match: Optional[ProductMatch] = None
    analysis_metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = {
            "claim_slug": self.claim_slug,
            "address": self.address,
            "city": self.city,
            "state": self.state,
            "zip_code": self.zip_code,
            "county": self.county,
            "lat": self.lat,
            "lon": self.lon,
            "damage_score": self.damage.score,
            "damage_grade": self.damage.grade,
            "approval_score": self.approval.score,
            "approval_grade": self.approval.grade,
            "damage_breakdown": self.damage.to_dict(),
            "approval_breakdown": self.approval.to_dict(),
            "product_match": self.product_match.to_dict() if self.product_match else None,
            "analysis_metadata": self.analysis_metadata,
        }
        return d

    def print_summary(self):
        print(f"\n  {'='*50}")
        print(f"  DUAL SCORE: {self.claim_slug}")
        if self.address:
            print(f"  {self.address}, {self.city}, {self.state} {self.zip_code}")
        print(f"  {'='*50}")
        print()
        self.damage.print_summary()
        print()
        self.approval.print_summary()
        print()
        # Interpretation
        ds = self.damage.score
        tas = self.approval.score
        if ds >= 80 and tas >= 80:
            print("  Interpretation: Slam dunk. File immediately.")
        elif ds < 40 and tas >= 75:
            print("  Interpretation: Light damage, but technicalities make it a winner. File.")
        elif ds >= 70 and tas < 60:
            print("  Interpretation: Good damage, but carrier will fight. Prepare for battle.")
        elif ds >= 50 and tas >= 70:
            print("  Interpretation: Moderate damage + technical leverage. Should file.")
        elif tas < 40:
            print("  Interpretation: Don't file. Insufficient damage and no technical leverage.")
        elif tas < 60:
            print("  Interpretation: Borderline. Review all factors before deciding.")
        else:
            print("  Interpretation: File with standard preparation.")
        print(f"  {'='*50}")
