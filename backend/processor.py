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

from carrier_intelligence import suggest_arguments
from analytics import predict_settlement, detect_price_deviations
from xactimate_lookup import XactRegistry, _clean_desc
from code_compliance import enrich_line_items_with_citations
from qa_auditor import audit_forensic_prose

# Xactimate registry cache: market_code → XactRegistry instance
_XACT_REGISTRIES = {}


def _get_registry(state: str, city: str = None) -> XactRegistry:
    """Get XactRegistry for a state/market, with multi-market price overlay."""
    market = XactRegistry.resolve_market(state, city=city)
    if market not in _XACT_REGISTRIES:
        reg = XactRegistry()
        reg.load_market_prices(market_code=market)
        _XACT_REGISTRIES[market] = reg
    return _XACT_REGISTRIES[market]

from telemetry import (
    call_claude_logged,
    write_photos,
    write_line_items,
    write_carrier_tactics,
    write_claim_outcome,
    write_pricing_benchmarks,
)

from photo_utils import (
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

# Canonical state → price list mapping (used everywhere pricing is resolved)
STATE_PRICE_LIST = {"NY": "NYBI26", "PA": "PAPI26", "NJ": "NJBI26"}


# Alfonso's description → build_line_items() pricing key mapping
# These map the PDF line item descriptions to the PRICING.get() keys used in build_line_items()
_DESC_TO_PRICING_KEY = {
    # Shingles — 3-tab
    "Remove 3 tab - 25 yr. - comp. shingle roofing - w/out felt": "3tab_remove",
    "3 tab - 25 yr. - comp. shingle roofing - w/out felt": "3tab_install",
    # Shingles — Laminated
    "Remove Laminated - comp. shingle rfg. - w/out felt": "laminated_remove",
    "Laminated - comp. shingle rfg. - w/out felt": "laminated_install",
    # Shingles — High grade
    "Remove Laminated - High grd - comp. shingle rfg. - w/out felt": "laminated_high_remove",
    "Laminated - High grd - comp. shingle rfg. - w/out felt": "laminated_high_install",
    # Shingles — Shake look premium
    "Remove Laminated - Shake look Premium grd comp.shingle-w/out": "shake_look_remove",
    "Laminated - Shake look Premium grd comp.shingle-w/out felt": "shake_look_install",
    # Underlayments
    "Roofing felt - synthetic underlayment": "felt_synthetic",
    "Roofing felt - synthetic underlayment - Standard grade": "felt_synthetic_std",
    "Roofing felt - 30 lb.": "felt_30",
    "Roofing felt - 15 lb.": "felt_15",
    "Ice & water barrier": "ice_water",
    "Ice & water barrier - High temp": "ice_water_high",
    # Flashings
    "R&R Chimney flashing - large (32\" x 60\")": "chimney_flashing_large",
    "R&R Chimney flashing - small (24\" x 24\")": "chimney_flashing_small",
    "R&R Chimney flashing - average (32\" x 36\")": "chimney_flashing_ea",
    "R&R Drip edge": "drip_edge_aluminum",
    "R&R Flashing - pipe jack": "pipe_boot",
    "Step flashing": "step_flashing",
    "R&R Valley metal": "valley_metal",
    "R&R Valley metal - copper": "copper_valley_flashing",
    "R&R Valley metal - (W) profile": "valley_metal_w",
    "R&R Sheathing - plywood - 1/2\" CDX": "sheathing_plywood",
    # Starters
    "Asphalt starter - peel and stick": "starter_peel_stick",
    "Asphalt starter - universal starter course": "starter_strip",
    # Ridge cap
    "R&R Hip / Ridge cap - Standard profile - composition shingles": "laminated_ridge_cap",
    # Ridge vent — not in Alfonso's list, keep hardcoded fallback
    # Vents
    "R&R Roof mount power attic vent": "power_attic_vent",
    "R&R Roof mount power attic vent - Large": "power_attic_vent_large",
    "Roof mount power attic vent - Detach & reset": "power_attic_vent_reset",
    # Steep/High — not in Alfonso's list (these are surcharges, not material prices)
    # Cornice
    "R&R Gable cornice return - 3 tab": "cornice_3tab",
    "R&R Gable cornice return - 3 tab - 2 stories or greater": "cornice_3tab_high",
    "R&R Gable cornice return - laminated - 2 stories or greater": "cornice_laminated_high",
    "R&R Gable cornice strip - 3 tab": "cornice_strip_3tab",
    "R&R Gable cornice strip - 3 tab - 2 stories or greater": "cornice_strip_3tab_high",
    # Copper
    "R&R Copper panel - standing seam 1\" - 20 oz": "copper_standing_seam",
    "R&R Copper panel - flat seam - 20 oz": "flat_seam_copper",
    "R&R Copper valley - v-channel": "copper_valley",
    # Roll roofing
    "Remove Roll roofing": "roll_remove",
    "Roll roofing": "roll_install",
    "Remove Roll roofing - 50% overlap": "roll_overlap_remove",
    "Roll roofing - 50% overlap": "roll_overlap_install",
    # Slate
    "Remove Slate roofing - 12\" to 18\" tall": "slate_remove",
    "Slate roofing - 12\" to 18\" tall": "slate_install",
    "Remove Slate roofing - Premium grade - 12\" to 24\" tall - red": "slate_premium_remove",
    "Slate roofing - Premium grade - 12\" to 24\" tall - red": "slate_premium_install",
    "Slate ridge or hip - Premium grade - 18\" to 24\" tall - red": "slate_ridge_cap",
    # Wood shake
    "Remove Wood shakes - heavy (3/4\") hand split": "wood_shake_heavy_remove",
    "Wood shakes - heavy (3/4\") hand split": "wood_shake_heavy_install",
    "Remove Wood shakes/shingles - tapersawn - #1 cedar": "cedar_shake_remove",
    "Wood shakes/shingles - tapersawn - #1 cedar": "cedar_shake_install",
    "Wood shake/shingle starter": "wood_starter",
    # Gutters
    "R&R Gutter / downspout - aluminum - up to 5\"": "gutter_aluminum",
    "R&R Gutter / downspout - aluminum - 6\"": "gutter_aluminum_6",
    "R&R Gutter / downspout - copper - up to 5\"": "gutter_copper",
    "R&R Gutter / downspout - copper - 6\"": "gutter_copper_6",
    "R&R Gutter / downspout - half round - aluminum - up to 5\"": "gutter_half_round_aluminum",
    "R&R Gutter / downspout - half round - aluminum - 6\"": "gutter_half_round_aluminum_6",
    "R&R Gutter / downspout - half round - copper - 6\"": "gutter_half_round_copper_6",
    "R&R Gutter guard/screen - High grade": "gutter_guard",
    # Siding
    "R&R Siding - .024\" metal (aluminum/steel) - High grade": "siding_aluminum_024",
    "R&R Siding - vinyl - insulated": "siding_vinyl_insulated",
    "R&R Siding - vinyl - specialty grade - single color": "siding_vinyl_premium",
    "R&R Siding - vinyl - board & batten": "siding_vinyl_board_batten",
    "R&R Siding - cedar shingle": "siding_cedar_shingle",
    "R&R Siding - cedar shingle - fancy cut": "siding_cedar_fancy",
    "Metal or Vinyl siding - Detach & reset": "siding_detach_reset",
    # Siding components
    "R&R Fanfold foam insulation board - 3/8\"": "fanfold_insulation",
    "R&R Vinyl outside corner post": "vinyl_outside_corner",
    "R&R Vinyl inside corner post": "vinyl_inside_corner",
    "R&R Vinyl outside corner post - insulated": "vinyl_outside_corner_insulated",
    "R&R Vinyl inside corner post - insulated": "vinyl_inside_corner_insulated",
    "R&R Vinyl J trim": "vinyl_j_trim",
    "R&R Metal outside corner post": "metal_outside_corner",
    "R&R Metal inside corner post": "metal_inside_corner",
    "R&R Metal J trim": "metal_j_trim",
    "R&R Wrap wood window frame & trim with aluminum sheet -": "window_wrap_standard",
    "R&R Wrap wood post with aluminum (PER LF)": "wrap_post_aluminum",
    "R&R Wrap wood garage door frame & trim with aluminum (PER": "garage_door_wrap_lf",
    "R&R Shutters - simulated wood (polystyrene) - Large": "shutters_poly",
    "R&R Shutters - aluminum - Large": "shutters_aluminum",
    "R&R Light/outlet J-block - vinyl": "j_block_vinyl",
    "R&R Attic vent - gable end - vinyl": "attic_vent_gable",
    # Soffit/Fascia
    "R&R Soffit - vinyl": "soffit_vinyl",
    "R&R Fascia - metal - 10\"": "fascia_metal_10",
    # Skylights
    "R&R Skylight - double dome fixed, 6.6 - 9 sf": "skylight_fixed",
    "R&R Skylight - double dome venting, 12.6 - 15.5 sf": "skylight_venting",
    "R&R Skylight flashing kit - dome - High grade": "skylight_flashing",
    # Misc
    "De-icing cable - Detach & reset": "deicing_cable",
    "Add. layer of comp. shingles, remove & disp. - Laminated": "additional_layer_remove",
    "Framing labor minimum": "framing_labor_min",
    "Gutter labor minimum": "gutter_labor_min",
}

# Use DEFAULT_MARKETS from xactimate_lookup (single source of truth)
from xactimate_lookup import XactRegistry as _XactRegistry


def get_pricing_for_state(state: str, zip_code: str = "", city: str = "") -> dict:
    """Get pricing from Alfonso's all-markets.json based on state/zip/city.

    Resolves property location → best Xactimate market → 92 item prices.
    Falls back to old per-state files for any keys not in Alfonso's data.
    """
    cache_key = f"{state}_{zip_code}_{city}".lower()
    if cache_key in _PRICING_CACHE:
        return _PRICING_CACHE[cache_key]

    # Resolve to best market code
    market_code = _XactRegistry.resolve_market(state, zip_code=zip_code, city=city)

    # Load all-markets.json (cached at module level in xactimate_lookup)
    from xactimate_lookup import _get_all_markets
    all_data = _get_all_markets()

    market = all_data.get("markets", {}).get(market_code, {})
    market_items = market.get("items", {})

    # Build pricing dict from Alfonso's descriptions → pricing keys
    pricing = {}
    for desc, item_data in market_items.items():
        price = item_data.get("price")
        if price is None:
            continue
        key = _DESC_TO_PRICING_KEY.get(desc)
        if key:
            pricing[key] = price

    # Also store raw descriptions for direct lookup
    pricing["_market_code"] = market_code
    pricing["_market_name"] = market.get("name", "")
    pricing["_meta"] = True

    # Fill gaps from old per-state files (for items Alfonso doesn't have yet)
    old_price_list = STATE_PRICE_LIST.get(state.upper(), "NYBI26").lower()
    old_pricing = _load_pricing(old_price_list)
    if old_pricing:
        for k, v in old_pricing.items():
            if k not in pricing:
                pricing[k] = v

    mapped = sum(1 for k in pricing if not k.startswith("_"))
    print(f"[PRICING] {market_code} ({market.get('name', '')}): {mapped} prices loaded ({len(market_items)} items in market)")

    _PRICING_CACHE[cache_key] = pricing
    return pricing


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



# ===================================================================
# CLAUDE API — DOCUMENT ANALYSIS
# ===================================================================

def extract_measurements(client: anthropic.Anthropic, pdf_path: str) -> dict:
    """Send measurement PDF to Claude and extract structured data."""
    pdf_b64 = file_to_base64(pdf_path)

    response = _call_claude_with_retry(client,
        _step_name="extract_measurements",
        model="claude-opus-4-6",
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
    "garage_door_count": 0,
    "siding_type": "vinyl / aluminum / cedar / fiber_cement / stucco / none"
  }
}

Use 0 for any values not found. Calculate SQ = SF / 100. Include waste_factor if stated (default 1.10 = 10% waste).
If this report covers multiple structures (e.g., main building + detached garage), create a separate entry in the structures array for each. Include per-structure linear measurements (ridge, eave, valley, hip, rake) nested inside each structure's object as a "measurements" field.
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
        # Check if this is a Property Owner report (images only, no measurement tables)
        response_text = response.content[0].text.lower() if response.content else ""
        filename_lower = os.path.basename(pdf_path).lower()
        _no_meas_phrases = [
            "property owner", "images only", "no measurement", "does not include",
            "not include the actual measurement", "cover page, images",
            "notes diagram", "no numerical", "no roof area",
        ]
        if any(phrase in response_text for phrase in _no_meas_phrases) or "propertyowner" in filename_lower:
            print(f"[WARN] This appears to be an EagleView Property Owner Report (images only, no measurements)")
            result["_property_owner_report"] = True
            return result

        print("[WARN] Measurement extraction returned no roof area — retrying with explicit prompt...")
        retry_response = _call_claude_with_retry(client,
            _step_name="extract_measurements_retry",
            model="claude-opus-4-6",
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


def analyze_photos(client: anthropic.Anthropic, photo_paths: list[str], user_notes: Optional[str] = None, corrections: list = None, estimate_request: dict = None) -> dict:
    """Send inspection photos to Claude for forensic analysis, in batches."""
    BATCH_SIZE = 5  # 5 resized photos per batch to stay well under API limits

    # Filter to image files and resize
    image_paths = []
    for path in photo_paths[:100]:
        media_type = get_media_type(path)
        if media_type.startswith("image/"):
            resized = _shared_resize_photo(path, max_dim=1024, quality=60, suffix="_resized")
            if not resized:
                print(f"[PHOTO] Skipping {os.path.basename(path)} — resize/convert failed")
                continue
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
    siding_votes = []
    damage_type = ""
    severity = ""
    chalk_test_results = []
    test_square_results = []
    exposure_inches = None

    # Build context strings ONCE (injected into every batch)
    # Damage type context — tells the AI what kind of claim this is so it can
    # weight the right indicators. When the user selects hail/wind/combined on
    # the claim form, we inject a prioritization directive.
    damage_type_ctx = ""
    user_damage_type = (estimate_request or {}).get("damage_type", "")
    if user_damage_type == "wind":
        damage_type_ctx = "\n\nCLAIM TYPE: WIND DAMAGE. Prioritize wind indicators: creased tabs (the #1 wind indicator — sharp horizontal fold at nail line), missing shingles (check nail rust: no rust = recent), broken seal strips (clean mechanical separation = wind, crumbling = age), turned-back leading edges, ridge cap blow-off, directional patterns (windward > leeward), debris impact marks (linear gouges, not circular like hail). Still note hail evidence if clearly visible, but wind is the primary loss type for this claim.\n"
    elif user_damage_type == "hail":
        damage_type_ctx = "\n\nCLAIM TYPE: HAIL DAMAGE. Prioritize hail indicators: circular dents on metals (chalk test gaps), granule displacement on shingles exposing dark mat, fractured/cracked shingle mat (HAAG standard = functional damage), soft metal deformation. Still note wind evidence if clearly visible, but hail is the primary loss type.\n"
    elif user_damage_type == "combined":
        damage_type_ctx = "\n\nCLAIM TYPE: COMBINED HAIL & WIND. Analyze for BOTH damage types with equal weight. For each photo, identify whether the damage is hail-caused (circular dents, granule loss, mat fracture) or wind-caused (creased tabs, missing shingles, directional patterns, seal strip breaks). Tag each photo with the PRIMARY damage type visible. Note the directional pattern across photos to distinguish wind damage from uniform hail damage.\n"

    notes_ctx = ""
    if user_notes:
        notes_ctx = f"\n\nCONTEXT FROM CONTRACTOR: {user_notes}\nUse this context to inform your analysis — identify specific materials mentioned, note any adjuster claims to address, and focus on items the contractor highlighted.\n"

    corrections_ctx = ""
    if corrections:
        changes_lines = []
        for c in corrections[:5]:
            orig = c.get("original_tags") or {}
            fixed = c.get("corrected_tags") or {}
            changes = []
            for field in ["material", "damage_type", "severity", "trade"]:
                if orig.get(field) != fixed.get(field) and fixed.get(field):
                    changes.append(f"{field}: {orig.get(field)} -> {fixed.get(field)}")
            orig_ann = c.get("original_annotation", "")
            fixed_ann = c.get("corrected_annotation", "")
            if orig_ann and fixed_ann and orig_ann != fixed_ann:
                changes.append(f"annotation: '{orig_ann[:80]}...' -> '{fixed_ann[:80]}...'")
            if changes:
                changes_lines.append(f"- {', '.join(changes)}")
        if changes_lines:
            corrections_ctx = "\n\nHUMAN CORRECTIONS (learn from these — apply to ALL similar photos):\n" + "\n".join(changes_lines) + "\nApply these corrections to similar photos in this batch.\n"

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

        content.append({
            "type": "text",
            "text": f"""You are a forensic roofing damage analyst. Analyze photos {start_num}-{start_num + len(batch) - 1}.{damage_type_ctx}{notes_ctx}{corrections_ctx}

STRICT OUTPUT RULES (violations = failure):
- Each photo_annotation MUST be 1-2 sentences, MAX 150 characters. Lead with the damage finding. No scenery, no context, no preamble.
- BAD: "The front elevation of this two-story colonial residence reveals significant storm damage including multiple hail impacts on the aluminum gutters and fascia wrap." (too long, scenery)
- GOOD: "Chalk test on aluminum gutter shows 12 circular gaps confirming hail dent pattern." (1 sentence, damage-focused)
- GOOD: "Wind-lifted shingle tab at rake edge exposes nail line — no rust confirms recent storm event." (1 sentence, forensic)

PHONE ORIENTATION: Some photos may appear rotated/sideways. If siding appears vertical but windows, doors, or ground line suggest the photo is rotated, assume HORIZONTAL siding. Board-and-batten is rare in residential — default to lap/horizontal siding unless clearly vertical with visible battens.

CRITICAL — CHALK TESTING (you MUST understand this):
Inspectors use chalk testing to document hail damage. This is standard industry practice, NOT sealant, paint, caulk, or repair material.

ON FLAT SOFT METALS (gutters, downspouts, flashing, pipe collars, vents, standing seam, power fan covers, skylight frames, HVAC units):
- Inspector runs chalk SIDEWAYS (flat, wide edge) horizontally across the metal surface
- A surface WITHOUT hail damage shows one solid continuous chalk line
- A surface WITH hail damage shows CIRCULAR GAPS in the chalk line — the gaps are hail impact dents/indentations where chalk cannot reach because the metal is pushed inward
- The circular unmarked areas within the chalk line = CONFIRMED HAIL IMPACTS
- More gaps = more hail hits = more severe damage
- On SKYLIGHT FRAMES: chalk is run horizontally across aluminum/steel mullions and frame members. Gaps in the chalk line on skylight frames = hail dents on the frame, NOT glazing damage, sealant, or paint. This is the same chalk test used on all soft metals.
- On DOWNSPOUTS: chalk is run vertically or horizontally across the flat face. Gaps = hail dents on the downspout body.

ON METAL ROOFS (standing seam, corrugated, R-panel, 5V-crimp):
- White/light streaks or lines across metal panels = CHALK TEST, not scuffing, scratching, abrasion, or coating loss
- Inspectors run chalk across the ENTIRE panel face to reveal hail dent patterns — the chalk skips over dents creating circular gaps
- NEVER describe chalk marks on metal roofs as "scuffing," "scratching," "abrasion," "coating loss," or "linear scratch marks" — this is chalk
- Correct annotation: "Chalk test across standing seam panels reveals multiple hail impact gaps — dent pattern confirms storm damage"
- If you see white streaks/marks on a metal roof surface, DEFAULT to chalk test marks. Actual coating damage is rare and looks different (rust, peeling, oxidation — not clean white lines)

ON SHINGLES (test square methodology):
- Inspector draws a chalk circle or box on the shingle to mark a test square
- Chalk letters indicate slope: F=Front, R=Right, L=Left, B/R=Back/Rear
- "H = 10" means 10 hail hits counted in that test square
- "W = 4" means 4 wind-damaged shingles in that test square
- A chalk LINE across a shingle = wind crease mark (functional wind damage requiring replacement)
- Individual chalk circles on shingles = marked hail impact points

WIND DAMAGE INDICATORS (EXPANDED — apply same rigor as hail):
- CREASED TABS (#1 wind indicator): Sharp horizontal fold at 1-2" above the bond strip (near nail line).
  Granule disruption CONCENTRATED at the crease line. Seal strip below is mechanically broken.
  Even if tab lies flat, the crease = FUNCTIONAL DAMAGE (HAAG standard) requiring replacement.
  Tag: damage_type="wind_crease", severity based on seal condition.
- MISSING SHINGLES with exposed nails: Check nail rust — NO RUST = recent storm, RUSTED = pre-existing.
  Torn mat at nail holes = forcible wind removal. Tag: damage_type="missing".
- BROKEN SEAL STRIPS: Tab lifts freely when touched. CLEAN mechanical separation = WIND broke it.
  DRY/CRUMBLING adhesive = AGE degradation. This distinction matters for coverage.
- TURNED-BACK LEADING EDGES: Tab folded 90-180 degrees backward. Extreme granule loss at fold line.
- RIDGE CAP BLOW-OFF: Missing or lifted ridge caps = strongest wind evidence (highest exposure point).
  Tag: damage_type="missing" or "lifted_tab" with trade="roofing".
- DIRECTIONAL PATTERN: Wind damage concentrates on WINDWARD faces. If you see damage primarily on
  one face with minimal damage on the opposite face, note the directional pattern — this is the
  forensic proof of a wind event.
- DEBRIS IMPACT: LINEAR gouges/punctures from wind-driven objects. Unlike CIRCULAR hail marks.
  Tag: damage_type="crack" or "missing" depending on severity.
- SOFFIT PANEL DISPLACEMENT: Soffit damage is almost always wind (hail cannot reach the underside
  of the overhang). Tag: damage_type="missing" or "lifted_tab" with trade="soffit".
- SIDING WIND DAMAGE: Blown-off or shifted panels, buckled panels from wind pressure, cracked vinyl
  from debris impact. CHECK DIRECTIONAL PATTERN across all 4 elevations.

CRITICAL WIND vs. HAIL ON METAL DISTINCTION (top correction pattern from user feedback):
- Coating loss at rib CRESTS in circular patterns on metal roofs = HAIL impact (tag: hail_dent)
- Damage at seam JOINTS from panel movement = WIND displacement (tag: wind_crease or lifted_tab)
- When you see bare metal on metal roof ribs, DEFAULT to hail unless the damage is specifically
  at seam connections with panel displacement visible. Users consistently correct wind_crease to
  hail on metal roof damage.

WIND vs. AGING — DO NOT CONFUSE:
- Wind crease = SHARP fold line at a specific point. Aging curl = GRADUAL curve from edges inward.
- Wind seal failure = DIRECTIONAL (windward > leeward). Age seal failure = UNIFORM all faces.
- Paint peeling / discoloration on trim = AGING (not wind). Do NOT tag as wind damage.

HAIL DAMAGE INDICATORS:
- Hail splatter (oxidation marks from hail impact) = confirms RECENT damage (splatter fades within ~6 months)
- Circular dents on metals (shown by chalk test gaps)
- Granule displacement on shingles exposing dark asphalt mat
- Fractured/cracked shingle mat (per HAAG standard = functional damage requiring full replacement)
- Soft metal deformation (gutters, vents, flashing)

MATERIAL INFERENCE (CRITICAL — fixes most common error):
- When a photo shows a CLOSE-UP of shingle damage (chalk circles, granule detail, mat texture), you can often NOT see enough of the shingle to identify the product.
- Do NOT default material to "other" for close-up damage shots. Infer material from context: if the claim's other photos show laminate/architectural shingles, tag close-ups as "asphalt_shingle" or "comp_shingle_laminated".
- "other" should ONLY be used when the material is genuinely unidentifiable AND no context clues exist from surrounding photos.
- Copper turret caps, metal chimney caps, and metal vent caps = material: "metal" and trade: "roofing" (not "flashing").

INSPECTOR LANGUAGE (use these exact terms — they carry legal weight):
- "soft to the touch" = confirmed mat fracture via press test (strongest hail evidence)
- "functional damage" = damage that impairs the shingle's function and requires replacement (the insurance trigger term)
- "bruised mat" = physical mat damage from hail impact
- "embedded granules" = impact velocity crushed granules into the asphalt layer (proves force of impact)
- "circular depression" = hail impact indent visible on shingle surface
Do NOT use these weak/generic terms: "granule displacement", "exposed mat", "dark mat visible", "granule loss pattern consistent with". These are textbook terms that adjusters dismiss.
Lead with the FINDING, not the description. "Functional damage confirmed" > "photo shows evidence of damage."

CHALK TEST NOTATION READING:
- Test square notations follow this format: [SIDE] H=[count]
- Common sides: FRONT, BACK, LEFT, RIGHT (sometimes abbreviated F, B, L, R)
- H= means hail hits counted in the 10x10 test square
- Only transcribe what is CLEARLY legible. Do not guess abbreviations.
- Example: "Right slope test square: H=11 hail hits confirmed" (not "markings read RHHF")

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
- Annotations: 1-2 sentences MAX, under 150 characters. Lead with the damage finding
- For chalk test photos: describe what the chalk test reveals (number of gaps = hail impacts), not the chalk itself. NEVER call chalk marks "sealant", "paint", "caulk", "adhesive", "coating", "glazing", or "residue" — it is ALWAYS inspector chalk used for hail damage documentation.
- For test square photos: report the counts (H=hits, W=wind) and what they prove
- CRITICAL: This is a SINGLE property at ONE address. Multiple structures (main dwelling, garage, shed, porch, outbuilding) are all part of ONE property. NEVER say "two properties", "both properties", or "multiple properties." Say "multiple structures" or "the property" instead.

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
    "photo_{start_num:02d}": "Chalk test on gutter reveals 8 circular gaps — confirmed hail dents.",
    "photo_{start_num + 1:02d}": "Wind-lifted tab at rake exposes rust-free nails — recent storm damage."
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
            model="claude-opus-4-6",
            max_tokens=4096,
            messages=[{"role": "user", "content": content}]
        )
        batch_result = _parse_json_response(response.content[0].text)

        # Merge batch results — enforce annotation length limit (1-2 sentences, <200 chars)
        for key, ann in batch_result.get("photo_annotations", {}).items():
            if isinstance(ann, str) and len(ann) > 200:
                # Find last sentence boundary within 200 chars (robust against abbreviations/decimals)
                truncated = ann[:200]
                last_break = truncated.rfind(". ")
                if last_break > 80:
                    ann = truncated[:last_break + 1]
                else:
                    # Fallback: hard truncate at 200 and add ellipsis
                    ann = truncated.rstrip(". ") + "."
            all_annotations[key] = ann
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
            siding_votes.append(batch_result["siding_type"].lower().strip())
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

    # Resolve siding_type by majority vote across batches (not last-batch-wins)
    if siding_votes:
        from collections import Counter
        siding_type = Counter(siding_votes).most_common(1)[0][0]

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
        "trades_identified": sorted(t.replace("_", " ") for t in trades_set),
        "key_findings": all_findings,
        "code_violations": all_violations,
        "damage_type": damage_type,
        "severity": severity,
        "photo_count": len(all_annotations),  # Filtered annotation count (excludes non-inspection images)
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
            resized = _shared_resize_photo(path, max_dim=1024, quality=60, suffix="_resized")
            if not resized:
                continue
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
        model="claude-opus-4-6",
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


def extract_carrier_scope(client: anthropic.Anthropic, pdf_path, extra_paths=None) -> dict:
    """Extract carrier scope data from insurance estimate PDF(s) or text file.

    Args:
        pdf_path: Primary scope file path (str)
        extra_paths: Additional scope file paths (list of str) — sent as additional
                     document blocks so Claude sees ALL scope pages in one call.
    """
    all_paths = [pdf_path] + (extra_paths or [])
    file_blocks = []
    for i, fpath in enumerate(all_paths):
        ext = fpath.lower().rsplit(".", 1)[-1] if "." in fpath else ""
        if ext == "txt":
            with open(fpath, "r", encoding="utf-8") as f:
                text_content = f.read()
            file_blocks.append({
                "type": "text",
                "text": f"[CARRIER DOCUMENT {i+1} of {len(all_paths)} — extracted from email]\n\n{text_content}",
            })
        else:
            pdf_b64 = file_to_base64(fpath)
            file_blocks.append({
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_b64},
            })

    extraction_prompt = """Read this insurance carrier scope/estimate and extract ALL data into this exact JSON format. Return ONLY valid JSON.

CRITICAL: For each line item, capture any notes/descriptions that explain WHAT the item is for.
Carriers sometimes use generic descriptions (e.g., "3-tab shingle") but include notes that reveal
the actual purpose (e.g., "starter course" or "cap shingles"). These notes are essential.

{
  "carrier": {
    "name": "Insurance Company Name",
    "claim_number": "XXX-XXXX",
    "policy_number": "XXXX",
    "adjuster_name": "Name if found",
    "adjuster_email": "email if found",
    "inspection_date": "Date if found",
    "inspector_company": "FieldAssist/Accurence/etc if found",
    "inspector_name": "Name if found",
    "insured_name": "Homeowner/insured name if found",
    "insured_email": "Homeowner email if found",
    "insured_phone": "Homeowner phone if found",
    "adjuster_phone": "Adjuster phone if found",
    "date_of_loss": "Date of loss if found"
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
      "unit_price": 0.00,
      "xact_code": "Xactimate catalog code if visible (e.g., RFG 300S, RFG IWS, SFG GUTA). null if not visible",
      "notes": "Any per-item notes, descriptions, or clarifications the carrier included for this line item (e.g., 'includes material and labor for starter course', 'cap shingles', 'per elevation'). Empty string if none."
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

    response = _call_claude_with_retry(client,
        _step_name="extract_carrier_scope",
        model="claude-opus-4-6",
        max_tokens=16384,
        messages=[{
            "role": "user",
            "content": [
                *file_blocks,
                {"type": "text", "text": extraction_prompt}
            ]
        }]
    )
    raw_text = response.content[0].text
    data = _parse_json_response(raw_text)

    # Continuation retry: if JSON was truncated (parse failed + response hit token limit),
    # ask Claude to continue from where it stopped
    if not data and raw_text and len(raw_text) > 500:
        print(f"[CARRIER EXTRACT] JSON truncated ({len(raw_text)} chars), attempting continuation...", flush=True)
        try:
            continuation = _call_claude_with_retry(client,
                _step_name="extract_carrier_scope_continue",
                model="claude-opus-4-6",
                max_tokens=16384,
                messages=[
                    {"role": "user", "content": [*file_blocks, {"type": "text", "text": extraction_prompt}]},
                    {"role": "assistant", "content": raw_text},
                    {"role": "user", "content": "Your JSON response was truncated. Continue EXACTLY from where you stopped — output ONLY the remaining JSON to complete the response. Do not restart."}
                ]
            )
            combined = raw_text + continuation.content[0].text
            data = _parse_json_response(combined)
            if data:
                print(f"[CARRIER EXTRACT] Continuation succeeded — parsed {len(data.get('carrier_line_items', []))} line items", flush=True)
            else:
                print(f"[CARRIER EXTRACT] Continuation also failed to parse", flush=True)
        except Exception as cont_err:
            print(f"[CARRIER EXTRACT] Continuation retry failed: {cont_err}", flush=True)

    # Normalize carrier items — canonical field names so downstream code doesn't need fallback chains
    for ci in data.get("carrier_line_items", []):
        # Ensure carrier_desc always exists (Claude sometimes only populates 'item')
        if not ci.get("carrier_desc") and ci.get("item"):
            ci["carrier_desc"] = ci["item"]
        elif not ci.get("item") and ci.get("carrier_desc"):
            ci["item"] = ci["carrier_desc"]
        # Ensure numeric fields default to 0
        for field in ("carrier_amount", "qty", "unit_price"):
            if ci.get(field) is None:
                ci[field] = 0
        # Ensure notes field exists (empty string if Claude omits it)
        if ci.get("notes") is None:
            ci["notes"] = ""

    _cli_count = len(data.get("carrier_line_items", []))
    print(f"[CARRIER EXTRACT] Extracted {_cli_count} carrier line items, carrier_rcv=${data.get('carrier_rcv', 0):,.2f}", flush=True)
    return data


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
    # If old_rcv is 0 but new_rcv > 0, treat as 100% win (baseline was zero)
    if old_rcv > 0:
        movement_pct = movement / old_rcv * 100
    elif new_rcv > 0 and movement > 0:
        movement_pct = 100.0
    else:
        movement_pct = 0

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
        model="claude-opus-4-6",
        max_tokens=2048,
        messages=[{"role": "user", "content": content}]
    )
    return _parse_json_response(response.content[0].text)


def search_weather_corroboration(city: str, state: str, storm_date: str) -> list[dict]:
    """Disabled — NOAA Storm Events data is used instead. Web search returned unreliable results."""
    return []


def _build_intel_section(intel_context: dict) -> str:
    """Build carrier intelligence context string for synthesis prompts. Max ~400 tokens."""
    if not intel_context:
        return ""
    carrier_intel = intel_context.get("carrier_intelligence", {})
    settlement = intel_context.get("settlement_prediction", {})
    score = carrier_intel.get("carrier_score", {})
    args = carrier_intel.get("general_effective_arguments", [])
    denials = carrier_intel.get("anticipated_denials", [])

    lines = []
    if score.get("total_claims"):
        lines.append(f"HISTORICAL DATA: {score.get('win_rate_pct', 0)}% win rate across {score['total_claims']} claims. "
                     f"Avg underpayment: {score.get('avg_underpayment_pct', 0)}%.")
    if args:
        arg_strs = [f"{a['argument']} (${a.get('dollar_impact', 0):,.0f} impact)"
                    for a in args[:3] if a.get("argument")]
        if arg_strs:
            lines.append("Top arguments: " + "; ".join(arg_strs))
    if denials:
        denial_strs = [f"{d['tactic_type']} ({d['count']}x)" for d in denials[:3] if isinstance(d, dict) and d.get("tactic_type")]
        if denial_strs:
            lines.append("Common denials: " + ", ".join(denial_strs))
    if settlement.get("data_points", 0) >= 2:
        rng = settlement.get("predicted_settlement_range", {})
        if rng and rng.get("low") is not None:
            lines.append(f"Settlement prediction: ${rng.get('low', 0):,.0f}-${rng.get('high', 0):,.0f} "
                        f"({settlement['confidence']} confidence)")
    if not lines:
        return ""
    return "\n\n" + "\n".join(lines) + "\nWeave relevant patterns where evidence supports them.\n"


from date_utils import format_date_human as _format_date_human


def _enforce_property_address(paragraphs: list, canonical_address: str) -> list:
    """Scrub hallucinated house numbers from LLM-generated paragraphs.

    Claude occasionally invents a different street number when narrating the
    property (seen: "10 Franklin" instead of "8 Franklin"). This finds any
    "<digits> <street_name>" reference whose street name matches the canonical
    address but whose number does NOT match, and swaps the number only —
    leaving the rest of the surrounding text untouched.
    """
    if not canonical_address or not paragraphs:
        return paragraphs
    m = re.match(r"^\s*(\d+[A-Za-z]?)\s+([A-Za-z][A-Za-z\.]*)", canonical_address)
    if not m:
        return paragraphs
    canonical_num = m.group(1)
    street_word = m.group(2).strip()
    if len(street_word) < 3:
        return paragraphs
    pattern = re.compile(
        rf"\b(\d+[A-Za-z]?)(\s+){re.escape(street_word)}\b",
        re.IGNORECASE,
    )

    def _replace(match):
        num = match.group(1)
        if num == canonical_num:
            return match.group(0)
        return f"{canonical_num}{match.group(2)}{street_word}"

    return [pattern.sub(_replace, p) if isinstance(p, str) else p for p in paragraphs]


def synthesize_executive_summary(
    client: anthropic.Anthropic,
    damage_summary: str,
    weather_data: dict,
    carrier_data: Optional[dict],
    material: str,
    key_findings: list,
    photo_count: int,
    intel_context: dict = None,
    property_address: str = "",
    date_of_loss: str = "",
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

    intel_section = _build_intel_section(intel_context)

    dol_display = _format_date_human(date_of_loss) if date_of_loss else ""
    prompt = f"""You are writing the Executive Summary for a forensic causation report on a storm-damaged property.
Property address: {property_address}
Date of loss: {dol_display or 'not specified'}
The roofing material is: {material}

CRITICAL: The property address is EXACTLY "{property_address}". Use this address verbatim in the report. NEVER change the house number even if a photo appears to show a different number.

CRITICAL: The date of loss is EXACTLY "{dol_display or 'not specified'}". When you reference the date of loss in the report, write it exactly as given. NEVER invent, guess, or paraphrase a different date. NEVER confuse the date of loss with the inspection date. If the date of loss is "not specified", write "the reported storm event" instead of making up a date.

Raw damage analysis from photo inspection:
{damage_summary[:3000]}

Weather data: Storm date {weather_data.get('storm_date', 'N/A')}, hail size {weather_data.get('hail_size', 'N/A')}
Photo count: {photo_count}
Key findings count: {len(key_findings)}
{f"Carrier RCV: ${carrier_rcv:,.2f}" if carrier_rcv > 0 else "Carrier scope: NOT YET RECEIVED (pre-scope forensic report)"}
{playbook_section}{intel_section}

Write 3-{4 if carrier_rcv > 0 else 3} SHORT paragraphs (2-4 sentences each) that build evidence gracefully:

Paragraph 1 — SCOPE: What property was inspected, what material systems are involved, what storm event caused the damage, and the date of loss. Set the scene.

Paragraph 2 — KEY DAMAGE FINDINGS: Summarize the primary storm damage documented — hail impacts on soft metals (confirmed by chalk testing), slate/roofing damage, gutter deformation. Be specific but concise. Do NOT list every minor observation.

Paragraph 3 — TECHNICAL BASIS: Why full replacement is required vs. spot repair — material matching impossibility, code compliance triggers, non-repairability of aged system post-storm.

{"Paragraph 4 — CARRIER VARIANCE: The carrier" + chr(39) + f"s scope at ${carrier_rcv:,.2f} does not account for [key missing items]. Our forensic analysis identifies a scope significantly beyond the carrier" + chr(39) + "s approved amount." if carrier_rcv > 0 else "IMPORTANT: There is NO carrier scope yet. This is a pre-scope forensic report. Do NOT reference carrier scope, carrier RCV, $0.00, or any carrier-approved amount. Do NOT write anything about what the carrier did or did not approve."}

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
    intel_context: dict = None,
    property_address: str = "",
    storm_event: str = "",
    finding_count: int = 0,
) -> list[str]:
    """Use Claude to synthesize a structured conclusion. Returns list of paragraph strings."""
    carrier_rcv = carrier_data.get("carrier_rcv", 0) if carrier_data else 0
    findings_text = "\n".join(f"- {f}" for f in key_findings[:15])
    violations_text = "\n".join(f"- {v.get('code','')}: {v.get('requirement', v.get('description',''))}" for v in code_violations[:10])
    intel_section = _build_intel_section(intel_context)

    prompt = f"""You are writing the Conclusion & Scope Determination section for a forensic causation report.
Property address: {property_address}
Roofing material: {material}

CRITICAL: The property address is EXACTLY "{property_address}". Use this address verbatim anywhere you reference the property. NEVER change the house number, street name, city, or ZIP even if a photo appears to show a different number. Do not invent or paraphrase the address.

Key forensic findings:
{findings_text}

Code violations documented:
{violations_text}

{f"Carrier RCV: ${carrier_rcv:,.2f}" if carrier_rcv > 0 else "Carrier scope: NOT YET RECEIVED (pre-scope forensic report)"}
Damage summary context: {damage_summary[:1500]}{intel_section}

Write 3-4 SHORT paragraphs (2-4 sentences each) that tie everything together:

Paragraph 1 — EVIDENCE SYNTHESIS: Based on our forensic analysis of {finding_count} documented findings, the property at {property_address} sustained confirmed storm damage from {storm_event}. Summarize the weight of evidence — chalk-tested hail impacts, fracture patterns, code violations.

Paragraph 2 — TECHNICAL DETERMINATION: The confirmed damage to [material] and associated components requires full system replacement. Explain WHY in 2-3 sentences — material matching, code triggers, non-repairability.

{f"Paragraph 3 — SCOPE RECOMMENDATION: Based on the documented damage, applicable building codes, and industry standards, we recommend full replacement of [systems]. The carrier" + chr(39) + f"s current scope of ${carrier_rcv:,.2f} does not adequately address the documented conditions." if carrier_rcv > 0 else "Paragraph 3 — SCOPE RECOMMENDATION: Based on the documented damage, applicable building codes, and industry standards, we recommend full replacement of [systems]. State what the forensic evidence supports — do NOT reference any carrier scope or dollar amount since no carrier scope has been received yet."}

Paragraph 4 (optional) — PROFESSIONAL STANDARD: Reference the applicable standards (HAAG, NRCA, IRC) that support the determination.

RULES:
- NO run-on paragraphs — 2-4 sentences each
- Professional, authoritative tone
- Tie the evidence together — don't just repeat findings
- Build toward the conclusion logically
- Do NOT pad with filler or repeat minor wear details
- CRITICAL UPPA COMPLIANCE: This is written for a CONTRACTOR. NEVER use "on behalf of," "demand," "appeal," cite 11 NYCRR, § 2601, or any advocacy language. Use factual documentation language — "our analysis identifies," "the documented damage requires," NOT "we demand" or "the carrier must."
- CRITICAL: This is a SINGLE property at ONE address. Multiple structures (main dwelling, garage, shed, porch) are all part of ONE property. NEVER say "two properties", "both properties", or "multiple properties."

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


def attach_evidence_photos(config: dict, sb, claim_id: str):
    """Query photos table and attach photo_refs to carrier line items.

    For each carrier line item, finds photos matching the item's trade/material
    and adds them as evidence references in the PDF scope comparison.
    """
    if not sb or not claim_id:
        return
    carrier_items = config.get("carrier", {}).get("carrier_line_items", [])
    if not carrier_items:
        return

    try:
        result = sb.table("photos").select(
            "annotation_key, damage_type, material, trade, elevation, severity, fraud_score"
        ).eq("claim_id", claim_id).execute()
        photos = result.data or []
    except Exception as e:
        print(f"[EVIDENCE] Failed to query photos: {e}")
        return

    if not photos:
        return

    # Build annotation_key → page-based key mapping
    # annotation_key format: "photo_01" → index 0 → p03_01
    def to_page_key(annotation_key: str) -> str:
        try:
            num = int(annotation_key.replace("photo_", ""))
            idx = num - 1
            return f"p{(idx // 3 + 3):02d}_{(idx % 3 + 1):02d}"
        except (ValueError, AttributeError):
            return annotation_key

    severity_score = {"critical": 40, "severe": 30, "moderate": 20, "minor": 10}

    # Trade keyword mapping: description keywords → photo trade tags
    trade_keywords = {
        "roofing": ["shingle", "roof", "ridge", "starter", "drip edge", "underlayment", "felt", "ice"],
        "siding": ["siding", "house wrap", "wall", "corner"],
        "gutters": ["gutter", "downspout", "fascia"],
        "flashing": ["flash", "chimney", "pipe", "vent", "step flash", "counter flash"],
        "window_wraps": ["window", "wrap", "caulk", "trim"],
    }

    attached = 0
    for ci in carrier_items:
        desc = (ci.get("usarm_desc") or ci.get("carrier_desc") or ci.get("item") or "").lower()
        if not desc or ci.get("photo_refs"):
            continue

        # Determine which trade this line item belongs to
        matched_trade = None
        for trade, keywords in trade_keywords.items():
            if any(kw in desc for kw in keywords):
                matched_trade = trade
                break

        if not matched_trade:
            continue

        # Score photos for this trade
        scored = []
        for p in photos:
            if p.get("trade") != matched_trade and matched_trade != "flashing":
                # Allow flashing photos from any trade (cross-cutting)
                if p.get("trade") != "flashing" or matched_trade != "flashing":
                    continue
            if p.get("damage_type") in ("none", "overview"):
                continue
            score = severity_score.get(p.get("severity", ""), 0)
            if (p.get("fraud_score") or 0) > 50:
                score -= 20
            scored.append((p, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        top = scored[:3]

        if top:
            ci["photo_refs"] = [to_page_key(p["annotation_key"]) for p, _ in top]
            attached += 1

    if attached:
        print(f"[EVIDENCE] Attached photo evidence to {attached}/{len(carrier_items)} carrier line items")


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
    phase = "post-scope" if (carrier_data and carrier_data.get("carrier_line_items")) else "pre-scope"
    if carrier_data and not carrier_data.get("carrier_line_items"):
        print(f"[PROCESS] WARNING: Scope files uploaded but carrier extraction found 0 line items — falling back to pre-scope", flush=True)

    # Determine trades and O&P — siding/gutters are opt-in via estimate_request
    # O&P is VALIDATED later against actual line items (Phase 1 fix)
    _est_req = claim.get("estimate_request") or {}
    trades = ["roofing"]  # Always included
    if _est_req.get("siding"):
        trades.append("siding")
    if _est_req.get("gutters"):
        trades.append("gutters")
    o_and_p = len(trades) >= 3  # Preliminary — validated after line items are built

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
    _tax_rates = {"NY": 0.08, "PA": 0.0, "NJ": 0.06625, "CT": 0.0635, "MD": 0.06, "DE": 0.0}
    tax_rate = _tax_rates.get(state, 0.08)
    if state not in _tax_rates:
        print(f"[CONFIG] WARNING: No tax rate configured for state '{state}' — defaulting to 8%. Verify with Tom.")

    # Build line items based on measurements and analysis (multi-structure aware)
    # Parse ZIP and city from full address for market-specific pricing
    claim_addr = claim.get("address", "")
    _zip_match = re.search(r'[A-Z]{2}\s+(\d{5})', claim_addr.upper())
    _zip = _zip_match.group(1) if _zip_match else ""
    _addr_parts = [p.strip() for p in claim_addr.split(",")]
    _city = _addr_parts[1] if len(_addr_parts) >= 3 else ""
    line_items = build_multi_structure_line_items(measurements, photo_analysis, state, user_notes=user_notes or "",
                                                  estimate_request=claim.get("estimate_request"),
                                                  roof_sections=claim.get("roof_sections"),
                                                  zip_code=_zip, city=_city)

    # Enrich line items with Xactimate codes, IRC citations, supplement arguments, AND correct prices
    registry = None
    try:
        registry = _get_registry(state, city=claim.get("address", "").split(",")[-2].strip() if "," in claim.get("address", "") else None)
        enriched_count = 0
        price_corrected = 0
        for li in line_items:
            lookup_desc = _clean_desc(li.get("description", ""))
            reg_item = registry.lookup_price(lookup_desc)
            if reg_item:
                # Validate trade compatibility before enriching (prevent siding-roofing cross-contamination)
                reg_trade = (reg_item.get("trade") or "").lower()
                li_trade = (li.get("trade") or li.get("category", "").lower() or "")
                trade_compatible = not reg_trade or not li_trade or reg_trade in li_trade.lower() or li_trade.lower() in reg_trade
                if trade_compatible:
                    # Add Xactimate metadata
                    li["code"] = reg_item.get("xact_code", "")
                    li["supplement_argument"] = reg_item.get("supplement_argument", "")
                    li["irc_code"] = reg_item.get("irc_code", "")
                    li["trade"] = li.get("trade") or reg_item.get("trade", "")
                    enriched_count += 1
                    # Override price from registry if registry price is higher (maximize legitimate estimate)
                    reg_price = reg_item.get("unit_price", 0)
                    current_price = li.get("unit_price", 0)
                    if reg_price > 0 and reg_price > current_price * 1.05:  # >5% higher = use registry price
                        li["unit_price"] = reg_price
                        price_corrected += 1
            else:
                li.setdefault("code", "")
                li.setdefault("supplement_argument", "")
                li.setdefault("irc_code", "")
        print(f"[XACT ENRICH] {enriched_count}/{len(line_items)} items enriched, {price_corrected} prices corrected from registry")
    except Exception as e:
        print(f"[XACT ENRICH] Failed (non-fatal, line items retain original format): {e}")

    # Enrich line items with jurisdiction-aware code citations (4-layer: code + requirement + argument + mfr specs)
    try:
        citation_count = enrich_line_items_with_citations(line_items, state)
        warranty_void_count = sum(1 for li in line_items if li.get("code_citation", {}).get("has_warranty_void"))
        print(f"[CODE COMPLIANCE] {citation_count}/{len(line_items)} items carry code citations, {warranty_void_count} have manufacturer warranty VOID warnings")
    except Exception as e:
        print(f"[CODE COMPLIANCE] Failed (non-fatal): {e}")

    # VALIDATE O&P against actual line item trades (not just estimate_request checkboxes)
    # Tom confirmed: debris/dumpster/general is NOT a trade. Only ROOFING, SIDING, GUTTERS count.
    _OAP_TRADE_CATEGORIES = {"ROOFING", "SIDING", "GUTTERS"}
    actual_trades = set()
    for li in line_items:
        cat = (li.get("category") or li.get("trade") or "").upper()
        if cat in _OAP_TRADE_CATEGORIES and li.get("qty", 0) > 0:
            actual_trades.add(cat)
    actual_o_and_p = len(actual_trades) >= 3
    if o_and_p != actual_o_and_p:
        print(f"[O&P FIX] estimate_request said O&P={o_and_p} but actual trades are {actual_trades} → O&P={actual_o_and_p}")
        o_and_p = actual_o_and_p
        trades = list(actual_trades) if actual_trades else trades

    # Build deterministic code violations based on state + scope
    deterministic_violations = _build_code_violations(state, line_items, trades)

    # ═══════════════════════════════════════════════════════════════════════════
    # SCOPE COMPARISON — Tom's methodology: Measurements → Carrier → Contractor
    #   Step 1 ✅ COMPLETE (above): Line items determined from measurements + photos
    #   Step 2: Compare determined line items against carrier scope
    #   Step 3: Carrier-informed data available for config building below
    # ═══════════════════════════════════════════════════════════════════════════

    # Detect roof material (from photos/notes/carrier — used for comparison hints)
    detected_material = _detect_roof_material(photo_analysis, user_notes or "",
                                               carrier_data, estimate_request=claim.get("estimate_request"))
    shingle_type = "3tab" if detected_material == "3tab" else "laminated"

    # Build scope measurements dict from EagleView data (ground truth)
    _meas_inner = measurements.get("measurements", {})
    _pens_inner = measurements.get("penetrations", {})
    scope_meas = {
        "remove_sq": sum(s.get("roof_area_sq", 0) for s in structs),
        "install_sq": sum(s.get("roof_area_sq", 0) for s in structs),
        "ridge_lf": _meas_inner.get("ridge", 0),
        "eave_lf": _meas_inner.get("eave", 0),
        "rake_lf": _meas_inner.get("rake", 0),
        "valley_lf": _meas_inner.get("valley", 0),
        "step_lf": _meas_inner.get("step_flashing", 0),
        "gutter_lf": _meas_inner.get("gutter", 0),
        "penetrations": _pens_inner.get("pipes", 0),
        "chimneys": _pens_inner.get("chimneys", 0),
        "pitch": 4,
        "stories": measurements.get("stories", 1),
    }

    # Step 2: Run scope comparison BEFORE building config (carrier examined AFTER measurements)
    scope_comparison_matched = None
    _has_carrier = bool(carrier_data)
    _has_cli = bool(carrier_data.get("carrier_line_items")) if carrier_data else False
    print(f"[SCOPE DEBUG] Guard check: carrier_data={_has_carrier}, carrier_line_items={_has_cli}", flush=True)
    if carrier_data and carrier_data.get("carrier_line_items"):
        try:
            if not registry:
                registry = _get_registry(state, city=prop.get("city"))

            # Debug: verify measurements are populated before scope comparison
            _meas_vals = {k: v for k, v in scope_meas.items() if v}
            print(f"[SCOPE DEBUG] scope_meas keys with values: {list(_meas_vals.keys())}", flush=True)
            print(f"[SCOPE DEBUG] carrier_items={len(carrier_data['carrier_line_items'])}, usarm_items={len(line_items)}, state={state}, shingle={shingle_type}", flush=True)

            # Centralized engine: matching + UP001-UP008 rules + enrichment
            from scope_comparison.engine import ScopeEngine
            _engine = ScopeEngine()
            scope_comparison_matched, _rules_result = _engine.run(
                registry=registry,
                carrier_items=carrier_data["carrier_line_items"],
                usarm_items=line_items,
                measurements=scope_meas,
                state=state,
                config_hints={"shingle_type": shingle_type}
            )

        except Exception as e:
            print(f"[SCOPE ENGINE] Scope comparison failed: {e}", flush=True)
            import traceback as _tb
            _tb.print_exc()
            sys.stdout.flush()

    # Step 3: Carrier-informed data is now available — config building below uses comparison results
    # scope_comparison_matched replaces raw carrier_line_items in config["carrier"]

    # Filter photo_filenames to match filtered annotations (fix off-by-one when stock images removed)
    # photo_tags is ALREADY FILTERED by analyze_photos() — missing keys = removed non-inspection images
    # photo_tags keys are "photo_01", "photo_02", etc. (1-indexed); photo_filenames is 0-indexed
    photo_tags = photo_analysis.get("photo_tags", {})
    if photo_tags:
        filtered_filenames = []
        for idx, fname in enumerate(photo_filenames):
            tag_key = f"photo_{idx + 1:02d}"
            if tag_key in photo_tags:
                filtered_filenames.append(fname)
            else:
                print(f"[PHOTOS] Filtering out filename {fname} (tag {tag_key} was removed as non-inspection)")
        if filtered_filenames:
            print(f"[PHOTOS] Filenames: {len(photo_filenames)} → {len(filtered_filenames)} after filtering")
            photo_filenames = filtered_filenames

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

    # Photo map — map keys to actual filenames (only count images, skip non-image files)
    photo_map = {}
    _img_idx = 0
    for filename in photo_filenames:
        if get_media_type(filename).startswith("image/"):
            key = f"p{(_img_idx // 3 + 3):02d}_{(_img_idx % 3 + 1):02d}"
            photo_map[key] = filename
            _img_idx += 1

    # Sanitize contact_name — reject AI/bot names so USARM defaults apply
    _contact_name = (company_profile or {}).get("contact_name", "")
    _bad_name_words = ["dumb roof", "ai analysis", "automated", "bot", "ai agent"]
    if any(w in _contact_name.lower() for w in _bad_name_words):
        _contact_name = ""

    config = {
        "phase": phase,
        "company": {
            "name": (company_profile or {}).get("company_name", ""),
            "address": (company_profile or {}).get("address", ""),
            "city_state_zip": (company_profile or {}).get("city_state_zip", ""),
            "ceo_name": _contact_name,
            "ceo_title": (company_profile or {}).get("contact_title", ""),
            "email": (company_profile or {}).get("email", ""),
            "cell_phone": (company_profile or {}).get("phone", ""),
            "office_phone": (company_profile or {}).get("office_phone", "267-332-0197"),
            "website": (company_profile or {}).get("website", ""),
        },
        "property": {
            "address": claim.get("address", "") or prop.get("address", ""),
            "city": prop.get("city", ""),
            "state": state,
            "zip": prop.get("zip", ""),
            "year_built_OPTIONAL": prop.get("year_built", None),
        },
        "insured": {
            "name": claim.get("homeowner_name", "") or
                    (carrier_data or {}).get("carrier", {}).get("insured_name", "") or
                    (carrier_data or {}).get("insured_name", "") or
                    "Property Owner",  # Generic fallback — set homeowner_name in DB for real name
            "type": "homeowner"
        },
        "carrier": {
            "name": carrier_data["carrier"]["name"] if carrier_data else claim.get("carrier", ""),
            "claim_number": carrier_data["carrier"].get("claim_number", "Pending") if carrier_data else "Pending",
            "policy_number": carrier_data["carrier"].get("policy_number", "") if carrier_data else "",
            "adjuster_name": carrier_data["carrier"].get("adjuster_name", "") if carrier_data else "",
            "adjuster_email": carrier_data["carrier"].get("adjuster_email", "") if carrier_data else "",
            "carrier_rcv": carrier_data.get("carrier_rcv", 0) if carrier_data else 0,
            "deductible": carrier_data.get("carrier_deductible", 0) if carrier_data else 0,
            "inspector_company": carrier_data["carrier"].get("inspector_company", "") if carrier_data else "",
            "inspector_name": carrier_data["carrier"].get("inspector_name", "") if carrier_data else "",
            "inspection_date": carrier_data["carrier"].get("inspection_date", "") if carrier_data else "",
            "carrier_line_items": scope_comparison_matched or (carrier_data.get("carrier_line_items", []) if carrier_data else []),
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
            "usarm_inspector": _contact_name or "Tom Kovack Jr.",
            "usarm_title": (company_profile or {}).get("contact_title", "CEO"),
        },
        "scope": {
            "trades": trades,
            "o_and_p": o_and_p,
        },
        "financials": {
            "tax_rate": tax_rate,
            "price_list": STATE_PRICE_LIST.get(state, "NYBI26"),
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

        # Dynamic requested_actions based on actual claim variance
        carrier_name = config["carrier"]["name"] or "the carrier"
        variance = config["financials"].get("total", 0) - config["carrier"].get("carrier_rcv", 0)
        dynamic_actions = []
        if variance > 0:
            dynamic_actions.append(
                f"Review the enclosed forensic documentation and revised scope of loss identifying ${variance:,.2f} in underpayment"
            )
        else:
            dynamic_actions.append(
                "Review the enclosed forensic documentation and revised scope of loss"
            )
        dynamic_actions.append(
            "Issue revised payment reflecting the full scope of documented storm-related damage"
        )
        if config["carrier"].get("carrier_line_items"):
            dynamic_actions.append(
                "Address the line-by-line variance analysis identifying specific underpaid and omitted items"
            )
        dynamic_actions.append(
            "Schedule a re-inspection if additional verification is needed"
        )
        config["appeal_letter"]["requested_actions"] = dynamic_actions
        config["appeal_letter"]["demand_items"] = dynamic_actions

    # Storm date fallback: use date_of_loss if no NOAA storm date
    if not config["weather"].get("storm_date") and config["dates"].get("date_of_loss"):
        config["weather"]["storm_date"] = config["dates"]["date_of_loss"]

    # Set correct price list for state if not from carrier
    if not config["financials"].get("price_list"):
        config["financials"]["price_list"] = STATE_PRICE_LIST.get(state, "NYBI26")

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
    # detected_material already computed above during scope comparison setup (measurements-first order)
    material_labels = {
        "laminated": "Architectural Laminated Comp Shingle",
        "3tab": "3-Tab 25yr Comp Shingle",
        "slate": "Natural Slate",
        "tile": "Clay/Concrete Tile",
        "metal_standing_seam": "Standing Seam Metal",
        "copper": "Copper",
        "flat": "Modified Bitumen / Flat Roof",
    }
    if config.get("structures"):
        if len(config["structures"]) > 1:
            # Multi-structure: preserve per-structure shingle_type from extraction,
            # only fill in claim-wide default where struct has no classifiable material
            default_label = material_labels.get(detected_material, detected_material)
            for s in config["structures"]:
                existing = s.get("shingle_type", "")
                if not existing or not _classify_from_text(existing):
                    s["shingle_type"] = default_label
        else:
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

    # Scope comparison already completed above (measurements-first methodology).
    # config["carrier"]["carrier_line_items"] contains comparison results, not raw carrier items.

    return config




def _classify_from_text(text: str) -> Optional[str]:
    """Classify roofing material from a text string.

    Returns one of: 'slate', 'tile', 'flat', 'metal_standing_seam', 'copper',
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
    if any(kw in text for kw in ["modified bitumen", "mod bit", "flat roof", "tpo",
                                  "epdm", "built-up", "bur", "rubber roof", "torch down"]):
        return "flat"
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
    priority = ["slate", "tile", "flat", "metal_standing_seam", "copper", "3tab", "laminated"]

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

    Returns one of: 'slate', 'tile', 'flat', 'metal_standing_seam', 'copper',
    'laminated', '3tab', or defaults to 'laminated'.
    """
    # Definitive override from frontend estimate request
    if estimate_request and estimate_request.get("roof_material"):
        material_map = {
            "3-Tab": "3tab",
            "Laminate Comp Shingle": "laminated",
            "Premium Grade Laminate Comp Shingle": "laminated_premium",
            "Slate": "slate",
            "Standing Seam Metal": "metal_standing_seam",
            "Tile": "tile",
            "Flat Roof": "flat",
            "Modified Bitumen": "flat",
            "TPO": "flat",
            "EPDM": "flat",
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


def _reconstruct_measurements_from_carrier(carrier_line_items: list) -> dict:
    """Reconstruct measurements from carrier line items when EagleView extraction fails.
    Deterministic — no AI call needed. Returns a measurements dict matching extract_measurements format."""
    roof_area_sf = 0
    drip_edge = 0
    ridge_hip = 0
    eave = 0
    rake = 0
    valley = 0
    gutter_lf = 0
    starter_lf = 0
    ridge_vent_lf = 0

    for item in carrier_line_items:
        desc = (item.get("description") or item.get("carrier_desc") or "").lower()
        qty = float(item.get("quantity") or item.get("qty") or 0)
        unit = (item.get("unit") or "").upper()

        # Roof area from shingle install/tearoff (SQ → SF)
        if any(kw in desc for kw in ["shingle", "roofing", "comp roof", "laminate"]):
            if any(kw in desc for kw in ["install", "apply", "re-roof", "reroof", "tear", "remove"]):
                if unit == "SQ" or qty < 200:  # SQ values are typically < 200
                    roof_area_sf = max(roof_area_sf, qty * 100)
                else:
                    roof_area_sf = max(roof_area_sf, qty)  # Already in SF

        # Drip edge
        if "drip edge" in desc or "drip-edge" in desc:
            drip_edge = max(drip_edge, qty)

        # Ridge/hip cap
        if "ridge" in desc and ("cap" in desc or "hip" in desc):
            ridge_hip = max(ridge_hip, qty)

        # Gutters → infer eave (gutter LF ÷ 1.6)
        if "gutter" in desc and "down" not in desc:
            gutter_lf = max(gutter_lf, qty)

        # Starter strip
        if "starter" in desc:
            starter_lf = max(starter_lf, qty)

        # Ridge vent
        if "ridge vent" in desc or "ridge-vent" in desc:
            ridge_vent_lf = max(ridge_vent_lf, qty)

        # Valley
        if "valley" in desc:
            valley = max(valley, qty)

    # Infer eave from gutter LF or starter strip
    if gutter_lf:
        eave = round(gutter_lf / 1.6)
    elif starter_lf:
        eave = round(starter_lf)

    # Infer rake from drip edge - eave (drip edge covers eave + rake)
    if drip_edge and eave:
        rake = max(0, round(drip_edge - eave))

    # Infer ridge from ridge/hip cap or ridge vent
    ridge = ridge_vent_lf if ridge_vent_lf else round(ridge_hip * 0.6) if ridge_hip else 0
    hip = round(ridge_hip - ridge) if ridge_hip > ridge else 0

    if not roof_area_sf:
        return {"structures": [{}], "measurements": {}, "_carrier_fallback": True}

    roof_area_sq = round(roof_area_sf / 100, 2)
    print(f"[FALLBACK] Reconstructed: {roof_area_sf} SF, drip={drip_edge} LF, "
          f"eave={eave} LF, rake={rake} LF, ridge={ridge} LF, hip={hip} LF")

    return {
        "structures": [{
            "name": "Main Roof",
            "roof_area_sf": roof_area_sf,
            "roof_area_sq": roof_area_sq,
            "waste_factor": 1.10,
            "predominant_pitch": "6/12",  # Conservative default
            "facets": 0,
            "style": "combination",
        }],
        "measurements": {
            "ridge": ridge,
            "hip": hip,
            "valley": valley,
            "rake": rake,
            "eave": eave,
            "drip_edge": drip_edge,
            "flashing": 0,
            "step_flashing": 0,
        },
        "property": {},
        "_carrier_fallback": True,
    }


def _has_trade(trades: list, keyword: str) -> bool:
    """Fuzzy trade matching — checks if keyword appears in any trade name."""
    kw = keyword.lower()
    return any(kw in t.lower() for t in trades)


def _detect_siding_material(photo_analysis: dict, user_notes: str = "", estimate_request: dict = None, measurements: dict = None) -> str:
    """Detect siding material from photo analysis, user notes, and wall measurements.
    Returns: aluminum, vinyl, vinyl_high, vinyl_insulated, cedar, fiber_cement, metal
    Default: aluminum (safer to price higher)."""
    # estimate_request override is DEFINITIVE (user-selected from dropdown)
    if estimate_request and estimate_request.get("siding"):
        siding_map = {
            "Vinyl Siding": "vinyl",
            "Vinyl w/ Insulation": "vinyl_insulated",
            "Aluminum": "aluminum",
            "Cedar": "cedar",
            "Specialty": "fiber_cement",
        }
        mapped = siding_map.get(estimate_request["siding"])
        if mapped:
            print(f"[SIDING] Using estimate request override: {estimate_request['siding']} → {mapped}")
            return mapped
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

    # Check EagleView walls extraction as additional signal
    walls_siding = (measurements or {}).get("walls", {}).get("siding_type", "").lower()
    if walls_siding and walls_siding != "none":
        if "vinyl" in walls_siding:
            return "vinyl"
        if "cedar" in walls_siding:
            return "cedar"
        if "fiber" in walls_siding or "hardie" in walls_siding or "cement" in walls_siding:
            return "fiber_cement"
        if "metal" in walls_siding:
            return "metal"
        if "stucco" in walls_siding:
            return "fiber_cement"
        if "aluminum" in walls_siding:
            return "aluminum"

    # Default to aluminum (most common in NY/PA, prices higher = safer estimate)
    return "aluminum"


def build_roof_sections(measurements: dict, photo_analysis: dict = None, provider: str = "unknown") -> dict:
    """Build per-slope breakdown for the UI slope editor.

    Reads structures[].pitches[] from extracted measurements and returns a
    flat list of sections suitable for the frontend RoofSectionsEditor.
    Provider-agnostic: works with EagleView, HOVER, GAF QuickMeasure, etc.
    """
    structures = measurements.get("structures", [])
    sections = []
    total_sf = 0

    for si, struct in enumerate(structures):
        struct_name = struct.get("name", f"Structure {si + 1}")
        pitches = struct.get("pitches", [])
        if not pitches:
            # Single-pitch structure — create one section for the whole roof
            area_sf = struct.get("roof_area_sf", 0)
            area_sq = struct.get("roof_area_sq", area_sf / 100 if area_sf else 0)
            pitch = struct.get("predominant_pitch", "")
            sections.append({
                "structure_index": si,
                "structure_name": struct_name,
                "pitch": pitch,
                "area_sf": round(area_sf, 1),
                "area_sq": round(area_sq, 2),
                "percent": 100,
                "detected_material": _classify_from_text(struct.get("shingle_type", "")) or "asphalt_shingle",
                "user_material_override": None,
            })
            total_sf += area_sf
        else:
            for pitch_entry in pitches:
                area_sf = pitch_entry.get("area_sf", 0)
                area_sq = area_sf / 100 if area_sf else 0
                sections.append({
                    "structure_index": si,
                    "structure_name": struct_name,
                    "pitch": pitch_entry.get("pitch", ""),
                    "area_sf": round(area_sf, 1),
                    "area_sq": round(area_sq, 2),
                    "percent": pitch_entry.get("percent", 0),
                    "detected_material": _classify_from_text(struct.get("shingle_type", "")) or "asphalt_shingle",
                    "user_material_override": None,
                })
                total_sf += area_sf

    if not sections:
        return None

    # Dedup: if multiple structures have identical area/pitch, they're likely extraction duplicates
    # (e.g., Claude seeing the same roof data on summary + detail pages of EagleView PDF)
    if len(structures) > 1:
        seen_fingerprints = set()
        deduped_sections = []
        deduped_sf = 0
        for s in sections:
            fp = f"{s['area_sf']}_{s['pitch']}"
            if fp in seen_fingerprints:
                continue
            seen_fingerprints.add(fp)
            deduped_sections.append(s)
            deduped_sf += s["area_sf"]
        if len(deduped_sections) < len(sections):
            removed = len(sections) - len(deduped_sections)
            print(f"[DEDUP] Removed {removed} duplicate roof sections (identical area+pitch across structures)")
            # Re-index to structure 0 since they collapsed into one
            for s in deduped_sections:
                s["structure_index"] = 0
                s["structure_name"] = "Structure 1"
            sections = deduped_sections
            total_sf = deduped_sf

    return {
        "provider": provider,
        "sections": sections,
        "total_area_sf": round(total_sf, 1),
        "total_area_sq": round(total_sf / 100, 2),
    }


def build_multi_structure_line_items(measurements: dict, photo_analysis: dict, state: str,
                                      user_notes: str = "", estimate_request: dict = None,
                                      roof_sections: dict = None, zip_code: str = "", city: str = "") -> list:
    """Build complete line item sections per structure. Never combines structures.

    For single-structure claims (most claims), passes through to build_line_items().
    For multi-structure claims, calls build_line_items() once per structure and labels
    each item with the structure name prefix.

    If roof_sections contains user_material_override entries, splits structures into
    sub-groups by material and generates separate line items per material.
    """
    structs = measurements.get("structures", [{}])

    # Collect per-slope material overrides from roof_sections
    slope_overrides = {}  # {structure_index: {pitch: material}}
    if roof_sections and roof_sections.get("sections"):
        for section in roof_sections["sections"]:
            if section.get("user_material_override"):
                si = section.get("structure_index", 0)
                slope_overrides.setdefault(si, {})[section.get("pitch", "")] = section["user_material_override"]

    if len(structs) <= 1 and not slope_overrides:
        return build_line_items(measurements, photo_analysis, state, user_notes, estimate_request, zip_code=zip_code, city=city)

    # For single-structure claims with slope overrides, treat as multi-structure
    if len(structs) <= 1 and slope_overrides:
        structs = measurements.get("structures", [{}])
        if not structs:
            structs = [{}]

    all_items = []
    for i, struct in enumerate(structs):
        struct_name = struct.get("name", f"Structure {i+1}")
        overrides_for_struct = slope_overrides.get(i, {})

        # If this structure has per-slope material overrides, split by material
        if overrides_for_struct:
            # Group slopes by effective material
            material_groups = {}  # {material: total_area_sf}
            base_material = _classify_from_text(struct.get("shingle_type", "")) or "laminated"
            pitches = struct.get("pitches", [])

            if pitches:
                for pitch_entry in pitches:
                    pitch = pitch_entry.get("pitch", "")
                    area_sf = pitch_entry.get("area_sf", 0)
                    mat = overrides_for_struct.get(pitch, base_material)
                    material_groups.setdefault(mat, 0)
                    material_groups[mat] += area_sf
            else:
                # No pitch breakdown — check if all overrides are the same material
                total_sf = struct.get("roof_area_sf", 0)
                if overrides_for_struct:
                    # Apply overrides to the percentage of the roof they represent
                    sections_for_struct = [s for s in (roof_sections or {}).get("sections", [])
                                           if s.get("structure_index") == i]
                    for sec in sections_for_struct:
                        mat = sec.get("user_material_override") or base_material
                        area_sf = sec.get("area_sf", 0)
                        material_groups.setdefault(mat, 0)
                        material_groups[mat] += area_sf
                if not material_groups:
                    material_groups[base_material] = total_sf

            # Generate line items for each material sub-group
            for mat, area_sf in material_groups.items():
                if area_sf <= 0:
                    continue
                area_sq = area_sf / 100.0
                sub_meas = {
                    "measurements": struct.get("measurements", measurements.get("measurements", {})),
                    "structures": [{**struct, "roof_area_sf": area_sf, "roof_area_sq": area_sq}],
                    "penetrations": struct.get("penetrations", measurements.get("penetrations", {})),
                    "stories": struct.get("stories", measurements.get("stories", 1)),
                    "total_roof_area_sf": area_sf,
                    "total_roof_area_sq": area_sq,
                    # Walls/siding: each structure gets its own walls if available, fallback to property-level for first structure
                    "walls": struct.get("walls") or (measurements.get("walls", {}) if i == 0 else {}),
                }

                # Map UI material names to estimate_request format
                mat_er = {"roof_material": mat}
                sub_notes = f"{mat}. {user_notes}" if user_notes else mat

                items = build_line_items(sub_meas, photo_analysis, state, sub_notes, mat_er, zip_code=zip_code, city=city)
                if len(structs) > 1:
                    for item in items:
                        item["structure"] = struct_name  # metadata for PDF sectioning
                all_items.extend(items)
                print(f"[LINE ITEMS] {struct_name} ({mat}): {len(items)} items, {area_sq:.1f} SQ, material = slope override")
        else:
            # No overrides — standard processing
            struct_measurements = {
                "measurements": struct.get("measurements", measurements.get("measurements", {})),
                "structures": [struct],
                "penetrations": struct.get("penetrations", measurements.get("penetrations", {})),
                "stories": struct.get("stories", measurements.get("stories", 1)),
                "total_roof_area_sf": struct.get("roof_area_sf", 0),
                "total_roof_area_sq": struct.get("roof_area_sq", 0),
                # Walls/siding: each structure gets its own walls if available, fallback to property-level for first structure
                "walls": struct.get("walls") or (measurements.get("walls", {}) if i == 0 else {}),
            }

            # Per-structure material via shingle_type → user_notes (weight 3.0 in detector)
            struct_note = struct.get("shingle_type", "")
            combined_notes = f"{struct_note}. {user_notes}" if struct_note else user_notes

            # Per-structure material override hierarchy:
            # 1. estimate_request.structures[i].roof_material (explicit per-structure override from frontend)
            # 2. struct.shingle_type classifiable → suppress claim-wide override, let weighted voting decide
            # 3. Claim-wide estimate_request.roof_material as fallback default
            struct_er = estimate_request  # default: claim-wide
            if estimate_request:
                er_structs = estimate_request.get("structures") or []
                if i < len(er_structs) and (er_structs[i] or {}).get("roof_material"):
                    struct_er = {"roof_material": er_structs[i]["roof_material"]}
                elif struct_note and _classify_from_text(struct_note):
                    struct_er = None

            items = build_line_items(struct_measurements, photo_analysis, state, combined_notes, struct_er, zip_code=zip_code, city=city)

            if len(structs) > 1:
                for item in items:
                    item["structure"] = struct_name  # metadata for PDF sectioning

            all_items.extend(items)
            mat_source = ('per-struct override' if struct_er and struct_er is not estimate_request
                          else 'weighted voting' if struct_er is None
                          else 'claim-wide override')
            print(f"[LINE ITEMS] {struct_name}: {len(items)} items, {struct.get('roof_area_sq', 0)} SQ, material source = {mat_source}")

    # Dedup claim-wide items — 1 dumpster, 1 equipment operator, 1 labor minimum per claim
    # Applies to ALL claims (single or multi-structure)
    if True:
        _CLAIM_WIDE_KEYWORDS = {"labor minimum", "siding labor", "equipment operator", "dumpster", "scaffolding"}
        seen_claim_wide = set()
        deduped = []
        for item in all_items:
            desc_lower = item.get("description", "").lower()
            matched_kw = next((kw for kw in _CLAIM_WIDE_KEYWORDS if kw in desc_lower), None)
            if matched_kw:
                # Dedup by keyword (not full description) — 1 dumpster, 1 equipment, 1 labor per claim
                if matched_kw in seen_claim_wide:
                    continue  # skip duplicate
                seen_claim_wide.add(matched_kw)
            deduped.append(item)
        removed = len(all_items) - len(deduped)
        if removed:
            print(f"[LINE ITEMS] Deduped {removed} claim-wide items (labor/dumpster/equipment — one per claim)")
        all_items = deduped

    print(f"[LINE ITEMS] Total across {len(structs)} structures: {len(all_items)} items")

    # Multi-structure: sort WITHIN each structure, preserve structure grouping.
    # build_line_items() already sorts each structure's items (line 3213).
    # Do NOT re-sort globally — that interleaves structures and destroys sections.
    if len(structs) > 1:
        # Items are already in structure order (house items, then garage, then shed).
        # Each batch is already sorted by _sort_line_items inside build_line_items().
        return all_items
    else:
        return _sort_line_items(all_items)


def _extract_damage_triggers(photo_analysis: dict) -> dict:
    """Extract optional line item triggers from photo analysis findings.

    Co-work's damage→scope bridge: photos DRIVE which optional items appear.
    Reads photo_tags for material/trade combos that imply penetrations,
    reads key_findings for explicit mentions of chimneys, skylights, pipes, copper.

    Returns dict: {"chimneys": int, "skylights": int, "pipes": int,
                    "copper_bay_sf": float, "vents": int, "satellite_dishes": int, ...}
    """
    triggers = {}
    photo_tags = photo_analysis.get("photo_tags", {})
    key_findings = photo_analysis.get("key_findings", [])
    damage_summary = (photo_analysis.get("damage_summary") or "").lower()

    # --- Scan photo_tags for penetration/component evidence ---
    _COMPONENT_KEYWORDS = {
        "chimney": "chimneys",
        "skylight": "skylights",
        "pipe": "pipes",
        "pipe boot": "pipes",
        "pipe jack": "pipes",
        "vent": "vents",
        "exhaust vent": "vents",
        "satellite": "satellite_dishes",
        "copper": "copper_detected",
        "bay window": "bay_windows",
        "dormer": "dormers",
        "gutter": "gutter_damage",
        "downspout": "gutter_damage",
    }

    for tag_key, tag_val in photo_tags.items():
        if not isinstance(tag_val, dict):
            continue
        # Check material field, trade field, and damage_type for component keywords
        tag_text = " ".join([
            str(tag_val.get("material", "")),
            str(tag_val.get("trade", "")),
            str(tag_val.get("damage_type", "")),
            str(tag_val.get("component", "")),
        ]).lower()

        for keyword, trigger_key in _COMPONENT_KEYWORDS.items():
            if keyword in tag_text:
                triggers[trigger_key] = triggers.get(trigger_key, 0) + 1

    # --- Scan key_findings for explicit component mentions ---
    findings_text = " ".join(key_findings).lower() if key_findings else ""
    combined_text = findings_text + " " + damage_summary

    _FINDING_PATTERNS = {
        "chimney": "chimneys",
        "skylight": "skylights",
        "pipe boot": "pipes",
        "pipe jack": "pipes",
        "plumbing vent": "pipes",
        "exhaust vent": "vents",
        "ridge vent": "ridge_vent",
        "copper": "copper_detected",
        "bay window": "bay_windows",
        "dormer": "dormers",
    }

    for pattern, trigger_key in _FINDING_PATTERNS.items():
        if pattern in combined_text:
            # Don't double-count — set to max(1, existing)
            triggers[trigger_key] = max(triggers.get(trigger_key, 0), 1)

    # --- Deduplicate: photos might show same chimney from multiple angles ---
    # Cap counts at reasonable maximums (3+ chimneys on a residential home = unlikely)
    _MAX_COUNTS = {"chimneys": 3, "skylights": 4, "pipes": 8, "vents": 6,
                   "satellite_dishes": 2, "bay_windows": 3, "dormers": 4}
    for key, max_val in _MAX_COUNTS.items():
        if key in triggers:
            # Multiple photos of same component ≠ multiple components
            # Use sqrt heuristic: 4 photos → 2 components, 9 photos → 3 components
            import math
            raw = triggers[key]
            triggers[key] = min(max_val, max(1, int(math.sqrt(raw))))

    if triggers:
        print(f"[DAMAGE TRIGGERS] Photo-detected components: {triggers}")

    return triggers


def build_line_items(measurements: dict, photo_analysis: dict, state: str, user_notes: str = "", estimate_request: dict = None, zip_code: str = "", city: str = "") -> list:
    """Build Xactimate line items from measurements, analysis, and user context."""
    # Use location-specific pricing from Alfonso's all-markets.json
    PRICING = get_pricing_for_state(state, zip_code=zip_code, city=city)

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

    # DAMAGE→SCOPE BRIDGE: Merge photo-detected components with measurement penetrations
    # Photos may catch chimneys/skylights/pipes that EagleView didn't report
    damage_triggers = _extract_damage_triggers(photo_analysis)
    for comp_key in ("pipes", "vents", "skylights", "chimneys"):
        meas_count = penetrations.get(comp_key, 0)
        photo_count = damage_triggers.get(comp_key, 0)
        if meas_count == 0 and photo_count > 0:
            penetrations[comp_key] = photo_count
            print(f"[DAMAGE BRIDGE] {comp_key}: EagleView=0, photos={photo_count} → using photo evidence")

    # USER NOTES → SCOPE BRIDGE: Parse explicit component counts from user notes
    # e.g., "7 skylights", "2 chimneys", "3 pipe boots"
    if user_notes:
        import re
        _NOTES_COMPONENT_PATTERNS = {
            r'(\d+)\s*skylight': "skylights",
            r'(\d+)\s*chimney': "chimneys",
            r'(\d+)\s*chimneys': "chimneys",
            r'(\d+)\s*pipe': "pipes",
            r'(\d+)\s*vent': "vents",
            r'(\d+)\s*dormer': "dormers",
            r'(\d+)\s*satellite': "satellite_dishes",
        }
        notes_lower = user_notes.lower()
        for pattern, comp_key in _NOTES_COMPONENT_PATTERNS.items():
            match = re.search(pattern, notes_lower)
            if match:
                count = int(match.group(1))
                current = penetrations.get(comp_key, 0)
                if count > current:
                    penetrations[comp_key] = count
                    print(f"[NOTES BRIDGE] {comp_key}: user_notes={count} (was {current}) → using user-specified count")

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
    # State-specific I&W formulas (confirmed by Tom):
    #   NY/NJ/CT/MA (cold climate): 2 courses at eaves (6ft) + 1 course in valleys (3ft)
    #   PA/MD/DE (moderate climate): 1 course at eaves (3ft) + full valley coverage (6ft)
    if state.upper() in ("PA", "MD", "DE"):
        iw_sf = (eave * 3) + (valley * 6)  # 1 course from eave, full valley coverage
    else:
        iw_sf = (eave * 6) + (valley * 3)  # 2 courses from eave (NY/NJ/CT default)

    # ===================== UNDERLAYMENT =====================
    # Felt/synthetic covers the REMAINDER of the roof deck NOT covered by ice & water barrier.
    # I&W goes at eaves + valleys; felt covers the rest of the deck.
    if iw_sf > 0 and area_sf > 0:
        felt_sf = max(0, area_sf - iw_sf)
        felt_sq = round(felt_sf / 100, 2)
    else:
        felt_sq = area_sq  # No I&W = felt covers entire deck

    # ===================== WASTE FACTOR =====================
    # Remove = exact area (0% waste). Install = area + waste.
    # Complexity-based: facet count drives waste (Co-work methodology).
    if facets >= 20:        # Complex roof (20+ facets)
        waste_factor = 1.15
    elif facets >= 10:      # Moderate complexity
        waste_factor = 1.12
    elif "hip" in style.lower():
        waste_factor = 1.12  # Hip roofs without high facet count
    else:
        waste_factor = 1.10  # Simple gable
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
    elif material == "flat":
        items.append({"category": "ROOFING", "description": "Remove modified bitumen/flat roofing", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("flat_remove", 95.00)})
        items.append({"category": "ROOFING", "description": "Modified bitumen roofing - 2 ply torch applied", "qty": install_sq, "unit": "SQ", "unit_price": PRICING.get("flat_install", 425.00)})
        items.append({"category": "ROOFING", "description": "Underlayment - base sheet (flat roof)", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("flat_underlayment", 38.00)})
    elif material == "metal_standing_seam":
        items.append({"category": "ROOFING", "description": "Remove metal roofing - standing seam", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("metal_remove", 150.00)})
        items.append({"category": "ROOFING", "description": "Metal roofing - standing seam", "qty": install_sq, "unit": "SQ", "unit_price": PRICING.get("metal_install", 850.00)})
        items.append({"category": "ROOFING", "description": "Underlayment - felt 15# (deck area not covered by I&W)", "qty": felt_sq, "unit": "SQ", "unit_price": PRICING.get("metal_underlayment", 32.00)})
    elif material == "laminated_premium":
        items.append({"category": "ROOFING", "description": "Remove laminated comp shingle roofing", "qty": area_sq, "unit": "SQ", "unit_price": PRICING.get("laminated_remove", 74.00)})
        items.append({"category": "ROOFING", "description": "Laminated - High grd - comp. shingle rfg. - w/out felt", "qty": install_sq, "unit": "SQ", "unit_price": PRICING.get("laminated_high_install", 383.17)})
        items.append({"category": "ROOFING", "description": "Underlayment - felt 15# (deck area not covered by I&W)", "qty": felt_sq, "unit": "SQ", "unit_price": PRICING.get("laminated_underlayment", 32.00)})
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
    drip = meas.get("drip_edge", 0) or round((eave + rake) * 1.05, 2)  # 5% waste factor
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
        step_with_waste = round(step * 1.05, 2)  # 5% waste factor
        if is_copper_flashing:
            items.append({"category": "ROOFING", "description": "R&R Step flashing - copper", "qty": step_with_waste, "unit": "LF", "unit_price": PRICING.get("step_flashing_copper", 22.00)})
        else:
            items.append({"category": "ROOFING", "description": "R&R Step flashing", "qty": step_with_waste, "unit": "LF", "unit_price": PRICING.get("step_flashing", 8.00)})

    if flashing > 0:
        if is_copper_flashing:
            items.append({"category": "ROOFING", "description": "R&R Counter/apron flashing - copper", "qty": flashing, "unit": "LF", "unit_price": PRICING.get("counter_flashing_copper", 28.00)})
        else:
            items.append({"category": "ROOFING", "description": "R&R Counter/apron flashing", "qty": flashing, "unit": "LF", "unit_price": PRICING.get("counter_flashing", 9.50)})

    # ===================== CHIMNEY FLASHING =====================
    # Per-EA pricing per chimney (matches real Xactimate: average 32"x36" = $643.86/EA)
    chimneys = penetrations.get("chimneys", 0)
    if chimneys > 0:
        if is_copper_flashing:
            items.append({"category": "ROOFING", "description": "R&R Chimney flashing - average (32\" x 36\") - copper", "qty": chimneys, "unit": "EA", "unit_price": PRICING.get("chimney_flashing_copper_ea", 840.00)})
        else:
            items.append({"category": "ROOFING", "description": "R&R Chimney flashing - average (32\" x 36\")", "qty": chimneys, "unit": "EA", "unit_price": PRICING.get("chimney_flashing_ea", 643.86)})

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
    # REMOVED from auto-generation — not all homes have gable cornice returns.
    # Available as a supplement option if the user confirms they exist on the property.
    # Pricing retained in PRICING dict for supplement builder use.

    # ===================== DEBRIS =====================
    # Slate/tile debris is significantly heavier — smaller loads, higher price per load
    if material in ("slate", "tile"):
        dumpster_loads = max(2, round(area_sq / 15))  # More loads for heavy material
        items.append({"category": "DEBRIS", "description": "Dumpster load - heavy roofing debris (slate/tile)", "qty": dumpster_loads, "unit": "EA", "unit_price": PRICING.get("dumpster_heavy", 950.00)})
    else:
        items.append({"category": "DEBRIS", "description": "Dumpster load - roofing debris", "qty": 1, "unit": "EA", "unit_price": PRICING.get("dumpster", 850.00)})

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

    # ===================== GUTTERS (opt-in via estimate_request only) =====================
    _est_req = estimate_request or {}
    has_gutter_line = any("gutter" in item["description"].lower() for item in items)
    if _est_req.get("gutters") and not has_gutter_line:
        gutter_lf = round(eave * 1.6) if eave > 0 else 0
        if gutter_lf > 0:
            items.append({"category": "GUTTERS", "description": "R&R Seamless aluminum gutter & downspout", "qty": gutter_lf, "unit": "LF", "unit_price": PRICING.get("gutter_aluminum", 10.50)})

    # ===================== SIDING (opt-in via estimate_request only) =====================
    # ALWAYS includes house wrap when siding is scoped
    # (RCNYS R703.2 — continuous weather-resistant exterior wall envelope required).
    # House wrap corner rule forces full replacement when carrier approves partial.
    if _est_req.get("siding"):
        walls = measurements.get("walls", {})
        wall_area = walls.get("total_wall_area_sf", 0)

        # Estimate wall area from roof footprint if EagleView walls data not available
        # NOTE: Do NOT use eave LF — eave includes ALL roof edges (dormers, valleys, etc.)
        # which hugely overestimates building perimeter. Use roof footprint instead.
        if wall_area == 0 and area_sf > 0:
            import math
            _footprint = area_sf / max(1, stories)  # Approximate per-floor area
            _side_length = math.sqrt(_footprint)
            _perimeter = round(_side_length * 4)  # Square building approximation
            _wall_height = max(1, stories) * 9  # ~9 ft per story
            wall_area = round(_perimeter * _wall_height)
            print(f"[LINE ITEMS] Estimated wall area from footprint: {_footprint:.0f} SF floor → {_perimeter} LF perimeter × {_wall_height} ft = {wall_area} SF")

        if wall_area > 0:
            siding_mat = _detect_siding_material(photo_analysis, user_notes, estimate_request=estimate_request, measurements=measurements)
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

            # House wrap — ALWAYS included with siding (code requirement)
            # This is the key argument: house wrap must wrap continuously around outside
            # corners — cannot terminate at a corner joint. Forces full replacement.
            _code_prefix = "RCNYS" if state == "NY" else "IRC"
            items.append({"category": "SIDING", "description": f"House wrap / Tyvek (code-required per {_code_prefix} R703.2)", "qty": wall_area, "unit": "SF", "unit_price": PRICING.get("house_wrap", 0.64)})

            # Fanfold insulation (under siding, standard on re-side jobs)
            items.append({"category": "SIDING", "description": "Fanfold insulation board", "qty": wall_area, "unit": "SF", "unit_price": PRICING.get("fanfold_insulation", 1.23)})

            # Siding labor minimum
            items.append({"category": "SIDING", "description": "Siding labor minimum", "qty": 1, "unit": "EA", "unit_price": PRICING.get("siding_labor_min", 519.46)})

            # Scaffolding
            items.append({"category": "SIDING", "description": "Scaffolding - per week", "qty": 1, "unit": "WK", "unit_price": PRICING.get("scaffolding_week", 1405.00)})

            # Siding debris dumpster (separate from roofing dumpster)
            siding_dumpster_loads = max(1, round(wall_area / 2000))
            items.append({"category": "DEBRIS", "description": "Dumpster load - siding debris", "qty": siding_dumpster_loads, "unit": "EA", "unit_price": PRICING.get("dumpster", 850.00)})
        else:
            print(f"[LINE ITEMS] Siding trade detected but no wall measurements — skipping siding line items")

    # ===================== WINDOW WRAPS =====================
    # Included when siding is in scope — windows need re-wrapping after siding replacement
    if _est_req.get("siding"):
        walls = measurements.get("walls", {})
        window_count = walls.get("window_count", 0)
        _ww_wall_area = walls.get("total_wall_area_sf", 0)

        # Fallback: estimate wall area from roof footprint (same as siding section)
        if _ww_wall_area == 0 and area_sf > 0:
            import math
            _ww_footprint = area_sf / max(1, stories)
            _ww_wall_area = round(math.sqrt(_ww_footprint) * 4 * max(1, stories) * 9)

        # If no explicit window count, estimate from wall area (1 window per 150 SF)
        if window_count == 0 and _ww_wall_area > 0:
            window_count = max(1, round(_ww_wall_area / 150))
            print(f"[LINE ITEMS] Estimated {window_count} windows from {_ww_wall_area} SF wall area")

        if window_count > 0:
            items.append({"category": "SIDING", "description": "R&R Wrap wood window frame & trim with aluminum sheet", "qty": window_count, "unit": "EA", "unit_price": PRICING.get("window_wrap_standard", 398.11)})

    # ===================== DOOR WRAPS =====================
    if _est_req.get("siding"):
        walls = measurements.get("walls", {})
        door_count = walls.get("door_count", 0)
        garage_door_count = walls.get("garage_door_count", 0)

        # Estimate doors if no wall data (assume 2 entry + 1 garage for residential)
        if door_count == 0 and not walls.get("total_wall_area_sf"):
            door_count = 2
            garage_door_count = 1
            print(f"[LINE ITEMS] Estimated doors: {door_count} entry + {garage_door_count} garage")

        if door_count > 0:
            # Standard door perimeter ~17 LF
            door_lf = door_count * 17
            items.append({"category": "SIDING", "description": "R&R Door frame wrap - aluminum coil stock", "qty": door_lf, "unit": "LF", "unit_price": PRICING.get("door_wrap_aluminum_lf", 27.51)})

        if garage_door_count > 0:
            # Garage door perimeter ~34 LF (wider opening)
            garage_lf = garage_door_count * 34
            items.append({"category": "SIDING", "description": "R&R Garage door wrap - aluminum coil stock", "qty": garage_lf, "unit": "LF", "unit_price": PRICING.get("garage_door_wrap_lf", 24.55)})

    return _sort_line_items(items)


# Tom's prescribed Xactimate sort order: Remove → Install → Underlayments → Flashings →
# Ridge cap/vent → Vents → Steep/High → Labor/dumpster → Gutters → Siding → Interior
# Line Item 1 is ALWAYS remove/tear-off. Line Item 2 is ALWAYS install roofing.
# All keywords are lowercase — matched against desc.lower()
_LINE_ITEM_SORT_KEYS = [
    ("remove", 1),
    ("comp shingle roofing", 2), ("slate roofing", 2), ("tile roofing", 2),
    ("metal roofing", 2), ("bitumen roofing", 2), ("r&r natural slate", 2),
    ("underlayment", 3), ("felt", 3),
    ("ice & water", 4),
    ("drip edge", 5),
    ("starter strip", 6),
    ("ridge cap", 7),
    ("ridge vent", 8),
    ("valley flashing", 9),
    ("step flashing", 10),
    ("counter", 11), ("apron flashing", 11),
    ("chimney flashing", 12),
    ("skylight flashing", 13),
    ("pipe boot", 14),
    ("exhaust vent", 15),
    ("steep", 16),
    ("high roof", 17),
    ("roofer", 18),
    ("equipment operator", 19),
    ("gable cornice", 20),
    ("copper nails", 21), ("flat seam copper", 21),
    ("copper half round", 22),
    ("dumpster", 23),
    ("seamless aluminum gutter", 24), ("gutter", 24),
    ("siding", 25), ("aluminum siding", 25), ("vinyl siding", 25),
    ("cedar", 25), ("fiber cement", 25), ("metal siding", 25),
    ("house wrap", 26), ("tyvek", 26),
    ("fanfold", 27),
    ("window wrap", 28), ("wrap wood window", 28),
    ("door frame wrap", 29), ("door wrap", 29),
    ("garage door wrap", 30),
    ("siding labor", 31),
    ("scaffold", 32),
]


def _sort_line_items(items: list) -> list:
    """Sort line items per Tom's prescribed Xactimate build order."""
    def sort_key(item):
        desc_lower = item.get("description", "").lower()
        for keyword, order in _LINE_ITEM_SORT_KEYS:
            if keyword in desc_lower:
                # "remove" at order 1 = primary roofing tear-off ONLY
                # Skip: siding/gutter remove, steep/high remove charges
                if keyword == "remove" and order == 1:
                    if any(s in desc_lower for s in ["siding", "gutter", "window", "door", "steep", "high roof"]):
                        continue
                return order
        return 50
    return sorted(items, key=sort_key)


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


def _merge_measurement_extractions(extractions: list[dict]) -> dict:
    """Smart-merge multiple EagleView extractions.

    Detects complementary files (one has walls data, other has roof data)
    and merges into a single result. Falls back to existing multi-structure
    behavior when no complementary pattern is detected.
    """
    if len(extractions) <= 1:
        return extractions[0] if extractions else {}

    # Partition: which files have walls data vs. roof-only?
    walls_indices = [i for i, e in enumerate(extractions)
                     if e.get("walls", {}).get("total_wall_area_sf", 0) > 0]
    roof_indices = [i for i in range(len(extractions)) if i not in walls_indices]

    if walls_indices and roof_indices:
        # Complementary pair: merge roof data + walls data into single result
        roof_ext = max(
            (extractions[i] for i in roof_indices),
            key=lambda e: (e.get("structures", [{}])[0]).get("roof_area_sf", 0)
        )
        wall_ext = extractions[walls_indices[0]]

        merged = dict(roof_ext)          # Top-level measurements/penetrations from roof
        merged["walls"] = wall_ext["walls"]
        merged["stories"] = max((e.get("stories", 0) for e in extractions), default=1) or 1
        print(f"[MERGE] Complementary EagleViews — roof + walls merged into 1 structure")
        return merged

    # No complementary pattern — existing multi-structure behavior
    all_structures = []
    merged = {}
    for result in extractions:
        if not merged:
            merged = dict(result)
        for s in result.get("structures", []):
            s = dict(s)  # Clone to avoid mutating caller's data
            if not s.get("name") or s["name"] == "Main Roof":
                s["name"] = f"Structure {len(all_structures) + 1}"
            if not s.get("measurements") and result.get("measurements"):
                s["measurements"] = result["measurements"]
            if not s.get("penetrations") and result.get("penetrations"):
                s["penetrations"] = result["penetrations"]
            all_structures.append(s)

    merged["structures"] = all_structures
    merged["total_roof_area_sf"] = sum(s.get("roof_area_sf", 0) for s in all_structures)
    merged["total_roof_area_sq"] = sum(s.get("roof_area_sq", 0) for s in all_structures)
    print(f"[MERGE] {len(all_structures)} structures from {len(extractions)} files")
    return merged


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
    result = sb.table("claims").select("*").eq("id", claim_id).limit(1).execute()
    claim = result.data[0] if result.data else None
    if not claim:
        raise ValueError(f"Claim {claim_id} not found")

    # Check report mode — forensic_only skips measurements, line items, estimate
    # BUT: if measurements were uploaded to a forensic_only claim, auto-upgrade to full
    report_mode = claim.get("report_mode", "full")
    if report_mode == "forensic_only" and claim.get("measurement_files"):
        report_mode = "full"
        try:
            sb.table("claims").update({"report_mode": "full"}).eq("id", claim_id).execute()
            print(f"[PROCESS] Auto-upgraded forensic_only → full (measurements uploaded)", flush=True)
        except Exception:
            pass
    if report_mode == "forensic_only":
        print(f"[PROCESS] FORENSIC ONLY mode — skipping measurements, line items, scope comparison", flush=True)

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
    _uid = claim.get("user_id", "")
    _sb_url = os.environ.get("SUPABASE_URL", "")
    _sb_key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    print(f"[PROFILE] user_id={_uid}, sb_url={_sb_url[:30] if _sb_url else 'MISSING'}..., key_len={len(_sb_key)}, key_prefix={_sb_key[:10] if _sb_key else 'MISSING'}...", flush=True)
    # Try SDK first, then REST fallback (SDK can fail if PostgREST schema cache is stale)
    try:
        profile_result = sb.table("company_profiles").select("*").eq("user_id", _uid).limit(1).execute()
        if profile_result.data and len(profile_result.data) > 0:
            company_profile = profile_result.data[0]
            print(f"[PROCESS] SDK: company branding = {company_profile.get('company_name', 'N/A')}", flush=True)
        else:
            print(f"[PROCESS] SDK: no company profile found", flush=True)
    except Exception as e:
        print(f"[PROCESS] SDK query failed: {e}", flush=True)
    # REST API fallback if SDK returned nothing
    if not company_profile and _uid:
        try:
            import urllib.request
            _sb_url = os.environ.get("SUPABASE_URL", "")
            _sb_key = os.environ.get("SUPABASE_SERVICE_KEY", "")
            _req = urllib.request.Request(
                f"{_sb_url}/rest/v1/company_profiles?user_id=eq.{_uid}&select=*&limit=1",
                headers={"apikey": _sb_key, "Authorization": f"Bearer {_sb_key}"}
            )
            with urllib.request.urlopen(_req, timeout=10) as _resp:
                _data = json.loads(_resp.read())
                if _data and len(_data) > 0:
                    company_profile = _data[0]
                    print(f"[PROCESS] REST fallback: company branding = {company_profile.get('company_name', 'N/A')}", flush=True)
                else:
                    print(f"[PROCESS] REST fallback: no profile found", flush=True)
        except Exception as e2:
            print(f"[PROCESS] REST fallback failed: {e2}", flush=True)
    # Company-level profile resolution: users always inherit from company admin
    # Admin profile is the source of truth for API keys, logo, branding, W9
    if company_profile and not company_profile.get("is_admin"):
        _company_id = company_profile.get("company_id")
        _resolved = False
        # Try company_id first
        if _company_id:
            try:
                admin_result = sb.table("company_profiles").select("*").eq("company_id", _company_id).eq("is_admin", True).limit(1).execute()
                if admin_result.data:
                    company_profile = {**admin_result.data[0], "user_id": _uid}
                    _resolved = True
                    print(f"[PROCESS] Using company admin profile (company_id={_company_id})", flush=True)
            except Exception as e:
                print(f"[PROCESS] Company admin lookup failed: {e}", flush=True)
        # Fall back to domain matching
        if not _resolved:
            try:
                admin_profiles = sb.table("company_profiles").select("*").eq("is_admin", True).execute()
                user_result = sb.auth.admin.get_user_by_id(_uid)
                user_email = getattr(user_result, 'user', {}).email if hasattr(user_result, 'user') else ""
                if user_email and admin_profiles.data:
                    domain = user_email.split("@")[-1]
                    for ap in admin_profiles.data:
                        if ap.get("email", "").endswith(f"@{domain}"):
                            company_profile = {**ap, "user_id": _uid}
                            print(f"[PROCESS] Using domain-matched admin profile ({domain})", flush=True)
                            break
            except Exception as e:
                print(f"[PROCESS] Domain admin lookup failed: {e}", flush=True)

    _usarm_defaults = {
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
    if not company_profile:
        company_profile = dict(_usarm_defaults)
        print("[PROCESS] No company profile — using USARM defaults")
    else:
        # Fill in any empty fields with USARM defaults (users may leave fields blank)
        for key, default_val in _usarm_defaults.items():
            if not company_profile.get(key):
                company_profile[key] = default_val

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

        # 2c. Re-check auto-upgrade after reconcile (reconcile may have populated measurement_files)
        if report_mode == "forensic_only" and claim.get("measurement_files"):
            report_mode = "full"
            try:
                sb.table("claims").update({"report_mode": "full"}).eq("id", claim_id).execute()
                print(f"[PROCESS] Auto-upgraded forensic_only → full (measurements found after reconcile)", flush=True)
            except Exception:
                pass

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

        # Upload extracted photos back to storage so Photo Review can serve them individually
        # Only needed when containers (ZIP/PDF) produced new files not already in storage
        original_fnames = set(claim.get("photo_files", []))
        extracted_fnames = [os.path.basename(p) for p in photo_paths]
        new_photos = [p for p in photo_paths if os.path.basename(p) not in original_fnames]
        if new_photos:
            print(f"[PHOTOS] Uploading {len(new_photos)} extracted photos back to storage")
            for p in new_photos:
                fname = os.path.basename(p)
                mime = get_media_type(fname)
                try:
                    with open(p, "rb") as f:
                        sb.storage.from_("claim-documents").upload(
                            f"{file_path}/photos/{fname}", f.read(),
                            file_options={"content-type": mime, "upsert": "true"}
                        )
                except Exception as e:
                    print(f"[PHOTOS] Upload failed for {fname} (non-fatal): {e}")
            # Update photo_files on claim to include individual filenames
            try:
                sb.table("claims").update({"photo_files": extracted_fnames}).eq("id", claim_id).execute()
                print(f"[PHOTOS] Updated photo_files: {len(original_fnames)} → {len(extracted_fnames)}")
            except Exception as e:
                print(f"[PHOTOS] photo_files update failed (non-fatal): {e}")

        # Filter out excluded photos (rejected via Photo Review UI)
        excluded_keys = claim.get("excluded_photos") or []
        if excluded_keys:
            before_count = len(photo_paths)
            photo_paths = [p for p in photo_paths if os.path.basename(p) not in excluded_keys]
            excluded_count = before_count - len(photo_paths)
            if excluded_count > 0:
                print(f"[PROCESS] Excluded {excluded_count} photos via photo review (keys: {excluded_keys})")

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
            # Forensic-only mode: skip measurements entirely
            if report_mode == "forensic_only":
                return {}
            # Check for measurement override (e.g., pre-pitch EagleView reports with manually calculated areas)
            meas_override = claim.get("measurement_override")
            if meas_override:
                print(f"[PROCESS] Using measurement_override from claim record (skipping PDF extraction)")
                return meas_override
            if not measurement_paths:
                return {}
            if len(measurement_paths) == 1:
                resolved = resolve_eml_to_document(measurement_paths[0], source_dir)
                print("[PROCESS] Extracting measurements...")
                return await asyncio.to_thread(extract_measurements, claude, resolved)

            # Multiple measurement files — extract in parallel, then smart-merge
            resolved_paths = [resolve_eml_to_document(mpath, source_dir) for mpath in measurement_paths]
            print(f"[PROCESS] Extracting measurements from {len(resolved_paths)} files in parallel...")
            extractions = list(await asyncio.gather(*[
                asyncio.to_thread(extract_measurements, claude, p) for p in resolved_paths
            ]))

            return _merge_measurement_extractions(extractions)

        async def _get_photo_analysis():
            if not photo_paths:
                return _default_photo

            # ── Cache check: skip re-analysis if photos haven't changed and no new corrections ──
            import hashlib as _hl
            photo_file_names = sorted(os.path.basename(p) for p in photo_paths)
            photo_hash = _hl.md5(json.dumps(photo_file_names).encode()).hexdigest()
            cached = claim.get("cached_photo_analysis")
            cached_hash = claim.get("cached_photo_hash")

            has_new_corrections = False
            if sb and is_revision:
                try:
                    last_proc = claim.get("last_processed_at", "")
                    if last_proc:
                        _fb_check = sb.table("annotation_feedback") \
                            .select("id") \
                            .eq("claim_id", claim_id) \
                            .gt("created_at", last_proc) \
                            .limit(1) \
                            .execute()
                        has_new_corrections = bool(_fb_check.data)
                except Exception:
                    has_new_corrections = True  # If check fails, re-analyze to be safe

            if cached and cached_hash == photo_hash and not has_new_corrections and is_revision:
                print(f"[PROCESS] Reusing cached photo analysis ({len(photo_file_names)} photos unchanged, no new corrections)")
                return cached

            # ── Fresh analysis needed ──
            # Load photo correction examples for few-shot learning (runs in parallel with other extractions)
            few_shot_corrections = []
            if sb:
                try:
                    # Prioritize THIS claim's corrections, then fill with global
                    fb = sb.table("annotation_feedback") \
                        .select("original_annotation, corrected_annotation, original_tags, corrected_tags") \
                        .eq("claim_id", claim_id) \
                        .eq("status", "corrected") \
                        .order("created_at", desc=True) \
                        .limit(5) \
                        .execute()
                    few_shot_corrections = fb.data or []
                    if len(few_shot_corrections) < 5:
                        global_fb = sb.table("annotation_feedback") \
                            .select("original_annotation, corrected_annotation, original_tags, corrected_tags") \
                            .neq("claim_id", claim_id) \
                            .eq("status", "corrected") \
                            .order("created_at", desc=True) \
                            .limit(5 - len(few_shot_corrections)) \
                            .execute()
                        few_shot_corrections.extend(global_fb.data or [])
                    if few_shot_corrections:
                        print(f"[INTEL] Loaded {len(few_shot_corrections)} photo corrections for few-shot learning (claim-specific + global)")
                except Exception as e:
                    print(f"[INTEL] Photo corrections query failed (non-fatal): {e}")
            print(f"[PROCESS] Analyzing {len(photo_paths)} photos (fresh)...")
            result = await asyncio.to_thread(
                analyze_photos, claude, photo_paths,
                user_notes=claim.get("user_notes"),
                corrections=few_shot_corrections,
                estimate_request=claim.get("estimate_request"),
            )

            # ── Cache the result for future reprocesses ──
            if sb and result:
                try:
                    sb.table("claims").update({
                        "cached_photo_analysis": result,
                        "cached_photo_hash": photo_hash,
                    }).eq("id", claim_id).execute()
                    print(f"[PROCESS] Cached photo analysis for future reprocesses (hash={photo_hash[:8]})")
                except Exception as e:
                    print(f"[PROCESS] Photo cache save failed (non-fatal): {e}")

            return result

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
            # Send ALL scope files to extraction — line items may be split across PDFs
            resolved_paths = [resolve_eml_to_document(sp, source_dir) for sp in scope_paths]
            print(f"[PROCESS] Extracting carrier scope ({len(resolved_paths)} file(s))...", flush=True)
            primary = resolved_paths[0]
            extras = resolved_paths[1:] if len(resolved_paths) > 1 else None
            return await asyncio.to_thread(extract_carrier_scope, claude, primary, extras)

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

        # 8d. Fallback: if measurement extraction failed, reconstruct from carrier scope
        meas_check = measurements.get("structures", [{}])
        meas_area_check = (meas_check[0] if meas_check else {}).get("roof_area_sf", measurements.get("total_roof_area_sf", 0))
        if not meas_area_check and carrier_data and carrier_data.get("carrier_line_items"):
            print("[FALLBACK] EagleView extraction failed — reconstructing from carrier line items...")
            fallback_meas = _reconstruct_measurements_from_carrier(carrier_data["carrier_line_items"])
            fallback_area = (fallback_meas.get("structures", [{}])[0] or {}).get("roof_area_sf", 0)
            if fallback_area:
                # Preserve property info from original measurements if present
                if measurements.get("property"):
                    fallback_meas["property"] = measurements["property"]
                measurements = fallback_meas
                print(f"[FALLBACK] Success: {fallback_area} SF from carrier scope")
            else:
                print("[FALLBACK] Carrier line items did not contain usable roof area")
            if measurements.get("_property_owner_report"):
                print("[WARN] Property Owner Report detected — request full EagleView with measurements")

        # 9. Build claim config
        _cd_cli = len(carrier_data.get("carrier_line_items", [])) if carrier_data else 0
        print(f"[PROCESS] Building claim config... carrier_data has {_cd_cli} line items", flush=True)
        config = build_claim_config(
            claim, measurements, photo_analysis, carrier_data, photo_filenames, weather_data, company_profile,
            user_notes=claim.get("user_notes"),
            photo_integrity=photo_integrity,
        )

        # Forensic-only: fix missing data and clear non-forensic sections
        if report_mode == "forensic_only":
            # Parse city/state/zip from address if measurements didn't provide them
            prop = config.get("property", {})
            if not prop.get("city") or not prop.get("zip"):
                address = claim.get("address", "")
                # Parse "123 Main St, Binghamton, NY 13905, USA" format
                parts = [p.strip() for p in address.split(",")]
                if len(parts) >= 3:
                    city = parts[-3] if len(parts) >= 4 else parts[-2]
                    state_zip = parts[-2] if len(parts) >= 4 else parts[-1]
                    state_zip_parts = state_zip.strip().split()
                    state = state_zip_parts[0] if state_zip_parts else ""
                    zip_code = state_zip_parts[1] if len(state_zip_parts) > 1 else ""
                    if not prop.get("city"):
                        prop["city"] = city
                    if not prop.get("state"):
                        prop["state"] = state
                    if not prop.get("zip"):
                        prop["zip"] = zip_code
                    config["property"] = prop
                    print(f"[PROCESS] forensic_only: parsed city={city}, state={state}, zip={zip_code} from address", flush=True)

            # Add placeholder line item to pass validator (forensic PDF doesn't display line items)
            if not config.get("line_items"):
                config["line_items"] = [{"description": "See forensic report", "qty": 0, "unit": "EA", "unit_price": 0, "category": "GENERAL"}]

            config["carrier"] = config.get("carrier", {})
            if "carrier_line_items" in config.get("carrier", {}):
                config["carrier"]["carrier_line_items"] = []
            # Zero out contractor_rcv for forensic-only (no real estimate)
            if sb:
                try:
                    sb.table("claims").update({"contractor_rcv": 0}).eq("id", claim_id).execute()
                except Exception:
                    pass
            print("[PROCESS] forensic_only: cleared carrier data, zeroed RCV, ensured city/zip/line_items", flush=True)

        # 9a. Geocode fallback: if ZIP is still missing, resolve via Census Bureau geocoder
        prop = config.get("property", {})
        if not prop.get("zip"):
            try:
                from noaa_weather.geocode import geocode_address
                geo = geocode_address(claim.get("address", ""))
                if geo and geo.matched_address:
                    # Census returns "8 ABERYSTWYTH PL, BINGHAMTON, NY, 13905"
                    geo_parts = [p.strip() for p in geo.matched_address.split(",")]
                    for gp in geo_parts:
                        gp_clean = gp.strip()
                        if gp_clean.isdigit() and len(gp_clean) == 5:
                            prop["zip"] = gp_clean
                            break
                        gp_tokens = gp_clean.split()
                        for token in gp_tokens:
                            if token.isdigit() and len(token) == 5:
                                prop["zip"] = token
                                break
                        if prop.get("zip"):
                            break
                    if not prop.get("city") and len(geo_parts) >= 3:
                        prop["city"] = geo_parts[-3].strip()
                    if not prop.get("state"):
                        for gp in geo_parts:
                            gp_clean = gp.strip()
                            if len(gp_clean) == 2 and gp_clean.isalpha():
                                prop["state"] = gp_clean.upper()
                                break
                    config["property"] = prop
                    print(f"[PROCESS] geocode fallback: zip={prop.get('zip')}, city={prop.get('city')}, state={prop.get('state')} from '{geo.matched_address}'", flush=True)
            except Exception as geo_err:
                print(f"[PROCESS] geocode fallback failed (non-fatal): {geo_err}", flush=True)

        # 9b. Attach evidence photos to carrier line items for PDF scope comparison
        if report_mode != "forensic_only":
            attach_evidence_photos(config, sb, claim_id)

        # 9b. excluded_line_items is a FRONTEND display concern only.
        # The processor always generates ALL items. The dashboard hides excluded items.
        # Previously this filtered config by description match, which broke multi-structure
        # claims (excluding one "Metal roofing" removed ALL structures' installs).
        # Clear stale excluded_line_items on reprocess (old UUIDs won't match new items).
        if sb:
            try:
                sb.table("claims").update({"excluded_line_items": []}).eq("id", claim_id).execute()
                print("[SCOPE REVIEW] Cleared stale excluded_line_items (fresh items on reprocess)")
            except Exception:
                pass

        # 9c. Inject user-added line items (survive reprocess)
        if sb:
            try:
                user_added = sb.table("line_items").select("category,description,qty,unit,unit_price").eq("claim_id", claim_id).eq("source", "user_added").execute()
                injected = 0
                for ua in (user_added.data or []):
                    try:
                        config.setdefault("line_items", []).append({
                            "category": ua.get("category") or "GENERAL",
                            "description": ua.get("description") or "",
                            "qty": float(ua.get("qty") or 0),
                            "unit": ua.get("unit") or "EA",
                            "unit_price": float(ua.get("unit_price") or 0),
                            "source": "user_added",
                        })
                        injected += 1
                    except (TypeError, ValueError) as e:
                        print(f"[SCOPE REVIEW] Skipping user-added item (invalid data): {ua.get('description')}: {e}")
                if injected:
                    print(f"[SCOPE REVIEW] Injected {injected} user-added line items")
            except Exception as e:
                print(f"[SCOPE REVIEW] user_added injection failed (non-fatal): {e}")

        # Apply line_item_feedback corrections (learning loop — user corrections survive reprocess)
        if sb:
            try:
                feedback = sb.table("line_item_feedback") \
                    .select("original_description,corrected_qty,corrected_unit_price,status") \
                    .eq("claim_id", claim_id) \
                    .eq("status", "corrected") \
                    .execute()
                corrections_applied = 0
                for fb in (feedback.data or []):
                    orig_desc = fb.get("original_description", "")
                    for li in config.get("line_items", []):
                        if li.get("description") == orig_desc:
                            if fb.get("corrected_qty") is not None:
                                li["qty"] = float(fb["corrected_qty"])
                            if fb.get("corrected_unit_price") is not None:
                                li["unit_price"] = float(fb["corrected_unit_price"])
                            corrections_applied += 1
                            break
                if corrections_applied:
                    print(f"[FEEDBACK LOOP] Applied {corrections_applied} line item corrections from user feedback")
            except Exception as e:
                print(f"[FEEDBACK LOOP] line_item_feedback query failed (non-fatal): {e}")

        # Flag measurement extraction failures for downstream warning
        meas_structs = measurements.get("structures", [{}])
        meas_struct = meas_structs[0] if meas_structs else {}
        meas_area = meas_struct.get("roof_area_sf", measurements.get("total_roof_area_sf", 0))
        if not meas_area:
            config.setdefault("warnings", []).append("MEASUREMENT_EXTRACTION_FAILED")
            print("[WARN] Flagged config with MEASUREMENT_EXTRACTION_FAILED warning")
        elif measurements.get("_carrier_fallback"):
            config.setdefault("warnings", []).append("MEASUREMENTS_FROM_CARRIER_FALLBACK")
            print("[WARN] Measurements reconstructed from carrier scope — reprocess with real EagleView")
        if measurements.get("_property_owner_report"):
            config.setdefault("warnings", []).append("PROPERTY_OWNER_REPORT_NO_MEASUREMENTS")
            print("[WARN] Property Owner Report detected — no measurement tables available")

        # Build roof sections for slope editor UI
        try:
            meas_provider = "eagleview"  # default; could detect from filename
            for mp in measurement_paths:
                mp_lower = mp.lower()
                if "hover" in mp_lower:
                    meas_provider = "hover"
                elif "gaf" in mp_lower or "quickmeasure" in mp_lower:
                    meas_provider = "gaf_quickmeasure"
            roof_sections = build_roof_sections(measurements, photo_analysis, provider=meas_provider)
            if roof_sections and sb:
                # Check for existing user overrides and preserve them
                try:
                    existing = sb.table("claims").select("roof_sections").eq("id", claim_id).limit(1).execute()
                    existing_sections = (existing.data[0] if existing.data else {}).get("roof_sections")
                    if existing_sections and existing_sections.get("sections"):
                        # Preserve user_material_override from previous run
                        old_by_key = {}
                        for s in existing_sections["sections"]:
                            key = f"{s.get('structure_index')}_{s.get('pitch')}"
                            if s.get("user_material_override"):
                                old_by_key[key] = s["user_material_override"]
                        if old_by_key:
                            for s in roof_sections["sections"]:
                                key = f"{s['structure_index']}_{s['pitch']}"
                                if key in old_by_key:
                                    s["user_material_override"] = old_by_key[key]
                except Exception:
                    pass  # First run or column doesn't exist yet
                sb.table("claims").update({"roof_sections": roof_sections}).eq("id", claim_id).execute()
                print(f"[PROCESS] Built {len(roof_sections['sections'])} roof sections for slope editor")
        except Exception as e:
            print(f"[PROCESS] Roof sections build failed (non-fatal): {e}")

        # Add corroborating weather reports to config (sanitized)
        if corroborating_reports:
            sanitized_reports = []
            for rpt in corroborating_reports:
                if isinstance(rpt, dict):
                    text = rpt.get("text", "") or rpt.get("summary", "")
                    # Reject junk data: HTML, KeePass, Google search URLs
                    if any(junk in text.lower() for junk in ["<html", "keepass", "google.com/search", "<script", "<!doctype"]):
                        continue
                    sanitized_reports.append(rpt)
            if sanitized_reports:
                config["weather"]["corroborating_reports"] = sanitized_reports

        # 9a. NOAA Weather + Damage Thresholds (auto-populate if address + storm date available)
        try:
            from noaa_weather.api import NOAAClient
            from noaa_weather.geocode import geocode_address, build_address_from_config
            from noaa_weather.analyzer import ThresholdAnalyzer
            from noaa_weather.report import apply_to_config as noaa_apply_to_config

            address_str = build_address_from_config(config)
            # ALWAYS prefer date_of_loss over extracted storm_date — weather files
            # can contain wrong dates (e.g., HailTrace for different property)
            storm_date = config.get("dates", {}).get("date_of_loss", "") or \
                         config.get("weather", {}).get("storm_date", "")
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

                        # Persist weather data to claims table for map overlay
                        if sb:
                            try:
                                weather_json = {
                                    "events": [
                                        {
                                            "event_type": e.event_type,
                                            "date": str(e.begin_date) if hasattr(e, 'begin_date') else str(getattr(e, 'date', '')),
                                            "hail_size": getattr(e, 'hail_size_inches', None) or getattr(e, 'magnitude', None),
                                            "wind_speed": getattr(e, 'wind_speed_mph', None),
                                            "latitude": getattr(e, 'latitude', None) or getattr(e, 'begin_lat', None),
                                            "longitude": getattr(e, 'longitude', None) or getattr(e, 'begin_lon', None),
                                            "location": getattr(e, 'location', '') or getattr(e, 'begin_location', ''),
                                            "distance_miles": getattr(e, 'distance_miles', None),
                                            "source": getattr(e, 'source', ''),
                                        }
                                        for e in (storm_data.events if hasattr(storm_data, 'events') else [])
                                        if getattr(e, 'latitude', None) or getattr(e, 'begin_lat', None)
                                    ],
                                    "max_hail_inches": storm_data.max_hail_inches,
                                    "max_wind_mph": storm_data.max_wind_mph,
                                    "event_count": storm_data.event_count,
                                }
                                sb.table("claims").update({"weather_data": weather_json}).eq("id", claim_id).execute()
                                print(f"[NOAA] Persisted {len(weather_json['events'])} events to claims.weather_data")
                            except Exception as we:
                                print(f"[NOAA] Failed to persist weather data: {we}")
                    else:
                        print(f"[NOAA] No storm events found for {address_str} on {storm_date}")
                else:
                    print(f"[NOAA] Could not geocode address: {address_str}")
        except Exception as e:
            print(f"[NOAA] Weather query failed (non-fatal): {e}")

        # 9a2. Inject carrier intelligence from data warehouse (parallelized)
        carrier_name = config.get("carrier", {}).get("name", "")
        trades = config.get("scope", {}).get("trades", [])
        state = config.get("property", {}).get("state", "")
        intel_context = {}

        carrier_intel = {}
        settlement_pred = {}
        deviations = []

        # Run all three intelligence queries in parallel (zero dependencies between them)
        intel_tasks = []
        if carrier_name and sb:
            carrier_rcv_val = config.get("carrier", {}).get("carrier_rcv", 0)
            intel_tasks.append(("suggest", asyncio.to_thread(suggest_arguments, sb, carrier_name, trades, state)))
            intel_tasks.append(("predict", asyncio.to_thread(predict_settlement, sb, carrier_name, trades, state, carrier_rcv=carrier_rcv_val)))
        if carrier_data and sb:
            carrier_items = carrier_data.get("carrier_line_items", [])
            price_list_name = STATE_PRICE_LIST.get(state.upper(), "NYBI26") if state else "NYBI26"
            intel_tasks.append(("deviations", asyncio.to_thread(detect_price_deviations, sb, carrier_items, price_list_name)))

        if intel_tasks:
            try:
                results = await asyncio.gather(*[t[1] for t in intel_tasks], return_exceptions=True)
                task_names = [t[0] for t in intel_tasks]
                for name, result in zip(task_names, results):
                    if isinstance(result, Exception):
                        print(f"[INTEL] {name} failed (non-fatal): {result}")
                        continue
                    if name == "suggest":
                        carrier_intel = result
                    elif name == "predict":
                        settlement_pred = result
                    elif name == "deviations":
                        deviations = result
            except Exception as e:
                print(f"[INTEL] Carrier intelligence gather failed (non-fatal): {e}")

        if carrier_intel:
            intel_context = {
                "carrier_intelligence": carrier_intel,
                "settlement_prediction": settlement_pred,
            }
            config["carrier_intelligence"] = carrier_intel
            config["settlement_prediction"] = settlement_pred
            score = carrier_intel.get("carrier_score", {})
            print(f"[INTEL] {carrier_name}: {score.get('win_rate_pct', 0)}% win rate, "
                  f"{score.get('total_claims', 0)} claims, "
                  f"{len(carrier_intel.get('general_effective_arguments', []))} effective args")

        if deviations and not (len(deviations) == 1 and deviations[0].get("error")):
            config["price_deviations"] = deviations
            print(f"[INTEL] Found {len(deviations)} carrier pricing deviations")

        # 9b. Synthesize structured executive summary + conclusion (replaces run-on paragraphs)
        material = config.get("structures", [{}])[0].get("shingle_type", "roofing material")
        try:
            print(f"[PROCESS] Synthesizing executive summary...")
            exec_address = claim.get("address", "") or config.get("property", {}).get("address", "")
            exec_dol = config.get("dates", {}).get("date_of_loss", "") or (weather_data or {}).get("storm_date", "")
            exec_paragraphs = synthesize_executive_summary(
                claude,
                photo_analysis.get("damage_summary", ""),
                weather_data or {},
                carrier_data,
                material,
                photo_analysis.get("key_findings", []),
                photo_analysis.get("photo_count", 0),
                intel_context=intel_context,
                property_address=exec_address,
                date_of_loss=exec_dol,
            )
            if isinstance(exec_paragraphs, list):
                exec_paragraphs = _enforce_property_address(exec_paragraphs, exec_address)
            config["forensic_findings"]["executive_summary"] = exec_paragraphs
        except Exception as e:
            print(f"[PROCESS] Executive summary synthesis failed (non-fatal): {e}")

        try:
            print(f"[PROCESS] Synthesizing conclusion...")
            conclusion_address = claim.get("address", "") or config.get("property", {}).get("address", "")
            raw_storm = config.get("dates", {}).get("date_of_loss", "") or config.get("weather", {}).get("storm_date", "")
            conclusion_storm = _format_date_human(raw_storm) if raw_storm else "the reported storm event"
            conclusion_count = len(photo_analysis.get("key_findings", []))
            conclusion_paragraphs = synthesize_conclusion(
                claude,
                photo_analysis.get("damage_summary", ""),
                photo_analysis.get("key_findings", []),
                photo_analysis.get("code_violations", []),
                material,
                carrier_data,
                intel_context=intel_context,
                property_address=conclusion_address,
                storm_event=conclusion_storm,
                finding_count=conclusion_count,
            )
            if conclusion_paragraphs and isinstance(conclusion_paragraphs, list):
                address = conclusion_address or "the property"
                conclusion_paragraphs = [p for p in conclusion_paragraphs if isinstance(p, str)]
                conclusion_paragraphs = _enforce_property_address(conclusion_paragraphs, address)
                config["forensic_findings"]["conclusion_paragraphs"] = conclusion_paragraphs
            else:
                print(f"[PROCESS] Conclusion synthesis returned {type(conclusion_paragraphs)} — skipping placeholder replacement")
        except Exception as e:
            print(f"[PROCESS] Conclusion synthesis failed (non-fatal): {e}", flush=True)

        # 9d. Cover email summary paragraphs
        try:
            address = config.get("property", {}).get("address", "the property")
            company_name = config.get("company", {}).get("name", "our company")
            carrier_name = config.get("carrier", {}).get("name", "")
            usarm_total = config.get("financials", {}).get("total", 0)
            carrier_rcv = config.get("carrier", {}).get("carrier_rcv", 0)
            phase = config.get("phase", "pre_scope")
            trades = config.get("scope", {}).get("trades", [])
            trade_str = ", ".join(trades) if trades else "roofing"

            if phase == "post_scope" and carrier_rcv > 0:
                variance = usarm_total - carrier_rcv
                config["cover_email"]["summary_paragraphs"] = [
                    f"Please find enclosed the complete forensic documentation package for the property at {address}. "
                    f"Our independent inspection has identified a scope variance of ${variance:,.2f} between "
                    f"our documented findings and the current carrier approval.",
                    f"The enclosed reports include annotated photography of all storm-related damage, "
                    f"an Xactimate-format estimate at current {config.get('financials', {}).get('price_list', 'regional')} pricing, "
                    f"and a line-by-line variance analysis documenting specific underpaid and omitted items.",
                    f"We respectfully request a timely review of these materials and issuance of revised payment "
                    f"reflecting the full scope of documented damage. Please do not hesitate to contact us "
                    f"should you require any additional information or wish to schedule a re-inspection.",
                ]
            else:
                config["cover_email"]["summary_paragraphs"] = [
                    f"Please find enclosed the complete forensic documentation package for the property at {address}. "
                    f"Our independent inspection has documented storm-related damage to the {trade_str}.",
                    f"The enclosed reports include annotated photography of all identified damage, "
                    f"an Xactimate-format replacement cost estimate, and a forensic causation analysis "
                    f"establishing the relationship between documented weather events and observed damage.",
                    f"Please do not hesitate to contact us should you require any additional information "
                    f"or wish to schedule a joint inspection.",
                ]
        except Exception as e:
            print(f"[PROCESS] Cover email summary generation failed (non-fatal): {e}", flush=True)

        # 9e. Differentiation table — generate if not already present
        if not config.get("forensic_findings", {}).get("differentiation_table"):
            diff_table = []
            damage_summary = (photo_analysis.get("damage_summary", "") or "").lower()
            has_noaa = bool(config.get("weather", {}).get("noaa_events"))
            max_hail = config.get("weather", {}).get("max_hail_inches", 0)

            if "hail" in damage_summary or max_hail:
                diff_table.append({
                    "cause": "Hail Impact",
                    "characteristics": "Circular/oval depressions with granule displacement, mat fracture, soft metal denting",
                    "observed": "Yes — multiple impact marks with granule loss documented in photo analysis",
                    "conclusion": "CONSISTENT",
                })
            if "wind" in damage_summary:
                diff_table.append({
                    "cause": "Wind Damage",
                    "characteristics": "Lifted, creased, or missing shingles; exposed nail heads; broken seals",
                    "observed": "Yes — wind-lifted and creased shingles documented across roof surface",
                    "conclusion": "CONSISTENT",
                })
            # Always include wear/aging as NOT CONSISTENT
            diff_table.append({
                "cause": "Normal Wear / Aging",
                "characteristics": "Uniform granule loss, curling at edges, consistent deterioration pattern",
                "observed": "No — damage pattern is random/localized, inconsistent with uniform aging",
                "conclusion": "NOT CONSISTENT",
            })
            diff_table.append({
                "cause": "Manufacturing Defect",
                "characteristics": "Systematic pattern across same production batch, uniform failure mode",
                "observed": "No — damage is random and impact-related, not systematic",
                "conclusion": "NOT CONSISTENT",
            })
            if diff_table:
                config["forensic_findings"]["differentiation_table"] = diff_table

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
        diff_result = {}
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
        elif is_revision and not previous_carrier_data and carrier_data:
            # Pre-scope → post-scope: first carrier scope on a revised claim
            # No diff possible yet, but MUST save carrier data as previous_carrier_data
            # so the NEXT revision can diff against this baseline
            print(f"[REVISION] First scope upload on revised claim — saving carrier RCV ${carrier_data.get('carrier_rcv', 0):,.2f} as baseline for future diffs")
            try:
                _contact_fields_baseline = {}
                for cf in ("adjuster_name", "adjuster_email", "adjuster_phone", "claim_number"):
                    cv = carrier_data.get(cf) or config.get("carrier", {}).get(cf)
                    if cv:
                        _contact_fields_baseline[cf] = cv
                sb.table("claims").update({
                    "previous_carrier_data": {
                        "carrier_rcv": carrier_data.get("carrier_rcv", 0),
                        "carrier_line_items": carrier_data.get("carrier_line_items", []),
                        "carrier_arguments": carrier_data.get("carrier_arguments", []),
                        **_contact_fields_baseline,
                    },
                }).eq("id", claim_id).execute()
                print(f"[REVISION] Saved previous_carrier_data baseline for future revision diffs")
            except Exception as e:
                print(f"[REVISION] Baseline carrier data save failed (non-fatal): {e}")

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

        # 9f. Recompute demand_items with actual financial totals
        # (financials.total isn't available in build_claim_config, so we compute here)
        if config.get("carrier", {}).get("carrier_rcv", 0) > 0:
            _li = config.get("line_items", [])
            _li_total = sum(float(i.get("qty", 0)) * float(i.get("unit_price", 0)) for i in _li)
            _tax = _li_total * config.get("financials", {}).get("tax_rate", 0)
            _rcv = _li_total + _tax
            _op = _li_total * 0.21 if config.get("scope", {}).get("o_and_p") else 0  # 10% overhead + 11% profit
            _total = _rcv + _op
            _variance = _total - config["carrier"]["carrier_rcv"]
            _carrier_name = config.get("carrier", {}).get("name", "the carrier")
            _actions = []
            if _variance > 0:
                _actions.append(f"Review the enclosed forensic documentation and revised scope of loss identifying ${_variance:,.2f} in underpayment")
            else:
                _actions.append("Review the enclosed forensic documentation and revised scope of loss")
            _actions.append("Issue revised payment reflecting the full scope of documented storm-related damage")
            if config.get("carrier", {}).get("carrier_line_items"):
                _actions.append("Address the line-by-line variance analysis identifying specific underpaid and omitted items")
            _actions.append("Schedule a re-inspection if additional verification is needed")
            config["appeal_letter"]["demand_items"] = _actions
            config["appeal_letter"]["requested_actions"] = _actions

        # 10. Compute Damage Score + Technical Approval Score (BEFORE PDF generation — quality gate)
        ds = None
        tas = None
        try:
            from damage_scoring import compute_damage_score, compute_approval_score
            ds = compute_damage_score(config, hail_analysis=config.get("hail_analysis"))
            tas = compute_approval_score(config, ds)
            print(f"[PROCESS] Damage Score: {ds.score}/100 ({ds.grade}) | TAS: {tas.score}% ({tas.grade})")
        except Exception as e:
            print(f"[PROCESS] Damage scoring failed (non-fatal): {e}")

        # 10a. Quality Gate — reject if BOTH scores fail (protects rep credibility)
        DS_FAIL_THRESHOLD = 35   # D- or F
        TAS_FAIL_THRESHOLD = 50  # D or F
        if ds and tas and ds.score < DS_FAIL_THRESHOLD and tas.score < TAS_FAIL_THRESHOLD:
            print(f"[QUALITY] Claim rejected — DS {ds.score} < {DS_FAIL_THRESHOLD} AND TAS {tas.score} < {TAS_FAIL_THRESHOLD}")
            guidance = _build_improvement_guidance(ds, tas)
            reject_data: dict = {
                "status": "needs_improvement",
                "damage_score": ds.score,
                "damage_grade": ds.grade,
                "approval_score": tas.score,
                "approval_grade": tas.grade,
                "improvement_guidance": guidance,
            }
            if photo_integrity and photo_integrity.get("total", 0) > 0:
                reject_data["photo_integrity"] = {
                    "total": photo_integrity["total"],
                    "flagged": photo_integrity["flagged"],
                    "score": photo_integrity["score"],
                }
            reject_data["processing_warnings"] = config.get("warnings", [])
            _financials = compute_financials(config)
            contractor_rcv = _financials.get("total", 0)
            if contractor_rcv:
                reject_data["contractor_rcv"] = round(contractor_rcv, 2)
            sb.table("claims").update(reject_data).eq("id", claim_id).execute()
            print(f"[QUALITY] Saved {len(guidance.get('tips', []))} improvement tips — claim needs better documentation")
            return

        # 10b. Generate PDFs (quality gate passed)
        print(f"[PROCESS] Generating PDFs...")
        pdfs = generate_pdfs(config, work_dir)

        # Forensic-only: keep only the forensic causation report (01_*)
        if report_mode == "forensic_only":
            pdfs = [p for p in pdfs if os.path.basename(p).startswith("01_")]
            print(f"[PROCESS] forensic_only: filtered to {len(pdfs)} PDFs (doc 01 only)")
        else:
            print(f"[PROCESS] Generated {len(pdfs)} PDFs")

        # 11. Upload PDFs to Supabase Storage
        uploaded_pdfs = []
        for pdf_path in pdfs:
            pdf_name = os.path.basename(pdf_path)
            storage_path = f"{file_path}/output/{pdf_name}"
            upload_file(sb, "claim-documents", storage_path, pdf_path)
            uploaded_pdfs.append(pdf_name)
            print(f"[PROCESS] Uploaded: {pdf_name}")

        # 11a. Carrier analyst — per-claim underpayment tactic detection.
        # Runs after config is built so we have line_items + carrier data.
        carrier_analyst_result = None
        if carrier_data and carrier_data.get("carrier_rcv", 0) > 0:
            try:
                from carrier_analyst import analyze_carrier_scope
                _state = config.get("property", {}).get("state", "")
                _li = config.get("line_items", [])
                _trades = set(li.get("trade", "").lower().strip() for li in _li if li.get("trade"))
                print("[CARRIER-ANALYST] Analyzing carrier scope for underpayment tactics...")
                carrier_analyst_result = analyze_carrier_scope(
                    carrier_data=carrier_data,
                    measurements=measurements or {},
                    carrier_name=carrier_data.get("carrier", {}).get("name", "") if isinstance(carrier_data.get("carrier"), dict) else "",
                    config={"line_items": _li, "property": {"state": _state}, "scope": {"o_and_p": len(_trades) >= 3}},
                    claude_client=claude,
                    call_claude_fn=_call_claude_with_retry,
                )
                tactic_count = len(carrier_analyst_result.get("tactics_found", []))
                print(f"[CARRIER-ANALYST] Found {tactic_count} tactics, variance ~{carrier_analyst_result.get('estimated_variance_pct', 0)}%")
            except Exception as e:
                print(f"[CARRIER-ANALYST] Analysis failed (non-fatal): {e}")

        # 11b. QA Auditor — last line of defense before customer sees PDFs.
        # Reviews the generated forensic prose against ground-truth claim data
        # and flags any hallucinated address/date/carrier/UPPA violation.
        # See ~/.claude/plans/proud-wiggling-hearth.md Phase 1.
        qa_audit_result: Optional[dict] = None
        try:
            print("[QA] Running forensic prose audit...")
            qa_audit_result = audit_forensic_prose(
                config,
                claim,
                claude,
                call_claude_fn=_call_claude_with_retry,
            )
            crit_count = len(qa_audit_result.get("critical", []) or [])
            med_count = len(qa_audit_result.get("medium", []) or [])
            if crit_count:
                print(f"[QA] BLOCKED — {crit_count} critical, {med_count} medium: {qa_audit_result.get('summary', '')}")
            else:
                print(f"[QA] PASSED — {med_count} medium warnings: {qa_audit_result.get('summary', '')}")
        except Exception as e:
            print(f"[QA] Audit failed (non-fatal, failing open): {e}")
            qa_audit_result = None

        qa_blocked = bool(qa_audit_result and qa_audit_result.get("critical"))

        # 12. Update claim status to ready (or qa_review_pending if blocked)
        from datetime import datetime, timezone
        update_data: dict = {
            "status": "qa_review_pending" if qa_blocked else "ready",
            "output_files": uploaded_pdfs,
            "improvement_guidance": None,  # Clear any previous rejection guidance
            "last_processed_at": datetime.now(timezone.utc).isoformat(),
        }
        if qa_audit_result is not None:
            update_data["qa_audit_flags"] = qa_audit_result
        if carrier_analyst_result and carrier_analyst_result.get("analyzed"):
            update_data["carrier_analyst_flags"] = carrier_analyst_result
        if photo_integrity and photo_integrity.get("total", 0) > 0:
            update_data["photo_integrity"] = {
                "total": photo_integrity["total"],
                "flagged": photo_integrity["flagged"],
                "score": photo_integrity["score"],
            }

        # Always write processing warnings (clears stale warnings from previous runs)
        update_data["processing_warnings"] = config.get("warnings", [])

        # Store contractor RCV (our scope total) for dashboard display
        # Forensic-only claims have no real estimate — force to 0
        if report_mode == "forensic_only":
            contractor_rcv = 0
            update_data["contractor_rcv"] = 0
        else:
            _financials = compute_financials(config)
            contractor_rcv = _financials.get("total", 0)
            if contractor_rcv:
                update_data["contractor_rcv"] = round(contractor_rcv, 2)

        # Store O&P + tax metadata for frontend financial display
        _o_and_p = config.get("scope", {}).get("o_and_p", False)
        _tax_rate = config.get("financials", {}).get("tax_rate", 0.08)
        _trades = set()
        for li in config.get("line_items", []):
            t = (li.get("trade") or "").lower().strip()
            if t:
                _trades.add(t)
        update_data["o_and_p_enabled"] = bool(_o_and_p)
        update_data["tax_rate"] = _tax_rate
        update_data["trade_count"] = len(_trades)

        # Store scope comparison JSONB for interactive frontend display
        _scope_comp = config.get("carrier", {}).get("carrier_line_items", [])
        if _scope_comp and isinstance(_scope_comp, list) and len(_scope_comp) > 0:
            # Only store if comparison rows have matched_by field (not raw carrier items)
            if _scope_comp[0].get("matched_by") or _scope_comp[0].get("status"):
                update_data["scope_comparison"] = _scope_comp

        # Save homeowner name + adjuster info from carrier extraction
        _insured = config.get("insured", {}).get("name", "")
        if _insured and _insured != "Property Owner":
            update_data["homeowner_name"] = _insured
        _carrier_cfg = config.get("carrier", {})
        _adjuster_name = _carrier_cfg.get("adjuster_name", "")
        _adjuster_email = _carrier_cfg.get("adjuster_email", "")
        _claim_number = _carrier_cfg.get("claim_number", "")

        # Write carrier info extracted from scope to top-level columns
        # (fills in blanks from pre-scope claims, critical for email subject lines + supplement routing)
        _carrier_name_val = _carrier_cfg.get("name", "")
        if _carrier_name_val and _carrier_name_val.lower() not in ("the carrier", "unknown"):
            update_data["carrier"] = _carrier_name_val
        if _claim_number and _claim_number.lower() not in ("pending", "unknown", "n/a"):
            update_data["claim_number"] = _claim_number
        if _adjuster_name:
            update_data["adjuster_name"] = _adjuster_name
        if _adjuster_email:
            update_data["adjuster_email"] = _adjuster_email

        # Save scores (already computed above)
        if ds and tas:
            update_data["damage_score"] = ds.score
            update_data["damage_grade"] = ds.grade
            update_data["approval_score"] = tas.score
            update_data["approval_grade"] = tas.grade

        # Geocode claim address for map display (non-fatal, cached)
        try:
            from noaa_weather.geocode import geocode_address, build_address_from_config
            geo_address = build_address_from_config(config)
            if geo_address:
                geo = geocode_address(geo_address)
                if geo and geo.latitude and geo.longitude:
                    update_data["latitude"] = geo.latitude
                    update_data["longitude"] = geo.longitude
                    print(f"[GEO] Geocoded to ({geo.latitude}, {geo.longitude})")
        except Exception as e:
            print(f"[GEO] Geocoding failed (non-fatal): {e}")

        # Core update (status + output_files + photo_integrity — always works)
        sb.table("claims").update(update_data).eq("id", claim_id).execute()

        # Save revision data to DB — split into isolated writes so one failure doesn't kill the others
        _carrier_info = carrier_data.get("carrier", {}) if carrier_data else {}
        _contact_fields = {
            "adjuster_name": _carrier_info.get("adjuster_name", ""),
            "adjuster_email": _carrier_info.get("adjuster_email", ""),
            "claim_number": _carrier_info.get("claim_number", ""),
            "insured_name": _carrier_info.get("insured_name", ""),
            "inspector_name": _carrier_info.get("inspector_name", ""),
        }

        # A) ALWAYS write current_carrier_rcv when we have carrier data (regardless of revision status)
        if carrier_data:
            try:
                sb.table("claims").update({
                    "current_carrier_rcv": carrier_data.get("carrier_rcv", 0),
                }).eq("id", claim_id).execute()
            except Exception as e:
                print(f"[DB] current_carrier_rcv write failed: {e}", flush=True)

        # B) Write original_carrier_rcv (baseline — never overwrite if already set)
        if carrier_data:
            _orig = original_carrier_rcv or (
                previous_carrier_data.get("carrier_rcv", 0) if previous_carrier_data
                else carrier_data.get("carrier_rcv", 0)
            )
            if _orig:
                try:
                    existing = sb.table("claims").select("original_carrier_rcv").eq("id", claim_id).limit(1).execute()
                    if not (existing.data and existing.data[0].get("original_carrier_rcv")):
                        sb.table("claims").update({"original_carrier_rcv": _orig}).eq("id", claim_id).execute()
                        print(f"[DB] Set original_carrier_rcv baseline: ${_orig:,.2f}")
                except Exception as e:
                    print(f"[DB] original_carrier_rcv write failed: {e}", flush=True)

        # C) Write win status separately — most critical field
        if revision_data and diff_result.get("is_win"):
            try:
                sb.table("claims").update({
                    "claim_outcome": "won",
                    "settlement_amount": revision_data["new_rcv"],
                }).eq("id", claim_id).execute()
                print(f"[DB] WIN persisted: claim_outcome=won, settlement=${revision_data['new_rcv']:,.2f}")
            except Exception as e:
                print(f"[DB] CRITICAL — Win status write FAILED: {e}", flush=True)

        # D) Write revision metadata (scope_revisions + previous_carrier_data)
        if revision_data:
            try:
                sb.table("claims").update({
                    "scope_revisions": config.get("scope_revisions", []),
                    "previous_carrier_data": {
                        "carrier_rcv": carrier_data.get("carrier_rcv", 0),
                        "carrier_line_items": carrier_data.get("carrier_line_items", []),
                        "carrier_arguments": carrier_data.get("carrier_arguments", []),
                        **_contact_fields,
                    },
                }).eq("id", claim_id).execute()
            except Exception as e:
                print(f"[DB] Revision metadata write failed (non-fatal): {e}", flush=True)
        elif carrier_data and not is_revision:
            try:
                sb.table("claims").update({
                    "previous_carrier_data": {
                        "carrier_rcv": carrier_data.get("carrier_rcv", 0),
                        "carrier_line_items": carrier_data.get("carrier_line_items", []),
                        "carrier_arguments": carrier_data.get("carrier_arguments", []),
                        **_contact_fields,
                    },
                }).eq("id", claim_id).execute()
            except Exception as e:
                print(f"[DB] First carrier data write failed (non-fatal): {e}", flush=True)

        # Track winning arguments for compound learning (which arguments recovered money)
        if revision_data and diff_result.get("is_win") and sb:
            try:
                carrier_name = config.get("carrier", {}).get("name", "")
                region = f"{config.get('property', {}).get('city', '')}, {config.get('property', {}).get('state', '')}".strip(", ")
                winning_args = []
                # Diff old carrier items vs new to find which were approved
                old_items = previous_carrier_data.get("carrier_line_items", []) if previous_carrier_data else []
                new_items = carrier_data.get("carrier_line_items", []) if carrier_data else []
                old_by_desc = {_clean_desc(ci.get("carrier_desc", "") or ci.get("item", "")): ci for ci in old_items}
                for ni in new_items:
                    ni_desc = _clean_desc(ni.get("carrier_desc", "") or ni.get("item", ""))
                    ni_amt = ni.get("carrier_amount", 0) or 0
                    old_ci = old_by_desc.get(ni_desc)
                    old_amt = (old_ci.get("carrier_amount", 0) or 0) if old_ci else 0
                    recovered = ni_amt - old_amt
                    if recovered > 10:  # Meaningful increase
                        # Find matching USARM item to get the argument used
                        matched_usarm = ni.get("usarm_desc", "")
                        supp_arg = ni.get("supplement_argument", "")
                        code_cit = ni.get("code_citation", {})
                        winning_args.append({
                            "claim_id": claim_id,
                            "carrier": carrier_name,
                            "line_item": ni.get("carrier_desc") or ni.get("item", ""),
                            "usarm_item": matched_usarm,
                            "argument_used": supp_arg,
                            "code_citation": code_cit.get("code_tag", "") if code_cit else "",
                            "original_carrier_amount": round(old_amt, 2),
                            "approved_amount": round(ni_amt, 2),
                            "recovered": round(recovered, 2),
                            "region": region,
                        })
                if winning_args:
                    try:
                        sb.table("winning_arguments").insert(winning_args).execute()
                        print(f"[WIN TRACKING] Captured {len(winning_args)} winning arguments (${sum(w['recovered'] for w in winning_args):,.2f} total recovered)")
                    except Exception as e:
                        # Table may not exist yet — log for creation
                        print(f"[WIN TRACKING] winning_arguments table write failed (may need migration): {e}")
            except Exception as e:
                print(f"[WIN TRACKING] Failed to capture winning arguments (non-fatal): {e}")

        print(f"[PROCESS] Claim complete: {claim['address']} — {len(pdfs)} PDFs ready")

        # 12c. Facebook Conversions API — Lead event on claim completion
        try:
            _send_meta_capi_event(claim, contractor_rcv)
        except Exception as e:
            print(f"[CAPI] Meta CAPI event failed (non-fatal): {e}")

        # 12b. Write to data warehouse tables (non-blocking — failures don't affect claim)
        try:
            _write_to_warehouse(sb, claim_id, config, photo_analysis, photo_integrity,
                                carrier_data, revision_data, photo_filenames=photo_filenames)
        except Exception as e:
            print(f"[WAREHOUSE] Data warehouse write failed (non-fatal): {e}")

        # 13. Sync to GitHub dashboard + carrier playbooks (pass PDFs for local copy)
        try:
            sync_to_github_dashboard(config, claim, photo_analysis, carrier_data, pdfs, sb=sb)
        except Exception as e:
            print(f"[SYNC] GitHub sync failed (non-fatal): {e}")

        # 14. Send completion email notification (non-fatal)
        # If QA auditor blocked the claim, skip the customer email and alert Tom instead.
        if qa_blocked:
            try:
                _send_qa_alert_email(claim, qa_audit_result or {})
                print("[QA] Alert email sent to admin")
            except Exception as e:
                print(f"[QA] Alert email failed (non-fatal): {e}")
        else:
            try:
                _send_completion_notification(claim_id)
            except Exception as e:
                print(f"[NOTIFY] Email notification failed (non-fatal): {e}")

    # Reset telemetry globals (in finally-like position — also reset on crash
    # via the except block in run_processing() in main.py, but this catches
    # normal completion and non-fatal paths)
    _TELEMETRY_SB = None
    _TELEMETRY_CLAIM_ID = None


def _send_qa_alert_email(claim: dict, audit: dict):
    """Alert Tom when the QA auditor blocks a claim delivery.

    Uses the existing Resend helper from claim_brain_email. Non-fatal —
    if Resend is down the block is still enforced in the DB, we just
    lose the proactive notification.
    """
    try:
        from claim_brain_email import send_via_resend
    except Exception as e:
        print(f"[QA] Could not import send_via_resend: {e}")
        return

    address = claim.get("address", "unknown")
    claim_id = claim.get("id", "unknown")
    crit = audit.get("critical", []) or []
    med = audit.get("medium", []) or []
    summary = audit.get("summary", "")
    recommendation = (audit.get("recommendation") or "hold").upper()

    subject = f"[QA BLOCK] {address} — {len(crit)} critical issue{'s' if len(crit) != 1 else ''}"

    deep_link = f"https://www.dumbroof.ai/admin/qa-review?claim={claim_id}"

    def _render_issue_list(issues: list, label: str, color: str) -> str:
        if not issues:
            return ""
        rows = []
        for it in issues:
            issue = it.get("issue", "?")
            loc = it.get("location", "?")
            found = it.get("found")
            expected = it.get("expected")
            quote = (it.get("quote") or "")[:250]
            body = f"<strong>{issue}</strong> &nbsp;<span style='color:#666'>@ {loc}</span>"
            if found and expected:
                body += f"<br><span style='color:#b91c1c'>found:</span> {found}<br><span style='color:#15803d'>expected:</span> {expected}"
            if quote:
                body += f"<br><em style='color:#666'>“{quote}”</em>"
            rows.append(f"<li style='margin:10px 0'>{body}</li>")
        return f"<h3 style='color:{color};margin:18px 0 6px'>{label} ({len(issues)})</h3><ul style='padding-left:20px;margin:0'>{''.join(rows)}</ul>"

    body_html = f"""
<div style='font-family:-apple-system,system-ui,sans-serif;max-width:680px;margin:0 auto;padding:20px;background:#fff;color:#111'>
  <div style='background:linear-gradient(135deg,#7f1d1d,#b91c1c);color:#fff;padding:20px;border-radius:8px;margin-bottom:20px'>
    <h1 style='margin:0;font-size:22px'>QA Audit Blocked a Claim</h1>
    <p style='margin:8px 0 0;font-size:15px;opacity:0.9'>Recommendation: <strong>{recommendation}</strong></p>
  </div>
  <div style='background:#f9fafb;padding:16px;border-radius:6px;margin-bottom:18px'>
    <p style='margin:0 0 4px'><strong>Property:</strong> {address}</p>
    <p style='margin:0 0 4px'><strong>Claim ID:</strong> <code>{claim_id}</code></p>
    <p style='margin:8px 0 0;color:#374151'>{summary}</p>
  </div>
  {_render_issue_list(crit, '🛑 Critical', '#b91c1c')}
  {_render_issue_list(med, '⚠️ Medium', '#b45309')}
  <div style='margin-top:24px;padding:16px;background:#eff6ff;border-radius:6px'>
    <p style='margin:0 0 8px;font-weight:600;color:#1e40af'>Review &amp; override</p>
    <a href='{deep_link}' style='display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600'>Open admin QA queue</a>
  </div>
  <p style='margin-top:24px;font-size:12px;color:#6b7280'>
    The customer will NOT see this claim until you review and release it. Status set to <code>qa_review_pending</code>.
  </p>
</div>
"""

    try:
        send_via_resend(
            company_name="DumbRoof QA Auditor",
            to_email="tkovack@usaroofmasters.com",
            subject=subject,
            body_html=body_html,
        )
    except Exception as e:
        print(f"[QA] send_via_resend failed: {e}")


def _send_completion_notification(claim_id: str):
    """POST to Vercel endpoint to email PDFs to user. Non-fatal."""
    import urllib.request
    import urllib.error

    url = "https://www.dumbroof.ai/api/notify-complete"
    payload = json.dumps({"claim_id": claim_id}).encode("utf-8")
    req = urllib.request.Request(url, data=payload,
                                headers={"Content-Type": "application/json"})

    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read().decode())

    if result.get("success"):
        email = result.get("email", "unknown")
        print(f"[NOTIFY] Completion email sent to {email}")
    else:
        print(f"[NOTIFY] Notification returned: {result}")


def _send_meta_capi_event(claim: dict, contractor_rcv: float):
    """Send Facebook Conversions API event when claim processing completes. Non-fatal."""
    import hashlib
    import urllib.request

    pixel_id = os.environ.get("META_PIXEL_ID")
    token = os.environ.get("META_CAPI_TOKEN")
    if not pixel_id or not token:
        return

    def sha256(val: str) -> str:
        return hashlib.sha256(val.strip().lower().encode()).hexdigest()

    user_data: dict = {}
    email = claim.get("user_email") or claim.get("email")
    if email:
        user_data["em"] = sha256(email)

    payload = json.dumps({
        "data": [{
            "event_name": "Lead",
            "event_time": int(time.time()),
            "action_source": "website",
            "event_source_url": "https://www.dumbroof.ai/dashboard",
            "user_data": user_data,
            "custom_data": {
                "content_name": claim.get("address", "Unknown"),
                "value": round(contractor_rcv, 2) if contractor_rcv else 0,
                "currency": "USD",
            },
        }],
    }).encode("utf-8")

    url = f"https://graph.facebook.com/v21.0/{pixel_id}/events?access_token={token}"
    req = urllib.request.Request(url, data=payload,
                                headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        print(f"[CAPI] Meta event sent: {resp.read().decode()}")


# ===================================================================
# QUALITY GATE — IMPROVEMENT GUIDANCE
# ===================================================================

def _build_improvement_guidance(ds, tas) -> dict:
    """Build actionable improvement tips based on lowest-scoring components."""
    tips = []

    # --- Damage Score components ---
    rs = ds.roof_surface
    ec = ds.evidence_cascade
    sm = ds.soft_metal
    dq = ds.documentation

    # A. Roof Surface Damage (0-40)
    if rs.damage_confirmation < 5:
        tips.append({
            "category": "Damage Evidence",
            "icon": "target",
            "title": "Document specific damage locations",
            "detail": "Take close-up photos of individual hail hits or wind damage. Note the number of impacts found — the more you document, the stronger the case. Use phrases like 'hail damage confirmed at 12 locations on south slope.'"
        })
    if rs.severity_spectrum < 5:
        tips.append({
            "category": "Damage Evidence",
            "icon": "alert-triangle",
            "title": "Show functional damage, not just cosmetic",
            "detail": "Look for the worst damage on the roof. Is any shingle cracked through the mat? Is there granule loss exposing fiberglass? Carriers dismiss 'cosmetic' damage — document that waterproofing is compromised."
        })
    if rs.hit_density < 5:
        tips.append({
            "category": "Damage Evidence",
            "icon": "grid",
            "title": "Count and document hit density",
            "detail": "Mark a 10x10 foot test square on the roof and count every impact mark inside it. Do this on 2-3 different slopes. Example: '14 impacts per test square on the south face.' Higher density = stronger claim."
        })

    # B. Evidence Cascade (0-25)
    if ec.chalk_protocol < 3:
        tips.append({
            "category": "Inspection Technique",
            "icon": "edit-3",
            "title": "Use chalk to circle damage",
            "detail": "Chalk-circle every hail hit and soft metal dent before photographing. This is standard forensic inspection protocol. Take the close-up photo AFTER marking. Adjusters do this — your documentation should too."
        })
    if ec.soft_metal_documentation < 4:
        tips.append({
            "category": "Soft Metal Evidence",
            "icon": "shield",
            "title": "Photograph all soft metal components",
            "detail": "Inspect and photograph every metal component: gutters, downspouts, vent pipes, chimney flashing, drip edge, fascia, AC condenser, and mailbox. Hail dents on soft metals corroborate roof damage — this is the #1 evidence carriers can't dispute."
        })
    if ec.directional_pattern < 3:
        tips.append({
            "category": "Inspection Technique",
            "icon": "compass",
            "title": "Document all four building elevations",
            "detail": "Inspect and photograph damage on the north, south, east, and west sides separately. Note which side shows the most damage (windward side will have more). This directional pattern proves storm causation."
        })
    if ec.environmental_evidence < 3:
        tips.append({
            "category": "Evidence Cascade",
            "icon": "cloud-rain",
            "title": "Check for ground-level storm evidence",
            "detail": "Look for dented gutters at ground level, damaged plants, granule wash in flower beds or at downspout discharge points, and vehicle dents. Ground-level evidence proves the storm hit the entire property, not just the roof."
        })
    if ec.roof_test_areas < 2:
        tips.append({
            "category": "Inspection Technique",
            "icon": "scissors",
            "title": "Document roof test squares",
            "detail": "With permission, lift or cut a shingle to inspect the underlayment and mat condition. Photograph the exposed area showing granule loss pattern, mat fractures, or moisture intrusion. Do this on at least 2-3 slopes."
        })

    # C. Soft Metal Corroboration (0-20)
    if sm.component_diversity < 4:
        tips.append({
            "category": "Soft Metal Evidence",
            "icon": "layers",
            "title": "Inspect more metal component types",
            "detail": "Walk the entire property perimeter. Check gutters, downspouts, vent pipes, pipe boots, chimney flashing, drip edge, fascia, soffit, AC condenser, and mailbox. Each damaged component type strengthens the case — aim for 5+ types."
        })
    if sm.dent_volume < 3:
        tips.append({
            "category": "Soft Metal Evidence",
            "icon": "hash",
            "title": "Count dents on each metal component",
            "detail": "Count dents precisely: 'Gutters: 28 dents, Downspouts: 12, Vent pipes: 8 = 48 total.' Use a coin for scale reference in photos (quarter = 0.95 inch diameter). Higher dent counts make the case undeniable."
        })

    # D. Documentation Quality (0-15)
    if dq.photo_count < 3:
        tips.append({
            "category": "Photo Quality",
            "icon": "camera",
            "title": "Take more photos",
            "detail": "Aim for 40+ photos: overview of each roof plane, close-ups of individual damage spots, every metal component, elevation comparisons, and interior damage if present. 6-15 photos is not enough for a competitive claim."
        })
    if dq.technique < 2:
        tips.append({
            "category": "Photo Quality",
            "icon": "sun",
            "title": "Improve photo technique",
            "detail": "Use chalk circles to mark damage, place a coin or ruler in frame for scale, photograph in good lighting (morning or afternoon, avoid shadows), and shoot from directly above the damage — not at an angle."
        })

    # Build summary based on most impactful gaps
    if rs.total < 15:
        summary = "We couldn't verify enough storm damage from your documentation. The photos and evidence don't yet support a strong claim — but this is fixable with better inspection technique."
    elif ec.total < 10:
        summary = "The roof shows some damage, but the supporting evidence cascade is incomplete. Carriers need to see damage corroborated across multiple property components to approve full replacement."
    elif sm.total < 8:
        summary = "Soft metal evidence is the #1 factor carriers use to verify hail. Your claim is missing critical corroborating damage on gutters, vents, and other metal components."
    elif dq.total < 6:
        summary = "Your documentation quality needs improvement. More photos with better technique (chalk circles, scale references, test squares) will dramatically strengthen this claim."
    else:
        summary = "Your claim documentation needs improvement in several areas before we can generate a competitive appeal package. Follow the tips below and resubmit."

    # Cap at 6 most impactful tips
    return {
        "summary": summary,
        "tips": tips[:6],
    }


# ===================================================================
# DATA WAREHOUSE
# ===================================================================

def _write_to_warehouse(sb, claim_id: str, config: dict, photo_analysis: dict,
                        photo_integrity: dict, carrier_data: dict, revision_data: dict,
                        photo_filenames: list = None):
    """Write processed claim data to all warehouse tables. Non-fatal on any failure."""
    financials = compute_financials(config)
    carrier = config.get("carrier", {}).get("name", "")
    price_list = config.get("financials", {}).get("price_list", "NYBI26")
    state = config.get("property", {}).get("state", "")
    city = config.get("property", {}).get("city", "")
    region = f"{city}, {state}".strip(", ")

    # 0. Clean up previous warehouse data (prevent duplicates on reprocess)
    # IMPORTANT: Do NOT delete user_added line items or line_item_feedback — these are user corrections
    try:
        sb.table("line_items").delete().eq("claim_id", claim_id).in_("source", ["usarm", "carrier"]).execute()
        # line_item_feedback is preserved — contains user corrections that survive reprocess
        sb.table("photos").delete().eq("claim_id", claim_id).execute()
        print(f"[WAREHOUSE] Cleaned previous data for {claim_id} (preserved user_added + feedback)")
    except Exception as e:
        print(f"[WAREHOUSE] Cleanup failed (non-fatal, may have duplicates): {e}")

    # 1. Photos — write photo annotations + structured tags
    photo_count = write_photos(sb, claim_id, photo_analysis, photo_integrity, photo_filenames=photo_filenames)
    print(f"[WAREHOUSE] Wrote {photo_count} photos")

    # 2. USARM line items (filter zero-qty items — they produce $0 rows that corrupt estimates)
    usarm_items_filtered = [li for li in config.get("line_items", []) if li.get("qty", 0) > 0]
    zero_qty_removed = len(config.get("line_items", [])) - len(usarm_items_filtered)
    if zero_qty_removed:
        print(f"[WAREHOUSE] Filtered {zero_qty_removed} zero-qty line items before write")
    usarm_count = write_line_items(
        sb, claim_id, usarm_items_filtered,
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
    # O&P: 10% overhead + 11% profit = 21% (confirmed across 18 gold standard Xactimate estimates)
    o_and_p_amount = round(line_total * 0.10 + line_total * 0.11, 2) if config.get("scope", {}).get("o_and_p") else 0
    total = rcv + o_and_p_amount
    # Deductible lives in carrier.deductible (NOT financials.deductible — generator ignores that)
    deductible = config.get("carrier", {}).get("deductible", 0) or config.get("financials", {}).get("deductible", 0)
    net = total - deductible
    carrier_rcv = config.get("carrier", {}).get("carrier_rcv", 0)
    variance = total - carrier_rcv if carrier_rcv is not None else 0
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
