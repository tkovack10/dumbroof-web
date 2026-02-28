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
import asyncio

import anthropic
import traceback
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

PRICING = _load_pricing()


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

ANALYSIS PRIORITIES:
- FOCUS ON STORM DAMAGE — hail impacts, wind displacement, fractures from the storm event. This is 90% of the report.
- Do NOT catalog every minor wear detail (lichen, moss, minor surface weathering, faded paint). Only mention pre-existing condition ONCE, briefly, if it makes spot repair infeasible.
- Keep annotations concise — 1-2 sentences per photo focusing on the storm damage evidence visible
- For chalk test photos: describe what the chalk test reveals (number of gaps = hail impacts), not the chalk itself
- For test square photos: report the counts (H=hits, W=wind) and what they prove

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
                model="claude-sonnet-4-6",
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


def search_weather_corroboration(city: str, state: str, storm_date: str) -> list[dict]:
    """Search web for corroborating weather reports — NOAA, local news, social media."""
    results = []
    try:
        from duckduckgo_search import DDGS
    except ImportError:
        print("[WEATHER] duckduckgo_search not installed — skipping corroboration search")
        return results

    queries = [
        f"{city} {state} hail storm {storm_date}",
        f"{city} {state} severe weather damage {storm_date}",
        f"NOAA storm report {city} {state} {storm_date} hail",
    ]

    seen_urls = set()
    for query in queries:
        try:
            with DDGS() as ddgs:
                for r in ddgs.text(query, max_results=5):
                    url = r.get("href", "")
                    if url in seen_urls:
                        continue
                    seen_urls.add(url)

                    # Classify the source type
                    source_lower = (r.get("title", "") + " " + url).lower()
                    if any(k in source_lower for k in ["noaa", "nws", "weather.gov", "ncdc"]):
                        source_type = "NOAA / National Weather Service"
                    elif any(k in source_lower for k in ["facebook", "twitter", "x.com", "reddit", "nextdoor"]):
                        source_type = "Social Media"
                    elif any(k in source_lower for k in ["news", "patch", "herald", "tribune", "times", "post", "abc", "nbc", "cbs", "fox", "wfmz", "wnep", "wpvi"]):
                        source_type = "Local News"
                    else:
                        source_type = "Web Report"

                    results.append({
                        "title": r.get("title", ""),
                        "url": url,
                        "snippet": r.get("body", "")[:200],
                        "source_type": source_type,
                    })
        except Exception as e:
            print(f"[WEATHER] Search error for '{query}': {e}")
            continue

    # Deduplicate and limit to top 8
    print(f"[WEATHER] Found {len(results)} corroborating weather reports")
    return results[:8]


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

    prompt = f"""You are writing the Executive Summary for a forensic causation report on a storm-damaged property.
The roofing material is: {material}

Raw damage analysis from photo inspection:
{damage_summary[:3000]}

Weather data: Storm date {weather_data.get('storm_date', 'N/A')}, hail size {weather_data.get('hail_size', 'N/A')}
Carrier RCV: ${carrier_rcv:,.2f}
Photo count: {photo_count}
Key findings count: {len(key_findings)}

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

Return ONLY a JSON array of paragraph strings: ["paragraph 1...", "paragraph 2...", ...]"""

    response = _call_claude_with_retry(client,
        model="claude-sonnet-4-6",
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

Return ONLY a JSON array of paragraph strings: ["paragraph 1...", "paragraph 2...", ...]"""

    response = _call_claude_with_retry(client,
        model="claude-sonnet-4-6",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}]
    )
    paragraphs = _parse_json_response(response.content[0].text)
    if isinstance(paragraphs, list):
        return paragraphs
    return [damage_summary[:500]]


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
    _tax_rates = {"NY": 0.08, "PA": 0.0, "NJ": 0.06625}
    tax_rate = _tax_rates.get(state, 0.08)
    if state not in _tax_rates:
        print(f"[CONFIG] WARNING: No tax rate configured for state '{state}' — defaulting to 8%. Verify with Tom.")

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

    # Propagate detected roof material into structures[0].shingle_type
    # Photo analysis identifies the material visually; this ensures it's in the config
    detected_material = _detect_roof_material(photo_analysis, user_notes or "")
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

    return config


def _detect_roof_material(photo_analysis: dict, user_notes: str = "") -> str:
    """Detect roofing material type from photo analysis and user notes.

    Returns one of: 'slate', 'tile', 'metal_standing_seam', 'copper',
    'laminated', '3tab', or defaults to 'laminated'.

    IMPORTANT: "metal" alone is NOT a roofing material indicator — virtually
    every roof has metal components (flashing, trim, drip edge, vents, gutters).
    Only detect metal roofing when explicitly stated as the primary roof covering
    (e.g., "standing seam", "metal roof", "metal roofing panel").
    """
    combined = " ".join([
        user_notes or "",
        photo_analysis.get("shingle_type", ""),
        photo_analysis.get("damage_summary", ""),
    ]).lower()

    # Check for explicit comp shingle keywords FIRST — these override everything
    # because if someone says "laminate comp shingle roof" that IS the material,
    # regardless of any "metal trim" or "metal flashing" also mentioned.
    has_comp_shingle = any(kw in combined for kw in [
        "laminate", "laminated", "architectural", "comp shingle",
        "composite shingle", "asphalt shingle", "3-tab", "3 tab",
        "dimensional shingle", "strip shingle",
    ])

    if "slate" in combined and not has_comp_shingle:
        return "slate"
    if ("tile" in combined or "clay" in combined or "concrete tile" in combined) and not has_comp_shingle:
        return "tile"
    # "standing seam" is an explicit metal roofing phrase — safe to match
    if "standing seam" in combined and not has_comp_shingle:
        return "metal_standing_seam"
    if "copper" in combined and "copper roof" in combined and not has_comp_shingle:
        return "copper"
    # Only match metal roofing when explicitly described as the roof covering.
    # "metal" alone appears on every claim (flashing, trim, drip edge, vents,
    # gutters, downspouts). Require explicit phrases like "metal roof" or
    # "metal roofing" — NOT just "metal" + "roof" as separate words.
    if any(phrase in combined for phrase in [
        "metal roof", "metal roofing", "metal panel roof",
    ]) and not has_comp_shingle:
        return "metal_standing_seam"

    # If comp shingle keywords found, or fallback to shingle_type field
    if has_comp_shingle:
        if "3-tab" in combined or "3 tab" in combined or "strip shingle" in combined:
            return "3tab"
        return "laminated"

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
    # Pricing loaded from backend/pricing/nybi26.json — PRICING.get(key, fallback)
    if material == "slate":
        items.append({"category": "ROOFING", "description": "Remove slate roofing", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("slate_remove", 325.00)})
        items.append({"category": "ROOFING", "description": "Slate roofing - high grade natural", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("slate_install", 1850.00)})
        items.append({"category": "ROOFING", "description": "Underlayment - felt 30#", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("slate_underlayment", 22.00)})
        items.append({"category": "ROOFING", "description": "Copper nails & hooks for slate", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("slate_nails_hooks", 45.00)})
        items.append({"category": "ROOFING", "description": "Slate roofing - additional labor (specialist)", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("slate_specialist_labor", 350.00)})
    elif material == "tile":
        items.append({"category": "ROOFING", "description": "Remove concrete/clay tile roofing", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("tile_remove", 200.00)})
        items.append({"category": "ROOFING", "description": "Concrete/clay tile roofing", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("tile_install", 900.00)})
        items.append({"category": "ROOFING", "description": "Underlayment - felt 30#", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("tile_underlayment", 22.00)})
    elif material == "metal_standing_seam":
        items.append({"category": "ROOFING", "description": "Remove metal roofing - standing seam", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("metal_remove", 150.00)})
        items.append({"category": "ROOFING", "description": "Metal roofing - standing seam", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("metal_install", 850.00)})
        items.append({"category": "ROOFING", "description": "Synthetic underlayment", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("metal_underlayment", 32.00)})
    elif material == "laminated":
        items.append({"category": "ROOFING", "description": "Remove laminated comp shingle roofing", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("laminated_remove", 74.00)})
        items.append({"category": "ROOFING", "description": "Laminated comp shingle roofing - w/out felt", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("laminated_install", 320.00)})
        items.append({"category": "ROOFING", "description": "Synthetic underlayment", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("laminated_underlayment", 32.00)})
    else:  # 3tab
        items.append({"category": "ROOFING", "description": "Remove 3-tab 25yr comp shingle roofing", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("3tab_remove", 73.14)})
        items.append({"category": "ROOFING", "description": "3-tab 25yr comp shingle roofing - w/out felt", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("3tab_install", 312.92)})
        items.append({"category": "ROOFING", "description": "Synthetic underlayment", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("3tab_underlayment", 32.00)})

    # ===================== ICE & WATER BARRIER =====================
    iw_sf = (eave * 6) + (valley * 3)
    if iw_sf > 0:
        items.append({"category": "ROOFING", "description": "Ice & water barrier", "qty": round(iw_sf), "unit": "SF", "unit_price": PRICING.get("ice_water", 2.24)})

    # ===================== DRIP EDGE =====================
    drip = meas.get("drip_edge", 0) or (eave + rake)
    if drip > 0:
        if material in ("copper", "slate") and "copper" in notes_lower:
            items.append({"category": "ROOFING", "description": "R&R Drip edge - copper", "qty": drip, "unit": "LF", "unit_price": PRICING.get("drip_edge_copper", 18.50)})
        else:
            items.append({"category": "ROOFING", "description": "R&R Drip edge - aluminum", "qty": drip, "unit": "LF", "unit_price": PRICING.get("drip_edge_aluminum", 4.25)})

    # ===================== STARTER STRIP (comp shingle only) =====================
    if material in ("laminated", "3tab") and eave > 0:
        items.append({"category": "ROOFING", "description": "R&R Starter strip - asphalt shingle", "qty": eave, "unit": "LF", "unit_price": PRICING.get("starter_strip", 3.50)})

    # ===================== RIDGE CAP =====================
    if ridge > 0:
        if material == "slate":
            items.append({"category": "ROOFING", "description": "R&R Ridge cap - slate", "qty": ridge, "unit": "LF", "unit_price": PRICING.get("slate_ridge_cap", 38.00)})
        elif material == "tile":
            items.append({"category": "ROOFING", "description": "R&R Ridge cap - tile", "qty": ridge, "unit": "LF", "unit_price": PRICING.get("tile_ridge_cap", 28.00)})
        elif material == "metal_standing_seam":
            items.append({"category": "ROOFING", "description": "R&R Ridge cap - metal", "qty": ridge, "unit": "LF", "unit_price": PRICING.get("metal_ridge_cap", 22.00)})
        else:
            desc = "R&R Ridge cap - laminated" if material == "laminated" else "R&R Ridge cap - 3 tab"
            items.append({"category": "ROOFING", "description": desc, "qty": ridge, "unit": "LF", "unit_price": PRICING.get("laminated_ridge_cap", 7.49)})

    # ===================== RIDGE VENT =====================
    if ridge > 0 and material not in ("slate", "tile"):
        items.append({"category": "ROOFING", "description": "R&R Ridge vent - aluminum", "qty": ridge, "unit": "LF", "unit_price": PRICING.get("ridge_vent", 8.50)})

    # ===================== HIP CAP =====================
    if hip > 0:
        if material == "slate":
            items.append({"category": "ROOFING", "description": "R&R Hip cap - slate", "qty": hip, "unit": "LF", "unit_price": PRICING.get("slate_hip_cap", 38.00)})
        elif material == "tile":
            items.append({"category": "ROOFING", "description": "R&R Hip cap - tile", "qty": hip, "unit": "LF", "unit_price": PRICING.get("tile_hip_cap", 28.00)})
        else:
            items.append({"category": "ROOFING", "description": "R&R Hip cap - laminated", "qty": hip, "unit": "LF", "unit_price": PRICING.get("comp_hip_cap", 7.49)})

    # ===================== FLASHING =====================
    step = meas.get("step_flashing", 0)
    flashing = meas.get("flashing", 0)
    is_copper_flashing = "copper" in notes_lower and "flash" in notes_lower

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

    # ===================== PENETRATIONS =====================
    pipes = penetrations.get("pipes", 0)
    if pipes > 0:
        items.append({"category": "ROOFING", "description": "Pipe boot/jack", "qty": pipes, "unit": "EA", "unit_price": PRICING.get("pipe_boot", 68.00)})

    vents = penetrations.get("vents", 0)
    if vents > 0:
        items.append({"category": "ROOFING", "description": "R&R Exhaust vent", "qty": vents, "unit": "EA", "unit_price": PRICING.get("exhaust_vent", 125.00)})

    # ===================== STEEP / HIGH CHARGES =====================
    # Use the corrected pitch_str (may have been updated from 0/12 to estimated pitch)
    if pitch_str:
        try:
            rise = int(pitch_str.split("/")[0])
            if rise >= 7:
                items.append({"category": "ROOFING", "description": f"Steep charge - {pitch_str} pitch", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("steep_charge", 85.00)})
        except (ValueError, IndexError):
            pass

    stories = measurements.get("stories", 1)
    if stories >= 2:
        items.append({"category": "ROOFING", "description": "High roof charge - 2+ stories", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("high_roof_charge", 85.00)})

    # ===================== DEBRIS =====================
    dumpster_loads = max(1, round(area_sq / 25))
    items.append({"category": "DEBRIS", "description": "Dumpster load - roofing debris", "qty": dumpster_loads, "unit": "EA", "unit_price": PRICING.get("dumpster", 450.00)})

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
    if "gutters" in [t.lower() for t in trades] and not has_gutter_line:
        gutter_lf = round(eave * 1.6) if eave > 0 else 0
        if gutter_lf > 0:
            items.append({"category": "GUTTERS", "description": "R&R Seamless aluminum gutter & downspout", "qty": gutter_lf, "unit": "LF", "unit_price": PRICING.get("gutter_aluminum", 10.50)})

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
        timeout=300,
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

        # 6-8b. Extract all data in parallel via asyncio.to_thread
        # Measurements, photos, integrity, scope, and weather are independent
        # Running in parallel cuts processing from ~7min to ~3-4min
        _default_photo = {"trades_identified": ["roofing"], "photo_annotations": {}, "photo_count": 0}
        _default_integrity = {"total": 0, "flagged": 0, "score": "N/A", "summary": "", "findings": []}

        async def _get_measurements():
            if not measurement_paths:
                return {}
            print("[PROCESS] Extracting measurements...")
            return await asyncio.to_thread(extract_measurements, claude, measurement_paths[0])

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
            print(f"[PROCESS] Extracting carrier scope ({len(scope_paths)} file(s))...")
            return await asyncio.to_thread(extract_carrier_scope, claude, scope_paths[-1])

        async def _get_weather_data():
            if not weather_paths:
                return {}
            print("[PROCESS] Extracting weather data...")
            return await asyncio.to_thread(extract_weather_data, claude, weather_paths[0])

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

        # Add corroborating weather reports to config
        if corroborating_reports:
            config["weather"]["corroborating_reports"] = corroborating_reports

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
            config["forensic_findings"]["conclusion_paragraphs"] = conclusion_paragraphs
        except Exception as e:
            print(f"[PROCESS] Conclusion synthesis failed (non-fatal): {e}")

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
                result = subprocess.run(
                    ["sips", "-Z", "1024", "--setProperty", "formatOptions", "50",
                     fpath, "--out", fpath],
                    capture_output=True, timeout=15
                )
                if result.returncode == 0:
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

        # 13. Sync to GitHub dashboard + carrier playbooks (pass PDFs for local copy)
        try:
            sync_to_github_dashboard(config, claim, photo_analysis, carrier_data, pdfs)
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


def sync_to_github_dashboard(config: dict, claim: dict, photo_analysis: dict, carrier_data: Optional[dict], pdfs: Optional[list] = None):
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
