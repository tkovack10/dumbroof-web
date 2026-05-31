#!/usr/bin/env python3
"""
USARM Universal PDF Generator — Config-Driven
==============================================
Generates the 5-document insurance claim appeal package from a single JSON config.

Usage:
    python3 usarm_pdf_generator.py claims/6-avon-rd/claim_config.json

Output:
    01_FORENSIC_CAUSATION_REPORT.pdf
    02_XACTIMATE_ESTIMATE.pdf
    03_SUPPLEMENT_REPORT.pdf
    04_DENIAL_APPEAL_LETTER.pdf

All output saved to pdf_output/ next to the claim_config.json.
"""

import os
import sys
import json
import glob
import base64
import re
import subprocess

# ===================================================================
# RESOLVE PATHS FROM CONFIG
# ===================================================================

def load_config(config_path):
    """Load claim config and resolve all paths relative to its location."""
    config_path = os.path.abspath(config_path)
    with open(config_path, "r") as f:
        config = json.load(f)

    claim_dir = os.path.dirname(config_path)
    config["_paths"] = {
        "claim_dir": claim_dir,
        "photos": os.path.join(claim_dir, "photos"),
        "output": os.path.join(claim_dir, "pdf_output"),
        "source_docs": os.path.join(claim_dir, "source_docs"),
    }
    os.makedirs(config["_paths"]["output"], exist_ok=True)
    return config


# ===================================================================
# WS-5 — NO-DATA / PLACEHOLDER RENDER GUARDS
# ===================================================================
# A claim can reach PDF generation in a "forensic-only" / pre-scope posture
# with NO uploaded measurements and/or NO storm verification. Unconditionally
# asserting "0 SF / Facets 0", "confirmed storm damage", "EagleView measurements",
# or a placeholder "Property Owner" makes the appeal package look fabricated.
# These guards gate each unconditional assertion on the (hardened) measurement /
# weather signals so the report degrades to honest, neutral language instead.
#
# Both signal helpers live in compliance_report.py (has_measurements was already
# the gate for Doc 06; weather_verified is the WS-5 sibling). We import them with
# a defensive fallback so a generator import never hard-fails on this path.
try:
    from compliance_report import has_measurements as _ws5_has_measurements
    from compliance_report import weather_verified as _ws5_weather_verified
except Exception:  # pragma: no cover — defensive only
    def _ws5_has_measurements(config):  # type: ignore
        m = (config or {}).get("measurements", {}) or {}
        try:
            return any(float(str(m.get(k, 0)).strip() or 0) > 0
                       for k in ("eave", "rake", "total_area", "area_sq"))
        except Exception:
            return False

    def _ws5_weather_verified(config):  # type: ignore
        w = (config or {}).get("weather", {}) or {}
        return bool((w.get("hail_size") or w.get("storm_date")
                     or w.get("storm_description")))


def ws5_has_measurements(config) -> bool:
    """Generator-side alias for the hardened compliance_report.has_measurements."""
    return bool(_ws5_has_measurements(config))


def ws5_weather_verified(config) -> bool:
    """Generator-side alias for compliance_report.weather_verified (prod shape)."""
    return bool(_ws5_weather_verified(config))


def ws5_owner_is_placeholder(config) -> bool:
    """True when the insured name is the literal 'Property Owner' placeholder.

    processor.py defaults insured.name to 'Property Owner' when no real owner
    name was extracted. Rendering that as the owner makes the package look
    untargeted, so callers suppress the row / use a neutral relabel.
    """
    ins = (config or {}).get("insured", {}) or {}
    name = ins.get("name", "")
    return isinstance(name, str) and name.strip().lower() in ("property owner", "")


def ws5_nodata_identity(config) -> bool:
    """No-data posture for the identity (carrier/policy) rows.

    Suppress blank carrier/policy rows ONLY when the claim is in a no-data or
    placeholder posture (placeholder owner OR no measurements). A full-data
    claim with a merely-unknown policy number keeps its blank row so existing
    full-data output stays byte-identical.
    """
    return ws5_owner_is_placeholder(config) or not ws5_has_measurements(config)


def ws5_blank(value) -> bool:
    """True when a row value is empty/whitespace after coercion to str."""
    if value is None:
        return True
    return not str(value).strip()


def ws5_owner_label(config, fallback="the property owner") -> str:
    """Neutral owner phrasing for inline/sentence contexts (e.g. the pre-scope
    cover-letter salutation). Returns a neutral noun phrase when the insured
    name is the literal 'Property Owner' placeholder so the package never reads
    'retained by Property Owner'; otherwise returns the real owner name verbatim
    (full-data output unchanged).
    """
    if ws5_owner_is_placeholder(config):
        return fallback
    return (config or {}).get("insured", {}).get("name", "") or fallback


def ws5_identity_table_rows(config, *, combined_carrier_claim, include_policy):
    """Build the placeholder-guarded identity rows for a doc's "Field | Detail"
    table (Docs 02 / 03). Reuses the EXACT Doc-01 Guard-3 predicates:

      - Property Owner row is suppressed when the owner is the placeholder.
      - Carrier (or combined Carrier / Claim) and Policy rows are suppressed
        ONLY in a no-data / placeholder posture AND when the underlying field
        is blank — so a full-data claim renders every row exactly as before
        (byte-identical), and a no-data claim never leaks blank/placeholder
        identity cells.

    combined_carrier_claim=True  → single "Carrier / Claim" row, "<name> — <#>"
                          =False → separate "Carrier" + "Claim Number" rows.
    include_policy=True          → emit the "Policy" row (Doc 02); False omits it.
    """
    ins = (config or {}).get("insured", {}) or {}
    carrier = (config or {}).get("carrier", {}) or {}
    owner_ph = ws5_owner_is_placeholder(config)
    nodata_id = ws5_nodata_identity(config)

    rows = ""
    if not owner_ph:
        rows += (
            f"    <tr><td><strong>Property Owner</strong></td><td>{ins.get('name','')}</td></tr>\n"
        )

    _cname = carrier.get("name", "")
    _cnum = carrier.get("claim_number", "")
    if combined_carrier_claim:
        # The combined cell is blank only when BOTH carrier name and claim
        # number are blank — suppress that empty "Carrier / Claim:  — " row in
        # a no-data posture; otherwise render the prior cell verbatim.
        _combined_blank = ws5_blank(_cname) and ws5_blank(_cnum)
        if not (nodata_id and _combined_blank):
            rows += (
                f"    <tr><td><strong>Carrier / Claim</strong></td><td>{_cname} — {_cnum}</td></tr>\n"
            )
    else:
        if not (nodata_id and ws5_blank(_cname)):
            rows += (
                f"    <tr><td><strong>Carrier</strong></td><td>{_cname}</td></tr>\n"
            )
        if not (nodata_id and ws5_blank(_cnum)):
            rows += (
                f"    <tr><td><strong>Claim Number</strong></td><td>{_cnum}</td></tr>\n"
            )

    if include_policy:
        _pol = carrier.get("policy_number", "")
        if not (nodata_id and ws5_blank(_pol)):
            rows += (
                f"    <tr><td><strong>Policy</strong></td><td>{_pol}</td></tr>\n"
            )
    return rows


# ===================================================================
# HELPERS
# ===================================================================

_CHROME_CANDIDATES = [
    os.environ.get("CHROMIUM_PATH", ""),
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]
CHROME = next((c for c in _CHROME_CANDIDATES if c and os.path.exists(c)), _CHROME_CANDIDATES[-1])


def b64_img(config, filename):
    """Return base64 data URI for a photo in the claim's photos/ folder."""
    path = os.path.join(config["_paths"]["photos"], filename)
    if not os.path.exists(path):
        return ""
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    ext = filename.rsplit(".", 1)[-1].lower()
    mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
    return f"data:{mime};base64,{data}"


# ===================================================================
# WS-2 — CANONICAL ROOF-MATERIAL ENUM (read, never re-sniff)
# ===================================================================
# The processor resolves the material ONCE and persists it as
# config['roof_material_enum'] and structures[i]['roof_material_enum'].
# Values: 3tab | laminate | slate | tile | metal | other.
#
# Every forensic/spec/wind/repairability consumer below READS the enum
# via material_enum(). When the enum is ABSENT (old/legacy configs, the
# WS-0 golden-corpus fixtures, or a config rendered without going through
# build_claim_config), material_enum() returns None and each consumer
# falls back to the EXACT substring logic it used before — producing
# byte-identical output. New configs get the enum during processing.

VALID_MATERIAL_ENUM = {"3tab", "laminate", "slate", "tile", "metal", "other"}


def material_enum(config, struct=None):
    """Return the canonical roof-material enum, or None if absent.

    Prefers a per-structure value, then the claim-wide value. Returns None
    (NOT 'other') when no enum is present, so callers can distinguish
    "resolved as other/unclassifiable" from "no enum → use legacy fallback".
    """
    if struct is not None:
        val = struct.get("roof_material_enum")
        if val in VALID_MATERIAL_ENUM:
            return val
    if isinstance(config, dict):
        val = config.get("roof_material_enum")
        if val in VALID_MATERIAL_ENUM:
            return val
    return None


# Magic-byte signatures for raster image formats Chrome can render in <img>.
# Adobe Illustrator (.ai), PDF, EPS, SVG and other vector/document formats
# are explicitly rejected — they download fine but render as broken images
# (root cause of E203, Team Builders 2026-05-05).
_RASTER_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff",      "image/jpeg"),
    (b"GIF87a",            "image/gif"),
    (b"GIF89a",            "image/gif"),
    (b"RIFF",              "image/webp"),  # WEBP — verified below by 'WEBP' at offset 8
)


def _detect_raster_mime(data: bytes) -> str:
    """Return MIME for a confirmed raster image, or empty string if not raster."""
    for sig, mime in _RASTER_MAGIC:
        if data.startswith(sig):
            if mime == "image/webp" and not (len(data) >= 12 and data[8:12] == b"WEBP"):
                continue
            return mime
    return ""


def get_logo_b64(config):
    """Return base64 data URI for the company logo.

    Globs `usarm_logo.*` / `logo.*` in photos_dir, then validates the file
    is an actual raster image by inspecting magic bytes. Returns empty
    string if no candidate found OR if the file is a non-raster format
    (e.g. .ai, .pdf, .svg, .eps) — which Chrome refuses to render in <img>
    and which previously rendered as broken alt-text on the cover page.

    Caller pairs this with render_logo_block() so an empty return becomes
    a clean text fallback instead of a broken <img src="">.
    """
    photos_dir = config["_paths"]["photos"]
    candidates = sorted(glob.glob(os.path.join(photos_dir, "usarm_logo.*")) +
                        glob.glob(os.path.join(photos_dir, "logo.*")))
    for logo_path in candidates:
        try:
            with open(logo_path, "rb") as f:
                head = f.read(64)
                if not head:
                    continue
                mime = _detect_raster_mime(head)
                if not mime:
                    print(f"[LOGO] Rejecting non-raster file {os.path.basename(logo_path)} "
                          f"(magic={head[:8]!r}) — render would be broken alt-text")
                    continue
                f.seek(0)
                data = base64.b64encode(f.read()).decode()
                return f"data:{mime};base64,{data}"
        except OSError as e:
            print(f"[LOGO] Could not read {logo_path}: {e}")
            continue
    return ""


def render_logo_block(logo_b64: str, company_name: str,
                      css_class: str = "cover-logo",
                      inline_style: str = "") -> str:
    """Render the company logo OR a clean text fallback.

    When logo_b64 is non-empty, emits the canonical <img> tag with the
    same class/style the legacy template used. When empty, emits a styled
    <div> with the company name — never an <img src=""> which browsers
    render as the alt attribute (the broken-looking failure mode that
    triggered E203).
    """
    safe_name = (company_name or "").strip()
    if logo_b64:
        style_attr = f' style="{inline_style}"' if inline_style else ""
        return f'<img src="{logo_b64}" alt="{safe_name}" class="{css_class}"{style_attr}>'
    inline = inline_style or ""
    return (f'<div class="logo-text-fallback {css_class}" style="{inline}">'
            f'{safe_name}</div>')


def get_assoc_logo_b64(logo_basename):
    """Return base64 data URI for an association logo from references/logos/.

    Accepts basename like 'apa_logo' and tries .png, .jpg, .jpeg extensions.
    """
    script_dir = os.path.dirname(os.path.abspath(__file__))
    logos_dir = os.path.join(script_dir, "references", "logos")
    # Try multiple extensions
    name_no_ext = logo_basename.rsplit(".", 1)[0] if "." in logo_basename else logo_basename
    for ext in ["png", "jpg", "jpeg"]:
        logo_path = os.path.join(logos_dir, f"{name_no_ext}.{ext}")
        if os.path.exists(logo_path):
            with open(logo_path, "rb") as f:
                data = base64.b64encode(f.read()).decode()
            mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
            return f"data:{mime};base64,{data}"
    return ""


def find_photo(config, page, img, key=None):
    """Find photo file. Checks photo_map first (if key provided), then glob-matches page{NN}_img{NN}_*.jpeg."""
    # Check photo_map first — direct key-to-filename mapping
    if key:
        photo_map = config.get("photo_map", {})
        if key in photo_map:
            mapped = photo_map[key]
            path = os.path.join(config["_paths"]["photos"], mapped)
            if os.path.exists(path):
                return mapped
    # Fall back to existing glob pattern
    pattern = os.path.join(config["_paths"]["photos"],
                           f"page{page:02d}_img{img:02d}_*.jpeg")
    matches = glob.glob(pattern)
    if matches:
        return os.path.basename(matches[0])
    # Try without leading zero on page
    pattern2 = os.path.join(config["_paths"]["photos"],
                            f"page{page}_img{img:02d}_*.jpeg")
    matches2 = glob.glob(pattern2)
    if matches2:
        return os.path.basename(matches2[0])
    return None


def find_overview_photo(config, page_key):
    """Find overview photo by page key like 'page03' or 'page06'."""
    pattern = os.path.join(config["_paths"]["photos"], f"{page_key}_*.jpeg")
    matches = glob.glob(pattern)
    if matches:
        return os.path.basename(matches[0])
    # Try with img01 variant
    page_num = int(page_key.replace("page", ""))
    return find_photo(config, page_num, 1)


def html_to_pdf(html_path, pdf_path):
    """Convert HTML to PDF using Chrome headless."""
    cmd = [
        CHROME, "--headless", "--disable-gpu", "--no-sandbox",
        "--disable-software-rasterizer",
        f"--print-to-pdf={pdf_path}",
        "--no-pdf-header-footer", "--print-to-pdf-no-header",
        f"file://{html_path}"
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired:
        print(f"  ERROR: Chrome timed out after 180s generating {os.path.basename(pdf_path)}")
        print(f"  TIP: Photos may be too large. Resize with: sips -Z 1000 *.JPG")
        raise RuntimeError(f"Chrome headless timed out generating {os.path.basename(pdf_path)}")

    if result.returncode != 0:
        stderr_msg = (result.stderr or "")[:500]
        print(f"  WARNING: Chrome exited with code {result.returncode}")
        if stderr_msg:
            print(f"  stderr: {stderr_msg}")

    if os.path.exists(pdf_path):
        size = os.path.getsize(pdf_path)
        if size < 1024:
            print(f"  ERROR: PDF is blank or corrupt ({size} bytes): {os.path.basename(pdf_path)}")
            print(f"  TIP: Check HTML source at {html_path}")
            raise RuntimeError(f"Generated PDF is blank ({size} bytes): {os.path.basename(pdf_path)}")
        print(f"  -> {os.path.basename(pdf_path)} ({size:,} bytes)")
    else:
        stderr_msg = (result.stderr or "")[:500]
        print(f"  ERROR: PDF not created: {os.path.basename(pdf_path)}")
        if stderr_msg:
            print(f"  stderr: {stderr_msg}")
        raise RuntimeError(f"Chrome headless failed to create PDF: {os.path.basename(pdf_path)}")


def fmt_money(val):
    """Format a number as $X,XXX.XX."""
    if val is None:
        return "$0.00"
    return f"${val:,.2f}"


def _is_initial_scope(item):
    """True if a line item belongs to the INITIAL estimate (Doc 02). Items tagged for a
    later timing — scope_timing='install_supplement' (discovered during work, e.g. the
    decking allowance) — are excluded from the initial estimate + its financials and surface
    in the supplement instead. Untagged items default to 'initial' (no refactor needed).
    Ship 17 install-supplement timing model — see project_install_supplement_flow."""
    return (item.get("scope_timing") or "initial") == "initial"


def compute_financials(config):
    """Compute INITIAL-estimate financial totals from line_items + tax_rate.

    Only scope_timing=='initial' items count toward the initial estimate; install-supplement
    items (decking allowance etc.) are filed separately and excluded here (Ship 17 timing model).
    """
    items = [it for it in config.get("line_items", []) if _is_initial_scope(it)]
    line_total = sum(round(it["qty"] * it["unit_price"], 2) for it in items)
    tax_rate = config.get("financials", {}).get("tax_rate", 0.08)
    tax = round(line_total * tax_rate, 2)
    rcv = round(line_total + tax, 2)

    trades = config.get("scope", {}).get("trades", [])
    o_and_p = len(trades) >= 3
    o_and_p_amount = 0
    if o_and_p:
        o_and_p_amount = round(line_total * 0.10 + line_total * 0.11, 2)  # 10% overhead + 11% profit (confirmed across 18 gold standard estimates)

    deductible = config.get("carrier", {}).get("deductible", 0)
    carrier_rcv = config.get("carrier", {}).get("carrier_rcv", 0)

    total_with_op = rcv + o_and_p_amount
    net_claim = round(total_with_op - deductible, 2)
    variance = round(total_with_op - carrier_rcv, 2)

    return {
        "line_total": line_total,
        "tax_rate": tax_rate,
        "tax": tax,
        "rcv": rcv,
        "o_and_p": o_and_p,
        "o_and_p_amount": o_and_p_amount,
        "total_with_op": total_with_op,
        "deductible": deductible,
        "net_claim": net_claim,
        "carrier_rcv": carrier_rcv,
        "carrier_net": round(carrier_rcv - deductible, 2) if carrier_rcv else config.get("carrier", {}).get("carrier_net", 0),
        "variance": variance,
    }


# ===================================================================
# ROLE-BASED LANGUAGE ENGINE (UPPA Compliance)
# ===================================================================
# Document language adapts based on user role. Contractors get safe
# language (no advocacy); PAs/attorneys get full advocacy language.
# Default: contractor with AOB (safe mode for backward compatibility).

LANG_ADVOCATE = {
    "role": "advocate",
    "doc3_title": "SUPPLEMENT REPORT",
    "doc3_subtitle": "Carrier Scope Cross-Reference &mdash; Line-by-Line Comparison",
    "doc3_filename": "03_SUPPLEMENT_REPORT",
    "doc3_purpose": "This Supplement Report provides a line-by-line comparison between the {carrier} scope of loss and the {company} scope of repairs. Each variance is documented with the applicable building code citation, manufacturer specification, or forensic engineering standard.",
    "doc3_carrier_header": "CARRIER POSITION SUMMARY",
    "doc3_carrier_intro": "{carrier}'s scope:",
    "doc4_title": "DENIAL APPEAL LETTER",
    "doc4_filename": "04_DENIAL_APPEAL_LETTER",
    "doc4_subject_default": "FORMAL SUPPLEMENT & APPEAL — DEMAND FOR FULL SCOPE APPROVAL",
    "action_verb": "demand",
    "carrier_missed": "The carrier failed to include",
    "variance_label": "Carrier Underpayment",
    "carrier_scope_label": "CARRIER SCOPE",
    "carrier_scope_box": "critical-box",
    "code_intro": "The following International Residential Code (IRC) requirements are omitted from the carrier's scope:",
    "comparison_header": "COMPARISON TO CARRIER SCOPE",
    "regulatory_citations": True,
    "disclaimer": None,
    "contractor_cert": False,
}

LANG_CONTRACTOR_AOB = {
    "role": "contractor_aob",
    "doc3_title": "SCOPE COMPARISON REPORT",
    "doc3_subtitle": "Carrier Scope vs. Contractor Scope &mdash; Line-by-Line Comparison",
    "doc3_filename": "03_SCOPE_COMPARISON_REPORT",
    "doc3_purpose": "This Scope Comparison Report provides a line-by-line comparison between the {carrier} scope and the {company} contractor scope of work. Each difference is documented with the applicable building code citation, manufacturer specification, or forensic engineering standard.",
    "doc3_carrier_header": "CURRENT APPROVAL SUMMARY",
    "doc3_carrier_intro": "{carrier}'s current approval:",
    "doc4_title": "SCOPE CLARIFICATION LETTER",
    "doc4_filename": "04_SCOPE_CLARIFICATION_LETTER",
    "doc4_subject_default": "SCOPE CLARIFICATION — CONTRACTOR SCOPE SUBMISSION",
    "action_verb": "request",
    "carrier_missed": "Items in our scope not yet reflected in current approval",
    "variance_label": "Scope Difference",
    "carrier_scope_label": "Current Approval",
    "carrier_scope_box": "highlight-box",
    "code_intro": "The following International Residential Code (IRC) requirements apply to the scope of work for this property:",
    "comparison_header": "SCOPE COMPARISON",
    "regulatory_citations": False,
    "disclaimer": "This document is a contractor's professional work product. {company} is a licensed contractor, not a public adjuster. This document does not constitute insurance claim adjustment, negotiation, or advocacy on behalf of any policyholder.",
    "contractor_cert": True,
}

LANG_CONTRACTOR = {
    "role": "contractor",
    "doc3_title": "SCOPE COMPARISON REPORT",
    "doc3_subtitle": "Contractor Scope vs. Current Approval &mdash; Line-by-Line Comparison",
    "doc3_filename": "03_SCOPE_COMPARISON_REPORT",
    "doc3_purpose": "This Scope Comparison Report provides a line-by-line comparison between the current approval and the {company} contractor scope of work. Each difference is documented with the applicable building code citation, manufacturer specification, or forensic engineering standard.",
    "doc3_carrier_header": "CURRENT APPROVAL SUMMARY",
    "doc3_carrier_intro": "{carrier}'s current approval:",
    "doc4_title": "CONTRACTOR SCOPE OF WORK LETTER",
    "doc4_filename": "04_CONTRACTOR_SCOPE_LETTER",
    "doc4_subject_default": "CONTRACTOR SCOPE OF WORK SUBMISSION",
    "action_verb": "request",
    "carrier_missed": "Items in our scope not yet reflected in current approval",
    "variance_label": "Scope Difference",
    "carrier_scope_label": "Current Approval",
    "carrier_scope_box": "highlight-box",
    "code_intro": "The following International Residential Code (IRC) requirements apply to the scope of work for this property:",
    "comparison_header": "SCOPE COMPARISON",
    "regulatory_citations": False,
    "disclaimer": "This document is a contractor's professional work product. {company} is a licensed contractor, not a public adjuster. This document does not constitute insurance claim adjustment, negotiation, or advocacy on behalf of any policyholder.",
    "contractor_cert": True,
}

LANG_HOMEOWNER = {
    "role": "homeowner",
    "doc3_title": "SCOPE COMPARISON REPORT",
    "doc3_subtitle": "Insurance Scope vs. Repair Estimate &mdash; Comparison",
    "doc3_filename": "03_SCOPE_COMPARISON_REPORT",
    "doc3_purpose": "This Scope Comparison Report compares the current insurance scope with the professional repair estimate. Each difference is documented with the applicable building code citation, manufacturer specification, or forensic engineering standard.",
    "doc3_carrier_header": "CURRENT INSURANCE SCOPE",
    "doc3_carrier_intro": "{carrier}'s current scope:",
    "doc4_title": "CLAIM REVIEW REQUEST",
    "doc4_filename": "04_CLAIM_REVIEW_REQUEST",
    "doc4_subject_default": "REQUEST FOR CLAIM SCOPE REVIEW",
    "action_verb": "request",
    "carrier_missed": "Items not yet included in the current scope",
    "variance_label": "Scope Difference",
    "carrier_scope_label": "Current Scope",
    "carrier_scope_box": "highlight-box",
    "code_intro": "The following International Residential Code (IRC) requirements apply to the repairs needed at this property:",
    "comparison_header": "SCOPE COMPARISON",
    "regulatory_citations": False,
    "disclaimer": None,
    "contractor_cert": False,
}


def get_language(config):
    """Return language constants based on user role for UPPA compliance.

    Reads compliance.user_role from config. Defaults to contractor with AOB
    for backward compatibility with existing claims.
    """
    compliance = config.get("compliance", {})
    role = compliance.get("user_role", "contractor")
    has_aob = compliance.get("has_aob", True)

    if role in ("public_adjuster", "attorney"):
        return LANG_ADVOCATE
    elif role == "homeowner":
        return LANG_HOMEOWNER
    elif role == "contractor" and not has_aob:
        return LANG_CONTRACTOR
    else:
        return LANG_CONTRACTOR_AOB


def _photo_intro_text(config):
    """Return the photo intro sentence with proper count handling."""
    findings = config.get("forensic_findings", {})
    total_photos = findings.get("total_photos", 0)
    if not total_photos:
        total_photos = len(config.get("photo_annotations", {}))
    _co = config.get("company", {}).get("name", "our") or "our"
    if total_photos:
        return f"{total_photos} photographs were taken during the {_co} inspection(s)."
    else:
        return f"Photographs were taken during the {_co} inspection(s)."


def _get_code_reference(config):
    """Return the appropriate building code reference based on property state.

    Data-driven via building_codes/state_codes.json — add states by editing
    the JSON row, not this function. Unknown states fall back to IRC.
    """
    from building_codes import lookup as _bc_lookup
    state = config.get("property", {}).get("state", "")
    return _bc_lookup.get_code_reference(state)


def _get_code_intro(config):
    """Return the code_intro text with state-appropriate code reference."""
    lang = get_language(config)
    code_ref = _get_code_reference(config)
    return lang["code_intro"].replace("International Residential Code (IRC)", code_ref)


def _build_contractor_cert(config):
    """Build contractor certification block (contractor roles only)."""
    lang = get_language(config)
    if not lang["contractor_cert"]:
        return ""
    compliance = config.get("compliance", {})
    inspectors_cfg = config.get("inspectors", {})
    company = config["company"]
    name = inspectors_cfg.get("usarm_inspector", company["ceo_name"])
    # Guard: never let AI/bot names appear on certification
    if any(w in name.lower() for w in ["dumb roof", "ai analysis", "automated", "bot"]):
        name = company["ceo_name"]
    # Ultimate fallback — if ceo_name also has bad words, use company name
    if not name or any(w in name.lower() for w in ["dumb roof", "ai analysis", "automated", "bot"]):
        name = company.get("name", "Contractor")
    license_num = compliance.get("license_number", "")
    license_text = f" ({license_num})" if license_num else ""
    return f'''
<div style="margin-top:20pt; padding:12pt; border:1px solid #0d2137; border-radius:4pt; break-inside:avoid;">
<p style="margin:0;"><strong>Contractor Certification:</strong> I, {name}, a licensed roofing contractor{license_text}, certify that this report reflects my professional assessment of the scope required to restore this property to a complete, code-compliant condition.</p>
</div>'''


def _build_uppa_disclaimer(config):
    """Build UPPA disclaimer block (contractor roles only)."""
    lang = get_language(config)
    if not lang.get("disclaimer"):
        return ""
    company = config["company"]
    text = lang["disclaimer"].format(company=company["name"])
    return f'''
<div style="margin-top:12pt; padding:10pt; background:#f5f5f5; border-radius:4pt; font-size:8pt; color:#666;">
<p style="margin:0;"><em>{text}</em></p>
</div>'''


def _build_appeal_opening(config, fin):
    """Build the opening paragraph of the appeal/scope letter based on role."""
    lang = get_language(config)
    ins = config["insured"]
    carrier = config["carrier"]

    # WS-5 GUARD 5 — only cite "EagleView measurements" as a basis when the
    # claim actually has measurements; otherwise the appeal opening hard-claims
    # an EagleView report that was never attached.
    _scope_basis = (
        "based on forensic inspection, EagleView measurements, and current Xactimate pricing"
        if ws5_has_measurements(config)
        else "based on forensic inspection and current Xactimate pricing"
    )

    if lang["role"] == "advocate":
        # WS-5 GUARD (identity prose) — drop the placeholder owner name on a
        # no-data claim so the advocate appeal opening never reads "on behalf of
        # the insured, Property Owner". Real owner renders verbatim with the
        # ", {name}" appositive (byte-identical to the prior output).
        _appeal_owner_appos = "" if ws5_owner_is_placeholder(config) else f", {ins['name']}"
        # WS-5 GUARD (blank carrier) — post-scope claims normally carry a carrier
        # name, but a failed extraction can leave it blank; fall back to a neutral
        # "the carrier" so the sentence never reads "request that  re-evaluate".
        _appeal_carrier = "the carrier" if ws5_blank(carrier['name']) else carrier['name']
        return f"We write on behalf of the insured{_appeal_owner_appos}, to formally supplement and appeal the scope of loss issued for the above-referenced claim. The carrier's scope totals {fmt_money(fin['carrier_rcv'])} RCV. We respectfully request that {_appeal_carrier} re-evaluate the claim and approve the full scope of necessary repairs totaling <strong>{fmt_money(fin['total_with_op'])} RCV</strong>."
    elif lang["role"] == "contractor_aob":
        return f"Per the executed Assignment of Benefits, we are submitting our updated contractor scope for the above-referenced claim. The current approval totals {fmt_money(fin['carrier_rcv'])} RCV. Our professional scope of work, {_scope_basis}, totals <strong>{fmt_money(fin['total_with_op'])} RCV</strong>."
    elif lang["role"] == "contractor":
        return f"As the licensed contractor engaged for repairs at the above property, we are submitting our professional scope of work for the above-referenced claim. Our scope, {_scope_basis}, totals <strong>{fmt_money(fin['total_with_op'])} RCV</strong>."
    else:
        return f"I am writing to request a review of the scope for the above-referenced claim. The current approval totals {fmt_money(fin['carrier_rcv'])} RCV. Based on a professional forensic inspection, the full scope of necessary repairs totals <strong>{fmt_money(fin['total_with_op'])} RCV</strong>."


# ===================================================================
# CSS DESIGN SYSTEM (from 6 Avon — includes @page margin:0 fix)
# ===================================================================

CSS_COMMON = """
@page {
    size: letter;
    margin: 0.75in 0.85in;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
    font-size: 10pt;
    line-height: 1.5;
    color: #1a1a1a;
}
h1 {
    font-size: 20pt;
    font-weight: 800;
    color: #0d2137;
    margin: 16pt 0 8pt 0;
}
h2 {
    font-size: 14pt;
    font-weight: 700;
    color: #0d2137;
    border-bottom: 2pt solid #c8102e;
    padding-bottom: 4pt;
    margin: 20pt 0 10pt 0;
}
h3 {
    font-size: 11pt;
    font-weight: 700;
    color: #0d2137;
    margin: 14pt 0 6pt 0;
}
p { margin: 6pt 0; }
ul, ol { margin: 6pt 0 6pt 24pt; }
li { margin: 3pt 0; }
table {
    width: 100%;
    border-collapse: collapse;
    margin: 10pt 0;
    font-size: 9.5pt;
}
th {
    background: #0d2137;
    color: #fff;
    padding: 6pt 8pt;
    text-align: left;
    font-weight: 600;
}
td {
    padding: 5pt 8pt;
    border-bottom: 1px solid #e0e0e0;
}
tr:nth-child(even) td { background: #f8f9fa; }
.amt { text-align: right; font-family: 'Courier New', monospace; }

/* Header bar — full bleed navy */
.header-bar {
    background: #0d2137;
    color: #fff;
    padding: 18pt 24pt;
    margin: -0.75in -0.85in 20pt -0.85in;
    width: calc(100% + 1.7in);
    display: flex;
    align-items: center;
    gap: 18pt;
}
.header-bar .logo-img {
    height: 52pt;
    width: auto;
    background: #fff;
    padding: 5pt 8pt;
    border-radius: 4pt;
    box-sizing: content-box;
}
.header-bar .header-text { flex: 1; }
.header-bar .company {
    font-size: 11pt;
    font-weight: 700;
    color: #c8102e;
    letter-spacing: 2pt;
    margin-bottom: 2pt;
}
.header-bar h1 {
    color: #fff;
    font-size: 22pt;
    margin: 0;
    line-height: 1.2;
}
.header-bar .subtitle {
    font-size: 9pt;
    color: #aabdd4;
    margin-top: 3pt;
}

/* Callout boxes */
.highlight-box {
    background: #fff8e1;
    border-left: 4pt solid #f9a825;
    padding: 10pt 14pt;
    margin: 10pt 0;
    border-radius: 2pt;
    font-size: 9.5pt;
}
.critical-box {
    background: #fce4ec;
    border-left: 4pt solid #c8102e;
    padding: 10pt 14pt;
    margin: 10pt 0;
    border-radius: 2pt;
    font-size: 9.5pt;
}
.success-box {
    background: #e8f5e9;
    border-left: 4pt solid #2e7d32;
    padding: 10pt 14pt;
    margin: 10pt 0;
    border-radius: 2pt;
    font-size: 9.5pt;
}

/* Photo grid */
.photo-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10pt;
    margin: 10pt 0;
}
.photo-card {
    break-inside: avoid;
    page-break-inside: avoid;
    border: 1px solid #ddd;
    border-radius: 4pt;
    overflow: hidden;
}
.photo-card img {
    width: 100%;
    height: auto;
    display: block;
}
.photo-card .caption {
    padding: 6pt 8pt;
    font-size: 8pt;
    color: #333;
    background: #f9f9f9;
    line-height: 1.35;
}

/* Cover page */
.cover-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 85vh;
    text-align: center;
}
.cover-page .cover-logo { height: 160pt; width: auto; max-width: 360pt; margin-bottom: 20pt; object-fit: contain; }
.logo-text-fallback {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-weight: 800;
    color: #0d2137;
    letter-spacing: 1pt;
    padding: 6pt 12pt;
    display: inline-block;
    border-bottom: 3px solid #c8102e;
}
.cover-page .logo-text-fallback.cover-logo {
    height: auto;
    font-size: 32pt;
    line-height: 1.1;
    margin-bottom: 20pt;
    letter-spacing: 2pt;
}
.header-bar .logo-text-fallback.logo-img {
    font-size: 16pt;
    padding: 6pt 12pt;
    background: #fff;
    color: #0d2137;
    border-radius: 4pt;
    border-bottom: 2px solid #c8102e;
}
.cover-page .cover-company {
    font-size: 28pt;
    font-weight: 800;
    color: #0d2137;
    letter-spacing: 3pt;
    margin-bottom: 4pt;
}
.cover-page .cover-tagline {
    font-size: 10pt;
    color: #666;
    letter-spacing: 4pt;
    margin-bottom: 32pt;
}
.cover-page .cover-title {
    font-size: 24pt;
    font-weight: 800;
    color: #0d2137;
    margin-bottom: 8pt;
}
.cover-page .cover-subtitle {
    font-size: 12pt;
    color: #555;
    margin-bottom: 24pt;
}
.cover-page .cover-info { font-size: 10pt; color: #333; line-height: 1.8; }
.cover-page .cover-info strong { color: #0d2137; }

/* TOC */
.toc-item {
    display: flex;
    justify-content: space-between;
    padding: 5pt 0;
    border-bottom: 1px dotted #ccc;
    font-size: 10.5pt;
}

/* Total rows */
.total-row td {
    font-weight: 700;
    background: #e8edf2 !important;
    border-top: 2px solid #0d2137;
}
.grand-total td {
    font-weight: 800;
    font-size: 11pt;
    background: #0d2137 !important;
    color: #fff;
}
.section-total td {
    font-weight: 700;
    background: #e8edf2 !important;
    border-top: 2px solid #0d2137;
}

/* Variance */
.variance-positive { color: #c8102e; font-weight: 700; }
.var-pos { color: #c8102e; font-weight: 700; }

/* Footer signature */
.footer-sig {
    margin-top: 20pt;
    padding-top: 10pt;
    border-top: 1px solid #ccc;
    font-size: 10pt;
}
.footer-sig .name { font-weight: 700; font-size: 11pt; color: #0d2137; }
.footer-sig .title { font-weight: 600; color: #555; }

/* Confidential footer */
.confidential {
    margin-top: 20pt;
    padding-top: 8pt;
    border-top: 1px solid #ddd;
    font-size: 7.5pt;
    color: #999;
    text-align: center;
}

/* Page break utility */
.page-break { page-break-after: always; }

/* Info box (repairability, callouts) */
.info-box {
    background: #f0f4f8;
    border-left: 4pt solid #0d2137;
    padding: 10pt 14pt;
    margin: 10pt 0;
    border-radius: 2pt;
    font-size: 9.5pt;
}

/* News media quote styling */
.media-quote {
    background: #f8f9fa;
    border-left: 4pt solid #4b5563;
    padding: 10pt 14pt;
    margin: 10pt 0;
    border-radius: 2pt;
    font-size: 9.5pt;
    font-style: italic;
    color: #374151;
}
.media-quote .source {
    font-style: normal;
    font-weight: 700;
    color: #0d2137;
    font-size: 8.5pt;
    margin-top: 4pt;
}

/* Threshold aging chart */
.threshold-chart {
    border: 1px solid #d1d5db;
    border-radius: 4pt;
    padding: 14pt;
    margin: 12pt 0;
    background: #f9fafb;
    break-inside: avoid;
}
.threshold-chart .chart-title {
    font-size: 10pt;
    font-weight: 700;
    color: #0d2137;
    margin-bottom: 10pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}
.threshold-chart .bar-row {
    display: flex;
    align-items: center;
    margin: 4pt 0;
    font-size: 9pt;
}
.threshold-chart .bar-label {
    width: 70pt;
    font-weight: 600;
    color: #374151;
}
.threshold-chart .bar-value {
    width: 50pt;
    font-weight: 700;
    color: #0d2137;
    text-align: right;
    padding-right: 8pt;
}
.threshold-chart .bar-fill {
    height: 14pt;
    background: #0d2137;
    border-radius: 2pt;
    transition: width 0.3s;
}
.threshold-chart .bar-fill.property {
    background: #c8102e;
}
.threshold-chart .property-indicator {
    margin-top: 10pt;
    padding: 8pt 12pt;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 4pt;
    font-size: 9pt;
    color: #991b1b;
    font-weight: 600;
}
.threshold-chart .exceeds-line {
    margin-top: 8pt;
    padding: 8pt 12pt;
    background: #fce4ec;
    border-left: 4pt solid #c8102e;
    border-radius: 2pt;
    font-size: 9.5pt;
    font-weight: 700;
    color: #c8102e;
}

/* Association logos on cover */
.cover-assoc-logos {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 20pt;
    margin-top: 16pt;
}
.cover-assoc-logos img {
    height: 28pt;
    width: auto;
    opacity: 0.85;
}
"""


# ===================================================================
# SPECTRAL DESIGN SYSTEM — DOC 01 FORENSIC CAUSATION REPORT
# ===================================================================
# Lifted VERBATIM from the shipped Doc-06 gold standard
# (compliance_report.py :root tokens, fonts, cite-chip, run-head,
# code-card, summary-table, cover). Doc 01 gets its OWN stylesheet so
# Docs 02-05 stay byte-identical (they keep CSS_COMMON). The forensic
# report re-styles EVERY utility class it uses — including the carry-over
# .photo-grid / .photo-card / .caption / .toc-item / .info-box /
# .media-quote / .footer-sig / .confidential / .cover-assoc-logos —
# in Spectral, never deleting them. No literal palette hex appears
# downstream of the :root block; every rule reads var(--token).

# Google Fonts <link> for Spectral / Libre Franklin / IBM Plex Mono.
# Lives in the <head>; print engines that ignore web fonts fall back to
# the var()-declared local serif/sans/mono stacks (so the look degrades
# gracefully to Georgia/Helvetica/Menlo rather than breaking).
FORENSIC_FONTS_LINK = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link href="https://fonts.googleapis.com/css2?'
    'family=Spectral:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&'
    'family=Libre+Franklin:wght@400;500;600;700;800&'
    'family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">'
)

FORENSIC_SPECTRAL_CSS = """
/* ============================================================
   :root — SWAPPABLE PER-COMPANY THEME (edit ONLY this block to
   re-skin the entire forensic report for another contractor's
   brand). Every component below reads var(--token); no literal
   palette value is repeated downstream.
   ============================================================ */
:root {
    /* — brand palette — */
    --c-navy:        #0d1b3e;
    --c-navy-deep:   #091230;
    --c-navy-soft:   #16284f;
    --c-brick:       #9a2b2f;
    --c-brick-bright:#b8383c;
    --c-brick-warm:  #c98f6d;

    /* — sheet / neutrals — */
    --c-paper:       #faf8f3;
    --c-paper-warm:  #f3efe5;
    --c-ink:         #1a1f29;
    --c-slate:       #4a5568;
    --c-mute:        #8a93a3;
    --c-line:        #d8d2c5;
    --c-line-soft:   #e7e2d6;
    --c-gold:        #b08a3e;

    /* — SEMANTIC STATUS ONLY (forest / red carry the verified-vs-
         omitted signal — never decorative) — */
    --c-included:    #1f6b4a;
    --c-included-bg: #e6efe8;
    --c-included-bd: #bcd6c6;
    --c-omitted:     #9a2b2f;
    --c-omitted-bg:  #f5dede;
    --c-omitted-bd:  #e2b9b9;

    /* — type tokens — */
    --f-serif: 'Spectral', Georgia, 'Times New Roman', serif;
    --f-sans:  'Libre Franklin', -apple-system, Helvetica, Arial, sans-serif;
    --f-mono:  'IBM Plex Mono', 'SFMono-Regular', Menlo, monospace;
}

@page { size: letter; margin: 0.55in 0.6in; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: var(--f-sans);
    color: var(--c-ink);
    background: var(--c-paper);
    line-height: 1.5;
    font-size: 10pt;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
}

h1 { font-family: var(--f-serif); font-size: 20pt; font-weight: 600; color: var(--c-navy); margin: 16pt 0 8pt 0; letter-spacing: -0.01em; }
h2 {
    font-family: var(--f-serif); font-size: 16pt; font-weight: 600; color: var(--c-navy);
    margin: 22pt 0 10pt 0; padding-bottom: 6pt; letter-spacing: -0.01em;
    border-bottom: 2px solid var(--c-navy);
}
h3 {
    font-family: var(--f-serif); font-size: 12.5pt; font-weight: 600; color: var(--c-navy);
    margin: 16pt 0 7pt 0; letter-spacing: -0.005em; position: relative;
}
h3::after { content: ""; display: block; width: 26px; height: 2px; background: var(--c-brick); margin-top: 5pt; }
p { margin: 6pt 0; }
ul, ol { margin: 6pt 0 6pt 24pt; }
li { margin: 3pt 0; }
a { color: var(--c-navy); }
strong, b { font-weight: 700; }

/* base table → Spectral summary-table treatment (navy header, brick
   keyline, warm zebra). All evidence numbers go mono. */
table {
    width: 100%; border-collapse: collapse; margin: 12pt 0; font-size: 9.5pt;
}
th {
    background: var(--c-navy); color: #dfe5ee; padding: 8pt 10pt; text-align: left;
    font-family: var(--f-sans); font-weight: 700; font-size: 8pt; letter-spacing: 0.12em;
    text-transform: uppercase; border-bottom: 2px solid var(--c-brick);
}
td { padding: 7pt 10pt; border-bottom: 1px solid var(--c-line-soft); vertical-align: middle; color: var(--c-slate); }
td strong { color: var(--c-ink); }
tr:nth-child(even) td { background: var(--c-paper-warm); }
.amt { text-align: right; font-family: var(--f-mono); color: var(--c-ink); }
/* mono utility — every measurement / numeric data cell reads as data, not copy */
td.mono, .mono { font-family: var(--f-mono); color: var(--c-ink); letter-spacing: 0.01em; }

/* ── THE CITATION CHIP — every code / standard reference ── */
.cite-chip {
    display: inline-block; font-family: var(--f-mono); font-weight: 700;
    font-size: 9pt; letter-spacing: 0.02em; line-height: 1.3;
    color: var(--c-brick); background: var(--c-omitted-bg);
    border: 1px solid var(--c-omitted-bd); border-radius: 3px;
    padding: 1.5pt 7pt; white-space: nowrap; vertical-align: baseline;
}
.cite-chip.neutral { color: var(--c-slate); background: var(--c-paper-warm); border-color: var(--c-line); }
.cite-chip.on-navy { color: #fff; background: rgba(184,56,60,0.92); border-color: rgba(255,255,255,0.25); }

/* section eyebrow */
.sec-eyebrow {
    font-family: var(--f-sans); font-size: 8pt; font-weight: 700; letter-spacing: 0.26em;
    text-transform: uppercase; color: var(--c-brick); margin: 22pt 0 1pt 0;
}

/* ── COVER (full-bleed navy authority field, logo-leads) ── */
.cover {
    position: relative;
    background: var(--c-navy);
    color: #eef1f5; margin: -0.55in -0.6in 0 -0.6in; padding: 0.62in 0.6in 0.5in;
    min-height: 10in;
}
.cover .cover-frame { position: absolute; inset: 0.26in; border: 1px solid rgba(255,255,255,0.16); pointer-events: none; }
.cover-top { display: flex; justify-content: space-between; align-items: flex-start; position: relative; z-index: 2; }
.cover-wordmark { font-family: var(--f-sans); font-weight: 800; font-size: 12pt; letter-spacing: 0.15em; color: #fff; }
.cover-wordmark .wm-sub { display: block; font-size: 6pt; letter-spacing: 0.32em; font-weight: 600; color: var(--c-brick-warm); text-transform: uppercase; margin-top: 4pt; }
.cover-tab {
    font-family: var(--f-sans); font-size: 7pt; font-weight: 700; letter-spacing: 0.24em; text-transform: uppercase;
    color: #fff; border: 1px solid rgba(255,255,255,0.3); padding: 5pt 11pt; border-radius: 2px;
}
/* knockout company-logo hero in a hairline ring */
.cover-logo-hero { position: relative; z-index: 2; margin-top: 0.5in; text-align: center; }
.cover-logo-hero .logo-ring {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 18pt 26pt; border: 1px solid rgba(255,255,255,0.24); border-radius: 4px;
    background: rgba(255,255,255,0.03);
}
.cover-logo-hero .logo-ring img { height: 84pt; width: auto; max-width: 320pt; object-fit: contain;
    filter: brightness(0) invert(1); }
.cover-logo-hero .logo-ring .logo-text-fallback {
    color: #fff; border-bottom-color: var(--c-brick-bright); font-family: var(--f-sans);
}
.cover-hero { position: relative; z-index: 2; margin-top: 0.45in; }
.cover-kicker { font-family: var(--f-sans); font-weight: 700; font-size: 8pt; letter-spacing: 0.38em; text-transform: uppercase; color: var(--c-brick-warm); margin-bottom: 14pt; }
.cover h1 { font-family: var(--f-serif); font-weight: 600; font-size: 40pt; line-height: 1.0; color: #fff; margin: 0; letter-spacing: -0.015em; border: 0; padding: 0; }
.cover .cover-subtitle { font-family: var(--f-serif); font-style: italic; font-weight: 300; font-size: 13pt; line-height: 1.45; color: #aeb9cb; margin-top: 18pt; max-width: 5.6in; border-left: 2px solid var(--c-brick-bright); padding-left: 16pt; }

.cover-meta { position: relative; z-index: 2; margin-top: 28pt; display: grid; grid-template-columns: 1fr 1fr 1fr; border-top: 1px solid rgba(255,255,255,0.16); }
.cover-meta .cell { padding: 13pt 16pt 11pt 0; border-right: 1px solid rgba(255,255,255,0.1); border-bottom: 1px solid rgba(255,255,255,0.1); }
.cover-meta .cell:nth-child(3n) { border-right: 0; }
.cover-meta .k { font-family: var(--f-sans); font-size: 6.5pt; letter-spacing: 0.24em; text-transform: uppercase; color: #8ea0bd; margin-bottom: 6pt; }
.cover-meta .v { font-size: 10pt; color: #eef1f5; line-height: 1.4; font-weight: 600; }
.cover-meta .v.serif { font-family: var(--f-serif); font-weight: 500; font-size: 12pt; }
.cover-meta .v.mono { font-family: var(--f-mono); font-weight: 600; font-size: 10.5pt; letter-spacing: 0.01em; }

.cover-foot { position: relative; z-index: 2; margin-top: 26pt; padding-top: 14pt; border-top: 1px solid rgba(255,255,255,0.16); display: flex; justify-content: space-between; align-items: flex-end; }
.cover-foot .prep .pl { font-family: var(--f-sans); font-size: 6.5pt; letter-spacing: 0.28em; text-transform: uppercase; color: #8ea0bd; margin-bottom: 5pt; }
.cover-foot .prep .pv { font-family: var(--f-serif); font-size: 13pt; color: #fff; }
/* credential logo row on the navy foot */
.cover-assoc-logos {
    display: flex; justify-content: flex-end; align-items: center; gap: 18pt;
    margin: 0; position: relative; z-index: 2;
}
.cover-assoc-logos img { height: 26pt; width: auto; opacity: 0.78; filter: grayscale(1) brightness(1.6); }

/* ── INTERIOR CHROME — .run-head (chain-of-custody masthead) ── */
.run-head { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 10pt; border-bottom: 2px solid var(--c-navy); margin-bottom: 6pt; }
.run-head .rh-mark { font-family: var(--f-sans); font-weight: 800; font-size: 11pt; letter-spacing: 0.12em; color: var(--c-navy); }
.run-head .rh-mark .rh-sub { display: block; font-family: var(--f-sans); font-weight: 600; font-size: 6pt; letter-spacing: 0.22em; text-transform: uppercase; color: var(--c-brick); margin-top: 3pt; }
.run-head .rh-r { text-align: right; }
.run-head .rh-r .rh-doc { font-family: var(--f-sans); font-size: 7pt; letter-spacing: 0.22em; text-transform: uppercase; color: var(--c-slate); font-weight: 700; }
.run-head .rh-r .rh-claim { font-family: var(--f-mono); font-size: 10pt; color: var(--c-navy); margin-top: 4pt; }

/* ── TOC (dotted leaders) ── */
.toc-item {
    display: flex; justify-content: space-between; padding: 6pt 0;
    border-bottom: 1px dotted var(--c-line); font-size: 10pt; color: var(--c-slate);
    font-family: var(--f-sans);
}

/* ── callout boxes (re-styled in Spectral) ── */
.success-box {
    background: var(--c-included-bg); border-left: 4px solid var(--c-included);
    padding: 11pt 15pt; margin: 11pt 0; border-radius: 3px; font-size: 9.5pt; color: var(--c-ink);
}
.success-box strong { color: var(--c-included); }
.critical-box {
    background: var(--c-omitted-bg); border-left: 4px solid var(--c-brick);
    padding: 11pt 15pt; margin: 11pt 0; border-radius: 3px; font-size: 9.5pt; color: var(--c-ink);
}
.critical-box strong { color: var(--c-brick); }
.highlight-box {
    background: var(--c-paper-warm); border-left: 4px solid var(--c-gold);
    padding: 11pt 15pt; margin: 11pt 0; border-radius: 3px; font-size: 9.5pt; color: var(--c-ink);
}
.highlight-box strong { color: var(--c-ink); }
.info-box {
    background: var(--c-paper-warm); border-left: 4px solid var(--c-navy);
    padding: 11pt 15pt; margin: 11pt 0; border-radius: 3px; font-size: 9.5pt; color: var(--c-ink);
}
.info-box strong { color: var(--c-navy); }
.info-box em { font-family: var(--f-serif); font-style: italic; color: var(--c-navy); }

/* ── media quote (corroborating reports) ── */
.media-quote {
    background: #fff; border: 1px solid var(--c-line); border-left: 3px solid var(--c-slate);
    padding: 11pt 15pt; margin: 11pt 0; border-radius: 3px; font-size: 9.5pt;
    font-family: var(--f-serif); font-style: italic; color: var(--c-slate); line-height: 1.55;
}
.media-quote .source {
    font-family: var(--f-mono); font-style: normal; font-weight: 600;
    color: var(--c-navy); font-size: 8pt; margin-top: 5pt;
}
.media-quote .source a { color: var(--c-navy); }

/* ── PHOTO EVIDENCE — .photo-grid / evidence plate ── */
.photo-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 10pt; margin: 12pt 0;
}
/* .photo-card kept (the forensic photo core) — re-styled as the
   evidence plate: brick top-keyline, warm-paper caption, no shadow. */
.photo-card {
    break-inside: avoid; page-break-inside: avoid;
    border: 1px solid var(--c-line); border-radius: 4px; overflow: hidden;
    background: #fff; border-top: 2px solid var(--c-brick);
}
.photo-card img { width: 100%; height: auto; display: block; }
.photo-card .caption {
    padding: 8pt 10pt; font-size: 8pt; color: var(--c-slate);
    background: var(--c-paper-warm); line-height: 1.4; font-family: var(--f-sans);
}
.photo-card .caption strong { color: var(--c-ink); }

/* ── DAMAGE DIFFERENTIATION / causation semantic cells ── */
.obs-yes, .concl-consistent { color: var(--c-included); font-weight: 700; }
.obs-no, .concl-inconsistent { color: var(--c-brick); font-weight: 700; }

/* ── code-compliance .code-card stack ── */
.code-card { border: 1px solid var(--c-line); border-radius: 4px; padding: 14pt 18pt; margin: 12pt 0; break-inside: avoid; background: #fff; }
.code-card.critical { border-left: 4px solid var(--c-brick); }
.code-card .cc-top { display: flex; align-items: center; gap: 10pt; margin-bottom: 7pt; flex-wrap: wrap; }
.code-card .code-title { font-family: var(--f-serif); font-size: 14pt; font-weight: 600; color: var(--c-navy); margin: 0; }
.code-card .requirement { font-size: 9.5pt; color: var(--c-ink); background: var(--c-paper-warm); padding: 9pt 13pt; border-radius: 3px; margin: 8pt 0; border-left: 3px solid var(--c-navy); line-height: 1.55; }
.code-card .supplement { font-size: 9pt; color: var(--c-slate); margin-top: 7pt; line-height: 1.5; }
.code-card .supplement b { color: var(--c-omitted); }

/* ── mfr-spec block ── */
.mfr-spec { background: var(--c-paper-warm); border: 1px solid var(--c-line); border-left: 3px solid var(--c-gold); border-radius: 3px; padding: 9pt 13pt; margin: 9pt 0; break-inside: avoid; }
.mfr-spec .mfr-name { font-family: var(--f-sans); font-weight: 700; font-size: 9pt; letter-spacing: 0.06em; text-transform: uppercase; color: var(--c-gold); }
.mfr-spec .warranty-void { color: var(--c-brick); font-weight: 700; font-size: 9.5pt; margin-top: 4pt; }

/* ── threshold-vs-age chart (Spectral idiom) ── */
.threshold-chart {
    border: 1px solid var(--c-line); border-radius: 4px; padding: 14pt; margin: 12pt 0;
    background: #fff; break-inside: avoid;
}
.threshold-chart .chart-title {
    font-family: var(--f-sans); font-size: 8.5pt; font-weight: 700; color: var(--c-navy);
    margin-bottom: 10pt; text-transform: uppercase; letter-spacing: 0.14em;
}
.threshold-chart .bar-row { display: flex; align-items: center; margin: 4pt 0; font-size: 9pt; }
.threshold-chart .bar-label { width: 70pt; font-weight: 600; color: var(--c-slate); }
.threshold-chart .bar-value { width: 50pt; font-family: var(--f-mono); font-weight: 600; color: var(--c-navy); text-align: right; padding-right: 8pt; }
.threshold-chart .bar-fill { height: 13pt; background: var(--c-navy); border-radius: 2px; }
.threshold-chart .bar-fill.property { background: var(--c-brick); }
.threshold-chart .property-indicator {
    margin-top: 10pt; padding: 8pt 12pt; background: var(--c-paper-warm);
    border: 1px solid var(--c-line); border-left: 3px solid var(--c-navy); border-radius: 3px;
    font-size: 9pt; color: var(--c-ink); font-weight: 600;
}
.threshold-chart .property-indicator strong { font-family: var(--f-mono); color: var(--c-navy); }
.threshold-chart .exceeds-line {
    margin-top: 8pt; padding: 8pt 12pt; background: var(--c-omitted-bg);
    border-left: 4px solid var(--c-brick); border-radius: 3px; font-size: 9.5pt;
    font-weight: 700; color: var(--c-brick);
}
.threshold-chart .exceeds-line strong { font-family: var(--f-mono); }

/* ── THE ONE SERIF-ON-NAVY CREDIBILITY CLIMAX ── */
.credibility-climax {
    background: var(--c-navy); border-top: 2px solid var(--c-brick);
    padding: 16pt 22pt; margin: 18pt 0; break-inside: avoid; text-align: left;
}
.credibility-climax .cc-label {
    font-family: var(--f-sans); font-size: 8pt; font-weight: 700; letter-spacing: 0.2em;
    text-transform: uppercase; color: var(--c-brick-warm); margin-bottom: 8pt;
}
.credibility-climax .cc-figure {
    font-family: var(--f-serif); font-weight: 600; font-size: 19pt; color: #fff; line-height: 1.1;
}
.credibility-climax .cc-sub { font-family: var(--f-sans); font-size: 9pt; color: #aeb9cb; margin-top: 7pt; line-height: 1.5; }

/* ── total / variance helpers ── */
.total-row td { font-weight: 700; background: var(--c-paper-warm) !important; border-top: 2px solid var(--c-navy); color: var(--c-ink); }
.grand-total td { font-weight: 700; font-size: 11pt; background: var(--c-navy) !important; color: #fff; }
.section-total td { font-weight: 700; background: var(--c-paper-warm) !important; border-top: 2px solid var(--c-navy); }
.variance-positive, .var-pos { color: var(--c-brick); font-weight: 700; }

/* ── footer signature ── */
.footer-sig { margin-top: 22pt; padding-top: 10pt; border-top: 1px solid var(--c-line); font-size: 10pt; color: var(--c-slate); }
.footer-sig .name { font-family: var(--f-serif); font-weight: 600; font-size: 13pt; color: var(--c-navy); }
.footer-sig .title { font-weight: 600; color: var(--c-slate); }

/* ── confidential footer ── */
.confidential { margin-top: 22pt; padding-top: 8pt; border-top: 1px solid var(--c-line-soft); font-size: 7pt; color: var(--c-mute); text-align: center; font-family: var(--f-sans); letter-spacing: 0.04em; }

/* ── integrity / authenticity seal (navy concentric rings) ── */
.integrity-seal-wrap { margin-top: 26pt; break-inside: avoid; text-align: center; }
.integrity-seal { display: inline-block; width: 210px; height: 210px; border-radius: 50%; position: relative; }
.integrity-seal .ring-outer { width: 210px; height: 210px; border-radius: 50%; border: 4px solid var(--c-navy); position: absolute; inset: 0; }
.integrity-seal.flagged .ring-outer { border-color: var(--c-brick); }
.integrity-seal .ring-inner { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 182px; height: 182px; border-radius: 50%; border: 2px solid var(--c-navy); display: flex; flex-direction: column; align-items: center; justify-content: center; }
.integrity-seal.flagged .ring-inner { border-color: var(--c-brick); }
.integrity-seal .seal-legend { font-family: var(--f-sans); font-size: 6pt; font-weight: 700; color: var(--c-navy); letter-spacing: 0.14em; text-transform: uppercase; }
.integrity-seal.flagged .seal-legend { color: var(--c-brick); }
.integrity-seal .seal-sub { font-family: var(--f-sans); font-size: 5.5pt; font-weight: 700; color: var(--c-navy); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 5pt; }
.integrity-seal.flagged .seal-sub { color: var(--c-brick); }
.integrity-seal .seal-rule { width: 46px; height: 2px; background: var(--c-brick); margin: 5pt 0; }
.integrity-seal .seal-score { font-family: var(--f-mono); font-size: 26pt; font-weight: 600; color: var(--c-navy); line-height: 1; }
.integrity-seal.flagged .seal-score { color: var(--c-brick); }
.integrity-seal .seal-status { font-family: var(--f-sans); font-size: 6pt; font-weight: 700; color: var(--c-navy); letter-spacing: 0.1em; text-transform: uppercase; margin-top: 4pt; }
.integrity-seal.flagged .seal-status { color: var(--c-brick); }
.integrity-seal .seal-result { font-family: var(--f-sans); font-size: 5.5pt; color: var(--c-mute); font-weight: 600; margin-top: 2pt; }
.integrity-seal .seal-attr { font-family: var(--f-sans); font-size: 5pt; color: var(--c-gold); letter-spacing: 0.14em; margin-top: 5pt; text-transform: uppercase; font-weight: 700; }

/* ── cert + disclaimer ── */
.cert-card { margin-top: 20pt; padding: 12pt 16pt; border: 1px solid var(--c-navy); border-radius: 4px; break-inside: avoid; font-size: 9.5pt; color: var(--c-ink); }
.cert-card strong { color: var(--c-navy); }
.uppa-disclaimer { margin-top: 12pt; padding: 10pt 14pt; background: var(--c-paper-warm); border-radius: 3px; font-size: 8pt; color: var(--c-slate); }
.uppa-disclaimer em { font-family: var(--f-serif); font-style: italic; }

/* ── lead callout (serif-italic carrier-contradiction line) ── */
.lead-callout {
    background: var(--c-paper-warm); border-left: 3px solid var(--c-brick);
    padding: 13pt 18pt; margin: 12pt 0; border-radius: 3px; break-inside: avoid;
}
.lead-callout .lc-label { font-family: var(--f-sans); font-size: 7pt; letter-spacing: 0.3em; text-transform: uppercase; color: var(--c-brick); font-weight: 700; margin-bottom: 7pt; }
.lead-callout p { font-family: var(--f-serif); font-style: italic; font-size: 11.5pt; line-height: 1.6; color: var(--c-ink); margin: 0; }
.lead-callout p b { font-style: normal; color: var(--c-navy); font-weight: 700; }

/* page break utility */
.page-break { page-break-after: always; }
"""


def _cite_chip(citation, *, neutral=False, on_navy=False):
    """Render a code / standard reference as the load-bearing .cite-chip
    anchor (mono, brick on paper) — never bold inline text. ``neutral`` =
    a non-code reference (HAAG, ASTM, NOAA, NWS); ``on_navy`` = placed on a
    dark band. Empty/blank citation renders nothing. The chip TEXT is the
    citation verbatim, so the stripped-text substance fingerprint (golden
    bridge) is preserved."""
    text = (citation or "").strip()
    if not text:
        return ""
    cls = "cite-chip"
    if neutral:
        cls += " neutral"
    if on_navy:
        cls += " on-navy"
    return f'<span class="{cls}">{text}</span>'


# ── Doc-01 Spectral variants of the shared seal/cert/disclaimer blocks ──
# These emit Spectral-token markup (class-driven, no inline hex) and are used
# ONLY by the forensic report. The shared _build_integrity_stamp /
# _build_contractor_cert / _build_uppa_disclaimer are left UNTOUCHED so Docs
# 02–05 (which still use CSS_COMMON) stay byte-identical. Content (score,
# status text, cert/disclaimer prose) is preserved verbatim.

def _build_integrity_stamp_spectral(config):
    """Spectral authenticity seal — the ONE serif/mono-on-navy credibility
    climax of Doc 01. Navy concentric rings (brick if a photo is flagged), a
    large mono score, gold DUMBROOF.AI attribution. Same content/score as the
    shared stamp; only the chrome is re-skinned via .integrity-seal tokens."""
    integrity = config.get("photo_integrity")
    if not integrity or not integrity.get("total_analyzed"):
        return ""
    total = integrity["total_analyzed"]
    flagged = integrity["flagged"]
    score = integrity["score"]

    if flagged == 0:
        flagged_cls = ""
        status_line = "NO MANIPULATED PHOTOS FOUND"
        result_text = f"All {total} photos verified authentic"
    else:
        flagged_cls = " flagged"
        status_line = f"{flagged} PHOTO(S) FLAGGED FOR REVIEW"
        result_text = f"{flagged} of {total} photos require review"

    return f'''
<div class="integrity-seal-wrap">
  <div class="integrity-seal{flagged_cls}">
    <div class="ring-outer"></div>
    <div class="ring-inner">
      <div class="seal-legend">MAN-MADE DAMAGE &amp; MANIPULATION</div>
      <div class="seal-sub">IP DETECTION TECHNOLOGY</div>
      <div class="seal-rule"></div>
      <div class="seal-score">{score}</div>
      <div class="seal-rule"></div>
      <div class="seal-status">{status_line}</div>
      <div class="seal-result">{result_text}</div>
      <div class="seal-attr">DUMBROOF.AI</div>
    </div>
  </div>
</div>'''


def _build_contractor_cert_spectral(config):
    """Spectral contractor certification card (Doc 01 only). Same gated
    content + name-hygiene guards as the shared helper; .cert-card chrome."""
    lang = get_language(config)
    if not lang["contractor_cert"]:
        return ""
    compliance = config.get("compliance", {})
    inspectors_cfg = config.get("inspectors", {})
    company = config["company"]
    name = inspectors_cfg.get("usarm_inspector", company["ceo_name"])
    if any(w in name.lower() for w in ["dumb roof", "ai analysis", "automated", "bot"]):
        name = company["ceo_name"]
    if not name or any(w in name.lower() for w in ["dumb roof", "ai analysis", "automated", "bot"]):
        name = company.get("name", "Contractor")
    license_num = compliance.get("license_number", "")
    license_text = f" ({license_num})" if license_num else ""
    return f'''
<div class="cert-card">
<p style="margin:0;"><strong>Contractor Certification:</strong> I, {name}, a licensed roofing contractor{license_text}, certify that this report reflects my professional assessment of the scope required to restore this property to a complete, code-compliant condition.</p>
</div>'''


def _build_uppa_disclaimer_spectral(config):
    """Spectral UPPA disclaimer (Doc 01 only). Same gated content as the
    shared helper; .uppa-disclaimer chrome (slate italic on warm paper)."""
    lang = get_language(config)
    if not lang.get("disclaimer"):
        return ""
    company = config["company"]
    text = lang["disclaimer"].format(company=company["name"])
    return f'''
<div class="uppa-disclaimer">
<p style="margin:0;"><em>{text}</em></p>
</div>'''


# ===================================================================
# DOCUMENT 1: FORENSIC CAUSATION REPORT
# ===================================================================

def _build_integrity_stamp(config):
    """Build engineer-style seal/stamp for photo manipulation detection IP."""
    integrity = config.get("photo_integrity")
    if not integrity or not integrity.get("total_analyzed"):
        return ""
    total = integrity["total_analyzed"]
    flagged = integrity["flagged"]
    score = integrity["score"]

    if flagged == 0:
        ring_color = "#0d2137"
        status_line = "NO MANIPULATED PHOTOS FOUND"
        result_text = f"All {total} photos verified authentic"
    else:
        ring_color = "#c8102e"
        status_line = f"{flagged} PHOTO(S) FLAGGED FOR REVIEW"
        result_text = f"{flagged} of {total} photos require review"

    return f'''
<div style="margin-top:30px; break-inside:avoid; text-align:center;">
  <div style="display:inline-block; width:220px; height:220px; border-radius:50%; border:4px solid {ring_color}; position:relative; text-align:center; padding:0;">
    <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:190px;">
      <div style="border-radius:50%; border:2px solid {ring_color}; width:190px; height:190px; display:flex; flex-direction:column; align-items:center; justify-content:center;">
        <div style="font-size:6.5pt; font-weight:800; color:{ring_color}; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:2px;">MAN-MADE DAMAGE &amp; MANIPULATION</div>
        <div style="font-size:5.5pt; font-weight:700; color:{ring_color}; letter-spacing:1.2px; text-transform:uppercase; margin-bottom:6px;">IP DETECTION TECHNOLOGY</div>
        <div style="width:50px; height:2px; background:{ring_color}; margin-bottom:6px;"></div>
        <div style="font-size:20pt; font-weight:900; color:{ring_color}; line-height:1; margin-bottom:4px;">{score}</div>
        <div style="width:50px; height:2px; background:{ring_color}; margin-top:4px; margin-bottom:6px;"></div>
        <div style="font-size:6pt; font-weight:800; color:{ring_color}; letter-spacing:0.8px; text-transform:uppercase; margin-bottom:3px;">{status_line}</div>
        <div style="font-size:5.5pt; color:#6b7280; font-weight:600;">{result_text}</div>
        <div style="font-size:5pt; color:#9ca3af; margin-top:4px; letter-spacing:0.5px;">DUMBROOF.AI</div>
      </div>
    </div>
  </div>
</div>'''


def _build_executive_summary(findings):
    """Build structured executive summary from paragraphs or fallback to damage_summary."""
    paragraphs = findings.get("executive_summary", [])
    if paragraphs and isinstance(paragraphs, list):
        html = ""
        for p in paragraphs:
            html += f"<p>{p}</p>\n"
        return html
    # Fallback: old behavior — single paragraph
    summary = findings.get("damage_summary", "")
    if not summary:
        return ""
    # Try to break long text into paragraphs at sentence boundaries
    sentences = summary.replace(". ", ".|").split("|")
    if len(sentences) <= 4:
        return f"<p>{summary}</p>"
    chunk_size = len(sentences) // 3
    paras = []
    for i in range(0, len(sentences), max(chunk_size, 2)):
        chunk = " ".join(sentences[i:i + max(chunk_size, 2)]).strip()
        if chunk:
            paras.append(f"<p>{chunk}</p>")
    return "\n".join(paras)


def _build_causation_criteria(config):
    """Build material-specific causation analysis and damage criteria."""
    # Detect material from structures config
    structures = config.get("structures", [{}])
    shingle_type = structures[0].get("shingle_type", "").lower() if structures else ""
    user_notes = config.get("user_notes", "").lower()
    combined = f"{shingle_type} {user_notes}"

    # WS-2: when the canonical enum is present, branch on it directly.
    # 3tab/laminate/other all map to the asphalt-composition default below.
    _enum = material_enum(config, structures[0] if structures else None)
    if _enum == "slate":
        combined = "slate"
    elif _enum == "tile":
        combined = "tile"
    elif _enum == "metal":
        combined = "metal roof"
    elif _enum in ("3tab", "laminate", "other"):
        combined = ""  # force the asphalt-composition default branch
    # _enum is None (legacy/absent) → leave `combined` as the substring blend.

    if "slate" in combined:
        return '''<p>Per HAAG Engineering criteria and the NRCA Slate Roofing Manual, hail and wind damage to natural slate roofing is identified by:</p>
<ul>
    <li>Through-fractures, corner breaks, or crack propagation from impact sites</li>
    <li>Displacement or dislodgement of slates from coursing due to wind uplift</li>
    <li>Surface spalling or delamination accelerated by impact stress on aged slate</li>
    <li>Collateral hail damage to soft metals — copper gutters, lead/copper valley flashing, apron flashing (confirmed by chalk testing)</li>
    <li>Random distribution of impact damage across all roof exposures</li>
</ul>
<p>Per ASTM C406 (Standard Specification for Roofing Slate) and IRC R905.6, when natural slate has sustained fracture, displacement, or surface compromise from a storm event, individual unit replacement is often infeasible due to: (a) inability to match weathered color, thickness, and texture of aged slate, (b) risk of cascading breakage when accessing brittle adjacent units, and (c) degraded fastening substrate that cannot accept new mechanical attachment without full system disturbance.</p>'''

    elif "tile" in combined or "clay" in combined or "concrete tile" in combined:
        return '''<p>Per HAAG Engineering criteria, hail and wind damage to tile roofing is identified by:</p>
<ul>
    <li>Fractures, cracks, or chips from hail impact at impact sites</li>
    <li>Displacement or dislodgement of tiles from battens due to wind uplift</li>
    <li>Broken or cracked tile edges from hail or wind-borne debris</li>
    <li>Collateral damage to soft metals — valleys, flashings, vents (confirmed by chalk testing)</li>
    <li>Random distribution pattern across multiple roof exposures</li>
</ul>
<p>Per IRC R905.3 and manufacturer specifications, damaged tile units must be replaced with matching products. When replacement tiles are unavailable or cannot match the existing weathered profile, full system replacement is the code-compliant remediation.</p>'''

    elif "standing seam" in combined or "metal roof" in combined:
        return '''<p>Per HAAG Engineering criteria, hail damage to standing seam metal roofing is identified by:</p>
<ul>
    <li>Panel denting or deformation visible at low-angle light inspection</li>
    <li>Chalk testing reveals circular gaps in chalk line at impact dent locations</li>
    <li>Paint/coating fracture at impact sites exposing bare metal to corrosion</li>
    <li>Seam deformation compromising weather-tightness of standing seam joints</li>
    <li>Random distribution of impacts across all exposures</li>
</ul>
<p>Per ASTM E1514 and manufacturer warranty requirements, dented metal panels with compromised coatings have sustained functional damage. Spot repair of standing seam panels is not structurally feasible — panel replacement requires full-length removal due to the interlocking seam system.</p>'''

    else:
        # Default: asphalt shingles (laminated or 3-tab)
        return '''<p>Per HAAG Engineering criteria, hail damage to asphalt shingles is identified by:</p>
<ul>
    <li>Circular indentations with granule displacement</li>
    <li>Mat fracture or bruising beneath impact site</li>
    <li>Random distribution pattern across roof field</li>
    <li>Damage on all roof exposures/slopes</li>
    <li>Collateral damage to soft metals (vents, flashing, gutters)</li>
</ul>
<p>Per ASTM D3462 and ARMA Technical Bulletin, when granule loss exposes the underlying mat, the shingle has sustained functional damage that accelerates deterioration and voids manufacturer warranty coverage.</p>'''


def _build_repairability_section(config):
    """Build Method of Repair Analysis section — the strategic 'unrepairable' argument.

    Documents measured exposure, product identification, and why spot repair
    is not feasible when shingle dimensions don't match current production.
    Returns (html, has_content) tuple.
    """
    scoring = config.get("scoring", {})
    findings = config.get("forensic_findings", {})
    repairability = findings.get("repairability", {})
    photo_analysis = scoring.get("photo_analysis", {})
    product_intel = scoring.get("product_intelligence", {})
    structures = config.get("structures", [{}])
    shingle_type_raw = structures[0].get("shingle_type", "") if structures else ""
    shingle_type = shingle_type_raw.lower()
    _enum = material_enum(config, structures[0] if structures else None)

    # Skip for non-shingle roofs unless repairability data explicitly provided
    if not repairability:
        if _enum is not None:
            # Canonical: only 3tab/laminate are asphalt shingles; everything
            # else (slate/tile/metal/other-incl-flat) is non-shingle.
            non_shingle = _enum not in ("3tab", "laminate")
        else:
            non_shingle = any(kw in shingle_type for kw in ["slate", "tile", "metal", "standing seam", "epdm", "tpo", "pvc"])
        if non_shingle:
            return "", False

    # Gather exposure data from all sources
    measured_exposure = repairability.get("measured_exposure_inches")
    if not measured_exposure:
        measured_exposure = photo_analysis.get("exposure_inches_estimate")
    if not measured_exposure:
        measured_exposure = photo_analysis.get("exposure_guess")
    if not measured_exposure and product_intel:
        measured_exposure = product_intel.get("exposure_inches")

    # Determine shingle category
    if _enum is not None:
        is_three_tab = _enum == "3tab"
        is_laminate = _enum == "laminate"
    else:
        is_three_tab = "3-tab" in shingle_type or "three-tab" in shingle_type or "three tab" in shingle_type
        is_laminate = "architectural" in shingle_type or "laminate" in shingle_type or "dimensional" in shingle_type
        if not is_three_tab and not is_laminate:
            pa_type = photo_analysis.get("shingle_type", "")
            if pa_type == "three_tab":
                is_three_tab = True
            elif pa_type in ("architectural", "laminate"):
                is_laminate = True

    # If we still can't determine type and have no exposure data, skip
    if not measured_exposure and not is_three_tab and not is_laminate and not repairability:
        return "", False

    # Build the section
    html = ""

    # Exposure measurement subsection
    exposure_value = float(measured_exposure) if measured_exposure else None
    is_old_exposure = exposure_value is not None and exposure_value <= 5.25  # 5" or 5-1/8"
    is_metric = exposure_value is not None and 5.5 <= exposure_value <= 5.75
    is_iko_advantage = exposure_value is not None and 5.75 < exposure_value <= 6.0

    product_type_label = "three-tab" if is_three_tab else "laminate/architectural" if is_laminate else "asphalt"
    mfr = product_intel.get("manufacturer", photo_analysis.get("manufacturer_guess", ""))
    product_name = product_intel.get("product_line", photo_analysis.get("product_line_guess", ""))

    # Product identification paragraph
    if mfr or product_name or is_three_tab or is_laminate:
        id_parts = []
        if mfr and product_name:
            _co_name = config.get("company", {}).get("name", "our")
            id_parts.append(f"Based on visual characteristics observed during the {_co_name} field inspection, the existing roof system appears to be a <strong>{mfr} {product_name}</strong> {product_type_label} shingle")
        elif is_three_tab:
            id_parts.append(f"The existing roof system consists of <strong>three-tab asphalt shingles</strong>")
        elif is_laminate:
            id_parts.append(f"The existing roof system consists of <strong>laminate (architectural) asphalt shingles</strong>")
        else:
            id_parts.append(f"The existing roof system consists of <strong>asphalt composition shingles</strong>")

        age = photo_analysis.get("estimated_age")
        if not age:
            age_est, _ = _estimate_roof_age(config)
            age = age_est
        if age:
            id_parts.append(f", estimated to be approximately {age} years old based on granule coverage, color oxidation, and physical condition")

        html += f"<p>{''.join(id_parts)}.</p>\n"

    # Exposure measurement paragraph
    if exposure_value:
        html += f"""<p><strong>Shingle Exposure Measurement:</strong> Field measurement of the existing shingle exposure
revealed a <strong>{exposure_value}-inch</strong> exposure."""

        if is_old_exposure:
            if is_three_tab:
                html += f""" This measurement is consistent with pre-metric standard-size three-tab shingles
manufactured prior to the industry's transition to metric dimensions. The standard three-tab shingle measured
36 inches long by 12 inches wide with a 5-inch exposure. All three-tab shingles currently manufactured utilize
metric dimensions measuring approximately 39-3/8 inches long by 13-1/4 inches wide with a 5-5/8-inch exposure.</p>\n"""
            else:
                html += f""" This measurement is consistent with pre-metric standard-size laminate/architectural shingles
manufactured prior to the industry's dimensional transition. Standard-size laminate shingles measured 36 inches long
by 12 inches wide with a 5-inch exposure and 80 shingles per square. All laminate shingles currently manufactured
utilize metric dimensions measuring approximately 39-3/8 inches by 13-1/4 inches with a 5-5/8-inch exposure
and approximately 64 shingles per square. TAMKO was the last manufacturer to produce 5-inch exposure laminate
shingles, discontinuing production circa 2012.</p>\n"""
        elif is_iko_advantage:
            html += f""" This measurement is consistent with IKO's proprietary "Advantage" size shingles
(Cambridge, Nordic, or Dynasty series), which measure 40-7/8 inches by 13-3/4 inches with a 5-7/8-inch exposure.
This dimension is unique to IKO and is incompatible with all other manufacturers' products.</p>\n"""
        else:
            html += f""" This is consistent with current metric-standard shingle dimensions.</p>\n"""

    # Repairability determination — the knockout section
    if is_old_exposure:
        html += """<h3>Repairability Determination</h3>\n"""

        html += f"""<p>No manufacturer currently produces {product_type_label} shingles with a {exposure_value}-inch exposure.
Repair-in-kind using current metric-dimension shingles ({'"5-5/8"' if not is_iko_advantage else '"5-7/8"'}-inch exposure)
is <strong>not a viable method of repair</strong> for the following documented reasons:</p>\n"""

        html += """<table>
    <tr><th style="width:30%">Incompatibility Factor</th><th>Technical Detail</th></tr>
    <tr>
        <td><strong>Nailing Zone Misalignment</strong></td>
        <td>The common bond area where fasteners must be placed is positioned differently on standard-size (5&quot;) versus
metric-size (5-5/8&quot;) shingles. GAF publishes separate nail placement technical details for each size
(SS-TS-03 for standard, SS-TS-03a for metric), confirming the nailing patterns are dimensionally incompatible.
Nails placed in the correct zone of the replacement shingle will miss the correct zone of the underlying existing shingle.</td>
    </tr>
    <tr>
        <td><strong>Sealant Strip Displacement</strong></td>
        <td>Self-sealing adhesive strips are factory-positioned for the manufacturer&rsquo;s specified exposure.
When installed at a non-standard exposure, the sealant line of the overlapping shingle does not contact the sealant
strip of the shingle below, compromising wind uplift resistance.</td>
    </tr>
    <tr>
        <td><strong>Compounding Course Line Error</strong></td>
        <td>A 5/8-inch difference per course compounds across the roof slope. Over 20 courses, this produces
a <strong>12-1/2-inch cumulative offset</strong> &mdash; more than an entire course of misalignment. This creates visible
waviness, misaligned cutout patterns, and an aesthetically unacceptable result that does not restore the property
to its pre-loss condition.</td>
    </tr>
    <tr>
        <td><strong>Manufacturer Prohibition</strong></td>
        <td>Every manufacturer&rsquo;s installation instructions specify a single, precise exposure measurement.
Installing at any other exposure violates the manufacturer&rsquo;s instructions and voids the product warranty.
CertainTeed&rsquo;s installation guide warns that incorrect exposure &ldquo;affects the aesthetics, wind performance,
and seal strength of the roof.&rdquo; IKO warns that mixing different exposure shingles &ldquo;creates uneven surfaces
that may cause deformation and compromise sealing capability.&rdquo;</td>
    </tr>
    <tr>
        <td><strong>Field Cutting Is Not a Solution</strong></td>
        <td>Shingles are wind-tested and fire-rated as manufactured, not as field-cut. Cutting exposes the fiberglass mat
at the cut edge, creating a point of accelerated weathering. No manufacturer warrants field-modified shingles.
Critically, cutting does not resolve the nailing zone incompatibility &mdash; the nailing zone position relative to
the laminate layers is fixed at the factory regardless of any field trimming.</td>
    </tr>
</table>\n"""

        html += """<div class="info-box">
<strong>Independent Research:</strong> Haag Engineering &mdash; the roofing industry&rsquo;s most widely recognized
independent forensic testing laboratory &mdash; published a dedicated study in May 2024 titled
<em>&ldquo;Repairing an Existing 36-inch Laminated Asphalt Shingle with Metric-Sized Laminated Asphalt Shingles.&rdquo;</em>
The study specifically examined whether a reliable repair can be made using larger modern-day shingles on an older
standard-size roof and identified significant concerns including &ldquo;mismatched nailing patterns, misalignments,
aesthetic issues, exposed nails and unsightly overlaps&rdquo; with potential impacts on &ldquo;roof leaks or
diminished wind resistance.&rdquo;
</div>\n"""

        # Discontinuation status if available
        status = product_intel.get("status", "")
        disc_year = product_intel.get("discontinuation_year")
        if status == "discontinued" and disc_year:
            html += f"""<p>Furthermore, the identified product was discontinued in {disc_year}.
Even setting aside the dimensional incompatibility, no replacement shingles of the same product line are available
from the manufacturer. This product cannot be obtained through any current supply channel.</p>\n"""
        elif is_three_tab:
            html += """<p>Furthermore, all major manufacturers have discontinued their three-tab shingle product lines.
GAF discontinued its Royal Sovereign (the last major-brand three-tab) in 2023. CertainTeed discontinued XT25/XT30 in 2019.
No three-tab shingle of any exposure dimension is currently in widespread production,
making repair-in-kind with a matching product type impossible regardless of the dimensional mismatch.</p>\n"""

        html += f"""<p><strong>Conclusion:</strong> As repair-in-kind is not feasible due to product unavailability
and dimensional incompatibility between the existing {exposure_value}-inch exposure shingles and the current
5-5/8-inch metric standard, <strong>full replacement of the roof system</strong> is the only method of repair that
restores the property to its pre-loss condition in compliance with manufacturer installation requirements,
applicable building codes, and the policy obligation to provide materials of like kind and quality.</p>\n"""

    elif is_iko_advantage and not is_old_exposure:
        # IKO Advantage — can only be repaired with IKO products
        html += """<h3>Repairability Determination</h3>\n"""
        html += """<p>The existing IKO Advantage-size shingles (5-7/8-inch exposure) cannot be repaired using
shingles from any other manufacturer. All non-IKO manufacturers produce shingles at the industry-standard
5-5/8-inch metric exposure. The 1/4-inch exposure difference per course compounds to significant misalignment
across the roof slope and creates the same nailing zone, sealant strip, and course line incompatibilities
documented above. Repair must utilize current IKO Advantage-size products exclusively.</p>\n"""

    elif repairability.get("determination") == "unrepairable":
        # Custom repairability determination from config
        html += """<h3>Repairability Determination</h3>\n"""
        reasons = repairability.get("reasons", [])
        if reasons:
            html += "<p>Repair-in-kind is not a viable method of repair for the following reasons:</p>\n<ul>\n"
            for r in reasons:
                html += f"<li>{r}</li>\n"
            html += "</ul>\n"
        custom_conclusion = repairability.get("conclusion", "")
        if custom_conclusion:
            html += f"<p>{custom_conclusion}</p>\n"

    return html, bool(html)


def _build_conclusion_section(findings, arguments_html, conclusion_html, rec_scope_html):
    """Build structured conclusion from paragraphs or fallback to old behavior."""
    paragraphs = findings.get("conclusion_paragraphs", [])

    html = ""
    if paragraphs and isinstance(paragraphs, list):
        # Structured paragraphs — gracefully flowing conclusion
        for p in paragraphs:
            html += f"<p>{p}</p>\n"
    else:
        # Fallback: old behavior
        conclusion_text = findings.get("conclusion", findings.get("damage_summary", ""))
        if conclusion_text:
            html += f'<div class="success-box"><strong>Professional Conclusion:</strong> {conclusion_text}</div>\n'

    # Add existing conclusion findings and recommended scope if present
    if conclusion_html:
        html += conclusion_html
    if rec_scope_html:
        html += rec_scope_html

    # Key evidence summary
    if arguments_html:
        html += "<p><strong>Key Evidence Summary:</strong></p>\n<ul>\n"
        html += arguments_html
        html += "</ul>\n"

    return html


def _build_threshold_aging_chart(config):
    """Build hail damage threshold vs product age visualization.

    Shows how damage thresholds decrease with shingle age, using
    research-backed data from HAAG, Koontz/White, and IBHS.
    Pins the property's age and confirmed hail size on the chart.
    """
    # Get property age from multiple sources
    scoring = config.get("scoring", {})
    photo_analysis = scoring.get("photo_analysis", {})
    structures = config.get("structures", [{}])
    weather = config.get("weather", {})
    noaa = weather.get("noaa", {})

    age = photo_analysis.get("estimated_age")
    if not age and structures:
        age = structures[0].get("age")
    if not age:
        # Structured age estimation fallback
        estimated, _reasoning = _estimate_roof_age(config)
        if estimated:
            age = estimated
        else:
            return ""

    try:
        age = int(age)
    except (TypeError, ValueError):
        return ""

    # Get confirmed hail size
    max_hail = noaa.get("max_hail_inches", 0)
    if not max_hail:
        # Try from weather damage_thresholds
        thresholds = weather.get("damage_thresholds") or config.get("forensic_findings", {}).get("damage_thresholds", [])
        for dt in (thresholds or []):
            confirmed = dt.get("confirmed_size", dt.get("storm_actual", ""))
            if isinstance(confirmed, str):
                # Anchor on a real decimal/whole-number hail measurement; a bare
                # "." or other junk must not crash float() or latch a garbage size.
                match = re.search(r'(\d+(?:\.\d+)?|\.\d+)', confirmed)
                if match:
                    try:
                        parsed = float(match.group(1))
                    except ValueError:
                        continue
                    if parsed > 0:
                        max_hail = parsed
                        break
            elif isinstance(confirmed, (int, float)):
                if confirmed > 0:
                    max_hail = float(confirmed)
                    break

    # Guard: a non-positive (zero / unparsed / garbage-latched) confirmed-hail
    # value must NOT render the chart at all — and in particular must never fire
    # an "EXCEEDS THRESHOLD" callout (the regex above could previously latch a
    # stray digit and assert EXCEEDS on a hail-free claim). See WS-4 / E270 guard.
    try:
        max_hail = float(max_hail)
    except (TypeError, ValueError):
        return ""
    if max_hail <= 0:
        return ""

    # Interpolate threshold based on age
    # New (0 yr) = 1.00", 15+ yr = 0.75" (linear interpolation, capped)
    new_threshold = 1.00
    aged_threshold = 0.75
    max_age = 15
    clamped_age = min(age, max_age)
    property_threshold = round(new_threshold - (new_threshold - aged_threshold) * (clamped_age / max_age), 3)

    # EXCEEDS only when there is a genuinely positive confirmed hail size that
    # meets/beats the age-adjusted threshold (never on a zero/garbage value).
    exceeds = max_hail > 0 and max_hail >= property_threshold
    exceeds_text = "EXCEEDS THRESHOLD" if exceeds else "Below threshold"
    exceeds_color = "#c8102e" if exceeds else "#2e7d32"

    # Build visual bars (percentage of max = 1.00")
    def bar_width(threshold_val):
        return int((threshold_val / 1.10) * 100)  # Scale to percentage

    age_data = [
        ("New", "1.00\"", 1.00),
        ("5 years", "~0.95\"", 0.95),
        ("10 years", "~0.875\"", 0.875),
        ("15+ years", "0.75\"", 0.75),
    ]

    bar_rows = ""
    for label, display, val in age_data:
        bar_rows += f'''<div class="bar-row">
    <div class="bar-label">{label}</div>
    <div class="bar-value">{display}</div>
    <div style="flex:1;"><div class="bar-fill" style="width:{bar_width(val)}%;"></div></div>
</div>\n'''

    html = f'''<div class="threshold-chart">
<div class="chart-title">Hail Damage Threshold vs. Product Age &mdash; Asphalt Composition Shingles</div>
{bar_rows}
<div class="property-indicator">
    &#9650; THIS PROPERTY: ~{age} years old &rarr; threshold = <strong>{property_threshold:.2f}&quot;</strong>
</div>
<div class="exceeds-line">
    Confirmed storm hail: <strong>{max_hail}&quot;</strong> &mdash; <span style="color:{exceeds_color};">{exceeds_text}</span>
</div>
<table style="font-size:8pt;color:#6b7280;margin-top:10pt;border:none;">
    <tr style="border:none;"><td style="border:none;padding:2pt 6pt;"><strong>Sources:</strong></td><td style="border:none;padding:2pt 6pt;">New threshold (1.00&quot;): HAAG Engineering &mdash; functional mat fracture threshold</td></tr>
    <tr style="border:none;"><td style="border:none;padding:2pt 6pt;"></td><td style="border:none;padding:2pt 6pt;">Aged threshold (0.75&quot;): Koontz/White Research &mdash; 3 of 5 aged specimens fractured at 1&quot;</td></tr>
    <tr style="border:none;"><td style="border:none;padding:2pt 6pt;"></td><td style="border:none;padding:2pt 6pt;">Aging acceleration: IBHS Sub-Severe Hail Study (2025) &mdash; decade of aging in 2 years from repeated sub-severe impacts</td></tr>
    <tr style="border:none;"><td style="border:none;padding:2pt 6pt;"></td><td style="border:none;padding:2pt 6pt;">Additional: ARMA Technical Bulletin, FM Global Data Sheet 1-34</td></tr>
</table>
</div>\n'''

    return html


def _build_wind_amplification_chart(config):
    """Build ASCE 7 wind velocity amplification visualization.

    Shows how ground-level wind speed (NOAA measurement) amplifies at the
    roof surface due to building geometry (Bernoulli effect). Parallels the
    hail threshold aging chart in structure and styling.

    Inputs:
        weather.noaa.max_wind_mph — NOAA ground-level wind speed
        estimate_request.roof_material — maps to ASTM wind rating
        estimate_request.damage_type — "wind" or "combined" triggers this chart

    Returns empty string if no wind data or if damage_type is hail-only.
    """
    weather = config.get("weather", {})
    noaa = weather.get("noaa", {})
    estimate_req = config.get("estimate_request", {}) or {}

    max_wind = noaa.get("max_wind_mph", 0)
    if not max_wind or max_wind <= 0:
        return ""

    # M3 fix: skip chart for trivially low wind speeds where the amplification
    # argument has no forensic value (Zone 3 still far below shingle rating).
    # 40 mph sustained is the practical floor for any wind damage claim.
    if max_wind < 40:
        return ""

    # Only show for wind or combined claims. If damage_type isn't set, show
    # whenever we have wind data (the AI may have detected wind damage).
    damage_type = estimate_req.get("damage_type", "")
    if damage_type == "hail":
        return ""  # Hail-only claim — skip the wind chart

    # Map roof material to ASTM wind rating (mph)
    roof_material = (estimate_req.get("roof_material", "") or "").lower()
    structures = config.get("structures", [{}])
    _enum = material_enum(config, structures[0] if structures else None)
    # "premium"/"impact" is a sub-grade the enum intentionally does NOT carry
    # (premium laminate is still 'laminate'); preserve that upgraded rating by
    # checking the raw request string independently of material family.
    _premium = "premium" in roof_material or "impact" in roof_material
    if _enum is not None:
        if _enum == "3tab":
            shingle_rating = 60
            rating_label = "ASTM D3161 Class A (60 mph)"
        elif _enum == "metal":
            shingle_rating = 140
            rating_label = "FM rated (est. 140 mph)"
        elif _enum in ("slate", "tile"):
            shingle_rating = 125
            rating_label = "Wind-resistant (est. 125 mph)"
        elif _premium:
            shingle_rating = 130
            rating_label = "ASTM D7158 Class H (130 mph)"
        else:
            # laminate / other → standard architectural/laminate shingle
            shingle_rating = 110
            rating_label = "ASTM D7158 Class G (110 mph)"
    elif "3-tab" in roof_material:
        shingle_rating = 60
        rating_label = "ASTM D3161 Class A (60 mph)"
    elif _premium:
        shingle_rating = 130
        rating_label = "ASTM D7158 Class H (130 mph)"
    elif "metal" in roof_material or "standing seam" in roof_material:
        shingle_rating = 140
        rating_label = "FM rated (est. 140 mph)"
    elif "slate" in roof_material or "tile" in roof_material:
        shingle_rating = 125
        rating_label = "Wind-resistant (est. 125 mph)"
    else:
        # Default: standard architectural/laminate shingle
        shingle_rating = 110
        rating_label = "ASTM D7158 Class G (110 mph)"

    # --- E270 fix: zone factors are PRESSURE coefficients, not velocity multipliers.
    #
    # ASCE 7 roof-zone amplification factors {1.35, 1.6, 2.0} are external-pressure
    # ratios (GCp), and dynamic pressure q ∝ V². A zone whose pressure is R× the
    # field pressure therefore corresponds to an EQUIVALENT VELOCITY of √R× the
    # base wind, NOT R×. (√1.35≈1.16, √1.6≈1.26, √2.0≈1.41.) The previous code
    # multiplied velocity by the pressure ratio, producing physically impossible
    # 174–250 mph "wind speeds" at a standing house that a reviewing engineer can
    # attack. See E270 / WS-4.
    #
    # The base wind itself: NOAA Storm Events DB and SPC report wind MAGNITUDE as
    # peak/estimated GUST (3-second), which is already the same kind of quantity
    # ASCE 7 calls the basic wind speed V (a 3-sec gust at strength level). So we
    # do NOT apply a second sustained→gust ×1.3 — base_gust = the NOAA value as-is.
    import math

    base_gust = max_wind  # NOAA wind MAGNITUDE is already a 3-sec gust

    # Physically defensible upper bound for a residential roof-zone equivalent
    # velocity. The highest ASCE 7 special-wind-region basic gust is ~200 mph
    # (V_ult); we never display above that regardless of input.
    VELOCITY_CAP_MPH = 200

    def _equiv_velocity(pressure_ratio):
        return min(round(base_gust * math.sqrt(pressure_ratio)), VELOCITY_CAP_MPH)

    # Base-gust display: the literal NOAA value (kept as-recorded so the cited
    # ground figure is verifiable), but still bounded by the physical cap.
    base_gust_display = min(base_gust, VELOCITY_CAP_MPH)

    # (label, displayed pressure ratio, equivalent velocity mph). Zone rows now
    # carry the pressure ratio (what ASCE 7 actually defines) and the derived
    # equivalent velocity for an apples-to-apples comparison vs the ASTM rating.
    zone_multipliers = [
        ("Ground / Base Gust (NOAA)", 1.0, base_gust_display),
        ("Zone 1 — Field", 1.35, _equiv_velocity(1.35)),
        ("Zone 2 — Edge", 1.6, _equiv_velocity(1.6)),
        ("Zone 3 — Corner", 2.0, _equiv_velocity(2.0)),
    ]

    # Determine max velocity for scaling bars
    max_vel = max(v for _, _, v in zone_multipliers)
    max_vel = max(max_vel, shingle_rating)
    scale_max = max_vel * 1.15  # Add 15% headroom for the bar chart

    def bar_width(vel):
        return int((vel / scale_max) * 100)

    # Build bar rows with color coding
    bar_rows = ""
    for label, mult, vel in zone_multipliers:
        if vel > shingle_rating:
            bar_color = "#c8102e"  # Red — exceeds rating
            status = "EXCEEDS"
        elif vel > shingle_rating * 0.9:
            bar_color = "#f59e0b"  # Amber — marginal
            status = "MARGINAL"
        else:
            bar_color = "#2e7d32"  # Green — below rating
            status = ""

        # `mult` is the ASCE 7 zone PRESSURE ratio; the velocity shown is its
        # √ (equivalent velocity). Label it as a pressure ratio so it is never
        # misread as a velocity multiplier (E270).
        mult_label = f" ({mult:.2f}× pressure)" if mult > 1.0 else ""
        status_html = f' <span style="color:{bar_color};font-weight:700;font-size:8pt;">{status}</span>' if status else ""

        bar_rows += f'''<div class="bar-row">
    <div class="bar-label">{label}{mult_label}</div>
    <div class="bar-value">{vel} mph{status_html}</div>
    <div style="flex:1;"><div class="bar-fill" style="width:{bar_width(vel)}%;background:{bar_color};"></div></div>
</div>\n'''

    # Rating reference line position
    rating_pct = bar_width(shingle_rating)

    html = f'''<div class="threshold-chart">
<div class="chart-title">Wind Velocity Amplification &mdash; ASCE 7 Roof Zone Analysis</div>
<p style="font-size:8.5pt;color:#6b7280;margin:3pt 0 8pt 0;">
Wind accelerates over the roof due to building geometry (Bernoulli effect). ASCE 7 defines roof-zone
amplification as PRESSURE coefficients &mdash; eaves, rakes, and corners experience roughly 1.35&ndash;2&times; the field
<em>pressure</em>. Because dynamic pressure scales with the square of velocity, those zones equate to about
1.16&ndash;1.41&times; the field <em>wind speed</em> (the &radic; of the pressure ratio), shown below as equivalent velocity.
</p>
{bar_rows}
<div class="bar-row" style="margin-top:4pt;border-top:1.5pt dashed #0d47a1;padding-top:4pt;">
    <div class="bar-label" style="color:#0d47a1;font-weight:700;">&#9650; Shingle Rating</div>
    <div class="bar-value" style="color:#0d47a1;font-weight:700;">{shingle_rating} mph</div>
    <div style="flex:1;"><div class="bar-fill" style="width:{rating_pct}%;background:#0d47a1;height:4pt;opacity:0.4;"></div></div>
</div>
<p style="font-size:7.5pt;color:#0d47a1;margin:2pt 0 0 0;text-align:right;">{rating_label}</p>
'''

    # Build the exceeds/marginal summary — skip the styled div entirely if
    # no zones exceed or approach the rating (M1 fix from code review)
    zone3_vel = zone_multipliers[-1][2]
    zone2_vel = zone_multipliers[-2][2]
    exceeds_lines = []
    if zone3_vel > shingle_rating:
        delta = zone3_vel - shingle_rating
        exceeds_lines.append(f'<span style="color:#c8102e;font-weight:700;">Zone 3 (corners): {zone3_vel} mph &mdash; EXCEEDS shingle rating by {delta} mph</span>')
    if zone2_vel > shingle_rating:
        delta = zone2_vel - shingle_rating
        exceeds_lines.append(f'<span style="color:#c8102e;font-weight:700;">Zone 2 (edges): {zone2_vel} mph &mdash; EXCEEDS shingle rating by {delta} mph</span>')
    elif zone2_vel > shingle_rating * 0.9:
        exceeds_lines.append(f'<span style="color:#f59e0b;font-weight:700;">Zone 2 (edges): {zone2_vel} mph &mdash; MARGINAL (within 10% of rating)</span>')

    if exceeds_lines:
        html += '<div class="exceeds-line" style="margin-top:10pt;">' + "<br/>".join(exceeds_lines) + '</div>\n'
    else:
        html += '<p style="font-size:8.5pt;color:#2e7d32;margin-top:10pt;font-weight:600;">All zones below shingle rating &mdash; wind amplification may not explain observed damage at this wind speed.</p>\n'

    html += f'''
<p style="font-size:8.5pt;color:#374151;margin-top:8pt;">
The observed damage pattern &mdash; concentrated at eaves, rakes, and corners &mdash; is engineering-consistent
with ASCE 7 Zone 2&ndash;3 wind amplification from the {max_wind} mph peak gust recorded at this property.
</p>
<table style="font-size:7.5pt;color:#6b7280;margin-top:8pt;border:none;">
    <tr style="border:none;"><td style="border:none;padding:2pt 6pt;"><strong>Engineering basis:</strong></td><td style="border:none;padding:2pt 6pt;">ASCE 7-22, Chapters 26&ndash;30 &mdash; external pressure coefficients (GCp) by roof zone</td></tr>
    <tr style="border:none;"><td style="border:none;padding:2pt 6pt;"></td><td style="border:none;padding:2pt 6pt;">HAAG Engineering Research &amp; Education Foundation &mdash; Residential wind amplification studies</td></tr>
    <tr style="border:none;"><td style="border:none;padding:2pt 6pt;"></td><td style="border:none;padding:2pt 6pt;">IBHS (Institute for Business &amp; Home Safety) &mdash; Full-scale wind testing facility data</td></tr>
    <tr style="border:none;"><td style="border:none;padding:2pt 6pt;"><strong>Wind speed basis:</strong></td><td style="border:none;padding:2pt 6pt;">ASCE 7 basic wind speed is a 3-second GUST at strength level. NOAA Storm Events / SPC report wind magnitude as a peak gust, so the recorded value is used directly &mdash; no additional sustained&rarr;gust factor is applied.</td></tr>
    <tr style="border:none;"><td style="border:none;padding:2pt 6pt;"><strong>Zone amplification:</strong></td><td style="border:none;padding:2pt 6pt;">Roof-zone factors are PRESSURE coefficients. Equivalent zone velocity = base gust &times; &radic;(pressure ratio), since dynamic pressure scales with velocity&sup2;. Velocities are illustrative engineering estimates, not a PE-stamped analysis.</td></tr>
    <tr style="border:none;"><td style="border:none;padding:2pt 6pt;"><strong>ASTM test note:</strong></td><td style="border:none;padding:2pt 6pt;">Shingle wind ratings (D3161/D7158) are tested on flat decks in lab conditions &mdash; real-world performance degrades with age, fastener condition, and thermal cycling.</td></tr>
</table>
</div>\n'''

    return html


def _build_noaa_citation(weather):
    """Build NOAA data citation block for storm verification section."""
    noaa = weather.get("noaa")
    if not noaa:
        return ""

    html = '<h3>NOAA Storm Data (Official U.S. Government Source)</h3>\n'
    html += '<p style="margin-top:4pt;">' + _cite_chip("NOAA SWDI", neutral=True) + '</p>\n'
    html += '<table>\n'
    html += '<tr><th style="width:35%">Parameter</th><th>Detail</th></tr>\n'

    if noaa.get("max_hail_inches", 0) > 0:
        html += f'<tr><td><strong>Maximum Hail Size</strong></td><td class="obs-no">{noaa["max_hail_inches"]}" diameter</td></tr>\n'
    if noaa.get("max_wind_mph", 0) > 0:
        html += f'<tr><td><strong>Maximum Wind Speed</strong></td><td class="mono">{noaa["max_wind_mph"]} mph</td></tr>\n'
    html += f'<tr><td><strong>Events Found</strong></td><td><span class="mono">{noaa.get("event_count", 0)}</span> storm events within <span class="mono">{noaa.get("search_radius_miles", 10)}</span> miles</td></tr>\n'
    _raw_qdate = noaa.get("query_date", "")
    try:
        from datetime import datetime as _dt
        _qdt = _dt.strptime(_raw_qdate, "%Y-%m-%d")
        _query_date_display = _qdt.strftime("%B %d, %Y").replace(" 0", " ")
    except (ValueError, TypeError):
        _query_date_display = _raw_qdate
    html += f'<tr><td><strong>Data Retrieved</strong></td><td>{_query_date_display}</td></tr>\n'
    html += '</table>\n'

    # Individual events
    events = noaa.get("events", [])
    if events:
        html += '<h3>Confirmed Storm Events Near Property</h3>\n'
        html += '<table style="font-size:9pt;">\n'
        html += '<tr><th>Source</th><th>Type</th><th>Magnitude</th><th>Distance</th><th>Detail</th></tr>\n'
        for evt in events[:10]:  # Limit to top 10
            src = evt.get("source", "").replace("SWDI_", "").replace("SPC_", "SPC ")
            # Robust magnitude extraction — seeded/manual weather data may use
            # `wind_speed`/`hail_size` instead of `magnitude`/`magnitude_type`.
            raw_mag = evt.get("magnitude")
            mag_type = evt.get("magnitude_type", "")
            if raw_mag is None:
                if evt.get("hail_size") is not None:
                    raw_mag = evt["hail_size"]
                    mag_type = mag_type or "hail_inches"
                elif evt.get("wind_speed") is not None:
                    raw_mag = evt["wind_speed"]
                    mag_type = mag_type or "wind_mph"
                else:
                    continue  # nothing to display for this event
            mag = f'{raw_mag}"' if mag_type == "hail_inches" else f'{raw_mag} mph'
            dist = f'{evt.get("distance_miles", 0):.1f} mi'
            detail = evt.get("source_detail", "")[:50]
            mag_cls = "obs-no" if mag_type == "hail_inches" else "mono"
            html += f'<tr><td>{src}</td><td>{evt.get("event_type", "")}</td><td class="{mag_cls}">{mag}</td><td class="mono">{dist}</td><td>{detail}</td></tr>\n'
        html += '</table>\n'

    # Verification URLs
    urls = noaa.get("query_urls", [])
    clean_urls = [u for u in urls if "error" not in u]
    if clean_urls:
        html += '<p style="font-size:8pt;color:var(--c-mute);">NOAA verification: '
        html += " | ".join(f'<a href="{u}">[{i+1}]</a>' for i, u in enumerate(clean_urls))
        html += '</p>\n'

    return html


def _build_preliminary_damage_section(config, photo_card_fn):
    """Build preliminary damage observations — 2-3 most impactful damage photos shown first.

    Selects photos tagged with high-severity keywords in annotations.
    Returns (html_string, has_content) tuple.
    """
    annotations = config.get("photo_annotations", {})
    photo_sections = config.get("photo_sections", [])
    trophy_photos = config.get("trophy_photos", [])

    # If explicit trophy_photos are specified in config, use those
    if trophy_photos:
        html = '<div class="photo-grid">\n'
        for entry in trophy_photos[:4]:
            if isinstance(entry, list) and len(entry) >= 3:
                key, pg, im = entry[0], entry[1], entry[2]
            elif isinstance(entry, list) and len(entry) == 1:
                key, pg, im = entry[0], 0, 0
            else:
                continue
            card = photo_card_fn(pg, im, key)
            if card:
                html += card
        html += '</div>\n'
        return html, True

    # Auto-detect: scan annotations for high-severity keywords
    severity_keywords = [
        "severe", "significant", "catastrophic", "obvious", "multiple impacts",
        "mat fracture", "fractured mat", "penetration", "puncture",
        "shattered", "crushed", "destroyed", "massive", "extensive",
    ]

    scored = []
    for akey, caption in annotations.items():
        if not isinstance(caption, str):
            continue
        caption_lower = caption.lower()
        score = sum(1 for kw in severity_keywords if kw in caption_lower)
        if score > 0:
            scored.append((akey, score))

    # Sort by score descending, take top 3
    scored.sort(key=lambda x: -x[1])
    top_keys = [s[0] for s in scored[:3]]

    if not top_keys:
        return "", False

    html = '<div class="photo-grid">\n'
    count = 0
    for akey in top_keys:
        # Parse key to page/img
        if "_img" in akey and akey.startswith("page"):
            parts = akey.split("_img")
            try:
                pg = int(parts[0].replace("page", ""))
                im = int(parts[1])
                card = photo_card_fn(pg, im, akey)
                if card:
                    html += card
                    count += 1
            except (ValueError, IndexError):
                continue
        else:
            card = photo_card_fn(0, 0, akey)
            if card:
                html += card
                count += 1

    html += '</div>\n'
    return html, count > 0


def build_forensic_report(config):
    """Build Forensic Causation Report with cover page and photo analysis."""
    lang = get_language(config)
    print(f"Building Forensic Causation Report... [role: {lang['role']}]")

    logo_b64 = get_logo_b64(config)
    apa_logo_b64 = get_assoc_logo_b64("apa_logo")
    nrca_logo_b64 = get_assoc_logo_b64("nrca_logo")
    haag_logo_b64 = get_assoc_logo_b64("haag_logo")
    gaf_logo_b64 = get_assoc_logo_b64("gaf_master_elite_logo")
    oc_logo_b64 = get_assoc_logo_b64("owens_corning_platinum_logo")
    prop = config["property"]
    ins = config["insured"]
    carrier = config["carrier"]
    dates = config["dates"]
    weather = config["weather"]
    findings = config["forensic_findings"]
    structures = config["structures"]
    company = config["company"]
    annotations = config.get("photo_annotations", {})

    # Inspector info — handle single or multiple with auto-default
    inspectors_cfg = config.get("inspectors", {})
    if "usarm_inspectors" in inspectors_cfg:
        inspector_lines = "<br>".join(
            f"{i['name']} ({i.get('role', 'Inspector')}) — {i.get('date', '')}"
            for i in inspectors_cfg["usarm_inspectors"]
        )
    else:
        raw_inspector = inspectors_cfg.get("usarm_inspector", "")
        # Auto-default: replace empty or AI-generated inspector names
        skip_values = ("", "dumb roof ai analysis", "dumbroof.ai", "ai analysis")
        if raw_inspector.lower().strip() in skip_values:
            company_name_lower = company.get("name", "").lower()
            if "usa roof masters" in company_name_lower or "usarm" in company_name_lower:
                raw_inspector = "Zach Roberts, HAAG Certified Inspector (#PENDING)"
            else:
                # Portal/external tenants: fall back to the CONTRACTOR's own
                # identity (their contact, else their company name) — never the
                # homeowner (the insured is not the inspector) and never a USARM
                # person. Part of E272 multi-tenancy inspector-name hygiene.
                raw_inspector = company.get("ceo_name") or company.get("name", "")
        inspector_lines = f"{raw_inspector} — {inspectors_cfg.get('usarm_title', '')}"

    # Inspection date — handle single or list
    if "usarm_inspection_dates" in dates:
        insp_dates_str = ", ".join(d["date"] for d in dates["usarm_inspection_dates"])
    else:
        insp_dates_str = dates.get("usarm_inspection_date", "")

    # Photo card helper
    def photo_card(page, img, key=None):
        filename = find_photo(config, page, img, key=key)
        if not filename:
            return ""
        src = b64_img(config, filename)
        if not src:
            return ""
        caption = ""
        if key and key in annotations:
            caption = annotations[key]
        elif f"p{page:02d}_{img:02d}" in annotations:
            caption = annotations[f"p{page:02d}_{img:02d}"]
        elif f"page{page:02d}_img{img:02d}" in annotations:
            caption = annotations[f"page{page:02d}_img{img:02d}"]
        return f'''<div class="photo-card">
            <img src="{src}" alt="Photo">
            <div class="caption">{caption}</div>
        </div>'''

    # Overview photo card (for page-level keys like "page03")
    def overview_photo_card(page_key):
        filename = find_overview_photo(config, page_key)
        if not filename:
            return ""
        src = b64_img(config, filename)
        if not src:
            return ""
        caption = annotations.get(page_key, "")
        return f'''<div class="photo-card">
            <img src="{src}" alt="Photo">
            <div class="caption">{caption}</div>
        </div>'''

    # --- Build photo sections HTML ---
    photo_sections_html = ""
    photo_sections = config.get("photo_sections", [])
    for section in photo_sections:
        title = section.get("title", "")
        photo_sections_html += f'<h3>{title}</h3>\n'

        # Check for overview type (94 Theron)
        if section.get("type") == "overview":
            photo_sections_html += '<div class="photo-grid">\n'
            for pg_key in section.get("pages", []):
                photo_sections_html += overview_photo_card(pg_key)
            photo_sections_html += '</div>\n'
            continue

        # Check for subsections (94 Theron format)
        if "subsections" in section:
            for sub in section["subsections"]:
                sub_title = sub.get("title", "")
                photo_sections_html += f'<h3 style="font-size:10pt; margin-top:12pt;">{sub_title}</h3>\n'

                # Callout box if present
                if sub.get("callout"):
                    photo_sections_html += f'<div class="critical-box">{sub["callout"]}</div>\n'

                photo_range = sub.get("photo_range", [])
                if len(photo_range) == 2:
                    start, end = photo_range
                    photo_sections_html += '<div class="photo-grid">\n'
                    # For subsection photo ranges, we need to map photo number to page/img
                    # The photo annotations use page{NN}_img{NN} keys
                    # We iterate through annotations to find matching photos
                    photo_num = start
                    for pkey in sorted(annotations.keys()):
                        if pkey.startswith("page") and "_img" in pkey:
                            parts = pkey.split("_img")
                            pg = int(parts[0].replace("page", ""))
                            im = int(parts[1])
                            # Compute sequential photo number
                            # This is complex — use a simpler approach:
                            # Count through annotations in order
                            pass

                    # Simpler: build a sequential photo list from annotations
                    ordered_photos = []
                    for akey in sorted(annotations.keys()):
                        if "_img" in akey and akey.startswith("page"):
                            parts = akey.split("_img")
                            pg = int(parts[0].replace("page", ""))
                            im = int(parts[1])
                            ordered_photos.append((akey, pg, im))

                    # Photo numbers are 1-indexed sequential
                    for idx in range(start - 1, min(end, len(ordered_photos))):
                        akey, pg, im = ordered_photos[idx]
                        photo_sections_html += photo_card(pg, im, akey)

                    photo_sections_html += '</div>\n'
                    # Page break every 6 photos
                    if end - start >= 5:
                        photo_sections_html += '<div class="page-break"></div>\n'

        # Flat photos array: [[key, page, img], ...] or [[key], ...] (photo_map only)
        elif "photos" in section:
            photos = section["photos"]
            photo_sections_html += '<div class="photo-grid">\n'
            for i, photo_entry in enumerate(photos):
                if len(photo_entry) == 1:
                    key = photo_entry[0]
                    pg, im = 0, 0
                else:
                    key, pg, im = photo_entry[0], photo_entry[1], photo_entry[2]
                photo_sections_html += photo_card(pg, im, key)
                # Insert page break after every 4 photos (2 rows)
                if (i + 1) % 4 == 0 and i < len(photos) - 1:
                    photo_sections_html += '</div>\n<div class="page-break"></div>\n<div class="photo-grid">\n'
            photo_sections_html += '</div>\n'

    # --- Build structures info ---
    struct = structures[0] if structures else {}
    struct_name = struct.get("name", "Main Dwelling")
    roof_sf = struct.get("roof_area_sf", 0)
    roof_sq = struct.get("roof_area_sq", 0)
    waste_pct = struct.get("waste_percent", 0)
    # Auto-default waste factor when 0 or missing
    if waste_pct == 0:
        style_lower = struct.get("style", "").lower()
        if "hip" in style_lower:
            waste_pct = 14
        else:  # gable, cross-gable, etc.
            waste_pct = 10
        # Recalculate area with waste
        if roof_sq > 0:
            roof_sq_waste = round(roof_sq * (1 + waste_pct / 100), 2)
        else:
            roof_sq_waste = struct.get("roof_area_sq_with_waste", 0)
    else:
        roof_sq_waste = struct.get("roof_area_sq_with_waste", 0)
    facets = struct.get("facets", 0)
    pitch = struct.get("predominant_pitch", "")
    style = struct.get("style", "")
    shingle_type = struct.get("shingle_type", "")
    shingle_cond = struct.get("shingle_condition", "")

    # --- WS-5 no-data / placeholder guards ---
    _ws5_meas = ws5_has_measurements(config)
    _ws5_wx = ws5_weather_verified(config)
    _ws5_owner_ph = ws5_owner_is_placeholder(config)
    _ws5_nodata_id = ws5_nodata_identity(config)

    # WS-5 GUARD 1 — roof-spec area/facets/pitch rows. When no measurements were
    # uploaded, the struct fields are all 0/empty; printing "0 SF / Facets 0"
    # reads as fabricated. Suppress the metric rows and state the forensic
    # posture instead of asserting zeroes.
    if _ws5_meas:
        roof_spec_metric_rows = (
            f'    <tr><td><strong>Total Roof Area</strong></td><td>{roof_sf:,} SF ({roof_sq} SQ)</td></tr>\n'
            f'    <tr><td><strong>Waste Factor</strong></td><td>{waste_pct}%</td></tr>\n'
            f'    <tr><td><strong>Area with Waste</strong></td><td>{roof_sq_waste} SQ</td></tr>\n'
            f'    <tr><td><strong>Facets</strong></td><td>{facets}</td></tr>\n'
            f'    <tr><td><strong>Predominant Pitch</strong></td><td>{pitch}</td></tr>\n'
        )
    else:
        roof_spec_metric_rows = (
            '    <tr><td><strong>Measurements</strong></td>'
            '<td>Forensic assessment — measurements not included. '
            'Roof area, facet count, and pitch will be confirmed from an '
            'EagleView/HOVER report prior to estimate finalization.</td></tr>\n'
        )

    # WS-5 GUARD 3 — placeholder owner + blank carrier/policy identity rows.
    # cover-page owner line: drop the "Property Owner:" placeholder line entirely.
    if _ws5_owner_ph:
        cover_owner_line = ""
    else:
        cover_owner_line = f"<strong>Property Owner:</strong> {ins['name']}<br>\n        "

    # Section 1 identity rows: build conditionally so placeholder owner /
    # blank carrier / blank policy rows are SUPPRESSED rather than printed
    # empty. The owner-type suffix logic is preserved verbatim for the
    # non-placeholder branch so full-data output is byte-identical.
    _owner_type_suffix = (
        ' (' + ins['type'] + ')'
        if ins.get('type', '').lower() not in
        ('homeowner', 'property owner (homeowner)', 'property owner', '')
        else ''
    )
    section1_identity_rows = ""
    if not _ws5_owner_ph:
        section1_identity_rows += (
            f"    <tr><td><strong>Property Owner</strong></td><td>{ins['name']}{_owner_type_suffix}</td></tr>\n"
        )
    # Carrier / Claim / Policy rows: suppress a blank row ONLY in a no-data /
    # placeholder posture so a full-data claim with a merely-unknown policy
    # number keeps its existing (blank) row → byte-identical.
    if not (_ws5_nodata_id and ws5_blank(carrier.get('name'))):
        section1_identity_rows += (
            f"    <tr><td><strong>Carrier</strong></td><td>{carrier['name']}</td></tr>\n"
        )
    if not (_ws5_nodata_id and ws5_blank(carrier.get('claim_number'))):
        section1_identity_rows += (
            f"    <tr><td><strong>Claim Number</strong></td><td>{carrier['claim_number']}</td></tr>\n"
        )
    if not (_ws5_nodata_id and ws5_blank(carrier.get('policy_number', ''))):
        section1_identity_rows += (
            f"    <tr><td><strong>Policy Number</strong></td><td>{carrier.get('policy_number','')}</td></tr>\n"
        )

    # Pitches table rows
    pitches_html = ""
    for p in struct.get("pitches", []):
        pname = p.get("pitch", "")
        area = p.get("area_sf", "")
        pct = p.get("percent", "")
        note = p.get("note", "")
        if area:
            pitches_html += f"<tr><td>{pname}</td><td>{area} SF</td><td>{pct}%</td></tr>\n"
        else:
            pitches_html += f"<tr><td>{pname}</td><td colspan='2'>{note}</td></tr>\n"

    # Build repairability section early (needed for TOC + section numbering)
    repairability_html, has_repairability = _build_repairability_section(config)

    # Build NOAA citation (for intertwined storm section)
    noaa_citation_html = _build_noaa_citation(weather)

    # Build threshold aging chart (visual) — hail threshold vs product age
    threshold_aging_chart_html = _build_threshold_aging_chart(config)

    # Build wind amplification chart (visual) — ASCE 7 roof zone analysis
    wind_amplification_chart_html = _build_wind_amplification_chart(config)

    # Build age reasoning HTML (shown when age was estimated, not explicit)
    _explicit_age = config.get("scoring", {}).get("photo_analysis", {}).get("estimated_age")
    if not _explicit_age and structures:
        _explicit_age = structures[0].get("age")
    if not _explicit_age:
        _est_age, age_reasoning_html = _estimate_roof_age(config)
    else:
        age_reasoning_html = ""

    # Build preliminary damage observations (most impactful photos first)
    preliminary_html, has_preliminary = _build_preliminary_damage_section(config, photo_card)

    # --- TOC (auto-generated from photo_sections + standard sections) ---
    toc_sections = findings.get("toc_sections", [])
    if not toc_sections:
        toc_sections = ["1. Property & Claim Information", "2. Executive Summary",
                        "3. Storm Event Overview"]
        sec_num = 4
        if has_preliminary:
            toc_sections.append(f"{sec_num}. Primary Damage Observations")
            sec_num += 1
        toc_sections.append(f"{sec_num}. Damage Threshold Analysis")
        sec_num += 1
        photo_secs = config.get("photo_sections", [])
        for i, sec in enumerate(photo_secs):
            toc_sections.append(f"{sec_num + i}. {sec.get('title', 'Photo Section')}")
        sec_num += len(photo_secs)
        toc_sections.append(f"{sec_num}. Causation Analysis & Damage Criteria")
        # Method of Repair BEFORE Code Compliance
        if has_repairability:
            toc_sections.append(f"{sec_num+1}. Method of Repair Analysis")
            toc_sections.append(f"{sec_num+2}. Code Compliance Requirements")
            toc_sections.append(f"{sec_num+3}. Conclusions & Recommendations")
        else:
            toc_sections.append(f"{sec_num+1}. Code Compliance Requirements")
            toc_sections.append(f"{sec_num+2}. Conclusions & Recommendations")
    toc_html = ""
    for sec in toc_sections:
        toc_html += f'<div class="toc-item"><span>{sec}</span></div>\n'

    # --- Weather additional events ---
    additional_events_html = ""
    for evt in weather.get("additional_events", []):
        additional_events_html += f'<tr><td>{evt["date"]}</td><td>{evt["type"]}</td><td>{evt["detail"]}</td></tr>\n'

    # --- NWS reports (94 Theron has these) ---
    nws_html = ""
    if weather.get("hail_size_nws_reports"):
        nws_html += '<h3>NWS Local Storm Reports</h3>\n<table>\n'
        nws_html += '<tr><th>Time</th><th>Location</th><th>Size</th><th>Source</th></tr>\n'
        for rpt in weather["hail_size_nws_reports"]:
            nws_html += f'<tr><td>{rpt.get("time","")}</td><td>{rpt.get("location","")}</td><td>{rpt.get("size","")}</td><td>{rpt.get("source","")}</td></tr>\n'
        nws_html += '</table>\n'
        if weather.get("nws_warning_tag"):
            nws_html += f'<div class="critical-box"><strong>NWS Warning Tag: {weather["nws_warning_tag"]}</strong> — {weather.get("nws_warning_detail","")}</div>\n'

    # --- Corroborating weather reports (web search results) ---
    corroborating_html = ""
    corroborating = weather.get("corroborating_reports", [])
    if corroborating:
        corroborating_html += '<h3>Corroborating Weather Reports</h3>\n'
        corroborating_html += '<p style="font-size:9pt;color:var(--c-slate);">Independent sources confirming storm activity at or near the property on the date of loss:</p>\n'
        # Separate news media from other sources
        media_reports = [r for r in corroborating if "news" in r.get("source_type", "").lower() or "media" in r.get("source_type", "").lower()]
        other_reports = [r for r in corroborating if r not in media_reports]
        # Render news media as styled quote blocks
        for rpt in media_reports:
            station = rpt.get("title", "Local News")
            snippet = rpt.get("snippet", "")
            url = rpt.get("url", "")
            corroborating_html += f'<div class="media-quote">&ldquo;{snippet}&rdquo;<div class="source">&mdash; {station}'
            if url:
                corroborating_html += f' (<a href="{url}">source</a>)'
            corroborating_html += '</div></div>\n'
        # Render other sources as table
        if other_reports:
            corroborating_html += '<table>\n<tr><th>Source Type</th><th>Title</th><th>Detail</th></tr>\n'
            for rpt in other_reports:
                title = rpt.get("title", "")
                url = rpt.get("url", "")
                snippet = rpt.get("snippet", "")
                source_type = rpt.get("source_type", "Web Report")
                link_html = f'<a href="{url}">{title[:80]}</a>' if url else title[:80]
                corroborating_html += f'<tr><td><strong>{source_type}</strong></td><td>{link_html}</td><td style="font-size:8.5pt;">{snippet[:150]}</td></tr>\n'
            corroborating_html += '</table>\n'

    # --- WS-5 GUARD 2 — Storm Event Overview ---
    # When the claim is NOT weather-verified (prod shape: no hail_size /
    # storm_date / storm_description and no NOAA event_count), the "Storm
    # Verified" success box + the storm-parameter table render as empty
    # placeholder cells ("Storm Verified: ", "Storm Date: ", "HailTrace
    # Report ID: —"). That reads as fabricated. Render a neutral
    # "weather verification pending" notice instead, and drop the empty
    # parameter table entirely. The verified branch is byte-identical to the
    # prior unconditional markup.
    if _ws5_wx:
        # Storm-evidence values (hail size, coordinates) render mono = data;
        # the NOAA SWDI / NWS LSR provenance renders as .neutral cite-chips.
        _storm_chips = (
            '<p style="margin-top:8pt;">'
            + _cite_chip("NOAA SWDI", neutral=True)
            + " "
            + _cite_chip("NWS LSR", neutral=True)
            + "</p>"
        )
        storm_overview_html = (
            '<div class="success-box">\n'
            f"<strong>Storm Verified:</strong> {weather.get('storm_description', '')}\n"
            '</div>\n\n'
            '<table>\n'
            '    <tr><th style="width:35%">Parameter</th><th>Detail</th></tr>\n'
            f"    <tr><td><strong>Storm Date</strong></td><td class=\"mono\">{weather['storm_date']}</td></tr>\n"
            f"    <tr><td><strong>Hail Size (Algorithm)</strong></td><td class=\"mono\">{weather.get('hail_size_algorithm', '')}</td></tr>\n"
            f"    <tr><td><strong>Hail Size (Meteorologist)</strong></td><td class=\"mono\">{weather.get('hail_size_meteorologist', weather.get('hail_size_algorithm', ''))}</td></tr>\n"
            f"    <tr><td><strong>Verification</strong></td><td>{weather.get('verification_method', '')}</td></tr>\n"
            f"    <tr><td><strong>HailTrace Report</strong></td><td>ID: {weather.get('hailtrace_id', '')} — {weather.get('hailtrace_url', '')}</td></tr>\n"
            f"    <tr><td><strong>Coordinates</strong></td><td class=\"mono\">{weather.get('coordinates', '')}</td></tr>\n"
            '</table>\n'
            + _storm_chips
        )
    else:
        storm_overview_html = (
            '<div class="info-box">\n'
            '<strong>Weather verification pending:</strong> Independent storm '
            'verification (NOAA/NWS storm data, hail-size confirmation) has not '
            'yet been attached to this claim. The damage documented in this '
            'report is based on the field inspection; storm corroboration will '
            'be supplemented prior to estimate finalization.\n'
            '</div>'
        )

    # --- Damage thresholds (check both weather and forensic_findings) ---
    thresholds_html = ""
    damage_thresholds = weather.get("damage_thresholds") or findings.get("damage_thresholds")
    if damage_thresholds:
        thresholds_html += '<h3>Damage Threshold Analysis</h3>\n<table>\n'
        thresholds_html += '<tr><th>Material</th><th>Damage Threshold</th><th>Confirmed Hail</th><th>Result</th></tr>\n'
        for dt in damage_thresholds:
            material = dt.get("material", dt.get("component", ""))
            confirmed = dt.get("confirmed_size", dt.get("storm_actual", ""))
            # The Result cell is the load-bearing color signal — brick (via the
            # .obs-no semantic class) when the storm EXCEEDED the threshold.
            result_cls = ' class="obs-no"' if ('EXCEEDS' in dt.get('result', '') or 'EXCEEDED' in dt.get('result', '')) else ''
            thresholds_html += (
                f'<tr><td>{material}</td>'
                f'<td class="mono">{dt["threshold"]}</td>'
                f'<td class="mono">{confirmed}</td>'
                f'<td{result_cls}>{dt["result"]}</td></tr>\n'
            )
        thresholds_html += '</table>\n'

    # --- FieldAssist section (6 Avon — conditional) ---
    fieldassist_html = ""
    fa = findings.get("fieldassist_findings")
    if fa:
        slopes = ", ".join(fa.get("slopes_with_granular_loss", []))
        test_sq_rows = ""
        for slope, count in fa.get("test_square_hail_counts", {}).items():
            test_sq_rows += f"<tr><td>{slope}</td><td>{count}</td></tr>\n"

        wind_info = fa.get("wind_damaged_shingles", {})
        vent_info = fa.get("damaged_exhaust_vents", {})

        fieldassist_html = f"""
<div class="page-break"></div>
<h2>4. FieldAssist Inspection Contradictions</h2>
<div class="critical-box">
<strong>Critical Finding:</strong> The carrier's own FieldAssist inspector confirmed "Potentially Covered Damage: Yes" and documented granular loss on all inspected slopes. Yet the carrier approved only a minimal spot repair.
</div>

<h3>FieldAssist Inspector Findings</h3>
<table>
    <tr><th>Finding</th><th>Detail</th></tr>
    <tr><td><strong>Got on Roof</strong></td><td>{"Yes" if fa.get("got_on_roof") else "No"}</td></tr>
    <tr><td><strong>Potentially Covered Damage</strong></td><td class="obs-no">{"YES" if fa.get("potentially_covered_damage") else "No"}</td></tr>
    <tr><td><strong>Slopes with Granular Loss</strong></td><td>{slopes}</td></tr>
    <tr><td><strong>Wind-Damaged Shingles</strong></td><td>Facet {wind_info.get("facet","")}: {wind_info.get("count",0)} shingles</td></tr>
    <tr><td><strong>Damaged Exhaust Vents</strong></td><td>{vent_info.get("location","")}: {vent_info.get("count",0)}</td></tr>
</table>

<h3>Test Square Results vs. Inspector Findings</h3>
<table>
    <tr><th>Slope</th><th>Hail Count in Test Square</th></tr>
    {test_sq_rows}
</table>

<div class="highlight-box">
<strong>The Contradiction:</strong> The test squares recorded 0 hail on all slopes while the inspector confirmed granular loss on those same slopes. Test squares are a supplemental tool -- when they contradict the inspector's broader findings, the overall assessment must govern.
</div>
"""

    # --- Differentiation table (94 Theron) ---
    diff_html = ""
    if findings.get("differentiation_table"):
        diff_html += '<h3>Damage Differentiation Analysis</h3>\n<table style="font-size:9pt;">\n'
        diff_html += '<tr><th>Potential Cause</th><th>Expected Characteristics</th><th>Observed?</th><th>Conclusion</th></tr>\n'
        for row in findings["differentiation_table"]:
            # Conclusion + Observed are the load-bearing semantic cells — the one
            # place forest/brick carry meaning. Route through Spectral semantic
            # classes (.concl-consistent / .concl-inconsistent / .obs-yes /
            # .obs-no) instead of inline hex.
            conclusion_val = row["conclusion"]
            if conclusion_val.upper() == "CONSISTENT":
                conclusion_cell = f'<strong class="concl-consistent">{conclusion_val}</strong>'
            elif "NOT" in conclusion_val.upper() or "INCONSISTENT" in conclusion_val.upper():
                conclusion_cell = f'<strong class="concl-inconsistent">{conclusion_val}</strong>'
            else:
                conclusion_cell = conclusion_val
            # Bold cause column
            cause_cell = f'<strong>{row["cause"]}</strong>'
            # Bold observed: Yes=forest, No=brick
            observed_val = row["observed"]
            if observed_val.lower().startswith("yes"):
                observed_cell = f'<strong class="obs-yes">{observed_val}</strong>'
            elif observed_val.lower().startswith("no"):
                observed_cell = f'<strong class="obs-no">{observed_val}</strong>'
            else:
                observed_cell = observed_val
            # Bold key forensic terms in characteristics
            chars_val = row["characteristics"]
            forensic_terms = ["circular", "random", "granule displacement", "mat fracture", "indentation",
                              "irregular", "concentrated", "uniform", "directional", "crushing"]
            for term in forensic_terms:
                chars_val = re.sub(f'(?i)({re.escape(term)})', r'<strong>\1</strong>', chars_val)
            diff_html += f'<tr><td>{cause_cell}</td><td>{chars_val}</td><td>{observed_cell}</td><td>{conclusion_cell}</td></tr>\n'
        diff_html += '</table>\n'

    # --- Critical observations (94 Theron) ---
    crit_obs_html = ""
    if findings.get("critical_observations"):
        for obs in findings["critical_observations"]:
            crit_obs_html += f'<h3>{obs["title"]}</h3>\n<p>{obs["content"]}</p>\n'

    # --- Code violations → Spectral .code-card stack ---
    # One card per code requirement (replaces the plain {code, requirement,
    # status} table): a cite-chip carrying the code section, a serif title, a
    # warm-paper requirement inset, and a slate status line. A status that
    # indicates omission/non-compliance flags the card .critical (brick
    # left-border) and bolds the status. Content (code, requirement, status
    # strings) is preserved verbatim so the substance fingerprint is unchanged.
    code_cards = ""
    for cv in findings.get("code_violations", []):
        code = cv.get("code", "")
        requirement = cv.get("requirement", "")
        status = cv.get("status", "")
        _is_critical = any(
            kw in status.lower()
            for kw in ("omit", "not included", "missing", "non-compliant",
                       "noncompliant", "not in", "absent", "violation", "exclud")
        )
        crit_cls = " critical" if _is_critical else ""
        status_html = f"<b>{status}</b>" if _is_critical else status
        code_cards += (
            f'<div class="code-card{crit_cls}">\n'
            f'  <div class="cc-top">{_cite_chip(code)}</div>\n'
            f'  <div class="requirement">{requirement}</div>\n'
            f'  <div class="supplement">Status in carrier scope: {status_html}</div>\n'
            f'</div>\n'
        )

    # --- Key arguments ---
    arguments_html = ""
    for arg in findings.get("key_arguments", []):
        arguments_html += f"<li>{arg}</li>\n"

    # --- Conclusion findings (94 Theron) ---
    conclusion_html = ""
    if findings.get("conclusion_findings"):
        conclusion_html += "<ol>\n"
        for cf in findings["conclusion_findings"]:
            conclusion_html += f"<li>{cf}</li>\n"
        conclusion_html += "</ol>\n"

    # --- Recommended scope (94 Theron) ---
    rec_scope_html = ""
    if findings.get("recommended_scope"):
        rec_scope_html += '<h3>Recommended Scope of Repairs</h3>\n<ul>\n'
        for rs in findings["recommended_scope"]:
            rec_scope_html += f"<li>{rs}</li>\n"
        rec_scope_html += "</ul>\n"

    # --- Multi-structure info ---
    structures_table = ""
    if len(structures) > 1:
        structures_table += '<h3>All Structures</h3>\n<table>\n'
        structures_table += '<tr><th>Structure</th><th>Area</th><th>Style</th><th>Note</th></tr>\n'
        for s in structures:
            # WS-5 GUARD 1 — relabel a 0-SF / empty area cell so a multi-structure
            # claim with no measurements doesn't render "0 SF" rows. Non-zero
            # areas render exactly as before (byte-identical for full-data).
            _s_sf = s.get("roof_area_sf", "")
            if ws5_blank(_s_sf) or str(_s_sf).strip() in ("0", "0.0"):
                area_cell = "Measurements pending"
            else:
                area_cell = f'{_s_sf} SF'
            structures_table += f'<tr><td>{s["name"]}</td><td>{area_cell}</td><td>{s.get("style","")}</td><td>{s.get("note","")}</td></tr>\n'
        structures_table += '</table>\n'

    # Determine section numbers based on optional sections
    has_fa = bool(fa)
    n = 4  # After: 1=Property, 2=Executive Summary, 3=Storm Event
    if has_preliminary:
        preliminary_sec_num = str(n)
        n += 1
    else:
        preliminary_sec_num = ""
    threshold_sec_num = str(n)
    n += 1
    if has_fa:
        fa_sec_num = str(n)
        n += 1
    photo_sec_num = str(n)
    causation_sec_num = str(n + 1)
    # Method of Repair BEFORE Code Compliance
    if has_repairability:
        repair_sec_num = str(n + 2)
        code_sec_num = str(n + 3)
        conclusion_sec_num = str(n + 4)
    else:
        repair_sec_num = ""
        code_sec_num = str(n + 2)
        conclusion_sec_num = str(n + 3)

    # --- Spectral cover-meta owner cell (serif name) ---
    # Suppress the owner cell entirely on a placeholder-owner posture, mirroring
    # the WS-5 cover_owner_line guard so a no-data claim never prints
    # "Owner: Property Owner".
    if _ws5_owner_ph:
        cover_meta_owner_cell = ""
    else:
        cover_meta_owner_cell = (
            '<div class="cell"><div class="k">Homeowner</div>'
            f'<div class="v serif">{ins["name"]}</div></div>'
        )

    # --- Interior masthead (.run-head) — repeats on each interior page as
    # chain-of-custody chrome. Claim # in mono. ---
    _rh_claim = carrier.get("claim_number", "")
    run_head_html = (
        '<div class="run-head">'
        f'<div class="rh-mark">{company["name"]}'
        '<span class="rh-sub">Forensic Causation Report</span></div>'
        '<div class="rh-r"><div class="rh-doc">Doc 01 &middot; Forensic</div>'
        f'<div class="rh-claim">{_rh_claim}</div></div>'
        '</div>'
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Forensic Causation Report -- {prop['address']}</title>
{FORENSIC_FONTS_LINK}
<style>
{FORENSIC_SPECTRAL_CSS}
</style>
</head>
<body>

<!-- COVER PAGE (logo-leads navy authority field) -->
<div class="cover">
    <div class="cover-frame"></div>
    <div class="cover-top">
        <div class="cover-wordmark">{company['name']}
            <span class="wm-sub">Forensic Roofing Assessment</span>
        </div>
        <div class="cover-tab">DOC 01 &middot; FORENSIC</div>
    </div>
    <div class="cover-logo-hero">
        <div class="logo-ring">
            {render_logo_block(logo_b64, company['name'], css_class='cover-logo')}
        </div>
    </div>
    <div class="cover-hero">
        <div class="cover-kicker">Certified Storm-Damage Causation Analysis</div>
        <h1>Forensic Causation Report</h1>
        <div class="cover-subtitle">An independent determination of storm causation, damage severity, and the code-compliant scope of repair for the property identified below.</div>
    </div>
    <div class="cover-meta">
        <div class="cell"><div class="k">Property</div><div class="v serif">{prop['address']}</div></div>
        {cover_meta_owner_cell}<div class="cell"><div class="k">Carrier</div><div class="v serif">{carrier['name']}</div></div>
        <div class="cell"><div class="k">Claim No.</div><div class="v mono">{carrier.get('claim_number','')}</div></div>
        <div class="cell"><div class="k">Date of Loss</div><div class="v mono">{dates['date_of_loss']}</div></div>
        <div class="cell"><div class="k">Report Date</div><div class="v mono">{dates['report_date']}</div></div>
    </div>
    <div class="cover-foot">
        <div class="prep">
            <div class="pl">Prepared by</div>
            <div class="pv">{inspector_lines}</div>
        </div>
        {"<div class='cover-assoc-logos'>" + ('<img src="' + apa_logo_b64 + '" alt="APA">' if apa_logo_b64 else '') + ('<img src="' + haag_logo_b64 + '" alt="HAAG">' if haag_logo_b64 else '') + ('<img src="' + nrca_logo_b64 + '" alt="NRCA">' if nrca_logo_b64 else '') + ('<img src="' + gaf_logo_b64 + '" alt="GAF Master Elite">' if gaf_logo_b64 else '') + ('<img src="' + oc_logo_b64 + '" alt="Owens Corning Platinum">' if oc_logo_b64 else '') + "</div>" if (apa_logo_b64 or nrca_logo_b64 or haag_logo_b64 or gaf_logo_b64 or oc_logo_b64) else ""}
    </div>
</div>
<div class="page-break"></div>

{run_head_html}
<!-- TABLE OF CONTENTS -->
<h2>Table of Contents</h2>
{toc_html}
<div class="page-break"></div>

{run_head_html}
<!-- SECTION 1: PROPERTY & CLAIM INFO -->
<h2>1. Property &amp; Claim Information</h2>
<table>
    <tr><th style="width:35%">Field</th><th>Detail</th></tr>
    <tr><td><strong>Property Address</strong></td><td>{prop['address']}</td></tr>
{section1_identity_rows}    <tr><td><strong>Date of Loss</strong></td><td>{dates['date_of_loss']}</td></tr>
    <tr><td><strong>Carrier Inspection</strong></td><td>{dates.get('carrier_inspection_date','')}</td></tr>
    <tr><td><strong>{company['name']} Inspection</strong></td><td>{insp_dates_str}</td></tr>
    <tr><td><strong>{company['name']} Inspector(s)</strong></td><td>{inspector_lines}</td></tr>
    <tr><td><strong>Report Date</strong></td><td>{dates['report_date']}</td></tr>
</table>

<h3>Roof System Specifications</h3>
<table>
    <tr><th style="width:35%">Specification</th><th>Detail</th></tr>
    <tr><td><strong>Structure</strong></td><td>{struct_name}</td></tr>
{roof_spec_metric_rows}    <tr><td><strong>Style</strong></td><td>{style}</td></tr>
    <tr><td><strong>Shingle Type</strong></td><td>{shingle_type}</td></tr>
    <tr><td><strong>Condition</strong></td><td>{shingle_cond}</td></tr>
</table>

{structures_table}

{"<h3>Pitch Breakdown</h3><table><tr><th>Pitch</th><th>Area</th><th>%</th></tr>" + pitches_html + "</table>" if (pitches_html and _ws5_meas) else ""}

<!-- SECTION 2: EXECUTIVE SUMMARY -->
<div style="margin-top:24pt;"></div>
<h2>2. Executive Summary</h2>
{_build_executive_summary(findings)}

<!-- SECTION 3: STORM EVENT OVERVIEW -->
<div style="margin-top:24pt;"></div>
<h2>3. Storm Event Overview</h2>
{storm_overview_html}

{noaa_citation_html if _ws5_wx else ""}
{nws_html if _ws5_wx else ""}
{corroborating_html if _ws5_wx else ""}

{"<h3>Additional Weather Events</h3><table><tr><th>Date</th><th>Type</th><th>Detail</th></tr>" + additional_events_html + "</table>" if additional_events_html else ""}

{"<!-- PRIMARY DAMAGE OBSERVATIONS -->" + chr(10) + '<div style="margin-top:24pt;"></div>' + chr(10) + '<h2>' + preliminary_sec_num + '. Primary Damage Observations</h2>' + chr(10) + '<p>The following photographs represent initial observations of storm-related damage identified during the field inspection. These findings establish the presence and severity of impact damage across the property.</p>' + chr(10) + preliminary_html if has_preliminary else ""}

<!-- DAMAGE THRESHOLD ANALYSIS -->
<div style="margin-top:24pt;"></div>
<h2>{threshold_sec_num}. Damage Threshold Analysis</h2>
{thresholds_html if thresholds_html else '<p>Damage threshold analysis pending weather verification data.</p>'}
{threshold_aging_chart_html}
{wind_amplification_chart_html}
{age_reasoning_html}

{fieldassist_html}

<!-- PHOTO SECTIONS -->
<div class="page-break"></div>
{run_head_html}
<h2>{photo_sec_num}. Damage Findings &amp; Photo Analysis</h2>
<p>{_photo_intro_text(config)} Below is the complete photographic documentation organized by damage category.</p>

{photo_sections_html}

<!-- CAUSATION ANALYSIS -->
<h2>{causation_sec_num}. Causation Analysis &amp; Damage Criteria</h2>
{_build_causation_criteria(config)}

{diff_html}
{crit_obs_html}

{"<!-- METHOD OF REPAIR ANALYSIS -->" + chr(10) + '<div style="margin-top:24pt;"></div>' + chr(10) + '<h2>' + repair_sec_num + '. Method of Repair Analysis</h2>' + chr(10) + repairability_html if has_repairability else ""}

<!-- CODE COMPLIANCE -->
<div style="margin-top:24pt;"></div>
<h2>{code_sec_num}. Code Compliance Requirements</h2>
<p>{_get_code_intro(config)}</p>
{code_cards}

<!-- CONCLUSION -->
<div class="page-break"></div>
{run_head_html}
<h2>{conclusion_sec_num}. Conclusions &amp; Recommendations</h2>
{_build_conclusion_section(findings, arguments_html, conclusion_html, rec_scope_html)}

{_build_integrity_stamp_spectral(config)}

{_build_contractor_cert_spectral(config)}
{_build_uppa_disclaimer_spectral(config)}

<div class="footer-sig">
    <div class="name">{company['ceo_name']}</div>
    <div class="title">{company['ceo_title']}</div>
    <div>{company['cell_phone']} | {company['email']}</div>
</div>

</body>
</html>"""

    path = os.path.join(config["_paths"]["output"], "01_FORENSIC_CAUSATION_REPORT.html")
    with open(path, "w") as f:
        f.write(html)
    return path


# ===================================================================
# SHARED HELPERS FOR DOCS 2/3/4
# ===================================================================

def _estimate_roof_age(config):
    """Estimate roof age from available data when no explicit age is provided.

    Reasoning cascade:
      1. Explicit age (structures[0].age or scoring.photo_analysis.estimated_age)
      2. Exposure-based dating (pre-metric = manufactured before ~2012)
      3. Product identification dating (discontinued product timelines)
      4. Property year built (upper bound)
      5. Combine evidence → best estimate

    Returns (int_age_or_None, reasoning_html_string).
    """
    import datetime
    current_year = datetime.datetime.now().year

    scoring = config.get("scoring", {})
    photo_analysis = scoring.get("photo_analysis", {})
    product_intel = scoring.get("product_intelligence", {})
    structures = config.get("structures", [{}])
    findings = config.get("forensic_findings", {})
    repairability = findings.get("repairability", {})
    prop = config.get("property", {})

    struct = structures[0] if structures else {}
    shingle_type_raw = struct.get("shingle_type", "")
    shingle_type = shingle_type_raw.lower()

    # Step 1: Explicit age — highest confidence, return immediately
    age = photo_analysis.get("estimated_age")
    if not age and struct:
        age = struct.get("age")
    if age:
        try:
            return int(age), ""
        except (TypeError, ValueError):
            pass

    # Collect reasoning rows and minimum age estimates
    data_points = []  # [(label, finding_text)]
    min_ages = []     # candidate minimum ages from each evidence source

    # Determine shingle category
    _enum = material_enum(config, struct or None)
    if _enum is not None:
        # slate/tile/metal/other leave BOTH False, preserving the raw-label
        # "Shingle Type" data-point path below for non-shingle materials.
        is_three_tab = _enum == "3tab"
        is_laminate = _enum == "laminate"
    else:
        is_three_tab = any(kw in shingle_type for kw in ["3-tab", "three-tab", "three tab"])
        is_laminate = any(kw in shingle_type for kw in ["architectural", "laminate", "dimensional"])
        if not is_three_tab and not is_laminate:
            pa_type = photo_analysis.get("shingle_type", "")
            if pa_type == "three_tab":
                is_three_tab = True
            elif pa_type in ("architectural", "laminate"):
                is_laminate = True

    type_label = "three-tab" if is_three_tab else "laminate/architectural" if is_laminate else "asphalt composition"

    # Record shingle type data point
    mfr = product_intel.get("manufacturer", photo_analysis.get("manufacturer_guess", ""))
    product_name = product_intel.get("product_line", photo_analysis.get("product_line_guess", ""))
    if mfr and product_name:
        data_points.append(("Shingle Type", f"This appears to be a {mfr} {product_name} {type_label} shingle"))
    elif is_three_tab or is_laminate:
        data_points.append(("Shingle Type", f"{type_label.title()} shingle"))
    elif shingle_type_raw:
        data_points.append(("Shingle Type", shingle_type_raw))

    # Step 2: Exposure-based dating
    measured_exposure = repairability.get("measured_exposure_inches")
    if not measured_exposure:
        measured_exposure = photo_analysis.get("exposure_inches_estimate")
    if not measured_exposure:
        measured_exposure = photo_analysis.get("exposure_guess")
    if not measured_exposure and product_intel:
        measured_exposure = product_intel.get("exposure_inches")

    if measured_exposure:
        try:
            exp_val = float(measured_exposure)
        except (TypeError, ValueError):
            exp_val = None

        if exp_val is not None:
            if exp_val <= 5.25:
                # Pre-metric standard size
                if is_laminate:
                    # TAMKO was last to produce 5" laminate, discontinued ~2012
                    min_ages.append(current_year - 2012)
                    data_points.append(("Measured Exposure",
                        f'{exp_val}" — consistent with pre-metric standard (laminate last manufactured ~2012 by TAMKO)'))
                elif is_three_tab:
                    # Standard 3-tab last manufactured ~2010
                    min_ages.append(current_year - 2010)
                    data_points.append(("Measured Exposure",
                        f'{exp_val}" — consistent with pre-metric standard (three-tab last manufactured ~2010)'))
                else:
                    min_ages.append(current_year - 2012)
                    data_points.append(("Measured Exposure",
                        f'{exp_val}" — consistent with pre-metric standard (manufactured prior to ~2012)'))
            elif 5.5 <= exp_val <= 5.75:
                # Current metric standard — post-2005 at most
                data_points.append(("Measured Exposure",
                    f'{exp_val}" — current metric standard dimensions'))
            elif 5.75 < exp_val <= 6.0:
                # IKO Advantage — could be any age
                data_points.append(("Measured Exposure",
                    f'{exp_val}" — consistent with IKO Advantage proprietary size'))

    # Step 3: Product identification dating
    # Known discontinued product timelines
    _PRODUCT_TIMELINES = {
        ("gaf", "timberline hd"): 2020,
        ("gaf", "timberline 30"): 2008,
        ("gaf", "royal sovereign"): 2023,
        ("certainteed", "xt25"): 2019,
        ("certainteed", "xt30"): 2019,
    }

    status = product_intel.get("status", "")
    disc_year = product_intel.get("discontinuation_year")
    mfr_lower = mfr.lower() if mfr else ""
    prod_lower = product_name.lower() if product_name else ""

    if disc_year:
        try:
            disc_yr = int(disc_year)
            min_ages.append(current_year - disc_yr)
        except (TypeError, ValueError):
            pass
    elif mfr_lower and prod_lower:
        for (m, p), yr in _PRODUCT_TIMELINES.items():
            if m in mfr_lower and p in prod_lower:
                min_ages.append(current_year - yr)
                break
    elif "discontinued" in status.lower() and not disc_year:
        pass  # Known discontinued but no date — can't use

    # Step 4: Property year built
    year_built = prop.get("year_built") or prop.get("year_built_OPTIONAL")
    if year_built:
        try:
            yb = int(year_built)
            building_age = current_year - yb
            data_points.append(("Property Built", f"{yb} per public records"))
            # Don't push as min_age unless no other evidence — roof may have been replaced
            if not min_ages:
                min_ages.append(building_age)
        except (TypeError, ValueError):
            pass

    # Step 5: Combine evidence → best estimate
    if min_ages:
        estimated_age = max(min_ages)
    elif is_three_tab:
        estimated_age = 18  # Conservative default for three-tab
    elif is_laminate:
        estimated_age = 12  # Conservative default for architectural
    else:
        return None, ""

    estimated_age = max(1, round(estimated_age))
    install_year = current_year - estimated_age

    # Condition assessment row
    condition = struct.get("shingle_condition", "")
    if condition:
        data_points.append(("Condition Assessment", f"{condition}, consistent with approximately {estimated_age} years of service"))
    else:
        data_points.append(("Condition Assessment",
            f"Physical condition consistent with approximately {estimated_age} years of service"))

    # Build reasoning HTML
    rows_html = ""
    for label, finding in data_points:
        rows_html += f'<tr><td><strong>{label}</strong></td><td>{finding}</td></tr>\n'

    reasoning_html = f'''<div class="info-box" style="margin-bottom:14pt;">
<h3 style="margin-top:0;">Roof System Age Analysis</h3>
<p>Based on field measurements and product identification, the existing roof system age
is estimated as follows:</p>
<table>
<tr><th style="width:35%">Data Point</th><th>Finding</th></tr>
{rows_html}</table>
<p><strong>Estimated Roof Age: Approximately {estimated_age} years</strong> (installed circa {install_year})</p>
</div>\n'''

    return estimated_age, reasoning_html


_WEAR_TEAR_KEYWORDS = ["wear", "aging", "deteriorat", "maintenance", "pre-existing", "inherent vice"]


def _has_wear_tear_argument(config):
    """Check if carrier arguments contain wear/tear/aging keywords."""
    carrier_args = config.get("carrier", {}).get("carrier_arguments", [])
    for arg in carrier_args:
        arg_lower = arg.lower()
        if any(kw in arg_lower for kw in _WEAR_TEAR_KEYWORDS):
            return True
    return False


def _build_wear_tear_rebuttal(config):
    """Build wear & tear rebuttal HTML — 'not mutually exclusive' framing.

    Used by both Doc 3 (Supplement Report) and Doc 4 (Appeal Letter).
    Returns HTML string (empty if no wear/tear argument detected).
    """
    if not _has_wear_tear_argument(config):
        return ""

    findings = config.get("forensic_findings", {})
    structures = config.get("structures", [{}])
    age = None
    age_was_estimated = False
    if structures:
        age = structures[0].get("age")
    if not age:
        age = config.get("scoring", {}).get("photo_analysis", {}).get("estimated_age")
    if not age:
        est_age, est_reasoning = _estimate_roof_age(config)
        if est_age:
            age = est_age
            age_was_estimated = True
    age_str = f"{age}-year-old" if age else "existing"

    # Core rebuttal text
    html = f"""<div class="info-box">
<strong>Wear and Aging Do Not Negate Covered Storm Damage</strong>
<p>Normal wear and aging are expected on any {age_str} roof system and do not negate covered storm damage.
This claim is filed for direct physical loss caused by hail and wind &mdash; not for wear and tear.
<strong>Wear and storm damage are not mutually exclusive.</strong> A roof can simultaneously exhibit age-related
granule erosion AND distinct hail impact damage. The carrier&rsquo;s obligation is to cover the storm damage
regardless of pre-existing cosmetic wear.</p>
"""

    # Add differentiation table evidence where conclusion = "CONSISTENT"
    diff_table = findings.get("differentiation_table", [])
    storm_entries = [d for d in diff_table if "consistent" in d.get("conclusion", "").lower()
                     and any(kw in d.get("cause", "").lower() for kw in ["hail", "wind", "storm"])]
    if storm_entries:
        html += "<p><strong>Differentiation Evidence:</strong></p>\n<ul>\n"
        for entry in storm_entries:
            html += f'<li><strong>{entry["cause"]}:</strong> {entry.get("observed", "")} &mdash; <em>{entry["conclusion"]}</em></li>\n'
        html += "</ul>\n"

    html += "</div>\n"

    # Age reasoning HTML — show how age was determined when estimated
    if age_was_estimated and est_reasoning:
        html += est_reasoning

    # Threshold aging chart — shows hail exceeded threshold even for aged products
    threshold_html = _build_threshold_aging_chart(config)
    if threshold_html:
        html += threshold_html

    # Repairability section if exposure data available
    repair_html, has_repair = _build_repairability_section(config)
    if has_repair:
        html += repair_html

    return html


def _build_assoc_logos_footer():
    """Build small row of association logos for document footers."""
    logos = [
        ("apa_logo", "APA"),
        ("haag_logo", "HAAG"),
        ("nrca_logo", "NRCA"),
        ("gaf_logo", "GAF"),
        ("oc_logo", "Owens Corning"),
    ]
    imgs = []
    for basename, alt in logos:
        b64 = get_assoc_logo_b64(basename)
        if b64:
            imgs.append(f'<img src="{b64}" alt="{alt}" style="height:22pt;width:auto;margin:0 6pt;opacity:0.7;">')

    if not imgs:
        return ""

    return f"""<div style="text-align:center;margin:16pt 0 8pt 0;padding-top:10pt;border-top:1px solid #e5e7eb;">
{"".join(imgs)}
</div>
"""


# ===================================================================
# ===================================================================
# SHARED: Canonical line item sort order (used by Doc 2 + Doc 3)
# ===================================================================

# Tom's prescribed Xactimate build order — shared between estimate and scope comparison
# CANONICAL_ORDER removed — replaced by regex-based _ROOFING_ORDER + _SIDING_ORDER
# inside canonical_sort_key() below.


def canonical_sort_key(item_name):
    """Return sort index for canonical Xactimate build order.
    Uses Tom's prescribed order — specific keyword patterns checked
    in priority order so 'starter strip' matches before 'shingle'."""
    desc = item_name.lower().strip()

    # Roofing items — check most specific patterns first
    _ROOFING_ORDER = [
        (0, [r"\bremove\b", r"\btear\s*(off|out)\b", r"\bdetach\b"]),  # Remove roof
        (1, [r"\bcomp\s*shingle\b", r"\blaminated\b.*roofing", r"\b3[- ]tab\b.*roofing",
             r"\bslate\s+roofing\b", r"\btile\s+roofing\b", r"\bmetal\s+roof",
             r"\bbitumen\b", r"\bwood\s+shake\b", r"\bcedar\s+shake\b"]),  # Install roof material
        (2, [r"\bunderlayment\b", r"\bfelt\b"]),  # Underlayment / felt
        (3, [r"\bice\s*[&and]+\s*water\b", r"\bi&w\b", r"\bi ?w ?s\b"]),  # I&W
        (4, [r"\bdrip\s+edge\b"]),
        (5, [r"\bstarter\s*(strip|course)?\b"]),
        (6, [r"\bridge\s+cap\b", r"\bhip\s*[&and]+\s*ridge\b"]),
        (7, [r"\bridge\s+vent\b"]),
        (8, [r"\bvalley\s+(flash|metal)\b"]),
        (9, [r"\bstep\s+flash\b"]),
        (10, [r"\bcounter\s*flash\b", r"\bapron\s+flash\b"]),
        (11, [r"\bchimney\s+flash\b"]),
        (12, [r"\bpipe\s+(boot|jack|collar)\b", r"\bplumbing\s+vent\b"]),
        (13, [r"\bexhaust\s+(vent|cap)\b", r"\bbox\s+vent\b", r"\broof\s+vent\b",
              r"\bpower\s+(fan|vent)\b", r"\bturtle\s+vent\b"]),
        (14, [r"\bskylight\b"]),
        (15, [r"\bsteep\b", r"\b[79]\/?12\b", r"\b1[0-2]\/?12\b"]),
        (16, [r"\bhigh\s+roof\b", r"\b[23]\s*stor"]),
        (17, [r"\broofer\b", r"\broofing\s+labor\b", r"(?<!siding\s)\blabor\s+min"]),
        (18, [r"\bequipment\s+operator\b"]),
        (19, [r"\bgable\s+cornice\b"]),
        (20, [r"\bdumpster\b", r"\bdebris\b", r"\bhaul\b"]),
        (21, [r"\bgutter\b", r"\bdownspout\b"]),
    ]

    _SIDING_ORDER = [
        (30, [r"\bsiding\b(?!.*labor)"]),  # R&R siding material (not siding labor)
        (31, [r"\bhouse\s*wrap\b", r"\btyvek\b", r"\bair.moisture\b"]),
        (32, [r"\bfanfold\b", r"\binsulation\s+board\b", r"\bfoam\s+board\b"]),
        (33, [r"\bwindow\s*(wrap|trim)\b", r"\bwrap\s+wood\s+window\b"]),
        (34, [r"\bdoor\s*(frame\s+)?wrap\b", r"\bdoor\s+trim\b"]),
        (35, [r"\bwall\s+flash\b"]),
        (36, [r"\bshutter\b"]),
        (37, [r"\bsiding\s+labor\b", r"\bsiding.*labor\s+min"]),
        (38, [r"\bscaffold"]),
    ]

    # Check roofing patterns — skip remove patterns for siding/gutter/window removes
    for order, patterns in _ROOFING_ORDER:
        if order == 0:  # Remove — only for roofing removes
            if any(s in desc for s in ["siding", "gutter", "window", "door"]):
                continue
        for pat in patterns:
            if re.search(pat, desc):
                return order
    # Check siding patterns
    for order, patterns in _SIDING_ORDER:
        for pat in patterns:
            if re.search(pat, desc):
                return order
    return 50  # Unknown items sort to the middle


# ===================================================================
# DOCUMENT 2: XACTIMATE-STYLE ESTIMATE
# ===================================================================

def _resolve_market_provenance(config):
    """Resolve the Xactimate market for Doc 02's provenance footer ONLY.

    Ship 3: this function NO LONGER prices anything. Per the B.7 Single-Snapshot
    Scope Principle, build_line_items (processor) is the SOLE owner of unit_price —
    it freezes the relational price (get_prices_for_market keyed by short_key) onto
    every line. The generator TRUSTS those frozen prices and never re-resolves or
    re-prices. The old fuzzy `lookup_price(desc)` overlay (refresh + fill) silently
    DISAGREED with the frozen relational price — e.g. it re-priced standard shingle
    to the high-grade rate ($269.32→$306.46) — so it was deleted. Price decisions
    live in get_prices_for_market; scope decisions in build_line_items; the generator
    only renders.

    Returns {market_code, market_name} for the "Priced from ..." footer.
    Resolution order:
      1. financials.market_code — authoritative metro set once in process_claim.
         NEVER read price_list as the resolver: it is a derived DISPLAY label that
         silently downgrades to the state default (Houston→Dallas, E202/E210 class).
      2. Legacy financials.price_list ONLY if it is itself a real market key.
      3. XactRegistry.resolve_market(state, zip, city) from property fields.
      4. Fail-fast (raise) if none — DO NOT silently default to NY.
    """
    from xactimate_lookup import XactRegistry, DEFAULT_MARKETS, _get_all_markets

    fin = config.get("financials", {}) or {}
    prop = config.get("property", {}) or {}
    available_markets = _get_all_markets().get("markets", {})
    market_code = fin.get("market_code")
    if not market_code:
        legacy = fin.get("price_list")
        if legacy and legacy in available_markets:
            market_code = legacy

    def _upgrade_or_fallback(stale_code, prop_dict):
        if stale_code and stale_code in available_markets:
            return stale_code, "exact"
        if stale_code and len(stale_code) >= 6:
            prefix = stale_code[:6]
            candidates = sorted(c for c in available_markets if c.startswith(prefix))
            if candidates:
                return candidates[-1], f"upgraded from {stale_code}"
        state = (prop_dict.get("state") or "").upper().strip()
        if state and state in DEFAULT_MARKETS:
            return DEFAULT_MARKETS[state], f"state-default for {state}"
        return None, "unresolved"

    if not market_code:
        state = (prop.get("state") or "").upper().strip()
        if not state:
            raise ValueError(
                "Cannot resolve Xactimate market: claim_config has no "
                "financials.market_code and no property.state."
            )
        market_code = XactRegistry.resolve_market(
            state=state,
            zip_code=prop.get("zip"),
            city=prop.get("city"),
        )
        print(f"  [pricing] derived market {market_code} from state={state}/{prop.get('city')}")

    if market_code not in available_markets:
        upgraded, how = _upgrade_or_fallback(market_code, prop)
        if not upgraded:
            raise ValueError(
                f"Cannot resolve Xactimate market: '{market_code}' not in all-markets.json "
                f"and no fallback available."
            )
        print(f"  [pricing] {market_code} not in all-markets.json — using {upgraded} ({how})")
        market_code = upgraded

    market_name = (available_markets.get(market_code) or {}).get("name", "")
    print(f"  [pricing] Doc 02 reads FROZEN relational prices (no overlay); "
          f"provenance market={market_code} ({market_name})")
    return {"market_code": market_code, "market_name": market_name}


def _billed_scope_label(items, scope_trades) -> str:
    """The estimate's 'Scope' header must reflect the trades actually BILLED, not
    just requested. scope_trades can carry a trade (e.g. 'gutters') that produced
    no line items, leaving a "Roofing, Gutters" label over a roofing-only estimate.
    Returns the requested trades that appear in the line items, title-cased; falls
    back to the full requested scope when there are NO line items (estimate-pending)."""
    billed = {
        (it.get("trade") or it.get("category") or "").lower()
        for it in (items or [])
        if (it.get("trade") or it.get("category"))
    }
    scope_trades = scope_trades or []
    display = [t for t in scope_trades if t.lower() in billed] if billed else scope_trades
    return ", ".join(t.title() for t in display)


def build_xactimate_estimate(config):
    """Build Xactimate-style line-item estimate with @page margin:0 fix."""
    lang = get_language(config)
    print(f"Building X Style Build Scope... [role: {lang['role']}]")

    # Ship 3: resolve the market for the provenance FOOTER only. Prices are already
    # frozen on the line_items by build_line_items (relational, by short_key) — the
    # generator does NOT overlay/re-price (deleted: the fuzzy lookup_price refresh
    # that re-priced standard shingle to the high-grade rate).
    # If neither market_code nor state is set, log + continue with the frozen prices.
    _pricing_meta = {}
    try:
        _pricing_meta = _resolve_market_provenance(config) or {}
    except ValueError as e:
        print(f"  [pricing] WARNING: {e}")
        print(f"  [pricing] continuing with frozen line-item prices (no provenance footer)")

    # Ship 0.4 — market provenance shown on the estimate so a reader can tell
    # exactly which market priced it (no more silent Houston-as-Dallas).
    from xactimate_lookup import _get_all_markets as _gam
    _price_list_version = _gam().get("priceListVersion", "")
    _prov_market_code = _pricing_meta.get("market_code") or config.get("financials", {}).get("market_code", "")
    _prov_market_name = _pricing_meta.get("market_name") or ""
    if _prov_market_code:
        _provenance = f"Priced from {_prov_market_name or _prov_market_code} ({_prov_market_code})"
        if _price_list_version:
            _provenance += f" — Xactimate {_price_list_version}"
    else:
        _provenance = ""

    logo_b64 = get_logo_b64(config)
    prop = config["property"]
    ins = config["insured"]
    carrier = config["carrier"]
    dates = config["dates"]
    company = config["company"]
    financials = config.get("financials", {})
    scope = config.get("scope", {})
    measurements = config.get("measurements", {})
    items = config.get("line_items", [])
    # Filter out zero-quantity lines + install-supplement items (Doc 02 = INITIAL estimate
    # only; scope_timing='install_supplement' items surface in the supplement, not here).
    items = [item for item in items if item.get("qty", 0) > 0 and _is_initial_scope(item)]

    fin = compute_financials(config)

    # WS-5 GUARD 4 — estimate-pending. A forensic-only / pre-scope claim with no
    # measurements AND no priced initial-scope line items would render a $0
    # line-item table + $0 TOTAL RCV — which reads as "we estimate this is worth
    # nothing." Per E252 the doc must NEVER be dropped; instead we emit an
    # explicit "ESTIMATE PENDING — upload measurements" notice in place of the
    # zero-value tables. When ANY priced line item exists we render normally.
    _ws5_estimate_pending = (not ws5_has_measurements(config)) and (not items)

    # WS-5 GUARD (identity header) — reuse Doc-01 Guard-3 predicates so a
    # placeholder-owner / no-data claim never renders "Property Owner" or a
    # blank "Carrier / Claim:  — " / "Policy:" row. Full-data is byte-identical.
    doc2_identity_rows = ws5_identity_table_rows(
        config, combined_carrier_claim=True, include_policy=True
    )

    # Build line items table — grouped by structure, then by category, sorted by canonical order
    line_rows = ""

    # Compute category subtotals for summary
    cat_totals = {}
    for item in items:
        trade = item.get("trade", item.get("category", "other")).lower()
        ext = round(item["qty"] * item["unit_price"], 2)
        cat_totals[trade] = cat_totals.get(trade, 0) + ext

    # Group items by structure (preserving insertion order — Python 3.7+)
    structure_groups = {}
    for item in items:
        struct = item.get("structure", "")
        structure_groups.setdefault(struct, []).append(item)

    has_multiple_structures = any(k != "" for k in structure_groups)

    _CAT_ORDER = {"ROOFING": 0, "SIDING": 1, "GUTTERS": 2, "INTERIOR": 3, "GENERAL": 4, "DEBRIS": 5}
    for struct_name, struct_items in structure_groups.items():
        # Sort items within structure: by category FIRST (all roofing together, all siding together),
        # then by canonical build order within each category. Prevents interleaved subtotals.
        struct_items.sort(key=lambda x: (
            _CAT_ORDER.get(x.get("category", "").upper(), 99),
            canonical_sort_key(x.get("description", ""))
        ))
        struct_total = sum(round(it["qty"] * it["unit_price"], 2) for it in struct_items)

        # Structure header (only for multi-structure claims)
        if has_multiple_structures and struct_name:
            # Try to get roof SQ from first remove item
            roof_sq = ""
            for it in struct_items:
                if re.search(r'\b(?:remove|tear)', it.get("description", "").lower()) and it.get("unit", "") == "SQ":
                    roof_sq = f" ({it['qty']} SQ)"
                    break
            line_rows += f"""<tr style="background:#0d2137;color:white;">
                <td colspan="6" style="font-weight:700;font-size:10pt;padding:8pt 6pt;">{struct_name.upper()}{roof_sq}</td>
            </tr>\n"""

        # Render items by category with subtotals
        current_cat = ""
        cat_subtotal = 0.0
        for idx, item in enumerate(struct_items):
            cat = item.get("category", "")
            desc = item["description"]
            qty = item["qty"]
            unit = item["unit"]
            price = item["unit_price"]
            ext = round(qty * price, 2)
            code = item.get("code", "")

            next_cat = struct_items[idx + 1].get("category", "") if idx + 1 < len(struct_items) else ""

            cat_cell = f'<td style="font-weight:700;color:#0d2137;">{cat}</td>' if cat != current_cat else '<td></td>'
            if cat != current_cat:
                cat_subtotal = 0.0
            current_cat = cat
            cat_subtotal += ext

            line_rows += f"""<tr>
                {cat_cell}
                <td>{code + " — " if code else ""}{desc}</td>
                <td class="amt">{qty}</td>
                <td>{unit}</td>
                <td class="amt">{fmt_money(price)}</td>
                <td class="amt">{fmt_money(ext)}</td>
            </tr>\n"""

            if next_cat != cat:
                line_rows += f"""<tr style="background:#e8edf2;border-top:1px solid #0d2137;">
                <td colspan="5" style="text-align:right;padding-right:12pt;font-weight:600;font-size:9pt;color:#0d2137;">{cat} SUBTOTAL</td>
                <td class="amt" style="font-weight:700;color:#0d2137;">{fmt_money(cat_subtotal)}</td>
            </tr>\n"""

        # Structure subtotal (only for multi-structure)
        if has_multiple_structures and struct_name:
            line_rows += f"""<tr style="background:#c8d6e5;border-top:2px solid #0d2137;">
                <td colspan="5" style="text-align:right;padding-right:12pt;font-weight:700;font-size:10pt;color:#0d2137;">{struct_name.upper()} SUBTOTAL</td>
                <td class="amt" style="font-weight:700;font-size:10pt;color:#0d2137;">{fmt_money(struct_total)}</td>
            </tr>\n"""

    # Summary
    trades_str = ", ".join(t.title() for t in scope.get("trades", []))
    # Gutter-label fix: the header "Scope" must show BILLED trades, not a requested
    # trade (e.g. "gutters") that produced no line items. See _billed_scope_label.
    scope_display_str = _billed_scope_label(items, scope.get("trades", []))
    o_and_p_note = scope.get("o_and_p_note", "")

    # WS-5 GUARD 4 — assemble the estimate body. The verified/priced branch is
    # byte-identical to the prior inline markup; the estimate-pending branch
    # replaces the $0 line-item + summary + comparison tables with a notice.
    _eagleview_no = measurements.get('eagleview_report_number', '')
    if _ws5_estimate_pending:
        estimate_body = '''<h2>LINE ITEMS</h2>
<div class="highlight-box" style="border-left:4px solid #c8102e;">
<strong>ESTIMATE PENDING — measurements required.</strong> No roof measurements
(EagleView/HOVER) or carrier-scope quantities have been attached to this claim
yet, so a line-item replacement-cost estimate cannot be priced. Upload an
EagleView or HOVER measurement report (or the carrier's scope of loss) and this
estimate will be generated automatically at current Xactimate pricing for the
applicable region. The enclosed Forensic Causation Report documents the
storm-related damage observed during the field inspection.
</div>'''
    else:
        estimate_body = f"""<h2>LINE ITEMS</h2>
<table>
    <tr><th>Category</th><th>Description</th><th class="amt">Qty</th><th>Unit</th><th class="amt">Unit Price</th><th class="amt">Extension</th></tr>
    {line_rows}
    <tr class="total-row">
        <td colspan="5"><strong>LINE ITEM TOTAL</strong></td>
        <td class="amt"><strong>{fmt_money(fin['line_total'])}</strong></td>
    </tr>
</table>

<div class="page-break"></div>

<h2>ESTIMATE SUMMARY</h2>
<table>
    <tr><th>Item</th><th class="amt">Amount</th></tr>
    <tr><td>Line Item Total</td><td class="amt">{fmt_money(fin['line_total'])}</td></tr>
    <tr><td>Tax ({fin['tax_rate']*100:g}%)</td><td class="amt">{fmt_money(fin['tax'])}</td></tr>
    {"<tr><td>Overhead & Profit (10% + 11%)</td><td class='amt'>" + fmt_money(fin['o_and_p_amount']) + "</td></tr>" if fin['o_and_p'] else ""}
    <tr class="grand-total">
        <td><strong>TOTAL RCV</strong></td>
        <td class="amt" style="font-size:14pt;"><strong>{fmt_money(fin['total_with_op'])}</strong></td>
    </tr>
</table>

<h3>{lang['comparison_header']}</h3>
<table>
    <tr><th></th><th class="amt">{carrier['name']}</th><th class="amt">{company['name']}</th><th class="amt">Variance</th></tr>
    <tr class="section-total"><td><strong>RCV</strong></td><td class="amt"><strong>{fmt_money(fin['carrier_rcv'])}</strong></td><td class="amt"><strong>{fmt_money(fin['total_with_op'])}</strong></td><td class="amt variance-positive"><strong>+{fmt_money(fin['variance'])}</strong></td></tr>
</table>

<div class="highlight-box">
<strong>NOTE ON OVERHEAD &amp; PROFIT:</strong> {"O&P (10% + 11%) is included — " + str(len(scope.get('trades',[]))) + " trades involved (" + trades_str + ")." if fin['o_and_p'] else (o_and_p_note or "O&P (10% + 11%) is not applied — this scope involves fewer than 3 trades.")}
</div>

<div class="highlight-box">
<strong>PRICING NOTE:</strong> {_provenance + ". " if _provenance else ""}All line items priced per Xactimate — {financials.get('price_list', '')} pricing region. Quantities from EagleView Report #{_eagleview_no}. Final scope may be adjusted based on conditions discovered during tear-off and installation.
</div>"""

    # WS-5 GUARD 4 — property block "EagleView Report" row. In the estimate-
    # pending posture show an honest "pending" instead of a bare "#"; otherwise
    # preserve the prior "#<number-or-empty>" rendering exactly (byte-identical).
    if _ws5_estimate_pending:
        eagleview_row_html = '    <tr><td><strong>EagleView Report</strong></td><td>Pending — measurements not yet uploaded</td></tr>'
    else:
        eagleview_row_html = f'    <tr><td><strong>EagleView Report</strong></td><td>#{_eagleview_no}</td></tr>'

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>X Style Build Scope -- {prop['address']}</title>
<style>
{CSS_COMMON}
/* CRITICAL: @page margin:0 override for full-bleed header bar */
@page {{ margin: 0; }}
body {{ margin: 0; padding: 0; }}
.header-bar {{
    margin: 0;
    width: 100%;
    padding: 24pt 0.85in;
}}
.content {{
    padding: 0 0.85in 0.75in 0.85in;
}}
</style>
</head>
<body>

<div class="header-bar">
    {render_logo_block(logo_b64, company['name'], css_class='logo-img')}
    <div class="header-text">
        <div class="company">{company['name']}</div>
        <h1>X STYLE BUILD SCOPE</h1>
        <div class="subtitle">Line-Item Scope of Repairs &mdash; {prop['address']}</div>
    </div>
</div>

<div class="content">

<table>
    <tr><th style="width:35%">Field</th><th>Detail</th></tr>
{doc2_identity_rows}    <tr><td><strong>Price List</strong></td><td>{financials.get('price_list', '')}{f" &mdash; {_prov_market_name} ({_prov_market_code})" if _prov_market_name else ""}</td></tr>
    <tr><td><strong>Date of Loss</strong></td><td>{dates['date_of_loss']}</td></tr>
    <tr><td><strong>Scope</strong></td><td>{scope_display_str}</td></tr>
{eagleview_row_html}
</table>

{estimate_body}

{_build_integrity_stamp(config)}

{_build_contractor_cert(config)}
{_build_uppa_disclaimer(config)}

{_build_assoc_logos_footer()}

<div class="footer-sig">
    <div class="name">{company['ceo_name']}</div>
    <div class="title">{company['ceo_title']}</div>
    <div>{company['cell_phone']} | {company['email']}</div>
</div>

</div><!-- end .content -->
</body>
</html>"""

    path = os.path.join(config["_paths"]["output"], "02_XACTIMATE_ESTIMATE.html")
    with open(path, "w") as f:
        f.write(html)
    return path


# ===================================================================
# DOCUMENT 3: SUPPLEMENT REPORT
# ===================================================================

def build_supplement_report(config):
    """Build supplement/scope comparison report — carrier scope cross-reference.

    Overhauled: evidence linking, dollar amounts, wear/tear rebuttal,
    argument weighting with critical_observations as styled subsections,
    threshold charts, repairability, association logos.
    """
    lang = get_language(config)
    print(f"Building {lang['doc3_title'].title()}... [role: {lang['role']}]")

    logo_b64 = get_logo_b64(config)
    prop = config["property"]
    ins = config["insured"]
    carrier = config["carrier"]
    dates = config["dates"]
    company = config["company"]
    findings = config["forensic_findings"]
    scope = config.get("scope", {})
    line_items = config.get("line_items", [])

    fin = compute_financials(config)

    # WS-5 GUARD (identity header) — reuse Doc-01 Guard-3 predicates. The
    # property block interleaves the address row between owner and carrier, so
    # build the two identity rows individually (same predicates as the helper):
    #  - owner row suppressed on placeholder owner
    #  - combined "Carrier / Claim" row suppressed only in a no-data posture
    #    when BOTH carrier name and claim number are blank.
    # Full-data renders both rows verbatim (byte-identical).
    _doc3_owner_ph = ws5_owner_is_placeholder(config)
    _doc3_nodata_id = ws5_nodata_identity(config)
    doc3_owner_row = (
        "" if _doc3_owner_ph
        else f"    <tr><td><strong>Property Owner</strong></td><td>{ins['name']}</td></tr>\n"
    )
    _doc3_cc_blank = ws5_blank(carrier.get('name')) and ws5_blank(carrier.get('claim_number'))
    doc3_carrier_row = (
        "" if (_doc3_nodata_id and _doc3_cc_blank)
        else f"    <tr><td><strong>Carrier / Claim</strong></td><td>{carrier['name']} — {carrier['claim_number']}</td></tr>\n"
    )

    # ── USARM-first scope comparison ──
    # Our estimate drives the row order (Xactimate build order).
    # For each USARM line item, find the best matching carrier item.
    # Unmatched carrier items are appended at the end.

    # Use pre-computed comparison rows from pre_match_scope_comparison()
    # These already have carrier matching, intent detection, qty variance, and code citations done.
    comparison_rows = carrier.get("carrier_line_items", [])
    variance_rows = ""
    row_num = 0

    for row in comparison_rows:
        row_num += 1
        matched_by = row.get("matched_by", "")
        status = row.get("status", "")

        # Item description (checklist or USARM)
        item_desc = row.get("checklist_desc") or row.get("usarm_desc", "")
        ev_qty = row.get("ev_qty", "")
        ev_unit = row.get("ev_unit", "")

        # Contractor column (our estimate)
        contractor_col = item_desc
        usarm_amt = row.get("usarm_amount", 0)
        if ev_qty and ev_unit:
            contractor_col += f" ({ev_qty} {ev_unit})"

        # Dollar amounts
        usarm_amt_str = fmt_money(usarm_amt) if usarm_amt else "&mdash;"

        # Carrier column
        carrier_desc = row.get("carrier_desc", "")
        carrier_amt = row.get("carrier_amount", 0) or 0
        carrier_amt_str = fmt_money(carrier_amt) if carrier_amt else "&mdash;"
        carrier_qty = row.get("carrier_qty", "")
        carrier_unit = row.get("carrier_unit", "")

        if matched_by in ("missing", "") and (not carrier_desc or carrier_desc == "NOT INCLUDED"):
            carrier_col = "&mdash;"
        else:
            carrier_col = carrier_desc if carrier_desc else "&mdash;"
            if carrier_qty and carrier_unit:
                carrier_col += f" ({carrier_qty} {carrier_unit})"

        # Variance note
        note = row.get("note", "")
        trick = row.get("trick_flag", "")
        if trick and trick not in note:
            note = f"{note}. {trick}" if note else trick

        # Status-based styling
        if status == "missing":
            var_class = ' class="var-pos"'
            if not note:
                note = "NOT INCLUDED by carrier"
                code_cit = row.get("code_citation")
                irc = row.get("irc_code", "")
                if code_cit and isinstance(code_cit, dict):
                    note += f" — required per {code_cit.get('code_tag', '')}"
                elif irc:
                    note += f" — required per {irc}"
        elif status == "under":
            var_class = ' class="var-pos"'
        elif status == "carrier_only":
            var_class = ''
            contractor_col = "&mdash;"
            usarm_amt_str = "&mdash;"
            note = row.get("note", "Carrier-only item")
        else:
            var_class = ""

        variance_rows += f"""<tr>
            <td>{row_num}</td>
            <td><strong>{item_desc}</strong></td>
            <td>{carrier_col}</td>
            <td class="amt">{carrier_amt_str}</td>
            <td>{contractor_col}</td>
            <td class="amt">{usarm_amt_str}</td>
            <td{var_class}>{note}</td>
        </tr>\n"""

    # Code violations section (below comparison table)
    code_violations_html = ""
    code_violations = findings.get("code_violations", [])
    if code_violations:
        code_violations_html = '<h2>CODE VIOLATIONS IDENTIFIED</h2>\n<table style="font-size:8pt;">\n'
        code_violations_html += '<tr><th>Code</th><th>Requirement</th><th>Status</th></tr>\n'
        for cv in code_violations:
            code_violations_html += f'<tr><td>{cv["code"]}</td><td>{cv["requirement"]}</td><td style="color:#c8102e;font-weight:700;">{cv["status"]}</td></tr>\n'
        code_violations_html += '</table>\n'

    # Material damage threshold section
    damage_threshold_html = ""
    weather = config.get("weather", {})
    damage_thresholds = weather.get("damage_thresholds") or findings.get("damage_thresholds", [])
    if damage_thresholds:
        damage_threshold_html = '<h2>MATERIAL DAMAGE THRESHOLDS</h2>\n<table style="font-size:8pt;">\n'
        damage_threshold_html += '<tr><th>Component</th><th>Hail Size Threshold</th><th>Reported Hail</th><th>Result</th></tr>\n'
        for dt in damage_thresholds:
            result = dt.get("result", "")
            result_style = ' style="color:#c8102e;font-weight:700;"' if "exceed" in result.lower() or "damage" in result.lower() else ''
            damage_threshold_html += f'<tr><td>{dt.get("component", dt.get("material", ""))}</td><td>{dt.get("threshold", "")}</td><td>{dt.get("reported", dt.get("hail_size", ""))}</td><td{result_style}>{result}</td></tr>\n'
        damage_threshold_html += '</table>\n'

    # Carrier arguments / position summary
    carrier_args = carrier.get("carrier_arguments", [])
    carrier_args_html = ""
    for i, arg in enumerate(carrier_args, 1):
        carrier_args_html += f"<li>{arg}</li>\n"

    # Wear & tear rebuttal (conditional — after carrier position, before variance table)
    wear_tear_html = ""
    if _has_wear_tear_argument(config):
        wear_tear_html = "<h2>WEAR AND AGING DO NOT NEGATE COVERED STORM DAMAGE</h2>\n"
        wear_tear_html += _build_wear_tear_rebuttal(config)

    # Variance summary table (94 Theron has pre-computed, we use if available)
    variance_summary_html = ""
    if config.get("supplement_variance_summary"):
        variance_summary_html += '<h2>VARIANCE SUMMARY</h2>\n<table>\n'
        variance_summary_html += f'<tr><th>Category</th><th class="amt">Carrier RCV</th><th class="amt">{company["name"]} RCV</th><th class="amt">Variance</th></tr>\n'
        for vs in config["supplement_variance_summary"]:
            var_amt = vs.get("variance", 0)
            var_class = ' class="amt var-pos"' if var_amt > 0 else ' class="amt"'
            variance_summary_html += f'<tr><td>{vs["category"]}</td><td class="amt">{fmt_money(vs.get("carrier",0))}</td><td class="amt">{fmt_money(vs.get("usarm",0))}</td><td{var_class}>{"+" if var_amt > 0 else ""}{fmt_money(var_amt)}</td></tr>\n'
        variance_summary_html += f'<tr class="section-total"><td><strong>TOTAL</strong></td><td class="amt"><strong>{fmt_money(fin["carrier_rcv"])}</strong></td><td class="amt"><strong>{fmt_money(fin["total_with_op"])}</strong></td><td class="amt" style="color:#c8102e;font-size:12pt;"><strong>+{fmt_money(fin["variance"])}</strong></td></tr>\n'
        variance_summary_html += '</table>\n'
    else:
        # Build a simple variance summary
        variance_summary_html += f"""<h2>VARIANCE SUMMARY</h2>
<table>
    <tr><th></th><th class="amt">{carrier['name']}</th><th class="amt">{company['name']}</th><th class="amt">Variance</th></tr>
    <tr class="section-total"><td><strong>RCV</strong></td><td class="amt"><strong>{fmt_money(fin['carrier_rcv'])}</strong></td><td class="amt"><strong>{fmt_money(fin['total_with_op'])}</strong></td><td class="amt variance-positive"><strong>+{fmt_money(fin['variance'])}</strong></td></tr>
</table>
"""

    # Key arguments — structured narrative with argument weighting
    key_args = findings.get("key_arguments", [])
    key_args_html = ""

    # Critical observations get full subsections with visual weight
    critical_obs = findings.get("critical_observations", [])
    if critical_obs:
        for obs in critical_obs:
            key_args_html += f"""<div class="info-box" style="margin-bottom:14pt;">
<h3 style="margin-top:0;">{obs["title"]}</h3>
<p>{obs["content"]}</p>
</div>\n"""

    # Auto-inject repairability section if data exists and not already in critical_observations
    repair_html, has_repair = _build_repairability_section(config)
    repair_titles = [obs.get("title", "").lower() for obs in critical_obs]
    if has_repair and not any("repair" in t or "exposure" in t for t in repair_titles):
        key_args_html += f"""<div class="info-box" style="margin-bottom:14pt;">
<h3 style="margin-top:0;">Method of Repair Analysis</h3>
{repair_html}
</div>\n"""

    # Supporting evidence — compact bullet list
    if key_args:
        key_args_html += "<h3>Supporting Evidence</h3>\n<ul>\n"
        for arg in key_args:
            key_args_html += f"<li>{arg}</li>\n"
        key_args_html += "</ul>\n"

    # O&P note
    o_and_p_note = scope.get("o_and_p_note", "")
    trades_str = ", ".join(t.title() for t in scope.get("trades", []))

    # Adjuster info
    adjuster_info = carrier.get("claim_rep_name", "")
    if carrier.get("claim_rep_phone"):
        adjuster_info += f" ({carrier['claim_rep_phone']})"

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Supplement Report -- {prop['address']}</title>
<style>
{CSS_COMMON}
/* CRITICAL: @page margin:0 override for full-bleed header bar */
@page {{ margin: 0; }}
body {{ margin: 0; padding: 0; }}
.header-bar {{
    margin: 0;
    width: 100%;
    padding: 24pt 0.85in;
}}
.content {{
    padding: 0 0.85in 0.75in 0.85in;
}}
td.var-pos {{ color: #c8102e; font-weight: 700; }}
</style>
</head>
<body>

<div class="header-bar">
    {render_logo_block(logo_b64, company['name'], css_class='logo-img')}
    <div class="header-text">
        <div class="company">{company['name']}</div>
        <h1>{lang['doc3_title']}</h1>
        <div class="subtitle">{lang['doc3_subtitle']}</div>
    </div>
</div>

<div class="content">

<table>
    <tr><th style="width:35%">Field</th><th>Detail</th></tr>
{doc3_owner_row}    <tr><td><strong>Property</strong></td><td>{prop['address']}</td></tr>
{doc3_carrier_row}    <tr><td><strong>Date of Loss</strong></td><td>{dates['date_of_loss']}</td></tr>
    <tr><td><strong>Adjuster</strong></td><td>{adjuster_info}</td></tr>
    <tr><td><strong>Carrier Scope Date</strong></td><td>{dates.get('carrier_inspection_date', carrier.get('inspection_date', ''))}</td></tr>
    <tr><td><strong>Supplement Date</strong></td><td>{dates['report_date']}</td></tr>
</table>

<h2>PURPOSE</h2>
<p>{lang['doc3_purpose'].format(carrier=carrier['name'], company=company['name'])}</p>

<div class="{lang['carrier_scope_box']}">
<strong>{carrier['name']}'s scope totals {fmt_money(fin['carrier_rcv'])} RCV. Our scope totals {fmt_money(fin['total_with_op'])} RCV &mdash; a {lang['variance_label'].lower()} of {fmt_money(fin['variance'])}.</strong>
</div>

<h2>{lang['doc3_carrier_header']}</h2>
<p>{lang['doc3_carrier_intro'].format(carrier=carrier['name'])}</p>
<ol>
{carrier_args_html}
</ol>

{wear_tear_html}

<div style="margin-top:24pt;"></div>

<h2>LINE-BY-LINE VARIANCE</h2>
<table style="font-size:8pt;">
    <tr><th style="width:3%">#</th><th style="width:16%">Line Item</th><th style="width:20%">{carrier['name']}</th><th style="width:8%" class="amt">{carrier['name']} $</th><th style="width:20%">{company['name']}</th><th style="width:8%" class="amt">{company['name']} $</th><th style="width:25%">Variance &amp; Justification</th></tr>
    {variance_rows}
</table>

{code_violations_html}
{damage_threshold_html}

<div style="margin-top:24pt;"></div>

{variance_summary_html}

<h2>O&amp;P NOTE</h2>
<p>{"Overhead & Profit (10% + 11%) is included — " + str(len(scope.get('trades',[]))) + " trades involved (" + trades_str + ")." if fin['o_and_p'] else "Overhead & Profit (O&P) is <strong>not included</strong>. " + o_and_p_note}</p>

<h2>KEY ARGUMENTS</h2>
{key_args_html}

{_build_uppa_disclaimer(config)}

{_build_assoc_logos_footer()}

<div class="footer-sig">
    <div class="name">{company['ceo_name']}</div>
    <div class="title">{company['ceo_title']} | {dates['report_date']}</div>
</div>

</div><!-- end .content -->
</body>
</html>"""

    path = os.path.join(config["_paths"]["output"], f"{lang['doc3_filename']}.html")
    with open(path, "w") as f:
        f.write(html)
    return path


# ===================================================================
# DOCUMENT 4: DENIAL APPEAL LETTER
# ===================================================================

def build_appeal_letter(config):
    """Build appeal letter (advocate) or scope clarification letter (contractor).

    Overhauled: dynamic section builder, threshold chart, wear/tear rebuttal,
    repairability section, association logos.
    """
    lang = get_language(config)
    print(f"Building {lang['doc4_title'].title()}... [role: {lang['role']}]")

    logo_b64 = get_logo_b64(config)
    prop = config["property"]
    ins = config["insured"]
    carrier = config["carrier"]
    dates = config["dates"]
    company = config["company"]
    weather = config["weather"]
    findings = config["forensic_findings"]
    appeal = config.get("appeal_letter", {})
    scope = config.get("scope", {})

    fin = compute_financials(config)

    # Compute total_photos with fallback
    _total_photos = findings.get("total_photos", 0)
    if not _total_photos:
        _total_photos = len(config.get("photo_annotations", {}))
    _total_photos_str = str(_total_photos) if _total_photos else "multiple"

    # Code violations table
    code_rows = ""
    for cv in findings.get("code_violations", []):
        code_rows += f'<tr><td>{cv["code"]}</td><td>{cv["requirement"]}</td><td style="color:#c8102e;font-weight:700;">{cv["status"]}</td></tr>\n'

    # Demand items (filter regulatory citations for contractor roles)
    regulatory_terms = ["NYCRR", "§ 2601", "§2601", "Department of Financial Services", "DFS"]
    demand_html = ""
    for di in appeal.get("demand_items", []):
        if not lang["regulatory_citations"] and any(rt in di for rt in regulatory_terms):
            continue
        demand_text = di.replace("$0.00 RCV", fmt_money(fin['total_with_op']) + " RCV")
        if lang["action_verb"] != "demand":
            demand_text = demand_text.replace("demand", "request").replace("Demand", "Request")
        demand_html += f"<li><strong>{demand_text}</strong></li>\n"

    # Enclosed documents (handle string-with-newlines, list-of-strings, and {name, detail} formats)
    enclosed = appeal.get("enclosed_documents", [])
    if isinstance(enclosed, str):
        enclosed = [line.strip() for line in enclosed.replace("\\n", "\n").split("\n") if line.strip()]
    enclosed_html = ""
    for doc in enclosed:
        if isinstance(doc, dict):
            enclosed_html += f"<li><strong>{doc['name']}</strong> — {doc.get('detail', '')}</li>\n"
        else:
            enclosed_html += f"<li>{doc}</li>\n"

    key_args = findings.get("key_arguments", [])
    fa = findings.get("fieldassist_findings")

    # =====================================================
    # DYNAMIC SECTION BUILDER — sections auto-assemble
    # based on what evidence exists for THIS claim
    # =====================================================
    sections = []  # List of (title, html_content) tuples

    # WS-5 GUARD 5 — Doc 04 storm-verification section. The original asserted
    # "THE STORM EVENT IS VERIFIED AND UNDISPUTED" with HailTrace ID + algorithmic
    # hail unconditionally; on a non-weather-verified claim those fields are empty
    # and the headline overclaims. Gate on weather_verified (prod shape).
    _ws5_wx = ws5_weather_verified(config)

    # 1. Storm verification (verified branch byte-identical to prior markup)
    if _ws5_wx:
        storm_html = f"""<ul>
    <li><strong>HailTrace Forensic Weather Verification (Report ID: {weather.get('hailtrace_id','')}):</strong> {weather.get('verification_method','')} {weather.get('hail_size_algorithm','')} hail at the property coordinates on {weather['storm_date']}.</li>
"""
        if weather.get("hail_size_nws_reports"):
            for rpt in weather["hail_size_nws_reports"][:2]:
                storm_html += f'    <li><strong>NWS:</strong> {rpt.get("size","")} hail reported in {rpt.get("location","")} at {rpt.get("time","")}.</li>\n'
        if weather.get("nws_warning_tag"):
            storm_html += f'    <li><strong>NWS Severe Thunderstorm Warning:</strong> "{weather["nws_warning_tag"]}" damage threat tag.</li>\n'
        for evt in weather.get("additional_events", []):
            storm_html += f'    <li><strong>Additional event:</strong> {evt["detail"]} on {evt["date"]}.</li>\n'
        if carrier.get("carrier_acknowledged_items"):
            storm_html += f'    <li><strong>{carrier["name"]}\'s own scope acknowledges hail damage</strong> to roof components, confirming hail struck this property.</li>\n'
        storm_html += "</ul>\n"

        # Inject threshold aging chart after storm verification when data available
        threshold_html = _build_threshold_aging_chart(config)
        if threshold_html:
            storm_html += "<p>The confirmed hail size significantly exceeds the research-backed damage threshold for this property's roofing product:</p>\n"
            storm_html += threshold_html

        sections.append(("THE STORM EVENT IS VERIFIED AND UNDISPUTED", storm_html))
    else:
        storm_html = "<ul>\n"
        storm_html += (
            f"    <li><strong>Field inspection findings:</strong> the enclosed "
            f"Forensic Causation Report documents storm-consistent damage observed "
            f"at the property"
            + (f" (date of loss: {dates['date_of_loss']})" if dates.get('date_of_loss') else "")
            + ".</li>\n"
        )
        if carrier.get("carrier_acknowledged_items"):
            storm_html += f'    <li><strong>{carrier["name"]}\'s own scope acknowledges hail damage</strong> to roof components, confirming hail struck this property.</li>\n'
        storm_html += "</ul>\n"
        storm_html += (
            "<p>Independent storm verification (NOAA/NWS storm data, hail-size "
            "confirmation) is being supplemented and will be provided to corroborate "
            "the field findings above.</p>\n"
        )
        sections.append(("STORM-RELATED DAMAGE IS DOCUMENTED", storm_html))

    # 2. Conditional: FieldAssist contradiction
    if fa:
        fa_html = f"""<p>{carrier.get('inspector_company','')} inspector {carrier.get('inspector_name','')}, who inspected on {carrier.get('inspection_date','')}, documented:</p>
<ul>
    <li><strong>"Potentially Covered Damage: Yes"</strong></li>
    <li><strong>Granular loss on {len(fa.get('slopes_with_granular_loss',[]))} slopes</strong> ({', '.join(fa.get('slopes_with_granular_loss',[]))})</li>
"""
        if fa.get("damaged_exhaust_vents", {}).get("count"):
            fa_html += f'    <li><strong>{fa["damaged_exhaust_vents"]["count"]} damaged exhaust vent(s)</strong> (not included in carrier\'s scope)</li>\n'
        if fa.get("wind_damaged_shingles", {}).get("count"):
            fa_html += f'    <li><strong>{fa["wind_damaged_shingles"]["count"]} wind-damaged shingles on Facet {fa["wind_damaged_shingles"]["facet"]}</strong></li>\n'
        fa_html += "</ul>\n"
        fa_html += "<p>Yet the carrier's scope ignores the inspector's own findings of covered damage across the entire roof.</p>\n"
        sections.append(("THE CARRIER'S OWN INSPECTOR CONFIRMED COVERED DAMAGE", fa_html))

        # Test square unreliability
        test_square_html = '<p>The FieldAssist report shows "0 hail" in test squares while simultaneously confirming granular loss on those same slopes. This is internally contradictory. Test squares are a supplemental tool -- when they contradict the inspector\'s broader findings, the overall assessment must govern.</p>\n'
        sections.append(("THE TEST SQUARE RESULTS ARE UNRELIABLE", test_square_html))

    # 3. Conditional: Logical inconsistency (carrier acknowledged some damage, no FA)
    elif carrier.get("carrier_acknowledged_items"):
        inconsistency_html = f"""<p>{carrier['name']} approved hail damage to metal roof accessories while simultaneously finding "No storm related damage" to the shingles on the same roof slopes. This position is physically untenable:</p>
<ul>
    <li>Metal vents require <strong>greater</strong> impact force to damage than asphalt shingles.</li>
    <li>All components were exposed to the <strong>same storm at the same time</strong>.</li>
</ul>
"""
        sections.append(("THE CARRIER'S SCOPE CONTAINS A FATAL LOGICAL INCONSISTENCY", inconsistency_html))

    # 4. Conditional: Wear & tear rebuttal
    if _has_wear_tear_argument(config):
        wt_html = _build_wear_tear_rebuttal(config)
        if wt_html:
            sections.append(("WEAR AND AGING DO NOT NEGATE COVERED STORM DAMAGE", wt_html))

    # 5. Conditional: Unrepairable product
    repair_html, has_repair = _build_repairability_section(config)
    if has_repair:
        sections.append(("THE EXISTING PRODUCT CANNOT BE REPAIRED", repair_html))

    # 6. Always: Documentation evidence
    photo_html = f"""<p>Our inspection documentation ({_total_photos_str} photos) documents: circular shingle indentations with granule displacement and mat fracture, meeting HAAG Engineering criteria for functional damage requiring replacement.</p>
"""
    sections.append((f"THE DAMAGE IS DOCUMENTED WITH {_total_photos_str.upper()} INSPECTION PHOTOS", photo_html))

    # 7. Conditional: Spot repair inadequacy
    if fa or carrier.get("carrier_acknowledged_items"):
        spot_html = """<ul>
    <li>Damage is documented on all slopes, not isolated to a single area</li>
    <li>New shingles cannot color-match weathered existing shingles</li>
    <li>Spot repair does not address the widespread granular loss</li>
    <li>Manufacturer warranty cannot be maintained with patchwork repair</li>
    <li>Per-shingle pricing is non-standard; Xactimate uses per-SQ pricing</li>
</ul>
"""
        sections.append(("SPOT REPAIR IS INADEQUATE", spot_html))

    # 8. Conditional: Inconsistent claim handling
    if any("same street" in arg.lower() for arg in key_args):
        inconsistent_html = f"""<p>{carrier['name']} has approved hail damage claims from the same storm for other properties in the area. Denying this claim while approving identical storm damage at neighboring properties raises concerns about equitable claim handling.</p>
"""
        sections.append(("INCONSISTENT CLAIM HANDLING", inconsistent_html))

    # 9. Always: Code compliance
    code_html = f"""<table style="font-size:9.5pt;">
    <tr><th>Code Section</th><th>Requirement</th><th>Status</th></tr>
    {code_rows}
</table>
"""
    sections.append((("CODE-REQUIRED COMPONENTS ARE OMITTED" if lang["regulatory_citations"] else "CODE-REQUIRED COMPONENTS"), code_html))

    # 10. Always: Demand
    demand_section_html = f"""<p>We respectfully {lang['action_verb']} that {carrier['name']}:</p>
<ol>
{demand_html}
</ol>
"""
    sections.append((("DEMAND AND REQUESTED ACTION" if lang["regulatory_citations"] else "REQUESTED ACTION"), demand_section_html))

    # 11. Always: Enclosed documentation
    enclosed_section_html = f"""<ol>
{enclosed_html}
</ol>
"""
    sections.append(("ENCLOSED DOCUMENTATION", enclosed_section_html))

    # Auto-number with roman numerals
    roman = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"]
    appeal_body = ""
    for i, (title, content) in enumerate(sections):
        numeral = roman[i] if i < len(roman) else str(i + 1)
        appeal_body += f"<h2>{numeral}. {title}</h2>\n{content}\n"

    # Closing
    appeal_body += f"""
<p>We trust that a thorough review of the enclosed documentation will demonstrate that the {dates['date_of_loss']} storm caused damage warranting the full scope of repairs outlined herein. We look forward to a prompt and equitable resolution.</p>

<p>Respectfully,</p>
"""

    # CC line
    cc_line = appeal.get("cc", "")
    if not cc_line and appeal.get("cc_recipients"):
        cc_line = ", ".join(appeal["cc_recipients"])

    # Build contact line conditionally — small contractors often have one phone,
    # not an office + cell pair. Empty values must not render as "None" or blank labels.
    _contact_bits = []
    _office = (company.get("office_phone") or "").strip()
    _cell = (company.get("cell_phone") or "").strip()
    _email = (company.get("email") or "").strip()
    if _office:
        _contact_bits.append(f"Office: {_office}")
    if _cell:
        _contact_bits.append(f"Cell: {_cell}" if _office else _cell)
    if _email:
        _contact_bits.append(_email)
    contact_line = " | ".join(_contact_bits)

    # WS-5 GUARD (identity header) — reuse Doc-01 Guard-3 predicates for the RE:
    # block's Claim Number / Policy Number / Property Owner lines. Owner line is
    # suppressed on a placeholder owner; Claim/Policy lines are suppressed only in
    # a no-data posture when blank. Full-data renders all three lines verbatim
    # (byte-identical). Each emitted line keeps its trailing "<br>\n".
    _doc4_owner_ph = ws5_owner_is_placeholder(config)
    _doc4_nodata_id = ws5_nodata_identity(config)
    doc4_id_lines = ""
    if not (_doc4_nodata_id and ws5_blank(carrier.get('claim_number'))):
        doc4_id_lines += f"<strong>Claim Number:</strong> {carrier['claim_number']}<br>\n"
    if not (_doc4_nodata_id and ws5_blank(carrier.get('policy_number', ''))):
        doc4_id_lines += f"<strong>Policy Number:</strong> {carrier.get('policy_number', '')}<br>\n"
    if not _doc4_owner_ph:
        doc4_id_lines += f"<strong>Property Owner:</strong> {ins['name']}<br>\n"
    # WS-5 GUARD (blank carrier) — drop the recipient-address carrier-name line when
    # blank so the "To" block never opens with a dangling empty line. Real carrier
    # renders "{name}<br>\n" verbatim (byte-identical).
    _doc4_recipient_name = "" if ws5_blank(carrier['name']) else f"{carrier['name']}<br>\n"

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{lang['doc4_title']} -- {prop['address']}</title>
<style>
{CSS_COMMON}
body {{ font-size: 11pt; line-height: 1.6; }}
h2 {{ font-size: 13pt; }}
</style>
</head>
<body>

<div style="text-align:center; margin-bottom:20pt;">
    {render_logo_block(logo_b64, company['name'], css_class='logo-img', inline_style='height:60pt; width:auto; margin-bottom:8pt;')}<br>
    <div style="font-size:18pt; font-weight:800; color:#0d2137; letter-spacing:2pt;">{company['name']}</div>
    <div style="font-size:9pt; color:#666;">{company['address']} | {company['city_state_zip']}<br>
    {contact_line}</div>
</div>

<hr style="border:none; border-top:2px solid #0d2137; margin:16pt 0;">

{_build_assoc_logos_footer()}

<p><strong>{dates['report_date']}</strong></p>

<p>{_doc4_recipient_name}Claims Department<br>
{carrier.get('claims_email', '')}</p>

<p><strong>RE: {appeal.get('subject_line', lang['doc4_subject_default'])}</strong><br>
{doc4_id_lines}<strong>Property:</strong> {prop['address']}<br>
<strong>Date of Loss:</strong> {dates['date_of_loss']}<br>
{"<strong>Adjuster:</strong> " + carrier.get('claim_rep_name','') + ("<br>" if carrier.get('claim_rep_name') else "")}
</p>

<hr style="border:none; border-top:1px solid #ccc; margin:16pt 0;">

<p>{appeal.get('salutation', 'Dear Claims Examiner:')}</p>

<p>{_build_appeal_opening(config, fin)}</p>

{appeal_body}

{_build_contractor_cert(config)}
{_build_uppa_disclaimer(config)}

{_build_assoc_logos_footer()}

<div class="footer-sig">
    <div class="name">{company['ceo_name']}</div>
    <div class="title">{company['ceo_title']}</div>
    <div>{company['cell_phone']} | {company['email']}</div>
</div>

{"<p style='margin-top:12pt; font-size:9.5pt;'><strong>cc:</strong> " + cc_line + "</p>" if cc_line else ""}

</body>
</html>"""

    path = os.path.join(config["_paths"]["output"], f"{lang['doc4_filename']}.html")
    with open(path, "w") as f:
        f.write(html)
    return path


# ===================================================================
# DOCUMENT 5: COVER EMAIL
# ===================================================================

# ===================================================================
# PHASE 1: PRE-SCOPE COVER LETTER (sent before carrier inspection)
# ===================================================================

def build_cover_letter(config):
    """Build Phase 1 cover letter — sent to carrier with forensic report + estimate BEFORE adjuster inspection."""
    lang = get_language(config)
    print(f"Building Cover Letter (Pre-Scope)... [role: {lang['role']}]")

    logo_b64 = get_logo_b64(config)
    prop = config["property"]
    ins = config["insured"]
    carrier = config["carrier"]
    dates = config["dates"]
    company = config["company"]
    weather = config["weather"]
    findings = config["forensic_findings"]
    cover = config.get("cover_letter", config.get("cover_email", {}))

    fin = compute_financials(config)
    _price_list = config.get("financials", {}).get("price_list", "NYBI26")

    # Compute total_photos with fallback
    _total_photos = findings.get("total_photos", 0)
    if not _total_photos:
        _total_photos = len(config.get("photo_annotations", {}))
    _total_photos_str = str(_total_photos) if _total_photos else "multiple"

    # WS-5 GUARD 5 — pre-scope cover letter weather + measurement assertions.
    _ws5_wx = ws5_weather_verified(config)
    _ws5_meas = ws5_has_measurements(config)

    # WS-5 GUARD (identity salutation) — reuse Doc-01 Guard-3 placeholder
    # predicate. On a placeholder owner, the salutation uses a neutral noun
    # phrase ("the property owner", unwrapped) so the letter never reads
    # "retained by <strong>Property Owner</strong>" / "represents the insured,
    # <strong>Property Owner</strong>". For a real owner this is byte-identical
    # to the prior "<strong>{ins['name']}</strong>" rendering.
    if ws5_owner_is_placeholder(config):
        _cover_owner_html = "the property owner"
    else:
        _cover_owner_html = f"<strong>{ins['name']}</strong>"

    # Storm summary — only assert a "confirmed severe weather event" when the
    # claim is actually weather-verified (prod shape). Otherwise soften to a
    # "reported" event so the letter doesn't claim verification it lacks.
    if _ws5_wx:
        storm_summary = f"""a confirmed severe weather event on {dates['date_of_loss']}"""
    else:
        _dol = dates.get('date_of_loss', '')
        storm_summary = (
            f"""a reported severe weather event on {_dol}"""
            if _dol else
            """a reported severe weather event at the property (date of loss pending confirmation)"""
        )
    if weather.get("hail_size_algorithm"):
        storm_summary += f""", with HailTrace-verified {weather['hail_size_algorithm']} algorithmic hail impacting the property"""
    if weather.get("hail_size_nws_reports"):
        nws_sizes = [r["size"] for r in weather["hail_size_nws_reports"][:1]]
        storm_summary += f""" and NWS Local Storm Reports documenting {nws_sizes[0]} hail in the area"""
    if weather.get("duration"):
        storm_summary += f""" over a {weather['duration']} exposure window"""

    # Enclosed documents for Phase 1 (handle both list and string-with-newlines formats)
    # WS-5 GUARD 5 — only list the HailTrace / EagleView attachments in the
    # default manifest when the claim is actually weather-verified / measured.
    # Listing an "EagleView Property Measurement Report" we never attached makes
    # the cover letter misrepresent its own enclosures.
    enclosed_html = ""
    _default_enclosed = [
        "Forensic Causation Report with photo-annotated damage analysis",
        f"Xactimate-format repair estimate ({_price_list} pricing)",
    ]
    if _ws5_wx:
        _default_enclosed.append("HailTrace Weather Verification Report")
    if _ws5_meas:
        _default_enclosed.append("EagleView Property Measurement Report")
    enclosed_docs = cover.get("enclosed_documents", _default_enclosed)
    if isinstance(enclosed_docs, str):
        enclosed_docs = [line.strip() for line in enclosed_docs.replace("\\n", "\n").split("\n") if line.strip()]
    for doc in enclosed_docs:
        if isinstance(doc, dict):
            enclosed_html += f"<li><strong>{doc['name']}</strong> — {doc.get('detail', '')}</li>\n"
        else:
            enclosed_html += f"<li><strong>{doc}</strong></li>\n"

    # Trades summary
    trades = config.get("scope", {}).get("trades", [])
    trades_text = ", ".join(trades) if trades else "roofing"

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Cover Letter -- {prop['address']}</title>
<style>
{CSS_COMMON}
body {{ font-size: 11pt; line-height: 1.7; max-width: 600pt; margin: 0 auto; }}
.email-header {{ background: #f5f5f5; padding: 12pt 16pt; border-radius: 4pt; margin-bottom: 16pt; font-size: 10pt; }}
.email-header .field {{ margin-bottom: 3pt; }}
.email-header .label {{ font-weight: 600; display: inline-block; width: 60pt; color: #555; }}
</style>
</head>
<body>

<div style="text-align:center; margin-bottom:16pt;">
    {render_logo_block(logo_b64, company['name'], css_class='logo-img', inline_style='height:50pt; width:auto; margin-bottom:8pt;')}<br>
    <div style="font-size:16pt; font-weight:800; color:#0d2137; letter-spacing:1pt;">COVER LETTER &mdash; PRE-INSPECTION SUBMISSION</div>
</div>

<div class="email-header">
    <div class="field"><span class="label">To:</span> {cover.get('to', carrier.get('claims_email', carrier.get('adjuster_email', '')))}</div>
    <div class="field"><span class="label">CC:</span> {cover.get('cc', ins.get('email', ''))}</div>
    <div class="field"><span class="label">Subject:</span> {cover.get('subject', 'Claim #' + carrier.get('claim_number','') + ' -- Forensic Documentation & Estimate -- ' + prop['address'])}</div>
</div>

<hr style="border:none; border-top:1px solid #ddd; margin:16pt 0;">

<p>Good afternoon,</p>

<p>{company['name'] + " represents the insured, " + _cover_owner_html + ", under an Assignment of Benefits" if lang["role"] == "advocate" else "We are the licensed contractor retained by " + _cover_owner_html + " for storm damage repairs"} for the property at <strong>{prop['address']}, {prop['city']}, {prop['state']} {prop['zip']}</strong> (Claim #{carrier.get('claim_number','pending')}, Date of Loss: {dates['date_of_loss']}).</p>

<p>We are submitting our forensic inspection documentation and detailed repair estimate in advance of the carrier's adjuster inspection. Our documentation confirms {storm_summary}.</p>

<p>Our certified inspection identified storm damage across <strong>{trades_text}</strong>, supported by {_total_photos_str} inspection photographs with forensic annotations. {("The enclosed Xactimate-format estimate totals <strong>" + fmt_money(fin['total_with_op']) + " RCV</strong> based on EagleView-verified measurements and current " + _price_list + " regional pricing.") if _ws5_meas else ("A detailed Xactimate-format estimate will follow once roof measurements are finalized; pricing will reflect current " + _price_list + " regional rates.")}</p>

<p>The enclosed documentation includes:</p>
<ol>
{enclosed_html}
</ol>

<p>We respectfully request that the assigned adjuster review our forensic findings during their field inspection. We are available for a joint inspection at the carrier's convenience and can be reached at the contact information below.</p>

<p>{"We request acknowledgment of receipt and adjuster response within 15 business days per 11 NYCRR 216.4(b)." if lang["regulatory_citations"] else "We request acknowledgment of receipt and adjuster response at your earliest convenience."}</p>

<p>Thank you for your prompt attention.</p>

<div class="footer-sig">
    <div class="name">{company['ceo_name']}</div>
    <div class="title">{company['ceo_title']}</div>
    <div>{company['cell_phone']} | {company['email']}</div>
    <div>{company.get('website', '')}</div>
</div>

</body>
</html>"""

    path = os.path.join(config["_paths"]["output"], "03_COVER_LETTER.html")
    with open(path, "w") as f:
        f.write(html)
    return path


# ===================================================================
# PHOTO EXTRACTION (optional — from CompanyCam PDF)
# ===================================================================

def extract_photos(config):
    """Extract photos from CompanyCam PDF using PyMuPDF (fitz)."""
    try:
        import fitz
    except ImportError:
        print("  PyMuPDF (fitz) not installed. Skipping photo extraction.")
        print("  Install with: pip3 install PyMuPDF")
        return

    source_docs = config["_paths"]["source_docs"]
    photos_dir = config["_paths"]["photos"]

    # Find CompanyCam PDF
    cc_pdf = config.get("source_docs", {}).get("companycam_pdf", "")
    pdf_path = os.path.join(source_docs, cc_pdf)

    if not os.path.exists(pdf_path):
        # Try to find any PDF with "companycam" in the name
        for f in os.listdir(source_docs):
            if "companycam" in f.lower() and f.endswith(".pdf"):
                pdf_path = os.path.join(source_docs, f)
                break

    if not os.path.exists(pdf_path):
        print(f"  CompanyCam PDF not found in {source_docs}")
        return

    print(f"  Extracting from: {os.path.basename(pdf_path)}")
    doc = fitz.open(pdf_path)
    count = 0

    for page_num in range(len(doc)):
        page = doc[page_num]
        img_list = page.get_images(full=True)
        img_idx = 0

        for img in img_list:
            xref = img[0]
            pix = fitz.Pixmap(doc, xref)

            if pix.width < 100 or pix.height < 100:
                pix = None
                continue

            img_idx += 1

            if pix.n > 4:  # CMYK
                pix = fitz.Pixmap(fitz.csRGB, pix)

            out_name = f"page{page_num+1:02d}_img{img_idx:02d}_{pix.width}x{pix.height}.jpeg"
            out_path = os.path.join(photos_dir, out_name)
            pix.save(out_path)
            count += 1
            pix = None

    doc.close()
    print(f"  Extracted {count} photos to {photos_dir}")


# ===================================================================
# MAIN
# ===================================================================

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 usarm_pdf_generator.py <path/to/claim_config.json>")
        print("Example: python3 usarm_pdf_generator.py claims/6-avon-rd/claim_config.json")
        sys.exit(1)

    config_path = sys.argv[1]
    if not os.path.exists(config_path):
        print(f"ERROR: Config file not found: {config_path}")
        sys.exit(1)

    config = load_config(config_path)

    # Validate required config fields before proceeding
    _validation_errors = []
    for _sect in ["property", "insured", "structures", "line_items", "photo_sections", "forensic_findings"]:
        if _sect not in config:
            _validation_errors.append(f"Missing required section: '{_sect}'")
    if "property" in config:
        for _f in ["address", "city", "state", "zip"]:
            if not config["property"].get(_f):
                _validation_errors.append(f"Missing property.{_f}")
    if "insured" in config and not config["insured"].get("name"):
        _validation_errors.append("Missing insured.name")
    if "structures" in config:
        if not isinstance(config["structures"], list) or len(config["structures"]) == 0:
            _validation_errors.append("structures must be a non-empty list")
    if "line_items" in config:
        if not isinstance(config["line_items"], list) or len(config["line_items"]) == 0:
            _validation_errors.append("line_items must be a non-empty list")
        else:
            for _i, _item in enumerate(config["line_items"][:3]):
                for _f in ["description", "qty", "unit_price"]:
                    if _f not in _item:
                        _validation_errors.append(f"line_items[{_i}] missing '{_f}'")
                        break
    if "forensic_findings" in config and not config["forensic_findings"].get("damage_summary"):
        _validation_errors.append("Missing forensic_findings.damage_summary")
    if _validation_errors:
        print("\n" + "=" * 60)
        print("CONFIG VALIDATION FAILED")
        print("=" * 60)
        for _err in _validation_errors:
            print(f"  - {_err}")
        print(f"\nTotal: {len(_validation_errors)} error(s). Fix the config and re-run.")
        sys.exit(1)
    print("Config validation: PASSED")

    prop = config["property"]

    # Determine phase
    phase = config.get("phase", "post-scope")

    # Determine role-based language
    lang = get_language(config)
    compliance = config.get("compliance", {})
    role_display = compliance.get("user_role", "contractor")
    has_aob = compliance.get("has_aob", True)

    print("=" * 60)
    print(f"USARM PDF GENERATOR — {prop['address']}")
    print(f"Phase: {phase.upper()}")
    print(f"Role: {role_display} {'(with AOB)' if has_aob and role_display == 'contractor' else ''}")
    print(f"Language: {lang['role']}")
    print(f"Trades: {', '.join(config.get('scope',{}).get('trades',[]))}")
    print("=" * 60)

    # Check for photos — extract if needed
    photos_dir = config["_paths"]["photos"]
    existing = glob.glob(os.path.join(photos_dir, "page*_img*_*.jpeg"))
    photo_map_count = len(config.get("photo_map", {}))
    if photo_map_count > 0:
        print(f"\nPhotos: {photo_map_count} mapped via photo_map")
    elif len(existing) < 5:
        print(f"\nOnly {len(existing)} photos found. Attempting extraction...")
        extract_photos(config)
    else:
        print(f"\nPhotos: {len(existing)} found in {photos_dir}")

    # Run fraud detection checks (optional — does not block generation)
    try:
        from fraud_detection.pipeline import run_fraud_checks
        config["_photos_dir"] = photos_dir
        slug = os.path.basename(os.path.dirname(config_path))
        integrity = run_fraud_checks(config, slug)
        integrity.print_summary()
        config["photo_integrity"] = integrity.to_dict()
    except ImportError:
        pass  # fraud_detection not installed — skip
    except Exception as e:
        print(f"\n  Photo integrity check error: {e}")

    # Check for logo
    logo = get_logo_b64(config)
    if logo:
        print("Logo: Found")
    else:
        print("WARNING: Logo not found in photos/ folder!")

    # Compute and display financials
    fin = compute_financials(config)
    print(f"\nFinancials:")
    print(f"  Line Total: {fmt_money(fin['line_total'])}")
    print(f"  Tax ({fin['tax_rate']*100:g}%): {fmt_money(fin['tax'])}")
    if fin['o_and_p']:
        print(f"  O&P: {fmt_money(fin['o_and_p_amount'])}")
    print(f"  Total RCV: {fmt_money(fin['total_with_op'])}")

    if phase == "post-scope":
        print(f"  Carrier RCV: {fmt_money(fin['carrier_rcv'])}")
        print(f"  Variance: +{fmt_money(fin['variance'])}")

    # Build HTML files based on phase
    print("\n" + "=" * 60)
    if phase == "pre-scope":
        print("PHASE 1: PRE-SCOPE — Building Forensic + Estimate + Cover Letter")
    else:
        print("PHASE 2: POST-SCOPE — Building Forensic + Estimate + Scope/Supplement + Appeal")
    print("=" * 60)

    html_files = []

    if phase == "pre-scope":
        # PHASE 1: Forensic Report + Xactimate Estimate + Cover Letter
        html_files.append(("Forensic Causation Report", build_forensic_report(config)))
        html_files.append(("Xactimate Estimate", build_xactimate_estimate(config)))
        html_files.append(("Cover Letter (Pre-Scope)", build_cover_letter(config)))
    else:
        # PHASE 2 (default): forensic + estimate + scope/supplement + appeal (names adapt to user role)
        html_files.append(("Forensic Causation Report", build_forensic_report(config)))
        html_files.append(("Xactimate Estimate", build_xactimate_estimate(config)))
        html_files.append((lang["doc3_title"].title(), build_supplement_report(config)))
        html_files.append((lang["doc4_title"].title(), build_appeal_letter(config)))

    # Document #6: Code Compliance Report.
    # WS-7 gating: PRICED mode when measurements OR a carrier scope is present;
    # otherwise build_compliance_report degrades to a REQUIREMENTS-ONLY supplement
    # (no qty/price/subtotal) + an upload notice. We still require at least one
    # code citation (build_compliance_report returns '' when there are none).
    try:
        from compliance_report import build_compliance_report, has_measurements, carrier_scope_present
        if has_measurements(config) or carrier_scope_present(config):
            compliance_html = build_compliance_report(config)
            if compliance_html:
                html_files.append(("Code Compliance Report", compliance_html))
    except Exception as e:
        print(f"[WARN] Code Compliance Report skipped: {e}")

    # Convert to PDF
    print("\n" + "=" * 60)
    print("CONVERTING HTML -> PDF (Chrome Headless)")
    print("=" * 60)

    output_dir = config["_paths"]["output"]
    for name, html_path in html_files:
        pdf_name = os.path.basename(html_path).replace(".html", ".pdf")
        pdf_path = os.path.join(output_dir, pdf_name)
        print(f"\n{name}:")
        html_to_pdf(html_path, pdf_path)

    # Summary
    print("\n" + "=" * 60)
    if phase == "pre-scope":
        print(f"PHASE 1 COMPLETE — 3 PDFs saved to:")
    else:
        print(f"PHASE 2 COMPLETE — {len(html_files)} PDFs saved to:")
    print(output_dir)
    print("=" * 60)

    for f in sorted(os.listdir(output_dir)):
        fp = os.path.join(output_dir, f)
        if f.endswith(".pdf"):
            print(f"  {f} ({os.path.getsize(fp):,} bytes)")

    if phase == "pre-scope":
        print(f"\nTotal RCV: {fmt_money(fin['total_with_op'])} | Phase: PRE-SCOPE (send to carrier before adjuster inspection)")
        print(f"Next step: When carrier scope is received, update config with carrier data and set phase to 'post-scope'")
    else:
        print(f"\nTotal RCV: {fmt_money(fin['total_with_op'])} | Carrier: {fmt_money(fin['carrier_rcv'])} | Variance: +{fmt_money(fin['variance'])}")
