"""
Core diagnostic engine for leak repair.
Takes photos + leak notes → diagnosis + repair instructions + price.
Uses Claude API with reference docs as context.
"""

import os
import sys
import json
import base64
from typing import List, Dict, Optional, Any

from .config import (
    REPAIR_TYPES, LEAK_FAMILIES, LEGACY_REPAIR_TYPE_MAP,
    SKILL_LEVELS, SEVERITY_LEVELS, LANGUAGES,
    DIAGNOSTIC_FEE, DEFAULT_LABOR_RATE_PER_HOUR, DEFAULT_MARKUP_PERCENT,
    MINIMUM_JOB_CHARGE, DEFAULT_MATERIAL_COSTS,
    CONFIDENCE_HIGH, CONFIDENCE_MEDIUM, REFERENCE_FILES,
    DECISION_TREE_FILE, SCOPE_LIBRARY_FILE,
)
from .models import RepairJob, Diagnosis, RepairStep, MaterialItem


# ===================================================================
# REFERENCE FILE LOADING
# ===================================================================

def _find_project_root() -> str:
    """Find the USARM-Claims-Platform root directory."""
    # Walk up from this file's location
    d = os.path.dirname(os.path.abspath(__file__))
    while d != os.path.dirname(d):
        if os.path.exists(os.path.join(d, "usarm_pdf_generator.py")):
            return d
        d = os.path.dirname(d)
    # Fallback
    return os.path.expanduser("~/USARM-Claims-Platform")


def load_reference_context() -> str:
    """Load reference markdown files as context string for the AI prompt."""
    root = _find_project_root()
    context_parts = []

    for ref_file in REFERENCE_FILES:
        path = os.path.join(root, ref_file)
        if os.path.exists(path):
            with open(path, "r") as f:
                content = f.read()
            context_parts.append(f"=== {ref_file} ===\n{content}\n")

    return "\n".join(context_parts)


def load_decision_tree() -> str:
    """Load the diagnostic decision tree CSV as context."""
    root = _find_project_root()
    path = os.path.join(root, DECISION_TREE_FILE)
    if os.path.exists(path):
        with open(path, "r") as f:
            return f.read()
    return ""


def load_scope_library() -> str:
    """Load the repair scope library CSV as context."""
    root = _find_project_root()
    path = os.path.join(root, SCOPE_LIBRARY_FILE)
    if os.path.exists(path):
        with open(path, "r") as f:
            return f.read()
    return ""


def load_repair_history_context() -> str:
    """Load summary stats from repair log for self-improving context."""
    root = _find_project_root()
    stats_path = os.path.join(root, "repair_knowledge", "repair_stats.json")
    if not os.path.exists(stats_path):
        return ""

    try:
        with open(stats_path, "r") as f:
            stats = json.load(f)
        return f"\n=== Repair History Stats ===\n{json.dumps(stats, indent=2)}\n"
    except (json.JSONDecodeError, IOError):
        return ""


# ===================================================================
# PHOTO HANDLING
# ===================================================================

def encode_photo_b64(photo_path: str) -> str:
    """Encode a photo as base64 data URI."""
    if not os.path.exists(photo_path):
        return ""
    with open(photo_path, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    ext = photo_path.rsplit(".", 1)[-1].lower()
    mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
    return f"data:{mime};base64,{data}"


def discover_photos(photos_dir: str) -> List[str]:
    """Find all photo files in a directory."""
    if not os.path.isdir(photos_dir):
        return []
    extensions = {".jpg", ".jpeg", ".png", ".heic", ".webp"}
    photos = []
    for f in sorted(os.listdir(photos_dir)):
        if os.path.splitext(f)[1].lower() in extensions:
            photos.append(os.path.join(photos_dir, f))
    return photos


# ===================================================================
# PROMPT BUILDING
# ===================================================================

def build_diagnostic_prompt(
    photo_keys: List[str],
    leak_notes: str,
    skill_level: str,
    language: str,
    contractor_info: Optional[Dict] = None,
    labor_rate: float = DEFAULT_LABOR_RATE_PER_HOUR,
) -> str:
    """Build the system prompt for the diagnostic Claude API call.

    Uses the 22-code scope library and decision tree for evidence-based diagnosis.
    Output format: 14-field AI payload per roof_leak_ai_handbook spec.
    """

    skill_desc = SKILL_LEVELS.get(skill_level, SKILL_LEVELS["journeyman"])
    lang_name = LANGUAGES.get(language, "English")

    # Build repair codes reference from the structured REPAIR_TYPES dict
    repair_codes_list = "\n".join(
        f"  - {code}: {info['desc']} [family: {info['family'] or 'special'}, cost: {info['cost']}]"
        for code, info in REPAIR_TYPES.items()
    )

    severity_list = "\n".join(
        f"  - {k}: {v['urgency']}" for k, v in SEVERITY_LEVELS.items()
    )

    material_costs_ref = "\n".join(
        f"  - {k}: ${v:.2f}" for k, v in DEFAULT_MATERIAL_COSTS.items()
    )

    families_list = "\n".join(
        f"  {info['priority']}. {info['label']}" for k, info in LEAK_FAMILIES.items()
    )

    return f"""You are DumbRoof Repair AI — a leak diagnosis and repair instruction engine.

A roofer is ON THE ROOF RIGHT NOW with a customer waiting below. You must analyze the photos,
diagnose the leak source, and provide IMMEDIATE actionable output. Speed matters — the roofer
is waiting for instructions and the homeowner is waiting for a repair ticket.

## DIAGNOSTIC METHOD: Decision Tree (MANDATORY)

You MUST follow the decision tree. Do NOT skip steps.

**Rule: DETAILS FIRST, FIELD SHINGLES SECOND.**
The most common diagnostic error is blaming field shingles when the real source is a detail
(chimney, wall, penetration, valley, edge). You must rule out EVERY detail before diagnosing
field shingle damage.

### Triage Steps (follow in order):
S1: Is moisture linked to rain/snowmelt/wind-driven rain? → If NO: CONDENSATION
S2: Can interior leak be mapped to a specific roof plane and upslope zone? → If NO: LOW-CONFIDENCE-VERIFY
S3: Chimney in upslope zone? → CHM-FRONT / CHM-SIDE / CHM-BACK / CHM-MASONRY
S4: Sidewall/dormer/stucco wall? → WALL-STEP / WALL-KICKOUT / HEADWALL / STUCCO-ABOVE-ROOF
S5: Plumbing vent/exhaust/skylight? → VENT-BOOT / VENT-METAL / SKYLIGHT-FLASH / SKYLIGHT-UNIT
S6: Valley or water concentration path? → VALLEY-OPEN-METAL / VALLEY-CLOSED-CUT / VALLEY-DEBRIS-ICE
S7: Low on slope near edge, freeze-thaw? → EAVE-ICE-DAM / EAVE-DRIP-EDGE / GUTTER-BACKUP
S8: Field shingle or fastener damage (ONLY after S3-S7 excluded)? → FIELD-SHINGLE / NAIL-POP
S9: Evidence conflicting? → LOW-CONFIDENCE-VERIFY

### 8 Leak Families (priority order):
{families_list}

## ROOFER SKILL LEVEL: {skill_level.upper()} ({skill_desc['description']})

Detail level: {skill_desc['detail']}
- LABORER: Every step explicit. Tool names. Safety at every step. Common mistakes. "Use a flat pry bar, NOT a claw hammer."
- JOURNEYMAN: Professional steps. Assumes competency. Focus on sequence and quality points.
- TECHNICIAN: Checklist with quantities. Only non-obvious details.

## LANGUAGE: {lang_name}

Provide BOTH English and Spanish for all repair step titles and instructions.
Use Mexican/Central American construction Spanish — field-crew terminology, not academic.

## FIELD NOTES FROM ROOFER
{leak_notes}

## PHOTOS SUBMITTED
{', '.join(photo_keys)}

## 22 REPAIR CODES (use EXACTLY one of these)
{repair_codes_list}

## SEVERITY LEVELS
{severity_list}

## MATERIAL COSTS (use for pricing)
{material_costs_ref}

## LABOR RATE: ${labor_rate:.2f}/hour

## PRICING RULES
- Diagnostic fee: ${DIAGNOSTIC_FEE:.2f} flat (ALWAYS included — covers the visit)
- Materials cost = sum of (qty x unit cost x 1.{int(DEFAULT_MARKUP_PERCENT * 100)} markup)
- Labor cost = estimated hours x ${labor_rate:.2f}
- Total price = diagnostic fee + materials cost + labor cost
- Minimum job charge: ${MINIMUM_JOB_CHARGE:.2f}
- Round total to nearest $5
- NOTE: Material costs already include service-call premium (2x retail). This is standard
  for on-demand repair service — the value is showing up and fixing it TODAY.

## REPAIR STEP CATEGORIES (use in order)
1. protection — tarps, safety, area prep
2. removal — tear off damaged components
3. inspection — check substrate once opened (may expand scope)
4. installation — new components in code-correct sequence
5. cleanup — debris, final check

## RESPONSE FORMAT (strict JSON — 14-field AI payload)

Return ONLY valid JSON, no markdown fencing, no explanation outside the JSON:

{{
  "diagnosis": {{
    "primary_code": "One of the 22 repair codes above (e.g. CHM-SIDE)",
    "family": "The leak family (e.g. chimney)",
    "leak_source": "Plain English description of what is causing the leak",
    "severity": "minor|moderate|major|critical|emergency",
    "confidence": 0.85,
    "decision_path": "S1>S2>S3>S3C — trace the triage steps you followed",
    "secondary_codes": ["Optional — other codes that may also apply"],
    "escalation_flag": "null or description of required non-roofing trade (mason, HVAC, etc.)",
    "is_temporary": false
  }},
  "photo_annotations": {{
    "p01": "Brief description of what this photo shows diagnostically",
    "p02": "..."
  }},
  "repair": {{
    "summary": "1-2 sentence summary of the complete repair",
    "scope_standard": "The standard scope text from the matching repair code",
    "closeout_verification": "What photos/evidence are needed to verify the repair",
    "steps": [
      {{
        "step": 1,
        "category": "protection",
        "title_en": "English title",
        "title_es": "Spanish title",
        "instructions_en": "English instructions at {skill_level} detail level",
        "instructions_es": "Spanish instructions at {skill_level} detail level",
        "materials": ["item1", "item2"],
        "time_minutes": 10,
        "safety_note_en": "Safety note if applicable, or null",
        "safety_note_es": "Spanish safety note, or null",
        "photo_reference": "p01 or null"
      }}
    ],
    "materials_list": [
      {{"item": "Step flashing — aluminum 4x4", "qty": 12, "unit": "EA", "cost": 2.50}}
    ],
    "labor_hours": 4,
    "materials_cost": 95.00,
    "labor_cost": 340.00,
    "total_price": 435.00,
    "complexity_adders": ["Any complexity factors present (e.g. steep pitch, deck rot)"]
  }},
  "homeowner_ticket": {{
    "what_we_found": "Plain English for a non-roofer. 2-3 sentences. No jargon. Use the homeowner_summary from the matching repair code as a starting point.",
    "what_we_recommend": "Plain English repair description. What we will do to fix it.",
    "time_estimate": "3-4 hours",
    "urgency": "moderate",
    "warranty": "2-year workmanship warranty"
  }}
}}
"""


# ===================================================================
# DIAGNOSIS EXECUTION
# ===================================================================

def diagnose_leak(
    photos: List[str],
    leak_notes: str,
    skill_level: str = "journeyman",
    language: str = "en",
    labor_rate: float = DEFAULT_LABOR_RATE_PER_HOUR,
    contractor_info: Optional[Dict] = None,
) -> Dict[str, Any]:
    """
    Analyze leak area photos + notes.
    Returns structured dict with diagnosis + repair + price + homeowner ticket.

    This function builds the prompt and prepares the API call payload.
    The actual Claude API call is made by the CLI or web handler.

    Args:
        photos: List of photo file paths
        leak_notes: Field worker's description of the leak
        skill_level: laborer | journeyman | technician
        language: en | es
        labor_rate: $/hour for labor pricing
        contractor_info: Optional contractor details for branding

    Returns:
        Dict with keys: prompt, system_context, photo_data, config
        Ready to be sent to Claude API by the caller.
    """
    # Build photo keys and encode photos
    photo_data = []
    photo_keys = []
    for i, photo_path in enumerate(photos, 1):
        key = f"p{i:02d}"
        photo_keys.append(key)
        photo_data.append({
            "key": key,
            "filename": os.path.basename(photo_path),
            "b64": encode_photo_b64(photo_path),
        })

    # Load reference context (diagnostic standard + legacy guide + materials)
    reference_context = load_reference_context()
    history_context = load_repair_history_context()
    decision_tree = load_decision_tree()
    scope_library = load_scope_library()

    # Build the diagnostic prompt
    prompt = build_diagnostic_prompt(
        photo_keys=photo_keys,
        leak_notes=leak_notes,
        skill_level=skill_level,
        language=language,
        contractor_info=contractor_info,
        labor_rate=labor_rate,
    )

    # System context loads all reference data for the AI
    dt_section = f"\n=== DECISION TREE (CSV) ===\n{decision_tree}\n" if decision_tree else ""
    sl_section = f"\n=== SCOPE LIBRARY (CSV) ===\n{scope_library}\n" if scope_library else ""

    system_context = f"""You are DumbRoof Repair AI. Use the following reference knowledge to inform your diagnosis.
Follow the decision tree STRICTLY. Use the scope library for standard scope text, homeowner summaries,
and closeout verification requirements. The diagnostic standard reference contains the full 22-code
system with all details, triggers, cues, and real training examples.

{reference_context}
{dt_section}
{sl_section}
{history_context}
"""

    return {
        "prompt": prompt,
        "system_context": system_context,
        "photo_data": photo_data,
        "photo_keys": photo_keys,
        "config": {
            "skill_level": skill_level,
            "language": language,
            "labor_rate": labor_rate,
            "contractor_info": contractor_info,
        },
    }


def parse_diagnosis_response(response_json: str) -> Dict[str, Any]:
    """
    Parse the Claude API response into structured data.

    Args:
        response_json: JSON string from Claude API response

    Returns:
        Parsed dict matching repair_job_config schema
    """
    # Handle potential markdown code fencing
    text = response_json.strip()
    if text.startswith("```"):
        # Remove code fencing
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"Failed to parse AI response as JSON: {e}\nResponse: {text[:500]}")

    # Validate required sections
    required = ["diagnosis", "photo_annotations", "repair", "homeowner_ticket"]
    missing = [k for k in required if k not in data]
    if missing:
        raise ValueError(f"AI response missing required sections: {missing}")

    # Normalize: support both old "repair_type" and new "primary_code" in diagnosis
    diag = data.get("diagnosis", {})
    if "primary_code" not in diag and "repair_type" in diag:
        # Legacy format — map old type to new code
        old_type = diag["repair_type"]
        diag["primary_code"] = LEGACY_REPAIR_TYPE_MAP.get(old_type, old_type)
        diag["family"] = REPAIR_TYPES.get(diag["primary_code"], {}).get("family", None)
        diag["decision_path"] = diag.get("decision_path", "legacy")
    if "repair_type" not in diag and "primary_code" in diag:
        # New format — also set repair_type for backward compat
        diag["repair_type"] = diag["primary_code"]

    return data


# ===================================================================
# REPAIR JOB ASSEMBLY
# ===================================================================

def assemble_repair_job(
    job_id: str,
    diagnosis_data: Dict[str, Any],
    photo_map: Dict[str, str],
    submission: Dict[str, Any],
    contractor: Dict[str, Any],
    property_info: Dict[str, Any],
    homeowner: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Assemble a complete repair_job_config.json from diagnosis results.

    Args:
        job_id: Unique job identifier
        diagnosis_data: Parsed response from parse_diagnosis_response()
        photo_map: Map of photo keys to filenames
        submission: Submission metadata (who, skill level, notes)
        contractor: Contractor info
        property_info: Property address details
        homeowner: Homeowner info

    Returns:
        Complete repair_job_config dict ready to write to JSON
    """
    diag = diagnosis_data.get("diagnosis", {})
    repair = diagnosis_data.get("repair", {})
    ticket = diagnosis_data.get("homeowner_ticket", {})

    # Support both old "repair_type" and new "primary_code"
    primary_code = diag.get("primary_code", diag.get("repair_type", ""))

    config = {
        "job": {
            "job_id": job_id,
            "created": "",  # Set by caller
            "status": "diagnosed",
        },
        "contractor": contractor,
        "property": property_info,
        "homeowner": homeowner,
        "submission": submission,
        "photo_map": photo_map,
        "photo_annotations": diagnosis_data.get("photo_annotations", {}),
        "diagnosis": {
            "primary_code": primary_code,
            "family": diag.get("family", REPAIR_TYPES.get(primary_code, {}).get("family")),
            "leak_source": diag.get("leak_source", ""),
            "repair_type": primary_code,  # backward compat
            "severity": diag.get("severity", "moderate"),
            "is_temporary": diag.get("is_temporary", False),
            "confidence": diag.get("confidence", 0.0),
            "decision_path": diag.get("decision_path", ""),
            "secondary_codes": diag.get("secondary_codes", []),
            "escalation_flag": diag.get("escalation_flag"),
        },
        "repair": {
            "summary": repair.get("summary", ""),
            "scope_standard": repair.get("scope_standard", ""),
            "closeout_verification": repair.get("closeout_verification", ""),
            "steps": repair.get("steps", []),
            "materials_list": repair.get("materials_list", []),
            "labor_hours": repair.get("labor_hours", 0),
            "materials_cost": repair.get("materials_cost", 0),
            "labor_cost": repair.get("labor_cost", 0),
            "total_price": repair.get("total_price", 0),
            "complexity_adders": repair.get("complexity_adders", []),
        },
        "homeowner_ticket": {
            "what_we_found": ticket.get("what_we_found", ""),
            "what_we_recommend": ticket.get("what_we_recommend", ""),
            "price": repair.get("total_price", 0),
            "time_estimate": ticket.get("time_estimate", ""),
            "urgency": diag.get("severity", "moderate"),
            "warranty": ticket.get("warranty", "2-year workmanship warranty"),
        },
        "completion": {
            "completed_date": None,
            "completion_photos": [],
            "notes": "",
        },
    }

    return config


# ===================================================================
# REPAIR LOG (Self-Improving)
# ===================================================================

def log_completed_repair(job_config: Dict[str, Any]) -> None:
    """
    Append a repair outcome to the self-improving log.
    Called after a repair is marked completed.
    """
    root = _find_project_root()
    log_dir = os.path.join(root, "repair_knowledge")
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, "repair_log.jsonl")

    diag = job_config.get("diagnosis", {})
    repair = job_config.get("repair", {})
    prop = job_config.get("property", {})

    entry = {
        "job_id": job_config.get("job", {}).get("job_id", ""),
        "date": job_config.get("completion", {}).get("completed_date", ""),
        "primary_code": diag.get("primary_code", diag.get("repair_type", "")),
        "family": diag.get("family", ""),
        "repair_type": diag.get("repair_type", ""),  # backward compat
        "severity": diag.get("severity", ""),
        "region": prop.get("state", ""),
        "diagnosis_confidence": diag.get("confidence", 0),
        "decision_path": diag.get("decision_path", ""),
        "escalation_flag": diag.get("escalation_flag"),
        "estimated_hours": repair.get("labor_hours", 0),
        "estimated_cost": repair.get("total_price", 0),
        "complexity_adders": repair.get("complexity_adders", []),
        "completion_verified": True,
    }

    with open(log_path, "a") as f:
        f.write(json.dumps(entry) + "\n")


def rebuild_repair_stats() -> Dict[str, Any]:
    """
    Rebuild summary statistics from the repair log.
    Updates repair_knowledge/repair_stats.json.
    """
    root = _find_project_root()
    log_path = os.path.join(root, "repair_knowledge", "repair_log.jsonl")
    stats_path = os.path.join(root, "repair_knowledge", "repair_stats.json")

    if not os.path.exists(log_path):
        return {"total_repairs": 0}

    entries = []
    with open(log_path, "r") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

    if not entries:
        return {"total_repairs": 0}

    # Compute stats by repair type
    by_type = {}
    for e in entries:
        rt = e.get("repair_type", "unknown")
        if rt not in by_type:
            by_type[rt] = {
                "count": 0,
                "avg_hours": 0,
                "avg_cost": 0,
                "total_hours": 0,
                "total_cost": 0,
            }
        by_type[rt]["count"] += 1
        by_type[rt]["total_hours"] += e.get("estimated_hours", 0)
        by_type[rt]["total_cost"] += e.get("estimated_cost", 0)

    for rt in by_type:
        n = by_type[rt]["count"]
        if n > 0:
            by_type[rt]["avg_hours"] = round(by_type[rt]["total_hours"] / n, 1)
            by_type[rt]["avg_cost"] = round(by_type[rt]["total_cost"] / n, 2)

    # Compute stats by region
    by_region = {}
    for e in entries:
        region = e.get("region", "unknown")
        if region not in by_region:
            by_region[region] = {"count": 0, "types": {}}
        by_region[region]["count"] += 1
        rt = e.get("repair_type", "unknown")
        by_region[region]["types"][rt] = by_region[region]["types"].get(rt, 0) + 1

    stats = {
        "total_repairs": len(entries),
        "by_type": by_type,
        "by_region": by_region,
    }

    # Write stats file
    os.makedirs(os.path.dirname(stats_path), exist_ok=True)
    with open(stats_path, "w") as f:
        json.dump(stats, f, indent=2)

    return stats
