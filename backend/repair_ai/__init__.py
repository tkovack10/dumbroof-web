"""
DumbRoof Repair AI — Leak Diagnosis & Repair Instruction Engine
===============================================================
Photo-in → diagnosis + repair instructions + homeowner ticket + price.

Usage:
    python3 -m repair_ai jobs/{job-id}/repair_job_config.json
    python3 -m repair_ai --diagnose photos/ --notes "leak below chimney"
"""

from .models import RepairJob, Diagnosis, RepairStep, MaterialItem
from .config import REPAIR_TYPES, LEAK_FAMILIES, LEGACY_REPAIR_TYPE_MAP, SKILL_LEVELS, SEVERITY_LEVELS, DIAGNOSTIC_FEE

__version__ = "2.0.0"
