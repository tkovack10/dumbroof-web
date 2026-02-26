"""
Claim Processor — Document Analysis + Config Building + PDF Generation
======================================================================
Uses Claude API to read uploaded documents, extract structured data,
build a claim config, generate PDFs, and upload results.
"""

from __future__ import annotations

import os
import json
import base64
import tempfile
import subprocess
from datetime import datetime
from typing import Optional, List, Dict

import time

import anthropic
from supabase import create_client, Client


def _call_claude_with_retry(client, max_retries=3, **kwargs):
    """Call Claude API with retry on rate limits."""
    for attempt in range(max_retries):
        try:
            return client.messages.create(**kwargs)
        except anthropic.RateLimitError as e:
            if attempt < max_retries - 1:
                wait = 60 * (attempt + 1)
                print(f"[RATE LIMIT] Waiting {wait}s before retry {attempt + 2}/{max_retries}...")
                time.sleep(wait)
            else:
                raise e

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


def extract_images_from_pdf(pdf_path: str, output_dir: str) -> list[str]:
    """Extract images from a PDF file using pdfimages (poppler) or PyMuPDF fallback.

    Returns list of extracted image file paths.
    """
    extracted = []
    basename = os.path.splitext(os.path.basename(pdf_path))[0]
    prefix = os.path.join(output_dir, f"{basename}_")

    # Try pdfimages first (fast, high quality)
    try:
        subprocess.run(
            ["pdfimages", "-j", pdf_path, prefix],
            capture_output=True, timeout=30
        )
        # pdfimages outputs files like prefix-000.jpg, prefix-001.jpg, etc.
        import glob
        for img_path in sorted(glob.glob(f"{prefix}*.jpg") + glob.glob(f"{prefix}*.ppm") + glob.glob(f"{prefix}*.png")):
            # Convert PPM to JPEG if needed
            if img_path.endswith(".ppm"):
                jpg_path = img_path.rsplit(".", 1)[0] + ".jpg"
                try:
                    subprocess.run(
                        ["sips", "-s", "format", "jpeg", img_path, "--out", jpg_path],
                        capture_output=True, timeout=15
                    )
                    if os.path.exists(jpg_path) and os.path.getsize(jpg_path) > 0:
                        os.remove(img_path)
                        img_path = jpg_path
                except Exception:
                    pass
            # Skip small images (icons, logos, UI elements) — real photos are 30KB+
            if os.path.getsize(img_path) > 30000:
                extracted.append(img_path)

        if extracted:
            print(f"[PHOTOS] Extracted {len(extracted)} images from PDF via pdfimages: {os.path.basename(pdf_path)}")
            return extracted
    except FileNotFoundError:
        pass  # pdfimages not installed, try PyMuPDF
    except Exception as e:
        print(f"[PHOTOS] pdfimages failed: {e}")

    # Fallback: PyMuPDF (fitz)
    try:
        import fitz
        doc = fitz.open(pdf_path)
        img_idx = 0
        skipped = 0
        seen_xrefs = set()  # Deduplicate — logos/headers repeat on every page

        for page_num in range(len(doc)):
            page = doc[page_num]
            for img in page.get_images(full=True):
                xref = img[0]

                # Skip duplicates (same image embedded on multiple pages = logo/header)
                if xref in seen_xrefs:
                    continue
                seen_xrefs.add(xref)

                pix = fitz.Pixmap(doc, xref)
                if pix.n >= 5:  # CMYK — convert to RGB
                    pix = fitz.Pixmap(fitz.csRGB, pix)

                # Skip small images (icons, UI elements) — real photos are 400x300+
                if pix.width < 400 or pix.height < 300:
                    pix = None
                    skipped += 1
                    continue

                # Skip extreme aspect ratios (banners/headers) — real photos are between 1:3 and 3:1
                aspect = max(pix.width, pix.height) / max(min(pix.width, pix.height), 1)
                if aspect > 3.0:
                    pix = None
                    skipped += 1
                    continue

                img_path = f"{prefix}p{page_num:02d}_{img_idx:03d}.jpg"
                pix.save(img_path)
                pix = None

                # Also skip by file size — real inspection photos are 50KB+ even compressed
                if os.path.getsize(img_path) < 50000:
                    os.remove(img_path)
                    skipped += 1
                else:
                    extracted.append(img_path)
                img_idx += 1
        doc.close()
        if skipped:
            print(f"[PHOTOS] Skipped {skipped} non-photo images (logos, icons, headers)")
        if extracted:
            print(f"[PHOTOS] Extracted {len(extracted)} inspection photos from PDF via PyMuPDF: {os.path.basename(pdf_path)}")
    except Exception as e:
        print(f"[PHOTOS] PyMuPDF extraction failed: {e}")

    return extracted


def resize_photo(path: str, max_dim: int = 1024) -> str:
    """Resize a photo to max_dim on longest side using sips. Returns path to resized copy."""
    ext = path.lower().rsplit(".", 1)[-1]
    if ext not in ("jpg", "jpeg", "png"):
        return path

    size = os.path.getsize(path)
    # Skip if already small (under 500KB)
    if size < 500_000:
        return path

    resized = path + ".resized.jpg"
    try:
        subprocess.run(
            ["sips", "-Z", str(max_dim), "--setProperty", "formatOptions", "60", path, "--out", resized],
            capture_output=True, timeout=15
        )
        if os.path.exists(resized) and os.path.getsize(resized) > 0:
            return resized
    except Exception:
        pass
    return path


# ===================================================================
# CLAUDE API — DOCUMENT ANALYSIS
# ===================================================================

def extract_measurements(client: anthropic.Anthropic, pdf_path: str) -> dict:
    """Send measurement PDF to Claude and extract structured data."""
    pdf_b64 = file_to_base64(pdf_path)

    response = _call_claude_with_retry(client,
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


def analyze_photos(client: anthropic.Anthropic, photo_paths: list[str], user_notes: Optional[str] = None) -> dict:
    """Send inspection photos to Claude for forensic analysis, in batches."""
    BATCH_SIZE = 5  # 5 resized photos per batch to stay well under API limits

    # Filter to image files and resize
    image_paths = []
    for path in photo_paths[:20]:
        media_type = get_media_type(path)
        if media_type.startswith("image/"):
            resized = resize_photo(path)
            image_paths.append(resized)
            sz = os.path.getsize(resized) / 1024
            print(f"[PHOTO] {os.path.basename(path)} -> {sz:.0f}KB")

    print(f"[PHOTOS] {len(image_paths)} images ready, processing in batches of {BATCH_SIZE}")

    # Process in batches, merge results
    all_annotations = {}
    all_findings = []
    all_violations = []
    trades_set = set()
    damage_summary_parts = []
    shingle_type = ""
    shingle_condition = ""
    damage_type = ""
    severity = ""
    chalk_test_results = []
    test_square_results = []

    for batch_idx in range(0, len(image_paths), BATCH_SIZE):
        batch = image_paths[batch_idx:batch_idx + BATCH_SIZE]
        batch_num = batch_idx // BATCH_SIZE + 1
        total_batches = (len(image_paths) + BATCH_SIZE - 1) // BATCH_SIZE
        start_num = batch_idx + 1

        print(f"[PHOTOS] Batch {batch_num}/{total_batches} ({len(batch)} photos)")

        content = []
        for path in batch:
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": file_to_base64(path),
                },
            })

        notes_ctx = ""
        if batch_idx == 0 and user_notes:
            notes_ctx = f"\n\nCONTEXT FROM CONTRACTOR: {user_notes}\nUse this context to inform your analysis — identify specific materials mentioned, note any adjuster claims to address, and focus on items the contractor highlighted.\n"

        content.append({
            "type": "text",
            "text": f"""You are a forensic storm damage analyst for insurance claims. Your goal is to document ALL hail and wind damage to support full claim approval. These are photos {start_num}-{start_num + len(batch) - 1} from a property inspection.{notes_ctx}

CRITICAL — CHALK TESTING (you MUST understand this):
Inspectors use chalk testing to document hail damage. This is standard industry practice, NOT sealant, paint, caulk, or repair material.

ON FLAT SOFT METALS (gutters, flashing, pipe collars, vents, standing seam, power fan covers):
- Inspector runs chalk SIDEWAYS (flat, wide edge) across the metal surface
- A surface WITHOUT hail damage shows one solid continuous chalk line
- A surface WITH hail damage shows CIRCULAR GAPS in the chalk line — the gaps are hail impact dents/indentations where chalk cannot reach because the metal is pushed inward
- The circular unmarked areas within the chalk line = CONFIRMED HAIL IMPACTS
- More gaps = more hail hits = more severe damage

ON SHINGLES (test square methodology):
- Inspector draws a chalk circle or box on the shingle to mark a test square
- Chalk letters indicate slope: F=Front, R=Right, L=Left, B/R=Back/Rear
- "H = 10" means 10 hail hits counted in that test square
- "W = 4" means 4 wind-damaged shingles in that test square
- A chalk LINE across a shingle = wind crease mark (functional wind damage requiring replacement)
- Individual chalk circles on shingles = marked hail impact points

WIND DAMAGE INDICATORS:
- Creased shingles (chalk line across crease) = functional wind damage, shingle must be replaced
- Missing shingles with exposed nails underneath: if nail shows NO rust = RECENT storm damage (not old)
- Lifted/bent shingle tabs or edges

HAIL DAMAGE INDICATORS:
- Hail splatter (oxidation marks from hail impact) = confirms RECENT damage (splatter fades within ~6 months)
- Circular dents on metals (shown by chalk test gaps)
- Granule displacement on shingles exposing dark asphalt mat
- Fractured/cracked shingle mat (per HAAG standard = functional damage requiring full replacement)
- Soft metal deformation (gutters, vents, flashing)

IMPORTANT FRAMING:
- Focus on STORM-RELATED damages (hail and wind) — this is what gets claims approved
- Any pre-existing deterioration, brittleness, or aging makes the roof MORE vulnerable to storm damage and LESS repairable — use this to argue for FULL REPLACEMENT rather than spot repair
- Frame worn/brittle materials as: "Pre-existing condition renders the roofing system non-repairable following storm impact — spot repair is not feasible on aged/brittle materials"
- NEVER dismiss damage as "just wear and tear" — connect it to why storm damage requires full replacement

Number the photos starting at {start_num}. Return ONLY valid JSON:
{{
  "damage_summary": "Professional summary focusing on storm damage and why full replacement is required...",
  "photo_annotations": {{
    "photo_{start_num:02d}": "Forensic observation focusing on storm damage evidence...",
    "photo_{start_num + 1:02d}": "Forensic observation..."
  }},
  "shingle_type": "natural slate / architectural laminated / 3-tab 25yr / standing seam metal / etc",
  "shingle_condition": "description focusing on storm vulnerability and non-repairability",
  "trades_identified": ["roofing", "gutters", "flashing"],
  "key_findings": [
    "Finding 1: storm damage evidence with forensic detail"
  ],
  "code_violations": [
    {{"code": "RCNYS R905.2.8.5", "description": "Missing drip edge at rake edges"}}
  ],
  "damage_type": "hail / wind / combined",
  "severity": "minor / moderate / severe",
  "chalk_test_results": {{
    "observed": true,
    "details": "Chalk testing on [component] reveals [N] circular gaps indicating hail impact dents"
  }},
  "test_square_results": [
    {{"slope": "F", "hail_hits": 10, "wind_damage": 0, "notes": "Front slope test square"}}
  ]
}}"""
        })

        response = _call_claude_with_retry(client,
            model="claude-sonnet-4-6",
            max_tokens=4096,
            messages=[{"role": "user", "content": content}]
        )
        batch_result = _parse_json_response(response.content[0].text)

        # Merge batch results
        all_annotations.update(batch_result.get("photo_annotations", {}))
        all_findings.extend(batch_result.get("key_findings", []))
        all_violations.extend(batch_result.get("code_violations", []))
        trades_set.update(batch_result.get("trades_identified", []))
        if batch_result.get("damage_summary"):
            damage_summary_parts.append(batch_result["damage_summary"])
        if batch_result.get("shingle_type"):
            shingle_type = batch_result["shingle_type"]
        if batch_result.get("shingle_condition"):
            shingle_condition = batch_result["shingle_condition"]
        if batch_result.get("damage_type"):
            damage_type = batch_result["damage_type"]
        if batch_result.get("severity"):
            severity = batch_result["severity"]
        if batch_result.get("chalk_test_results"):
            chalk_test_results.append(batch_result["chalk_test_results"])
        if batch_result.get("test_square_results"):
            test_square_results.extend(batch_result["test_square_results"])

    # Clean up resized temp files
    for path in image_paths:
        if path.endswith(".resized.jpg"):
            try:
                os.remove(path)
            except OSError:
                pass

    return {
        "damage_summary": " ".join(damage_summary_parts),
        "photo_annotations": all_annotations,
        "shingle_type": shingle_type,
        "shingle_condition": shingle_condition,
        "trades_identified": sorted(trades_set),
        "key_findings": all_findings,
        "code_violations": all_violations,
        "damage_type": damage_type,
        "severity": severity,
        "photo_count": len(image_paths),
        "chalk_test_results": chalk_test_results,
        "test_square_results": test_square_results,
    }


def analyze_photo_integrity(client: anthropic.Anthropic, photo_paths: list[str]) -> dict:
    """Analyze photos for signs of staging, manipulation, or man-made damage.

    Returns a photo integrity report that gets stamped onto generated PDFs.
    This is DumbRoof.AI proprietary IP — fraud detection at the inspection level.
    """
    # Sample up to 10 photos for integrity check (cost-efficient)
    sample_paths = []
    for path in photo_paths[:10]:
        if get_media_type(path).startswith("image/"):
            resized = resize_photo(path)
            sample_paths.append(resized)

    if not sample_paths:
        return {"total": 0, "flagged": 0, "score": "N/A", "findings": []}

    content = []
    for path in sample_paths:
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": file_to_base64(path),
            },
        })

    content.append({
        "type": "text",
        "text": f"""You are a forensic photo integrity analyst for insurance claims. Examine these {len(sample_paths)} inspection photos for signs of fraud.

CRITICAL — UNDERSTAND CHALK TESTING (this is NOT fraud):
Roofing inspectors use chalk as a standard diagnostic tool. You MUST recognize these as legitimate inspection techniques:

ON METALS (gutters, flashing, vents, pipe collars, standing seam): Inspector runs chalk SIDEWAYS across the surface. Circular GAPS in the chalk line = hail impact dents where chalk cannot reach the indented metal. This is standard hail damage documentation — NOT sealant, paint, caulk, graffiti, or vandalism.

ON SHINGLES: Chalk circles/boxes mark test squares. Letters (F/R/L/B) indicate slope direction. Numbers (H=10) count hail hits. Lines across shingles mark wind creases. This is standard inspection methodology.

Chalk marks, test square notations, and circled damage areas are LEGITIMATE INSPECTION TOOLS and must ALWAYS pass integrity checks.

Only FLAG photos for genuine fraud indicators:
1. STAGED DAMAGE — tool marks creating artificial dents, BB gun impacts, intentional gouging with sharp instruments
2. PHOTO MANIPULATION — digital editing, Photoshop artifacts, cloned regions, impossible lighting/shadows
3. MISREPRESENTATION — photos clearly from a different property, recycled/stock photos

For each photo, assign: PASS (authentic) or FLAG (fraud concern).

Return ONLY valid JSON:
{{
  "photo_results": [
    {{"photo": 1, "status": "PASS", "notes": "Chalk testing on metal surface showing hail impact documentation — standard inspection technique"}},
    {{"photo": 2, "status": "PASS", "notes": "Test square with hail hit count — legitimate damage assessment"}}
  ],
  "flagged_count": 0,
  "summary": "All photos show authentic inspection techniques and storm damage documentation with no fraud indicators."
}}

Be VERY conservative — chalk marks and test square notations are NEVER fraud. Only flag clear, unambiguous manipulation or staging.""",
    })

    response = _call_claude_with_retry(client,
        model="claude-sonnet-4-6",
        max_tokens=2048,
        messages=[{"role": "user", "content": content}]
    )
    result = _parse_json_response(response.content[0].text)

    flagged = result.get("flagged_count", 0)
    total = len(sample_paths)
    score = "100%" if flagged == 0 else f"{round((total - flagged) / total * 100)}%"

    # Clean up resized temps
    for path in sample_paths:
        if path.endswith(".resized.jpg"):
            try:
                os.remove(path)
            except OSError:
                pass

    return {
        "total": total,
        "flagged": flagged,
        "score": score,
        "summary": result.get("summary", ""),
        "findings": result.get("photo_results", []),
    }


def extract_carrier_scope(client: anthropic.Anthropic, pdf_path: str) -> dict:
    """Extract carrier scope data from insurance estimate PDF."""
    pdf_b64 = file_to_base64(pdf_path)

    response = _call_claude_with_retry(client,
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

def extract_weather_data(client: anthropic.Anthropic, file_path: str) -> dict:
    """Extract weather/storm data from HailTrace, NOAA, or similar report."""
    media_type = get_media_type(file_path)
    file_b64 = file_to_base64(file_path)

    content = []
    if media_type == "application/pdf":
        content.append({
            "type": "document",
            "source": {"type": "base64", "media_type": media_type, "data": file_b64},
        })
    else:
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": file_b64},
        })

    content.append({
        "type": "text",
        "text": """Read this weather/storm report (HailTrace, NOAA, or similar) and extract data into this JSON format. Return ONLY valid JSON:

{
  "hail_size": "diameter in inches (e.g. 1.75)",
  "storm_date": "date of storm event",
  "storm_description": "brief description of the storm event",
  "nws_reports": ["any NWS storm reports referenced"],
  "wind_speed": "max wind speed if available",
  "source": "HailTrace / NOAA / other"
}

Use empty strings for values not found."""
    })

    response = _call_claude_with_retry(client,
        model="claude-sonnet-4-6",
        max_tokens=2048,
        messages=[{"role": "user", "content": content}]
    )
    return _parse_json_response(response.content[0].text)


def build_claim_config(
    claim: dict,
    measurements: dict,
    photo_analysis: dict,
    carrier_data: Optional[dict],
    photo_filenames: list,
    weather_data: Optional[dict] = None,
    company_profile: Optional[dict] = None,
    user_notes: Optional[str] = None,
    photo_integrity: Optional[dict] = None,
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
    line_items = build_line_items(measurements, photo_analysis, state, user_notes=user_notes or "")

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
            "name": (company_profile or {}).get("company_name", ""),
            "address": (company_profile or {}).get("address", ""),
            "city_state_zip": (company_profile or {}).get("city_state_zip", ""),
            "ceo_name": (company_profile or {}).get("contact_name", ""),
            "ceo_title": (company_profile or {}).get("contact_title", ""),
            "email": (company_profile or {}).get("email", ""),
            "cell_phone": (company_profile or {}).get("phone", ""),
            "office_phone": "",
            "website": (company_profile or {}).get("website", ""),
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
            "hail_size": (weather_data or {}).get("hail_size", ""),
            "storm_date": (weather_data or {}).get("storm_date", ""),
            "storm_description": (weather_data or {}).get("storm_description", ""),
        },
        "measurements": meas,
        "line_items": line_items,
        "photo_annotations": photo_annotations,
        "photo_map": photo_map,
        "photo_sections": photo_sections,
        "forensic_findings": {
            "damage_summary": photo_analysis.get("damage_summary", ""),
            "code_violations": [
                {
                    "code": cv.get("code", ""),
                    "requirement": cv.get("requirement", cv.get("description", "")),
                    "status": cv.get("status", "Non-compliant — requires correction"),
                }
                for cv in photo_analysis.get("code_violations", [])
            ],
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

    # Photo integrity stamp
    if photo_integrity and photo_integrity.get("total", 0) > 0:
        config["photo_integrity"] = {
            "total_analyzed": photo_integrity["total"],
            "flagged": photo_integrity["flagged"],
            "score": photo_integrity["score"],
            "summary": photo_integrity.get("summary", ""),
            "stamp": f"PHOTO INTEGRITY VERIFIED — {photo_integrity['score']} | {photo_integrity['total']} photos analyzed, {photo_integrity['flagged']} flagged for manipulation indicators | DumbRoof.AI Fraud Detection Engine",
        }

    # User-provided notes (context from upload form)
    if user_notes:
        config["user_notes"] = user_notes

    return config


def _detect_roof_material(photo_analysis: dict, user_notes: str = "") -> str:
    """Detect roofing material type from photo analysis and user notes.

    Returns one of: 'slate', 'tile', 'metal_standing_seam', 'copper',
    'laminated', '3tab', or defaults to 'laminated'.
    """
    combined = " ".join([
        user_notes or "",
        photo_analysis.get("shingle_type", ""),
        photo_analysis.get("damage_summary", ""),
    ]).lower()

    if "slate" in combined:
        return "slate"
    if "tile" in combined or "clay" in combined or "concrete tile" in combined:
        return "tile"
    if "standing seam" in combined:
        return "metal_standing_seam"
    if "copper" in combined and "roof" in combined and "gutter" not in combined:
        return "copper"
    if "metal" in combined and "roof" in combined:
        return "metal_standing_seam"

    shingle_type = photo_analysis.get("shingle_type", "architectural laminated").lower()
    if "laminated" in shingle_type or "architectural" in shingle_type:
        return "laminated"
    return "3tab"


def _estimate_linear_measurements(area_sf: float, facets: int, style: str = "combination") -> dict:
    """Estimate linear measurements from roof area when EagleView data is incomplete.

    Uses industry rules of thumb for residential roofs:
    - Perimeter ≈ 4 × √(area_sf)
    - Eave ≈ 40% of perimeter
    - Rake ≈ 30% of perimeter
    - Ridge ≈ 50% of eave
    - Valley count scales with facet count
    - Hip depends on roof style
    """
    import math
    if area_sf <= 0:
        return {}

    perimeter = 4 * math.sqrt(area_sf)
    eave = round(perimeter * 0.40)
    rake = round(perimeter * 0.30)
    ridge = round(eave * 0.50)

    # Valley estimation: complex roofs (many facets) have more valleys
    valley_count = max(0, (facets - 4) // 3)  # ~1 valley per 3 facets beyond 4
    valley = round(valley_count * 12)  # Average valley length ~12 LF

    # Hip estimation
    hip = 0
    if style in ("hip", "combination"):
        hip = round(eave * 0.30)

    # Step flashing: estimate ~20 LF per chimney/wall intersection
    step_flashing = round(facets * 1.5)  # More facets = more wall intersections

    # General flashing
    flashing = round(facets * 2.0)

    return {
        "eave": eave, "rake": rake, "ridge": ridge,
        "valley": valley, "hip": hip,
        "step_flashing": step_flashing, "flashing": flashing,
        "drip_edge": eave + rake,
        "_estimated": True,
    }


def build_line_items(measurements: dict, photo_analysis: dict, state: str, user_notes: str = "") -> list:
    """Build Xactimate line items from measurements, analysis, and user context."""
    meas = measurements.get("measurements", {})
    structs = measurements.get("structures", [{}])
    struct = structs[0] if structs else {}
    area_sq = struct.get("roof_area_sq", measurements.get("total_roof_area_sq", 0))
    area_sf = struct.get("roof_area_sf", measurements.get("total_roof_area_sf", 0))
    penetrations = measurements.get("penetrations", {})
    facets = struct.get("facets", 0)
    style = struct.get("style", "combination")

    material = _detect_roof_material(photo_analysis, user_notes)

    # Pitch correction: pre-pitch EagleView reports give 2D (flat) area at 0/12.
    # Apply pitch factor to get true area. Slate/tile roofs are typically 8/12+.
    pitch_str = struct.get("predominant_pitch", "")
    if pitch_str in ("0/12", "0", ""):
        import math
        if material in ("slate", "tile"):
            default_rise = 8  # Slate/tile is typically steep
        else:
            default_rise = 6  # Standard residential
        pitch_factor = math.sqrt(1 + (default_rise / 12) ** 2)
        area_sf = round(area_sf * pitch_factor)
        area_sq = round(area_sf / 100, 2)
        pitch_str = f"{default_rise}/12"
        print(f"[LINE ITEMS] Pre-pitch report — applied {pitch_str} factor ({pitch_factor:.3f}x) → {area_sf} SF ({area_sq} SQ)")

    # If linear measurements are all zero but we have area, estimate them
    eave = meas.get("eave", 0)
    valley = meas.get("valley", 0)
    ridge = meas.get("ridge", 0)
    hip = meas.get("hip", 0)
    rake = meas.get("rake", 0)

    if area_sf > 0 and eave == 0 and ridge == 0:
        print(f"[LINE ITEMS] No linear measurements — estimating from {area_sf:.0f} SF roof area, {facets} facets")
        est = _estimate_linear_measurements(area_sf, facets, style)
        eave = est.get("eave", 0)
        rake = est.get("rake", 0)
        ridge = est.get("ridge", 0)
        valley = est.get("valley", 0)
        hip = est.get("hip", 0)
        meas = {**meas, **est}
    notes_lower = (user_notes or "").lower()

    items = []

    # ===================== PRIMARY ROOFING MATERIAL =====================
    if material == "slate":
        items.append({"category": "ROOFING", "description": "Remove slate roofing", "qty": area_sq, "unit": "SQ", "unit_price": 325.00})
        items.append({"category": "ROOFING", "description": "Slate roofing - high grade natural", "qty": area_sq, "unit": "SQ", "unit_price": 1850.00})
        items.append({"category": "ROOFING", "description": "Underlayment - felt 30#", "qty": area_sq, "unit": "SQ", "unit_price": 22.00})
        items.append({"category": "ROOFING", "description": "Copper nails & hooks for slate", "qty": area_sq, "unit": "SQ", "unit_price": 45.00})
        items.append({"category": "ROOFING", "description": "Slate roofing - additional labor (specialist)", "qty": area_sq, "unit": "SQ", "unit_price": 350.00})
    elif material == "tile":
        items.append({"category": "ROOFING", "description": "Remove concrete/clay tile roofing", "qty": area_sq, "unit": "SQ", "unit_price": 200.00})
        items.append({"category": "ROOFING", "description": "Concrete/clay tile roofing", "qty": area_sq, "unit": "SQ", "unit_price": 900.00})
        items.append({"category": "ROOFING", "description": "Underlayment - felt 30#", "qty": area_sq, "unit": "SQ", "unit_price": 22.00})
    elif material == "metal_standing_seam":
        items.append({"category": "ROOFING", "description": "Remove metal roofing - standing seam", "qty": area_sq, "unit": "SQ", "unit_price": 150.00})
        items.append({"category": "ROOFING", "description": "Metal roofing - standing seam", "qty": area_sq, "unit": "SQ", "unit_price": 850.00})
        items.append({"category": "ROOFING", "description": "Synthetic underlayment", "qty": area_sq, "unit": "SQ", "unit_price": 32.00})
    elif material == "laminated":
        items.append({"category": "ROOFING", "description": "Remove laminated comp shingle roofing", "qty": area_sq, "unit": "SQ", "unit_price": 74.00})
        items.append({"category": "ROOFING", "description": "Laminated comp shingle roofing - w/out felt", "qty": area_sq, "unit": "SQ", "unit_price": 320.00})
        items.append({"category": "ROOFING", "description": "Synthetic underlayment", "qty": area_sq, "unit": "SQ", "unit_price": 32.00})
    else:  # 3tab
        items.append({"category": "ROOFING", "description": "Remove 3-tab 25yr comp shingle roofing", "qty": area_sq, "unit": "SQ", "unit_price": 73.14})
        items.append({"category": "ROOFING", "description": "3-tab 25yr comp shingle roofing - w/out felt", "qty": area_sq, "unit": "SQ", "unit_price": 312.92})
        items.append({"category": "ROOFING", "description": "Synthetic underlayment", "qty": area_sq, "unit": "SQ", "unit_price": 32.00})

    # ===================== ICE & WATER BARRIER =====================
    iw_sf = (eave * 6) + (valley * 3)
    if iw_sf > 0:
        items.append({"category": "ROOFING", "description": "Ice & water barrier", "qty": round(iw_sf), "unit": "SF", "unit_price": 2.24})

    # ===================== DRIP EDGE =====================
    drip = meas.get("drip_edge", 0) or (eave + rake)
    if drip > 0:
        if material in ("copper", "slate") and "copper" in notes_lower:
            items.append({"category": "ROOFING", "description": "R&R Drip edge - copper", "qty": drip, "unit": "LF", "unit_price": 18.50})
        else:
            items.append({"category": "ROOFING", "description": "R&R Drip edge - aluminum", "qty": drip, "unit": "LF", "unit_price": 4.25})

    # ===================== STARTER STRIP (comp shingle only) =====================
    if material in ("laminated", "3tab") and eave > 0:
        items.append({"category": "ROOFING", "description": "R&R Starter strip - asphalt shingle", "qty": eave, "unit": "LF", "unit_price": 3.50})

    # ===================== RIDGE CAP =====================
    if ridge > 0:
        if material == "slate":
            items.append({"category": "ROOFING", "description": "R&R Ridge cap - slate", "qty": ridge, "unit": "LF", "unit_price": 38.00})
        elif material == "tile":
            items.append({"category": "ROOFING", "description": "R&R Ridge cap - tile", "qty": ridge, "unit": "LF", "unit_price": 28.00})
        elif material == "metal_standing_seam":
            items.append({"category": "ROOFING", "description": "R&R Ridge cap - metal", "qty": ridge, "unit": "LF", "unit_price": 22.00})
        else:
            desc = "R&R Ridge cap - laminated" if material == "laminated" else "R&R Ridge cap - 3 tab"
            items.append({"category": "ROOFING", "description": desc, "qty": ridge, "unit": "LF", "unit_price": 7.49})

    # ===================== RIDGE VENT =====================
    if ridge > 0 and material not in ("slate", "tile"):
        items.append({"category": "ROOFING", "description": "R&R Ridge vent - aluminum", "qty": ridge, "unit": "LF", "unit_price": 8.50})

    # ===================== HIP CAP =====================
    if hip > 0:
        if material == "slate":
            items.append({"category": "ROOFING", "description": "R&R Hip cap - slate", "qty": hip, "unit": "LF", "unit_price": 38.00})
        elif material == "tile":
            items.append({"category": "ROOFING", "description": "R&R Hip cap - tile", "qty": hip, "unit": "LF", "unit_price": 28.00})
        else:
            items.append({"category": "ROOFING", "description": "R&R Hip cap - laminated", "qty": hip, "unit": "LF", "unit_price": 7.49})

    # ===================== FLASHING =====================
    step = meas.get("step_flashing", 0)
    flashing = meas.get("flashing", 0)
    is_copper_flashing = "copper" in notes_lower and "flash" in notes_lower

    if step > 0:
        if is_copper_flashing:
            items.append({"category": "ROOFING", "description": "R&R Step flashing - copper", "qty": step, "unit": "LF", "unit_price": 22.00})
        else:
            items.append({"category": "ROOFING", "description": "R&R Step flashing", "qty": step, "unit": "LF", "unit_price": 8.00})

    if flashing > 0:
        if is_copper_flashing:
            items.append({"category": "ROOFING", "description": "R&R Counter/apron flashing - copper", "qty": flashing, "unit": "LF", "unit_price": 28.00})
        else:
            items.append({"category": "ROOFING", "description": "R&R Counter/apron flashing", "qty": flashing, "unit": "LF", "unit_price": 9.50})

    # ===================== PENETRATIONS =====================
    pipes = penetrations.get("pipes", 0)
    if pipes > 0:
        items.append({"category": "ROOFING", "description": "Pipe boot/jack", "qty": pipes, "unit": "EA", "unit_price": 68.00})

    vents = penetrations.get("vents", 0)
    if vents > 0:
        items.append({"category": "ROOFING", "description": "R&R Exhaust vent", "qty": vents, "unit": "EA", "unit_price": 125.00})

    # ===================== STEEP / HIGH CHARGES =====================
    # Use the corrected pitch_str (may have been updated from 0/12 to estimated pitch)
    if pitch_str:
        try:
            rise = int(pitch_str.split("/")[0])
            if rise >= 7:
                items.append({"category": "ROOFING", "description": f"Steep charge - {pitch_str} pitch", "qty": area_sq, "unit": "SQ", "unit_price": 85.00})
        except (ValueError, IndexError):
            pass

    stories = measurements.get("stories", 1)
    if stories >= 2:
        items.append({"category": "ROOFING", "description": "High roof charge - 2+ stories", "qty": area_sq, "unit": "SQ", "unit_price": 85.00})

    # ===================== DEBRIS =====================
    dumpster_loads = max(1, round(area_sq / 25))
    items.append({"category": "DEBRIS", "description": "Dumpster load - roofing debris", "qty": dumpster_loads, "unit": "EA", "unit_price": 450.00})

    # ===================== COPPER COMPONENTS (from user notes) =====================
    if "copper" in notes_lower:
        # Copper half round gutters
        if "half round" in notes_lower or ("copper" in notes_lower and "gutter" in notes_lower):
            gutter_lf = round(eave * 1.6) if eave > 0 else 0
            if gutter_lf > 0:
                items.append({"category": "GUTTERS", "description": "R&R Copper half round gutter & downspout", "qty": gutter_lf, "unit": "LF", "unit_price": 55.00})

        # Flat panel copper (lower slopes)
        if "flat panel copper" in notes_lower or "flat seam copper" in notes_lower:
            # Estimate lower slope area as ~20% of total roof area if not specified
            copper_sf = round(area_sf * 0.20)
            if copper_sf > 0:
                items.append({"category": "ROOFING", "description": "R&R Flat seam copper roofing", "qty": copper_sf, "unit": "SF", "unit_price": 28.00})

    # ===================== GUTTERS (standard — if in trades and not already added) =====================
    trades = photo_analysis.get("trades_identified", [])
    has_gutter_line = any("gutter" in item["description"].lower() for item in items)
    if "gutters" in [t.lower() for t in trades] and not has_gutter_line:
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

    # 1b. Get user's company profile for white-label branding
    company_profile = None
    try:
        profile_result = sb.table("company_profiles").select("*").eq("user_id", claim["user_id"]).single().execute()
        company_profile = profile_result.data
        if company_profile:
            print(f"[PROCESS] Using company branding: {company_profile.get('company_name', 'N/A')}")
    except Exception:
        pass  # No profile set — use defaults

    # 2. Create temp work directory
    with tempfile.TemporaryDirectory(prefix="dumbroof_") as work_dir:
        photos_dir = os.path.join(work_dir, "photos")
        source_dir = os.path.join(work_dir, "source_docs")
        output_dir = os.path.join(work_dir, "pdf_output")
        os.makedirs(photos_dir)
        os.makedirs(source_dir)
        os.makedirs(output_dir)

        # Download user's logo from Supabase if they have one
        if company_profile and company_profile.get("logo_path"):
            try:
                logo_data = sb.storage.from_("claim-documents").download(company_profile["logo_path"])
                logo_dest = os.path.join(photos_dir, "usarm_logo.jpg")
                with open(logo_dest, "wb") as f:
                    f.write(logo_data)
                print(f"[PROCESS] Downloaded user logo")
            except Exception as e:
                print(f"[PROCESS] Could not download logo: {e}")

        # Fallback: Copy USARM logo if no user logo
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

        # 4. Download photos (extract images from PDFs if needed)
        photo_paths = []
        photo_filenames = []
        for fname in claim.get("photo_files", []):
            local = os.path.join(photos_dir, fname)
            download_file(sb, "claim-documents", f"{file_path}/photos/{fname}", local)

            # If the photo file is a PDF, extract images from it
            if fname.lower().endswith(".pdf"):
                print(f"[PHOTOS] Photo file is a PDF — extracting images: {fname}")
                extracted = extract_images_from_pdf(local, photos_dir)
                if extracted:
                    photo_paths.extend(extracted)
                    photo_filenames.extend([os.path.basename(p) for p in extracted])
                else:
                    print(f"[PHOTOS] WARNING: No images extracted from {fname}")
            else:
                photo_paths.append(local)
                photo_filenames.append(fname)

        # 5. Download carrier scope (if any)
        scope_paths = []
        for fname in claim.get("scope_files", []):
            local = os.path.join(source_dir, fname)
            download_file(sb, "claim-documents", f"{file_path}/scope/{fname}", local)
            scope_paths.append(local)

        # 5b. Download weather data (if any)
        weather_paths = []
        for fname in claim.get("weather_files", []):
            local = os.path.join(source_dir, fname)
            download_file(sb, "claim-documents", f"{file_path}/weather/{fname}", local)
            weather_paths.append(local)

        # 6. Extract measurements via Claude
        print(f"[PROCESS] Extracting measurements...")
        measurements = {}
        if measurement_paths:
            measurements = extract_measurements(claude, measurement_paths[0])

        # 7. Analyze photos via Claude
        print(f"[PROCESS] Analyzing {len(photo_paths)} photos...")
        photo_analysis = {"trades_identified": ["roofing"], "photo_annotations": {}, "photo_count": 0}
        if photo_paths:
            photo_analysis = analyze_photos(claude, photo_paths, user_notes=claim.get("user_notes"))

        # 7b. Photo integrity analysis (fraud detection)
        print(f"[PROCESS] Running photo integrity analysis...")
        photo_integrity = {"total": 0, "flagged": 0, "score": "N/A", "summary": "", "findings": []}
        if photo_paths:
            try:
                photo_integrity = analyze_photo_integrity(claude, photo_paths)
                print(f"[INTEGRITY] {photo_integrity['total']} photos analyzed — {photo_integrity['flagged']} flagged — Score: {photo_integrity['score']}")
            except Exception as e:
                print(f"[INTEGRITY] Analysis failed (non-fatal): {e}")

        # 8. Extract carrier scope (if present) — use last scope file (most recent upload)
        carrier_data = None
        if scope_paths:
            print(f"[PROCESS] Extracting carrier scope ({len(scope_paths)} file(s))...")
            carrier_data = extract_carrier_scope(claude, scope_paths[-1])

        # 8b. Extract weather data (if present)
        weather_data = {}
        if weather_paths:
            print(f"[PROCESS] Extracting weather data...")
            weather_data = extract_weather_data(claude, weather_paths[0])

        # 9. Build claim config
        print(f"[PROCESS] Building claim config...")
        config = build_claim_config(
            claim, measurements, photo_analysis, carrier_data, photo_filenames, weather_data, company_profile,
            user_notes=claim.get("user_notes"),
            photo_integrity=photo_integrity,
        )

        # Set paths for the generator
        config["_paths"] = {
            "claim_dir": work_dir,
            "photos": photos_dir,
            "output": output_dir,
            "source_docs": source_dir,
        }

        # Set source_docs config so generator doesn't try to extract from a nonexistent CompanyCam PDF
        # Point to a file that doesn't exist — generator will print "not found" and skip extraction
        config["source_docs"] = {"companycam_pdf": "_no_companycam.pdf"}

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
        update_data: dict = {
            "status": "ready",
            "output_files": uploaded_pdfs,
        }
        if photo_integrity and photo_integrity.get("total", 0) > 0:
            update_data["photo_integrity"] = {
                "total": photo_integrity["total"],
                "flagged": photo_integrity["flagged"],
                "score": photo_integrity["score"],
            }
        sb.table("claims").update(update_data).eq("id", claim_id).execute()

        print(f"[PROCESS] Claim complete: {claim['address']} — {len(pdfs)} PDFs ready")

        # 13. Sync to GitHub dashboard + carrier playbooks
        try:
            sync_to_github_dashboard(config, claim, photo_analysis, carrier_data)
        except Exception as e:
            print(f"[SYNC] GitHub sync failed (non-fatal): {e}")


# ===================================================================
# HELPERS
# ===================================================================

PLATFORM_DIR = os.path.expanduser("~/USARM-Claims-Platform")
SYNC_SCRIPT = os.path.join(PLATFORM_DIR, "sync_dashboard.py")


def compute_financials(config: dict) -> dict:
    """Calculate financial totals from line items."""
    line_total = sum(
        item.get("qty", 0) * item.get("unit_price", 0)
        for item in config.get("line_items", [])
    )
    tax_rate = config.get("financials", {}).get("tax_rate", 0.08)
    tax = line_total * tax_rate
    rcv = line_total + tax
    o_and_p_amount = line_total * 0.20 if config.get("scope", {}).get("o_and_p") else 0
    total = rcv + o_and_p_amount
    deductible = config.get("financials", {}).get("deductible", 0)
    net = total - deductible
    carrier_rcv = config.get("carrier", {}).get("carrier_rcv", 0)
    variance = total - carrier_rcv if carrier_rcv else 0
    return {
        "line_total": round(line_total, 2),
        "tax": round(tax, 2),
        "rcv": round(rcv, 2),
        "o_and_p": round(o_and_p_amount, 2),
        "total": round(total, 2),
        "deductible": round(deductible, 2),
        "net": round(net, 2),
        "variance": round(variance, 2),
    }


def sync_to_github_dashboard(config: dict, claim: dict, photo_analysis: dict, carrier_data: Optional[dict]):
    """Sync processed claim to USARM GitHub dashboard + carrier playbooks."""
    if not os.path.exists(PLATFORM_DIR):
        print("[SYNC] USARM-Claims-Platform not found — skipping GitHub sync")
        return

    # Build slug
    slug = claim.get("slug", "")
    if not slug:
        slug = claim["address"].lower().replace(",", "").replace(" ", "-").strip("-")

    claim_dir = os.path.join(PLATFORM_DIR, "claims", slug)
    os.makedirs(os.path.join(claim_dir, "pdf_output"), exist_ok=True)

    # Compute financials
    financials = compute_financials(config)
    carrier_rcv = config.get("carrier", {}).get("carrier_rcv", 0)

    # Add dashboard section to config
    carrier_name = config.get("carrier", {}).get("name", claim.get("carrier", ""))
    config["dashboard"] = {
        "status": "pending",
        "phase": "Pre-Scope" if config.get("phase") == "pre-scope" else "Supplement Filed",
        "carrier_1st_scope": carrier_rcv,
        "carrier_current": carrier_rcv,
        "primary_tactic": "",
        "notes": f"Processed via dumbroof.ai | {len(config.get('line_items', []))} line items | Source: web upload",
    }

    # Remove internal paths before saving
    config_to_save = {k: v for k, v in config.items() if k != "_paths"}

    # Write claim_config.json
    config_path = os.path.join(claim_dir, "claim_config.json")
    with open(config_path, "w") as f:
        json.dump(config_to_save, f, indent=2)
    print(f"[SYNC] Saved config: {config_path}")

    # Update carrier playbook
    update_carrier_playbook(carrier_name, claim, config, financials, photo_analysis, carrier_data)

    # Run dashboard sync
    if os.path.exists(SYNC_SCRIPT):
        result = subprocess.run(
            ["python3", SYNC_SCRIPT, "--update-html"],
            capture_output=True, text=True, cwd=PLATFORM_DIR,
            timeout=30,
        )
        if result.returncode == 0:
            print(f"[SYNC] Dashboard HTML updated")
        else:
            print(f"[SYNC] Dashboard sync warning: {result.stderr[:200]}")

    # Update memory files
    update_memory_files(claim, config, financials, carrier_name)

    # Git commit and push
    try:
        subprocess.run(
            ["git", "add", f"claims/{slug}/", "docs/index.html"],
            capture_output=True, text=True, cwd=PLATFORM_DIR, timeout=10,
        )
        # Also add carrier playbook and memory files
        carrier_slug = carrier_name.lower().replace(" ", "-")
        playbook_path = f"carrier_playbooks/{carrier_slug}.md"
        if os.path.exists(os.path.join(PLATFORM_DIR, playbook_path)):
            subprocess.run(
                ["git", "add", playbook_path],
                capture_output=True, text=True, cwd=PLATFORM_DIR, timeout=10,
            )

        # Add memory files
        memory_dir = os.path.expanduser("~/.claude/projects/-Users-thomaskovackjr-USARM-Claims-Platform/memory")
        if os.path.exists(memory_dir):
            # Copy memory files into repo for git tracking
            repo_memory = os.path.join(PLATFORM_DIR, "memory")
            os.makedirs(repo_memory, exist_ok=True)
            import shutil
            for mf in os.listdir(memory_dir):
                if mf.endswith(".md"):
                    shutil.copy2(os.path.join(memory_dir, mf), os.path.join(repo_memory, mf))
            subprocess.run(
                ["git", "add", "memory/"],
                capture_output=True, text=True, cwd=PLATFORM_DIR, timeout=10,
            )

        commit_msg = f"Add {claim['address']} claim ({carrier_name}) — via dumbroof.ai"
        result = subprocess.run(
            ["git", "commit", "-m", commit_msg],
            capture_output=True, text=True, cwd=PLATFORM_DIR, timeout=10,
        )
        if result.returncode == 0:
            push_result = subprocess.run(
                ["git", "push"],
                capture_output=True, text=True, cwd=PLATFORM_DIR, timeout=30,
            )
            if push_result.returncode == 0:
                print(f"[SYNC] Git push successful — dashboard updated")
            else:
                print(f"[SYNC] Git push failed: {push_result.stderr[:200]}")
        else:
            print(f"[SYNC] Git commit: {result.stdout[:200]}")
    except Exception as e:
        print(f"[SYNC] Git error: {e}")


def update_memory_files(claim: dict, config: dict, financials: dict, carrier_name: str):
    """Update PROJECTS.md and completed-claims.md in the memory directory."""
    memory_dir = os.path.expanduser("~/.claude/projects/-Users-thomaskovackjr-USARM-Claims-Platform/memory")
    if not os.path.exists(memory_dir):
        print("[SYNC] Memory directory not found — skipping memory updates")
        return

    address = claim.get("address", "Unknown")
    phase = config.get("phase", "unknown")
    trades = ", ".join(config.get("scope", {}).get("trades", []))
    usarm_rcv = financials.get("total", 0)
    carrier_rcv = config.get("carrier", {}).get("carrier_rcv", 0)
    date = datetime.now().strftime("%Y-%m-%d")

    # Update completed-claims.md
    claims_file = os.path.join(memory_dir, "completed-claims.md")
    entry = f"\n### {address}\n"
    entry += f"- **Date:** {date}\n"
    entry += f"- **Carrier:** {carrier_name}\n"
    entry += f"- **Phase:** {phase}\n"
    entry += f"- **Trades:** {trades}\n"
    entry += f"- **USARM RCV:** ${usarm_rcv:,.2f}\n"
    entry += f"- **Carrier RCV:** ${carrier_rcv:,.2f}\n"
    entry += f"- **Variance:** ${financials.get('variance', 0):,.2f}\n"
    entry += f"- **Status:** Pending\n"
    entry += f"- **Source:** dumbroof.ai\n"
    entry += f"- **Claim #:** {config.get('carrier', {}).get('claim_number', 'N/A')}\n\n"

    try:
        with open(claims_file, "a") as f:
            f.write(entry)
        print(f"[SYNC] Updated completed-claims.md")
    except Exception as e:
        print(f"[SYNC] Could not update completed-claims.md: {e}")

    # Update PROJECTS.md if it exists
    projects_file = os.path.join(memory_dir, "PROJECTS.md")
    if os.path.exists(projects_file):
        try:
            with open(projects_file, "a") as f:
                f.write(f"\n| {address} | {carrier_name} | {phase} | ${usarm_rcv:,.0f} | Pending | dumbroof.ai | {date} |\n")
            print(f"[SYNC] Updated PROJECTS.md")
        except Exception as e:
            print(f"[SYNC] Could not update PROJECTS.md: {e}")


def update_carrier_playbook(carrier_name: str, claim: dict, config: dict, financials: dict, photo_analysis: dict, carrier_data: Optional[dict]):
    """Append claim data to the carrier's playbook file."""
    if not carrier_name:
        return

    carrier_slug = carrier_name.lower().replace(" ", "-")
    playbook_path = os.path.join(PLATFORM_DIR, "carrier_playbooks", f"{carrier_slug}.md")

    # Create playbook if it doesn't exist
    if not os.path.exists(playbook_path):
        with open(playbook_path, "w") as f:
            f.write(f"# {carrier_name} — Carrier Playbook\n\n")
            f.write(f"> Auto-generated. Updated after every claim against {carrier_name}.\n\n")
            f.write("---\n\n## Claims History\n\n")

    # Build entry
    address = claim.get("address", "Unknown")
    phase = config.get("phase", "unknown")
    trades = ", ".join(config.get("scope", {}).get("trades", []))
    usarm_rcv = financials.get("total", 0)
    carrier_rcv = config.get("carrier", {}).get("carrier_rcv", 0)
    damage_type = photo_analysis.get("damage_type", "unknown")
    severity = photo_analysis.get("severity", "unknown")
    date = datetime.now().strftime("%Y-%m-%d")

    entry = f"\n### {address} ({date})\n"
    entry += f"- **Phase:** {phase}\n"
    entry += f"- **Trades:** {trades}\n"
    entry += f"- **USARM RCV:** ${usarm_rcv:,.2f}\n"
    entry += f"- **Carrier RCV:** ${carrier_rcv:,.2f}\n"
    entry += f"- **Variance:** ${financials.get('variance', 0):,.2f}\n"
    entry += f"- **Damage Type:** {damage_type} | Severity: {severity}\n"
    entry += f"- **Source:** dumbroof.ai web upload\n"

    if carrier_data:
        arguments = carrier_data.get("carrier_arguments", [])
        if arguments:
            entry += f"- **Carrier Arguments:** {'; '.join(arguments[:3])}\n"
        acknowledged = carrier_data.get("carrier_acknowledged_items", [])
        if acknowledged:
            entry += f"- **Carrier Acknowledged:** {'; '.join(acknowledged[:5])}\n"

    key_findings = photo_analysis.get("key_findings", [])
    if key_findings:
        entry += f"- **Key Findings:** {'; '.join(key_findings[:3])}\n"

    entry += f"- **Status:** Pending\n\n"

    # Append to playbook
    with open(playbook_path, "a") as f:
        f.write(entry)

    print(f"[SYNC] Updated carrier playbook: {carrier_slug}.md")


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
