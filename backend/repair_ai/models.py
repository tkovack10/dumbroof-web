"""
Core data classes for the repair diagnostic engine.
All results are JSON-serializable for repair_job_config.json storage.
"""

from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any


@dataclass
class MaterialItem:
    """A single material needed for the repair."""
    item: str
    qty: float
    unit: str           # EA, LF, SF, SQ, bundle, tube, bag
    cost: float         # unit cost

    @property
    def total(self) -> float:
        return round(self.qty * self.cost, 2)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["total"] = self.total
        return d


@dataclass
class RepairStep:
    """A single step in the repair procedure."""
    step: int
    title_en: str
    title_es: str
    instructions_en: str
    instructions_es: str
    materials: List[str] = field(default_factory=list)
    time_minutes: int = 0
    safety_note_en: Optional[str] = None
    safety_note_es: Optional[str] = None
    photo_reference: Optional[str] = None  # photo key like "p01"

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Diagnosis:
    """AI diagnosis of the leak source."""
    primary_code: str       # one of 22 repair codes (e.g. CHM-SIDE, VENT-BOOT)
    family: Optional[str]   # leak family (e.g. chimney, penetration) or None for special codes
    leak_source: str        # plain-English description of what's causing the leak
    severity: str           # key from config.SEVERITY_LEVELS
    confidence: float       # 0.0 - 1.0
    decision_path: str = "" # triage path trace (e.g. "S1>S2>S3>S3C")
    is_temporary: bool = False     # True if recommending temporary fix (tarp)
    secondary_codes: List[str] = field(default_factory=list)  # other codes that may also apply
    escalation_flag: Optional[str] = None  # non-roofing trade needed (mason, HVAC, etc.)

    @property
    def repair_type(self) -> str:
        """Backward compat — maps to primary_code."""
        return self.primary_code

    def to_dict(self) -> dict:
        d = asdict(self)
        d["repair_type"] = self.primary_code  # backward compat
        return d


@dataclass
class RepairJob:
    """Complete repair job — diagnosis + instructions + pricing + homeowner ticket."""
    job_id: str
    status: str = "submitted"

    # Diagnosis
    diagnosis: Optional[Diagnosis] = None
    photo_annotations: Dict[str, str] = field(default_factory=dict)

    # Repair instructions
    repair_summary: str = ""
    repair_steps: List[RepairStep] = field(default_factory=list)
    materials_list: List[MaterialItem] = field(default_factory=list)

    # Pricing
    labor_hours: float = 0
    labor_cost: float = 0
    materials_cost: float = 0
    total_price: float = 0

    # Homeowner ticket
    what_we_found: str = ""
    what_we_recommend: str = ""
    price_display: str = ""
    time_estimate: str = ""
    urgency: str = "moderate"
    warranty: str = "2-year workmanship warranty"

    # Completion
    completed_date: Optional[str] = None
    completion_photos: List[str] = field(default_factory=list)
    completion_notes: str = ""

    def to_dict(self) -> dict:
        return {
            "job_id": self.job_id,
            "status": self.status,
            "diagnosis": self.diagnosis.to_dict() if self.diagnosis else None,
            "photo_annotations": self.photo_annotations,
            "repair": {
                "summary": self.repair_summary,
                "steps": [s.to_dict() for s in self.repair_steps],
                "materials_list": [m.to_dict() for m in self.materials_list],
                "labor_hours": self.labor_hours,
                "labor_cost": self.labor_cost,
                "materials_cost": self.materials_cost,
                "total_price": self.total_price,
            },
            "homeowner_ticket": {
                "what_we_found": self.what_we_found,
                "what_we_recommend": self.what_we_recommend,
                "price": self.total_price,
                "time_estimate": self.time_estimate,
                "urgency": self.urgency,
                "warranty": self.warranty,
            },
            "completion": {
                "completed_date": self.completed_date,
                "completion_photos": self.completion_photos,
                "notes": self.completion_notes,
            },
        }
