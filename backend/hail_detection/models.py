"""
Core data models for the hail damage detection system.
All results serializable to JSON for claim_config.json integration.
"""

from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any, Tuple


@dataclass
class DamageAssessment:
    """Assessment of a single photo for hail damage."""
    damage_type: str              # hail_hit | blister | granule_loss | mechanical | wear | none
    confidence: float             # 0.0-1.0
    severity: str                 # cosmetic | functional | structural
    hit_count_estimate: int = 0
    hit_size_range_mm: Tuple[float, float] = (0.0, 0.0)
    evidence: List[str] = field(default_factory=list)       # specific visual indicators found
    differentiation: Dict[str, Any] = field(default_factory=dict)  # why this IS hail (not blister, etc.)
    photo_key: str = ""
    file_path: str = ""

    def to_dict(self) -> dict:
        d = asdict(self)
        d["hit_size_range_mm"] = list(self.hit_size_range_mm)
        return d


@dataclass
class SoftMetalFinding:
    """Finding from a single soft metal surface."""
    component: str                # gutter | downspout | window_wrap | fascia | etc.
    elevation: str                # north | south | east | west
    chalked: bool                 # was chalk protocol applied?
    dent_count: int = 0
    dent_size_range_mm: Tuple[float, float] = (0.0, 0.0)
    confidence: float = 0.0
    photo_key: str = ""
    notes: str = ""

    def to_dict(self) -> dict:
        d = asdict(self)
        d["dent_size_range_mm"] = list(self.dent_size_range_mm)
        return d


@dataclass
class EvidenceCascade:
    """Follows Tom's crime-scene methodology -- ground up."""
    environmental: List[Dict[str, str]] = field(default_factory=list)    # plant damage, spatter
    soft_metals: List[SoftMetalFinding] = field(default_factory=list)    # chalked metal findings
    soft_metals_chalked: bool = False      # AI flag: were metals chalked?
    directional_pattern: Dict[str, Any] = field(default_factory=dict)    # per-elevation damage density
    roof_damage: List[DamageAssessment] = field(default_factory=list)    # per-photo roof findings
    logical_trap_argument: str = ""        # auto-generated carrier rebuttal
    overall_confidence: float = 0.0

    def to_dict(self) -> dict:
        return {
            "environmental": self.environmental,
            "soft_metals": [sm.to_dict() for sm in self.soft_metals],
            "soft_metals_chalked": self.soft_metals_chalked,
            "directional_pattern": self.directional_pattern,
            "roof_damage": [rd.to_dict() for rd in self.roof_damage],
            "logical_trap_argument": self.logical_trap_argument,
            "overall_confidence": self.overall_confidence,
        }


@dataclass
class DifferentiationReport:
    """Detailed differentiation analysis: hail vs. blister vs. mechanical vs. wear."""
    conclusion: str               # hail | blister | mechanical | wear | inconclusive
    hail_indicators: List[str] = field(default_factory=list)
    blister_indicators: List[str] = field(default_factory=list)
    mechanical_indicators: List[str] = field(default_factory=list)
    wear_indicators: List[str] = field(default_factory=list)
    confidence: float = 0.0
    reasoning: str = ""
    photo_key: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ClaimAssessment:
    """Complete hail damage assessment for an entire claim."""
    claim_slug: str = ""
    photos_analyzed: int = 0
    damage_confirmed: bool = False
    evidence_cascade: Optional[EvidenceCascade] = None
    damage_type: str = ""                 # primary damage type across all photos
    overall_confidence: float = 0.0
    severity: str = ""                    # cosmetic | functional | structural
    recommended_action: str = ""          # spot_repair | slope_replacement | full_replacement
    carrier_rebuttal_points: List[str] = field(default_factory=list)
    time_bomb_note: str = ""              # "damage will progress to leak within X years"
    individual_assessments: List[DamageAssessment] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "claim_slug": self.claim_slug,
            "photos_analyzed": self.photos_analyzed,
            "damage_confirmed": self.damage_confirmed,
            "evidence_cascade": self.evidence_cascade.to_dict() if self.evidence_cascade else None,
            "damage_type": self.damage_type,
            "overall_confidence": self.overall_confidence,
            "severity": self.severity,
            "recommended_action": self.recommended_action,
            "carrier_rebuttal_points": self.carrier_rebuttal_points,
            "time_bomb_note": self.time_bomb_note,
            "individual_assessments": [a.to_dict() for a in self.individual_assessments],
        }

    def print_summary(self):
        """Print formatted summary to stdout."""
        status = "CONFIRMED" if self.damage_confirmed else "NOT CONFIRMED"
        print(f"\n  Hail Damage Assessment: {status}")
        print(f"  Photos analyzed: {self.photos_analyzed}")
        print(f"  Overall confidence: {self.overall_confidence:.0%}")
        print(f"  Severity: {self.severity}")
        print(f"  Recommended action: {self.recommended_action}")
        if self.evidence_cascade:
            ec = self.evidence_cascade
            print(f"  Soft metals chalked: {'Yes' if ec.soft_metals_chalked else 'NO — INCOMPLETE'}")
            print(f"  Soft metal findings: {len(ec.soft_metals)}")
            print(f"  Roof damage photos: {len(ec.roof_damage)}")
        if self.time_bomb_note:
            print(f"  Time bomb: {self.time_bomb_note}")
        if self.carrier_rebuttal_points:
            print(f"\n  Carrier Rebuttal Points:")
            for i, point in enumerate(self.carrier_rebuttal_points, 1):
                print(f"    {i}. {point}")
        print()
