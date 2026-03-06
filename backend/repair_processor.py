"""
Repair Processor — Leak Diagnosis + Repair Instructions + PDF Generation
=========================================================================
Uses Claude API to analyze leak photos, diagnose the issue, generate
repair instructions for the roofer and a repair ticket for the homeowner.

Parallel to processor.py (claims) — separate pipeline, separate table.
"""

from __future__ import annotations

import os
import json
import base64
import tempfile
import subprocess
import shutil
import time
from datetime import datetime
from typing import Optional

import anthropic
from supabase import Client

from processor import (
    get_supabase_client,
    get_anthropic_client,
    download_file,
    upload_file,
    file_to_base64,
    _call_claude_with_retry,
)
from photo_utils import (
    ingest_photos,
    prepare_photo_for_api,
    prepare_photo_for_pdf,
    get_media_type,
)

# Backend directory (where repair_generator.py + references live)
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
# Optional: CLI platform for repair stats (not required on Railway)
PLATFORM_DIR = os.path.expanduser("~/USARM-Claims-Platform")


### Photo conversion/resize delegated to shared photo_utils module ###


# ===================================================================
# REFERENCE FILES (loaded as Claude context)
# ===================================================================

REFERENCE_FILES = [
    "references/leak-repair-guide.md",
    "references/repair-diagnostic-standard.md",
]

_LOCAL_REF_DIR = os.path.dirname(os.path.abspath(__file__))


def load_reference_context() -> str:
    """Load repair reference files as context. Checks local backend copy first, then CLI."""
    parts = []
    for ref_file in REFERENCE_FILES:
        local_path = os.path.join(_LOCAL_REF_DIR, ref_file)
        cli_path = os.path.join(PLATFORM_DIR, ref_file)
        path = local_path if os.path.exists(local_path) else cli_path
        if os.path.exists(path):
            with open(path, "r") as f:
                content = f.read()
            parts.append(f"=== {ref_file} ===\n{content}\n")
    return "\n".join(parts)


def load_repair_history() -> str:
    """Load repair stats for self-improving context."""
    stats_path = os.path.join(PLATFORM_DIR, "repair_knowledge", "repair_stats.json")
    if not os.path.exists(stats_path):
        return ""
    try:
        with open(stats_path, "r") as f:
            stats = json.load(f)
        return f"\n=== Repair History Stats ===\n{json.dumps(stats, indent=2)}\n"
    except (json.JSONDecodeError, IOError):
        return ""


# ===================================================================
# DIAGNOSTIC PROMPT
# ===================================================================

REPAIR_TYPES = {
    "pipe_boot": "Failed pipe boot/collar",
    "step_flashing": "Step flashing failure",
    "chimney_flashing": "Chimney flashing failure",
    "exposed_nails": "Exposed/backed-out nail heads",
    "missing_shingles": "Missing or damaged shingles",
    "valley_leak": "Valley flashing leak",
    "vent_boot": "Vent boot/exhaust leak",
    "skylight_flashing": "Skylight flashing failure",
    "ridge_cap": "Ridge cap failure",
    "ice_dam": "Ice dam damage",
    "temporary_tarp": "Temporary tarp installation",
}

SEVERITY_LEVELS = {
    "minor": "Schedule within 30 days",
    "moderate": "Repair within 1-2 weeks",
    "major": "Repair within 3-5 days",
    "critical": "Immediate attention — active water intrusion",
    "emergency": "Same-day emergency repair or tarp required",
}

SKILL_DESCRIPTIONS = {
    "laborer": "Step-by-step with tool names, safety reminders, common mistake warnings",
    "journeyman": "Professional-level steps, assumes basic competency",
    "technician": "Checklist with quantities and specs only",
}

DEFAULT_MATERIAL_COSTS = {
    "pipe_boot_neoprene": 12.00,
    "pipe_boot_lead": 35.00,
    "step_flashing_aluminum_4x4": 2.50,
    "counter_flashing_aluminum": 9.50,
    "roofing_cement": 8.00,
    "mortar_mix": 12.00,
    "roofing_nails_1lb": 6.00,
    "shingle_laminated_bundle": 35.00,
    "shingle_3tab_bundle": 28.00,
    "ice_water_shield": 2.24,
    "drip_edge_aluminum": 4.25,
    "ridge_cap_laminated": 7.49,
    "ridge_vent_aluminum": 8.50,
    "exhaust_vent": 45.00,
    "valley_flashing_w_style": 6.50,
    "skylight_flashing_kit": 85.00,
    "tarp_heavy_duty_20x30": 45.00,
    "tarp_anchor_2x4": 5.00,
    "sealant_tube": 6.00,
    "starter_strip": 3.50,
}

LABOR_RATE = 85.00
MARKUP = 0.20
MIN_CHARGE = 250.00


def build_diagnostic_prompt(photo_keys: list[str], leak_notes: str, skill_level: str, language: str) -> str:
    """Build the full diagnostic prompt for Claude."""
    skill_desc = SKILL_DESCRIPTIONS.get(skill_level, SKILL_DESCRIPTIONS["journeyman"])
    repair_types_list = "\n".join(f"  - {k}: {v}" for k, v in REPAIR_TYPES.items())
    severity_list = "\n".join(f"  - {k}: {v}" for k, v in SEVERITY_LEVELS.items())
    material_costs_ref = "\n".join(f"  - {k}: ${v:.2f}" for k, v in DEFAULT_MATERIAL_COSTS.items())

    return f"""You are DumbRoof Repair AI — a leak diagnosis and repair instruction engine.

A roofer is ON THE ROOF RIGHT NOW with a customer waiting below. You must analyze the photos,
diagnose the leak source, and provide IMMEDIATE actionable output. Speed matters.

## YOUR TASK

Analyze the submitted photos of a roof leak area. Return a structured JSON response with:
1. Diagnosis — what's causing the leak
2. Photo annotations — brief description of what each photo shows
3. Repair instructions — step-by-step, calibrated to the worker's skill level
4. Materials list with quantities and costs
5. Price — materials + labor = total
6. Homeowner ticket — plain-English explanation for a non-roofer

## ROOFER SKILL LEVEL: {skill_level.upper()} ({skill_desc})

Detail level:
- LABORER: Every step explicit. Tool names. Safety at every step. Common mistakes. "Use a flat pry bar, NOT a claw hammer."
- JOURNEYMAN: Professional steps. Assumes competency. Focus on sequence and quality points.
- TECHNICIAN: Checklist with quantities. Only non-obvious details.

## LANGUAGE: {"English" if language == "en" else "Spanish"}

Provide BOTH English and Spanish for all repair step titles and instructions, regardless of
the roofer's preferred language. The system renders the appropriate language.
Use Mexican/Central American construction Spanish — field-crew terminology, not academic.

## FIELD NOTES FROM ROOFER
{leak_notes}

## PHOTOS SUBMITTED
{', '.join(photo_keys)}

## REPAIR TYPES (use these keys)
{repair_types_list}

## SEVERITY LEVELS
{severity_list}

## MATERIAL COSTS (use for pricing)
{material_costs_ref}

## LABOR RATE: ${LABOR_RATE:.2f}/hour

## PRICING RULES
- Materials cost = sum of (qty × unit cost × 1.{int(MARKUP * 100)} markup)
- Labor cost = estimated hours × ${LABOR_RATE:.2f}
- Total price = materials cost + labor cost
- Minimum job charge: ${MIN_CHARGE:.2f}
- Round total to nearest $5

## REPAIR STEP CATEGORIES (use in order)
1. protection — tarps, safety, area prep
2. removal — tear off damaged components
3. inspection — check substrate once opened (may expand scope)
4. installation — new components in code-correct sequence
5. cleanup — debris, final check

## RESPONSE FORMAT (strict JSON)

Return ONLY valid JSON, no markdown fencing, no explanation outside the JSON:

{{
  "diagnosis": {{
    "leak_source": "Plain English description of what is causing the leak",
    "repair_type": "one of the repair type keys above",
    "severity": "minor|moderate|major|critical|emergency",
    "is_temporary": false,
    "confidence": 0.85
  }},
  "photo_annotations": {{
    "p01": "Brief description of what this photo shows diagnostically",
    "p02": "..."
  }},
  "repair": {{
    "summary": "1-2 sentence summary of the complete repair",
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
    "total_price": 435.00
  }},
  "homeowner_ticket": {{
    "what_we_found": "Plain English for a non-roofer. 2-3 sentences. No jargon.",
    "what_we_recommend": "Plain English repair description. What we will do to fix it.",
    "time_estimate": "3-4 hours",
    "urgency": "moderate",
    "warranty": "2-year workmanship warranty"
  }}
}}
"""


# ===================================================================
# MAIN PROCESSING PIPELINE
# ===================================================================

async def process_repair(repair_id: str):
    """Full repair processing pipeline."""
    sb = get_supabase_client()
    claude = get_anthropic_client()

    # 1. Get repair from database
    result = sb.table("repairs").select("*").eq("id", repair_id).single().execute()
    repair = result.data
    if not repair:
        raise ValueError(f"Repair {repair_id} not found")

    print(f"[REPAIR] Starting: {repair['address']} (skill: {repair.get('skill_level', 'journeyman')})")

    # Update status to processing
    sb.table("repairs").update({"status": "processing"}).eq("id", repair_id).execute()

    # Get company profile for branding
    company_profile = None
    try:
        profile_result = sb.table("company_profiles").select("*").eq("user_id", repair["user_id"]).single().execute()
        company_profile = profile_result.data
        if company_profile:
            print(f"[REPAIR] Using company branding: {company_profile.get('company_name', 'N/A')}")
    except Exception:
        pass

    # 2. Create temp work directory
    with tempfile.TemporaryDirectory(prefix="dumbroof_repair_") as work_dir:
        photos_dir = os.path.join(work_dir, "photos")
        output_dir = os.path.join(work_dir, "pdf_output")
        os.makedirs(photos_dir)
        os.makedirs(output_dir)

        # Download contractor logo
        if company_profile and company_profile.get("logo_path"):
            try:
                logo_data = sb.storage.from_("claim-documents").download(company_profile["logo_path"])
                logo_dest = os.path.join(photos_dir, "logo.jpg")
                with open(logo_dest, "wb") as f:
                    f.write(logo_data)
                print(f"[REPAIR] Downloaded company logo")
            except Exception as e:
                print(f"[REPAIR] Could not download logo: {e}")

        file_path = repair["file_path"]

        # 3. Download photos — handles any format: images, ZIPs, PDFs
        #    Uses shared photo_utils for format-agnostic ingestion
        downloaded_paths = []
        for fname in repair.get("photo_files", []):
            local = os.path.join(photos_dir, fname)
            download_file(sb, "claim-documents", f"{file_path}/photos/{fname}", local)
            downloaded_paths.append(local)

        # Ingest all files — extracts ZIPs, PDFs, converts HEIC/TIFF/etc.
        photo_paths = ingest_photos(downloaded_paths, photos_dir)
        photo_filenames = [os.path.basename(p) for p in photo_paths]

        if not photo_paths:
            raise ValueError("No photos found — cannot diagnose without photos")

        print(f"[REPAIR] {len(photo_paths)} usable photos after ingestion")

        # Prepare ALL photos for PDF embedding (1200px, 75% quality)
        all_pdf_photos = []
        for p in photo_paths:
            prepared = prepare_photo_for_pdf(p, max_dim=1200, quality=75)
            if prepared:
                all_pdf_photos.append(prepared)

        if not all_pdf_photos:
            raise ValueError("No usable photos after conversion — check photo formats")

        print(f"[REPAIR] {len(all_pdf_photos)} photos ready for PDF embedding")

        # Prepare subset for Claude API (512px, 50% quality, max 15)
        MAX_API_PHOTOS = 15
        BATCH_SIZE = 5  # Match claims pipeline — 5 photos per API call
        api_photos = []
        for p in all_pdf_photos[:MAX_API_PHOTOS]:
            prepared = prepare_photo_for_api(p, max_dim=512, quality=50)
            if prepared:
                api_photos.append(prepared)

        if len(all_pdf_photos) > MAX_API_PHOTOS:
            print(f"[REPAIR] Sending {MAX_API_PHOTOS} of {len(all_pdf_photos)} photos to AI (all {len(all_pdf_photos)} embedded in PDFs)")

        # 4. Build photo keys and encode
        # photo_map includes ALL photos (for PDF embedding)
        photo_map = {}

        # Map ALL photos for PDF embedding
        for i, path in enumerate(all_pdf_photos, 1):
            key = f"p{i:02d}"
            photo_map[key] = os.path.basename(path)

        # Build photo keys for all API photos
        photo_keys = [f"p{i:02d}" for i in range(1, len(api_photos) + 1)]

        # 5. Build prompt and call Claude API (in batches of 5)
        leak_notes = repair.get("leak_description", "") or "No description provided"
        skill_level = repair.get("skill_level", "journeyman")
        language = repair.get("preferred_language", "en")

        # Load reference context
        ref_context = load_reference_context()
        history_context = load_repair_history()

        system_prompt = f"""You are DumbRoof Repair AI. Use the following reference knowledge to inform your diagnosis.

{ref_context}
{history_context}
"""

        # Process photos in batches, collect all annotations, then do final diagnosis
        all_batch_annotations = {}
        total_batches = (len(api_photos) + BATCH_SIZE - 1) // BATCH_SIZE

        for batch_idx in range(0, len(api_photos), BATCH_SIZE):
            batch = api_photos[batch_idx:batch_idx + BATCH_SIZE]
            batch_num = batch_idx // BATCH_SIZE + 1
            start_num = batch_idx + 1

            print(f"[REPAIR] Photo batch {batch_num}/{total_batches} ({len(batch)} photos)")

            batch_content = []
            batch_keys = []
            for i, path in enumerate(batch, start_num):
                key = f"p{i:02d}"
                batch_keys.append(key)
                b64 = file_to_base64(path)
                batch_content.append({
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/jpeg", "data": b64},
                })

            # For single batch, do full diagnosis; for multi-batch, collect annotations first
            if total_batches == 1:
                prompt = build_diagnostic_prompt(batch_keys, leak_notes, skill_level, language)
                user_content = batch_content + [{"type": "text", "text": prompt}]

                print(f"[REPAIR] Calling Claude API for diagnosis...")
                response = _call_claude_with_retry(
                    claude,
                    model="claude-sonnet-4-6",
                    max_tokens=8192,
                    system=system_prompt,
                    messages=[{"role": "user", "content": user_content}],
                )
                response_text = response.content[0].text.strip()
            else:
                # Batch annotation pass — describe photos for later synthesis
                batch_content.append({
                    "type": "text",
                    "text": f"Describe each photo ({', '.join(batch_keys)}) for a leak diagnosis. "
                            f"Context from roofer: {leak_notes}\n"
                            f"Return JSON: {{\"photo_annotations\": {{\"pNN\": \"description\"}}}}",
                })

                batch_response = _call_claude_with_retry(
                    claude,
                    model="claude-sonnet-4-6",
                    max_tokens=2048,
                    system=system_prompt,
                    messages=[{"role": "user", "content": batch_content}],
                )
                batch_text = batch_response.content[0].text.strip()
                if batch_text.startswith("```"):
                    lines = batch_text.split("\n")
                    if lines[0].startswith("```"):
                        lines = lines[1:]
                    if lines and lines[-1].strip() == "```":
                        lines = lines[:-1]
                    batch_text = "\n".join(lines)
                try:
                    batch_data = json.loads(batch_text)
                    all_batch_annotations.update(batch_data.get("photo_annotations", {}))
                except json.JSONDecodeError:
                    print(f"[REPAIR] Warning: batch {batch_num} annotation parse failed, continuing")

        # For multi-batch: final synthesis call with all annotations (no photos)
        if total_batches > 1:
            annotations_summary = "\n".join(f"  {k}: {v}" for k, v in all_batch_annotations.items())
            prompt = build_diagnostic_prompt(photo_keys, leak_notes, skill_level, language)
            synthesis_prompt = (
                f"Based on photo annotations from inspection:\n{annotations_summary}\n\n"
                f"{prompt}"
            )

            print(f"[REPAIR] Calling Claude API for final diagnosis synthesis...")
            response = _call_claude_with_retry(
                claude,
                model="claude-sonnet-4-6",
                max_tokens=8192,
                system=system_prompt,
                messages=[{"role": "user", "content": synthesis_prompt}],
            )
            response_text = response.content[0].text.strip()

        # 6. Parse diagnosis response
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            response_text = "\n".join(lines)

        try:
            diagnosis_data = json.loads(response_text)
        except json.JSONDecodeError as e:
            raise ValueError(f"Failed to parse AI diagnosis as JSON: {e}\nResponse: {response_text[:500]}")

        required = ["diagnosis", "repair", "homeowner_ticket"]
        missing = [k for k in required if k not in diagnosis_data]
        if missing:
            raise ValueError(f"AI response missing required sections: {missing}")

        print(f"[REPAIR] Diagnosis: {diagnosis_data['diagnosis'].get('repair_type', 'unknown')} "
              f"(confidence: {diagnosis_data['diagnosis'].get('confidence', 0):.0%})")

        # 7. Build contractor info
        contractor = {
            "company_name": "DumbRoof Repair",
            "contact_name": "",
            "phone": "",
            "email": "",
        }
        if company_profile:
            contractor = {
                "company_name": company_profile.get("company_name", "DumbRoof Repair"),
                "contact_name": company_profile.get("contact_name", ""),
                "phone": company_profile.get("phone", ""),
                "email": company_profile.get("email", ""),
            }
            logo_path_val = company_profile.get("logo_path", "")
            if logo_path_val:
                contractor["logo_path_OPTIONAL"] = os.path.join(photos_dir, "logo.jpg")

        # 8. Assemble repair_job_config.json
        now = datetime.now()
        job_id = f"RPR-{now.strftime('%Y%m%d-%H%M%S')}"

        diag = diagnosis_data.get("diagnosis", {})
        repair_data = diagnosis_data.get("repair", {})
        ticket = diagnosis_data.get("homeowner_ticket", {})

        # Parse address into components
        address_parts = repair["address"].split(",")
        street = address_parts[0].strip() if address_parts else repair["address"]
        city = address_parts[1].strip() if len(address_parts) > 1 else ""
        state_zip = address_parts[2].strip() if len(address_parts) > 2 else ""
        state = state_zip.split()[0] if state_zip else ""
        zip_code = state_zip.split()[1] if len(state_zip.split()) > 1 else ""

        config = {
            "job": {
                "job_id": job_id,
                "created": now.isoformat(),
                "status": "diagnosed",
            },
            "contractor": contractor,
            "property": {
                "address": street,
                "city": city,
                "state": state,
                "zip": zip_code,
            },
            "homeowner": {
                "name": repair.get("homeowner_name", ""),
            },
            "submission": {
                "submitted_by": repair.get("roofer_name", ""),
                "skill_level": skill_level,
                "preferred_language": language,
                "leak_location_notes": leak_notes,
                "photo_count": len(photo_paths),
            },
            "photo_map": photo_map,
            "photo_annotations": diagnosis_data.get("photo_annotations", {}),
            "diagnosis": {
                "leak_source": diag.get("leak_source", ""),
                "repair_type": diag.get("repair_type", ""),
                "severity": diag.get("severity", "moderate"),
                "is_temporary": diag.get("is_temporary", False),
                "confidence": diag.get("confidence", 0.0),
            },
            "repair": {
                "summary": repair_data.get("summary", ""),
                "steps": repair_data.get("steps", []),
                "materials_list": repair_data.get("materials_list", []),
                "labor_hours": repair_data.get("labor_hours", 0),
                "materials_cost": repair_data.get("materials_cost", 0),
                "labor_cost": repair_data.get("labor_cost", 0),
                "total_price": repair_data.get("total_price", 0),
            },
            "homeowner_ticket": {
                "what_we_found": ticket.get("what_we_found", ""),
                "what_we_recommend": ticket.get("what_we_recommend", ""),
                "price": repair_data.get("total_price", 0),
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

        # 9. Write config and generate PDFs
        config_path = os.path.join(work_dir, "repair_job_config.json")
        with open(config_path, "w") as f:
            json.dump(config, f, indent=2)

        # Copy photos to the work dir structure expected by repair_generator.py
        # Photos are already in photos_dir, and config._paths will be set by the generator

        print(f"[REPAIR] Generating PDFs...")
        generator_path = os.path.join(BACKEND_DIR, "repair_generator.py")

        result = subprocess.run(
            ["python3", generator_path, config_path],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=BACKEND_DIR,
        )

        if result.returncode != 0:
            print(f"[REPAIR] Generator stderr: {result.stderr}")
            raise RuntimeError(f"PDF generation failed: {result.stderr[:500]}")

        print(f"[REPAIR] Generator output: {result.stdout}")

        # 10. Upload PDFs to Supabase Storage
        output_files = []
        for pdf_file in sorted(os.listdir(output_dir)):
            if pdf_file.endswith(".pdf"):
                local_pdf = os.path.join(output_dir, pdf_file)
                remote_path = f"{file_path}/output/{pdf_file}"
                upload_file(sb, "claim-documents", remote_path, local_pdf)
                output_files.append(pdf_file)
                size = os.path.getsize(local_pdf)
                print(f"[REPAIR] Uploaded: {pdf_file} ({size:,} bytes)")

        if not output_files:
            raise RuntimeError("No PDFs were generated")

        # 11. Update database with results
        total_price = repair_data.get("total_price", 0)
        repair_type = diag.get("repair_type", "")
        severity = diag.get("severity", "moderate")

        sb.table("repairs").update({
            "status": "ready",
            "output_files": output_files,
            "repair_type": repair_type,
            "severity": severity,
            "total_price": total_price,
        }).eq("id", repair_id).execute()

        print(f"[REPAIR] COMPLETE — {repair['address']} — {repair_type} — ${total_price:.2f}")
        print(f"[REPAIR] {len(output_files)} PDFs uploaded: {', '.join(output_files)}")
