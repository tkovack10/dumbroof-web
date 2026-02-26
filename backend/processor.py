"""
Claim Processor — Document Analysis + Config Building + PDF Generation
======================================================================
Uses Claude API to read uploaded documents, extract structured data,
build a claim config, generate PDFs, and upload results.
"""

import os
import json
import base64
import tempfile
import subprocess
from datetime import datetime

import anthropic
from supabase import create_client, Client

# ===================================================================
# CLIENTS
# ===================================================================

def get_supabase_client() -> Client:
    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"],
    )

def get_anthropic_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


# ===================================================================
# FILE HELPERS
# ===================================================================

def download_file(sb: Client, bucket: str, path: str, local_path: str):
    """Download a file from Supabase Storage."""
    data = sb.storage.from_(bucket).download(path)
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    with open(local_path, "wb") as f:
        f.write(data)
    return local_path


def upload_file(sb: Client, bucket: str, path: str, local_path: str):
    """Upload a file to Supabase Storage."""
    with open(local_path, "rb") as f:
        sb.storage.from_(bucket).upload(
            path, f.read(),
            file_options={"content-type": "application/pdf", "upsert": "true"}
        )


def file_to_base64(path: str) -> str:
    with open(path, "rb") as f:
        return base64.standard_b64encode(f.read()).decode()


def get_media_type(filename: str) -> str:
    ext = filename.lower().rsplit(".", 1)[-1]
    return {
        "pdf": "application/pdf",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "heic": "image/heic",
    }.get(ext, "application/octet-stream")


# ===================================================================
# CLAUDE API — DOCUMENT ANALYSIS
# ===================================================================

def extract_measurements(client: anthropic.Anthropic, pdf_path: str) -> dict:
    """Send measurement PDF to Claude and extract structured data."""
    pdf_b64 = file_to_base64(pdf_path)

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "document",
                    "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_b64},
                },
                {
                    "type": "text",
                    "text": """Read this roof measurement report (EagleView, HOVER, GAF QuickMeasure, or similar) and extract ALL measurements into this exact JSON format. Return ONLY valid JSON, no other text:

{
  "property": {
    "address": "street address",
    "city": "city",
    "state": "XX",
    "zip": "XXXXX"
  },
  "structures": [{
    "name": "Main Roof",
    "roof_area_sf": 0,
    "roof_area_sq": 0,
    "waste_factor": 1.10,
    "predominant_pitch": "X/12",
    "pitches": [{"pitch": "X/12", "area_sf": 0, "percent": 0}],
    "facets": 0,
    "style": "hip/gable/combination"
  }],
  "measurements": {
    "ridge": 0,
    "hip": 0,
    "valley": 0,
    "rake": 0,
    "eave": 0,
    "drip_edge": 0,
    "flashing": 0,
    "step_flashing": 0
  },
  "penetrations": {
    "pipes": 0,
    "vents": 0,
    "skylights": 0,
    "chimneys": 0
  },
  "stories": 0,
  "total_roof_area_sf": 0,
  "total_roof_area_sq": 0
}

Use 0 for any values not found. Calculate SQ = SF / 100. Include waste_factor if stated (default 1.10 = 10% waste)."""
                }
            ]
        }]
    )
    return _parse_json_response(response.content[0].text)


def analyze_photos(client: anthropic.Anthropic, photo_paths: list[str]) -> dict:
    """Send inspection photos to Claude for forensic analysis."""
    content = []

    # Send up to 20 photos (API limit considerations)
    for path in photo_paths[:20]:
        media_type = get_media_type(path)
        if media_type.startswith("image/"):
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": file_to_base64(path),
                },
            })

    content.append({
        "type": "text",
        "text": """You are a forensic roofing damage analyst. Analyze these inspection photos and provide:

1. A damage summary describing the overall condition
2. Photo-by-photo forensic annotations (clinical, professional language)
3. Key forensic findings
4. Identified trades needed (roofing, gutters, siding, etc.)
5. Shingle type identification (3-tab, architectural/laminated, material)
6. Any code violations visible

Return ONLY valid JSON:
{
  "damage_summary": "Professional summary of damage observed...",
  "photo_annotations": {
    "photo_01": "Clinical forensic observation for photo 1...",
    "photo_02": "Clinical forensic observation for photo 2..."
  },
  "shingle_type": "architectural laminated / 3-tab 25yr / etc",
  "shingle_condition": "description of overall shingle condition",
  "trades_identified": ["roofing", "gutters"],
  "key_findings": [
    "Finding 1: description with forensic detail",
    "Finding 2: description with forensic detail"
  ],
  "code_violations": [
    {"code": "RCNYS R905.2.8.5", "description": "Missing drip edge at rake edges"}
  ],
  "damage_type": "hail / wind / combined",
  "severity": "minor / moderate / severe"
}"""
    })

    response = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=8192,
        messages=[{"role": "user", "content": content}]
    )
    return _parse_json_response(response.content[0].text)


def extract_carrier_scope(client: anthropic.Anthropic, pdf_path: str) -> dict:
    """Extract carrier scope data from insurance estimate PDF."""
    pdf_b64 = file_to_base64(pdf_path)

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=8192,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "document",
                    "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_b64},
                },
                {
                    "type": "text",
                    "text": """Read this insurance carrier scope/estimate and extract ALL data into this exact JSON format. Return ONLY valid JSON:

{
  "carrier": {
    "name": "Insurance Company Name",
    "claim_number": "XXX-XXXX",
    "policy_number": "XXXX",
    "adjuster_name": "Name if found",
    "adjuster_email": "email if found",
    "inspection_date": "Date if found",
    "inspector_company": "FieldAssist/Accurence/etc if found",
    "inspector_name": "Name if found"
  },
  "carrier_rcv": 0.00,
  "carrier_depreciation": 0.00,
  "carrier_acv": 0.00,
  "carrier_deductible": 0.00,
  "carrier_net": 0.00,
  "price_list": "price list name if visible (e.g. NYBI26)",
  "carrier_line_items": [
    {
      "item": "Line item category/code",
      "carrier_desc": "Description from carrier scope",
      "carrier_amount": 0.00,
      "qty": 0,
      "unit": "SF/LF/SQ/EA",
      "unit_price": 0.00
    }
  ],
  "carrier_arguments": [
    "Any findings, notes, or arguments the carrier made about damage or coverage"
  ],
  "carrier_acknowledged_items": [
    "Items the carrier DID include/acknowledge"
  ]
}

Extract every line item. Use 0 for values not found."""
                }
            ]
        }]
    )
    return _parse_json_response(response.content[0].text)


# ===================================================================
# CONFIG BUILDER
# ===================================================================

def build_claim_config(
    claim: dict,
    measurements: dict,
    photo_analysis: dict,
    carrier_data: dict | None,
    photo_filenames: list[str],
) -> dict:
    """Build a complete claim_config.json from extracted data."""
    prop = measurements.get("property", {})
    structs = measurements.get("structures", [{}])
    meas = measurements.get("measurements", {})
    phase = "post-scope" if carrier_data else "pre-scope"

    # Determine trades and O&P
    trades = photo_analysis.get("trades_identified", ["roofing"])
    o_and_p = len(trades) >= 3

    # Determine state for tax rate
    state = prop.get("state", "NY").upper()
    tax_rate = {"NY": 0.08, "PA": 0.0, "NJ": 0.06625}.get(state, 0.08)

    # Build line items based on measurements and analysis
    line_items = build_line_items(measurements, photo_analysis, state)

    # Build photo annotations mapping
    photo_annotations = {}
    photo_sections = []
    annotations = photo_analysis.get("photo_annotations", {})
    photo_entries = []
    for i, (key, annotation) in enumerate(annotations.items()):
        photo_key = f"p{(i // 3 + 3):02d}_{(i % 3 + 1):02d}"
        photo_annotations[photo_key] = annotation
        photo_entries.append([photo_key, i // 3 + 3, i % 3 + 1])

    if photo_entries:
        photo_sections.append({
            "title": "Damage Documentation",
            "photos": photo_entries
        })

    # Photo map — map keys to actual filenames
    photo_map = {}
    for i, filename in enumerate(photo_filenames):
        if get_media_type(filename).startswith("image/"):
            key = f"p{(i // 3 + 3):02d}_{(i % 3 + 1):02d}"
            photo_map[key] = filename

    config = {
        "phase": phase,
        "company": {
            "name": "Dumb Roof Technologies",
            "address": "",
            "city_state_zip": "",
            "ceo_name": "",
            "ceo_title": "",
            "email": "",
            "cell_phone": "",
            "office_phone": "",
            "website": "dumbroof.ai"
        },
        "property": {
            "address": prop.get("address", claim.get("address", "")),
            "city": prop.get("city", ""),
            "state": state,
            "zip": prop.get("zip", ""),
        },
        "insured": {
            "name": "Property Owner",
            "type": "homeowner"
        },
        "carrier": {
            "name": carrier_data["carrier"]["name"] if carrier_data else claim.get("carrier", ""),
            "claim_number": carrier_data["carrier"].get("claim_number", "Pending") if carrier_data else "Pending",
            "policy_number": carrier_data["carrier"].get("policy_number", "") if carrier_data else "",
            "adjuster_email": carrier_data["carrier"].get("adjuster_email", "") if carrier_data else "",
            "carrier_rcv": carrier_data.get("carrier_rcv", 0) if carrier_data else 0,
            "deductible": carrier_data.get("carrier_deductible", 0) if carrier_data else 0,
            "inspector_company": carrier_data["carrier"].get("inspector_company", "") if carrier_data else "",
            "inspector_name": carrier_data["carrier"].get("inspector_name", "") if carrier_data else "",
            "inspection_date": carrier_data["carrier"].get("inspection_date", "") if carrier_data else "",
            "carrier_line_items": carrier_data.get("carrier_line_items", []) if carrier_data else [],
            "carrier_arguments": carrier_data.get("carrier_arguments", []) if carrier_data else [],
        },
        "dates": {
            "date_of_loss": "",
            "usarm_inspection_date": "",
            "report_date": datetime.now().strftime("%B %d, %Y"),
        },
        "inspectors": {
            "usarm_inspector": "Dumb Roof AI Analysis",
            "usarm_title": "Automated Forensic Assessment",
        },
        "scope": {
            "trades": trades,
            "o_and_p": o_and_p,
        },
        "financials": {
            "tax_rate": tax_rate,
            "price_list": carrier_data.get("price_list", "NYBI26") if carrier_data else "NYBI26",
            "deductible": carrier_data.get("carrier_deductible", 0) if carrier_data else 0,
        },
        "structures": structs,
        "weather": {
            "hail_size": "",
            "storm_date": "",
            "storm_description": "",
        },
        "measurements": meas,
        "line_items": line_items,
        "photo_annotations": photo_annotations,
        "photo_map": photo_map,
        "photo_sections": photo_sections,
        "forensic_findings": {
            "damage_summary": photo_analysis.get("damage_summary", ""),
            "code_violations": photo_analysis.get("code_violations", []),
            "key_arguments": photo_analysis.get("key_findings", []),
        },
        "appeal_letter": {
            "demand_items": [],
            "enclosed_documents": [
                "Forensic Causation Report with annotated photography",
                "Xactimate-format estimate at current pricing",
            ],
        },
        "cover_email": {
            "to_email": carrier_data["carrier"].get("adjuster_email", "") if carrier_data else "",
            "summary_paragraphs": [],
        },
    }

    if carrier_data:
        config["appeal_letter"]["enclosed_documents"].extend([
            "Supplement report with line-by-line variance analysis",
            "Formal appeal letter",
        ])

    return config


def build_line_items(measurements: dict, photo_analysis: dict, state: str) -> list:
    """Build Xactimate line items from measurements and analysis."""
    meas = measurements.get("measurements", {})
    structs = measurements.get("structures", [{}])
    struct = structs[0] if structs else {}
    area_sq = struct.get("roof_area_sq", measurements.get("total_roof_area_sq", 0))
    area_sf = struct.get("roof_area_sf", measurements.get("total_roof_area_sf", 0))
    shingle_type = photo_analysis.get("shingle_type", "architectural laminated").lower()
    penetrations = measurements.get("penetrations", {})
    eave = meas.get("eave", 0)

    is_laminated = "laminated" in shingle_type or "architectural" in shingle_type

    items = []

    # ROOFING
    if is_laminated:
        items.append({"category": "ROOFING", "description": "Remove laminated comp shingle roofing", "qty": area_sq, "unit": "SQ", "unit_price": 74.00})
        items.append({"category": "ROOFING", "description": "Laminated comp shingle roofing - w/out felt", "qty": area_sq, "unit": "SQ", "unit_price": 320.00})
    else:
        items.append({"category": "ROOFING", "description": "Remove 3-tab 25yr comp shingle roofing", "qty": area_sq, "unit": "SQ", "unit_price": 73.14})
        items.append({"category": "ROOFING", "description": "3-tab 25yr comp shingle roofing - w/out felt", "qty": area_sq, "unit": "SQ", "unit_price": 312.92})

    # Underlayment
    items.append({"category": "ROOFING", "description": "Synthetic underlayment", "qty": area_sq, "unit": "SQ", "unit_price": 32.00})

    # Ice & water barrier (2 courses at eaves + 1 in valleys)
    valley = meas.get("valley", 0)
    iw_sf = (eave * 6) + (valley * 3)
    if iw_sf > 0:
        items.append({"category": "ROOFING", "description": "Ice & water barrier", "qty": round(iw_sf), "unit": "SF", "unit_price": 2.24})

    # Drip edge
    drip = meas.get("drip_edge", 0) or (meas.get("eave", 0) + meas.get("rake", 0))
    if drip > 0:
        items.append({"category": "ROOFING", "description": "R&R Drip edge - aluminum", "qty": drip, "unit": "LF", "unit_price": 4.25})

    # Starter strip
    if eave > 0:
        items.append({"category": "ROOFING", "description": "R&R Starter strip - asphalt shingle", "qty": eave, "unit": "LF", "unit_price": 3.50})

    # Ridge cap
    ridge = meas.get("ridge", 0)
    if ridge > 0:
        price = 7.49
        desc = "R&R Ridge cap - laminated" if is_laminated else "R&R Ridge cap - 3 tab"
        items.append({"category": "ROOFING", "description": desc, "qty": ridge, "unit": "LF", "unit_price": price})

    # Ridge vent
    if ridge > 0:
        items.append({"category": "ROOFING", "description": "R&R Ridge vent - aluminum", "qty": ridge, "unit": "LF", "unit_price": 8.50})

    # Hip cap
    hip = meas.get("hip", 0)
    if hip > 0:
        items.append({"category": "ROOFING", "description": "R&R Hip cap - laminated", "qty": hip, "unit": "LF", "unit_price": 7.49})

    # Step flashing
    step = meas.get("step_flashing", 0)
    if step > 0:
        items.append({"category": "ROOFING", "description": "R&R Step flashing", "qty": step, "unit": "LF", "unit_price": 8.00})

    # Flashing
    flashing = meas.get("flashing", 0)
    if flashing > 0:
        items.append({"category": "ROOFING", "description": "R&R Counter/apron flashing", "qty": flashing, "unit": "LF", "unit_price": 9.50})

    # Pipe boots
    pipes = penetrations.get("pipes", 0)
    if pipes > 0:
        items.append({"category": "ROOFING", "description": "Pipe boot/jack", "qty": pipes, "unit": "EA", "unit_price": 68.00})

    # Exhaust vents
    vents = penetrations.get("vents", 0)
    if vents > 0:
        items.append({"category": "ROOFING", "description": "R&R Exhaust vent", "qty": vents, "unit": "EA", "unit_price": 125.00})

    # Steep charge (if predominant pitch >= 7/12)
    pitch_str = struct.get("predominant_pitch", "")
    if pitch_str:
        try:
            rise = int(pitch_str.split("/")[0])
            if rise >= 7:
                items.append({"category": "ROOFING", "description": f"Steep charge - {pitch_str} pitch", "qty": area_sq, "unit": "SQ", "unit_price": 85.00})
        except (ValueError, IndexError):
            pass

    # High roof charge (2+ stories)
    stories = measurements.get("stories", 1)
    if stories >= 2:
        items.append({"category": "ROOFING", "description": "High roof charge - 2+ stories", "qty": area_sq, "unit": "SQ", "unit_price": 85.00})

    # DEBRIS
    dumpster_loads = max(1, round(area_sq / 25))
    items.append({"category": "DEBRIS", "description": "Dumpster load - roofing debris", "qty": dumpster_loads, "unit": "EA", "unit_price": 450.00})

    # GUTTERS (if in trades)
    trades = photo_analysis.get("trades_identified", [])
    if "gutters" in [t.lower() for t in trades]:
        gutter_lf = round(eave * 1.6) if eave > 0 else 0
        if gutter_lf > 0:
            items.append({"category": "GUTTERS", "description": "R&R Seamless aluminum gutter & downspout", "qty": gutter_lf, "unit": "LF", "unit_price": 10.50})

    return items


# ===================================================================
# PDF GENERATION
# ===================================================================

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
GENERATOR_PATH = os.path.expanduser("~/USARM-Claims-Platform/usarm_pdf_generator.py")


def generate_pdfs(config: dict, work_dir: str) -> list[str]:
    """Generate PDF package using the USARM PDF generator."""
    # Write config to work directory
    config_path = os.path.join(work_dir, "claim_config.json")
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)

    # Run the generator
    result = subprocess.run(
        ["python3", GENERATOR_PATH, config_path],
        capture_output=True, text=True, cwd=work_dir,
        timeout=120,
    )

    if result.returncode != 0:
        print(f"[GENERATOR] stderr: {result.stderr}")
        raise RuntimeError(f"PDF generator failed: {result.stderr[:500]}")

    # Find generated PDFs
    output_dir = os.path.join(work_dir, "pdf_output")
    if not os.path.exists(output_dir):
        raise RuntimeError("PDF output directory not created")

    pdfs = sorted([
        os.path.join(output_dir, f)
        for f in os.listdir(output_dir)
        if f.endswith(".pdf")
    ])

    if not pdfs:
        raise RuntimeError("No PDFs generated")

    return pdfs


# ===================================================================
# MAIN PROCESSING PIPELINE
# ===================================================================

async def process_claim(claim_id: str):
    """Full claim processing pipeline."""
    sb = get_supabase_client()
    claude = get_anthropic_client()

    # 1. Get claim from database
    result = sb.table("claims").select("*").eq("id", claim_id).single().execute()
    claim = result.data
    if not claim:
        raise ValueError(f"Claim {claim_id} not found")

    print(f"[PROCESS] Starting claim: {claim['address']} ({claim['phase']})")

    # Update status to processing
    sb.table("claims").update({"status": "processing"}).eq("id", claim_id).execute()

    # 2. Create temp work directory
    with tempfile.TemporaryDirectory(prefix="dumbroof_") as work_dir:
        photos_dir = os.path.join(work_dir, "photos")
        source_dir = os.path.join(work_dir, "source_docs")
        output_dir = os.path.join(work_dir, "pdf_output")
        os.makedirs(photos_dir)
        os.makedirs(source_dir)
        os.makedirs(output_dir)

        # Copy USARM logo if available
        logo_src = os.path.expanduser(
            "~/Library/Mobile Documents/com~apple~CloudDocs/logo-version-2-2 2.JPG"
        )
        if os.path.exists(logo_src):
            import shutil
            shutil.copy2(logo_src, os.path.join(photos_dir, "usarm_logo.jpg"))

        file_path = claim["file_path"]  # e.g. "user-id/123-main-st"

        # 3. Download measurement files
        measurement_paths = []
        for fname in claim.get("measurement_files", []):
            local = os.path.join(source_dir, fname)
            download_file(sb, "claim-documents", f"{file_path}/measurements/{fname}", local)
            measurement_paths.append(local)

        # 4. Download photos
        photo_paths = []
        photo_filenames = []
        for fname in claim.get("photo_files", []):
            local = os.path.join(photos_dir, fname)
            download_file(sb, "claim-documents", f"{file_path}/photos/{fname}", local)
            photo_paths.append(local)
            photo_filenames.append(fname)

        # 5. Download carrier scope (if any)
        scope_paths = []
        for fname in claim.get("scope_files", []):
            local = os.path.join(source_dir, fname)
            download_file(sb, "claim-documents", f"{file_path}/scope/{fname}", local)
            scope_paths.append(local)

        # 6. Extract measurements via Claude
        print(f"[PROCESS] Extracting measurements...")
        measurements = {}
        if measurement_paths:
            measurements = extract_measurements(claude, measurement_paths[0])

        # 7. Analyze photos via Claude
        print(f"[PROCESS] Analyzing {len(photo_paths)} photos...")
        photo_analysis = {"trades_identified": ["roofing"], "photo_annotations": {}}
        if photo_paths:
            photo_analysis = analyze_photos(claude, photo_paths)

        # 8. Extract carrier scope (if present)
        carrier_data = None
        if scope_paths:
            print(f"[PROCESS] Extracting carrier scope...")
            carrier_data = extract_carrier_scope(claude, scope_paths[0])

        # 9. Build claim config
        print(f"[PROCESS] Building claim config...")
        config = build_claim_config(
            claim, measurements, photo_analysis, carrier_data, photo_filenames
        )

        # Set paths for the generator
        config["_paths"] = {
            "claim_dir": work_dir,
            "photos": photos_dir,
            "output": output_dir,
            "source_docs": source_dir,
        }

        # 10. Generate PDFs
        print(f"[PROCESS] Generating PDFs...")
        pdfs = generate_pdfs(config, work_dir)
        print(f"[PROCESS] Generated {len(pdfs)} PDFs")

        # 11. Upload PDFs to Supabase Storage
        uploaded_pdfs = []
        for pdf_path in pdfs:
            pdf_name = os.path.basename(pdf_path)
            storage_path = f"{file_path}/output/{pdf_name}"
            upload_file(sb, "claim-documents", storage_path, pdf_path)
            uploaded_pdfs.append(pdf_name)
            print(f"[PROCESS] Uploaded: {pdf_name}")

        # 12. Update claim status to ready
        sb.table("claims").update({
            "status": "ready",
            "output_files": uploaded_pdfs,
        }).eq("id", claim_id).execute()

        print(f"[PROCESS] Claim complete: {claim['address']} — {len(pdfs)} PDFs ready")


# ===================================================================
# HELPERS
# ===================================================================

def _parse_json_response(text: str) -> dict:
    """Parse JSON from Claude's response, handling markdown code blocks."""
    text = text.strip()
    if text.startswith("```"):
        # Remove markdown code block
        lines = text.split("\n")
        lines = lines[1:]  # Remove opening ```json
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]  # Remove closing ```
        text = "\n".join(lines)
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        print(f"[WARN] Failed to parse JSON: {e}")
        print(f"[WARN] Raw response: {text[:500]}")
        return {}
