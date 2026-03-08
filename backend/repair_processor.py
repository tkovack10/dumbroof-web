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
from repair_ai.config import (
    REPAIR_TYPES,
    REFERENCE_FILES as _REFERENCE_FILES,
)
from repair_ai.diagnostic import (
    build_diagnostic_prompt,
    parse_diagnosis_response,
    assemble_repair_job,
    load_reference_context as _load_ref_context,
    load_repair_history_context,
    load_decision_tree,
    load_scope_library,
)

# Backend directory (where repair_generator.py + references live)
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))


# ===================================================================
# SIZE GATE CONSTANTS (E054 — tightened to prevent 413 errors)
# ===================================================================

MAX_API_PHOTOS = 10       # Max photos sent to Claude API (was 15)
BATCH_SIZE = 5            # Photos per API call
MAX_PHOTO_BYTES = 150_000 # 150KB per photo (was 300KB)
MAX_BATCH_PAYLOAD = 4_000_000  # 4MB per API call (base64 estimate)


def _log_payload_size(images: list, text: str) -> int:
    """Log estimated payload size before Claude API call. Returns estimated bytes."""
    text_bytes = len(text.encode("utf-8"))
    img_bytes = sum(len(img.get("source", {}).get("data", "")) for img in images if img.get("type") == "image")
    total = text_bytes + img_bytes
    print(f"[REPAIR] Payload estimate: {total:,}B (text: {text_bytes:,}B, images: {img_bytes:,}B, count: {sum(1 for i in images if i.get('type') == 'image')})")
    return total


def _adaptive_recompress(photo_path: str, max_bytes: int) -> str:
    """Re-compress a photo at lower quality if it exceeds max_bytes. Returns path or '' if fails."""
    fsize = os.path.getsize(photo_path)
    if fsize <= max_bytes:
        return photo_path
    # Try lower quality and smaller dimensions
    recomp = prepare_photo_for_api(photo_path, max_dim=384, quality=30)
    if not recomp:
        return ""
    if os.path.getsize(recomp) <= max_bytes:
        return recomp
    print(f"[REPAIR] Photo still too large after re-compression ({os.path.getsize(recomp):,}B), skipping: {os.path.basename(photo_path)}")
    return ""


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
    sb.table("repairs").update({"status": "processing", "updated_at": datetime.now().isoformat()}).eq("id", repair_id).execute()

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
        downloaded_paths = []
        for fname in repair.get("photo_files", []):
            local = os.path.join(photos_dir, fname)
            download_file(sb, "claim-documents", f"{file_path}/photos/{fname}", local)
            downloaded_paths.append(local)

        # Ingest all files — extracts ZIPs, PDFs, converts HEIC/TIFF/etc.
        photo_paths = ingest_photos(downloaded_paths, photos_dir)

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

        # Prepare subset for Claude API (512px, 50% quality)
        api_photos = []
        for p in all_pdf_photos[:MAX_API_PHOTOS]:
            prepared = prepare_photo_for_api(p, max_dim=512, quality=50)
            if prepared:
                api_photos.append(prepared)

        # Size gate — reject oversized photos with adaptive re-compression
        sized_photos = []
        total_size = 0
        for p in api_photos:
            fsize = os.path.getsize(p)
            if fsize > MAX_PHOTO_BYTES:
                # Try adaptive re-compression before skipping
                p = _adaptive_recompress(p, MAX_PHOTO_BYTES)
                if not p:
                    continue
                fsize = os.path.getsize(p)
            b64_est = (fsize * 4) // 3
            if total_size + b64_est > MAX_BATCH_PAYLOAD:
                print(f"[REPAIR] Payload cap reached at {len(sized_photos)} photos ({total_size:,}B)")
                break
            sized_photos.append(p)
            total_size += b64_est
        if len(sized_photos) < len(api_photos):
            print(f"[REPAIR] Size gate: {len(sized_photos)} of {len(api_photos)} photos passed ({total_size:,}B total)")
        api_photos = sized_photos

        if len(all_pdf_photos) > MAX_API_PHOTOS:
            print(f"[REPAIR] Sending {len(api_photos)} of {len(all_pdf_photos)} photos to AI (all {len(all_pdf_photos)} embedded in PDFs)")

        # 4. Build photo keys and encode
        photo_map = {}
        for i, path in enumerate(all_pdf_photos, 1):
            key = f"p{i:02d}"
            photo_map[key] = os.path.basename(path)

        photo_keys = [f"p{i:02d}" for i in range(1, len(api_photos) + 1)]

        # 5. Build prompt and call Claude API (in batches)
        leak_notes = repair.get("leak_description", "") or "No description provided"
        skill_level = repair.get("skill_level", "journeyman")
        language = repair.get("preferred_language", "en")

        # Load reference context — only repair-essential files (not claims-focused ones)
        # repair-diagnostic-standard.md (32KB) + leak-repair-guide.md (17KB) = ~49KB
        # Skip: damage-identification.md (56KB, claims), installation-techniques.md,
        #        products-and-materials.md (redundant with config.DEFAULT_MATERIAL_COSTS)
        _REPAIR_REF_FILES = [
            "references/repair-diagnostic-standard.md",
            "references/leak-repair-guide.md",
        ]
        ref_parts = []
        for ref_file in _REPAIR_REF_FILES:
            path = os.path.join(BACKEND_DIR, ref_file)
            if os.path.exists(path):
                with open(path, "r") as f:
                    ref_parts.append(f"=== {ref_file} ===\n{f.read()}\n")
        ref_context = "\n".join(ref_parts)

        system_prompt = f"""You are DumbRoof Repair AI. Use the following reference knowledge to inform your diagnosis.
Follow the decision tree STRICTLY.

CRITICAL OUTPUT CONSTRAINT: Your ENTIRE JSON response MUST be under 5000 tokens.
- ENGLISH ONLY — do NOT include title_es, instructions_es, or safety_note_es fields. Set them to null.
- leak_source: max 2 sentences
- photo_annotations: max 1 sentence each
- repair step instructions: max 2 sentences each
- what_we_found / what_we_recommend: max 2 sentences each
- Max 5 repair steps. Combine related steps.
- Do NOT repeat information across fields.

{ref_context}
"""
        print(f"[REPAIR] System prompt size: {len(system_prompt):,} chars (~{len(system_prompt)//4:,} tokens)")

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

            if total_batches == 1:
                prompt = build_diagnostic_prompt(batch_keys, leak_notes, skill_level, language)
                user_content = batch_content + [{"type": "text", "text": prompt}]

                _log_payload_size(batch_content, prompt)
                print(f"[REPAIR] Calling Claude API for diagnosis...")
                response = _call_claude_with_retry(
                    claude,
                    model="claude-opus-4-6",
                    max_tokens=32768,
                    system=system_prompt,
                    messages=[{"role": "user", "content": user_content}],
                )
                response_text = response.content[0].text.strip()
                print(f"[REPAIR] Response: {len(response_text):,} chars, stop_reason={response.stop_reason}, "
                      f"input_tokens={response.usage.input_tokens}, output_tokens={response.usage.output_tokens}")
                if response.stop_reason == "max_tokens":
                    print(f"[REPAIR] WARNING: Response truncated — retrying with concise instruction")
                    concise_msg = (
                        "Your previous response was truncated. Return the SAME diagnosis but MUCH shorter. "
                        "Max 1 sentence per field. Max 3 repair steps. No Spanish translations. "
                        "Total response under 4000 tokens."
                    )
                    retry_msgs = [
                        {"role": "user", "content": user_content},
                        {"role": "assistant", "content": response_text},
                        {"role": "user", "content": concise_msg},
                    ]
                    response = _call_claude_with_retry(
                        claude,
                        model="claude-opus-4-6",
                        max_tokens=8192,
                        system=system_prompt,
                        messages=retry_msgs,
                    )
                    response_text = response.content[0].text.strip()
                    print(f"[REPAIR] Retry response: {len(response_text):,} chars, stop_reason={response.stop_reason}")
            else:
                batch_text_prompt = (
                    f"Describe each photo ({', '.join(batch_keys)}) for a leak diagnosis. "
                    f"Context from roofer: {leak_notes}\n"
                    f"Return JSON: {{\"photo_annotations\": {{\"pNN\": \"description\"}}}}"
                )
                batch_content.append({"type": "text", "text": batch_text_prompt})

                _log_payload_size(batch_content, batch_text_prompt)
                batch_response = _call_claude_with_retry(
                    claude,
                    model="claude-opus-4-6",
                    max_tokens=2048,
                    system=system_prompt,
                    messages=[{"role": "user", "content": batch_content}],
                )
                batch_text = batch_response.content[0].text.strip()
                try:
                    batch_data = json.loads(
                        batch_text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
                    )
                    all_batch_annotations.update(batch_data.get("photo_annotations", {}))
                except json.JSONDecodeError:
                    print(f"[REPAIR] Warning: batch {batch_num} annotation parse failed, continuing")

        # For multi-batch: split synthesis into TWO calls to stay under 8K output token limit
        # Call 1: Diagnosis + photo annotations (~2K tokens)
        # Call 2: Repair plan (steps, materials, pricing, ticket) (~4K tokens)
        if total_batches > 1:
            annotations_summary = "\n".join(f"  {k}: {v}" for k, v in all_batch_annotations.items())
            repair_codes = ", ".join(REPAIR_TYPES.keys())
            synthesis_system = "You are DumbRoof Repair AI. Return ONLY valid JSON, no markdown fencing."

            # --- Call 1: Diagnosis ---
            diag_prompt = f"""Photo annotations from roof leak inspection:
{annotations_summary}

Roofer notes: {leak_notes}

Diagnose the PRIMARY leak source. Use one repair code from: {repair_codes}

Return JSON: {{"diagnosis":{{"primary_code":"CODE","family":"family_name","leak_source":"1-2 sentences max","severity":"minor|moderate|major|critical|emergency","confidence":0.85,"decision_path":"S1>S2>...","is_temporary":false}},"photo_annotations":{{"p01":"1 sentence max"}}}}"""

            print(f"[REPAIR] Synthesis call 1/2: diagnosis...")
            resp1 = _call_claude_with_retry(
                claude, model="claude-opus-4-6", max_tokens=4096,
                system=synthesis_system,
                messages=[{"role": "user", "content": diag_prompt}],
            )
            diag_text = resp1.content[0].text.strip()
            print(f"[REPAIR] Diag response: {len(diag_text):,} chars, stop={resp1.stop_reason}")

            # Parse diagnosis
            diag_json = json.loads(
                diag_text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            )

            diag_result = diag_json.get("diagnosis", {})
            primary_code_val = diag_result.get("primary_code", "FIELD-SHINGLE")
            leak_source = diag_result.get("leak_source", "")

            # --- Call 2: Repair plan ---
            repair_prompt = f"""Diagnosis: {primary_code_val} — {leak_source}
Severity: {diag_result.get('severity', 'moderate')}
Skill level: {skill_level}

Generate a repair plan. Labor rate: $85/hr. Min charge: $450. Material costs use 2x retail.
Max 5 steps. English only (set _es fields to null). Max 2 sentences per instruction.

Return JSON: {{"repair":{{"summary":"1 sentence","steps":[{{"step":1,"category":"protection|removal|inspection|installation|cleanup","title_en":"title","title_es":null,"instructions_en":"instructions","instructions_es":null,"materials":["item"],"time_minutes":10,"safety_note_en":null,"safety_note_es":null,"photo_reference":null}}],"materials_list":[{{"item":"name","qty":1,"unit":"EA","cost":10.00}}],"labor_hours":4,"materials_cost":0,"labor_cost":0,"total_price":0}},"homeowner_ticket":{{"what_we_found":"1 sentence for homeowner","what_we_recommend":"1 sentence","time_estimate":"X hours","urgency":"{diag_result.get('severity', 'moderate')}","warranty":"2-year workmanship warranty"}}}}"""

            print(f"[REPAIR] Synthesis call 2/2: repair plan...")
            resp2 = _call_claude_with_retry(
                claude, model="claude-opus-4-6", max_tokens=8192,
                system=synthesis_system,
                messages=[{"role": "user", "content": repair_prompt}],
            )
            repair_text = resp2.content[0].text.strip()
            print(f"[REPAIR] Repair response: {len(repair_text):,} chars, stop={resp2.stop_reason}")

            repair_json = json.loads(
                repair_text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            )

            # Merge the two responses
            response_text = json.dumps({
                **diag_json,
                **repair_json,
            })

            # Ensure diagnosis has repair_type for backward compat
            merged = json.loads(response_text)
            if "repair_type" not in merged.get("diagnosis", {}):
                merged["diagnosis"]["repair_type"] = merged["diagnosis"].get("primary_code", "")
            response_text = json.dumps(merged)

        # 6. Parse diagnosis response (handles markdown fencing + validation)
        diagnosis_data = parse_diagnosis_response(response_text)

        diag = diagnosis_data.get("diagnosis", {})
        primary_code = diag.get("primary_code", diag.get("repair_type", "unknown"))
        print(f"[REPAIR] Diagnosis: {primary_code} "
              f"(confidence: {diag.get('confidence', 0):.0%})")

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

        # 8. Assemble repair_job_config.json using repair_ai module
        now = datetime.now()
        job_id = f"RPR-{now.strftime('%Y%m%d-%H%M%S')}"

        # Parse address into components
        address_parts = repair["address"].split(",")
        street = address_parts[0].strip() if address_parts else repair["address"]
        city = address_parts[1].strip() if len(address_parts) > 1 else ""
        state_zip = address_parts[2].strip() if len(address_parts) > 2 else ""
        state = state_zip.split()[0] if state_zip else ""
        zip_code = state_zip.split()[1] if len(state_zip.split()) > 1 else ""

        config = assemble_repair_job(
            job_id=job_id,
            diagnosis_data=diagnosis_data,
            photo_map=photo_map,
            submission={
                "submitted_by": repair.get("roofer_name", ""),
                "skill_level": skill_level,
                "preferred_language": language,
                "leak_location_notes": leak_notes,
                "photo_count": len(photo_paths),
            },
            contractor=contractor,
            property_info={
                "address": street,
                "city": city,
                "state": state,
                "zip": zip_code,
            },
            homeowner={
                "name": repair.get("homeowner_name", ""),
            },
        )
        config["job"]["created"] = now.isoformat()

        # 9. Write config and generate PDFs
        config_path = os.path.join(work_dir, "repair_job_config.json")
        with open(config_path, "w") as f:
            json.dump(config, f, indent=2)

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
        repair_data = diagnosis_data.get("repair", {})
        total_price = repair_data.get("total_price", 0)
        repair_type = primary_code
        severity = diag.get("severity", "moderate")

        sb.table("repairs").update({
            "status": "ready",
            "output_files": output_files,
            "repair_type": repair_type,
            "severity": severity,
            "total_price": total_price,
            "updated_at": datetime.now().isoformat(),
        }).eq("id", repair_id).execute()

        print(f"[REPAIR] COMPLETE — {repair['address']} — {repair_type} — ${total_price:.2f}")
        print(f"[REPAIR] {len(output_files)} PDFs uploaded: {', '.join(output_files)}")
