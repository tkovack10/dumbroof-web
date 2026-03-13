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
    line-height: 1.55;
    color: #1e293b;
    background: #fff;
}
.content {
    padding: 0 0.7in 0.6in 0.7in;
}
h1 {
    font-size: 20pt;
    font-weight: 800;
    color: #0d2137;
    margin: 14pt 0 8pt 0;
    letter-spacing: -0.3pt;
}
h2 {
    font-size: 12pt;
    font-weight: 700;
    color: #0d2137;
    margin: 20pt 0 8pt 0;
    padding-bottom: 4pt;
    border-bottom: 1.5pt solid #e2e8f0;
    display: flex;
    align-items: center;
    gap: 6pt;
}
h2 .section-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20pt;
    height: 20pt;
    border-radius: 4pt;
    font-size: 10pt;
    flex-shrink: 0;
}
h3 {
    font-size: 10.5pt;
    font-weight: 700;
    color: #0d2137;
    margin: 10pt 0 4pt 0;
}
p { margin: 4pt 0; }
ul, ol { margin: 4pt 0 4pt 18pt; }
li { margin: 2pt 0; }

/* ── Header ── */
.header-bar {
    background: linear-gradient(135deg, #0d2137 0%, #162d4a 100%);
    color: #fff;
    padding: 20pt 0.7in 16pt 0.7in;
    margin: 0;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 14pt;
    position: relative;
}
.header-bar::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 3pt;
    background: linear-gradient(90deg, #dc2626, #ef4444, #dc2626);
}
.header-bar .logo-img { height: 40pt; width: auto; }
.header-bar .header-text { flex: 1; }
.header-bar .company {
    font-size: 9pt;
    font-weight: 700;
    color: #94a3b8;
    letter-spacing: 2pt;
    text-transform: uppercase;
    margin-bottom: 2pt;
}
.header-bar h1 {
    color: #fff;
    font-size: 17pt;
    margin: 0;
    line-height: 1.2;
    letter-spacing: -0.3pt;
}
.header-bar .subtitle {
    font-size: 8pt;
    color: #64748b;
    margin-top: 3pt;
    letter-spacing: 0.3pt;
}
.header-badge {
    background: rgba(255,255,255,0.12);
    border: 1px solid rgba(255,255,255,0.2);
    padding: 6pt 10pt;
    border-radius: 6pt;
    text-align: center;
    font-size: 8pt;
    color: #94a3b8;
    line-height: 1.3;
}
.header-badge .badge-value {
    font-size: 14pt;
    font-weight: 800;
    color: #fff;
    display: block;
}

/* ── Summary Panel ── */
.summary-panel {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 8pt;
    margin: 14pt 0;
    padding: 12pt;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6pt;
}
.summary-item {
    text-align: center;
    padding: 6pt 4pt;
}
.summary-item .summary-label {
    font-size: 7pt;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
    margin-bottom: 2pt;
}
.summary-item .summary-value {
    font-size: 12pt;
    font-weight: 800;
    color: #0d2137;
}
.summary-item .summary-value.red { color: #dc2626; }
.summary-item .summary-value.green { color: #16a34a; }
.summary-item .summary-value.orange { color: #ea580c; }

/* ── Info Grid ── */
.info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6pt 12pt;
    margin: 12pt 0;
    font-size: 9pt;
}
.info-item {
    display: flex;
    align-items: baseline;
    gap: 6pt;
    padding: 4pt 0;
    border-bottom: 1px solid #f1f5f9;
}
.info-item .label {
    font-weight: 600;
    color: #64748b;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.3pt;
    white-space: nowrap;
}
.info-item .value {
    color: #1e293b;
    font-weight: 500;
}

/* ── Severity Badges ── */
.severity-badge {
    display: inline-block;
    padding: 3pt 10pt;
    border-radius: 10pt;
    font-weight: 700;
    font-size: 8pt;
    color: #fff;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
}
.severity-minor { background: #16a34a; }
.severity-moderate { background: #ea580c; }
.severity-major { background: #dc2626; }
.severity-critical { background: #991b1b; }
.severity-emergency { background: #7f1d1d; }

/* ── Callout Boxes ── */
.diagnosis-box {
    background: #f0f9ff;
    border: 1px solid #bae6fd;
    border-left: 4pt solid #0284c7;
    padding: 12pt 14pt;
    margin: 10pt 0;
    border-radius: 0 6pt 6pt 0;
    font-size: 9.5pt;
}
.diagnosis-box p:first-child { font-weight: 500; }
.warning-box {
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-left: 4pt solid #f59e0b;
    padding: 10pt 14pt;
    margin: 10pt 0;
    border-radius: 0 6pt 6pt 0;
    font-size: 9pt;
}
.price-box {
    background: linear-gradient(135deg, #0d2137 0%, #1e3a5f 100%);
    padding: 16pt 20pt;
    margin: 14pt 0;
    border-radius: 8pt;
    text-align: center;
    position: relative;
    overflow: hidden;
}
.price-box::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3pt;
    background: linear-gradient(90deg, #dc2626, #ef4444);
}
.price-box .price {
    font-size: 30pt;
    font-weight: 800;
    color: #fff;
    letter-spacing: -0.5pt;
}
.price-box .label {
    font-size: 8pt;
    color: #94a3b8;
    margin-top: 3pt;
    text-transform: uppercase;
    letter-spacing: 1pt;
}

/* ── Category Colors ── */
.cat-protection { background: #3b82f6; }
.cat-removal { background: #f97316; }
.cat-inspection { background: #8b5cf6; }
.cat-installation { background: #16a34a; }
.cat-cleanup { background: #64748b; }
.cat-default { background: #0d2137; }

/* ── Step Cards ── */
.step-card {
    break-inside: avoid;
    page-break-inside: avoid;
    border: 1px solid #e2e8f0;
    border-radius: 8pt;
    margin: 8pt 0;
    padding: 0;
    overflow: hidden;
    background: #fff;
}
.step-card .step-header {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 8pt 12pt;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
}
.step-number {
    color: #fff;
    width: 22pt;
    height: 22pt;
    border-radius: 6pt;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 9pt;
    flex-shrink: 0;
    margin-right: 8pt;
}
.step-title {
    font-weight: 700;
    font-size: 10pt;
    color: #0d2137;
    flex: 1;
}
.step-category-label {
    font-size: 7pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
    padding: 2pt 6pt;
    border-radius: 3pt;
    color: #fff;
}
.step-body {
    padding: 10pt 12pt 10pt 42pt;
}
.step-instructions {
    font-size: 9.5pt;
    line-height: 1.55;
    margin: 0;
    color: #334155;
}
.step-meta {
    font-size: 8pt;
    color: #94a3b8;
    margin-top: 6pt;
    display: flex;
    gap: 10pt;
    flex-wrap: wrap;
}
.step-meta-item {
    display: inline-flex;
    align-items: center;
    gap: 3pt;
}
.safety-note {
    background: #fef3c7;
    border: 1px solid #fde68a;
    border-radius: 4pt;
    padding: 6pt 8pt;
    margin: 6pt 0 0 0;
    font-size: 8.5pt;
    color: #92400e;
    display: flex;
    align-items: flex-start;
    gap: 5pt;
}
.safety-icon {
    font-weight: 800;
    flex-shrink: 0;
}
.alt-lang {
    font-size: 8.5pt;
    color: #64748b;
    font-style: italic;
    margin-top: 6pt;
    padding-top: 6pt;
    border-top: 1px dashed #e2e8f0;
}
.alt-lang-label {
    font-weight: 700;
    font-style: normal;
    color: #94a3b8;
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
    margin-right: 4pt;
}

/* ── Materials Table ── */
table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    margin: 8pt 0;
    font-size: 9pt;
    border: 1px solid #e2e8f0;
    border-radius: 6pt;
    overflow: hidden;
}
th {
    background: #0d2137;
    color: #fff;
    padding: 7pt 10pt;
    text-align: left;
    font-weight: 600;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
}
td {
    padding: 6pt 10pt;
    border-bottom: 1px solid #f1f5f9;
    color: #334155;
}
tr:last-child td { border-bottom: none; }
tr:nth-child(even) td { background: #f8fafc; }
.amt { text-align: right; font-family: 'Courier New', monospace; font-weight: 600; }
.total-row td {
    background: #0d2137 !important;
    color: #fff !important;
    font-weight: 700;
    font-size: 10pt;
    padding: 8pt 10pt;
}
.subtotal-row td {
    background: #e2e8f0 !important;
    font-weight: 600;
    color: #0d2137;
}

/* ── Photo Grid ── */
.photo-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8pt;
    margin: 8pt 0;
}
.photo-card {
    break-inside: avoid;
    page-break-inside: avoid;
    border: 1px solid #e2e8f0;
    border-radius: 6pt;
    overflow: hidden;
    background: #fff;
}
.photo-card img {
    width: 100%;
    height: auto;
    display: block;
}
.photo-card .caption {
    padding: 5pt 8pt;
    font-size: 7.5pt;
    color: #475569;
    background: #f8fafc;
    line-height: 1.35;
    border-top: 1px solid #e2e8f0;
}
.photo-label {
    display: inline-block;
    font-size: 7pt;
    font-weight: 700;
    color: #fff;
    padding: 1pt 5pt;
    border-radius: 3pt;
    margin-right: 4pt;
    text-transform: uppercase;
}
.photo-label.before { background: #f97316; }
.photo-label.after { background: #16a34a; }

/* ── Approval Section ── */
.approval-section {
    border: 1.5pt solid #0d2137;
    padding: 16pt;
    margin: 16pt 0;
    border-radius: 8pt;
    background: #fafbfc;
}
.approval-section h3 {
    margin-top: 0;
    font-size: 11pt;
    color: #0d2137;
}
.sig-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20pt;
    margin-top: 12pt;
}
.sig-block {}
.signature-line {
    border-bottom: 1pt solid #1e293b;
    height: 28pt;
    margin: 0 0 3pt 0;
}
.signature-label {
    font-size: 7.5pt;
    color: #64748b;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3pt;
}

/* ── Warranty Section ── */
.warranty-section {
    background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%);
    border: 1px solid #bbf7d0;
    padding: 14pt 16pt;
    margin: 14pt 0;
    border-radius: 8pt;
    font-size: 9pt;
}
.warranty-section h3 {
    color: #166534;
    margin-top: 0;
    display: flex;
    align-items: center;
    gap: 6pt;
}
.warranty-badge {
    display: inline-block;
    background: #16a34a;
    color: #fff;
    padding: 2pt 8pt;
    border-radius: 10pt;
    font-size: 7pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
}

/* ── Footer ── */
.footer {
    margin-top: 20pt;
    padding-top: 10pt;
    border-top: 1.5pt solid #e2e8f0;
    font-size: 7.5pt;
    color: #94a3b8;
    text-align: center;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.footer-left { text-align: left; }
.footer-right { text-align: right; }
.footer-center {
    font-size: 7pt;
    color: #cbd5e1;
}
.powered-by {
    font-size: 6.5pt;
    color: #cbd5e1;
    letter-spacing: 0.3pt;
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
            "materials": "Materials Required",
            "item": "Item", "qty": "Qty", "unit": "Unit", "cost": "Cost",
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
            "item": "Articulo", "qty": "Cant.", "unit": "Unidad", "cost": "Costo",
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

    # Category color mapping
    cat_colors = {
        "protection": "cat-protection",
        "removal": "cat-removal",
        "inspection": "cat-inspection",
        "installation": "cat-installation",
        "cleanup": "cat-cleanup",
    }
    cat_labels = {
        "protection": "PREP",
        "removal": "REMOVE",
        "inspection": "INSPECT",
        "installation": "INSTALL",
        "cleanup": "CLEANUP",
    }

    # Pre-compute totals for summary panel
    total_minutes = sum(s.get("time_minutes", 0) for s in repair.get("steps", []))
    hours = total_minutes // 60
    mins = total_minutes % 60
    time_display = f"{hours}h {mins}m" if hours else f"{mins} min"
    num_steps = len(repair.get("steps", []))
    num_materials = len(repair.get("materials_list", []))

    severity = diagnosis.get("severity", "moderate")
    severity_class = f"severity-{severity}"

    # Build steps HTML — both languages, primary first
    steps_html = ""
    for step in repair.get("steps", []):
        step_num = step.get("step", "")
        title = step.get(title_key, step.get("title_en", ""))
        instructions = step.get(instr_key, step.get("instructions_en", ""))
        alt_title = step.get(alt_title_key, "")
        alt_instructions = step.get(alt_instr_key, "")
        time_min = step.get("time_minutes", 0)
        safety = step.get(safety_key, step.get("safety_note_en"))
        photo_ref = step.get("photo_reference")
        materials = step.get("materials", [])
        category = step.get("category", "")

        cat_class = cat_colors.get(category, "cat-default")
        cat_label = cat_labels.get(category, category.upper() if category else "")

        safety_html = ""
        if safety:
            safety_html = f'<div class="safety-note"><span class="safety-icon">&#9888;</span> {safety}</div>'

        # Secondary language block
        alt_lang_html = ""
        if alt_instructions:
            alt_lang_html = f"""<div class="alt-lang">
                <span class="alt-lang-label">{alt_lang_label}:</span> <strong>{alt_title}</strong> &mdash; {alt_instructions}
            </div>"""

        meta_items = []
        if time_min:
            meta_items.append(f'<span class="step-meta-item">&#9201; {time_min} min</span>')
        if materials:
            meta_items.append(f'<span class="step-meta-item">&#9881; {", ".join(materials)}</span>')
        if photo_ref and photo_ref in photo_map:
            meta_items.append(f'<span class="step-meta-item">&#128247; See {photo_ref}</span>')
        meta_html = "".join(meta_items)

        cat_badge = f'<span class="step-category-label {cat_class}">{cat_label}</span>' if cat_label else ""

        steps_html += f"""
        <div class="step-card">
            <div class="step-header">
                <div class="step-number {cat_class}">{step_num}</div>
                <div class="step-title">{title}</div>
                {cat_badge}
            </div>
            <div class="step-body">
                <div class="step-instructions">{instructions}</div>
                {alt_lang_html}
                {safety_html}
                <div class="step-meta">{meta_html}</div>
            </div>
        </div>
        """

    # Build materials table
    materials_html = ""
    if repair.get("materials_list"):
        rows = ""
        for mat in repair["materials_list"]:
            cost = mat.get("cost", 0)
            cost_display = fmt_money(cost) if cost else ""
            rows += f"""
            <tr>
                <td>{mat.get('item', '')}</td>
                <td class="amt">{mat.get('qty', 0)}</td>
                <td>{mat.get('unit', '')}</td>
                <td class="amt">{cost_display}</td>
            </tr>
            """
        materials_html = f"""
        <h2>{L['materials']}</h2>
        <table>
            <tr><th>{L['item']}</th><th style="text-align:right">{L['qty']}</th><th>{L['unit']}</th><th style="text-align:right">{L['cost']}</th></tr>
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

    address_line = f"{prop.get('address', '')} {prop.get('city', '')}, {prop.get('state', '')} {prop.get('zip', '')}".strip()
    job_date = config.get('job', {}).get('created', '')[:10]
    job_id = config.get('job', {}).get('job_id', '')
    technician = submission.get('submitted_by', '')

    html = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>{CSS_REPAIR}</style></head>
<body>

<div class="header-bar">
    {'<img class="logo-img" src="' + logo_b64 + '">' if logo_b64 else ''}
    <div class="header-text">
        <div class="company">{company_name.upper()}</div>
        <h1>{L['title']}</h1>
        <div class="subtitle">{L['subtitle']} &mdash; {address_line}</div>
    </div>
    <div class="header-badge">
        <span class="badge-value">{num_steps}</span>
        STEPS
    </div>
</div>

<div class="content">

<div class="summary-panel">
    <div class="summary-item">
        <div class="summary-label">Severity</div>
        <div class="summary-value"><span class="severity-badge {severity_class}">{severity.upper()}</span></div>
    </div>
    <div class="summary-item">
        <div class="summary-label">Est. Time</div>
        <div class="summary-value">{time_display}</div>
    </div>
    <div class="summary-item">
        <div class="summary-label">Materials</div>
        <div class="summary-value">{num_materials}</div>
    </div>
    <div class="summary-item">
        <div class="summary-label">Total Cost</div>
        <div class="summary-value red">{fmt_money(repair.get('total_price', 0))}</div>
    </div>
</div>

<div class="info-grid">
    <div class="info-item"><span class="label">Property</span> <span class="value">{address_line}</span></div>
    <div class="info-item"><span class="label">Date</span> <span class="value">{job_date}</span></div>
    <div class="info-item"><span class="label">Technician</span> <span class="value">{technician}</span></div>
    <div class="info-item"><span class="label">Job ID</span> <span class="value">{job_id}</span></div>
</div>

<h2>{L['diagnosis']}</h2>
<div class="diagnosis-box">
    <p>{diagnosis.get('leak_source', '')}</p>
    <p style="margin-top:6pt;"><span class="severity-badge {severity_class}">{severity.upper()}</span></p>
</div>

<h2>{L['steps']}</h2>
{steps_html}

{materials_html}

{photos_html}

<div class="footer">
    <div class="footer-left">{company_name} &middot; {contractor.get('phone', '')}</div>
    <div class="footer-center"><span class="powered-by">POWERED BY DUMB ROOF REPAIR AI</span></div>
    <div class="footer-right">{job_id} &middot; {job_date}</div>
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

    price = ticket.get("price", repair.get("total_price", 0))
    time_est = ticket.get("time_estimate", "")
    address_line = f"{prop.get('address', '')} {prop.get('city', '')}, {prop.get('state', '')} {prop.get('zip', '')}".strip()
    job_date = config.get('job', {}).get('created', '')[:10]
    job_id = config.get('job', {}).get('job_id', '')
    homeowner_name = homeowner.get('name', '')

    # Key photos (show first 4, embedded in "What We Found" section)
    photos_html = ""
    photo_keys = [k for k in sorted(photo_map.keys()) if not k.startswith("_")]
    show_photos = photo_keys[:4]
    if show_photos:
        photo_cards = ""
        for key in show_photos:
            filename = photo_map[key]
            img_data = b64_img(config, filename)
            if not img_data:
                continue
            annotation = annotations.get(key, "")
            if len(annotation) > 120:
                annotation = annotation[:117] + "..."
            photo_cards += f"""
            <div class="photo-card">
                <img src="{img_data}" alt="Inspection photo">
                <div class="caption">{annotation}</div>
            </div>
            """
        if photo_cards:
            photos_html = f"""<div class="photo-grid">{photo_cards}</div>"""

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
            <tr class="subtotal-row">
                <td colspan="3">Materials Subtotal</td>
                <td class="amt">{fmt_money(materials_cost)}</td>
            </tr>
            <tr>
                <td colspan="3">Labor ({labor_hours} hours)</td>
                <td class="amt">{fmt_money(labor_cost)}</td>
            </tr>
            <tr class="total-row">
                <td colspan="3">TOTAL</td>
                <td class="amt">{fmt_money(total)}</td>
            </tr>
        </table>
        """

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
    <div class="header-badge">
        <span class="badge-value">{fmt_money(price)}</span>
        TOTAL COST
    </div>
</div>

<div class="content">

<div class="summary-panel">
    <div class="summary-item">
        <div class="summary-label">Urgency</div>
        <div class="summary-value"><span class="severity-badge {severity_class}">{severity.upper()}</span></div>
    </div>
    <div class="summary-item">
        <div class="summary-label">Est. Time</div>
        <div class="summary-value">{time_est or "TBD"}</div>
    </div>
    <div class="summary-item">
        <div class="summary-label">Warranty</div>
        <div class="summary-value green">2 Year</div>
    </div>
    <div class="summary-item">
        <div class="summary-label">Total Cost</div>
        <div class="summary-value red">{fmt_money(price)}</div>
    </div>
</div>

<div class="info-grid">
    <div class="info-item"><span class="label">Property</span> <span class="value">{address_line}</span></div>
    <div class="info-item"><span class="label">Homeowner</span> <span class="value">{homeowner_name}</span></div>
    <div class="info-item"><span class="label">Date</span> <span class="value">{job_date}</span></div>
    <div class="info-item"><span class="label">Ticket #</span> <span class="value">{job_id}</span></div>
</div>

<h2>What We Found</h2>
<div class="diagnosis-box">
    <p>{ticket.get('what_we_found', '')}</p>
    <p style="margin-top:8pt;"><span class="severity-badge {severity_class}">Urgency: {severity.upper()}</span></p>
    <p style="font-size:9pt; color:#475569; margin-top:4pt;">{urgency_display}</p>
</div>

{photos_html}

<h2>What We Recommend</h2>
<p>{ticket.get('what_we_recommend', '')}</p>

<div class="price-box">
    <div class="price">{fmt_money(price)}</div>
    <div class="label">Total Repair Cost &middot; Materials + Labor</div>
</div>

{materials_html}

<div class="warranty-section">
    <h3><span class="warranty-badge">INCLUDED</span> Workmanship Warranty</h3>
    <p style="margin-top:6pt;">{ticket.get('warranty', '2-year workmanship warranty')}</p>
</div>

<div class="approval-section">
    <h3>Ready to Repair</h3>
    <p style="font-size:9.5pt; color:#334155; line-height:1.6;">
        We can perform this repair right now &mdash; we just need your digital signature below.
        Upon completion of the repair we will provide a quality control summary and charge your preferred payment method.
    </p>
    <p style="font-size:9pt; color:#475569; margin-top:8pt;">I authorize {company_name} to perform the repair described above at the stated price of <strong>{fmt_money(price)}</strong>.</p>
    <div class="sig-grid">
        <div class="sig-block">
            <div class="signature-line"></div>
            <div class="signature-label">Homeowner Signature</div>
        </div>
        <div class="sig-block">
            <div class="signature-line"></div>
            <div class="signature-label">Date</div>
        </div>
    </div>
</div>

<div class="footer">
    <div class="footer-left">{company_name} &middot; {contractor.get('phone', '')} &middot; {contractor.get('email', '')}</div>
    <div class="footer-center"><span class="powered-by">POWERED BY DUMB ROOF REPAIR AI</span></div>
    <div class="footer-right">{job_id}</div>
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

    address_line = f"{prop.get('address', '')} {prop.get('city', '')}, {prop.get('state', '')} {prop.get('zip', '')}".strip()
    job_id = config.get('job', {}).get('job_id', '')
    homeowner_name = homeowner.get('name', '')
    price = ticket.get("price", repair.get("total_price", 0))

    # Before/after photos
    photos_html = ""
    completion_photos = completion.get("completion_photos", [])
    before_keys = [k for k in sorted(photo_map.keys()) if not k.startswith("_")][:2]

    if before_keys or completion_photos:
        cards = ""
        for key in before_keys:
            filename = photo_map.get(key, "")
            if not filename:
                continue
            img_data = b64_img(config, filename)
            if img_data:
                cards += f"""
                <div class="photo-card">
                    <img src="{img_data}" alt="Before">
                    <div class="caption"><span class="photo-label before">BEFORE</span> {key}</div>
                </div>
                """
        for photo_file in completion_photos[:2]:
            qa_path = os.path.join(config["_paths"]["qa_photos"], photo_file)
            if os.path.exists(qa_path):
                img_data = b64_img_path(qa_path)
                if img_data:
                    cards += f"""
                    <div class="photo-card">
                        <img src="{img_data}" alt="After">
                        <div class="caption"><span class="photo-label after">AFTER</span> {photo_file}</div>
                    </div>
                    """
        if cards:
            photos_html = f"""
            <h2>Before &amp; After</h2>
            <div class="photo-grid">{cards}</div>
            """

    html = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>{CSS_REPAIR}</style></head>
<body>

<div class="header-bar">
    {'<img class="logo-img" src="' + logo_b64 + '">' if logo_b64 else ''}
    <div class="header-text">
        <div class="company">{company_name.upper()}</div>
        <h1>COMPLETION RECEIPT</h1>
        <div class="subtitle">Repair Completed &amp; Warranty Documentation</div>
    </div>
    <div class="header-badge">
        <span class="badge-value">&#10003;</span>
        COMPLETE
    </div>
</div>

<div class="content">

<div class="summary-panel">
    <div class="summary-item">
        <div class="summary-label">Property</div>
        <div class="summary-value" style="font-size:9pt;">{prop.get('address', '')}</div>
    </div>
    <div class="summary-item">
        <div class="summary-label">Completed</div>
        <div class="summary-value green">{completed_date}</div>
    </div>
    <div class="summary-item">
        <div class="summary-label">Warranty</div>
        <div class="summary-value green">2 Year</div>
    </div>
    <div class="summary-item">
        <div class="summary-label">Amount</div>
        <div class="summary-value">{fmt_money(price)}</div>
    </div>
</div>

<div class="info-grid">
    <div class="info-item"><span class="label">Property</span> <span class="value">{address_line}</span></div>
    <div class="info-item"><span class="label">Homeowner</span> <span class="value">{homeowner_name}</span></div>
    <div class="info-item"><span class="label">Completed</span> <span class="value">{completed_date}</span></div>
    <div class="info-item"><span class="label">Ticket #</span> <span class="value">{job_id}</span></div>
</div>

<h2>Work Performed</h2>
<div class="diagnosis-box">
    <p><strong>Issue:</strong> {diagnosis.get('leak_source', '')}</p>
    <p style="margin-top:6pt;"><strong>Repair:</strong> {repair.get('summary', '')}</p>
</div>

{photos_html}

<div class="price-box">
    <div class="price">{fmt_money(price)}</div>
    <div class="label">Total Charged</div>
</div>

<div class="warranty-section">
    <h3><span class="warranty-badge">2 YEAR</span> Workmanship Warranty</h3>
    <p style="margin-top:8pt;">{ticket.get('warranty', '2-year workmanship warranty')}</p>
    <div class="info-grid" style="margin-top:8pt;">
        <div class="info-item"><span class="label">Warranty Start</span> <span class="value">{completed_date}</span></div>
        <div class="info-item"><span class="label">Contractor</span> <span class="value">{company_name}</span></div>
        <div class="info-item"><span class="label">Phone</span> <span class="value">{contractor.get('phone', '')}</span></div>
        <div class="info-item"><span class="label">Email</span> <span class="value">{contractor.get('email', '')}</span></div>
    </div>
    <p style="margin-top:8pt; font-size:8pt; color:#475569;">
        This warranty covers workmanship defects in the repair described above.
        It does not cover damage from subsequent storms, acts of nature, or
        unrelated structural issues. Contact us immediately if the repaired
        area shows signs of leaking.
    </p>
</div>

{f'<h2>Notes</h2><p style="font-size:9.5pt; color:#475569;">{completion.get("notes", "")}</p>' if completion.get("notes") else ''}

<div class="approval-section">
    <h3>Acknowledgment of Completion</h3>
    <p style="font-size:9pt; color:#475569;">I acknowledge that the repair described above has been completed to my satisfaction.</p>
    <div class="sig-grid">
        <div class="sig-block">
            <div class="signature-line"></div>
            <div class="signature-label">Homeowner Signature</div>
        </div>
        <div class="sig-block">
            <div class="signature-line"></div>
            <div class="signature-label">Date</div>
        </div>
    </div>
    <div class="sig-grid" style="margin-top:8pt;">
        <div class="sig-block">
            <div class="signature-line"></div>
            <div class="signature-label">Contractor Signature</div>
        </div>
        <div class="sig-block">
            <div class="signature-line"></div>
            <div class="signature-label">Date</div>
        </div>
    </div>
</div>

<div class="footer">
    <div class="footer-left">{company_name} &middot; {contractor.get('phone', '')} &middot; {contractor.get('email', '')}</div>
    <div class="footer-center"><span class="powered-by">POWERED BY DUMB ROOF REPAIR AI</span></div>
    <div class="footer-right">{job_id} &middot; {completed_date}</div>
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
    try:
        html_to_pdf(html1_path, pdf1_path)
    except Exception as e:
        print(f"[REPAIR] PDF generation failed for {pdf1_path}: {e}")
        raise RuntimeError(f"PDF generation failed: {e}")

    # Document 2: Repair Ticket
    print("Generating: 02_REPAIR_TICKET...")
    html2 = build_repair_ticket(config)
    html2_path = os.path.join(output_dir, "02_REPAIR_TICKET.html")
    pdf2_path = os.path.join(output_dir, "02_REPAIR_TICKET.pdf")
    with open(html2_path, "w") as f:
        f.write(html2)
    try:
        html_to_pdf(html2_path, pdf2_path)
    except Exception as e:
        print(f"[REPAIR] PDF generation failed for {pdf2_path}: {e}")
        raise RuntimeError(f"PDF generation failed: {e}")

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
            try:
                html_to_pdf(html3_path, pdf3_path)
            except Exception as e:
                print(f"[REPAIR] PDF generation failed for {pdf3_path}: {e}")
                raise RuntimeError(f"PDF generation failed: {e}")
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
