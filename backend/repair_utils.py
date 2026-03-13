"""
Repair Utilities — Shared helpers for the checkpoint repair system.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional, Dict, Any

from supabase import Client


# Hard caps to prevent runaway checkpoint loops
MAX_CHECKPOINTS = 5
MAX_PIVOTS = 2


def update_repair_status(sb: Client, repair_id: str, status: str, **extra_fields) -> None:
    """Consistent status update with timestamp."""
    updates = {
        "status": status,
        "updated_at": datetime.now().isoformat(),
        **extra_fields,
    }
    sb.table("repairs").update(updates).eq("id", repair_id).execute()


def get_current_diagnosis(sb: Client, repair_id: str) -> Dict[str, Any]:
    """Walk checkpoint chain to get latest diagnosis (original or pivoted).

    Returns the most recent diagnosis — either the original from the repair
    or the updated_diagnosis from the latest checkpoint that pivoted.
    """
    # Get all checkpoints ordered by number
    result = sb.table("repair_checkpoints").select(
        "checkpoint_number, ai_decision, updated_diagnosis, diagnosis_snapshot"
    ).eq("repair_id", repair_id).order("checkpoint_number", desc=True).execute()

    checkpoints = result.data or []

    # Walk from latest to earliest, find the most recent pivot
    for cp in checkpoints:
        if cp.get("ai_decision") == "pivot" and cp.get("updated_diagnosis"):
            return cp["updated_diagnosis"]

    # No pivots — return the original diagnosis snapshot from checkpoint 1
    if checkpoints:
        last_cp = checkpoints[-1]  # checkpoint_number=1 (sorted desc, so last)
        if last_cp.get("diagnosis_snapshot"):
            return last_cp["diagnosis_snapshot"]

    return {}


def determine_checkpoint_strategy(
    diagnosis_data: Dict[str, Any],
    skill_level: str,
    confidence: float,
) -> list[Dict[str, Any]]:
    """Determine how many checkpoints are needed based on skill level and confidence.

    Returns a list of checkpoint specs (type + instructions template).
    Empty list = skip checkpoints entirely (legacy path).

    Checkpoint count matrix:
    | Skill Level | Confidence < 0.60 | 0.60 - 0.85 | > 0.85 |
    |-------------|-------------------|-------------|--------|
    | Laborer     | 3 checkpoints     | 2 checkpoints | 1 checkpoint |
    | Journeyman  | 2 checkpoints     | 1 checkpoint  | 0 (skip)     |
    | Technician  | 1 checkpoint      | 0             | 0 (legacy)   |
    """
    diag = diagnosis_data.get("diagnosis", {})
    primary_code = diag.get("primary_code", "")
    leak_source = diag.get("leak_source", "")

    # Determine checkpoint count
    if skill_level == "technician":
        if confidence >= 0.60:
            return []  # Legacy path — skip to ready
        count = 1
    elif skill_level == "laborer":
        if confidence > 0.85:
            count = 1
        elif confidence >= 0.60:
            count = 2
        else:
            count = 3
    else:  # journeyman (default)
        if confidence > 0.85:
            return []  # Skip to ready
        elif confidence >= 0.60:
            count = 1
        else:
            count = 2

    # Build checkpoint specs based on count
    checkpoints = []

    # Checkpoint 1: Always verify diagnosis
    checkpoints.append({
        "checkpoint_type": "verify_diagnosis",
        "instructions_template": "verify",
        "primary_code": primary_code,
        "leak_source": leak_source,
    })

    if count >= 2:
        # Checkpoint 2: Expose and inspect substrate
        checkpoints.append({
            "checkpoint_type": "expose_and_inspect",
            "instructions_template": "expose",
            "primary_code": primary_code,
            "leak_source": leak_source,
        })

    if count >= 3:
        # Checkpoint 3: Mid-repair check
        checkpoints.append({
            "checkpoint_type": "mid_repair_check",
            "instructions_template": "mid_repair",
            "primary_code": primary_code,
            "leak_source": leak_source,
        })

    return checkpoints


def create_checkpoint(
    sb: Client,
    repair_id: str,
    checkpoint_number: int,
    checkpoint_type: str,
    instructions_en: str,
    instructions_es: Optional[str],
    what_to_photograph: str,
    expected_finding: str,
    diagnosis_snapshot: Dict[str, Any],
) -> str:
    """Create a checkpoint row in the database. Returns checkpoint ID."""
    result = sb.table("repair_checkpoints").insert({
        "repair_id": repair_id,
        "checkpoint_number": checkpoint_number,
        "checkpoint_type": checkpoint_type,
        "status": "pending",
        "instructions_en": instructions_en,
        "instructions_es": instructions_es,
        "what_to_photograph": what_to_photograph,
        "expected_finding": expected_finding,
        "diagnosis_snapshot": diagnosis_snapshot,
    }).execute()

    checkpoint_id = result.data[0]["id"]

    # Update repair with current checkpoint pointer
    sb.table("repairs").update({
        "current_checkpoint_id": checkpoint_id,
        "checkpoint_count": checkpoint_number,
        "updated_at": datetime.now().isoformat(),
    }).eq("id", repair_id).execute()

    return checkpoint_id
