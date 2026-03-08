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
    05_COVER_EMAIL.pdf

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


def get_logo_b64(config):
    """Return base64 data URI for the USARM logo."""
    logo_path = os.path.join(config["_paths"]["photos"], "usarm_logo.jpg")
    if not os.path.exists(logo_path):
        # Try alternate names
        for alt in ["usarm_logo.JPG", "usarm_logo.png", "logo.jpg", "logo.JPG"]:
            alt_path = os.path.join(config["_paths"]["photos"], alt)
            if os.path.exists(alt_path):
                logo_path = alt_path
                break
    if not os.path.exists(logo_path):
        return ""
    with open(logo_path, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    return f"data:image/jpeg;base64,{data}"


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


def compute_financials(config):
    """Compute all financial totals from line_items + tax_rate."""
    items = config.get("line_items", [])
    line_total = sum(round(it["qty"] * it["unit_price"], 2) for it in items)
    tax_rate = config.get("financials", {}).get("tax_rate", 0.08)
    tax = round(line_total * tax_rate, 2)
    rcv = round(line_total + tax, 2)

    trades = config.get("scope", {}).get("trades", [])
    o_and_p = len(trades) >= 3
    o_and_p_amount = 0
    if o_and_p:
        o_and_p_amount = round(line_total * 0.10 + line_total * 0.10, 2)

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
    if total_photos:
        return f"{total_photos} photographs were taken during the USARM inspection(s)."
    else:
        return "Photographs were taken during the USARM inspection(s)."


def _get_code_reference(config):
    """Return the appropriate building code reference based on property state."""
    state = config.get("property", {}).get("state", "").upper()
    if state == "NY":
        return "Residential Code of New York State (RCNYS)"
    else:
        return "International Residential Code (IRC)"


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

    if lang["role"] == "advocate":
        return f"We write on behalf of the insured, {ins['name']}, to formally supplement and appeal the scope of loss issued for the above-referenced claim. The carrier's scope totals {fmt_money(fin['carrier_rcv'])} RCV. We respectfully request that {carrier['name']} re-evaluate the claim and approve the full scope of necessary repairs totaling <strong>{fmt_money(fin['total_with_op'])} RCV</strong>."
    elif lang["role"] == "contractor_aob":
        return f"Per the executed Assignment of Benefits, we are submitting our updated contractor scope for the above-referenced claim. The current approval totals {fmt_money(fin['carrier_rcv'])} RCV. Our professional scope of work, based on forensic inspection, EagleView measurements, and current Xactimate pricing, totals <strong>{fmt_money(fin['total_with_op'])} RCV</strong>."
    elif lang["role"] == "contractor":
        return f"As the licensed contractor engaged for repairs at the above property, we are submitting our professional scope of work for the above-referenced claim. Our scope, based on forensic inspection, EagleView measurements, and current Xactimate pricing, totals <strong>{fmt_money(fin['total_with_op'])} RCV</strong>."
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
.header-bar .logo-img { height: 52pt; width: auto; }
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
.cover-page .cover-logo { height: 80pt; width: auto; margin-bottom: 16pt; }
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

    # Skip for non-shingle roofs unless repairability data explicitly provided
    if not repairability:
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
            id_parts.append(f"Based on visual characteristics observed during the USARM field inspection, the existing roof system appears to be a <strong>{mfr} {product_name}</strong> {product_type_label} shingle")
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
                match = re.search(r'([\d.]+)', confirmed)
                if match:
                    max_hail = float(match.group(1))
                    break
            elif isinstance(confirmed, (int, float)):
                max_hail = float(confirmed)
                break

    if max_hail <= 0:
        return ""

    # Interpolate threshold based on age
    # New (0 yr) = 1.00", 15+ yr = 0.75" (linear interpolation, capped)
    new_threshold = 1.00
    aged_threshold = 0.75
    max_age = 15
    clamped_age = min(age, max_age)
    property_threshold = round(new_threshold - (new_threshold - aged_threshold) * (clamped_age / max_age), 3)

    exceeds = max_hail >= property_threshold
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


def _build_noaa_citation(weather):
    """Build NOAA data citation block for storm verification section."""
    noaa = weather.get("noaa")
    if not noaa:
        return ""

    html = '<h3>NOAA Storm Data (Official U.S. Government Source)</h3>\n'
    html += '<table>\n'
    html += '<tr><th style="width:35%">Parameter</th><th>Detail</th></tr>\n'

    if noaa.get("max_hail_inches", 0) > 0:
        html += f'<tr><td><strong>Maximum Hail Size</strong></td><td style="color:#c8102e;font-weight:700;">{noaa["max_hail_inches"]}" diameter</td></tr>\n'
    if noaa.get("max_wind_mph", 0) > 0:
        html += f'<tr><td><strong>Maximum Wind Speed</strong></td><td>{noaa["max_wind_mph"]} mph</td></tr>\n'
    html += f'<tr><td><strong>Events Found</strong></td><td>{noaa.get("event_count", 0)} storm events within {noaa.get("search_radius_miles", 10)} miles</td></tr>\n'
    html += f'<tr><td><strong>Data Retrieved</strong></td><td>{noaa.get("query_date", "")}</td></tr>\n'
    html += '</table>\n'

    # Individual events
    events = noaa.get("events", [])
    if events:
        html += '<h3>Confirmed Storm Events Near Property</h3>\n'
        html += '<table style="font-size:9pt;">\n'
        html += '<tr><th>Source</th><th>Type</th><th>Magnitude</th><th>Distance</th><th>Detail</th></tr>\n'
        for evt in events[:10]:  # Limit to top 10
            src = evt.get("source", "").replace("SWDI_", "").replace("SPC_", "SPC ")
            mag = f'{evt["magnitude"]}"' if evt.get("magnitude_type") == "hail_inches" else f'{evt["magnitude"]} mph'
            dist = f'{evt.get("distance_miles", 0):.1f} mi'
            detail = evt.get("source_detail", "")[:50]
            color = 'color:#c8102e;font-weight:700;' if evt.get("magnitude_type") == "hail_inches" else ''
            html += f'<tr><td>{src}</td><td>{evt.get("event_type", "")}</td><td style="{color}">{mag}</td><td>{dist}</td><td>{detail}</td></tr>\n'
        html += '</table>\n'

    # Verification URLs
    urls = noaa.get("query_urls", [])
    clean_urls = [u for u in urls if "error" not in u]
    if clean_urls:
        html += '<p style="font-size:8pt;color:#6b7280;">NOAA verification: '
        html += " | ".join(f'<a href="{u}" style="color:#0d2137;">[{i+1}]</a>' for i, u in enumerate(clean_urls))
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
                # Portal users: use insured name or company contact as fallback
                raw_inspector = ins.get("name", company.get("ceo_name", ""))
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

    # Build threshold aging chart (visual)
    threshold_aging_chart_html = _build_threshold_aging_chart(config)

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
        corroborating_html += '<p style="font-size:9pt;color:#4b5563;">Independent sources confirming storm activity at or near the property on the date of loss:</p>\n'
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
                corroborating_html += f' (<a href="{url}" style="color:#0d2137;">source</a>)'
            corroborating_html += '</div></div>\n'
        # Render other sources as table
        if other_reports:
            corroborating_html += '<table>\n<tr><th>Source Type</th><th>Title</th><th>Detail</th></tr>\n'
            for rpt in other_reports:
                title = rpt.get("title", "")
                url = rpt.get("url", "")
                snippet = rpt.get("snippet", "")
                source_type = rpt.get("source_type", "Web Report")
                link_html = f'<a href="{url}" style="color:#0d2137;">{title[:80]}</a>' if url else title[:80]
                corroborating_html += f'<tr><td><strong>{source_type}</strong></td><td>{link_html}</td><td style="font-size:8.5pt;">{snippet[:150]}</td></tr>\n'
            corroborating_html += '</table>\n'

    # --- Damage thresholds (check both weather and forensic_findings) ---
    thresholds_html = ""
    damage_thresholds = weather.get("damage_thresholds") or findings.get("damage_thresholds")
    if damage_thresholds:
        thresholds_html += '<h3>Damage Threshold Analysis</h3>\n<table>\n'
        thresholds_html += '<tr><th>Material</th><th>Damage Threshold</th><th>Confirmed Hail</th><th>Result</th></tr>\n'
        for dt in damage_thresholds:
            material = dt.get("material", dt.get("component", ""))
            confirmed = dt.get("confirmed_size", dt.get("storm_actual", ""))
            color = 'color:#c8102e;font-weight:700;' if 'EXCEEDS' in dt.get('result','') or 'EXCEEDED' in dt.get('result','') else ''
            thresholds_html += f'<tr><td>{material}</td><td>{dt["threshold"]}</td><td>{confirmed}</td><td style="{color}">{dt["result"]}</td></tr>\n'
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
    <tr><td><strong>Potentially Covered Damage</strong></td><td style="color:#c8102e;font-weight:700;">{"YES" if fa.get("potentially_covered_damage") else "No"}</td></tr>
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
            # Bold conclusion: green for CONSISTENT, red for NOT CONSISTENT/INCONSISTENT
            conclusion_val = row["conclusion"]
            if conclusion_val.upper() == "CONSISTENT":
                conclusion_cell = f'<strong style="color:#2e7d32;">{conclusion_val}</strong>'
            elif "NOT" in conclusion_val.upper() or "INCONSISTENT" in conclusion_val.upper():
                conclusion_cell = f'<strong style="color:#c8102e;">{conclusion_val}</strong>'
            else:
                conclusion_cell = conclusion_val
            # Bold cause column
            cause_cell = f'<strong>{row["cause"]}</strong>'
            # Bold observed: Yes=green, No=red
            observed_val = row["observed"]
            if observed_val.lower().startswith("yes"):
                observed_cell = f'<strong style="color:#2e7d32;">{observed_val}</strong>'
            elif observed_val.lower().startswith("no"):
                observed_cell = f'<strong style="color:#c8102e;">{observed_val}</strong>'
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

    # --- Code violations ---
    code_rows = ""
    for cv in findings.get("code_violations", []):
        code_rows += f'<tr><td>{cv["code"]}</td><td>{cv["requirement"]}</td><td style="color:#c8102e;font-weight:700;">{cv["status"]}</td></tr>\n'

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
            structures_table += f'<tr><td>{s["name"]}</td><td>{s.get("roof_area_sf","")} SF</td><td>{s.get("style","")}</td><td>{s.get("note","")}</td></tr>\n'
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

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Forensic Causation Report -- {prop['address']}</title>
<style>
{CSS_COMMON}
</style>
</head>
<body>

<!-- COVER PAGE -->
<div class="cover-page">
    <img src="{logo_b64}" alt="USA Roof Masters" class="cover-logo">
    <div class="cover-company">{company['name']}</div>
    <div class="cover-tagline">{company.get('tagline', '')}</div>
    <div style="width:60%; border-top:3px solid #c8102e; margin:0 auto 24pt;"></div>
    <div class="cover-title">FORENSIC CAUSATION REPORT</div>
    <div class="cover-subtitle">Proprietary Damage Assessment &amp; Causation Analysis</div>
    <div class="cover-info">
        <strong>Property:</strong> {prop['address']}<br>
        <strong>Property Owner:</strong> {ins['name']}<br>
        <strong>Date of Loss:</strong> {dates['date_of_loss']}<br>
        <strong>Inspection:</strong> {insp_dates_str}<br>
        <strong>Report Date:</strong> {dates['report_date']}
    </div>
    {"<div class='cover-assoc-logos'>" + ('<img src="' + apa_logo_b64 + '" alt="APA">' if apa_logo_b64 else '') + ('<img src="' + haag_logo_b64 + '" alt="HAAG">' if haag_logo_b64 else '') + ('<img src="' + nrca_logo_b64 + '" alt="NRCA">' if nrca_logo_b64 else '') + ('<img src="' + gaf_logo_b64 + '" alt="GAF Master Elite">' if gaf_logo_b64 else '') + ('<img src="' + oc_logo_b64 + '" alt="Owens Corning Platinum">' if oc_logo_b64 else '') + "</div>" if (apa_logo_b64 or nrca_logo_b64 or haag_logo_b64 or gaf_logo_b64 or oc_logo_b64) else ""}
</div>
<div class="page-break"></div>

<!-- TABLE OF CONTENTS -->
<h2>Table of Contents</h2>
{toc_html}
<div class="page-break"></div>

<!-- SECTION 1: PROPERTY & CLAIM INFO -->
<h2>1. Property &amp; Claim Information</h2>
<table>
    <tr><th style="width:35%">Field</th><th>Detail</th></tr>
    <tr><td><strong>Property Address</strong></td><td>{prop['address']}</td></tr>
    <tr><td><strong>Property Owner</strong></td><td>{ins['name']}{' (' + ins['type'] + ')' if ins.get('type','').lower() not in ('homeowner', 'property owner (homeowner)', 'property owner', '') else ''}</td></tr>
    <tr><td><strong>Carrier</strong></td><td>{carrier['name']}</td></tr>
    <tr><td><strong>Claim Number</strong></td><td>{carrier['claim_number']}</td></tr>
    <tr><td><strong>Policy Number</strong></td><td>{carrier.get('policy_number','')}</td></tr>
    <tr><td><strong>Date of Loss</strong></td><td>{dates['date_of_loss']}</td></tr>
    <tr><td><strong>Carrier Inspection</strong></td><td>{dates.get('carrier_inspection_date','')}</td></tr>
    <tr><td><strong>USARM Inspection</strong></td><td>{insp_dates_str}</td></tr>
    <tr><td><strong>USARM Inspector(s)</strong></td><td>{inspector_lines}</td></tr>
    <tr><td><strong>Report Date</strong></td><td>{dates['report_date']}</td></tr>
</table>

<h3>Roof System Specifications</h3>
<table>
    <tr><th style="width:35%">Specification</th><th>Detail</th></tr>
    <tr><td><strong>Structure</strong></td><td>{struct_name}</td></tr>
    <tr><td><strong>Total Roof Area</strong></td><td>{roof_sf:,} SF ({roof_sq} SQ)</td></tr>
    <tr><td><strong>Waste Factor</strong></td><td>{waste_pct}%</td></tr>
    <tr><td><strong>Area with Waste</strong></td><td>{roof_sq_waste} SQ</td></tr>
    <tr><td><strong>Facets</strong></td><td>{facets}</td></tr>
    <tr><td><strong>Predominant Pitch</strong></td><td>{pitch}</td></tr>
    <tr><td><strong>Style</strong></td><td>{style}</td></tr>
    <tr><td><strong>Shingle Type</strong></td><td>{shingle_type}</td></tr>
    <tr><td><strong>Condition</strong></td><td>{shingle_cond}</td></tr>
</table>

{structures_table}

{"<h3>Pitch Breakdown</h3><table><tr><th>Pitch</th><th>Area</th><th>%</th></tr>" + pitches_html + "</table>" if pitches_html else ""}

<!-- SECTION 2: EXECUTIVE SUMMARY -->
<div style="margin-top:24pt;"></div>
<h2>2. Executive Summary</h2>
{_build_executive_summary(findings)}

<!-- SECTION 3: STORM EVENT OVERVIEW -->
<div style="margin-top:24pt;"></div>
<h2>3. Storm Event Overview</h2>
<div class="success-box">
<strong>Storm Verified:</strong> {weather.get('storm_description', '')}
</div>

<table>
    <tr><th style="width:35%">Parameter</th><th>Detail</th></tr>
    <tr><td><strong>Storm Date</strong></td><td>{weather['storm_date']}</td></tr>
    <tr><td><strong>Hail Size (Algorithm)</strong></td><td>{weather.get('hail_size_algorithm', '')}</td></tr>
    <tr><td><strong>Hail Size (Meteorologist)</strong></td><td>{weather.get('hail_size_meteorologist', weather.get('hail_size_algorithm', ''))}</td></tr>
    <tr><td><strong>Verification</strong></td><td>{weather.get('verification_method', '')}</td></tr>
    <tr><td><strong>HailTrace Report</strong></td><td>ID: {weather.get('hailtrace_id', '')} — {weather.get('hailtrace_url', '')}</td></tr>
    <tr><td><strong>Coordinates</strong></td><td>{weather.get('coordinates', '')}</td></tr>
</table>

{noaa_citation_html}
{nws_html}
{corroborating_html}

{"<h3>Additional Weather Events</h3><table><tr><th>Date</th><th>Type</th><th>Detail</th></tr>" + additional_events_html + "</table>" if additional_events_html else ""}

{"<!-- PRIMARY DAMAGE OBSERVATIONS -->" + chr(10) + '<div style="margin-top:24pt;"></div>' + chr(10) + '<h2>' + preliminary_sec_num + '. Primary Damage Observations</h2>' + chr(10) + '<p>The following photographs represent initial observations of storm-related damage identified during the field inspection. These findings establish the presence and severity of impact damage across the property.</p>' + chr(10) + preliminary_html if has_preliminary else ""}

<!-- DAMAGE THRESHOLD ANALYSIS -->
<div style="margin-top:24pt;"></div>
<h2>{threshold_sec_num}. Damage Threshold Analysis</h2>
{thresholds_html if thresholds_html else '<p>Damage thresholds will be populated after NOAA weather data is applied. Run: <code>python3 -m noaa_weather apply</code></p>'}
{threshold_aging_chart_html}
{age_reasoning_html}

{fieldassist_html}

<!-- PHOTO SECTIONS -->
<div class="page-break"></div>
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
<table>
    <tr><th>Code Section</th><th>Requirement</th><th>Status in Carrier Scope</th></tr>
    {code_rows}
</table>

<!-- CONCLUSION -->
<div class="page-break"></div>
<h2>{conclusion_sec_num}. Conclusions &amp; Recommendations</h2>
{_build_conclusion_section(findings, arguments_html, conclusion_html, rec_scope_html)}

{_build_integrity_stamp(config)}

{_build_contractor_cert(config)}
{_build_uppa_disclaimer(config)}

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
# DOCUMENT 2: XACTIMATE-STYLE ESTIMATE
# ===================================================================

def build_xactimate_estimate(config):
    """Build Xactimate-style line-item estimate with @page margin:0 fix."""
    lang = get_language(config)
    print(f"Building X Style Build Scope... [role: {lang['role']}]")

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

    fin = compute_financials(config)

    # Build line items table with category grouping and category subtotals
    current_cat = ""
    cat_subtotal = 0.0
    line_rows = ""

    # Compute category subtotals for summary
    cat_totals = {}
    for item in items:
        trade = item.get("trade", item.get("category", "other")).lower()
        ext = round(item["qty"] * item["unit_price"], 2)
        cat_totals[trade] = cat_totals.get(trade, 0) + ext

    for idx, item in enumerate(items):
        cat = item.get("category", "")
        desc = item["description"]
        qty = item["qty"]
        unit = item["unit"]
        price = item["unit_price"]
        ext = round(qty * price, 2)
        code = item.get("code", "")

        # Check if next item changes category — if so, we need a subtotal row
        next_cat = items[idx + 1].get("category", "") if idx + 1 < len(items) else ""

        # Category header cell — show category name only on first row of each category
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

        # Insert category subtotal row when category changes or at end of items
        if next_cat != cat:
            line_rows += f"""<tr style="background:#e8edf2;border-top:1px solid #0d2137;">
            <td colspan="5" style="text-align:right;padding-right:12pt;font-weight:600;font-size:9pt;color:#0d2137;">{cat} SUBTOTAL</td>
            <td class="amt" style="font-weight:700;color:#0d2137;">{fmt_money(cat_subtotal)}</td>
        </tr>\n"""

    # Summary
    trades_str = ", ".join(t.title() for t in scope.get("trades", []))
    o_and_p_note = scope.get("o_and_p_note", "")

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
    <img src="{logo_b64}" alt="USA Roof Masters" class="logo-img">
    <div class="header-text">
        <div class="company">{company['name']}</div>
        <h1>X STYLE BUILD SCOPE</h1>
        <div class="subtitle">Line-Item Scope of Repairs &mdash; {prop['address']}</div>
    </div>
</div>

<div class="content">

<table>
    <tr><th style="width:35%">Field</th><th>Detail</th></tr>
    <tr><td><strong>Property Owner</strong></td><td>{ins['name']}</td></tr>
    <tr><td><strong>Carrier / Claim</strong></td><td>{carrier['name']} — {carrier['claim_number']}</td></tr>
    <tr><td><strong>Policy</strong></td><td>{carrier.get('policy_number','')}</td></tr>
    <tr><td><strong>Price List</strong></td><td>{financials.get('price_list', '')}</td></tr>
    <tr><td><strong>Date of Loss</strong></td><td>{dates['date_of_loss']}</td></tr>
    <tr><td><strong>Scope</strong></td><td>{trades_str}</td></tr>
    <tr><td><strong>EagleView Report</strong></td><td>#{measurements.get('eagleview_report_number', '')}</td></tr>
</table>

<h2>LINE ITEMS</h2>
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
    <tr><td>Tax ({fin['tax_rate']*100:.0f}%)</td><td class="amt">{fmt_money(fin['tax'])}</td></tr>
    {"<tr><td>Overhead & Profit (10% + 10%)</td><td class='amt'>" + fmt_money(fin['o_and_p_amount']) + "</td></tr>" if fin['o_and_p'] else ""}
    <tr class="grand-total">
        <td><strong>TOTAL RCV</strong></td>
        <td class="amt" style="font-size:14pt;"><strong>{fmt_money(fin['total_with_op'])}</strong></td>
    </tr>
</table>

<h3>{lang['comparison_header']}</h3>
<table>
    <tr><th></th><th class="amt">{carrier['name']}</th><th class="amt">USA Roof Masters</th><th class="amt">Variance</th></tr>
    <tr><td>RCV</td><td class="amt">{fmt_money(fin['carrier_rcv'])}</td><td class="amt">{fmt_money(fin['total_with_op'])}</td><td class="amt variance-positive">+{fmt_money(fin['variance'])}</td></tr>
    <tr><td>Deductible</td><td class="amt">{fmt_money(fin['deductible'])}</td><td class="amt">{fmt_money(fin['deductible'])}</td><td class="amt">--</td></tr>
    <tr class="section-total"><td><strong>Net Claim</strong></td><td class="amt">{fmt_money(fin['carrier_net'])}</td><td class="amt"><strong>{fmt_money(fin['net_claim'])}</strong></td><td class="amt variance-positive"><strong>+{fmt_money(fin['net_claim'] - fin['carrier_net'])}</strong></td></tr>
</table>

<div class="highlight-box">
<strong>NOTE ON OVERHEAD &amp; PROFIT:</strong> {"O&P (10% + 10%) is included — " + str(len(scope.get('trades',[]))) + " trades involved (" + trades_str + ")." if fin['o_and_p'] else o_and_p_note}
</div>

<div class="highlight-box">
<strong>PRICING NOTE:</strong> All line items priced per Xactimate — {financials.get('price_list', '')} pricing region. Quantities from EagleView Report #{measurements.get('eagleview_report_number', '')}. Final scope may be adjusted based on conditions discovered during tear-off and installation.
</div>

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

    # Canonical line item order for standardized comparison table
    _CANONICAL_ORDER = [
        # Roofing
        "roof removal", "roof install", "steep charges", "high roof",
        "i&w barrier", "ice & water", "underlayment", "starter course", "starter strip",
        "drip edge", "hip & ridge", "hip and ridge", "ridge cap",
        "ridge vent", "step flashing", "counter flashing", "chimney flashing",
        "pipe jacks", "pipe collar", "roof vents", "skylights", "skylight flashing",
        "roofing labor minimum", "dumpster",
        # Gutters
        "gutters", "gutter", "downspouts", "downspout",
        # Siding
        "siding", "house wrap", "window wraps", "window wrap", "wall flashing",
        "shutters", "shutter", "siding labor minimum",
    ]

    def _canonical_sort_key(item_name):
        """Return sort index for canonical line item ordering."""
        name_lower = item_name.lower().strip()
        # Strip R&R / Remove / Install prefixes for matching
        clean = re.sub(r'^(r&r|remove|install|replace|r/r)\s+', '', name_lower).strip()
        for idx, canon in enumerate(_CANONICAL_ORDER):
            if canon in clean or clean in canon:
                return idx
        return len(_CANONICAL_ORDER)  # Unknown items go to end

    # Build carrier line items variance table — 5 columns (streamlined)
    carrier_items = carrier.get("carrier_line_items", [])
    variance_rows = ""
    used_li_indices = set()

    # Sort carrier items by canonical order
    indexed_items = [(i, ci) for i, ci in enumerate(carrier_items)]
    indexed_items.sort(key=lambda x: _canonical_sort_key(x[1].get("item", "")))

    for row_num, (_, ci) in enumerate(indexed_items, 1):
        item_name = ci.get("item", "")
        carrier_desc = ci.get("carrier_desc", "")
        carrier_amt = ci.get("carrier_amount", "")
        usarm_desc = ci.get("usarm_desc", "")
        note = ci.get("note", "")

        # Format carrier column: description + qty (e.g., "Universal Starter (201.17 LF)")
        carrier_qty = ci.get("carrier_qty", "")
        carrier_unit = ci.get("carrier_unit", "")
        carrier_col = carrier_desc if carrier_desc else "&mdash;"
        if carrier_qty and carrier_unit:
            carrier_col += f" ({carrier_qty} {carrier_unit})"
        elif carrier_amt and str(carrier_amt).replace('.','',1).replace('-','',1).isdigit():
            carrier_col += f" ({fmt_money(float(carrier_amt))})"

        # Format contractor column: USARM description + qty
        usarm_qty = ci.get("usarm_qty", "")
        usarm_unit = ci.get("usarm_unit", "")
        # Cross-reference USARM line items for qty if not pre-computed
        if not usarm_desc:
            item_lower = item_name.lower().strip()
            item_clean = re.sub(r'^(shed|dwelling\s*roof|front\s*elevation|rear\s*elevation|'
                                r'left\s*elevation|right\s*elevation|debris\s*removal|'
                                r'interior|garage|porch)\s*[-–—]\s*', '', item_lower).strip()
            for li_idx, li in enumerate(line_items):
                if li_idx in used_li_indices:
                    continue
                li_desc = li.get("description", "").lower()
                li_clean = re.sub(r'^r&r\s+', '', li_desc).strip()
                if not item_clean:
                    continue
                if item_clean in li_clean or li_clean in item_clean:
                    usarm_desc = li.get("description", "")
                    usarm_qty = str(li.get("qty", ""))
                    usarm_unit = li.get("unit", "")
                    used_li_indices.add(li_idx)
                    break
                elif len(item_clean.split()) >= 3:
                    stop = {'the', 'a', 'an', 'for', 'of', 'and', 'or', 'w/', 'w/out', '-', 'to', 'per', 'sq', 'lf'}
                    item_words = set(item_clean.split()) - stop
                    li_words = set(li_clean.split()) - stop
                    overlap = item_words & li_words
                    if len(overlap) >= 3 or (len(overlap) >= 2 and len(item_words) <= 4):
                        usarm_desc = li.get("description", "")
                        usarm_qty = str(li.get("qty", ""))
                        usarm_unit = li.get("unit", "")
                        used_li_indices.add(li_idx)
                        break

        contractor_col = usarm_desc if usarm_desc else "&mdash;"
        if usarm_qty and usarm_unit:
            contractor_col += f" ({usarm_qty} {usarm_unit})"

        # Variance & Justification column — merge note + code compliance
        is_missing = str(carrier_desc).upper() in ("NOT INCLUDED", "OMITTED", "")
        var_class = ' class="var-pos"' if is_missing else ''
        var_just = note if note else ("NOT INCLUDED by carrier" if is_missing else "&mdash;")

        variance_rows += f"""<tr>
            <td>{row_num}</td>
            <td><strong>{item_name}</strong></td>
            <td>{carrier_col}</td>
            <td>{contractor_col}</td>
            <td{var_class}>{var_just}</td>
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
        variance_summary_html += '<tr><th>Category</th><th class="amt">Carrier RCV</th><th class="amt">USARM RCV</th><th class="amt">Variance</th></tr>\n'
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
    <tr><th></th><th class="amt">{carrier['name']}</th><th class="amt">USA Roof Masters</th><th class="amt">Variance</th></tr>
    <tr><td>RCV</td><td class="amt">{fmt_money(fin['carrier_rcv'])}</td><td class="amt">{fmt_money(fin['total_with_op'])}</td><td class="amt variance-positive">+{fmt_money(fin['variance'])}</td></tr>
    <tr><td>Deductible</td><td class="amt">{fmt_money(fin['deductible'])}</td><td class="amt">{fmt_money(fin['deductible'])}</td><td class="amt">--</td></tr>
    <tr class="section-total"><td><strong>Net Claim</strong></td><td class="amt">{fmt_money(fin['carrier_net'])}</td><td class="amt"><strong>{fmt_money(fin['net_claim'])}</strong></td><td class="amt variance-positive"><strong>+{fmt_money(fin['net_claim'] - fin['carrier_net'])}</strong></td></tr>
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
    <img src="{logo_b64}" alt="USA Roof Masters" class="logo-img">
    <div class="header-text">
        <div class="company">{company['name']}</div>
        <h1>{lang['doc3_title']}</h1>
        <div class="subtitle">{lang['doc3_subtitle']}</div>
    </div>
</div>

<div class="content">

<table>
    <tr><th style="width:35%">Field</th><th>Detail</th></tr>
    <tr><td><strong>Property Owner</strong></td><td>{ins['name']}</td></tr>
    <tr><td><strong>Property</strong></td><td>{prop['address']}</td></tr>
    <tr><td><strong>Carrier / Claim</strong></td><td>{carrier['name']} — {carrier['claim_number']}</td></tr>
    <tr><td><strong>Date of Loss</strong></td><td>{dates['date_of_loss']}</td></tr>
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
    <tr><th style="width:4%">#</th><th style="width:18%">Line Item</th><th style="width:28%">{carrier['name']}</th><th style="width:28%">Contractor</th><th style="width:22%">Variance &amp; Justification</th></tr>
    {variance_rows}
</table>

{code_violations_html}
{damage_threshold_html}

<div style="margin-top:24pt;"></div>

{variance_summary_html}

<h2>O&amp;P NOTE</h2>
<p>{"Overhead & Profit (10% + 10%) is included — " + str(len(scope.get('trades',[]))) + " trades involved (" + trades_str + ")." if fin['o_and_p'] else "Overhead & Profit (O&P) is <strong>not included</strong>. " + o_and_p_note}</p>

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

    # 1. Always: Storm verification
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
    <img src="{logo_b64}" alt="USA Roof Masters" style="height:60pt; width:auto; margin-bottom:8pt;"><br>
    <div style="font-size:18pt; font-weight:800; color:#0d2137; letter-spacing:2pt;">{company['name']}</div>
    <div style="font-size:9pt; color:#666;">{company['address']} | {company['city_state_zip']}<br>
    Office: {company['office_phone']} | Cell: {company['cell_phone']} | {company['email']}</div>
</div>

<hr style="border:none; border-top:2px solid #0d2137; margin:16pt 0;">

{_build_assoc_logos_footer()}

<p><strong>{dates['report_date']}</strong></p>

<p>{carrier['name']}<br>
Claims Department<br>
{carrier.get('claims_email', '')}</p>

<p><strong>RE: {appeal.get('subject_line', lang['doc4_subject_default'])}</strong><br>
<strong>Claim Number:</strong> {carrier['claim_number']}<br>
<strong>Policy Number:</strong> {carrier.get('policy_number', '')}<br>
<strong>Property Owner:</strong> {ins['name']}<br>
<strong>Property:</strong> {prop['address']}<br>
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

def build_cover_email(config):
    """Build cover email — ready to send."""
    lang = get_language(config)
    print(f"Building Cover Email... [role: {lang['role']}]")

    logo_b64 = get_logo_b64(config)
    prop = config["property"]
    ins = config["insured"]
    carrier = config["carrier"]
    dates = config["dates"]
    company = config["company"]
    weather = config["weather"]
    findings = config["forensic_findings"]
    cover = config.get("cover_email", {})

    fin = compute_financials(config)

    # Compute total_photos with fallback for cover email
    _total_photos = findings.get("total_photos", 0)
    if not _total_photos:
        _total_photos = len(config.get("photo_annotations", {}))
    _total_photos_str = str(_total_photos) if _total_photos else "multiple"

    # Enclosed documents (handle both list and string-with-newlines formats)
    enclosed = cover.get("enclosed_documents", [])
    if isinstance(enclosed, str):
        enclosed = [line.strip() for line in enclosed.replace("\\n", "\n").split("\n") if line.strip()]
    enclosed_html = ""
    for doc in enclosed:
        if isinstance(doc, dict):
            enclosed_html += f"<li><strong>{doc['name']}</strong> — {doc.get('detail', '')}</li>\n"
        else:
            enclosed_html += f"<li><strong>{doc}</strong></li>\n"

    # Build the summary paragraph
    summary_para = f"""The current scope of {fmt_money(fin['carrier_rcv'])} RCV"""

    # Add context about what carrier approved
    if fin['carrier_net'] <= 0 or fin['carrier_net'] < fin['deductible'] * 0.1:
        summary_para += f""", resulting in a net claim that effectively denies meaningful coverage after the {fmt_money(fin['deductible'])} deductible."""
    else:
        summary_para += f" addresses only limited components."

    summary_para += f""" After a thorough forensic analysis — supported by HailTrace weather verification confirming {weather.get('hail_size_algorithm','')} hail at the property"""

    if weather.get("hail_size_nws_reports"):
        nws_sizes = [r["size"] for r in weather["hail_size_nws_reports"][:1]]
        summary_para += f""", NWS Local Storm Reports documenting {nws_sizes[0]} hail"""

    summary_para += f""", {_total_photos_str} inspection photos, and EagleView aerial measurements — we have determined that the full scope of storm damage requires <strong>{fmt_money(fin['total_with_op'])} RCV</strong> in repairs."""

    # Key highlight paragraph
    highlight = ""
    fa = findings.get("fieldassist_findings")
    if fa:
        highlight = f"""<p>We particularly draw your attention to the {carrier.get('inspector_company','')} report, which documents "Potentially Covered Damage: Yes" and granular loss on all {len(fa.get('slopes_with_granular_loss',[]))} slopes, directly contradicting the carrier's limited scope. We believe this internal contradiction warrants a thorough re-evaluation of the claim.</p>"""
    elif carrier.get("carrier_acknowledged_items"):
        highlight = f"""<p>We note that the carrier's scope acknowledges hail damage to roof accessories but denies damage to the shingles directly adjacent to those components on the same roof slope. This is physically inconsistent — the shingles have a lower damage threshold and were exposed to the same hailstones.</p>"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Cover Email -- {prop['address']}</title>
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
    <img src="{logo_b64}" alt="USA Roof Masters" style="height:50pt; width:auto; margin-bottom:8pt;"><br>
    <div style="font-size:16pt; font-weight:800; color:#0d2137; letter-spacing:1pt;">COVER EMAIL -- READY TO SEND</div>
</div>

<div class="email-header">
    <div class="field"><span class="label">To:</span> {cover.get('to', cover.get('to_email', carrier.get('claims_email', '')))}</div>
    <div class="field"><span class="label">CC:</span> {cover.get('cc', cover.get('cc_email', ins.get('email', '')))}</div>
    <div class="field"><span class="label">Subject:</span> {cover.get('subject', cover.get('subject_line', 'RE: ' + carrier['claim_number'] + ' -- ' + lang['doc4_subject_default'] + ' -- ' + prop['address']))}</div>
</div>

<hr style="border:none; border-top:1px solid #ddd; margin:16pt 0;">

<p>Good afternoon,</p>

<p>{"Please find enclosed our formal supplement and appeal for" if lang["role"] == "advocate" else "Please find enclosed our contractor scope documentation for"} Claim #{carrier['claim_number']}, property at {prop['address']} (Insured: {ins['name']}, Date of Loss: {dates['date_of_loss']}).</p>

<p>{summary_para}</p>

<p>The enclosed documentation includes:</p>
<ol>
{enclosed_html}
</ol>

{highlight}

<p>{"We request adjuster review and response within 15 business days per 11 NYCRR 216.4(b)." if lang["regulatory_citations"] else "We request adjuster review and response at your earliest convenience."} We are available for a joint re-inspection at the carrier's convenience.</p>

<p>Thank you for your prompt attention.</p>

{_build_uppa_disclaimer(config)}

<div class="footer-sig">
    <div class="name">{company['ceo_name']}</div>
    <div class="title">{company['ceo_title']}</div>
    <div>{company['cell_phone']} | {company['email']}</div>
    <div>{company.get('website', '')}</div>
</div>

</body>
</html>"""

    path = os.path.join(config["_paths"]["output"], "05_COVER_EMAIL.html")
    with open(path, "w") as f:
        f.write(html)
    return path


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

    # Storm summary
    storm_summary = f"""a confirmed severe weather event on {dates['date_of_loss']}"""
    if weather.get("hail_size_algorithm"):
        storm_summary += f""", with HailTrace-verified {weather['hail_size_algorithm']} algorithmic hail impacting the property"""
    if weather.get("hail_size_nws_reports"):
        nws_sizes = [r["size"] for r in weather["hail_size_nws_reports"][:1]]
        storm_summary += f""" and NWS Local Storm Reports documenting {nws_sizes[0]} hail in the area"""
    if weather.get("duration"):
        storm_summary += f""" over a {weather['duration']} exposure window"""

    # Enclosed documents for Phase 1 (handle both list and string-with-newlines formats)
    enclosed_html = ""
    enclosed_docs = cover.get("enclosed_documents", [
        "Forensic Causation Report with photo-annotated damage analysis",
        f"Xactimate-format repair estimate ({_price_list} pricing)",
        "HailTrace Weather Verification Report",
        "EagleView Property Measurement Report"
    ])
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
    <img src="{logo_b64}" alt="USA Roof Masters" style="height:50pt; width:auto; margin-bottom:8pt;"><br>
    <div style="font-size:16pt; font-weight:800; color:#0d2137; letter-spacing:1pt;">COVER LETTER &mdash; PRE-INSPECTION SUBMISSION</div>
</div>

<div class="email-header">
    <div class="field"><span class="label">To:</span> {cover.get('to', carrier.get('claims_email', carrier.get('adjuster_email', '')))}</div>
    <div class="field"><span class="label">CC:</span> {cover.get('cc', ins.get('email', ''))}</div>
    <div class="field"><span class="label">Subject:</span> {cover.get('subject', 'Claim #' + carrier.get('claim_number','') + ' -- Forensic Documentation & Estimate -- ' + prop['address'])}</div>
</div>

<hr style="border:none; border-top:1px solid #ddd; margin:16pt 0;">

<p>Good afternoon,</p>

<p>{"USA Roof Masters represents the insured, <strong>" + ins['name'] + "</strong>, under an Assignment of Benefits" if lang["role"] == "advocate" else "We are the licensed contractor retained by <strong>" + ins['name'] + "</strong> for storm damage repairs"} for the property at <strong>{prop['address']}, {prop['city']}, {prop['state']} {prop['zip']}</strong> (Claim #{carrier.get('claim_number','pending')}, Date of Loss: {dates['date_of_loss']}).</p>

<p>We are submitting our forensic inspection documentation and detailed repair estimate in advance of the carrier's adjuster inspection. Our documentation confirms {storm_summary}.</p>

<p>Our certified inspection identified storm damage across <strong>{trades_text}</strong>, supported by {_total_photos_str} inspection photographs with forensic annotations. The enclosed Xactimate-format estimate totals <strong>{fmt_money(fin['total_with_op'])} RCV</strong> based on EagleView-verified measurements and current {_price_list} regional pricing.</p>

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
    print(f"  Tax ({fin['tax_rate']*100:.0f}%): {fmt_money(fin['tax'])}")
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
        print("PHASE 2: POST-SCOPE — Building All 5 Documents")
    print("=" * 60)

    html_files = []

    if phase == "pre-scope":
        # PHASE 1: Forensic Report + Xactimate Estimate + Cover Letter
        html_files.append(("Forensic Causation Report", build_forensic_report(config)))
        html_files.append(("Xactimate Estimate", build_xactimate_estimate(config)))
        html_files.append(("Cover Letter (Pre-Scope)", build_cover_letter(config)))
    else:
        # PHASE 2 (default): All 5 documents (names adapt to user role)
        html_files.append(("Forensic Causation Report", build_forensic_report(config)))
        html_files.append(("Xactimate Estimate", build_xactimate_estimate(config)))
        html_files.append((lang["doc3_title"].title(), build_supplement_report(config)))
        html_files.append((lang["doc4_title"].title(), build_appeal_letter(config)))
        html_files.append(("Cover Email", build_cover_email(config)))

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
        print(f"PHASE 2 COMPLETE — 5 PDFs saved to:")
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
