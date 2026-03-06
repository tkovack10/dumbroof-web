#!/usr/bin/env python3
"""
DumbRoof Repair AI — PDF Generator
====================================
Generates repair documents from a repair_job_config.json.

Usage:
    python3 repair_generator.py jobs/{job-id}/repair_job_config.json

Output:
    01_REPAIR_INSTRUCTIONS.pdf   (for roofer — skill-level + language calibrated)
    02_REPAIR_TICKET.pdf         (for homeowner — plain English, professional)
    03_COMPLETION_RECEIPT.pdf     (after repair — before/after + warranty)

All output saved to pdf_output/ next to the repair_job_config.json.
"""

import os
import sys
import json
import base64
import glob
import subprocess

# Import shared utilities from the existing USARM generator
# These are READ-ONLY imports — we never modify usarm_pdf_generator.py
from usarm_pdf_generator import html_to_pdf, fmt_money


# ===================================================================
# PATHS & CONFIG
# ===================================================================

# Chrome path handled by usarm_pdf_generator.html_to_pdf (cross-platform)


def load_repair_config(config_path):
    """Load repair job config and resolve all paths relative to its location."""
    config_path = os.path.abspath(config_path)
    with open(config_path, "r") as f:
        config = json.load(f)

    job_dir = os.path.dirname(config_path)
    config["_paths"] = {
        "job_dir": job_dir,
        "photos": os.path.join(job_dir, "photos"),
        "qa_photos": os.path.join(job_dir, "qa_photos"),
        "output": os.path.join(job_dir, "pdf_output"),
    }
    os.makedirs(config["_paths"]["output"], exist_ok=True)
    return config


# ===================================================================
# HELPERS
# ===================================================================

def b64_img(config, filename):
    """Return base64 data URI for a photo in the job's photos/ folder."""
    path = os.path.join(config["_paths"]["photos"], filename)
    if not os.path.exists(path):
        return ""
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    ext = filename.rsplit(".", 1)[-1].lower()
    mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
    return f"data:{mime};base64,{data}"


def b64_img_path(filepath):
    """Return base64 data URI for a photo at an absolute path."""
    if not os.path.exists(filepath):
        return ""
    with open(filepath, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    ext = filepath.rsplit(".", 1)[-1].lower()
    mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
    return f"data:{mime};base64,{data}"


def get_contractor_logo_b64(config):
    """Return base64 data URI for the contractor's logo."""
    logo_path = config.get("contractor", {}).get("logo_path_OPTIONAL", "")
    if logo_path and os.path.exists(logo_path):
        return b64_img_path(logo_path)

    # Try common logo files in photos dir
    photos = config["_paths"]["photos"]
    for name in ["logo.jpg", "logo.png", "logo.JPG", "company_logo.jpg", "company_logo.png"]:
        path = os.path.join(photos, name)
        if os.path.exists(path):
            return b64_img_path(path)
    return ""


# ===================================================================
# CSS
# ===================================================================

CSS_REPAIR = """
@page {
    size: letter;
    margin: 0;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
    font-size: 10pt;
    line-height: 1.5;
    color: #1a1a1a;
}
.content {
    padding: 0 0.75in 0.65in 0.75in;
}
h1 {
    font-size: 20pt;
    font-weight: 800;
    color: #0d2137;
    margin: 14pt 0 8pt 0;
}
h2 {
    font-size: 13pt;
    font-weight: 700;
    color: #0d2137;
    border-bottom: 2pt solid #2196F3;
    padding-bottom: 3pt;
    margin: 18pt 0 8pt 0;
}
h3 {
    font-size: 11pt;
    font-weight: 700;
    color: #0d2137;
    margin: 12pt 0 5pt 0;
}
p { margin: 5pt 0; }
ul, ol { margin: 5pt 0 5pt 20pt; }
li { margin: 3pt 0; }

/* Header */
.header-bar {
    background: #0d2137;
    color: #fff;
    padding: 18pt 0.75in;
    margin: 0 0 16pt 0;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 14pt;
}
.header-bar .logo-img { height: 44pt; width: auto; }
.header-bar .header-text { flex: 1; }
.header-bar .company {
    font-size: 10pt;
    font-weight: 700;
    color: #64b5f6;
    letter-spacing: 1.5pt;
    margin-bottom: 2pt;
}
.header-bar h1 {
    color: #fff;
    font-size: 18pt;
    margin: 0;
    line-height: 1.2;
}
.header-bar .subtitle {
    font-size: 8.5pt;
    color: #aabdd4;
    margin-top: 2pt;
}

/* Info grid */
.info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8pt;
    margin: 12pt 0;
    font-size: 9.5pt;
}
.info-grid .label {
    font-weight: 600;
    color: #666;
}
.info-grid .value {
    color: #1a1a1a;
}

/* Severity badges */
.severity-badge {
    display: inline-block;
    padding: 3pt 10pt;
    border-radius: 3pt;
    font-weight: 700;
    font-size: 9pt;
    color: #fff;
    text-transform: uppercase;
}
.severity-minor { background: #4caf50; }
.severity-moderate { background: #ff9800; }
.severity-major { background: #f44336; }
.severity-critical { background: #b71c1c; }
.severity-emergency { background: #880e4f; }

/* Callout boxes */
.diagnosis-box {
    background: #e3f2fd;
    border-left: 4pt solid #1976d2;
    padding: 10pt 14pt;
    margin: 10pt 0;
    border-radius: 2pt;
    font-size: 10pt;
}
.warning-box {
    background: #fff8e1;
    border-left: 4pt solid #f9a825;
    padding: 10pt 14pt;
    margin: 10pt 0;
    border-radius: 2pt;
    font-size: 9.5pt;
}
.price-box {
    background: #0d2137;
    padding: 14pt 18pt;
    margin: 14pt 0;
    border-radius: 4pt;
    text-align: center;
}
.price-box .price {
    font-size: 28pt;
    font-weight: 800;
    color: #fff;
}
.price-box .label {
    font-size: 9pt;
    color: #aabdd4;
    margin-top: 4pt;
}

/* Steps */
.step-card {
    break-inside: avoid;
    page-break-inside: avoid;
    border: 1px solid #e0e0e0;
    border-radius: 4pt;
    margin: 8pt 0;
    padding: 10pt 12pt;
}
.step-card .step-header {
    display: flex;
    align-items: center;
    gap: 8pt;
    margin-bottom: 6pt;
}
.step-number {
    background: #0d2137;
    color: #fff;
    width: 24pt;
    height: 24pt;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 10pt;
    flex-shrink: 0;
}
.step-title {
    font-weight: 700;
    font-size: 10.5pt;
    color: #0d2137;
}
.step-instructions {
    font-size: 9.5pt;
    line-height: 1.5;
    margin: 4pt 0;
    padding-left: 32pt;
}
.step-meta {
    font-size: 8pt;
    color: #888;
    padding-left: 32pt;
    margin-top: 4pt;
}
.safety-note {
    background: #fff3e0;
    border-left: 3pt solid #ff9800;
    padding: 4pt 8pt;
    margin: 4pt 0 0 32pt;
    font-size: 8.5pt;
    color: #e65100;
}
.alt-lang {
    font-size: 8.5pt;
    color: #555;
    font-style: italic;
    padding-left: 32pt;
    margin-top: 2pt;
    border-top: 1px dashed #e0e0e0;
    padding-top: 3pt;
}
.alt-lang-label {
    font-weight: 600;
    font-style: normal;
    color: #888;
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
}

/* Materials table */
table {
    width: 100%;
    border-collapse: collapse;
    margin: 8pt 0;
    font-size: 9pt;
}
th {
    background: #0d2137;
    color: #fff;
    padding: 5pt 8pt;
    text-align: left;
    font-weight: 600;
}
td {
    padding: 4pt 8pt;
    border-bottom: 1px solid #e0e0e0;
}
tr:nth-child(even) td { background: #f8f9fa; }
.amt { text-align: right; font-family: 'Courier New', monospace; }

/* Photo grid */
.photo-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8pt;
    margin: 8pt 0;
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
    padding: 4pt 6pt;
    font-size: 7.5pt;
    color: #333;
    background: #f9f9f9;
    line-height: 1.3;
}

/* Approval section */
.approval-section {
    border: 2pt solid #0d2137;
    padding: 14pt;
    margin: 16pt 0;
    border-radius: 4pt;
}
.approval-section h3 {
    margin-top: 0;
}
.signature-line {
    border-bottom: 1pt solid #333;
    height: 30pt;
    margin: 12pt 0 4pt 0;
}
.signature-label {
    font-size: 8pt;
    color: #666;
}

/* Warranty section */
.warranty-section {
    background: #f5f5f5;
    border: 1px solid #ddd;
    padding: 10pt 14pt;
    margin: 12pt 0;
    border-radius: 4pt;
    font-size: 9pt;
}

/* Footer */
.footer {
    margin-top: 20pt;
    padding-top: 8pt;
    border-top: 1px solid #ddd;
    font-size: 7.5pt;
    color: #999;
    text-align: center;
}
"""


# ===================================================================
# DOCUMENT 1: REPAIR INSTRUCTIONS (for roofer)
# ===================================================================

def build_repair_instructions(config):
    """Build HTML for the repair instructions document (roofer-facing)."""
    repair = config.get("repair", {})
    diagnosis = config.get("diagnosis", {})
    submission = config.get("submission", {})
    prop = config.get("property", {})
    contractor = config.get("contractor", {})
    photo_map = config.get("photo_map", {})
    annotations = config.get("photo_annotations", {})

    lang = submission.get("preferred_language", "en")
    skill = submission.get("skill_level", "journeyman")

    # Language-specific labels
    labels = {
        "en": {
            "title": "REPAIR INSTRUCTIONS",
            "subtitle": "Leak Repair Work Order",
            "diagnosis": "Diagnosis",
            "steps": "Repair Steps",
            "materials": "Materials Needed",
            "item": "Item", "qty": "Qty", "unit": "Unit",
            "safety": "Safety",
            "time": "Est. Time",
            "total_time": "Total Estimated Time",
            "photos": "Reference Photos",
        },
        "es": {
            "title": "INSTRUCCIONES DE REPARACION",
            "subtitle": "Orden de Trabajo - Reparacion de Filtración",
            "diagnosis": "Diagnostico",
            "steps": "Pasos de Reparacion",
            "materials": "Materiales Necesarios",
            "item": "Articulo", "qty": "Cant.", "unit": "Unidad",
            "safety": "Seguridad",
            "time": "Tiempo Est.",
            "total_time": "Tiempo Total Estimado",
            "photos": "Fotos de Referencia",
        },
    }
    L = labels.get(lang, labels["en"])

    # Primary and secondary language keys
    primary_lang = lang
    alt_lang = "es" if lang == "en" else "en"
    alt_lang_label = "ESPAÑOL" if alt_lang == "es" else "ENGLISH"

    title_key = f"title_{primary_lang}"
    instr_key = f"instructions_{primary_lang}"
    safety_key = f"safety_note_{primary_lang}"
    alt_title_key = f"title_{alt_lang}"
    alt_instr_key = f"instructions_{alt_lang}"

    logo_b64 = get_contractor_logo_b64(config)
    company_name = contractor.get("company_name", "DumbRoof Repair")

    # Build steps HTML — both languages, primary first
    steps_html = ""
    total_minutes = 0
    for step in repair.get("steps", []):
        step_num = step.get("step", "")
        title = step.get(title_key, step.get("title_en", ""))
        instructions = step.get(instr_key, step.get("instructions_en", ""))
        alt_title = step.get(alt_title_key, "")
        alt_instructions = step.get(alt_instr_key, "")
        time_min = step.get("time_minutes", 0)
        total_minutes += time_min
        safety = step.get(safety_key, step.get("safety_note_en"))
        photo_ref = step.get("photo_reference")
        materials = step.get("materials", [])

        safety_html = ""
        if safety:
            safety_label = L["safety"]
            safety_html = f'<div class="safety-note"><strong>{safety_label}:</strong> {safety}</div>'

        # Secondary language block
        alt_lang_html = ""
        if alt_instructions:
            alt_lang_html = f"""<div class="alt-lang">
                <span class="alt-lang-label">{alt_lang_label}:</span> <strong>{alt_title}</strong> — {alt_instructions}
            </div>"""

        meta_parts = []
        if time_min:
            meta_parts.append(f"{L['time']}: {time_min} min")
        if materials:
            meta_parts.append(f"Materials: {', '.join(materials)}")
        if photo_ref and photo_ref in photo_map:
            meta_parts.append(f"See photo {photo_ref}")
        meta_html = " | ".join(meta_parts)

        steps_html += f"""
        <div class="step-card">
            <div class="step-header">
                <div class="step-number">{step_num}</div>
                <div class="step-title">{title}</div>
            </div>
            <div class="step-instructions">{instructions}</div>
            {alt_lang_html}
            {safety_html}
            <div class="step-meta">{meta_html}</div>
        </div>
        """

    # Build materials table
    materials_html = ""
    if repair.get("materials_list"):
        rows = ""
        for mat in repair["materials_list"]:
            rows += f"""
            <tr>
                <td>{mat.get('item', '')}</td>
                <td class="amt">{mat.get('qty', 0)}</td>
                <td>{mat.get('unit', '')}</td>
            </tr>
            """
        materials_html = f"""
        <h2>{L['materials']}</h2>
        <table>
            <tr><th>{L['item']}</th><th style="text-align:right">{L['qty']}</th><th>{L['unit']}</th></tr>
            {rows}
        </table>
        """

    # Build reference photos
    photos_html = ""
    if photo_map and annotations:
        photo_cards = ""
        for key in sorted(photo_map.keys()):
            if key.startswith("_"):
                continue
            filename = photo_map[key]
            img_data = b64_img(config, filename)
            if not img_data:
                continue
            annotation = annotations.get(key, "")
            photo_cards += f"""
            <div class="photo-card">
                <img src="{img_data}" alt="{key}">
                <div class="caption"><strong>{key}:</strong> {annotation}</div>
            </div>
            """
        if photo_cards:
            photos_html = f"""
            <h2>{L['photos']}</h2>
            <div class="photo-grid">{photo_cards}</div>
            """

    # Total time display
    hours = total_minutes // 60
    mins = total_minutes % 60
    time_display = f"{hours}h {mins}m" if hours else f"{mins} min"

    severity = diagnosis.get("severity", "moderate")
    severity_class = f"severity-{severity}"

    html = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>{CSS_REPAIR}</style></head>
<body>

<div class="header-bar">
    {'<img class="logo-img" src="' + logo_b64 + '">' if logo_b64 else ''}
    <div class="header-text">
        <div class="company">{company_name.upper()}</div>
        <h1>{L['title']}</h1>
        <div class="subtitle">{L['subtitle']}</div>
    </div>
</div>

<div class="content">

<div class="info-grid">
    <div><span class="label">Property:</span> <span class="value">{prop.get('address', '')} {prop.get('city', '')}, {prop.get('state', '')} {prop.get('zip', '')}</span></div>
    <div><span class="label">Date:</span> <span class="value">{config.get('job', {}).get('created', '')[:10]}</span></div>
    <div><span class="label">Technician:</span> <span class="value">{submission.get('submitted_by', '')}</span></div>
    <div><span class="label">Job ID:</span> <span class="value">{config.get('job', {}).get('job_id', '')}</span></div>
</div>

<h2>{L['diagnosis']}</h2>
<div class="diagnosis-box">
    <p><strong>{diagnosis.get('leak_source', '')}</strong></p>
    <p><span class="severity-badge {severity_class}">{severity.upper()}</span></p>
</div>

<h2>{L['steps']}</h2>
<p style="font-size:9pt; color:#666;">{L['total_time']}: <strong>{time_display}</strong></p>
{steps_html}

{materials_html}

{photos_html}

<div class="footer">
    Generated by DumbRoof Repair AI | {company_name} | {contractor.get('phone', '')}
</div>

</div><!-- .content -->

</body></html>"""

    return html


# ===================================================================
# DOCUMENT 2: REPAIR TICKET (for homeowner)
# ===================================================================

def build_repair_ticket(config):
    """Build HTML for the repair ticket document (homeowner-facing)."""
    repair = config.get("repair", {})
    diagnosis = config.get("diagnosis", {})
    ticket = config.get("homeowner_ticket", {})
    prop = config.get("property", {})
    homeowner = config.get("homeowner", {})
    contractor = config.get("contractor", {})
    photo_map = config.get("photo_map", {})
    annotations = config.get("photo_annotations", {})

    logo_b64 = get_contractor_logo_b64(config)
    company_name = contractor.get("company_name", "DumbRoof Repair")

    severity = diagnosis.get("severity", "moderate")
    severity_class = f"severity-{severity}"

    urgency_text = {
        "minor": "Low — schedule at your convenience",
        "moderate": "Moderate — repair within 1-2 weeks recommended",
        "major": "High — repair within 3-5 days recommended",
        "critical": "Urgent — immediate repair needed to prevent further damage",
        "emergency": "Emergency — same-day repair required",
    }
    urgency_display = urgency_text.get(ticket.get("urgency", severity), "")

    # Key photos (show first 3)
    photos_html = ""
    photo_keys = [k for k in sorted(photo_map.keys()) if not k.startswith("_")]
    show_photos = photo_keys[:3]
    if show_photos:
        photo_cards = ""
        for key in show_photos:
            filename = photo_map[key]
            img_data = b64_img(config, filename)
            if not img_data:
                continue
            # Simplified captions for homeowners
            annotation = annotations.get(key, "")
            # Truncate long technical annotations
            if len(annotation) > 120:
                annotation = annotation[:117] + "..."
            photo_cards += f"""
            <div class="photo-card">
                <img src="{img_data}" alt="Inspection photo">
                <div class="caption">{annotation}</div>
            </div>
            """
        if photo_cards:
            photos_html = f"""
            <h2>What We Found — Photos</h2>
            <div class="photo-grid">{photo_cards}</div>
            """

    # Materials table for transparency
    materials_html = ""
    if repair.get("materials_list"):
        rows = ""
        for mat in repair["materials_list"]:
            total = round(mat.get("qty", 0) * mat.get("cost", 0), 2)
            rows += f"""
            <tr>
                <td>{mat.get('item', '')}</td>
                <td class="amt">{mat.get('qty', 0)}</td>
                <td>{mat.get('unit', '')}</td>
                <td class="amt">{fmt_money(total)}</td>
            </tr>
            """
        materials_cost = repair.get("materials_cost", 0)
        labor_cost = repair.get("labor_cost", 0)
        total = repair.get("total_price", 0)
        labor_hours = repair.get("labor_hours", 0)

        materials_html = f"""
        <h2>Cost Breakdown</h2>
        <table>
            <tr><th>Item</th><th style="text-align:right">Qty</th><th>Unit</th><th style="text-align:right">Amount</th></tr>
            {rows}
            <tr style="background:#e8edf2;font-weight:bold;">
                <td colspan="3">Materials Subtotal</td>
                <td class="amt">{fmt_money(materials_cost)}</td>
            </tr>
            <tr>
                <td colspan="3">Labor ({labor_hours} hours)</td>
                <td class="amt">{fmt_money(labor_cost)}</td>
            </tr>
            <tr style="background:#0d2137;font-weight:bold;">
                <td colspan="3" style="color:#fff;">TOTAL</td>
                <td class="amt" style="color:#fff;">{fmt_money(total)}</td>
            </tr>
        </table>
        """

    price = ticket.get("price", repair.get("total_price", 0))
    time_est = ticket.get("time_estimate", "")

    html = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>{CSS_REPAIR}</style></head>
<body>

<div class="header-bar">
    {'<img class="logo-img" src="' + logo_b64 + '">' if logo_b64 else ''}
    <div class="header-text">
        <div class="company">{company_name.upper()}</div>
        <h1>REPAIR TICKET</h1>
        <div class="subtitle">Professional Roof Leak Assessment &amp; Repair Recommendation</div>
    </div>
</div>

<div class="content">

<div class="info-grid">
    <div><span class="label">Property:</span> <span class="value">{prop.get('address', '')} {prop.get('city', '')}, {prop.get('state', '')} {prop.get('zip', '')}</span></div>
    <div><span class="label">Homeowner:</span> <span class="value">{homeowner.get('name', '')}</span></div>
    <div><span class="label">Date:</span> <span class="value">{config.get('job', {}).get('created', '')[:10]}</span></div>
    <div><span class="label">Ticket #:</span> <span class="value">{config.get('job', {}).get('job_id', '')}</span></div>
</div>

<h2>What We Found</h2>
<div class="diagnosis-box">
    <p>{ticket.get('what_we_found', '')}</p>
    <p style="margin-top:6pt;"><span class="severity-badge {severity_class}">Urgency: {severity.upper()}</span></p>
    <p style="font-size:9pt; color:#666; margin-top:4pt;">{urgency_display}</p>
</div>

{photos_html}

<h2>What We Recommend</h2>
<p>{ticket.get('what_we_recommend', '')}</p>
<p style="font-size:9pt; color:#666;">Estimated time: <strong>{time_est}</strong></p>

<div class="price-box">
    <div class="price">{fmt_money(price)}</div>
    <div class="label">Total repair cost (materials + labor)</div>
</div>

{materials_html}

<div class="warranty-section">
    <h3>Warranty</h3>
    <p>{ticket.get('warranty', '2-year workmanship warranty')}</p>
</div>

<div class="approval-section">
    <h3>Authorization to Proceed</h3>
    <p style="font-size:9pt;">I authorize {company_name} to perform the repair described above at the stated price.</p>
    <div class="signature-line"></div>
    <div class="signature-label">Homeowner Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</div>
</div>

<div class="footer">
    {company_name} | {contractor.get('phone', '')} | {contractor.get('email', '')}<br>
    Generated by DumbRoof Repair AI
</div>

</div><!-- .content -->

</body></html>"""

    return html


# ===================================================================
# DOCUMENT 3: COMPLETION RECEIPT (after repair)
# ===================================================================

def build_completion_receipt(config):
    """Build HTML for the completion receipt (post-repair warranty doc)."""
    repair = config.get("repair", {})
    diagnosis = config.get("diagnosis", {})
    ticket = config.get("homeowner_ticket", {})
    prop = config.get("property", {})
    homeowner = config.get("homeowner", {})
    contractor = config.get("contractor", {})
    completion = config.get("completion", {})
    photo_map = config.get("photo_map", {})

    logo_b64 = get_contractor_logo_b64(config)
    company_name = contractor.get("company_name", "DumbRoof Repair")

    completed_date = completion.get("completed_date", "")
    if not completed_date:
        return None  # Don't generate until repair is complete

    # Before/after photos
    photos_html = ""
    completion_photos = completion.get("completion_photos", [])
    before_keys = [k for k in sorted(photo_map.keys()) if not k.startswith("_")][:2]

    if before_keys or completion_photos:
        cards = ""
        # Before photos
        for key in before_keys:
            filename = photo_map.get(key, "")
            if not filename:
                continue
            img_data = b64_img(config, filename)
            if img_data:
                cards += f"""
                <div class="photo-card">
                    <img src="{img_data}" alt="Before">
                    <div class="caption"><strong>BEFORE:</strong> {key}</div>
                </div>
                """
        # After photos
        for photo_file in completion_photos[:2]:
            qa_path = os.path.join(config["_paths"]["qa_photos"], photo_file)
            if os.path.exists(qa_path):
                img_data = b64_img_path(qa_path)
                if img_data:
                    cards += f"""
                    <div class="photo-card">
                        <img src="{img_data}" alt="After">
                        <div class="caption"><strong>AFTER:</strong> {photo_file}</div>
                    </div>
                    """
        if cards:
            photos_html = f"""
            <h2>Before &amp; After</h2>
            <div class="photo-grid">{cards}</div>
            """

    price = ticket.get("price", repair.get("total_price", 0))

    html = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>{CSS_REPAIR}</style></head>
<body>

<div class="header-bar">
    {'<img class="logo-img" src="' + logo_b64 + '">' if logo_b64 else ''}
    <div class="header-text">
        <div class="company">{company_name.upper()}</div>
        <h1>REPAIR COMPLETION RECEIPT</h1>
        <div class="subtitle">Warranty Documentation</div>
    </div>
</div>

<div class="content">

<div class="info-grid">
    <div><span class="label">Property:</span> <span class="value">{prop.get('address', '')} {prop.get('city', '')}, {prop.get('state', '')} {prop.get('zip', '')}</span></div>
    <div><span class="label">Homeowner:</span> <span class="value">{homeowner.get('name', '')}</span></div>
    <div><span class="label">Completed:</span> <span class="value">{completed_date}</span></div>
    <div><span class="label">Ticket #:</span> <span class="value">{config.get('job', {}).get('job_id', '')}</span></div>
</div>

<h2>Work Performed</h2>
<div class="diagnosis-box">
    <p><strong>Issue:</strong> {diagnosis.get('leak_source', '')}</p>
    <p style="margin-top:6pt;"><strong>Repair:</strong> {repair.get('summary', '')}</p>
</div>

{photos_html}

<div class="price-box">
    <div class="price">{fmt_money(price)}</div>
    <div class="label">Total charged</div>
</div>

<div class="warranty-section">
    <h3>Workmanship Warranty</h3>
    <p>{ticket.get('warranty', '2-year workmanship warranty')}</p>
    <p style="margin-top:6pt; font-size:9pt;">
        <strong>Warranty start date:</strong> {completed_date}<br>
        <strong>Contractor:</strong> {company_name}<br>
        <strong>Contact:</strong> {contractor.get('phone', '')} | {contractor.get('email', '')}
    </p>
    <p style="margin-top:6pt; font-size:8pt; color:#666;">
        This warranty covers workmanship defects in the repair described above.
        It does not cover damage from subsequent storms, acts of nature, or
        unrelated structural issues. Contact us immediately if the repaired
        area shows signs of leaking.
    </p>
</div>

{f'<h2>Notes</h2><p>{completion.get("notes", "")}</p>' if completion.get("notes") else ''}

<div class="approval-section">
    <h3>Acknowledgment of Completion</h3>
    <p style="font-size:9pt;">I acknowledge that the repair described above has been completed to my satisfaction.</p>
    <div class="signature-line"></div>
    <div class="signature-label">Homeowner Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</div>
    <br>
    <div class="signature-line"></div>
    <div class="signature-label">Contractor Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</div>
</div>

<div class="footer">
    {company_name} | {contractor.get('phone', '')} | {contractor.get('email', '')}<br>
    Generated by DumbRoof Repair AI
</div>

</div><!-- .content -->

</body></html>"""

    return html


# ===================================================================
# MAIN
# ===================================================================

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 repair_generator.py jobs/{job-id}/repair_job_config.json")
        sys.exit(1)

    config_path = sys.argv[1]
    print(f"\nDumbRoof Repair AI — PDF Generator")
    print(f"===================================")

    config = load_repair_config(config_path)
    output_dir = config["_paths"]["output"]

    job = config.get("job", {})
    prop = config.get("property", {})
    contractor = config.get("contractor", {})
    diagnosis = config.get("diagnosis", {})
    repair = config.get("repair", {})
    submission = config.get("submission", {})

    print(f"Job ID:      {job.get('job_id', 'N/A')}")
    print(f"Property:    {prop.get('address', '')} {prop.get('city', '')}, {prop.get('state', '')}")
    print(f"Contractor:  {contractor.get('company_name', 'N/A')}")
    print(f"Repair type: {diagnosis.get('repair_type', 'N/A')}")
    print(f"Skill level: {submission.get('skill_level', 'N/A')}")
    print(f"Language:    {submission.get('preferred_language', 'en')}")
    print(f"Total price: {fmt_money(repair.get('total_price', 0))}")
    print()

    # Document 1: Repair Instructions
    print("Generating: 01_REPAIR_INSTRUCTIONS...")
    html1 = build_repair_instructions(config)
    html1_path = os.path.join(output_dir, "01_REPAIR_INSTRUCTIONS.html")
    pdf1_path = os.path.join(output_dir, "01_REPAIR_INSTRUCTIONS.pdf")
    with open(html1_path, "w") as f:
        f.write(html1)
    html_to_pdf(html1_path, pdf1_path)

    # Document 2: Repair Ticket
    print("Generating: 02_REPAIR_TICKET...")
    html2 = build_repair_ticket(config)
    html2_path = os.path.join(output_dir, "02_REPAIR_TICKET.html")
    pdf2_path = os.path.join(output_dir, "02_REPAIR_TICKET.pdf")
    with open(html2_path, "w") as f:
        f.write(html2)
    html_to_pdf(html2_path, pdf2_path)

    # Document 3: Completion Receipt (only if repair is complete)
    completion = config.get("completion", {})
    if completion.get("completed_date"):
        print("Generating: 03_COMPLETION_RECEIPT...")
        html3 = build_completion_receipt(config)
        if html3:
            html3_path = os.path.join(output_dir, "03_COMPLETION_RECEIPT.html")
            pdf3_path = os.path.join(output_dir, "03_COMPLETION_RECEIPT.pdf")
            with open(html3_path, "w") as f:
                f.write(html3)
            html_to_pdf(html3_path, pdf3_path)
    else:
        print("Skipping: 03_COMPLETION_RECEIPT (repair not yet completed)")

    print()
    print("PDF GENERATION COMPLETE")
    print("=" * 40)
    print(f"Output: {output_dir}")

    # List generated files
    for f in sorted(os.listdir(output_dir)):
        if f.endswith(".pdf"):
            size = os.path.getsize(os.path.join(output_dir, f))
            print(f"  {f} ({size:,} bytes)")


if __name__ == "__main__":
    main()
