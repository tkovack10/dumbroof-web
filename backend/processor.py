"""
Claim Processor — Document Analysis + Config Building + PDF Generation
======================================================================
Uses Claude API to read uploaded documents, extract structured data,
build a claim config, generate PDFs, and upload results.
"""

from __future__ import annotations

import os
import re
import json
import base64
import tempfile
import subprocess
from datetime import datetime
from typing import Optional, List, Dict

import time
import asyncio

import anthropic
import traceback
from supabase import create_client, Client

from telemetry import (
    call_claude_logged,
    write_photos,
    write_line_items,
    write_carrier_tactics,
    write_claim_outcome,
    write_pricing_benchmarks,
)

from photo_utils import (
    convert_to_jpeg,
    resize_photo as _shared_resize_photo,
    prepare_photo_for_api,
    prepare_photo_for_pdf,
    extract_images_from_pdf as _shared_extract_pdf,
    extract_images_from_zip,
    extract_attachments_from_eml,
    ingest_photos,
    get_media_type as _shared_get_media_type,
    is_image_file,
    is_container_file,
    NEEDS_CONVERSION,
    ALL_IMAGE_FORMATS,
)


_TELEMETRY_SB = None    # Set by process_claim() for per-request telemetry
_TELEMETRY_CLAIM_ID = None


def _format_date(date_str: str) -> str:
    """Convert ISO date (2021-07-08) to readable format (July 8, 2021)."""
    if not date_str:
        return ""
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        return dt.strftime("%B %d, %Y").replace(" 0", " ")  # Remove leading zero from day
    except ValueError:
        return date_str  # Already formatted or unparseable

def _call_claude_with_retry(client, max_retries=3, _step_name="unknown", _metadata=None, **kwargs):
    """Call Claude API with retry on rate limits + optional telemetry logging."""
    # If telemetry is enabled, use the logged version
    if _TELEMETRY_SB:
        return call_claude_logged(
            client, _TELEMETRY_SB, _TELEMETRY_CLAIM_ID,
            step_name=_step_name, max_retries=max_retries,
            metadata=_metadata, **kwargs,
        )
    # Fallback: no telemetry (standalone usage, tests)
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
    return anthropic.Anthropic(
        api_key=os.environ["ANTHROPIC_API_KEY"],
        timeout=600.0,  # 10 min — Opus repair diagnosis can be slow
    )


# ===================================================================
# EXTERNAL PRICING
# ===================================================================

_PRICING_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pricing")

def _load_pricing(price_list: str = "nybi26") -> dict:
    """Load pricing from external JSON file. Falls back to empty dict."""
    path = os.path.join(_PRICING_DIR, f"{price_list}.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    print(f"[PRICING] Warning: {path} not found — using hardcoded fallbacks")
    return {}

PRICING = _load_pricing()  # Default NYBI26
_PRICING_CACHE = {"nybi26": PRICING}


def get_pricing_for_state(state: str) -> dict:
    """Get pricing for a given state. NY=NYBI26, PA=PAPI26, others=NYBI26."""
    price_map = {"PA": "papi26", "NJ": "njbi26"}
    price_list = price_map.get(state.upper(), "nybi26")
    if price_list not in _PRICING_CACHE:
        loaded = _load_pricing(price_list)
        if loaded and "_meta" in loaded:
            _PRICING_CACHE[price_list] = loaded
        else:
            # Fallback to NYBI26 if state-specific pricing doesn't exist
            _PRICING_CACHE[price_list] = PRICING
    return _PRICING_CACHE[price_list]


# ===================================================================
# FILE HELPERS
# ===================================================================

def download_file(sb: Client, bucket: str, path: str, local_path: str):
    """Download a file from Supabase Storage with retry on failure."""
    max_retries = 3
    for attempt in range(max_retries):
        try:
            data = sb.storage.from_(bucket).download(path)
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            with open(local_path, "wb") as f:
                f.write(data)
            return local_path
        except Exception as e:
            if attempt < max_retries - 1:
                wait = 5 * (2 ** attempt)  # 5s, 10s, 20s
                print(f"[DOWNLOAD] Retry {attempt + 1}/{max_retries} for {os.path.basename(path)} in {wait}s: {e}")
                time.sleep(wait)
            else:
                raise RuntimeError(f"Failed to download {path} after {max_retries} attempts: {e}")


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
    """Return MIME type — delegates to shared photo_utils."""
    return _shared_get_media_type(filename)


def extract_images_from_pdf(pdf_path: str, output_dir: str) -> list[str]:
    """Extract images from a PDF — delegates to shared photo_utils."""
    return _shared_extract_pdf(pdf_path, output_dir)


def _extract_eml_body_as_text(eml_path: str, work_dir: str) -> str:
    """Extract the email body (text or HTML) and save as a .txt file.

    Used as a fallback when an .eml has no file attachments — the document
    content IS the email body (e.g., denial letters sent as email text).
    """
    import email
    import email.policy

    with open(eml_path, "rb") as f:
        msg = email.message_from_binary_file(f, policy=email.policy.default)

    # Try to get plain text body first, then HTML
    body = msg.get_body(preferencelist=("plain", "html"))
    if not body:
        return ""

    content = body.get_content()
    if not content or not content.strip():
        return ""

    # If HTML, do a basic tag strip to get readable text
    if body.get_content_type() == "text/html":
        import re
        content = re.sub(r"<style[^>]*>.*?</style>", "", content, flags=re.DOTALL | re.IGNORECASE)
        content = re.sub(r"<script[^>]*>.*?</script>", "", content, flags=re.DOTALL | re.IGNORECASE)
        content = re.sub(r"<br\s*/?>", "\n", content, flags=re.IGNORECASE)
        content = re.sub(r"</?p[^>]*>", "\n", content, flags=re.IGNORECASE)
        content = re.sub(r"<[^>]+>", "", content)
        content = content.strip()

    # Prepend email metadata for context
    subject = msg.get("subject", "")
    from_addr = msg.get("from", "")
    date = msg.get("date", "")
    header = f"From: {from_addr}\nDate: {date}\nSubject: {subject}\n{'='*60}\n\n"
    content = header + content

    # Save as .txt
    basename = os.path.splitext(os.path.basename(eml_path))[0]
    txt_path = os.path.join(work_dir, f"{basename}_body.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"[PROCESS] EML body extracted as text: {os.path.basename(txt_path)} ({len(content):,} chars)")
    return txt_path


def resolve_eml_to_document(path: str, work_dir: str) -> str:
    """If path is a .eml file, extract attachments and return the best document.

    Returns the first PDF found (preferred for scope/measurements/weather),
    or the first image if no PDFs, or the email body as text if no attachments.
    If not .eml, returns path unchanged.
    """
    ext = path.lower().rsplit(".", 1)[-1] if "." in path else ""
    if ext != "eml":
        return path

    extracted = extract_attachments_from_eml(path, work_dir)

    # Prefer PDFs (scope docs, measurement reports, weather reports are PDFs)
    pdfs = [f for f in extracted if f.lower().endswith(".pdf")]
    if pdfs:
        print(f"[PROCESS] EML resolved to PDF: {os.path.basename(pdfs[0])}")
        return pdfs[0]

    # Then images
    from photo_utils import ALL_IMAGE_FORMATS
    images = [f for f in extracted
              if f.lower().rsplit(".", 1)[-1] in ALL_IMAGE_FORMATS]
    if images:
        print(f"[PROCESS] EML resolved to image: {os.path.basename(images[0])}")
        return images[0]

    # Fallback: the email body IS the document (e.g., denial letters)
    txt_path = _extract_eml_body_as_text(path, work_dir)
    if txt_path:
        print(f"[PROCESS] EML had no attachments — using email body as text")
        return txt_path

    print(f"[PROCESS] EML had no extractable content: {os.path.basename(path)}")
    return path


def resize_photo(path: str, max_dim: int = 1024) -> str:
    """Resize a photo — handles HEIC, TIFF, BMP, RAW, and all standard formats.
    Delegates to shared photo_utils for format conversion + resize."""
    ext = path.lower().rsplit(".", 1)[-1] if "." in path else ""

    # Convert non-native formats to JPEG first
    if ext in NEEDS_CONVERSION:
        converted = convert_to_jpeg(path)
        if not converted:
            print(f"[PHOTOS] Could not convert {os.path.basename(path)} ({ext}) — skipping")
            return ""
        path = converted

    return _shared_resize_photo(path, max_dim=max_dim, quality=60, suffix="_resized")


# ===================================================================
# CLAUDE API — DOCUMENT ANALYSIS
# ===================================================================

def extract_measurements(client: anthropic.Anthropic, pdf_path: str) -> dict:
    """Send measurement PDF to Claude and extract structured data."""
    pdf_b64 = file_to_base64(pdf_path)

    response = _call_claude_with_retry(client,
        _step_name="extract_measurements",
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
  "total_roof_area_sq": 0,
  "walls": {
    "total_wall_area_sf": 0,
    "elevations": [
      {"name": "Front", "area_sf": 0},
      {"name": "Right", "area_sf": 0},
      {"name": "Left", "area_sf": 0},
      {"name": "Rear", "area_sf": 0}
    ],
    "window_count": 0,
    "door_count": 0,
    "garage_door_count": 0
  }
}

Use 0 for any values not found. Calculate SQ = SF / 100. Include waste_factor if stated (default 1.10 = 10% waste).
If this report includes wall/siding measurements (EagleView Walls report or similar), extract wall areas per elevation, window count, and door count into the walls section. Use 0 for any wall values not found."""
                }
            ]
        }]
    )
    result = _parse_json_response(response.content[0].text)

    # Validate extraction succeeded — retry once if no roof area found
    structs = result.get("structures", [{}])
    struct = structs[0] if structs else {}
    area_sf = struct.get("roof_area_sf", result.get("total_roof_area_sf", 0))

    if not area_sf:
        print("[WARN] Measurement extraction returned no roof area — retrying with explicit prompt...")
        retry_response = _call_claude_with_retry(client,
            _step_name="extract_measurements_retry",
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
                        "text": (
                            "Extract measurements from this roof measurement report. "
                            "You MUST return roof_area_sf (total roof area in square feet) and "
                            "roof_area_sq (in roofing squares = sf/100). Also extract linear "
                            "measurements (ridge, hip, valley, rake, eave in linear feet). "
                            "Return ONLY valid JSON with 'structures' array and 'measurements' object."
                        ),
                    },
                ]
            }]
        )
        retry_result = _parse_json_response(retry_response.content[0].text)
        retry_structs = retry_result.get("structures", [{}])
        retry_struct = retry_structs[0] if retry_structs else {}
        retry_area = retry_struct.get("roof_area_sf", retry_result.get("total_roof_area_sf", 0))
        if retry_area:
            print(f"[INFO] Measurement retry succeeded — roof_area_sf={retry_area}")
            result = retry_result
        else:
            print("[WARN] Measurement retry also failed — quantities will default to 0")

    return result


def analyze_photos(client: anthropic.Anthropic, photo_paths: list[str], user_notes: Optional[str] = None) -> dict:
    """Send inspection photos to Claude for forensic analysis, in batches."""
    BATCH_SIZE = 5  # 5 resized photos per batch to stay well under API limits

    # Filter to image files and resize
    image_paths = []
    for path in photo_paths[:100]:
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
    all_photo_tags = {}
    trades_set = set()
    damage_summary_parts = []
    shingle_type = ""
    shingle_votes = []
    shingle_condition = ""
    siding_type = ""
    damage_type = ""
    severity = ""
    chalk_test_results = []
    test_square_results = []
    exposure_inches = None

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
            "text": f"""You are a forensic roofing damage analyst specializing in storm damage assessment. Analyze these inspection photos ({start_num}-{start_num + len(batch) - 1}) and document all visible damage with clinical, professional observations.{notes_ctx}

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

SIDING DAMAGE — Look for:
- Hail dents on metal/aluminum siding (chalk test gaps on flat metal panels)
- Cracked, chipped, or broken vinyl siding panels
- Damaged cedar shake/shingle siding
- Identify the siding material type: aluminum, vinyl, cedar, fiber cement, or none visible
- WINDOW/DOOR WRAPS: If aluminum wraps (coil stock) around windows show chalk-marked hail impacts, include window_wraps in trades
- FASCIA/SOFFIT: If metal fascia or soffit shows hail damage, include in trades

SHINGLE EXPOSURE CHECK (CRITICAL FOR REPAIRABILITY):
- If visible, measure the shingle exposure (butt-to-butt distance between courses).
- 5" exposure = pre-metric shingle = UNREPAIRABLE with ANY current product on the market.
- Current metric products are 5-5/8" exposure — mixing 5" and 5-5/8" creates 5/8" offset per course.
- After 10 courses = 6-1/4" cumulative offset = full course misalignment after 20 courses.
- This applies to BOTH 3-tab AND laminate/architectural shingles.
- If 5" exposure is observed, note it as a KEY FINDING — it proves the roof cannot be spot-repaired.

SLATE/TILE/METAL IDENTIFICATION:
- If the roofing material is natural slate, clay tile, concrete tile, or standing seam metal, identify it EXACTLY.
- Slate: Look for natural stone texture, irregular edges, muted colors, copper/lead flashing, thick profile.
- Tile: Look for barrel/S-curve profile, terracotta/concrete color, mortar ridges.
- Do NOT default to "comp shingle" if the material is clearly slate, tile, or metal.

ANALYSIS PRIORITIES:
- FOCUS ON STORM DAMAGE — hail impacts, wind displacement, fractures from the storm event. This is 90% of the report.
- Do NOT catalog every minor wear detail (lichen, moss, minor surface weathering, faded paint). Only mention pre-existing condition ONCE, briefly, if it makes spot repair infeasible.
- Keep annotations concise — 1-2 sentences per photo focusing on the storm damage evidence visible
- For chalk test photos: describe what the chalk test reveals (number of gaps = hail impacts), not the chalk itself
- For test square photos: report the counts (H=hits, W=wind) and what they prove

IMPORTANT: If an image is NOT a roofing/damage inspection photo (e.g., company logos,
certification seals, report headers/footers, diagrams, tables, text pages), identify it as:
- shingle_type: leave unchanged from previous observations
- photo_tag material: "non_photo"
- annotation: "Non-inspection image — [description of what it actually shows]"
Do NOT describe non-photo images as if they show roofing materials or damage.

Number the photos starting at {start_num}. Return ONLY valid JSON:
{{
  "damage_summary": "Professional summary focusing on storm damage and why full replacement is required...",
  "photo_annotations": {{
    "photo_{start_num:02d}": "Forensic observation focusing on storm damage evidence...",
    "photo_{start_num + 1:02d}": "Forensic observation..."
  }},
  "shingle_type": "natural slate / architectural laminated / 3-tab 25yr / standing seam metal / etc",
  "shingle_condition": "description focusing on storm vulnerability and non-repairability",
  "trades_identified": ["roofing", "gutters", "siding", "window_wraps"],
  "siding_type": "aluminum / vinyl / cedar / fiber_cement / none",
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
  ],
  "exposure_inches": 5.0,
  "photo_tags": {{
    "photo_{start_num:02d}": {{
      "damage_type": "hail_dent | crack | missing | granule_loss | lifted_tab | wind_crease | chalk_test | corrosion | overview | none",
      "material": "comp_shingle_laminated | comp_shingle_3tab | aluminum_siding | vinyl_siding | metal_flashing | aluminum_gutter | copper | slate | aluminum_trim | metal_vent",
      "trade": "roofing | siding | gutters | window_wraps | flashing | general",
      "elevation": "front | rear | left | right | roof | detail | interior",
      "severity": "minor | moderate | severe | critical"
    }}
  }}
}}"""
        })

        response = _call_claude_with_retry(client,
            _step_name="analyze_photos",
            _metadata={"batch": batch_num, "total_batches": total_batches, "photos_in_batch": len(batch)},
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
        # Collect shingle_type votes (majority vote, not last-write-wins)
        # Skip vote if batch contains only non-photo images
        batch_has_real_photos = True
        if batch_result.get("photo_tags"):
            real_photos = [k for k, v in batch_result["photo_tags"].items()
                           if v.get("material", "") != "non_photo"]
            if not real_photos:
                batch_has_real_photos = False
        if batch_result.get("shingle_type") and batch_has_real_photos:
            shingle_votes.append(batch_result["shingle_type"].lower().strip())
        if batch_result.get("shingle_condition"):
            shingle_condition = batch_result["shingle_condition"]
        if batch_result.get("siding_type") and batch_result["siding_type"] != "none":
            siding_type = batch_result["siding_type"]
        if batch_result.get("damage_type"):
            damage_type = batch_result["damage_type"]
        if batch_result.get("severity"):
            severity = batch_result["severity"]
        if batch_result.get("chalk_test_results"):
            chalk_test_results.append(batch_result["chalk_test_results"])
        if batch_result.get("test_square_results"):
            test_square_results.extend(batch_result["test_square_results"])
        if batch_result.get("exposure_inches") and exposure_inches is None:
            try:
                exposure_inches = float(batch_result["exposure_inches"])
            except (TypeError, ValueError):
                pass
        if batch_result.get("photo_tags"):
            all_photo_tags.update(batch_result["photo_tags"])

    # Filter out non-inspection images (blank pages, certificates, marketing materials)
    filtered_annotations = {}
    filtered_photo_tags = {}
    non_photo_count = 0
    for key, tag in all_photo_tags.items():
        if tag.get("material") == "non_photo" or tag.get("damage_type") == "none":
            non_photo_count += 1
            continue
        filtered_photo_tags[key] = tag
        if key in all_annotations:
            filtered_annotations[key] = all_annotations[key]

    if non_photo_count > 0:
        print(f"[PHOTOS] Filtered out {non_photo_count} non-inspection images (certificates, blank pages, marketing)")
        all_annotations = filtered_annotations if filtered_annotations else all_annotations
        all_photo_tags = filtered_photo_tags if filtered_photo_tags else all_photo_tags

    # Resolve shingle_type by majority vote across batches
    if shingle_votes:
        shingle_type = _majority_vote_material(shingle_votes)

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
        "photo_tags": all_photo_tags,
        "shingle_type": shingle_type,
        "shingle_condition": shingle_condition,
        "siding_type": siding_type,
        "trades_identified": sorted(trades_set),
        "key_findings": all_findings,
        "code_violations": all_violations,
        "damage_type": damage_type,
        "severity": severity,
        "photo_count": len(all_annotations) if all_annotations else len(image_paths),
        "chalk_test_results": chalk_test_results,
        "test_square_results": test_square_results,
        "exposure_inches": exposure_inches,
    }


def analyze_photo_integrity(client: anthropic.Anthropic, photo_paths: list[str]) -> dict:
    """Analyze photos for signs of staging, manipulation, or man-made damage.

    Returns a photo integrity report that gets stamped onto generated PDFs.
    This is DumbRoof.AI proprietary IP — fraud detection at the inspection level.
    """
    # Sample up to 10 photos for integrity check (cost-efficient)
    sample_paths = []
    for path in photo_paths[:20]:
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
        _step_name="photo_integrity",
        _metadata={"photo_count": len(sample_paths)},
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
    """Extract carrier scope data from insurance estimate PDF or text file."""
    ext = pdf_path.lower().rsplit(".", 1)[-1] if "." in pdf_path else ""

    # Build content block based on file type
    if ext == "txt":
        # Email body extracted as text (e.g., denial letter was the email itself)
        with open(pdf_path, "r", encoding="utf-8") as f:
            text_content = f.read()
        file_block = {
            "type": "text",
            "text": f"[CARRIER DOCUMENT — extracted from email]\n\n{text_content}",
        }
    else:
        # Standard PDF
        pdf_b64 = file_to_base64(pdf_path)
        file_block = {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_b64},
        }

    response = _call_claude_with_retry(client,
        _step_name="extract_carrier_scope",
        model="claude-sonnet-4-6",
        max_tokens=8192,
        messages=[{
            "role": "user",
            "content": [
                file_block,
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
      "item": "Xactimate-style line item name (e.g., 'Comp shingle roofing' not 'Dwelling Roof - Item 1')",
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


def diff_carrier_scopes(
    client: anthropic.Anthropic,
    old_carrier_data: dict,
    new_carrier_data: dict,
    usarm_line_items: list,
    usarm_arguments: list,
) -> dict:
    """Compare old vs new carrier scope and identify what changed.
    Returns a revision record with added/increased/still-missing items
    and which USARM arguments likely drove each change."""

    old_rcv = old_carrier_data.get("carrier_rcv", 0) or 0
    new_rcv = new_carrier_data.get("carrier_rcv", 0) or 0
    movement = new_rcv - old_rcv
    movement_pct = (movement / old_rcv * 100) if old_rcv > 0 else 0

    old_items = old_carrier_data.get("carrier_line_items", [])
    new_items = new_carrier_data.get("carrier_line_items", [])

    # Build lookup by description (normalized)
    def normalize(desc):
        return desc.lower().strip().replace("  ", " ")

    old_lookup = {}
    for item in old_items:
        key = normalize(item.get("carrier_desc", ""))
        old_lookup[key] = item

    new_lookup = {}
    for item in new_items:
        key = normalize(item.get("carrier_desc", ""))
        new_lookup[key] = item

    items_added = []
    items_increased = []
    items_unchanged = []

    for key, new_item in new_lookup.items():
        if key not in old_lookup:
            items_added.append({
                "description": new_item.get("carrier_desc", ""),
                "new_amount": new_item.get("carrier_amount", 0),
                "qty": new_item.get("qty", 0),
                "unit": new_item.get("unit", ""),
            })
        else:
            old_amt = old_lookup[key].get("carrier_amount", 0) or 0
            new_amt = new_item.get("carrier_amount", 0) or 0
            if new_amt > old_amt * 1.05:  # >5% increase = meaningful
                items_increased.append({
                    "description": new_item.get("carrier_desc", ""),
                    "old_amount": old_amt,
                    "new_amount": new_amt,
                    "increase": new_amt - old_amt,
                })
            else:
                items_unchanged.append(key)

    # Items in old but not new (removed/reclassified)
    items_removed = []
    for key, old_item in old_lookup.items():
        if key not in new_lookup:
            items_removed.append({
                "description": old_item.get("carrier_desc", ""),
                "old_amount": old_item.get("carrier_amount", 0),
            })

    # Use Claude to map changes to USARM arguments that likely drove them
    argument_mapping = []
    if (items_added or items_increased) and usarm_arguments:
        try:
            changes_text = ""
            for item in items_added[:10]:
                changes_text += f"ADDED: {item['description']} (${item['new_amount']:,.2f})\n"
            for item in items_increased[:10]:
                changes_text += f"INCREASED: {item['description']} (${item['old_amount']:,.2f} → ${item['new_amount']:,.2f})\n"

            args_text = "\n".join(f"- {arg}" for arg in usarm_arguments[:15])

            prompt = f"""A carrier revised their insurance scope after receiving our supplement. Map each change to the USARM argument that likely drove it.

CHANGES IN CARRIER'S REVISED SCOPE:
{changes_text}

OUR USARM ARGUMENTS (from supplement/appeal):
{args_text}

For each change, identify which USARM argument most likely convinced the carrier. Return ONLY a JSON array:
[{{"change": "description", "likely_argument": "the argument that drove this", "confidence": "high/medium/low"}}]"""

            response = _call_claude_with_retry(client,
                _step_name="diff_scopes",
                model="claude-opus-4-6",
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}]
            )
            argument_mapping = _parse_json_response(response.content[0].text)
            if not isinstance(argument_mapping, list):
                argument_mapping = []
        except Exception as e:
            print(f"[REVISION] Argument mapping failed (non-fatal): {e}")

    revision = {
        "revision_date": datetime.now().strftime("%Y-%m-%d"),
        "previous_rcv": round(old_rcv, 2),
        "new_rcv": round(new_rcv, 2),
        "movement": round(movement, 2),
        "movement_pct": round(movement_pct, 1),
        "items_added": items_added,
        "items_added_count": len(items_added),
        "items_increased": items_increased,
        "items_increased_count": len(items_increased),
        "items_removed": items_removed,
        "items_still_missing_count": 0,  # Could compute from USARM vs new carrier
        "argument_mapping": argument_mapping,
    }

    # Determine if this is a win
    is_win = movement > 0 and movement_pct >= 5  # 5%+ increase = win

    print(f"[REVISION] Carrier moved ${old_rcv:,.2f} → ${new_rcv:,.2f} ({movement_pct:+.1f}%)")
    print(f"[REVISION] {len(items_added)} items added, {len(items_increased)} increased, {len(items_removed)} removed")
    if is_win:
        print(f"[REVISION] WIN DETECTED — ${movement:,.2f} carrier movement (+{movement_pct:.1f}%)")

    return {
        "revision": revision,
        "is_win": is_win,
    }


# ===================================================================
# CONFIG BUILDER
# ===================================================================

def extract_weather_data(client: anthropic.Anthropic, file_path: str) -> dict:
    """Extract weather/storm data from HailTrace, NOAA, or similar report."""
    ext = file_path.lower().rsplit(".", 1)[-1] if "." in file_path else ""
    media_type = get_media_type(file_path)

    content = []
    if ext == "txt":
        # Email body extracted as text
        with open(file_path, "r", encoding="utf-8") as f:
            text_content = f.read()
        content.append({
            "type": "text",
            "text": f"[WEATHER REPORT — extracted from email]\n\n{text_content}",
        })
    elif media_type == "application/pdf":
        file_b64 = file_to_base64(file_path)
        content.append({
            "type": "document",
            "source": {"type": "base64", "media_type": media_type, "data": file_b64},
        })
    else:
        file_b64 = file_to_base64(file_path)
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
        _step_name="extract_weather",
        model="claude-sonnet-4-6",
        max_tokens=2048,
        messages=[{"role": "user", "content": content}]
    )
    return _parse_json_response(response.content[0].text)


def search_weather_corroboration(city: str, state: str, storm_date: str) -> list[dict]:
    """Disabled — NOAA Storm Events data is used instead. Web search returned unreliable results."""
    return []


def synthesize_executive_summary(
    client: anthropic.Anthropic,
    damage_summary: str,
    weather_data: dict,
    carrier_data: Optional[dict],
    material: str,
    key_findings: list,
    photo_count: int,
) -> list[str]:
    """Use Claude to synthesize raw damage data into a structured executive summary.
    Returns a list of paragraph strings (3-5 paragraphs)."""
    carrier_rcv = carrier_data.get("carrier_rcv", 0) if carrier_data else 0
    carrier_name = carrier_data["carrier"]["name"] if carrier_data and "carrier" in carrier_data else "the carrier"

    # Load carrier playbook for informed synthesis
    playbook_ctx = load_carrier_playbook(carrier_name)
    playbook_section = ""
    if playbook_ctx:
        playbook_section = f"\n\nCARRIER INTELLIGENCE ({carrier_name}):\n{playbook_ctx[:1500]}\nUse this intelligence to inform your language — reference known carrier tactics and effective counter-arguments.\n"

    prompt = f"""You are writing the Executive Summary for a forensic causation report on a storm-damaged property.
The roofing material is: {material}

Raw damage analysis from photo inspection:
{damage_summary[:3000]}

Weather data: Storm date {weather_data.get('storm_date', 'N/A')}, hail size {weather_data.get('hail_size', 'N/A')}
Carrier RCV: ${carrier_rcv:,.2f}
Photo count: {photo_count}
Key findings count: {len(key_findings)}
{playbook_section}

Write 3-5 SHORT paragraphs (2-4 sentences each) that build evidence gracefully:

Paragraph 1 — SCOPE: What property was inspected, what material systems are involved, what storm event caused the damage, and the date of loss. Set the scene.

Paragraph 2 — KEY DAMAGE FINDINGS: Summarize the primary storm damage documented — hail impacts on soft metals (confirmed by chalk testing), slate/roofing damage, gutter deformation. Be specific but concise. Do NOT list every minor observation.

Paragraph 3 — TECHNICAL BASIS: Why full replacement is required vs. spot repair — material matching impossibility, code compliance triggers, non-repairability of aged system post-storm.

Paragraph 4 (if carrier scope exists) — CARRIER VARIANCE: The carrier's scope at ${carrier_rcv:,.2f} does not account for [key missing items]. Our forensic analysis identifies a scope significantly beyond the carrier's approved amount.

RULES:
- NO run-on paragraphs — each paragraph should be 2-4 sentences max
- Professional, clinical forensic tone — NOT marketing language
- Do NOT mention every minor wear detail — focus on the storm damage evidence that matters
- Weave evidence together gracefully — build the case paragraph by paragraph
- Reference specific evidence (chalk testing, fracture patterns, code requirements) without being exhaustive
- CRITICAL UPPA COMPLIANCE: This is written for a CONTRACTOR (not a public adjuster or attorney). NEVER use "on behalf of," "demand," "appeal," cite 11 NYCRR, § 2601, or any advocacy/regulatory language. Contractors document and recommend — they do NOT advocate or negotiate.
- CRITICAL: This is a SINGLE property at a single address. Multiple structures (main dwelling, garage, shed, porch) are all part of ONE property. NEVER reference "two properties", "both properties", or "multiple properties."
- The inspection documented exactly {photo_count} photographs. Do NOT fabricate photo counts. If you reference photo counts, use exactly {photo_count}.

Return ONLY a JSON array of paragraph strings: ["paragraph 1...", "paragraph 2...", ...]"""

    response = _call_claude_with_retry(client,
        _step_name="synthesize_summary",
        model="claude-opus-4-6",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}]
    )
    paragraphs = _parse_json_response(response.content[0].text)
    if isinstance(paragraphs, list):
        return paragraphs
    return [damage_summary]


def synthesize_conclusion(
    client: anthropic.Anthropic,
    damage_summary: str,
    key_findings: list,
    code_violations: list,
    material: str,
    carrier_data: Optional[dict],
) -> list[str]:
    """Use Claude to synthesize a structured conclusion. Returns list of paragraph strings."""
    carrier_rcv = carrier_data.get("carrier_rcv", 0) if carrier_data else 0
    findings_text = "\n".join(f"- {f}" for f in key_findings[:15])
    violations_text = "\n".join(f"- {v.get('code','')}: {v.get('requirement', v.get('description',''))}" for v in code_violations[:10])

    prompt = f"""You are writing the Conclusion & Scope Determination section for a forensic causation report.
Roofing material: {material}

Key forensic findings:
{findings_text}

Code violations documented:
{violations_text}

Carrier RCV: ${carrier_rcv:,.2f}
Damage summary context: {damage_summary[:1500]}

Write 3-4 SHORT paragraphs (2-4 sentences each) that tie everything together:

Paragraph 1 — EVIDENCE SYNTHESIS: Based on our forensic analysis of [N] documented findings, the property at [address] sustained confirmed storm damage from [storm event]. Summarize the weight of evidence — chalk-tested hail impacts, fracture patterns, code violations.

Paragraph 2 — TECHNICAL DETERMINATION: The confirmed damage to [material] and associated components requires full system replacement. Explain WHY in 2-3 sentences — material matching, code triggers, non-repairability.

Paragraph 3 — SCOPE RECOMMENDATION: Based on the documented damage, applicable building codes, and industry standards, we recommend full replacement of [systems]. The carrier's current scope of ${carrier_rcv:,.2f} does not adequately address the documented conditions.

Paragraph 4 (optional) — PROFESSIONAL STANDARD: Reference the applicable standards (HAAG, NRCA, IRC) that support the determination.

RULES:
- NO run-on paragraphs — 2-4 sentences each
- Professional, authoritative tone
- Tie the evidence together — don't just repeat findings
- Build toward the conclusion logically
- Do NOT pad with filler or repeat minor wear details
- CRITICAL UPPA COMPLIANCE: This is written for a CONTRACTOR. NEVER use "on behalf of," "demand," "appeal," cite 11 NYCRR, § 2601, or any advocacy language. Use factual documentation language — "our analysis identifies," "the documented damage requires," NOT "we demand" or "the carrier must."

Return ONLY a JSON array of paragraph strings: ["paragraph 1...", "paragraph 2...", ...]"""

    response = _call_claude_with_retry(client,
        _step_name="synthesize_conclusion",
        model="claude-opus-4-6",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}]
    )
    paragraphs = _parse_json_response(response.content[0].text)
    if isinstance(paragraphs, list):
        return paragraphs
    return [damage_summary[:500]]


def _estimate_roof_age(config: dict, photo_analysis: dict) -> tuple:
    """Estimate roof age from available data when no explicit age is provided.

    Cascade: explicit age → exposure dating → product timelines → year_built → defaults.
    Returns (int_age_or_None, reasoning_string).
    """
    current_year = datetime.now().year
    structures = config.get("structures", [{}])
    struct = structures[0] if structures else {}
    shingle_type = (struct.get("shingle_type", "") or "").lower()

    # Step 1: Explicit age
    age = struct.get("age")
    if age:
        try:
            return int(age), ""
        except (TypeError, ValueError):
            pass

    data_points = []
    min_ages = []

    is_three_tab = any(kw in shingle_type for kw in ["3-tab", "three-tab", "three tab"])
    is_laminate = any(kw in shingle_type for kw in ["architectural", "laminate", "dimensional"])
    type_label = "three-tab" if is_three_tab else "laminate/architectural" if is_laminate else "asphalt composition"

    if is_three_tab or is_laminate:
        data_points.append(("Shingle Type", f"{type_label.title()} shingle"))

    # Step 2: Exposure-based dating
    measured_exposure = photo_analysis.get("exposure_inches")
    if measured_exposure:
        try:
            exp_val = float(measured_exposure)
        except (TypeError, ValueError):
            exp_val = None
        if exp_val is not None and exp_val <= 5.25:
            if is_laminate:
                min_ages.append(current_year - 2012)
                data_points.append(("Measured Exposure",
                    f'{exp_val}" — pre-metric standard (laminate last manufactured ~2012)'))
            elif is_three_tab:
                min_ages.append(current_year - 2010)
                data_points.append(("Measured Exposure",
                    f'{exp_val}" — pre-metric standard (three-tab last manufactured ~2010)'))
            else:
                min_ages.append(current_year - 2012)
                data_points.append(("Measured Exposure",
                    f'{exp_val}" — pre-metric standard (manufactured prior to ~2012)'))

    # Step 3: Property year built
    year_built = config.get("property", {}).get("year_built_OPTIONAL")
    if year_built:
        try:
            yb = int(year_built)
            building_age = current_year - yb
            data_points.append(("Property Built", f"{yb} per public records"))
            if not min_ages:
                min_ages.append(building_age)
        except (TypeError, ValueError):
            pass

    # Step 4: Combine evidence
    if min_ages:
        estimated_age = max(min_ages)
    elif is_three_tab:
        estimated_age = 18
    elif is_laminate:
        estimated_age = 12
    else:
        return None, ""

    estimated_age = max(1, round(estimated_age))
    reasoning = f"Estimated roof age: ~{estimated_age} years (installed circa {current_year - estimated_age})"
    if data_points:
        reasoning += " — " + "; ".join(f"{label}: {finding}" for label, finding in data_points)

    return estimated_age, reasoning


def _build_code_violations(state: str, line_items: list, trades: list) -> list:
    """Build code violations deterministically from state + scope items.
    NY uses RCNYS codes, others use IRC."""
    violations = []
    state = state.upper()
    is_ny = state == "NY"
    code_prefix = "RCNYS" if is_ny else "IRC"

    # Check what line items are present
    items_text = " ".join(item.get("description", "").lower() for item in line_items)
    has_roofing = any("roofing" in item.get("category", "").lower() for item in line_items)
    has_siding = any("siding" in item.get("category", "").lower() for item in line_items)
    has_drip_edge = "drip edge" in items_text
    has_underlayment = "underlayment" in items_text or "felt" in items_text
    has_flashing = "flashing" in items_text
    has_ice_water = "ice" in items_text and "water" in items_text
    has_house_wrap = "house wrap" in items_text or "tyvek" in items_text

    if has_roofing:
        if has_drip_edge:
            violations.append({
                "code": f"{code_prefix} R905.2.8.5",
                "requirement": "Drip edge required at eaves and rake edges of shingle roofs",
                "status": "Required — included in scope",
            })
        if has_underlayment:
            violations.append({
                "code": f"{code_prefix} R905.1.1",
                "requirement": "Underlayment required beneath roof covering",
                "status": "Required — included in scope",
            })
        if has_ice_water:
            violations.append({
                "code": f"{code_prefix} R905.2.7.1",
                "requirement": "Ice barrier required in areas where annual mean temperature is 40°F or less",
                "status": "Required — included in scope",
            })
        if has_flashing:
            violations.append({
                "code": f"{code_prefix} R903.2.1",
                "requirement": "Flashings shall be installed at wall and roof intersections",
                "status": "Required — included in scope",
            })

    if has_siding:
        if has_house_wrap:
            violations.append({
                "code": f"{code_prefix} R703.1",
                "requirement": "Exterior walls shall provide weather protection with continuous weather-resistant barrier",
                "status": "Required — included in scope",
            })
            violations.append({
                "code": f"{code_prefix} R703.2",
                "requirement": "Weather-resistant exterior wall envelope required behind exterior cladding",
                "status": "Required — house wrap must wrap continuously around outside corners",
            })

    return violations


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

    # Determine state for tax rate — try measurements first, then parse from claim address
    state = prop.get("state", "").upper()
    if not state or len(state) != 2:
        # Parse state from claim address (e.g., "2 Alford Dr, Saddle River, NJ 07458, USA")
        claim_addr = claim.get("address", "")
        import re as _re
        _state_match = _re.search(r'\b([A-Z]{2})\s+\d{5}', claim_addr.upper())
        if _state_match:
            state = _state_match.group(1)
            print(f"[CONFIG] Parsed state '{state}' from claim address: {claim_addr}")
        else:
            state = "NY"
            print(f"[CONFIG] WARNING: Could not determine state — defaulting to NY")
    _tax_rates = {"NY": 0.08, "PA": 0.0, "NJ": 0.06625}
    tax_rate = _tax_rates.get(state, 0.08)
    if state not in _tax_rates:
        print(f"[CONFIG] WARNING: No tax rate configured for state '{state}' — defaulting to 8%. Verify with Tom.")

    # Build line items based on measurements and analysis
    line_items = build_line_items(measurements, photo_analysis, state, user_notes=user_notes or "",
                                  estimate_request=claim.get("estimate_request"))

    # Build deterministic code violations based on state + scope
    deterministic_violations = _build_code_violations(state, line_items, trades)

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
            "office_phone": (company_profile or {}).get("office_phone", "267-332-0197"),
            "website": (company_profile or {}).get("website", ""),
        },
        "property": {
            "address": prop.get("address", claim.get("address", "")),
            "city": prop.get("city", ""),
            "state": state,
            "zip": prop.get("zip", ""),
            "year_built_OPTIONAL": prop.get("year_built", None),
        },
        "insured": {
            "name": (carrier_data or {}).get("carrier", {}).get("insured_name", "") or
                    (carrier_data or {}).get("insured_name", "") or
                    claim.get("homeowner_name", "") or
                    "Property Owner",
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
            "date_of_loss": _format_date(
                claim.get("date_of_loss", "") or (weather_data or {}).get("storm_date", "") or (carrier_data or {}).get("date_of_loss", "") or ""
            ),
            "usarm_inspection_date": datetime.now().strftime("%B %d, %Y"),
            "report_date": datetime.now().strftime("%B %d, %Y"),
        },
        "inspectors": {
            "usarm_inspector": (company_profile or {}).get("contact_name", "Tom Kovack Jr."),
            "usarm_title": (company_profile or {}).get("contact_title", "CEO"),
        },
        "scope": {
            "trades": trades,
            "o_and_p": o_and_p,
        },
        "financials": {
            "tax_rate": tax_rate,
            "price_list": carrier_data.get("price_list", {"NY": "NYBI26", "PA": "PAPI26", "NJ": "NJBI26"}.get(state, "NYBI26")) if carrier_data else {"NY": "NYBI26", "PA": "PAPI26", "NJ": "NJBI26"}.get(state, "NYBI26"),
            "deductible": carrier_data.get("carrier_deductible", 0) if carrier_data else 0,
        },
        "structures": structs,  # shingle_type populated below from photo analysis
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
            "code_violations": deterministic_violations if deterministic_violations else [
                {
                    "code": cv.get("code", ""),
                    "requirement": cv.get("requirement", cv.get("description", "")),
                    "status": cv.get("status", "Non-compliant — requires correction"),
                }
                for cv in photo_analysis.get("code_violations", [])
            ],
            "key_arguments": photo_analysis.get("key_findings", []),
            "total_photos": photo_analysis.get("photo_count", len(photo_filenames)),
        },
        "appeal_letter": {
            "demand_items": [],
            "enclosed_documents": [
                "Forensic Causation Report with annotated photography",
                "Xactimate-format estimate at current pricing",
            ],
            "requested_actions": [
                "Review the enclosed forensic documentation and revised scope of loss",
                "Issue revised payment reflecting the full scope of storm-related damage",
                "Schedule a re-inspection if additional verification is needed",
            ],
        },
        "cover_email": {
            "to": (carrier_data or {}).get("carrier", {}).get("adjuster_name", "") or
                  (f"{claim.get('carrier', '')} Claims Department" if claim.get('carrier') else "Claims Department"),
            "to_email": carrier_data["carrier"].get("adjuster_email", "") if carrier_data else "",
            "summary_paragraphs": [],
            "enclosed_documents": [
                "Forensic Causation Report with annotated photography",
                "Xactimate-format replacement cost estimate",
            ] + ([
                "Supplement report with line-by-line variance analysis",
                "Formal scope clarification letter",
            ] if carrier_data else []) + [
                "Cover correspondence",
            ],
        },
    }

    if carrier_data:
        config["appeal_letter"]["enclosed_documents"].extend([
            "Supplement report with line-by-line variance analysis",
            "Formal appeal letter",
        ])

    # Set correct price list for state if not from carrier
    if not config["financials"].get("price_list"):
        _pl_map = {"NY": "NYBI26", "PA": "PAPI26", "NJ": "NJBI26"}
        config["financials"]["price_list"] = _pl_map.get(state, "NYBI26")

    # Clean trade names: underscores → spaces for display
    trades = [t.replace("_", " ").title() for t in trades]
    config["scope"]["trades"] = trades

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

    # UPPA Compliance — determines language constraints
    # Contractors CANNOT use public adjuster language (UPPA violation)
    # Default to contractor (safest) unless company profile specifies otherwise
    user_role = (company_profile or {}).get("user_role", "contractor")
    config["compliance"] = {
        "user_role": user_role,
        "aob_signed": bool((company_profile or {}).get("aob_signed", False)),
    }

    # Propagate detected roof material into structures[0].shingle_type
    # Photo analysis identifies the material visually; this ensures it's in the config
    detected_material = _detect_roof_material(photo_analysis, user_notes or "", config.get("carrier"),
                                               estimate_request=claim.get("estimate_request"))
    material_labels = {
        "laminated": "Architectural Laminated Comp Shingle",
        "3tab": "3-Tab 25yr Comp Shingle",
        "slate": "Natural Slate",
        "tile": "Clay/Concrete Tile",
        "metal_standing_seam": "Standing Seam Metal",
        "copper": "Copper",
    }
    if config.get("structures") and len(config["structures"]) > 0:
        config["structures"][0]["shingle_type"] = material_labels.get(detected_material, detected_material)

    # Clean structure names: underscores → spaces
    for struct in config.get("structures", []):
        if struct.get("name"):
            struct["name"] = struct["name"].replace("_", " ")

    # Shingle exposure detection — 5" = unrepairable with current products
    exposure = photo_analysis.get("exposure_inches")
    if exposure:
        try:
            exp_val = float(exposure)
            if exp_val <= 5.25:
                finding = (
                    f'Measured shingle exposure of {exp_val}" indicates pre-metric product '
                    f'(manufactured before ~2012). Current metric products are 5-5/8" exposure — '
                    f'mixing creates 5/8" offset per course, full misalignment after 20 courses. '
                    f'No manufacturer will warrant field-cut shingles. Roof is unrepairable by spot repair.'
                )
                config.setdefault("forensic_findings", {}).setdefault("key_arguments", []).append(finding)
        except (TypeError, ValueError):
            pass

    # Roof age estimation
    age, reasoning = _estimate_roof_age(config, photo_analysis)
    if age:
        if config.get("structures") and len(config["structures"]) > 0:
            config["structures"][0]["age"] = age
        if reasoning:
            config.setdefault("forensic_findings", {}).setdefault("key_arguments", []).append(reasoning)

    # Cross-reference carrier line items against USARM line items
    if carrier_data and config.get("carrier", {}).get("carrier_line_items"):
        _cross_reference_line_items(config)

    return config


def _cross_reference_line_items(config: dict) -> None:
    """Populate usarm_desc, usarm_amount, and note on each carrier line item by matching against USARM line items."""
    carrier_items = config.get("carrier", {}).get("carrier_line_items", [])
    line_items = config.get("line_items", [])
    if not line_items:
        return
    if not carrier_items:
        # Empty carrier scope (denial or missing) — fall through to append all USARM items as "NOT INCLUDED"
        carrier_items = []
        config.setdefault("carrier", {})["carrier_line_items"] = carrier_items

    stop_words = {'the', 'a', 'an', 'for', 'of', 'and', 'or', 'w/', 'w/out', '-', 'to', 'per', 'sq', 'lf'}

    def _clean_carrier(name: str) -> str:
        """Strip structure prefixes and trailing item numbers from carrier item names."""
        cleaned = re.sub(
            r'^(shed|dwelling\s*roof|front\s*elevation|rear\s*elevation|'
            r'left\s*elevation|right\s*elevation|debris\s*removal|'
            r'interior|garage|porch)\s*[-–—]\s*', '', name.lower().strip()
        ).strip()
        cleaned = re.sub(r'\s*[-–—]?\s*item\s*\d+\s*$', '', cleaned).strip()
        return cleaned

    def _clean_usarm(desc: str) -> str:
        """Strip R&R prefix from USARM descriptions."""
        return re.sub(r'^r&r\s+', '', desc.lower().strip()).strip()

    # --- Two-pass matching to prevent duplicate USARM assignments ---

    # Pass 1: Score all potential carrier↔USARM matches (match on BOTH item and carrier_desc)
    potential_matches = []  # (score, ci_idx, li_idx, amt, desc)
    for ci_idx, ci in enumerate(carrier_items):
        item_name = ci.get("item", "")
        item_clean = _clean_carrier(item_name)
        desc_raw = ci.get("carrier_desc", "")
        desc_clean = _clean_carrier(desc_raw)
        if not item_clean and not desc_clean:
            continue

        for li_idx, li in enumerate(line_items):
            li_desc = li.get("description", "")
            li_clean = _clean_usarm(li_desc)
            score = 0

            # Try matching on both item and carrier_desc, take the best score
            for candidate in [item_clean, desc_clean]:
                if not candidate:
                    continue
                s = 0
                # Substring match (both directions) — score by match length
                if candidate in li_clean or li_clean in candidate:
                    s = max(len(candidate), len(li_clean))
                # Keyword overlap
                elif len(candidate.split()) >= 3:
                    cand_words = set(candidate.split()) - stop_words
                    li_words = set(li_clean.split()) - stop_words
                    overlap = cand_words & li_words
                    if len(overlap) >= 3 or (len(overlap) >= 2 and len(cand_words) <= 4):
                        s = len(overlap)
                score = max(score, s)

            if score > 0:
                amt = round(li["qty"] * li["unit_price"], 2)
                potential_matches.append((score, ci_idx, li_idx, amt, li_desc))

    # Pass 2: Sort by score desc, greedily assign — each USARM item claimed at most once
    potential_matches.sort(key=lambda x: x[0], reverse=True)
    claimed_usarm = set()
    carrier_matches = {}  # ci_idx -> list of (amt, desc)

    for score, ci_idx, li_idx, amt, desc in potential_matches:
        if li_idx in claimed_usarm:
            continue
        claimed_usarm.add(li_idx)
        carrier_matches.setdefault(ci_idx, []).append((amt, desc))

    # Apply results to carrier items
    for ci_idx, ci in enumerate(carrier_items):
        matches = carrier_matches.get(ci_idx, [])
        if matches:
            total_amt = sum(m[0] for m in matches)
            best_desc = max(matches, key=lambda m: m[0])[1]
            ci["usarm_amount"] = round(total_amt, 2)
            ci["usarm_desc"] = best_desc
            # Generate variance note
            carrier_amt = 0
            try:
                carrier_amt = float(ci.get("carrier_amount", 0))
            except (ValueError, TypeError):
                pass
            if carrier_amt > 0 and total_amt > carrier_amt:
                ci["note"] = f"Carrier underpaid by {round(total_amt - carrier_amt, 2):.2f}"
            elif carrier_amt > 0 and total_amt < carrier_amt:
                ci["note"] = f"Carrier overpaid by {round(carrier_amt - total_amt, 2):.2f}"
            elif carrier_amt > 0:
                ci["note"] = "Amounts match"
            else:
                ci["note"] = "Not in carrier scope"
        else:
            ci["usarm_amount"] = 0
            ci["usarm_desc"] = ""
            ci["note"] = "No matching USARM line item"

    # Append USARM items NOT in carrier scope as "NOT INCLUDED" rows
    for idx, li in enumerate(line_items):
        if idx not in claimed_usarm:
            amt = round(li["qty"] * li["unit_price"], 2)
            if amt < 10:  # Skip trivial items
                continue
            carrier_items.append({
                "item": li.get("description", ""),
                "carrier_desc": "NOT INCLUDED",
                "carrier_amount": 0,
                "usarm_desc": li.get("description", ""),
                "usarm_amount": amt,
                "note": "Carrier scope incomplete — missing component",
            })


def _classify_from_text(text: str) -> Optional[str]:
    """Classify roofing material from a text string.

    Returns one of: 'slate', 'tile', 'metal_standing_seam', 'copper',
    'laminated', '3tab', or None if no material detected.
    """
    if not text:
        return None
    text = text.lower()

    if "slate" in text:
        return "slate"
    if any(kw in text for kw in ["clay tile", "concrete tile", "barrel tile", "terracotta"]):
        return "tile"
    if "tile" in text and any(kw in text for kw in ["roof tile", "tile roof", "clay", "concrete"]):
        return "tile"
    if any(phrase in text for phrase in ["standing seam", "metal roof", "metal roofing", "metal panel roof"]):
        return "metal_standing_seam"
    if "copper roof" in text:
        return "copper"
    if any(kw in text for kw in ["3-tab", "3 tab", "strip shingle"]):
        return "3tab"
    if any(kw in text for kw in ["laminate", "laminated", "architectural", "comp shingle",
                                  "composite shingle", "asphalt shingle", "dimensional shingle"]):
        return "laminated"
    return None


def _majority_vote_material(votes: list) -> str:
    """Resolve material type by majority vote across batch results.

    Specialty materials (slate, tile, metal) take priority in ties
    because they are more specific identifications.
    """
    if not votes:
        return ""

    # Normalize votes to material categories
    categories = {}
    priority = ["slate", "tile", "metal_standing_seam", "copper", "3tab", "laminated"]

    for vote in votes:
        material = _classify_from_text(vote)
        if material:
            categories[material] = categories.get(material, 0) + 1

    if not categories:
        return votes[0]  # fallback to first raw vote

    # Find max count
    max_count = max(categories.values())
    winners = [m for m, c in categories.items() if c == max_count]

    # If tie, prefer specialty materials (earlier in priority list)
    for p in priority:
        if p in winners:
            return p

    return winners[0]


def _detect_roof_material(photo_analysis: dict, user_notes: str = "",
                          carrier_scope: dict = None, estimate_request: dict = None) -> str:
    """Detect roofing material type using triple verification with weighted voting.

    Three independent signals:
    - Photo analysis (weight 1.0): What the AI saw in photos
    - User notes (weight 3.0): What the human explicitly stated
    - Carrier scope line items (weight 2.0): What official documentation says
    - Estimate request override (definitive): Frontend user selection

    Returns one of: 'slate', 'tile', 'metal_standing_seam', 'copper',
    'laminated', '3tab', or defaults to 'laminated'.
    """
    # Definitive override from frontend estimate request
    if estimate_request and estimate_request.get("roof_material"):
        material_map = {
            "3-Tab": "3tab",
            "Laminate Comp Shingle": "laminated",
            "Premium Grade Laminate Comp Shingle": "laminated",
            "Slate": "slate",
            "Standing Seam Metal": "metal_standing_seam",
            "Tile": "tile",
            "Cedar": "laminated",  # Cedar shake uses laminated pricing as closest
        }
        mapped = material_map.get(estimate_request["roof_material"])
        if mapped:
            print(f"[MATERIAL] Using estimate request override: {estimate_request['roof_material']} → {mapped}")
            return mapped

    votes = {}  # material -> weighted score

    # Source 1: Photo analysis (weight 1.0)
    photo_material = _classify_from_text(
        (photo_analysis.get("shingle_type", "") + " " +
         photo_analysis.get("damage_summary", "")).strip()
    )
    if photo_material:
        votes[photo_material] = votes.get(photo_material, 0) + 1.0

    # Source 2: User notes (weight 3.0 — user explicitly stated the material)
    user_material = _classify_from_text(user_notes or "")
    if user_material:
        votes[user_material] = votes.get(user_material, 0) + 3.0

    # Source 3: Carrier scope line items (weight 2.0 — official documentation)
    if carrier_scope and carrier_scope.get("carrier_line_items"):
        # Parse each line item individually to avoid cross-contamination
        carrier_material_votes = {}
        for item in carrier_scope["carrier_line_items"]:
            item_text = str(item.get("item", "")) + " " + str(item.get("carrier_desc", ""))
            mat = _classify_from_text(item_text)
            if mat:
                carrier_material_votes[mat] = carrier_material_votes.get(mat, 0) + 1
        # Use the most common material across individual line items
        if carrier_material_votes:
            carrier_material = max(carrier_material_votes, key=carrier_material_votes.get)
            votes[carrier_material] = votes.get(carrier_material, 0) + 2.0

    if votes:
        return max(votes, key=votes.get)
    return "laminated"  # fallback only when no signals at all


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


def _has_trade(trades: list, keyword: str) -> bool:
    """Fuzzy trade matching — checks if keyword appears in any trade name."""
    kw = keyword.lower()
    return any(kw in t.lower() for t in trades)


def _detect_siding_material(photo_analysis: dict, user_notes: str = "") -> str:
    """Detect siding material from photo analysis and user notes.
    Returns: aluminum, vinyl, vinyl_high, vinyl_insulated, cedar, fiber_cement, metal
    Default: aluminum (safer to price higher)."""
    siding_type = photo_analysis.get("siding_type", "").lower()
    notes = (user_notes or "").lower()

    # Check photo analysis first
    if "vinyl" in siding_type:
        if "insulated" in siding_type or "insulated" in notes:
            return "vinyl_insulated"
        if "premium" in siding_type or "premium" in notes:
            return "vinyl_premium"
        return "vinyl"
    if "cedar" in siding_type:
        return "cedar"
    if "fiber" in siding_type or "hardie" in siding_type or "cement" in siding_type:
        return "fiber_cement"
    if "metal" in siding_type:
        return "metal"
    if "aluminum" in siding_type:
        return "aluminum"

    # Check user notes as fallback
    if "vinyl siding" in notes or "vinyl" in notes:
        return "vinyl"
    if "cedar" in notes:
        return "cedar"
    if "fiber cement" in notes or "hardie" in notes:
        return "fiber_cement"
    if "metal siding" in notes:
        return "metal"

    # Default to aluminum (most common in NY/PA, prices higher = safer estimate)
    return "aluminum"


def build_line_items(measurements: dict, photo_analysis: dict, state: str, user_notes: str = "", estimate_request: dict = None) -> list:
    """Build Xactimate line items from measurements, analysis, and user context."""
    # Use state-specific pricing (PA=PAPI26, NY=NYBI26, etc.)
    PRICING = get_pricing_for_state(state)

    meas = measurements.get("measurements", {})
    structs = measurements.get("structures", [{}])
    struct = structs[0] if structs else {}
    area_sq = struct.get("roof_area_sq", measurements.get("total_roof_area_sq", 0))
    area_sf = struct.get("roof_area_sf", measurements.get("total_roof_area_sf", 0))

    if not area_sq and not area_sf:
        print("[WARN] No roof measurements extracted — all line item quantities will be 0")

    penetrations = measurements.get("penetrations", {})
    facets = struct.get("facets", 0)
    style = struct.get("style", "combination")

    material = _detect_roof_material(photo_analysis, user_notes, estimate_request=estimate_request)

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

    # ===================== ICE & WATER BARRIER (calculate first — needed for underlayment) =====================
    # 2 courses at eaves (6 ft width) + 1 course in valleys (3 ft width) per IRC R905.2.7.1
    iw_sf = (eave * 6) + (valley * 3)

    # ===================== UNDERLAYMENT =====================
    # Felt/synthetic covers the REMAINDER of the roof deck NOT covered by ice & water barrier.
    # I&W goes at eaves + valleys; felt covers the rest of the deck.
    if iw_sf > 0 and area_sf > 0:
        felt_sf = max(0, area_sf - iw_sf)
        felt_sq = round(felt_sf / 100, 2)
    else:
        felt_sq = area_sq  # No I&W = felt covers entire deck

    # ===================== WASTE FACTOR =====================
    # Remove = exact area (0% waste). Install = area + waste (10% gable, 15% hip).
    waste_factor = 1.15 if "hip" in style.lower() else 1.10
    install_sq = round(area_sq * waste_factor, 2)

    # ===================== PRIMARY ROOFING MATERIAL =====================
    # Pricing loaded from backend/pricing/nybi26.json — PRICING.get(key, fallback)
    if material == "slate":
        # Combined R&R for slate (remove + install as single line per USARM standard)
        slate_rr_price = PRICING.get("slate_remove", 325.00) + PRICING.get("slate_install", 1850.00)
        items.append({"category": "ROOFING", "description": "R&R Natural slate roofing - high grade", "qty": area_sq, "unit": "SQ", "unit_price": slate_rr_price})
        items.append({"category": "ROOFING", "description": "Underlayment - felt 30# (deck area not covered by I&W)", "qty": felt_sq, "unit": "SQ", "unit_price": PRICING.get("slate_underlayment", 22.00)})
        items.append({"category": "ROOFING", "description": "Copper nails & hooks for slate", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("slate_nails_hooks", 45.00)})
        items.append({"category": "ROOFING", "description": "Slate roofing - additional labor (specialist)", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("slate_specialist_labor", 350.00)})
        # Scaffold/staging — required for slate work (heavy material, steep pitches)
        items.append({"category": "ROOFING", "description": "Scaffold/staging setup & removal", "qty": 1, "unit": "EA", "unit_price": PRICING.get("scaffold_staging", 1405.00)})
    elif material == "tile":
        items.append({"category": "ROOFING", "description": "Remove concrete/clay tile roofing", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("tile_remove", 200.00)})
        items.append({"category": "ROOFING", "description": "Concrete/clay tile roofing", "qty": install_sq, "unit": "SQ", "unit_price": PRICING.get("tile_install", 900.00)})
        items.append({"category": "ROOFING", "description": "Underlayment - felt 30# (deck area not covered by I&W)", "qty": felt_sq, "unit": "SQ", "unit_price": PRICING.get("tile_underlayment", 22.00)})
    elif material == "metal_standing_seam":
        items.append({"category": "ROOFING", "description": "Remove metal roofing - standing seam", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("metal_remove", 150.00)})
        items.append({"category": "ROOFING", "description": "Metal roofing - standing seam", "qty": install_sq, "unit": "SQ", "unit_price": PRICING.get("metal_install", 850.00)})
        items.append({"category": "ROOFING", "description": "Underlayment - felt 15# (deck area not covered by I&W)", "qty": felt_sq, "unit": "SQ", "unit_price": PRICING.get("metal_underlayment", 32.00)})
    elif material == "laminated":
        items.append({"category": "ROOFING", "description": "Remove laminated comp shingle roofing", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("laminated_remove", 74.00)})
        items.append({"category": "ROOFING", "description": "Laminated comp shingle roofing - w/out felt", "qty": install_sq, "unit": "SQ", "unit_price": PRICING.get("laminated_install", 320.00)})
        items.append({"category": "ROOFING", "description": "Underlayment - felt 15# (deck area not covered by I&W)", "qty": felt_sq, "unit": "SQ", "unit_price": PRICING.get("laminated_underlayment", 32.00)})
    else:  # 3tab
        items.append({"category": "ROOFING", "description": "Remove 3-tab 25yr comp shingle roofing", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("3tab_remove", 73.14)})
        items.append({"category": "ROOFING", "description": "3-tab 25yr comp shingle roofing - w/out felt", "qty": install_sq, "unit": "SQ", "unit_price": PRICING.get("3tab_install", 312.92)})
        items.append({"category": "ROOFING", "description": "Underlayment - felt 15# (deck area not covered by I&W)", "qty": felt_sq, "unit": "SQ", "unit_price": PRICING.get("3tab_underlayment", 32.00)})

    # ===================== ICE & WATER BARRIER =====================
    if iw_sf > 0:
        items.append({"category": "ROOFING", "description": "Ice & water barrier (2 courses eaves + 1 course valleys)", "qty": round(iw_sf), "unit": "SF", "unit_price": PRICING.get("ice_water", 2.24)})

    # ===================== DRIP EDGE =====================
    drip = meas.get("drip_edge", 0) or (eave + rake)
    if drip > 0:
        if material in ("copper", "slate") and "copper" in notes_lower:
            items.append({"category": "ROOFING", "description": "R&R Drip edge - copper", "qty": drip, "unit": "LF", "unit_price": PRICING.get("drip_edge_copper", 18.50)})
        else:
            items.append({"category": "ROOFING", "description": "R&R Drip edge - aluminum", "qty": drip, "unit": "LF", "unit_price": PRICING.get("drip_edge_aluminum", 4.25)})

    # ===================== STARTER STRIP (comp shingle — eaves + rakes) =====================
    starter_lf = eave + rake
    if material in ("laminated", "3tab") and starter_lf > 0:
        items.append({"category": "ROOFING", "description": "R&R Starter strip - asphalt shingle", "qty": starter_lf, "unit": "LF", "unit_price": PRICING.get("starter_strip", 3.50)})

    # ===================== RIDGE CAP (ridges + hips) =====================
    ridge_hip_lf = ridge + hip
    if ridge_hip_lf > 0:
        if material == "slate":
            items.append({"category": "ROOFING", "description": "R&R Ridge cap - slate", "qty": ridge_hip_lf, "unit": "LF", "unit_price": PRICING.get("slate_ridge_cap", 38.00)})
        elif material == "tile":
            items.append({"category": "ROOFING", "description": "R&R Ridge cap - tile", "qty": ridge_hip_lf, "unit": "LF", "unit_price": PRICING.get("tile_ridge_cap", 28.00)})
        elif material == "metal_standing_seam":
            items.append({"category": "ROOFING", "description": "R&R Ridge cap - metal", "qty": ridge_hip_lf, "unit": "LF", "unit_price": PRICING.get("metal_ridge_cap", 22.00)})
        else:
            desc = "R&R Ridge cap - laminated" if material == "laminated" else "R&R Ridge cap - 3 tab"
            items.append({"category": "ROOFING", "description": desc, "qty": ridge_hip_lf, "unit": "LF", "unit_price": PRICING.get("laminated_ridge_cap", 7.49)})

    # ===================== RIDGE VENT (ridges only — shingle-over style) =====================
    if ridge > 0 and material not in ("slate", "tile"):
        items.append({"category": "ROOFING", "description": "R&R Ridge vent - shingle over", "qty": ridge, "unit": "LF", "unit_price": PRICING.get("ridge_vent", 8.50)})

    # ===================== COPPER VALLEY FLASHING (slate/tile — valleys require copper) =====================
    if valley > 0 and material in ("slate", "tile"):
        items.append({"category": "ROOFING", "description": "R&R Valley flashing - copper", "qty": valley, "unit": "LF", "unit_price": PRICING.get("copper_valley_flashing", 32.00)})

    # ===================== SKYLIGHT FLASHING =====================
    skylights = penetrations.get("skylights", 0)
    if skylights > 0:
        items.append({"category": "ROOFING", "description": "R&R Skylight flashing kit", "qty": skylights, "unit": "EA", "unit_price": PRICING.get("skylight_flashing", 275.00)})

    # ===================== FLASHING =====================
    step = meas.get("step_flashing", 0)
    flashing = meas.get("flashing", 0)
    # Slate and tile roofs use copper flashing by default (standard practice)
    is_copper_flashing = material in ("slate", "tile") or ("copper" in notes_lower and "flash" in notes_lower)

    if step > 0:
        if is_copper_flashing:
            items.append({"category": "ROOFING", "description": "R&R Step flashing - copper", "qty": step, "unit": "LF", "unit_price": PRICING.get("step_flashing_copper", 22.00)})
        else:
            items.append({"category": "ROOFING", "description": "R&R Step flashing", "qty": step, "unit": "LF", "unit_price": PRICING.get("step_flashing", 8.00)})

    if flashing > 0:
        if is_copper_flashing:
            items.append({"category": "ROOFING", "description": "R&R Counter/apron flashing - copper", "qty": flashing, "unit": "LF", "unit_price": PRICING.get("counter_flashing_copper", 28.00)})
        else:
            items.append({"category": "ROOFING", "description": "R&R Counter/apron flashing", "qty": flashing, "unit": "LF", "unit_price": PRICING.get("counter_flashing", 9.50)})

    # ===================== CHIMNEY FLASHING =====================
    # Step + counter/apron flashing around chimney perimeter. ~20 LF per chimney (standard).
    chimneys = penetrations.get("chimneys", 0)
    if chimneys > 0:
        chimney_lf = chimneys * 20  # ~20 LF perimeter per chimney
        if is_copper_flashing:
            items.append({"category": "ROOFING", "description": "R&R Chimney flashing - copper", "qty": chimney_lf, "unit": "LF", "unit_price": PRICING.get("chimney_flashing_copper_lf", 18.42)})
        else:
            items.append({"category": "ROOFING", "description": "R&R Chimney flashing", "qty": chimney_lf, "unit": "LF", "unit_price": PRICING.get("chimney_flashing_lf", 15.57)})

    # ===================== PENETRATIONS =====================
    pipes = penetrations.get("pipes", 0)
    if pipes > 0:
        items.append({"category": "ROOFING", "description": "Pipe boot/jack", "qty": pipes, "unit": "EA", "unit_price": PRICING.get("pipe_boot", 68.00)})

    vents = penetrations.get("vents", 0)
    if vents > 0:
        items.append({"category": "ROOFING", "description": "R&R Exhaust vent", "qty": vents, "unit": "EA", "unit_price": PRICING.get("exhaust_vent", 125.00)})

    # ===================== STEEP CHARGES =====================
    # Per-facet steep charges from EagleView pitches — separate REMOVE + INSTALL lines.
    # Tiers: 7/12–9/12, 10/12–12/12, >12/12. Applied to the SF at each pitch tier.
    pitches = struct.get("pitches", [])
    steep_7_9_sf = 0
    steep_10_12_sf = 0
    steep_gt12_sf = 0

    if pitches:
        # Use per-facet pitch data from EagleView when available
        for p in pitches:
            p_str = p.get("pitch", "")
            p_area = p.get("area_sf", 0)
            try:
                rise = int(str(p_str).split("/")[0])
            except (ValueError, IndexError):
                continue
            if rise > 12:
                steep_gt12_sf += p_area
            elif rise >= 10:
                steep_10_12_sf += p_area
            elif rise >= 7:
                steep_7_9_sf += p_area
    else:
        # Fallback: use predominant pitch applied to full roof area
        if pitch_str:
            try:
                rise = int(pitch_str.split("/")[0])
                if rise > 12:
                    steep_gt12_sf = area_sf
                elif rise >= 10:
                    steep_10_12_sf = area_sf
                elif rise >= 7:
                    steep_7_9_sf = area_sf
            except (ValueError, IndexError):
                pass

    if steep_7_9_sf > 0:
        steep_sq = round(steep_7_9_sf / 100, 2)
        items.append({"category": "ROOFING", "description": "Remove - Additional charge for steep roof 7/12-9/12", "qty": steep_sq, "unit": "SQ", "unit_price": PRICING.get("steep_remove_7_9", 18.00)})
        items.append({"category": "ROOFING", "description": "Additional charge for steep roof 7/12-9/12", "qty": steep_sq, "unit": "SQ", "unit_price": PRICING.get("steep_install_7_9", 64.07)})

    if steep_10_12_sf > 0:
        steep_sq = round(steep_10_12_sf / 100, 2)
        items.append({"category": "ROOFING", "description": "Remove - Additional charge for steep roof 10/12-12/12", "qty": steep_sq, "unit": "SQ", "unit_price": PRICING.get("steep_remove_10_12", 28.29)})
        items.append({"category": "ROOFING", "description": "Additional charge for steep roof 10/12-12/12", "qty": steep_sq, "unit": "SQ", "unit_price": PRICING.get("steep_install_10_12", 100.73)})

    if steep_gt12_sf > 0:
        steep_sq = round(steep_gt12_sf / 100, 2)
        items.append({"category": "ROOFING", "description": "Remove - Additional charge for steep roof >12/12", "qty": steep_sq, "unit": "SQ", "unit_price": PRICING.get("steep_remove_gt12", 36.24)})
        items.append({"category": "ROOFING", "description": "Additional charge for steep roof >12/12", "qty": steep_sq, "unit": "SQ", "unit_price": PRICING.get("steep_install_gt12", 131.43)})

    # ===================== HIGH ROOF CHARGE =====================
    # Only when property is 2+ stories. Separate REMOVE + INSTALL lines on full roof area.
    stories = measurements.get("stories", 1)
    if stories >= 2:
        items.append({"category": "ROOFING", "description": "Remove - Additional charge for high roof (2+ stories)", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("high_roof_remove", 7.31)})
        items.append({"category": "ROOFING", "description": "Additional charge for high roof (2+ stories)", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("high_roof_install", 30.44)})

    # ===================== ROOFING LABOR & EQUIPMENT =====================
    # 8 roofer hours on every roofing estimate (industry standard)
    items.append({"category": "ROOFING", "description": "Roofer - per hour (labor minimum)", "qty": 8, "unit": "HR", "unit_price": PRICING.get("roofer_per_hour", 194.00)})
    items.append({"category": "ROOFING", "description": "Equipment operator", "qty": 1, "unit": "EA", "unit_price": PRICING.get("equipment_operator", 450.00)})

    # ===================== GABLE CORNICE RETURNS =====================
    # Included on gable and combination roofs — decorative trim at gable ends
    if style in ("gable", "combination"):
        # Estimate 2 cornice returns per gable end (1 per side)
        # Gable roof = 2 gable ends = 4 returns; combination = estimate 2 returns
        cornice_count = 4 if style == "gable" else 2
        if material in ("laminated", "3tab"):
            mat_label = "laminated" if material == "laminated" else "3tab"
            if stories >= 2:
                cornice_key = f"gable_cornice_return_{mat_label}_2story"
                items.append({"category": "ROOFING", "description": f"R&R Gable cornice return - {material} - 2+ stories", "qty": cornice_count, "unit": "EA", "unit_price": PRICING.get(cornice_key, 165.29)})
            else:
                cornice_key = f"gable_cornice_return_{mat_label}"
                items.append({"category": "ROOFING", "description": f"R&R Gable cornice return - {material}", "qty": cornice_count, "unit": "EA", "unit_price": PRICING.get(cornice_key, 136.32)})

    # ===================== DEBRIS =====================
    # Slate/tile debris is significantly heavier — smaller loads, higher price per load
    if material in ("slate", "tile"):
        dumpster_loads = max(2, round(area_sq / 15))  # More loads for heavy material
        items.append({"category": "DEBRIS", "description": "Dumpster load - heavy roofing debris (slate/tile)", "qty": dumpster_loads, "unit": "EA", "unit_price": PRICING.get("dumpster_heavy", 950.00)})
    else:
        dumpster_loads = max(1, round(area_sq / 25))
        items.append({"category": "DEBRIS", "description": "Dumpster load - roofing debris", "qty": dumpster_loads, "unit": "EA", "unit_price": PRICING.get("dumpster", 850.00)})

    # ===================== COPPER COMPONENTS (from user notes) =====================
    if "copper" in notes_lower:
        # Copper half round gutters
        if "half round" in notes_lower or ("copper" in notes_lower and "gutter" in notes_lower):
            gutter_lf = round(eave * 1.6) if eave > 0 else 0
            if gutter_lf > 0:
                items.append({"category": "GUTTERS", "description": "R&R Copper half round gutter & downspout", "qty": gutter_lf, "unit": "LF", "unit_price": PRICING.get("gutter_copper_half_round", 55.00)})

        # Flat panel copper (lower slopes)
        if "flat panel copper" in notes_lower or "flat seam copper" in notes_lower:
            # Estimate lower slope area as ~20% of total roof area if not specified
            copper_sf = round(area_sf * 0.20)
            if copper_sf > 0:
                items.append({"category": "ROOFING", "description": "R&R Flat seam copper roofing", "qty": copper_sf, "unit": "SF", "unit_price": PRICING.get("flat_seam_copper", 28.00)})

    # ===================== GUTTERS (standard — if in trades and not already added) =====================
    trades = photo_analysis.get("trades_identified", [])
    has_gutter_line = any("gutter" in item["description"].lower() for item in items)
    if _has_trade(trades, "gutter") and not has_gutter_line:
        gutter_lf = round(eave * 1.6) if eave > 0 else 0
        if gutter_lf > 0:
            items.append({"category": "GUTTERS", "description": "R&R Seamless aluminum gutter & downspout", "qty": gutter_lf, "unit": "LF", "unit_price": PRICING.get("gutter_aluminum", 10.50)})

    # ===================== SIDING =====================
    # Triggered when photos identify siding damage. ALWAYS includes house wrap
    # (RCNYS R703.2 — continuous weather-resistant exterior wall envelope required).
    # House wrap corner rule forces full replacement when carrier approves partial.
    if _has_trade(trades, "siding"):
        walls = measurements.get("walls", {})
        wall_area = walls.get("total_wall_area_sf", 0)

        if wall_area > 0:
            siding_mat = _detect_siding_material(photo_analysis, user_notes)
            print(f"[LINE ITEMS] Siding trade detected — {siding_mat}, {wall_area} SF")

            # Siding material pricing map
            siding_prices = {
                "aluminum": ("R&R Aluminum siding .024\"", PRICING.get("siding_aluminum_024", 12.47)),
                "vinyl": ("R&R Vinyl siding", PRICING.get("siding_vinyl", 7.55)),
                "vinyl_high": ("R&R Vinyl siding - high grade", PRICING.get("siding_vinyl_high", 7.83)),
                "vinyl_premium": ("R&R Vinyl siding - premium", PRICING.get("siding_vinyl_premium", 8.21)),
                "vinyl_insulated": ("R&R Vinyl siding - insulated", PRICING.get("siding_vinyl_insulated", 11.45)),
                "cedar": ("R&R Cedar shingle siding", PRICING.get("siding_cedar_shingle", 18.13)),
                "fiber_cement": ("R&R Fiber cement siding", PRICING.get("siding_vinyl_insulated", 11.45)),
                "metal": ("R&R Metal siding .019\"", PRICING.get("siding_metal_019", 12.20)),
            }
            desc, price = siding_prices.get(siding_mat, siding_prices["aluminum"])
            items.append({"category": "SIDING", "description": desc, "qty": wall_area, "unit": "SF", "unit_price": price})

            # House wrap — ALWAYS included with siding (RCNYS R703.2 code requirement)
            # This is the key argument: house wrap must wrap continuously around outside
            # corners — cannot terminate at a corner joint. Forces full replacement.
            items.append({"category": "SIDING", "description": "House wrap / Tyvek (code-required per RCNYS R703.2)", "qty": wall_area, "unit": "SF", "unit_price": PRICING.get("house_wrap", 0.64)})

            # Fanfold insulation (under siding, standard on re-side jobs)
            items.append({"category": "SIDING", "description": "Fanfold insulation board", "qty": wall_area, "unit": "SF", "unit_price": PRICING.get("fanfold_insulation", 1.23)})

            # Siding labor minimum
            items.append({"category": "SIDING", "description": "Siding labor minimum", "qty": 1, "unit": "EA", "unit_price": PRICING.get("siding_labor_min", 519.46)})

            # Scaffolding
            items.append({"category": "SIDING", "description": "Scaffolding - per week", "qty": 1, "unit": "WK", "unit_price": PRICING.get("scaffolding_week", 1405.00)})
        else:
            print(f"[LINE ITEMS] Siding trade detected but no wall measurements — skipping siding line items")

    # ===================== WINDOW WRAPS =====================
    # Included when siding is in scope — windows need re-wrapping after siding replacement
    if _has_trade(trades, "siding") or _has_trade(trades, "window"):
        walls = measurements.get("walls", {})
        window_count = walls.get("window_count", 0)
        wall_area = walls.get("total_wall_area_sf", 0)

        # If no explicit window count, estimate from wall area (1 window per 150 SF)
        if window_count == 0 and wall_area > 0:
            window_count = max(1, round(wall_area / 150))
            print(f"[LINE ITEMS] Estimated {window_count} windows from {wall_area} SF wall area")

        if window_count > 0:
            items.append({"category": "SIDING", "description": "R&R Window wrap - aluminum coil stock", "qty": window_count, "unit": "EA", "unit_price": PRICING.get("window_wrap_small", 256.48)})

    # ===================== DOOR WRAPS =====================
    if _has_trade(trades, "siding"):
        walls = measurements.get("walls", {})
        door_count = walls.get("door_count", 0)
        garage_door_count = walls.get("garage_door_count", 0)

        if door_count > 0:
            # Standard door perimeter ~17 LF
            door_lf = door_count * 17
            items.append({"category": "SIDING", "description": "R&R Door frame wrap - aluminum coil stock", "qty": door_lf, "unit": "LF", "unit_price": PRICING.get("door_wrap_aluminum_lf", 27.51)})

        if garage_door_count > 0:
            # Garage door perimeter ~34 LF (wider opening)
            garage_lf = garage_door_count * 34
            items.append({"category": "SIDING", "description": "R&R Garage door wrap - aluminum coil stock", "qty": garage_lf, "unit": "LF", "unit_price": PRICING.get("garage_door_wrap_lf", 24.55)})

    return items


# ===================================================================
# PDF GENERATION
# ===================================================================

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
# Cross-platform Chrome path: local macOS first, then Docker/Linux chromium
_CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
]
CHROME = next((c for c in _CHROME_CANDIDATES if os.path.exists(c)), _CHROME_CANDIDATES[0])
# Generator: bundled local copy first, then CLI platform directory
_GENERATOR_CANDIDATES = [
    os.path.join(BACKEND_DIR, "usarm_pdf_generator.py"),
    os.path.expanduser("~/USARM-Claims-Platform/usarm_pdf_generator.py"),
]
GENERATOR_PATH = next((g for g in _GENERATOR_CANDIDATES if os.path.exists(g)), _GENERATOR_CANDIDATES[-1])


def load_carrier_playbook(carrier_name: str) -> str:
    """Load carrier playbook markdown for synthesis context. Returns empty string if not found."""
    if not carrier_name:
        return ""
    slug = carrier_name.lower().replace("/", "-").replace(" ", "-").replace("--", "-").strip("-")
    # Check backend local copy first, then platform directory
    for base in [os.path.join(BACKEND_DIR, "carrier_playbooks"),
                 os.path.join(os.path.expanduser("~/USARM-Claims-Platform"), "carrier_playbooks")]:
        path = os.path.join(base, f"{slug}.md")
        if os.path.exists(path):
            try:
                with open(path) as f:
                    content = f.read()
                # Return first 2000 chars to keep prompt manageable
                return content[:2000]
            except Exception:
                pass
    return ""


def load_reference_file(name: str) -> str:
    """Load a reference file for synthesis context. Returns empty string if not found."""
    for base in [os.path.join(BACKEND_DIR, "references"),
                 os.path.join(os.path.expanduser("~/USARM-Claims-Platform"), "references")]:
        path = os.path.join(base, name)
        if os.path.exists(path):
            try:
                with open(path) as f:
                    return f.read()[:3000]
            except Exception:
                pass
    return ""


VALIDATOR_PATH = os.path.join(os.path.dirname(__file__), "validate_config.py")
if not os.path.exists(VALIDATOR_PATH):
    VALIDATOR_PATH = os.path.expanduser("~/USARM-Claims-Platform/validate_config.py")


def generate_pdfs(config: dict, work_dir: str) -> list[str]:
    """Generate PDF package using the USARM PDF generator.

    Runs validate_config.py --fix before generation to catch all 40+ documented
    error patterns (E001-E040). Validation failures are logged but do not block
    generation — the generator has its own fallback handling.
    """
    # Write config to work directory
    config_path = os.path.join(work_dir, "claim_config.json")
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)

    # Run validation + auto-fix before generation (catches E001-E040)
    if os.path.exists(VALIDATOR_PATH):
        try:
            val_result = subprocess.run(
                ["python3", VALIDATOR_PATH, config_path, "--fix"],
                capture_output=True, text=True,
                cwd=os.path.dirname(VALIDATOR_PATH),
                timeout=30,
            )
            if val_result.returncode != 0:
                print(f"[VALIDATE] Warnings found (continuing with generation):")
                for line in (val_result.stdout + val_result.stderr).strip().split("\n")[-10:]:
                    print(f"  {line}")
            else:
                print(f"[VALIDATE] Config passed validation")
            # Re-read config after --fix may have modified it
            with open(config_path) as f:
                config = json.load(f)
        except Exception as e:
            print(f"[VALIDATE] Validation skipped (non-fatal): {e}")

    # Run the generator
    result = subprocess.run(
        ["python3", GENERATOR_PATH, config_path],
        capture_output=True, text=True, cwd=work_dir,
        timeout=300,
    )

    if result.returncode != 0:
        print(f"[GENERATOR] stderr: {result.stderr}")
        print(f"[GENERATOR] stdout: {result.stdout[-2000:]}")
        error_detail = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"PDF generator failed: {error_detail[-500:]}")

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
    global _TELEMETRY_SB, _TELEMETRY_CLAIM_ID
    sb = get_supabase_client()
    claude = get_anthropic_client()

    # Enable telemetry for all Claude calls during this claim
    _TELEMETRY_SB = sb
    _TELEMETRY_CLAIM_ID = claim_id

    # 1. Get claim from database
    result = sb.table("claims").select("*").eq("id", claim_id).single().execute()
    claim = result.data
    if not claim:
        raise ValueError(f"Claim {claim_id} not found")

    # Detect if this is a REVISION (claim was already processed before)
    is_revision = bool(claim.get("output_files"))
    previous_carrier_data = None
    original_carrier_rcv = 0

    if is_revision:
        print(f"[PROCESS] Starting REVISED claim: {claim['address']} ({claim['phase']}) — revision detected")
        # Load previous carrier data from DB or local claim config
        previous_carrier_data = claim.get("previous_carrier_data")
        original_carrier_rcv = claim.get("original_carrier_rcv", 0)

        if not previous_carrier_data:
            # Try reading from local claim config
            slug = claim.get("slug", "")
            if not slug:
                slug = claim["address"].lower().replace(",", "").replace("  ", " ").replace(" ", "-").strip("-")
            local_config_path = os.path.join(PLATFORM_DIR, "claims", slug, "claim_config.json")
            if os.path.exists(local_config_path):
                try:
                    with open(local_config_path) as f:
                        prev_config = json.load(f)
                    previous_carrier_data = {
                        "carrier_rcv": prev_config.get("carrier", {}).get("carrier_rcv", 0),
                        "carrier_line_items": prev_config.get("carrier", {}).get("carrier_line_items", []),
                        "carrier_arguments": prev_config.get("carrier", {}).get("carrier_arguments", []),
                    }
                    if not original_carrier_rcv:
                        original_carrier_rcv = prev_config.get("dashboard", {}).get("carrier_1st_scope", 0) or prev_config.get("carrier", {}).get("carrier_rcv", 0)
                    print(f"[REVISION] Loaded previous carrier data from local config: ${previous_carrier_data['carrier_rcv']:,.2f}")
                except Exception as e:
                    print(f"[REVISION] Could not load previous config (non-fatal): {e}")

        # Save current carrier data as previous BEFORE reprocessing (for future revisions)
        if previous_carrier_data:
            try:
                sb.table("claims").update({
                    "previous_carrier_data": previous_carrier_data,
                    "original_carrier_rcv": original_carrier_rcv or previous_carrier_data.get("carrier_rcv", 0),
                }).eq("id", claim_id).execute()
            except Exception:
                pass  # DB columns may not exist yet — that's OK
    else:
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
    if not company_profile:
        company_profile = {
            "company_name": "USA ROOF MASTERS",
            "address": "3070 Bristol Pike, Building 1, Suite 122",
            "city_state_zip": "Bensalem, PA 19020",
            "contact_name": "Tom Kovack Jr.",
            "contact_title": "CEO",
            "email": "TKovack@USARoofMasters.com",
            "phone": "267-679-1504",
            "office_phone": "267-332-0197",
            "website": "www.USARoofMasters.com",
            "user_role": "contractor",
        }
        print("[PROCESS] No company profile — using USARM defaults")

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

        # Fallback: Copy logo if no user logo downloaded
        logo_dest = os.path.join(photos_dir, "usarm_logo.jpg")
        if not os.path.exists(logo_dest):
            import shutil
            # Try iCloud (macOS local dev)
            icloud_logo = os.path.expanduser(
                "~/Library/Mobile Documents/com~apple~CloudDocs/logo-version-2-2 2.JPG"
            )
            # Try bundled USARM default (cloud)
            bundled_logo = os.path.join(BACKEND_DIR, "assets", "usarm_logo.jpg")
            for src in [icloud_logo, bundled_logo]:
                if os.path.exists(src):
                    shutil.copy2(src, logo_dest)
                    print(f"[PROCESS] Logo copied from {os.path.basename(os.path.dirname(src))}")
                    break

        file_path = claim["file_path"]  # e.g. "user-id/123-main-st"

        # 2b. Reconcile storage vs DB — if files exist in storage but DB arrays are empty, fix DB
        reconcile_map = {
            "measurements": "measurement_files",
            "photos": "photo_files",
            "scope": "scope_files",
            "weather": "weather_files",
        }
        db_updates = {}
        for folder, db_field in reconcile_map.items():
            db_files = claim.get(db_field) or []
            if not db_files:
                try:
                    storage_list = sb.storage.from_("claim-documents").list(f"{file_path}/{folder}")
                    real_files = [f["name"] for f in (storage_list or []) if f.get("name") and f["name"] != ".emptyFolderPlaceholder"]
                    if real_files:
                        print(f"[RECONCILE] {db_field} was empty but storage has {len(real_files)} file(s): {real_files} — fixing DB")
                        db_updates[db_field] = real_files
                        claim[db_field] = real_files
                except Exception as e:
                    print(f"[RECONCILE] Could not list {folder}: {e}")
        if db_updates:
            try:
                sb.table("claims").update(db_updates).eq("id", claim_id).execute()
                print(f"[RECONCILE] DB updated with {len(db_updates)} field(s)")
            except Exception as e:
                print(f"[RECONCILE] DB update failed (non-fatal): {e}")

        # 3. Download measurement files
        measurement_paths = []
        for fname in claim.get("measurement_files", []):
            local = os.path.join(source_dir, fname)
            download_file(sb, "claim-documents", f"{file_path}/measurements/{fname}", local)
            measurement_paths.append(local)

        # 4. Download photos — handles any format: images, ZIPs, PDFs
        #    Uses shared photo_utils for format-agnostic ingestion
        photo_paths = []
        photo_filenames = []
        downloaded_paths = []
        for fname in claim.get("photo_files", []):
            local = os.path.join(photos_dir, fname)
            download_file(sb, "claim-documents", f"{file_path}/photos/{fname}", local)
            downloaded_paths.append(local)

        # Ingest all downloaded files — extracts ZIPs, PDFs, converts HEIC/TIFF/etc.
        photo_paths = ingest_photos(downloaded_paths, photos_dir)
        photo_filenames = [os.path.basename(p) for p in photo_paths]

        if not photo_paths:
            print(f"[PHOTOS] WARNING: No usable photos found from {len(downloaded_paths)} uploaded files")

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

        # 6-8b. Extract all data in parallel via asyncio.to_thread
        # Measurements, photos, integrity, scope, and weather are independent
        # Running in parallel cuts processing from ~7min to ~3-4min
        _default_photo = {"trades_identified": ["roofing"], "photo_annotations": {}, "photo_count": 0}
        _default_integrity = {"total": 0, "flagged": 0, "score": "N/A", "summary": "", "findings": []}

        async def _get_measurements():
            if not measurement_paths:
                return {}
            resolved = resolve_eml_to_document(measurement_paths[0], source_dir)
            print("[PROCESS] Extracting measurements...")
            return await asyncio.to_thread(extract_measurements, claude, resolved)

        async def _get_photo_analysis():
            if not photo_paths:
                return _default_photo
            print(f"[PROCESS] Analyzing {len(photo_paths)} photos...")
            return await asyncio.to_thread(analyze_photos, claude, photo_paths, user_notes=claim.get("user_notes"))

        async def _get_photo_integrity():
            if not photo_paths:
                return _default_integrity
            print("[PROCESS] Running photo integrity analysis...")
            try:
                result = await asyncio.to_thread(analyze_photo_integrity, claude, photo_paths)
                print(f"[INTEGRITY] {result['total']} photos analyzed — {result['flagged']} flagged — Score: {result['score']}")
                return result
            except Exception as e:
                print(f"[INTEGRITY] Analysis failed (non-fatal): {e}")
                return _default_integrity

        async def _get_carrier_data():
            if not scope_paths:
                return None
            resolved = resolve_eml_to_document(scope_paths[-1], source_dir)
            print(f"[PROCESS] Extracting carrier scope ({len(scope_paths)} file(s))...")
            return await asyncio.to_thread(extract_carrier_scope, claude, resolved)

        async def _get_weather_data():
            if not weather_paths:
                return {}
            resolved = resolve_eml_to_document(weather_paths[0], source_dir)
            print("[PROCESS] Extracting weather data...")
            return await asyncio.to_thread(extract_weather_data, claude, resolved)

        print("[PROCESS] Running extraction steps in parallel...")
        measurements, photo_analysis, photo_integrity, carrier_data, weather_data = await asyncio.gather(
            _get_measurements(),
            _get_photo_analysis(),
            _get_photo_integrity(),
            _get_carrier_data(),
            _get_weather_data(),
        )

        # 8c. Search for corroborating weather reports (NOAA, news, social media)
        city = measurements.get("property", {}).get("city", "")
        state = measurements.get("property", {}).get("state", "")
        storm_date = (weather_data or {}).get("storm_date", "")
        corroborating_reports = []
        if city and storm_date:
            print(f"[PROCESS] Searching for corroborating weather reports...")
            try:
                corroborating_reports = search_weather_corroboration(city, state, storm_date)
            except Exception as e:
                print(f"[WEATHER] Corroboration search failed (non-fatal): {e}")

        # 9. Build claim config
        print(f"[PROCESS] Building claim config...")
        config = build_claim_config(
            claim, measurements, photo_analysis, carrier_data, photo_filenames, weather_data, company_profile,
            user_notes=claim.get("user_notes"),
            photo_integrity=photo_integrity,
        )

        # Flag measurement extraction failures for downstream warning
        meas_structs = measurements.get("structures", [{}])
        meas_struct = meas_structs[0] if meas_structs else {}
        meas_area = meas_struct.get("roof_area_sf", measurements.get("total_roof_area_sf", 0))
        if not meas_area:
            config.setdefault("warnings", []).append("MEASUREMENT_EXTRACTION_FAILED")
            print("[WARN] Flagged config with MEASUREMENT_EXTRACTION_FAILED warning")

        # Add corroborating weather reports to config
        if corroborating_reports:
            config["weather"]["corroborating_reports"] = corroborating_reports

        # 9a. NOAA Weather + Damage Thresholds (auto-populate if address + storm date available)
        try:
            from noaa_weather.api import NOAAClient
            from noaa_weather.geocode import geocode_address, build_address_from_config
            from noaa_weather.analyzer import ThresholdAnalyzer
            from noaa_weather.report import apply_to_config as noaa_apply_to_config

            address_str = build_address_from_config(config)
            storm_date = config.get("weather", {}).get("storm_date", "") or \
                         config.get("dates", {}).get("date_of_loss", "")
            if address_str and storm_date:
                geo = geocode_address(address_str)
                if geo:
                    noaa_client = NOAAClient()
                    storm_data = noaa_client.query(geo.latitude, geo.longitude, storm_date, address=address_str)
                    if storm_data and storm_data.event_count > 0:
                        analyzer = ThresholdAnalyzer()
                        analysis = analyzer.analyze(config, storm_data)
                        noaa_apply_to_config(config, storm_data, analysis)
                        print(f"[NOAA] Found {storm_data.event_count} storm events, "
                              f"max hail: {storm_data.max_hail_inches}\"")
                    else:
                        print(f"[NOAA] No storm events found for {address_str} on {storm_date}")
                else:
                    print(f"[NOAA] Could not geocode address: {address_str}")
        except Exception as e:
            print(f"[NOAA] Weather query failed (non-fatal): {e}")

        # 9a2. Inject carrier intelligence from data warehouse
        try:
            carrier_name = config.get("carrier", {}).get("name", "")
            if carrier_name and sb:
                tactics = sb.table("carrier_tactics").select("*").eq("carrier_name", carrier_name).execute()
                outcomes = sb.table("claim_outcomes").select("*").eq("carrier", carrier_name).execute()
                if (tactics.data or outcomes.data):
                    wins = [o for o in (outcomes.data or []) if o.get("outcome") == "won"]
                    config["carrier_intelligence"] = {
                        "win_rate": round(len(wins) / len(outcomes.data), 2) if outcomes.data else 0,
                        "avg_movement": round(sum(o.get("carrier_movement", 0) for o in wins) / len(wins), 2) if wins else 0,
                        "total_claims": len(outcomes.data or []),
                        "suggested_arguments": [t["tactic_description"] for t in (tactics.data or [])
                                                if t.get("effective")][:5],
                    }
                    print(f"[INTEL] Carrier intelligence: {len(outcomes.data or [])} claims, "
                          f"{len(wins)} wins, {len(tactics.data or [])} tactics")
        except Exception as e:
            print(f"[INTEL] Carrier intelligence injection failed (non-fatal): {e}")

        # 9b. Synthesize structured executive summary + conclusion (replaces run-on paragraphs)
        material = config.get("structures", [{}])[0].get("shingle_type", "roofing material")
        try:
            print(f"[PROCESS] Synthesizing executive summary...")
            exec_paragraphs = synthesize_executive_summary(
                claude,
                photo_analysis.get("damage_summary", ""),
                weather_data or {},
                carrier_data,
                material,
                photo_analysis.get("key_findings", []),
                photo_analysis.get("photo_count", 0),
            )
            config["forensic_findings"]["executive_summary"] = exec_paragraphs
        except Exception as e:
            print(f"[PROCESS] Executive summary synthesis failed (non-fatal): {e}")

        try:
            print(f"[PROCESS] Synthesizing conclusion...")
            conclusion_paragraphs = synthesize_conclusion(
                claude,
                photo_analysis.get("damage_summary", ""),
                photo_analysis.get("key_findings", []),
                photo_analysis.get("code_violations", []),
                material,
                carrier_data,
            )
            # Post-process: substitute bracket placeholders that Claude sometimes returns literally
            address = config.get("property", {}).get("address", "the property")
            storm_date_str = config.get("dates", {}).get("date_of_loss", "") or config.get("weather", {}).get("storm_date", "the reported storm event")
            finding_count = len(photo_analysis.get("key_findings", []))
            conclusion_paragraphs = [
                p.replace("[address]", address)
                 .replace("[storm event]", storm_date_str)
                 .replace("[N]", str(finding_count))
                for p in conclusion_paragraphs
            ]
            config["forensic_findings"]["conclusion_paragraphs"] = conclusion_paragraphs
        except Exception as e:
            print(f"[PROCESS] Conclusion synthesis failed (non-fatal): {e}")

        # Deduplicate and renumber findings across all sources
        all_key_args = config.get("forensic_findings", {}).get("key_arguments", [])
        seen = set()
        deduped = []
        for arg in all_key_args:
            # Normalize for comparison
            clean = re.sub(r'^(Finding\s+\d+[:\.]?\s*)', '', arg).strip()
            if clean.lower() not in seen:
                seen.add(clean.lower())
                deduped.append(clean)
        config["forensic_findings"]["key_arguments"] = deduped

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

        # 9c. REVISION DIFF — if this is a reprocess with prior carrier data, diff and record
        revision_data = None
        if is_revision and previous_carrier_data and carrier_data:
            try:
                print(f"[PROCESS] Running scope revision analysis...")
                usarm_arguments = config.get("forensic_findings", {}).get("key_arguments", [])
                diff_result = diff_carrier_scopes(
                    claude,
                    previous_carrier_data,
                    carrier_data,
                    config.get("line_items", []),
                    usarm_arguments,
                )
                revision_data = diff_result["revision"]
                is_win = diff_result["is_win"]

                # Append revision to config
                existing_revisions = config.get("scope_revisions", [])
                existing_revisions.append(revision_data)
                config["scope_revisions"] = existing_revisions

                # Update dashboard section for revision
                if "dashboard" not in config:
                    config["dashboard"] = {}
                if original_carrier_rcv:
                    config["dashboard"]["carrier_1st_scope"] = original_carrier_rcv
                config["dashboard"]["carrier_current"] = revision_data["new_rcv"]

                if is_win:
                    config["dashboard"]["status"] = "won"
                    config["dashboard"]["phase"] = "Settled"
                    config["dashboard"]["notes"] = (
                        f"WIN: ${original_carrier_rcv:,.0f} → ${revision_data['new_rcv']:,.0f} "
                        f"(+{revision_data['movement_pct']:.0f}%) | "
                        f"{revision_data['items_added_count']} items added, "
                        f"{revision_data['items_increased_count']} increased"
                    )
                    print(f"[REVISION] Marked as WIN on dashboard")

            except Exception as e:
                print(f"[REVISION] Scope diff failed (non-fatal): {e}")
                traceback.print_exc()

        # 9d. Resize oversized photos before PDF generation
        # Raw iPhone/camera photos (8-18 MB each) cause Chrome headless to timeout
        # when base64-encoded into HTML, and Supabase Storage rejects PDFs over 50MB.
        # Resize to max 1024px at 50% JPEG quality — keeps forensic detail while
        # ensuring PDF stays under upload limits even with 30+ photos.
        resized_count = 0
        for fname in os.listdir(photos_dir):
            fpath = os.path.join(photos_dir, fname)
            if not os.path.isfile(fpath):
                continue
            if fname.lower().rsplit(".", 1)[-1] not in ("jpg", "jpeg", "png"):
                continue
            if os.path.getsize(fpath) < 300_000:
                continue
            try:
                original_size = os.path.getsize(fpath)
                # Cross-platform resize: Pillow first, sips (macOS) fallback
                resized = False
                try:
                    from PIL import Image
                    with Image.open(fpath) as img:
                        img.thumbnail((1024, 1024), Image.LANCZOS)
                        img.save(fpath, "JPEG", quality=50)
                    resized = True
                except ImportError:
                    # Pillow not available — try macOS sips
                    result = subprocess.run(
                        ["sips", "-Z", "1024", "--setProperty", "formatOptions", "50",
                         fpath, "--out", fpath],
                        capture_output=True, timeout=15
                    )
                    resized = result.returncode == 0
                if resized:
                    new_size = os.path.getsize(fpath)
                    resized_count += 1
                    print(f"[PHOTOS] Resized {fname}: {original_size/1024:.0f}KB → {new_size/1024:.0f}KB")
            except Exception as e:
                print(f"[PHOTOS] Resize failed for {fname} (non-fatal): {e}")

        if resized_count:
            total_size = sum(
                os.path.getsize(os.path.join(photos_dir, f))
                for f in os.listdir(photos_dir)
                if os.path.isfile(os.path.join(photos_dir, f))
            )
            print(f"[PHOTOS] Resized {resized_count} photos — total photos dir: {total_size/1024/1024:.1f}MB")

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

        # Add processing warnings if any
        config_warnings = config.get("warnings", [])
        if config_warnings:
            update_data["processing_warnings"] = config_warnings

        # Core update (status + output_files + photo_integrity — always works)
        sb.table("claims").update(update_data).eq("id", claim_id).execute()

        # Save revision data to DB (columns may not exist yet — separate call so core update isn't blocked)
        revision_update = {}
        if revision_data:
            revision_update["scope_revisions"] = config.get("scope_revisions", [])
            if diff_result.get("is_win"):
                revision_update["claim_outcome"] = "won"
                revision_update["settlement_amount"] = revision_data["new_rcv"]
            revision_update["previous_carrier_data"] = {
                "carrier_rcv": carrier_data.get("carrier_rcv", 0),
                "carrier_line_items": carrier_data.get("carrier_line_items", []),
                "carrier_arguments": carrier_data.get("carrier_arguments", []),
            }
            if not original_carrier_rcv:
                revision_update["original_carrier_rcv"] = previous_carrier_data.get("carrier_rcv", 0)
        elif carrier_data and not is_revision:
            revision_update["previous_carrier_data"] = {
                "carrier_rcv": carrier_data.get("carrier_rcv", 0),
                "carrier_line_items": carrier_data.get("carrier_line_items", []),
                "carrier_arguments": carrier_data.get("carrier_arguments", []),
            }
            revision_update["original_carrier_rcv"] = carrier_data.get("carrier_rcv", 0)

        if revision_update:
            try:
                sb.table("claims").update(revision_update).eq("id", claim_id).execute()
            except Exception as e:
                print(f"[DB] Revision columns not available yet (non-fatal): {e}", flush=True)

        print(f"[PROCESS] Claim complete: {claim['address']} — {len(pdfs)} PDFs ready")

        # 12b. Write to data warehouse tables (non-blocking — failures don't affect claim)
        try:
            _write_to_warehouse(sb, claim_id, config, photo_analysis, photo_integrity,
                                carrier_data, revision_data)
        except Exception as e:
            print(f"[WAREHOUSE] Data warehouse write failed (non-fatal): {e}")

        # 13. Sync to GitHub dashboard + carrier playbooks (pass PDFs for local copy)
        try:
            sync_to_github_dashboard(config, claim, photo_analysis, carrier_data, pdfs, sb=sb)
        except Exception as e:
            print(f"[SYNC] GitHub sync failed (non-fatal): {e}")

    # Reset telemetry globals
    _TELEMETRY_SB = None
    _TELEMETRY_CLAIM_ID = None


# ===================================================================
# DATA WAREHOUSE
# ===================================================================

def _write_to_warehouse(sb, claim_id: str, config: dict, photo_analysis: dict,
                        photo_integrity: dict, carrier_data: dict, revision_data: dict):
    """Write processed claim data to all warehouse tables. Non-fatal on any failure."""
    financials = compute_financials(config)
    carrier = config.get("carrier", {}).get("name", "")
    price_list = config.get("financials", {}).get("price_list", "NYBI26")
    state = config.get("property", {}).get("state", "")
    city = config.get("property", {}).get("city", "")
    region = f"{city}, {state}".strip(", ")

    # 1. Photos — write photo annotations + structured tags
    photo_count = write_photos(sb, claim_id, photo_analysis, photo_integrity)
    print(f"[WAREHOUSE] Wrote {photo_count} photos")

    # 2. USARM line items
    usarm_count = write_line_items(
        sb, claim_id, config.get("line_items", []),
        source="usarm", price_list=price_list, region=region,
    )
    print(f"[WAREHOUSE] Wrote {usarm_count} USARM line items")

    # 3. Carrier line items (if carrier data exists)
    if carrier_data:
        carrier_items = carrier_data.get("carrier_line_items", [])
        carrier_count = write_line_items(
            sb, claim_id, carrier_items,
            source="carrier", price_list=price_list, region=region,
        )
        print(f"[WAREHOUSE] Wrote {carrier_count} carrier line items")

    # 4. Carrier tactics
    if carrier_data and carrier:
        tactics_count = write_carrier_tactics(
            sb, claim_id, carrier, carrier_data, config, revision_data,
        )
        print(f"[WAREHOUSE] Wrote {tactics_count} carrier tactics")

    # 5. Claim outcome
    outcome_ok = write_claim_outcome(sb, claim_id, config, financials, carrier_data, revision_data)
    print(f"[WAREHOUSE] Claim outcome: {'written' if outcome_ok else 'failed'}")

    # 6. Pricing benchmarks (USARM prices)
    usarm_pricing = write_pricing_benchmarks(
        sb, claim_id, config.get("line_items", []),
        source="usarm", price_list=price_list, region=region,
    )
    print(f"[WAREHOUSE] Wrote {usarm_pricing} USARM pricing benchmarks")

    # 7. Pricing benchmarks (carrier prices)
    if carrier_data:
        carrier_pricing = write_pricing_benchmarks(
            sb, claim_id, carrier_data.get("carrier_line_items", []),
            source="carrier", price_list=price_list, region=region,
        )
        print(f"[WAREHOUSE] Wrote {carrier_pricing} carrier pricing benchmarks")


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
    # Deductible lives in carrier.deductible (NOT financials.deductible — generator ignores that)
    deductible = config.get("carrier", {}).get("deductible", 0) or config.get("financials", {}).get("deductible", 0)
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


def sync_to_github_dashboard(config: dict, claim: dict, photo_analysis: dict, carrier_data: Optional[dict], pdfs: Optional[list] = None, sb=None):
    """Sync processed claim to USARM GitHub dashboard + carrier playbooks."""
    if not os.path.exists(PLATFORM_DIR):
        print("[SYNC] USARM-Claims-Platform not found — skipping GitHub sync")
        return

    # Build slug
    slug = claim.get("slug", "")
    if not slug:
        slug = claim["address"].lower().replace(",", "").replace(" ", "-").strip("-")

    claim_dir = os.path.join(PLATFORM_DIR, "claims", slug)
    pdf_output_dir = os.path.join(claim_dir, "pdf_output")
    os.makedirs(pdf_output_dir, exist_ok=True)

    # Copy generated PDFs to local claims folder
    if pdfs:
        import shutil
        copied = 0
        for pdf_path in pdfs:
            if os.path.exists(pdf_path):
                dest = os.path.join(pdf_output_dir, os.path.basename(pdf_path))
                shutil.copy2(pdf_path, dest)
                copied += 1
        if copied:
            print(f"[SYNC] Copied {copied} PDFs to {pdf_output_dir}")

    # Compute financials
    financials = compute_financials(config)
    carrier_rcv = config.get("carrier", {}).get("carrier_rcv", 0)

    # Add dashboard section to config — preserve existing dashboard data from revision processing
    carrier_name = config.get("carrier", {}).get("name", claim.get("carrier", ""))
    existing_dashboard = config.get("dashboard", {})
    if not existing_dashboard or existing_dashboard.get("status") == "pending":
        # Fresh claim or no revision — build default dashboard
        config["dashboard"] = {
            "status": "pending",
            "phase": "Pre-Scope" if config.get("phase") == "pre-scope" else "Supplement Filed",
            "carrier_1st_scope": carrier_rcv,
            "carrier_current": carrier_rcv,
            "primary_tactic": "",
            "notes": f"Processed via dumbroof.ai | {len(config.get('line_items', []))} line items | Source: web upload",
        }
    else:
        # Revision already set dashboard (won/settled/etc) — preserve it, just update carrier_current
        config["dashboard"]["carrier_current"] = carrier_rcv
        if not config["dashboard"].get("carrier_1st_scope"):
            config["dashboard"]["carrier_1st_scope"] = carrier_rcv

    # Remove internal paths before saving
    config_to_save = {k: v for k, v in config.items() if k != "_paths"}

    # Write claim_config.json
    config_path = os.path.join(claim_dir, "claim_config.json")
    with open(config_path, "w") as f:
        json.dump(config_to_save, f, indent=2)
    print(f"[SYNC] Saved config: {config_path}")

    # Update carrier playbook
    update_carrier_playbook(carrier_name, claim, config, financials, photo_analysis, carrier_data)

    # Update carrier playbook JSON from Supabase data
    try:
        from sync_playbooks import update_playbook_json
        update_playbook_json(carrier_name, sb, PLATFORM_DIR)
    except Exception as e:
        print(f"[SYNC] Playbook JSON update failed (non-fatal): {e}")

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

    # Git commit and push (skip in cloud mode)
    if os.environ.get("APP_ENV") in ("cloud", "docker", "staging"):
        print(f"[SYNC] Cloud mode — skipping git operations")
        return
    try:
        subprocess.run(
            ["git", "add", f"claims/{slug}/", "docs/index.html"],
            capture_output=True, text=True, cwd=PLATFORM_DIR, timeout=10,
        )
        # Also add carrier playbook and memory files
        carrier_slug = carrier_name.lower().replace("/", "-").replace(" ", "-").replace("--", "-").strip("-")
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

    carrier_slug = carrier_name.lower().replace("/", "-").replace(" ", "-").replace("--", "-").strip("-")
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

    # Revision/win data
    revisions = config.get("scope_revisions", [])
    dashboard = config.get("dashboard", {})
    if revisions:
        latest = revisions[-1]
        entry += f"\n#### Scope Revision ({latest.get('revision_date', 'N/A')})\n"
        entry += f"- **Previous RCV:** ${latest.get('previous_rcv', 0):,.2f}\n"
        entry += f"- **New RCV:** ${latest.get('new_rcv', 0):,.2f}\n"
        entry += f"- **Movement:** ${latest.get('movement', 0):,.2f} (+{latest.get('movement_pct', 0):.1f}%)\n"
        entry += f"- **Items Added:** {latest.get('items_added_count', 0)}\n"
        entry += f"- **Items Increased:** {latest.get('items_increased_count', 0)}\n"

        # Proven arguments
        mappings = latest.get("argument_mapping", [])
        if mappings:
            entry += "\n##### Proven Arguments (What Moved the Carrier)\n"
            for m in mappings[:8]:
                conf = m.get("confidence", "")
                entry += f"- [{conf}] {m.get('change', '')} ← **{m.get('likely_argument', '')}**\n"

    status = dashboard.get("status", "pending")
    if status == "won":
        entry += f"\n**RESULT: WIN** — ${dashboard.get('carrier_1st_scope', 0):,.0f} → ${dashboard.get('carrier_current', 0):,.0f}\n\n"
    else:
        entry += f"- **Status:** {status.title()}\n\n"

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
