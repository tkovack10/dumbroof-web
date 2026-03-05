"""
USARM Dual Score System — Damage Score + Technical Approval Score.
Proprietary scoring engine for storm damage insurance claim viability analysis.
"""

__version__ = "1.0.0"

from damage_scoring.models import (
    DamageScoreResult,
    TechnicalApprovalResult,
    DualScoreResult,
    ProductMatch,
    RoofSurfaceDamage,
    EvidenceCascadeCompleteness,
    SoftMetalCorroboration,
    DocumentationQuality,
    ProductFactor,
    CodeTriggerFactor,
    CarrierFactor,
    ScopeFactor,
)
from damage_scoring.damage_scorer import compute_damage_score
from damage_scoring.approval_scorer import compute_approval_score
