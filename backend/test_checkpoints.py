#!/usr/bin/env python3
"""
Layer 2: Unit tests for the checkpoint system.
Tests determine_checkpoint_strategy(), build_qc_log_section(),
build_diagnosis_evolution_section(), build_repair_log(), and constants.
"""
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from repair_utils import determine_checkpoint_strategy, MAX_CHECKPOINTS, MAX_PIVOTS
from repair_generator import build_qc_log_section, build_diagnosis_evolution_section, build_repair_log

passed = 0
failed = 0

def check(name, condition):
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}")


# Helper: build a minimal diagnosis_data dict
def diag(confidence):
    return {
        "diagnosis": {
            "primary_code": "CHIM-FLASH",
            "leak_source": "chimney flashing failure",
        }
    }


print("=" * 60)
print("CHECKPOINT STRATEGY MATRIX")
print("=" * 60)

# --- Constants ---
check("MAX_CHECKPOINTS == 5", MAX_CHECKPOINTS == 5)
check("MAX_PIVOTS == 2", MAX_PIVOTS == 2)

# --- Laborer ---
check("Laborer + low confidence (0.55) → 3 checkpoints",
      len(determine_checkpoint_strategy(diag(0.55), "laborer", 0.55)) == 3)
check("Laborer + medium confidence (0.70) → 2 checkpoints",
      len(determine_checkpoint_strategy(diag(0.70), "laborer", 0.70)) == 2)
check("Laborer + high confidence (0.90) → 1 checkpoint",
      len(determine_checkpoint_strategy(diag(0.90), "laborer", 0.90)) == 1)
check("Laborer + edge: exactly 0.60 → 2 checkpoints",
      len(determine_checkpoint_strategy(diag(0.60), "laborer", 0.60)) == 2)
check("Laborer + edge: exactly 0.85 → 2 checkpoints",
      len(determine_checkpoint_strategy(diag(0.85), "laborer", 0.85)) == 2)
check("Laborer + edge: 0.86 → 1 checkpoint",
      len(determine_checkpoint_strategy(diag(0.86), "laborer", 0.86)) == 1)

# --- Journeyman ---
check("Journeyman + high confidence (0.90) → 0 (legacy skip)",
      len(determine_checkpoint_strategy(diag(0.90), "journeyman", 0.90)) == 0)
check("Journeyman + medium confidence (0.70) → 1",
      len(determine_checkpoint_strategy(diag(0.70), "journeyman", 0.70)) == 1)
check("Journeyman + low confidence (0.50) → 2",
      len(determine_checkpoint_strategy(diag(0.50), "journeyman", 0.50)) == 2)
check("Journeyman + edge: exactly 0.60 → 1",
      len(determine_checkpoint_strategy(diag(0.60), "journeyman", 0.60)) == 1)
check("Journeyman + edge: 0.59 → 2",
      len(determine_checkpoint_strategy(diag(0.59), "journeyman", 0.59)) == 2)
check("Journeyman + edge: exactly 0.85 → 1",
      len(determine_checkpoint_strategy(diag(0.85), "journeyman", 0.85)) == 1)
check("Journeyman + edge: 0.86 → 0",
      len(determine_checkpoint_strategy(diag(0.86), "journeyman", 0.86)) == 0)

# --- Technician ---
check("Technician + high confidence (0.90) → 0 (legacy)",
      len(determine_checkpoint_strategy(diag(0.90), "technician", 0.90)) == 0)
check("Technician + medium confidence (0.70) → 0 (legacy)",
      len(determine_checkpoint_strategy(diag(0.70), "technician", 0.70)) == 0)
check("Technician + low confidence (0.50) → 1",
      len(determine_checkpoint_strategy(diag(0.50), "technician", 0.50)) == 1)
check("Technician + edge: exactly 0.60 → 0",
      len(determine_checkpoint_strategy(diag(0.60), "technician", 0.60)) == 0)
check("Technician + edge: 0.59 → 1",
      len(determine_checkpoint_strategy(diag(0.59), "technician", 0.59)) == 1)

# --- Checkpoint types are correct ---
strat = determine_checkpoint_strategy(diag(0.50), "laborer", 0.50)
check("3-checkpoint strategy: types are verify_diagnosis, expose_and_inspect, mid_repair_check",
      [s["checkpoint_type"] for s in strat] == ["verify_diagnosis", "expose_and_inspect", "mid_repair_check"])

strat2 = determine_checkpoint_strategy(diag(0.70), "laborer", 0.70)
check("2-checkpoint strategy: types are verify_diagnosis, expose_and_inspect",
      [s["checkpoint_type"] for s in strat2] == ["verify_diagnosis", "expose_and_inspect"])

strat1 = determine_checkpoint_strategy(diag(0.90), "laborer", 0.90)
check("1-checkpoint strategy: type is verify_diagnosis",
      [s["checkpoint_type"] for s in strat1] == ["verify_diagnosis"])


print()
print("=" * 60)
print("HTML BUILDER FUNCTIONS")
print("=" * 60)

# --- build_qc_log_section ---
check("build_qc_log_section({}) returns empty string",
      build_qc_log_section({}) == "")
check("build_qc_log_section(no checkpoint_history) returns empty string",
      build_qc_log_section({"job": {"job_id": "test"}}) == "")

config_with_cp = {
    "checkpoint_history": [
        {"number": 1, "type": "verify_diagnosis", "status": "PROCEED", "analysis": "Looks good", "date": "2026-03-13"},
        {"number": 2, "type": "expose_and_inspect", "status": "PIVOT", "analysis": "Found additional damage", "date": "2026-03-13"},
    ]
}
qc_html = build_qc_log_section(config_with_cp)
check("build_qc_log_section with data returns <table>", "<table>" in qc_html)
check("build_qc_log_section contains 'Quality Control Log'", "Quality Control Log" in qc_html)
check("build_qc_log_section contains PROCEED", "PROCEED" in qc_html)
check("build_qc_log_section contains PIVOT", "PIVOT" in qc_html)

# --- build_diagnosis_evolution_section ---
check("build_diagnosis_evolution_section({}) returns empty string",
      build_diagnosis_evolution_section({}) == "")
check("build_diagnosis_evolution_section(no evolution) returns empty string",
      build_diagnosis_evolution_section({"checkpoint_history": []}) == "")

config_with_evo = {
    "diagnosis_evolution": [
        {"checkpoint": 2, "from_code": "CHIM-FLASH", "to_code": "WALL-STEP", "confidence": 0.82, "reason": "Found wall damage"}
    ]
}
evo_html = build_diagnosis_evolution_section(config_with_evo)
check("build_diagnosis_evolution_section with data returns content", len(evo_html) > 0)
check("build_diagnosis_evolution_section contains 'Diagnosis Evolution'", "Diagnosis Evolution" in evo_html)
check("build_diagnosis_evolution_section contains from_code strikethrough", "CHIM-FLASH" in evo_html)
check("build_diagnosis_evolution_section contains to_code", "WALL-STEP" in evo_html)
check("build_diagnosis_evolution_section contains confidence", "82%" in evo_html)

# --- build_repair_log ---
check("build_repair_log({}) returns None", build_repair_log({}) is None)
check("build_repair_log(no checkpoint_history) returns None",
      build_repair_log({"job": {"job_id": "x"}}) is None)
check("build_repair_log(empty checkpoint_history) returns None",
      build_repair_log({"checkpoint_history": []}) is None)

# Full config for repair log (needs _paths for logo lookup)
import tempfile
_tmpdir = tempfile.mkdtemp()
config_full = {
    "job": {"job_id": "RPR-TEST", "created": "2026-03-13T10:00:00"},
    "contractor": {"company_name": "TEST CO"},
    "property": {"address": "123 Test", "city": "NY", "state": "NY", "zip": "10001"},
    "diagnosis": {"primary_code": "CHIM-FLASH", "leak_source": "test", "confidence": 0.87, "severity": "moderate"},
    "repair": {"summary": "test repair"},
    "checkpoint_history": config_with_cp["checkpoint_history"],
    "diagnosis_evolution": config_with_evo["diagnosis_evolution"],
    "_paths": {"photos": _tmpdir, "qa_photos": _tmpdir, "output": _tmpdir, "job_dir": _tmpdir},
}
log_html = build_repair_log(config_full)
check("build_repair_log with full config returns HTML", log_html is not None)
check("build_repair_log contains REPAIR LOG title", "REPAIR LOG" in log_html)
check("build_repair_log contains Initial Diagnosis", "Initial Diagnosis" in log_html)
check("build_repair_log contains timeline entries", "Checkpoint 1" in log_html and "Checkpoint 2" in log_html)
check("build_repair_log contains Diagnosis Evolution", "Diagnosis Evolution" in log_html)
check("build_repair_log contains QC Summary", "QC Summary" in log_html)


print()
print("=" * 60)
print(f"RESULTS: {passed} passed, {failed} failed, {passed + failed} total")
print("=" * 60)
sys.exit(1 if failed else 0)
