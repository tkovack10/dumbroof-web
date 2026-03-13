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
)
from telemetry import call_claude_logged
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
    build_checkpoint_instructions,
)
from repair_utils import (
    update_repair_status,
    determine_checkpoint_strategy,
    create_checkpoint,
    get_current_diagnosis,
    MAX_CHECKPOINTS,
    MAX_PIVOTS,
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

    # Get company profile + custom pricing in parallel
    company_profile = None
    custom_pricing = None
    try:
        profile_result = sb.table("company_profiles").select("*").eq("user_id", repair["user_id"]).single().execute()
        company_profile = profile_result.data
        if company_profile:
            print(f"[REPAIR] Using company branding: {company_profile.get('company_name', 'N/A')}")
    except Exception:
        pass
    try:
        pricing_result = sb.table("repair_pricing").select("*").eq("user_id", repair["user_id"]).single().execute()
        if pricing_result.data:
            custom_pricing = pricing_result.data
            print(f"[REPAIR] Custom pricing loaded: diag=${custom_pricing.get('diagnostic_fee')}, labor=${custom_pricing.get('labor_rate_per_hour')}/hr")
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
        failed_batches = []
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
                prompt = build_diagnostic_prompt(batch_keys, leak_notes, skill_level, language, pricing=custom_pricing)
                user_content = batch_content + [{"type": "text", "text": prompt}]

                _log_payload_size(batch_content, prompt)
                print(f"[REPAIR] Calling Claude API for diagnosis...")
                response = call_claude_logged(
                    claude, sb, repair_id,
                    step_name="repair_diagnosis",
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
                    response = call_claude_logged(
                        claude, sb, repair_id,
                        step_name="repair_diagnosis_retry",
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
                batch_response = call_claude_logged(
                    claude, sb, repair_id,
                    step_name=f"repair_photo_batch_{batch_num}",
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
                    failed_batches.append(batch_num)

        if failed_batches:
            print(f"[REPAIR] WARNING: {len(failed_batches)}/{total_batches} annotation batches failed — diagnosis may be incomplete")

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
            resp1 = call_claude_logged(
                claude, sb, repair_id,
                step_name="repair_synthesis_diagnosis",
                model="claude-opus-4-6", max_tokens=4096,
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

Generate a repair plan. Labor rate: ${(custom_pricing or {}).get('labor_rate_per_hour', 85)}/hr. Min charge: ${(custom_pricing or {}).get('minimum_job_charge', 450)}. Diagnostic fee: ${(custom_pricing or {}).get('diagnostic_fee', 250)}. Material costs use {int((custom_pricing or {}).get('markup_percent', 0.20) * 100 + 100)}% of retail.
Max 5 steps. English only (set _es fields to null). Max 2 sentences per instruction.

Return JSON: {{"repair":{{"summary":"1 sentence","steps":[{{"step":1,"category":"protection|removal|inspection|installation|cleanup","title_en":"title","title_es":null,"instructions_en":"instructions","instructions_es":null,"materials":["item"],"time_minutes":10,"safety_note_en":null,"safety_note_es":null,"photo_reference":null}}],"materials_list":[{{"item":"name","qty":1,"unit":"EA","cost":10.00}}],"labor_hours":4,"materials_cost":0,"labor_cost":0,"total_price":0}},"homeowner_ticket":{{"what_we_found":"1 sentence for homeowner","what_we_recommend":"1 sentence","time_estimate":"X hours","urgency":"{diag_result.get('severity', 'moderate')}","warranty":"2-year workmanship warranty"}}}}"""

            print(f"[REPAIR] Synthesis call 2/2: repair plan...")
            resp2 = call_claude_logged(
                claude, sb, repair_id,
                step_name="repair_synthesis_plan",
                model="claude-opus-4-6", max_tokens=8192,
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

            # Validate merged diagnosis has a repair code
            m_diag = merged.get("diagnosis", {})
            if not m_diag.get("primary_code") and not m_diag.get("repair_type"):
                print("[REPAIR] WARNING: No repair code in merged response, defaulting to FIELD-SHINGLE")
                merged["diagnosis"]["primary_code"] = "FIELD-SHINGLE"
                merged["diagnosis"]["repair_type"] = "FIELD-SHINGLE"

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
            custom_pricing=custom_pricing,
        )
        config["job"]["created"] = now.isoformat()

        # 9. Determine checkpoint strategy
        confidence = diag.get("confidence", 0)
        checkpoint_specs = determine_checkpoint_strategy(diagnosis_data, skill_level, confidence)

        # Build the diagnosis snapshot for checkpoints
        diagnosis_snapshot = {
            "diagnosis": diagnosis_data.get("diagnosis", {}),
            "repair": diagnosis_data.get("repair", {}),
            "homeowner_ticket": diagnosis_data.get("homeowner_ticket", {}),
        }

        # 10. Write config and generate PDFs
        # Mark as preliminary if checkpoints are needed
        if checkpoint_specs:
            config["job"]["preliminary"] = True

        config_path = os.path.join(work_dir, "repair_job_config.json")
        with open(config_path, "w") as f:
            json.dump(config, f, indent=2)

        print(f"[REPAIR] Generating PDFs{'  (PRELIMINARY)' if checkpoint_specs else ''}...")
        generator_path = os.path.join(BACKEND_DIR, "repair_generator.py")

        gen_result = subprocess.run(
            ["python3", generator_path, config_path],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=BACKEND_DIR,
        )

        if gen_result.returncode != 0:
            print(f"[REPAIR] Generator stderr: {gen_result.stderr}")
            raise RuntimeError(f"PDF generation failed: {gen_result.stderr[:500]}")

        print(f"[REPAIR] Generator output: {gen_result.stdout}")

        # 11. Upload PDFs to Supabase Storage
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

        # 12. Branch: checkpoints needed vs legacy path
        repair_data = diagnosis_data.get("repair", {})
        total_price = repair_data.get("total_price", 0)
        repair_type = primary_code
        severity = diag.get("severity", "moderate")

        if checkpoint_specs:
            # --- CHECKPOINT PATH ---
            print(f"[REPAIR] Checkpoint strategy: {len(checkpoint_specs)} checkpoints needed "
                  f"(skill={skill_level}, confidence={confidence:.0%})")

            # Create first checkpoint
            first_spec = checkpoint_specs[0]
            instructions = build_checkpoint_instructions(
                checkpoint_type=first_spec["checkpoint_type"],
                primary_code=primary_code,
                leak_source=diag.get("leak_source", ""),
                skill_level=skill_level,
                checkpoint_number=1,
            )

            cp_id = create_checkpoint(
                sb=sb,
                repair_id=repair_id,
                checkpoint_number=1,
                checkpoint_type=first_spec["checkpoint_type"],
                instructions_en=instructions["instructions_en"],
                instructions_es=instructions.get("instructions_es"),
                what_to_photograph=instructions["what_to_photograph"],
                expected_finding=instructions["expected_finding"],
                diagnosis_snapshot=diagnosis_snapshot,
            )

            # Update repair to active with checkpoint info
            update_repair_status(sb, repair_id, "active",
                output_files=output_files,
                repair_type=repair_type,
                severity=severity,
                total_price=total_price,
                original_diagnosis_code=primary_code,
                current_checkpoint_id=cp_id,
                checkpoint_count=len(checkpoint_specs),
            )

            print(f"[REPAIR] ACTIVE — {repair['address']} — checkpoint 1/{len(checkpoint_specs)} "
                  f"({first_spec['checkpoint_type']}) — waiting for roofer photos")
        else:
            # --- LEGACY PATH (no checkpoints) ---
            sb.table("repairs").update({
                "status": "ready",
                "output_files": output_files,
                "repair_type": repair_type,
                "severity": severity,
                "total_price": total_price,
                "updated_at": datetime.now().isoformat(),
            }).eq("id", repair_id).execute()

            print(f"[REPAIR] COMPLETE — {repair['address']} — {repair_type} — ${total_price:.2f}")

        # 13. Notify via Vercel API route (email user + homeowner)
        try:
            import urllib.request
            notify_url = "https://www.dumbroof.ai/api/notify-repair-complete"
            notify_payload = json.dumps({"repair_id": repair_id}).encode("utf-8")
            req = urllib.request.Request(
                notify_url,
                data=notify_payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                notify_result = json.loads(resp.read().decode())
                print(f"[REPAIR] Email notification: {notify_result}")
        except Exception as e:
            print(f"[REPAIR] Email notification failed (non-fatal): {e}")

        print(f"[REPAIR] {len(output_files)} PDFs uploaded: {', '.join(output_files)}")


# ===================================================================
# PHASE 2: CHECKPOINT PROCESSING
# ===================================================================

async def process_checkpoint(checkpoint_id: str):
    """Process a checkpoint after roofer uploads photos.

    Downloads checkpoint photos, builds context prompt with diagnosis history,
    calls Claude Opus, and decides: proceed / pivot / add_checkpoint / escalate.
    """
    sb = get_supabase_client()
    claude = get_anthropic_client()

    # Load checkpoint + repair
    cp_result = sb.table("repair_checkpoints").select("*").eq("id", checkpoint_id).single().execute()
    checkpoint = cp_result.data
    if not checkpoint:
        raise ValueError(f"Checkpoint {checkpoint_id} not found")

    repair_id = checkpoint["repair_id"]
    repair_result = sb.table("repairs").select("*").eq("id", repair_id).single().execute()
    repair = repair_result.data
    if not repair:
        raise ValueError(f"Repair {repair_id} not found")

    print(f"[CHECKPOINT] Processing checkpoint #{checkpoint['checkpoint_number']} "
          f"({checkpoint['checkpoint_type']}) for {repair['address']}")

    # Update checkpoint status to analyzing
    sb.table("repair_checkpoints").update({
        "status": "analyzing",
    }).eq("id", checkpoint_id).execute()

    # Get prior checkpoints for context
    prior_result = sb.table("repair_checkpoints").select("*").eq(
        "repair_id", repair_id
    ).lt("checkpoint_number", checkpoint["checkpoint_number"]).order(
        "checkpoint_number"
    ).execute()
    prior_checkpoints = prior_result.data or []

    file_path = repair["file_path"]
    cp_num = checkpoint["checkpoint_number"]

    with tempfile.TemporaryDirectory(prefix="dumbroof_checkpoint_") as work_dir:
        photos_dir = os.path.join(work_dir, "photos")
        os.makedirs(photos_dir)

        # Download checkpoint photos
        cp_photos = checkpoint.get("photo_files", []) or []
        photo_paths = []
        for fname in cp_photos:
            local = os.path.join(photos_dir, fname)
            try:
                download_file(sb, "claim-documents",
                              f"{file_path}/checkpoints/cp{cp_num}/{fname}", local)
                photo_paths.append(local)
            except Exception as e:
                print(f"[CHECKPOINT] Failed to download {fname}: {e}")

        if not photo_paths:
            raise ValueError("No checkpoint photos found")

        # Prepare photos for API
        api_photos = []
        photo_keys = []
        for i, path in enumerate(photo_paths, 1):
            key = f"cp{cp_num}_p{i:02d}"
            photo_keys.append(key)
            prepared = prepare_photo_for_api(path, max_dim=512, quality=50)
            if prepared:
                # Size gate
                fsize = os.path.getsize(prepared)
                if fsize > MAX_PHOTO_BYTES:
                    prepared = _adaptive_recompress(prepared, MAX_PHOTO_BYTES)
                if prepared:
                    api_photos.append(prepared)

        if not api_photos:
            raise ValueError("No usable checkpoint photos after processing")

        # Build prompt
        from repair_ai.diagnostic import build_checkpoint_prompt as build_cp_prompt
        prompt = build_cp_prompt(checkpoint, prior_checkpoints, photo_keys)

        # Build API content
        content = []
        for path in api_photos:
            b64 = file_to_base64(path)
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": "image/jpeg", "data": b64},
            })
        content.append({"type": "text", "text": prompt})

        _log_payload_size(content, prompt)
        print(f"[CHECKPOINT] Calling Claude Opus for checkpoint analysis...")

        response = call_claude_logged(
            claude, sb, repair_id,
            step_name=f"checkpoint_{cp_num}_analysis",
            model="claude-opus-4-6",
            max_tokens=8192,
            system="You are DumbRoof Repair AI analyzing checkpoint photos. Return ONLY valid JSON, no markdown fencing.",
            messages=[{"role": "user", "content": content}],
        )

        response_text = response.content[0].text.strip()
        print(f"[CHECKPOINT] Response: {len(response_text):,} chars, stop={response.stop_reason}")

        # Parse response
        text = response_text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            text = "\n".join(lines)

        cp_data = json.loads(text)

        decision = cp_data.get("decision", "proceed")
        ai_confidence = cp_data.get("confidence", 0)
        analysis = cp_data.get("analysis", "")

        print(f"[CHECKPOINT] Decision: {decision} (confidence: {ai_confidence:.0%})")

        # Update checkpoint with results
        cp_update = {
            "status": "passed" if decision == "proceed" else decision,
            "ai_analysis": analysis,
            "ai_analysis_es": cp_data.get("analysis_es"),
            "ai_confidence": ai_confidence,
            "ai_decision": decision,
            "message_to_roofer_en": cp_data.get("message_to_roofer_en", ""),
            "message_to_roofer_es": cp_data.get("message_to_roofer_es"),
            "analyzed_at": datetime.now().isoformat(),
        }

        if decision == "pivot":
            cp_update["pivot_reason"] = cp_data.get("pivot_reason", "")
            cp_update["updated_diagnosis"] = cp_data.get("updated_diagnosis")
            cp_update["updated_repair_plan"] = cp_data.get("updated_repair_plan")

            # Increment pivot count on repair
            current_pivots = repair.get("pivot_count", 0) or 0
            sb.table("repairs").update({
                "pivot_count": current_pivots + 1,
                "updated_at": datetime.now().isoformat(),
            }).eq("id", repair_id).execute()

            if current_pivots + 1 >= MAX_PIVOTS:
                print(f"[CHECKPOINT] Max pivots ({MAX_PIVOTS}) reached — forcing escalation")
                decision = "escalate"
                cp_update["ai_decision"] = "escalate"
                cp_update["status"] = "escalate"

        sb.table("repair_checkpoints").update(cp_update).eq("id", checkpoint_id).execute()

        # Determine next action based on decision
        if decision == "proceed":
            _handle_checkpoint_proceed(sb, repair, checkpoint, prior_checkpoints)
        elif decision == "pivot":
            _handle_checkpoint_pivot(sb, repair, checkpoint, cp_data)
        elif decision == "add_checkpoint":
            _handle_add_checkpoint(sb, repair, checkpoint, cp_data)
        elif decision == "escalate":
            _handle_escalate(sb, repair, checkpoint, cp_data)
        else:
            print(f"[CHECKPOINT] Unknown decision: {decision}, treating as proceed")
            _handle_checkpoint_proceed(sb, repair, checkpoint, prior_checkpoints)


def _handle_checkpoint_proceed(sb, repair, checkpoint, prior_checkpoints):
    """Handle proceed decision — check if more checkpoints needed or finalize."""
    repair_id = repair["id"]
    cp_num = checkpoint["checkpoint_number"]
    total_checkpoints = repair.get("checkpoint_count", 0) or 0

    if cp_num < total_checkpoints:
        # More checkpoints to go — create the next one
        next_num = cp_num + 1

        # Determine next checkpoint type based on the strategy
        # Re-derive from the original strategy
        diag = checkpoint.get("diagnosis_snapshot", {})
        confidence = diag.get("diagnosis", {}).get("confidence", 0)
        skill_level = repair.get("skill_level", "journeyman")
        specs = determine_checkpoint_strategy(diag, skill_level, confidence)

        if next_num <= len(specs):
            next_spec = specs[next_num - 1]
            next_type = next_spec["checkpoint_type"]
        else:
            next_type = "mid_repair_check"

        instructions = build_checkpoint_instructions(
            checkpoint_type=next_type,
            primary_code=diag.get("diagnosis", {}).get("primary_code", ""),
            leak_source=diag.get("diagnosis", {}).get("leak_source", ""),
            skill_level=skill_level,
            checkpoint_number=next_num,
        )

        cp_id = create_checkpoint(
            sb=sb,
            repair_id=repair_id,
            checkpoint_number=next_num,
            checkpoint_type=next_type,
            instructions_en=instructions["instructions_en"],
            instructions_es=instructions.get("instructions_es"),
            what_to_photograph=instructions["what_to_photograph"],
            expected_finding=instructions["expected_finding"],
            diagnosis_snapshot=checkpoint.get("diagnosis_snapshot", {}),
        )

        update_repair_status(sb, repair_id, "active",
                             current_checkpoint_id=cp_id)

        print(f"[CHECKPOINT] Proceed → next checkpoint #{next_num}/{total_checkpoints}")
    else:
        # All checkpoints complete — create completion checkpoint
        diag = get_current_diagnosis(sb, repair_id)
        primary_code = diag.get("diagnosis", {}).get("primary_code", "")
        leak_source = diag.get("diagnosis", {}).get("leak_source", "")

        instructions = build_checkpoint_instructions(
            checkpoint_type="completion_verify",
            primary_code=primary_code,
            leak_source=leak_source,
            skill_level=repair.get("skill_level", "journeyman"),
            checkpoint_number=cp_num + 1,
        )

        cp_id = create_checkpoint(
            sb=sb,
            repair_id=repair_id,
            checkpoint_number=cp_num + 1,
            checkpoint_type="completion_verify",
            instructions_en=instructions["instructions_en"],
            instructions_es=instructions.get("instructions_es"),
            what_to_photograph=instructions["what_to_photograph"],
            expected_finding=instructions["expected_finding"],
            diagnosis_snapshot=checkpoint.get("diagnosis_snapshot", {}),
        )

        update_repair_status(sb, repair_id, "active",
                             current_checkpoint_id=cp_id)

        print(f"[CHECKPOINT] All checkpoints passed — awaiting completion photos")


def _handle_checkpoint_pivot(sb, repair, checkpoint, cp_data):
    """Handle pivot decision — diagnosis changed, may need new checkpoints."""
    repair_id = repair["id"]
    cp_num = checkpoint["checkpoint_number"]
    skill_level = repair.get("skill_level", "journeyman")

    new_diag = cp_data.get("updated_diagnosis", {})
    new_confidence = new_diag.get("confidence", 0.5)

    # Build new snapshot from the pivot
    new_snapshot = {
        "diagnosis": new_diag,
        "repair": cp_data.get("updated_repair_plan", {}),
    }

    # Determine if we need more checkpoints for the new diagnosis
    new_specs = determine_checkpoint_strategy(new_snapshot, skill_level, new_confidence)

    if new_specs:
        next_spec = new_specs[0]
        instructions = build_checkpoint_instructions(
            checkpoint_type=next_spec["checkpoint_type"],
            primary_code=new_diag.get("primary_code", ""),
            leak_source=new_diag.get("leak_source", ""),
            skill_level=skill_level,
            checkpoint_number=cp_num + 1,
        )

        # Check max checkpoints
        total_existing = sb.table("repair_checkpoints").select("id", count="exact").eq(
            "repair_id", repair_id
        ).execute()
        existing_count = total_existing.count or 0

        if existing_count >= MAX_CHECKPOINTS:
            print(f"[CHECKPOINT] Max checkpoints ({MAX_CHECKPOINTS}) reached after pivot")
            update_repair_status(sb, repair_id, "active")
            return

        cp_id = create_checkpoint(
            sb=sb,
            repair_id=repair_id,
            checkpoint_number=cp_num + 1,
            checkpoint_type=next_spec["checkpoint_type"],
            instructions_en=instructions["instructions_en"],
            instructions_es=instructions.get("instructions_es"),
            what_to_photograph=instructions["what_to_photograph"],
            expected_finding=instructions["expected_finding"],
            diagnosis_snapshot=new_snapshot,
        )

        update_repair_status(sb, repair_id, "active",
                             current_checkpoint_id=cp_id,
                             checkpoint_count=cp_num + len(new_specs))

        print(f"[CHECKPOINT] PIVOT — new diagnosis, {len(new_specs)} more checkpoint(s)")
    else:
        # High confidence after pivot — go straight to completion
        instructions = build_checkpoint_instructions(
            checkpoint_type="completion_verify",
            primary_code=new_diag.get("primary_code", ""),
            leak_source=new_diag.get("leak_source", ""),
            skill_level=skill_level,
            checkpoint_number=cp_num + 1,
        )

        cp_id = create_checkpoint(
            sb=sb,
            repair_id=repair_id,
            checkpoint_number=cp_num + 1,
            checkpoint_type="completion_verify",
            instructions_en=instructions["instructions_en"],
            instructions_es=instructions.get("instructions_es"),
            what_to_photograph=instructions["what_to_photograph"],
            expected_finding=instructions["expected_finding"],
            diagnosis_snapshot=new_snapshot,
        )

        update_repair_status(sb, repair_id, "active",
                             current_checkpoint_id=cp_id)

        print(f"[CHECKPOINT] PIVOT → completion checkpoint (high confidence)")


def _handle_add_checkpoint(sb, repair, checkpoint, cp_data):
    """Handle add_checkpoint decision — AI wants more info."""
    repair_id = repair["id"]
    cp_num = checkpoint["checkpoint_number"]

    # Check max checkpoints
    total_existing = sb.table("repair_checkpoints").select("id", count="exact").eq(
        "repair_id", repair_id
    ).execute()
    existing_count = total_existing.count or 0

    if existing_count >= MAX_CHECKPOINTS:
        print(f"[CHECKPOINT] Max checkpoints ({MAX_CHECKPOINTS}) reached — proceeding as-is")
        _handle_checkpoint_proceed(sb, repair, checkpoint, [])
        return

    next_cp = cp_data.get("next_checkpoint", {})
    cp_id = create_checkpoint(
        sb=sb,
        repair_id=repair_id,
        checkpoint_number=cp_num + 1,
        checkpoint_type=next_cp.get("type", "verify_diagnosis"),
        instructions_en=next_cp.get("instructions_en", "Take additional photos of the repair area."),
        instructions_es=next_cp.get("instructions_es"),
        what_to_photograph=next_cp.get("what_to_photograph", "The repair area from new angles"),
        expected_finding=next_cp.get("expected_finding", "Additional clarity on the issue"),
        diagnosis_snapshot=checkpoint.get("diagnosis_snapshot", {}),
    )

    current_count = repair.get("checkpoint_count", 0) or 0
    update_repair_status(sb, repair_id, "active",
                         current_checkpoint_id=cp_id,
                         checkpoint_count=max(current_count, cp_num + 1))

    print(f"[CHECKPOINT] Added extra checkpoint #{cp_num + 1}")


def _handle_escalate(sb, repair, checkpoint, cp_data):
    """Handle escalation — specialist needed."""
    repair_id = repair["id"]
    analysis = cp_data.get("analysis", "Specialist required")

    update_repair_status(sb, repair_id, "active",
                         error_message=f"Escalation needed: {analysis[:300]}")

    print(f"[CHECKPOINT] ESCALATED — {repair['address']}: {analysis[:100]}")


# ===================================================================
# PHASE 3: COMPLETION PROCESSING
# ===================================================================

async def process_completion(checkpoint_id: str):
    """Process completion photos — verify the repair was done correctly.

    If verification passes, regenerate final PDFs (no longer preliminary)
    and generate a 4th PDF: Repair Log with full checkpoint timeline.
    """
    sb = get_supabase_client()
    claude = get_anthropic_client()

    cp_result = sb.table("repair_checkpoints").select("*").eq("id", checkpoint_id).single().execute()
    checkpoint = cp_result.data
    if not checkpoint:
        raise ValueError(f"Checkpoint {checkpoint_id} not found")

    repair_id = checkpoint["repair_id"]
    repair_result = sb.table("repairs").select("*").eq("id", repair_id).single().execute()
    repair = repair_result.data
    if not repair:
        raise ValueError(f"Repair {repair_id} not found")

    print(f"[COMPLETION] Verifying repair completion for {repair['address']}")

    # Update to analyzing
    sb.table("repair_checkpoints").update({"status": "analyzing"}).eq("id", checkpoint_id).execute()

    # Get all checkpoints for the repair log
    all_cps_result = sb.table("repair_checkpoints").select("*").eq(
        "repair_id", repair_id
    ).order("checkpoint_number").execute()
    all_checkpoints = all_cps_result.data or []

    file_path = repair["file_path"]
    cp_num = checkpoint["checkpoint_number"]

    with tempfile.TemporaryDirectory(prefix="dumbroof_completion_") as work_dir:
        photos_dir = os.path.join(work_dir, "photos")
        output_dir = os.path.join(work_dir, "pdf_output")
        os.makedirs(photos_dir)
        os.makedirs(output_dir)

        # Download completion photos
        cp_photos = checkpoint.get("photo_files", []) or []
        photo_paths = []
        for fname in cp_photos:
            local = os.path.join(photos_dir, fname)
            try:
                download_file(sb, "claim-documents",
                              f"{file_path}/checkpoints/cp{cp_num}/{fname}", local)
                photo_paths.append(local)
            except Exception as e:
                print(f"[COMPLETION] Failed to download {fname}: {e}")

        # Build completion verification prompt
        current_diag = get_current_diagnosis(sb, repair_id)
        repair_plan = current_diag.get("repair", {})

        photo_keys = [f"completion_p{i:02d}" for i in range(1, len(photo_paths) + 1)]

        # Prepare photos for API
        content = []
        for path in photo_paths:
            prepared = prepare_photo_for_api(path, max_dim=512, quality=50)
            if prepared:
                b64 = file_to_base64(prepared)
                content.append({
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/jpeg", "data": b64},
                })

        completion_prompt = f"""You are DumbRoof Repair AI verifying a completed repair.

## REPAIR PLAN
Primary code: {current_diag.get('diagnosis', {}).get('primary_code', 'unknown')}
Summary: {repair_plan.get('summary', 'N/A')}
Steps: {len(repair_plan.get('steps', []))}

## COMPLETION PHOTOS
{', '.join(photo_keys)}

## TASK
Verify the repair was completed correctly. Check:
1. All repair steps appear to have been executed
2. Materials match the repair plan
3. Work area is clean and professional
4. No visible defects or missed items

Return JSON:
{{
  "decision": "proceed",
  "confidence": 0.95,
  "analysis": "Description of what you see in the completion photos",
  "message_to_roofer_en": "Great work! Repair verified.",
  "message_to_roofer_es": null,
  "issues_found": []
}}

If issues found, set decision to "add_checkpoint" and list issues.
"""
        content.append({"type": "text", "text": completion_prompt})

        response = call_claude_logged(
            claude, sb, repair_id,
            step_name=f"completion_verification",
            model="claude-opus-4-6",
            max_tokens=4096,
            system="You are DumbRoof Repair AI verifying completion. Return ONLY valid JSON.",
            messages=[{"role": "user", "content": content}],
        )

        response_text = response.content[0].text.strip()
        text = response_text
        if text.startswith("```"):
            lines = text.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            text = "\n".join(lines)

        completion_data = json.loads(text)
        decision = completion_data.get("decision", "proceed")

        # Update checkpoint
        sb.table("repair_checkpoints").update({
            "status": "passed" if decision == "proceed" else decision,
            "ai_analysis": completion_data.get("analysis", ""),
            "ai_confidence": completion_data.get("confidence", 0),
            "ai_decision": decision,
            "message_to_roofer_en": completion_data.get("message_to_roofer_en", ""),
            "message_to_roofer_es": completion_data.get("message_to_roofer_es"),
            "analyzed_at": datetime.now().isoformat(),
        }).eq("id", checkpoint_id).execute()

        if decision != "proceed":
            print(f"[COMPLETION] Not verified — {decision}")
            if decision == "add_checkpoint":
                _handle_add_checkpoint(sb, repair, checkpoint, completion_data)
            return

        # Completion verified — rebuild final PDFs
        print(f"[COMPLETION] Verified! Regenerating final PDFs...")

        # Download all original photos for PDF rebuild
        for fname in repair.get("photo_files", []):
            local = os.path.join(photos_dir, fname)
            try:
                download_file(sb, "claim-documents", f"{file_path}/photos/{fname}", local)
            except Exception:
                pass

        # Download company logo
        company_profile = None
        custom_pricing = None
        try:
            profile_result = sb.table("company_profiles").select("*").eq("user_id", repair["user_id"]).single().execute()
            company_profile = profile_result.data
        except Exception:
            pass
        try:
            pricing_result = sb.table("repair_pricing").select("*").eq("user_id", repair["user_id"]).single().execute()
            if pricing_result.data:
                custom_pricing = pricing_result.data
        except Exception:
            pass

        if company_profile and company_profile.get("logo_path"):
            try:
                logo_data = sb.storage.from_("claim-documents").download(company_profile["logo_path"])
                with open(os.path.join(photos_dir, "logo.jpg"), "wb") as f:
                    f.write(logo_data)
            except Exception:
                pass

        # Build final config with checkpoint history
        # Get the current (possibly pivoted) diagnosis
        final_diag = get_current_diagnosis(sb, repair_id)

        # Build checkpoint history for QC log
        checkpoint_history = []
        diagnosis_evolution = []
        original_code = repair.get("original_diagnosis_code", "")

        for cp in all_checkpoints:
            cp_entry = {
                "number": cp["checkpoint_number"],
                "type": cp["checkpoint_type"],
                "status": cp.get("ai_decision", cp["status"]),
                "analysis": cp.get("ai_analysis", ""),
                "confidence": cp.get("ai_confidence", 0),
                "date": (cp.get("analyzed_at") or cp.get("created_at", ""))[:10],
            }
            checkpoint_history.append(cp_entry)

            if cp.get("ai_decision") == "pivot" and cp.get("updated_diagnosis"):
                diagnosis_evolution.append({
                    "checkpoint": cp["checkpoint_number"],
                    "from_code": original_code,
                    "to_code": cp["updated_diagnosis"].get("primary_code", ""),
                    "reason": cp.get("pivot_reason", ""),
                    "confidence": cp.get("ai_confidence", 0),
                })
                original_code = cp["updated_diagnosis"].get("primary_code", "")

        # Rebuild the job config as final (not preliminary)
        photo_map = {}
        photo_paths_all = []
        for p in sorted(os.listdir(photos_dir)):
            ext = p.rsplit(".", 1)[-1].lower() if "." in p else ""
            if ext in ("jpg", "jpeg", "png", "heic", "webp"):
                photo_paths_all.append(os.path.join(photos_dir, p))
        for i, path in enumerate(photo_paths_all, 1):
            photo_map[f"p{i:02d}"] = os.path.basename(path)

        # Use the final diagnosis data
        final_diag_data = final_diag if final_diag else {}

        contractor = {"company_name": "DumbRoof Repair"}
        if company_profile:
            contractor = {
                "company_name": company_profile.get("company_name", "DumbRoof Repair"),
                "contact_name": company_profile.get("contact_name", ""),
                "phone": company_profile.get("phone", ""),
                "email": company_profile.get("email", ""),
            }
            if company_profile.get("logo_path"):
                contractor["logo_path_OPTIONAL"] = os.path.join(photos_dir, "logo.jpg")

        config = assemble_repair_job(
            job_id=f"RPR-{datetime.now().strftime('%Y%m%d-%H%M%S')}",
            diagnosis_data=final_diag_data,
            photo_map=photo_map,
            submission={
                "submitted_by": repair.get("roofer_name", ""),
                "skill_level": repair.get("skill_level", "journeyman"),
                "preferred_language": repair.get("preferred_language", "en"),
                "leak_location_notes": repair.get("leak_description", ""),
                "photo_count": len(photo_paths_all),
            },
            contractor=contractor,
            property_info={
                "address": repair["address"].split(",")[0].strip(),
                "city": repair["address"].split(",")[1].strip() if "," in repair["address"] else "",
                "state": "",
                "zip": "",
            },
            homeowner={"name": repair.get("homeowner_name", "")},
            custom_pricing=custom_pricing,
        )
        config["job"]["created"] = datetime.now().isoformat()
        config["job"]["preliminary"] = False
        config["checkpoint_history"] = checkpoint_history
        config["diagnosis_evolution"] = diagnosis_evolution

        config_path = os.path.join(work_dir, "repair_job_config.json")
        with open(config_path, "w") as f:
            json.dump(config, f, indent=2)

        generator_path = os.path.join(BACKEND_DIR, "repair_generator.py")
        gen_result = subprocess.run(
            ["python3", generator_path, config_path],
            capture_output=True, text=True, timeout=120, cwd=BACKEND_DIR,
        )
        if gen_result.returncode != 0:
            print(f"[COMPLETION] Generator error: {gen_result.stderr}")
            raise RuntimeError(f"Final PDF generation failed: {gen_result.stderr[:500]}")

        # Upload final PDFs
        output_files = []
        for pdf_file in sorted(os.listdir(output_dir)):
            if pdf_file.endswith(".pdf"):
                local_pdf = os.path.join(output_dir, pdf_file)
                remote_path = f"{file_path}/output/{pdf_file}"
                upload_file(sb, "claim-documents", remote_path, local_pdf)
                output_files.append(pdf_file)
                print(f"[COMPLETION] Uploaded final: {pdf_file}")

        # Update repair to ready
        update_repair_status(sb, repair_id, "ready",
                             output_files=output_files)

        # Notify
        try:
            import urllib.request
            notify_url = "https://www.dumbroof.ai/api/notify-repair-complete"
            notify_payload = json.dumps({"repair_id": repair_id}).encode("utf-8")
            req = urllib.request.Request(notify_url, data=notify_payload,
                                        headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=30) as resp:
                print(f"[COMPLETION] Email notification: {json.loads(resp.read().decode())}")
        except Exception as e:
            print(f"[COMPLETION] Email notification failed (non-fatal): {e}")

        print(f"[COMPLETION] DONE — {repair['address']} — {len(output_files)} final PDFs")
