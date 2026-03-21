"""
DumbRoof PDF Template Engine — Multi-Style Document Generator
==============================================================
Generates Invoice, Certificate of Completion (COC), and Supplement Cover
Letter PDFs in multiple visual styles from the SAME endpoint tags.

Styles:
  BOLD    — Logo-centric, graphic-heavy (Apple/GMC aesthetic). Big logo,
            bold typography, color-blocked sections, brand-forward.
  MEMO    — Professional memo / letterhead style. Traditional business
            document, text-focused, classic serif typography.
  MODERN  — Modern minimal. Clean lines, generous whitespace, subtle
            accent colors, sans-serif, understated elegance.
  CLASSIC — The current DumbRoof default. Navy + accent blue, clean
            tabular layout (matches existing claim_brain_pdfs.py style).

All styles use the SAME data interface (endpoint tags):

  company_profile: {
      company_name, address, city_state_zip, phone, email, website,
      license_number, contact_name, contact_title, logo_b64
  }

  claim_data: {
      id, homeowner_name, address, carrier, date_of_loss, claim_number,
      contractor_rcv, current_carrier_rcv, original_carrier_rcv,
      deductible, settlement_amount
  }

Usage:
    from pdf_templates import generate_pdf

    pdf_bytes = generate_pdf("invoice", "bold", claim_data, company_profile,
                             payment_link="https://...", line_items=[...])

    pdf_bytes = generate_pdf("coc", "modern", claim_data, company_profile)

    pdf_bytes = generate_pdf("supplement_cover", "memo", claim_data,
                             company_profile, supplement_items=[...])
"""

from __future__ import annotations
import io
import os
import subprocess
import tempfile
from datetime import datetime, timedelta
from typing import Optional

# ═══════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════

def _safe(val, default=""):
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return val
    return val if val else default


def _fmt_currency(amount) -> str:
    try:
        return f"${float(amount or 0):,.2f}"
    except (ValueError, TypeError):
        return "$0.00"


def _fmt_date(date_str, fmt="%B %d, %Y") -> str:
    if not date_str:
        return datetime.now().strftime(fmt)
    try:
        if "T" in str(date_str):
            return datetime.fromisoformat(str(date_str).replace("Z", "")).strftime(fmt)
        return datetime.strptime(str(date_str), "%Y-%m-%d").strftime(fmt)
    except Exception:
        return str(date_str)


_CHROME_CANDIDATES = [
    os.environ.get("CHROMIUM_PATH", ""),
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]
CHROME = next((c for c in _CHROME_CANDIDATES if c and os.path.exists(c)), _CHROME_CANDIDATES[-1])


def _html_to_pdf_bytes(html: str) -> bytes:
    """Render HTML to PDF via Chrome headless and return bytes."""
    with tempfile.TemporaryDirectory() as tmpdir:
        html_path = os.path.join(tmpdir, "doc.html")
        pdf_path = os.path.join(tmpdir, "doc.pdf")
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(html)
        cmd = [
            CHROME, "--headless", "--disable-gpu", "--no-sandbox",
            "--disable-software-rasterizer",
            f"--print-to-pdf={pdf_path}",
            "--no-pdf-header-footer", "--print-to-pdf-no-header",
            f"file://{html_path}"
        ]
        subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 1024:
            with open(pdf_path, "rb") as f:
                return f.read()
    raise RuntimeError("Chrome headless failed to generate PDF")


# ═══════════════════════════════════════════════════════════════════
# TEMPLATE REGISTRY
# ═══════════════════════════════════════════════════════════════════

STYLES = ("bold", "memo", "modern", "classic")
DOC_TYPES = ("invoice", "coc", "supplement_cover")

# Map of (doc_type, style) -> builder function — populated by decorators below
_BUILDERS = {}


def _register(doc_type: str, style: str):
    """Decorator to register a template builder function."""
    def decorator(fn):
        _BUILDERS[(doc_type, style)] = fn
        return fn
    return decorator


def generate_pdf(
    doc_type: str,
    style: str,
    claim_data: dict,
    company_profile: dict,
    **kwargs,
) -> bytes:
    """
    Public API — generate a PDF for any doc_type + style combo.

    Parameters
    ----------
    doc_type : "invoice" | "coc" | "supplement_cover"
    style    : "bold" | "memo" | "modern" | "classic"
    claim_data : dict with claim endpoint tags
    company_profile : dict with company endpoint tags
    **kwargs : doc-type-specific params (payment_link, line_items, etc.)

    Returns
    -------
    bytes : PDF file contents
    """
    key = (doc_type.lower(), style.lower())
    if key not in _BUILDERS:
        raise ValueError(
            f"No template for doc_type={doc_type!r}, style={style!r}. "
            f"Available: {list(_BUILDERS.keys())}"
        )
    return _BUILDERS[key](claim_data, company_profile, **kwargs)


def list_templates() -> list[dict]:
    """Return all registered template combos for API/UI consumption."""
    return [
        {"doc_type": dt, "style": st, "label": f"{dt.replace('_', ' ').title()} — {st.title()}"}
        for dt, st in sorted(_BUILDERS.keys())
    ]


# ═══════════════════════════════════════════════════════════════════
# COMMON DATA EXTRACTION  (shared by all templates)
# ═══════════════════════════════════════════════════════════════════

def _extract_company(cp: dict) -> dict:
    """Normalize company_profile into a clean dict."""
    return {
        "name": _safe(cp.get("company_name"), "Roofing Company"),
        "address": _safe(cp.get("address")),
        "city_state_zip": _safe(cp.get("city_state_zip")),
        "phone": _safe(cp.get("phone")),
        "email": _safe(cp.get("email")),
        "website": _safe(cp.get("website")),
        "license": _safe(cp.get("license_number")),
        "contact_name": _safe(cp.get("contact_name")),
        "contact_title": _safe(cp.get("contact_title")),
        "logo_b64": _safe(cp.get("logo_b64")),
    }


def _extract_claim(cd: dict) -> dict:
    """Normalize claim_data into a clean dict."""
    return {
        "id": _safe(cd.get("id"), ""),
        "homeowner": _safe(cd.get("homeowner_name"), "Homeowner"),
        "address": _safe(cd.get("address"), "Property Address"),
        "carrier": _safe(cd.get("carrier"), "Insurance Carrier"),
        "date_of_loss": _safe(cd.get("date_of_loss")),
        "claim_number": _safe(cd.get("claim_number")),
        "contractor_rcv": float(_safe(cd.get("contractor_rcv"), 0)),
        "carrier_rcv": float(_safe(cd.get("current_carrier_rcv", cd.get("original_carrier_rcv")), 0)),
        "deductible": float(_safe(cd.get("deductible"), 0)),
        "settlement": float(_safe(cd.get("settlement_amount"), 0)),
    }


def _build_line_items_html(claim: dict, line_items: list | None, style_cfg: dict) -> tuple[str, float]:
    """Build line items table rows + compute subtotal. Returns (rows_html, subtotal)."""
    rows = []
    subtotal = 0
    if line_items:
        for item in line_items:
            desc = _safe(item.get("description"), "Line item")
            qty = float(_safe(item.get("qty", item.get("quantity", 1)), 1))
            unit = float(_safe(item.get("unit_price", item.get("price", 0)), 0))
            total = qty * unit
            subtotal += total
            rows.append(f"<tr><td>{desc}</td><td class='amt'>{qty:.1f}</td>"
                        f"<td class='amt'>{_fmt_currency(unit)}</td>"
                        f"<td class='amt'>{_fmt_currency(total)}</td></tr>")
    else:
        rcv = claim["contractor_rcv"]
        crcv = claim["carrier_rcv"]
        ded = claim["deductible"]
        if rcv:
            rows.append(f"<tr><td>Storm damage restoration per approved scope</td>"
                        f"<td class='amt'>1</td><td class='amt'>{_fmt_currency(rcv)}</td>"
                        f"<td class='amt'>{_fmt_currency(rcv)}</td></tr>")
            subtotal = rcv
        if crcv:
            rows.append(f"<tr><td>Less: Insurance payment received</td>"
                        f"<td class='amt'>1</td><td class='amt'>({_fmt_currency(crcv)})</td>"
                        f"<td class='amt'>({_fmt_currency(crcv)})</td></tr>")
            subtotal -= crcv
        if ded:
            rows.append(f"<tr><td>Homeowner deductible</td>"
                        f"<td class='amt'>1</td><td class='amt'>{_fmt_currency(ded)}</td>"
                        f"<td class='amt'>{_fmt_currency(ded)}</td></tr>")
    return "\n".join(rows), max(subtotal, 0)


# ═══════════════════════════════════════════════════════════════════
#  STYLE 1 : BOLD  —  Logo-centric / Apple-GMC aesthetic
# ═══════════════════════════════════════════════════════════════════
# Design: Full-width dark header with oversized logo, bold sans-serif
# type, color-blocked sections, heavy visual weight. The company
# brand IS the document.

BOLD_CSS = """
@page { size: letter; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: -apple-system, 'SF Pro Display', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    color: #1a1a1a;
    font-size: 10pt;
    line-height: 1.5;
}
.page { padding: 0; min-height: 11in; position: relative; }

/* ── Hero header ── */
.hero {
    background: #0d0d0d;
    padding: 48pt 48pt 40pt;
    display: flex;
    align-items: center;
    gap: 28pt;
}
.hero .logo-wrap {
    flex-shrink: 0;
}
.hero .logo-wrap img {
    height: 72pt;
    width: auto;
    display: block;
}
.hero .logo-placeholder {
    width: 72pt;
    height: 72pt;
    background: #222;
    border-radius: 8pt;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28pt;
    font-weight: 900;
    color: #fff;
    letter-spacing: -1pt;
}
.hero .hero-text { flex: 1; }
.hero .company-name {
    font-size: 22pt;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: 0.5pt;
    margin-bottom: 4pt;
}
.hero .doc-title {
    font-size: 13pt;
    font-weight: 400;
    color: rgba(255,255,255,0.55);
    text-transform: uppercase;
    letter-spacing: 4pt;
}

/* ── Content area ── */
.content { padding: 32pt 48pt 48pt; }

/* ── Accent bar ── */
.accent-bar {
    height: 4pt;
    background: linear-gradient(90deg, #c8102e 0%, #0d2137 100%);
}

/* ── Info grid ── */
.info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20pt;
    margin-bottom: 28pt;
}
.info-block {}
.info-label {
    font-size: 7.5pt;
    text-transform: uppercase;
    letter-spacing: 2pt;
    color: #999;
    margin-bottom: 3pt;
    font-weight: 600;
}
.info-value {
    font-size: 11pt;
    font-weight: 600;
    color: #1a1a1a;
}

/* ── Table ── */
table { width: 100%; border-collapse: collapse; margin: 20pt 0; }
thead th {
    background: #0d0d0d;
    color: #fff;
    padding: 10pt 12pt;
    text-align: left;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 1.5pt;
    font-weight: 700;
}
tbody td {
    padding: 10pt 12pt;
    font-size: 10pt;
    border-bottom: 1px solid #eee;
}
tbody tr:nth-child(even) td { background: #fafafa; }
.amt { text-align: right; font-variant-numeric: tabular-nums; }

/* ── Total block ── */
.total-block {
    background: #0d0d0d;
    color: #fff;
    padding: 16pt 24pt;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-radius: 4pt;
    margin-top: 12pt;
}
.total-block .total-label {
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 2pt;
    color: rgba(255,255,255,0.6);
}
.total-block .total-amount {
    font-size: 24pt;
    font-weight: 800;
    letter-spacing: -0.5pt;
}

/* ── Section headers ── */
.section-title {
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 3pt;
    color: #999;
    font-weight: 700;
    margin: 28pt 0 12pt;
    padding-bottom: 6pt;
    border-bottom: 2pt solid #0d0d0d;
}

/* ── Pay link ── */
.pay-link {
    display: inline-block;
    background: #c8102e;
    color: #fff;
    padding: 10pt 28pt;
    border-radius: 4pt;
    text-decoration: none;
    font-weight: 700;
    font-size: 10pt;
    letter-spacing: 1pt;
    text-transform: uppercase;
    margin-top: 12pt;
}

/* ── Signature ── */
.sig-area {
    margin-top: 32pt;
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 32pt;
}
.sig-line {
    border-top: 2pt solid #0d0d0d;
    padding-top: 6pt;
}
.sig-label {
    font-size: 7.5pt;
    text-transform: uppercase;
    letter-spacing: 2pt;
    color: #999;
}

/* ── Footer ── */
.footer {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: #fafafa;
    padding: 12pt 48pt;
    font-size: 7pt;
    color: #bbb;
    text-align: center;
    border-top: 1px solid #eee;
}

/* ── COC badge ── */
.completion-badge {
    background: #0d0d0d;
    color: #fff;
    padding: 20pt;
    text-align: center;
    border-radius: 4pt;
    margin: 20pt 0;
}
.completion-badge .badge-icon {
    font-size: 32pt;
    margin-bottom: 8pt;
}
.completion-badge .badge-text {
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 3pt;
    color: rgba(255,255,255,0.6);
}

/* ── Note block ── */
.note-block {
    background: #f5f5f5;
    padding: 16pt 20pt;
    border-radius: 4pt;
    margin: 16pt 0;
    font-size: 9.5pt;
    color: #555;
}

/* ── Contact strip ── */
.contact-strip {
    font-size: 8pt;
    color: rgba(255,255,255,0.4);
    margin-top: 6pt;
}
"""


@_register("invoice", "bold")
def _invoice_bold(claim_data, company_profile, **kw):
    co = _extract_company(company_profile)
    cl = _extract_claim(claim_data)
    inv_num = kw.get("invoice_number") or f"INV-{datetime.now().strftime('%Y%m%d')}-{str(cl['id'])[:8].upper()}"
    due = kw.get("due_date") or (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
    rows_html, subtotal = _build_line_items_html(cl, kw.get("line_items"), {})

    logo_html = f'<img src="{co["logo_b64"]}" alt="{co["name"]}">' if co["logo_b64"] else f'<div class="logo-placeholder">{co["name"][0]}</div>'
    contact_parts = " &nbsp;·&nbsp; ".join(p for p in [co["phone"], co["email"], co["website"]] if p)

    payment_html = ""
    if kw.get("payment_link"):
        payment_html = f'<a href="{kw["payment_link"]}" class="pay-link">Pay Now</a>'

    notes_html = f'<div class="note-block">{kw["notes"]}</div>' if kw.get("notes") else ""

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{BOLD_CSS}</style></head><body>
<div class="page">
    <div class="hero">
        <div class="logo-wrap">{logo_html}</div>
        <div class="hero-text">
            <div class="company-name">{co["name"]}</div>
            <div class="doc-title">Invoice</div>
            <div class="contact-strip">{contact_parts}</div>
        </div>
    </div>
    <div class="accent-bar"></div>
    <div class="content">
        <div class="info-grid">
            <div>
                <div class="info-block">
                    <div class="info-label">Invoice Number</div>
                    <div class="info-value">{inv_num}</div>
                </div>
                <div class="info-block" style="margin-top:14pt">
                    <div class="info-label">Date</div>
                    <div class="info-value">{_fmt_date(None)}</div>
                </div>
                <div class="info-block" style="margin-top:14pt">
                    <div class="info-label">Due Date</div>
                    <div class="info-value">{_fmt_date(due)}</div>
                </div>
            </div>
            <div>
                <div class="info-block">
                    <div class="info-label">Bill To</div>
                    <div class="info-value">{cl["homeowner"]}</div>
                    <div style="font-size:9.5pt; color:#666; margin-top:2pt;">{cl["address"]}</div>
                </div>
                <div class="info-block" style="margin-top:14pt">
                    <div class="info-label">Insurance Carrier</div>
                    <div class="info-value">{cl["carrier"]}</div>
                </div>
                {"<div class='info-block' style='margin-top:14pt'><div class='info-label'>Date of Loss</div><div class='info-value'>" + _fmt_date(cl["date_of_loss"]) + "</div></div>" if cl["date_of_loss"] else ""}
            </div>
        </div>

        <table>
            <thead>
                <tr><th>Description</th><th class="amt">Qty</th><th class="amt">Unit Price</th><th class="amt">Total</th></tr>
            </thead>
            <tbody>
                {rows_html}
            </tbody>
        </table>

        <div class="total-block">
            <div class="total-label">Total Due</div>
            <div class="total-amount">{_fmt_currency(subtotal)}</div>
        </div>

        {payment_html}
        {notes_html}
    </div>
    <div class="footer">Generated by DumbRoof.ai &middot; {_fmt_date(None)}</div>
</div>
</body></html>"""
    return _html_to_pdf_bytes(html)


@_register("coc", "bold")
def _coc_bold(claim_data, company_profile, **kw):
    co = _extract_company(company_profile)
    cl = _extract_claim(claim_data)
    comp_date = kw.get("completion_date") or datetime.now().strftime("%Y-%m-%d")

    logo_html = f'<img src="{co["logo_b64"]}" alt="{co["name"]}">' if co["logo_b64"] else f'<div class="logo-placeholder">{co["name"][0]}</div>'
    contact_parts = " &nbsp;·&nbsp; ".join(p for p in [co["phone"], co["email"], co["website"]] if p)

    work_desc = kw.get("work_description") or (
        f"All storm damage restoration work at {cl['address']} has been completed in accordance "
        f"with the approved insurance scope of work and applicable building codes. Materials "
        f"installed per manufacturer specifications. All debris removed and property cleaned."
    )

    fin_html = ""
    if cl["contractor_rcv"]:
        rows = [f"<tr><td>Total Contract Amount</td><td class='amt'>{_fmt_currency(cl['contractor_rcv'])}</td></tr>"]
        if cl["carrier_rcv"]:
            rows.append(f"<tr><td>Insurance Approved</td><td class='amt'>{_fmt_currency(cl['carrier_rcv'])}</td></tr>")
        if cl["settlement"]:
            rows.append(f"<tr><td>Settlement Amount</td><td class='amt'>{_fmt_currency(cl['settlement'])}</td></tr>")
        fin_html = f"""
        <div class="section-title">Financial Summary</div>
        <table><tbody>{''.join(rows)}</tbody></table>"""

    warranty_html = f'<div class="section-title">Warranty</div><p>{kw["warranty_terms"]}</p>' if kw.get("warranty_terms") else ""

    sig_name = " — ".join(p for p in [co["contact_name"], co["name"]] if p)

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{BOLD_CSS}</style></head><body>
<div class="page">
    <div class="hero">
        <div class="logo-wrap">{logo_html}</div>
        <div class="hero-text">
            <div class="company-name">{co["name"]}</div>
            <div class="doc-title">Certificate of Completion</div>
            <div class="contact-strip">{contact_parts}</div>
        </div>
    </div>
    <div class="accent-bar"></div>
    <div class="content">
        <div class="completion-badge">
            <div class="badge-icon">&#10003;</div>
            <div class="badge-text">Work Complete</div>
        </div>

        <div class="info-grid">
            <div>
                <div class="info-block"><div class="info-label">Property Owner</div><div class="info-value">{cl["homeowner"]}</div></div>
                <div class="info-block" style="margin-top:14pt"><div class="info-label">Property Address</div><div class="info-value">{cl["address"]}</div></div>
            </div>
            <div>
                {"<div class='info-block'><div class='info-label'>Insurance Carrier</div><div class='info-value'>" + cl["carrier"] + "</div></div>" if cl["carrier"] != "Insurance Carrier" else ""}
                {"<div class='info-block' style='margin-top:14pt'><div class='info-label'>Date of Loss</div><div class='info-value'>" + _fmt_date(cl["date_of_loss"]) + "</div></div>" if cl["date_of_loss"] else ""}
                <div class="info-block" style="margin-top:14pt"><div class="info-label">Completion Date</div><div class="info-value">{_fmt_date(comp_date)}</div></div>
            </div>
        </div>

        <div class="section-title">Scope of Work Completed</div>
        <p>{work_desc}</p>

        {fin_html}
        {warranty_html}

        <div style="margin-top:28pt; padding:16pt 20pt; background:#f5f5f5; border-radius:4pt; font-size:9pt; color:#666;">
            I hereby certify that all work described above has been completed in a workmanlike manner
            and in compliance with applicable building codes and insurance scope of work.
        </div>

        <div class="sig-area">
            <div>
                <div class="sig-line"></div>
                <div style="font-weight:600; margin-top:4pt;">{sig_name}</div>
                <div class="sig-label">Authorized Signature</div>
            </div>
            <div>
                <div class="sig-line"></div>
                <div style="font-weight:600; margin-top:4pt;">{_fmt_date(comp_date)}</div>
                <div class="sig-label">Date</div>
            </div>
        </div>
    </div>
    <div class="footer">Generated by DumbRoof.ai &middot; {_fmt_date(None)}</div>
</div>
</body></html>"""
    return _html_to_pdf_bytes(html)


@_register("supplement_cover", "bold")
def _supp_bold(claim_data, company_profile, **kw):
    co = _extract_company(company_profile)
    cl = _extract_claim(claim_data)
    contact_parts = " &nbsp;·&nbsp; ".join(p for p in [co["phone"], co["email"], co["website"]] if p)

    logo_html = f'<img src="{co["logo_b64"]}" alt="{co["name"]}">' if co["logo_b64"] else f'<div class="logo-placeholder">{co["name"][0]}</div>'

    variance = cl["contractor_rcv"] - cl["carrier_rcv"] if cl["contractor_rcv"] and cl["carrier_rcv"] else 0

    variance_html = ""
    if variance > 0:
        variance_html = f"""
        <p style="margin-top:12pt;">Our documented scope totals <strong>{_fmt_currency(cl['contractor_rcv'])}</strong>,
        compared to the current carrier scope of <strong>{_fmt_currency(cl['carrier_rcv'])}</strong> —
        a variance of <strong>{_fmt_currency(variance)}</strong>.</p>"""

    items_html = ""
    if kw.get("supplement_items"):
        rows = []
        for item in kw["supplement_items"]:
            rows.append(f"<tr><td>{_safe(item.get('item'), 'Item')}</td>"
                        f"<td>{_safe(item.get('description'), '')}</td>"
                        f"<td class='amt'>{_fmt_currency(item.get('amount', 0))}</td></tr>")
        items_html = f"""
        <div class="section-title">Supplemental Items</div>
        <table><thead><tr><th>Item</th><th>Description</th><th class="amt">Amount</th></tr></thead>
        <tbody>{''.join(rows)}</tbody></table>"""

    re_lines = [f"Insured: {cl['homeowner']}", f"Property: {cl['address']}"]
    if cl["claim_number"]:
        re_lines.append(f"Claim #: {cl['claim_number']}")
    if cl["date_of_loss"]:
        re_lines.append(f"Date of Loss: {_fmt_date(cl['date_of_loss'])}")
    re_html = "<br>".join(re_lines)

    sig_parts = []
    if co["contact_name"]:
        sig_parts.append(f"<strong>{co['contact_name']}</strong>")
    if co["contact_title"]:
        sig_parts.append(co["contact_title"])
    sig_parts.append(co["name"])

    notes_html = f'<div class="note-block">{kw["additional_notes"]}</div>' if kw.get("additional_notes") else ""

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{BOLD_CSS}</style></head><body>
<div class="page">
    <div class="hero">
        <div class="logo-wrap">{logo_html}</div>
        <div class="hero-text">
            <div class="company-name">{co["name"]}</div>
            <div class="doc-title">Supplement Cover Letter</div>
            <div class="contact-strip">{contact_parts}</div>
        </div>
    </div>
    <div class="accent-bar"></div>
    <div class="content">
        <p style="margin-bottom:8pt;">{_fmt_date(None)}</p>

        <div style="margin:16pt 0; padding:16pt 20pt; background:#f5f5f5; border-radius:4pt;">
            <div style="font-weight:700; margin-bottom:4pt;">{cl["carrier"]}</div>
            <div style="font-size:9pt; color:#666;">Claims Department</div>
            <div style="margin-top:8pt; font-size:9.5pt;">{re_html}</div>
        </div>

        <p>Dear Claims Department,</p>
        <p style="margin-top:8pt;">Please find enclosed our supplemental documentation for the above-referenced claim.
        After conducting a thorough inspection of the property at {cl["address"]}, we have identified
        additional storm-related damages not included in the original scope of loss.</p>
        {variance_html}

        {items_html}

        <div class="section-title">Enclosed Documentation</div>
        <ul style="padding-left:20pt; margin:8pt 0;">
            <li>Forensic Causation Report with photographic evidence</li>
            <li>Detailed Xactimate-style estimate</li>
            <li>Scope comparison analysis (carrier vs. contractor)</li>
        </ul>

        {notes_html}

        <p style="margin-top:16pt;">We respectfully request review and consideration of this supplement.
        Please do not hesitate to contact us with any questions or to schedule a re-inspection.</p>

        <p style="margin-top:20pt;">Respectfully,</p>
        <p style="margin-top:24pt;">{'<br>'.join(sig_parts)}</p>
    </div>
    <div class="footer">Generated by DumbRoof.ai &middot; {_fmt_date(None)}</div>
</div>
</body></html>"""
    return _html_to_pdf_bytes(html)


# ═══════════════════════════════════════════════════════════════════
#  STYLE 2 : MEMO  —  Professional memo / letterhead
# ═══════════════════════════════════════════════════════════════════
# Design: Traditional business document. Serif body, minimal color,
# company letterhead at top with thin rule, clean table styling,
# formal tone. Think: law firm / accounting firm correspondence.

MEMO_CSS = """
@page { size: letter; margin: 0.85in 0.85in 0.75in 0.85in; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: 'Georgia', 'Times New Roman', Times, serif;
    color: #2c2c2c;
    font-size: 10.5pt;
    line-height: 1.6;
}

/* ── Letterhead ── */
.letterhead {
    display: flex;
    align-items: center;
    gap: 16pt;
    padding-bottom: 12pt;
    border-bottom: 1.5pt solid #2c2c2c;
    margin-bottom: 20pt;
}
.letterhead img { height: 44pt; width: auto; }
.letterhead .co-info { flex: 1; text-align: right; }
.letterhead .co-name {
    font-size: 14pt;
    font-weight: 700;
    color: #1a1a1a;
    letter-spacing: 0.5pt;
}
.letterhead .co-detail {
    font-family: -apple-system, Helvetica, Arial, sans-serif;
    font-size: 8pt;
    color: #888;
    line-height: 1.4;
}

/* ── Memo header ── */
.memo-header {
    font-family: -apple-system, Helvetica, Arial, sans-serif;
    margin: 16pt 0 20pt;
}
.memo-header table {
    border-collapse: collapse;
    width: auto;
}
.memo-header td {
    padding: 3pt 0;
    vertical-align: top;
    border: none;
}
.memo-header .label {
    font-weight: 700;
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 1pt;
    color: #666;
    padding-right: 16pt;
    white-space: nowrap;
}
.memo-header .value {
    font-size: 10pt;
    color: #2c2c2c;
}

/* ── Document title ── */
.doc-title {
    font-size: 16pt;
    font-weight: 700;
    text-align: center;
    color: #1a1a1a;
    margin: 20pt 0 6pt;
    letter-spacing: 1pt;
}
.doc-subtitle {
    font-size: 10pt;
    text-align: center;
    color: #888;
    font-style: italic;
    margin-bottom: 20pt;
}

/* ── Horizontal rule ── */
hr {
    border: none;
    border-top: 0.5pt solid #ddd;
    margin: 16pt 0;
}

/* ── Table ── */
table { width: 100%; border-collapse: collapse; margin: 12pt 0; }
thead th {
    background: #f8f8f8;
    color: #2c2c2c;
    padding: 8pt 10pt;
    text-align: left;
    font-family: -apple-system, Helvetica, Arial, sans-serif;
    font-size: 8.5pt;
    text-transform: uppercase;
    letter-spacing: 1pt;
    font-weight: 600;
    border-bottom: 1.5pt solid #2c2c2c;
}
tbody td {
    padding: 7pt 10pt;
    font-size: 10pt;
    border-bottom: 0.5pt solid #e5e5e5;
}
.amt { text-align: right; font-variant-numeric: tabular-nums; }

/* ── Total ── */
.total-row {
    display: flex;
    justify-content: flex-end;
    gap: 24pt;
    align-items: baseline;
    margin-top: 12pt;
    padding-top: 8pt;
    border-top: 1.5pt solid #2c2c2c;
}
.total-label {
    font-family: -apple-system, Helvetica, Arial, sans-serif;
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 1pt;
    color: #666;
}
.total-amount {
    font-size: 16pt;
    font-weight: 700;
    color: #1a1a1a;
}

/* ── Section heading ── */
.section-head {
    font-family: -apple-system, Helvetica, Arial, sans-serif;
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 2pt;
    color: #666;
    font-weight: 600;
    margin: 20pt 0 8pt;
}

/* ── Signature ── */
.sig-area {
    margin-top: 28pt;
    display: flex;
    gap: 48pt;
}
.sig-block {}
.sig-line {
    width: 200pt;
    border-top: 1pt solid #2c2c2c;
    padding-top: 4pt;
    margin-bottom: 2pt;
}
.sig-name { font-weight: 700; font-size: 10pt; }
.sig-label { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 7.5pt; color: #888; text-transform: uppercase; letter-spacing: 1pt; }

/* ── Footer ── */
.footer {
    margin-top: 32pt;
    padding-top: 8pt;
    border-top: 0.5pt solid #ddd;
    font-family: -apple-system, Helvetica, Arial, sans-serif;
    font-size: 7pt;
    color: #bbb;
    text-align: center;
}

/* ── Pay link ── */
.pay-link {
    display: inline-block;
    color: #2c2c2c;
    padding: 8pt 20pt;
    border: 1.5pt solid #2c2c2c;
    text-decoration: none;
    font-family: -apple-system, Helvetica, Arial, sans-serif;
    font-weight: 600;
    font-size: 9pt;
    letter-spacing: 1pt;
    text-transform: uppercase;
    margin-top: 12pt;
}

/* ── Cert block ── */
.cert-block {
    border: 1pt solid #ddd;
    padding: 14pt 18pt;
    margin: 20pt 0;
    font-size: 9.5pt;
    color: #555;
    font-style: italic;
}
"""


@_register("invoice", "memo")
def _invoice_memo(claim_data, company_profile, **kw):
    co = _extract_company(company_profile)
    cl = _extract_claim(claim_data)
    inv_num = kw.get("invoice_number") or f"INV-{datetime.now().strftime('%Y%m%d')}-{str(cl['id'])[:8].upper()}"
    due = kw.get("due_date") or (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
    rows_html, subtotal = _build_line_items_html(cl, kw.get("line_items"), {})

    logo_html = f'<img src="{co["logo_b64"]}" alt="{co["name"]}">' if co["logo_b64"] else ""

    addr_parts = " · ".join(p for p in [co["address"], co["city_state_zip"]] if p)
    contact_parts = " | ".join(p for p in [co["phone"], co["email"]] if p)
    co_detail = "<br>".join(p for p in [addr_parts, contact_parts, co["website"], f"License: {co['license']}" if co["license"] else ""] if p)

    payment_html = f'<a href="{kw["payment_link"]}" class="pay-link">Pay Online</a>' if kw.get("payment_link") else ""
    notes_html = f'<div class="section-head">Notes</div><p>{kw["notes"]}</p>' if kw.get("notes") else ""

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{MEMO_CSS}</style></head><body>
<div class="letterhead">
    {logo_html}
    <div class="co-info">
        <div class="co-name">{co["name"]}</div>
        <div class="co-detail">{co_detail}</div>
    </div>
</div>

<div class="doc-title">INVOICE</div>

<div class="memo-header">
    <table>
        <tr><td class="label">Invoice #</td><td class="value">{inv_num}</td></tr>
        <tr><td class="label">Date</td><td class="value">{_fmt_date(None)}</td></tr>
        <tr><td class="label">Due Date</td><td class="value">{_fmt_date(due)}</td></tr>
        <tr><td class="label">Bill To</td><td class="value"><strong>{cl["homeowner"]}</strong><br>{cl["address"]}</td></tr>
        <tr><td class="label">Carrier</td><td class="value">{cl["carrier"]}</td></tr>
        {"<tr><td class='label'>Date of Loss</td><td class='value'>" + _fmt_date(cl["date_of_loss"]) + "</td></tr>" if cl["date_of_loss"] else ""}
    </table>
</div>

<hr>

<table>
    <thead><tr><th>Description</th><th class="amt">Qty</th><th class="amt">Unit Price</th><th class="amt">Total</th></tr></thead>
    <tbody>{rows_html}</tbody>
</table>

<div class="total-row">
    <div class="total-label">Total Due</div>
    <div class="total-amount">{_fmt_currency(subtotal)}</div>
</div>

{payment_html}
{notes_html}

<div class="footer">Generated by DumbRoof.ai &middot; {_fmt_date(None)}</div>
</body></html>"""
    return _html_to_pdf_bytes(html)


@_register("coc", "memo")
def _coc_memo(claim_data, company_profile, **kw):
    co = _extract_company(company_profile)
    cl = _extract_claim(claim_data)
    comp_date = kw.get("completion_date") or datetime.now().strftime("%Y-%m-%d")

    logo_html = f'<img src="{co["logo_b64"]}" alt="{co["name"]}">' if co["logo_b64"] else ""
    addr_parts = " · ".join(p for p in [co["address"], co["city_state_zip"]] if p)
    contact_parts = " | ".join(p for p in [co["phone"], co["email"]] if p)
    co_detail = "<br>".join(p for p in [addr_parts, contact_parts, f"License: {co['license']}" if co["license"] else ""] if p)

    work_desc = kw.get("work_description") or (
        f"All storm damage restoration work at {cl['address']} has been completed in accordance "
        f"with the approved insurance scope of work and applicable building codes. Materials "
        f"installed per manufacturer specifications. All debris removed and property cleaned."
    )

    fin_html = ""
    if cl["contractor_rcv"]:
        rows = [f"<tr><td>Total Contract Amount</td><td class='amt'>{_fmt_currency(cl['contractor_rcv'])}</td></tr>"]
        if cl["carrier_rcv"]:
            rows.append(f"<tr><td>Insurance Approved</td><td class='amt'>{_fmt_currency(cl['carrier_rcv'])}</td></tr>")
        if cl["settlement"]:
            rows.append(f"<tr><td>Settlement Amount</td><td class='amt'>{_fmt_currency(cl['settlement'])}</td></tr>")
        fin_html = f'<div class="section-head">Financial Summary</div><table><tbody>{"".join(rows)}</tbody></table>'

    warranty_html = f'<div class="section-head">Warranty</div><p>{kw["warranty_terms"]}</p>' if kw.get("warranty_terms") else ""
    sig_name = " — ".join(p for p in [co["contact_name"], co["name"]] if p)

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{MEMO_CSS}</style></head><body>
<div class="letterhead">
    {logo_html}
    <div class="co-info">
        <div class="co-name">{co["name"]}</div>
        <div class="co-detail">{co_detail}</div>
    </div>
</div>

<div class="doc-title">CERTIFICATE OF COMPLETION</div>
<div class="doc-subtitle">Storm Damage Restoration</div>

<div class="memo-header">
    <table>
        <tr><td class="label">Property Owner</td><td class="value">{cl["homeowner"]}</td></tr>
        <tr><td class="label">Property Address</td><td class="value">{cl["address"]}</td></tr>
        {"<tr><td class='label'>Carrier</td><td class='value'>" + cl["carrier"] + "</td></tr>" if cl["carrier"] != "Insurance Carrier" else ""}
        {"<tr><td class='label'>Date of Loss</td><td class='value'>" + _fmt_date(cl["date_of_loss"]) + "</td></tr>" if cl["date_of_loss"] else ""}
        <tr><td class="label">Completion Date</td><td class="value">{_fmt_date(comp_date)}</td></tr>
    </table>
</div>

<hr>

<div class="section-head">Scope of Work Completed</div>
<p>{work_desc}</p>

{fin_html}
{warranty_html}

<div class="cert-block">
    I hereby certify that all work described above has been completed in a workmanlike manner
    and in compliance with applicable building codes and insurance scope of work.
</div>

<div class="sig-area">
    <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-name">{sig_name}</div>
        <div class="sig-label">Authorized Signature</div>
    </div>
    <div class="sig-block">
        <div class="sig-line" style="width:120pt;"></div>
        <div class="sig-name">{_fmt_date(comp_date)}</div>
        <div class="sig-label">Date</div>
    </div>
</div>

<div class="footer">Generated by DumbRoof.ai &middot; {_fmt_date(None)}</div>
</body></html>"""
    return _html_to_pdf_bytes(html)


@_register("supplement_cover", "memo")
def _supp_memo(claim_data, company_profile, **kw):
    co = _extract_company(company_profile)
    cl = _extract_claim(claim_data)

    logo_html = f'<img src="{co["logo_b64"]}" alt="{co["name"]}">' if co["logo_b64"] else ""
    addr_parts = " · ".join(p for p in [co["address"], co["city_state_zip"]] if p)
    contact_parts = " | ".join(p for p in [co["phone"], co["email"]] if p)
    co_detail = "<br>".join(p for p in [addr_parts, contact_parts, f"License: {co['license']}" if co["license"] else ""] if p)

    variance = cl["contractor_rcv"] - cl["carrier_rcv"] if cl["contractor_rcv"] and cl["carrier_rcv"] else 0
    variance_html = f"""<p>Our documented scope totals {_fmt_currency(cl['contractor_rcv'])}, compared to the current carrier
    scope of {_fmt_currency(cl['carrier_rcv'])} — a variance of {_fmt_currency(variance)}. The enclosed documentation
    provides the factual basis for each supplemental item.</p>""" if variance > 0 else ""

    items_html = ""
    if kw.get("supplement_items"):
        rows = [f"<tr><td>{_safe(i.get('item'), 'Item')}</td><td>{_safe(i.get('description'), '')}</td>"
                f"<td class='amt'>{_fmt_currency(i.get('amount', 0))}</td></tr>" for i in kw["supplement_items"]]
        items_html = f"""<div class="section-head">Supplemental Items</div>
        <table><thead><tr><th>Item</th><th>Description</th><th class="amt">Amount</th></tr></thead>
        <tbody>{''.join(rows)}</tbody></table>"""

    re_lines = [f"<strong>Re:</strong> Insured: {cl['homeowner']}", f"&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Property: {cl['address']}"]
    if cl["claim_number"]:
        re_lines.append(f"&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Claim #: {cl['claim_number']}")
    if cl["date_of_loss"]:
        re_lines.append(f"&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Date of Loss: {_fmt_date(cl['date_of_loss'])}")

    sig_parts = []
    if co["contact_name"]:
        sig_parts.append(f"<strong>{co['contact_name']}</strong>")
    if co["contact_title"]:
        sig_parts.append(co["contact_title"])
    sig_parts.append(co["name"])

    notes_html = f'<p>{kw["additional_notes"]}</p>' if kw.get("additional_notes") else ""

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{MEMO_CSS}</style></head><body>
<div class="letterhead">
    {logo_html}
    <div class="co-info">
        <div class="co-name">{co["name"]}</div>
        <div class="co-detail">{co_detail}</div>
    </div>
</div>

<p>{_fmt_date(None)}</p>

<p style="margin-top:16pt;"><strong>{cl["carrier"]}</strong><br>Claims Department</p>

<p style="margin-top:12pt;">{'<br>'.join(re_lines)}</p>

<hr>

<p>Dear Claims Department,</p>

<p style="margin-top:8pt;">Please find enclosed our supplemental documentation for the above-referenced claim.
After conducting a thorough inspection of the property at {cl["address"]}, we have identified
additional storm-related damages that were not included in the original scope of loss.</p>

{variance_html}

{items_html}

<div class="section-head">Enclosed Documentation</div>
<ul style="padding-left:20pt; margin:6pt 0;">
    <li>Forensic Causation Report with photographic evidence</li>
    <li>Detailed Xactimate-style estimate</li>
    <li>Scope comparison analysis (carrier vs. contractor)</li>
</ul>

{notes_html}

<p style="margin-top:16pt;">We respectfully request review and consideration of this supplement.
Please do not hesitate to contact us with any questions or to schedule a re-inspection.</p>

<p style="margin-top:20pt;">Respectfully,</p>
<p style="margin-top:24pt;">{'<br>'.join(sig_parts)}</p>

<div class="footer">Generated by DumbRoof.ai &middot; {_fmt_date(None)}</div>
</body></html>"""
    return _html_to_pdf_bytes(html)


# ═══════════════════════════════════════════════════════════════════
#  STYLE 3 : MODERN  —  Minimal, lots of whitespace
# ═══════════════════════════════════════════════════════════════════
# Design: Ultra-clean. Thin accent line, generous spacing, light
# gray tones, hairline borders. Feels like a premium SaaS dashboard
# printed to paper. Think: Stripe receipts, Linear.

MODERN_CSS = """
@page { size: letter; margin: 0.75in; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: 'Inter', -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif;
    color: #333;
    font-size: 10pt;
    line-height: 1.65;
}

/* ── Top bar ── */
.top-bar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 32pt;
}
.top-bar img { height: 36pt; width: auto; }
.top-bar .co-block { text-align: right; }
.top-bar .co-name { font-size: 11pt; font-weight: 600; color: #111; }
.top-bar .co-detail { font-size: 8pt; color: #aaa; line-height: 1.5; }

/* ── Thin accent ── */
.accent-line {
    height: 2pt;
    background: #111;
    width: 40pt;
    margin-bottom: 24pt;
}

/* ── Doc title ── */
.doc-title {
    font-size: 28pt;
    font-weight: 300;
    color: #111;
    letter-spacing: -0.5pt;
    margin-bottom: 4pt;
}
.doc-number {
    font-size: 9pt;
    color: #aaa;
    letter-spacing: 1pt;
    margin-bottom: 24pt;
}

/* ── Detail rows ── */
.detail-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24pt;
    margin-bottom: 28pt;
}
.detail-item {}
.detail-label {
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: 1.5pt;
    color: #bbb;
    margin-bottom: 2pt;
}
.detail-value {
    font-size: 10pt;
    color: #333;
}

/* ── Table ── */
table { width: 100%; border-collapse: collapse; margin: 16pt 0; }
thead th {
    padding: 8pt 10pt;
    text-align: left;
    font-size: 7.5pt;
    text-transform: uppercase;
    letter-spacing: 1.5pt;
    color: #aaa;
    font-weight: 500;
    border-bottom: 1pt solid #eee;
}
tbody td {
    padding: 10pt 10pt;
    font-size: 10pt;
    color: #333;
    border-bottom: 1pt solid #f5f5f5;
}
.amt { text-align: right; font-variant-numeric: tabular-nums; }

/* ── Total ── */
.total-section {
    text-align: right;
    margin-top: 16pt;
    padding-top: 12pt;
    border-top: 1pt solid #eee;
}
.total-label {
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 1.5pt;
    color: #aaa;
}
.total-amount {
    font-size: 28pt;
    font-weight: 300;
    color: #111;
    letter-spacing: -0.5pt;
}

/* ── Section ── */
.section-title {
    font-size: 7.5pt;
    text-transform: uppercase;
    letter-spacing: 2pt;
    color: #aaa;
    margin: 24pt 0 8pt;
}

/* ── Pay link ── */
.pay-link {
    display: inline-block;
    background: #111;
    color: #fff;
    padding: 8pt 24pt;
    border-radius: 100pt;
    text-decoration: none;
    font-weight: 500;
    font-size: 9pt;
    letter-spacing: 0.5pt;
    margin-top: 16pt;
}

/* ── Signature ── */
.sig-area {
    margin-top: 32pt;
    display: flex;
    gap: 40pt;
}
.sig-line {
    width: 180pt;
    border-top: 1pt solid #ddd;
    padding-top: 6pt;
}
.sig-label { font-size: 7pt; text-transform: uppercase; letter-spacing: 1.5pt; color: #bbb; }
.sig-name { font-size: 10pt; font-weight: 500; color: #333; margin-bottom: 2pt; }

/* ── Footer ── */
.footer {
    margin-top: 40pt;
    font-size: 7pt;
    color: #ccc;
    text-align: center;
}

/* ── Completion card ── */
.completion-card {
    border: 1pt solid #eee;
    border-radius: 8pt;
    padding: 24pt;
    text-align: center;
    margin: 20pt 0;
}
.completion-card .checkmark {
    font-size: 28pt;
    color: #22c55e;
    margin-bottom: 4pt;
}
.completion-card .label {
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 2pt;
    color: #aaa;
}

/* ── Quote block ── */
.quote-block {
    border-left: 2pt solid #eee;
    padding: 10pt 16pt;
    margin: 12pt 0;
    font-size: 9.5pt;
    color: #777;
}

/* ── Address card ── */
.address-card {
    background: #fafafa;
    border-radius: 6pt;
    padding: 16pt 20pt;
    margin: 12pt 0;
}
"""


@_register("invoice", "modern")
def _invoice_modern(claim_data, company_profile, **kw):
    co = _extract_company(company_profile)
    cl = _extract_claim(claim_data)
    inv_num = kw.get("invoice_number") or f"INV-{datetime.now().strftime('%Y%m%d')}-{str(cl['id'])[:8].upper()}"
    due = kw.get("due_date") or (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
    rows_html, subtotal = _build_line_items_html(cl, kw.get("line_items"), {})

    logo_html = f'<img src="{co["logo_b64"]}" alt="{co["name"]}">' if co["logo_b64"] else ""
    co_detail = "<br>".join(p for p in [co["address"], co["city_state_zip"], co["phone"], co["email"]] if p)

    payment_html = f'<a href="{kw["payment_link"]}" class="pay-link">Pay Online</a>' if kw.get("payment_link") else ""
    notes_html = f'<div class="section-title">Notes</div><p style="font-size:9.5pt; color:#777;">{kw["notes"]}</p>' if kw.get("notes") else ""

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{MODERN_CSS}</style></head><body>
<div class="top-bar">
    <div>{logo_html}</div>
    <div class="co-block">
        <div class="co-name">{co["name"]}</div>
        <div class="co-detail">{co_detail}</div>
    </div>
</div>

<div class="accent-line"></div>
<div class="doc-title">Invoice</div>
<div class="doc-number">{inv_num}</div>

<div class="detail-grid">
    <div>
        <div class="detail-item"><div class="detail-label">Date</div><div class="detail-value">{_fmt_date(None)}</div></div>
        <div class="detail-item" style="margin-top:12pt;"><div class="detail-label">Due Date</div><div class="detail-value">{_fmt_date(due)}</div></div>
        <div class="detail-item" style="margin-top:12pt;"><div class="detail-label">Carrier</div><div class="detail-value">{cl["carrier"]}</div></div>
        {"<div class='detail-item' style='margin-top:12pt;'><div class='detail-label'>Date of Loss</div><div class='detail-value'>" + _fmt_date(cl['date_of_loss']) + "</div></div>" if cl["date_of_loss"] else ""}
    </div>
    <div>
        <div class="detail-item"><div class="detail-label">Bill To</div><div class="detail-value" style="font-weight:500;">{cl["homeowner"]}</div></div>
        <div style="font-size:9.5pt; color:#888; margin-top:2pt;">{cl["address"]}</div>
    </div>
</div>

<table>
    <thead><tr><th>Description</th><th class="amt">Qty</th><th class="amt">Unit Price</th><th class="amt">Total</th></tr></thead>
    <tbody>{rows_html}</tbody>
</table>

<div class="total-section">
    <div class="total-label">Total Due</div>
    <div class="total-amount">{_fmt_currency(subtotal)}</div>
</div>

{payment_html}
{notes_html}

<div class="footer">Generated by DumbRoof.ai &middot; {_fmt_date(None)}</div>
</body></html>"""
    return _html_to_pdf_bytes(html)


@_register("coc", "modern")
def _coc_modern(claim_data, company_profile, **kw):
    co = _extract_company(company_profile)
    cl = _extract_claim(claim_data)
    comp_date = kw.get("completion_date") or datetime.now().strftime("%Y-%m-%d")

    logo_html = f'<img src="{co["logo_b64"]}" alt="{co["name"]}">' if co["logo_b64"] else ""
    co_detail = "<br>".join(p for p in [co["address"], co["city_state_zip"], co["phone"], co["email"]] if p)

    work_desc = kw.get("work_description") or (
        f"All storm damage restoration work at {cl['address']} has been completed in accordance "
        f"with the approved insurance scope of work and applicable building codes. Materials "
        f"installed per manufacturer specifications. All debris removed and property cleaned."
    )

    fin_html = ""
    if cl["contractor_rcv"]:
        rows = [f"<tr><td>Total Contract Amount</td><td class='amt'>{_fmt_currency(cl['contractor_rcv'])}</td></tr>"]
        if cl["carrier_rcv"]:
            rows.append(f"<tr><td>Insurance Approved</td><td class='amt'>{_fmt_currency(cl['carrier_rcv'])}</td></tr>")
        if cl["settlement"]:
            rows.append(f"<tr><td>Settlement Amount</td><td class='amt'>{_fmt_currency(cl['settlement'])}</td></tr>")
        fin_html = f'<div class="section-title">Financial Summary</div><table><tbody>{"".join(rows)}</tbody></table>'

    warranty_html = f'<div class="section-title">Warranty</div><p style="font-size:9.5pt; color:#555;">{kw["warranty_terms"]}</p>' if kw.get("warranty_terms") else ""
    sig_name = " — ".join(p for p in [co["contact_name"], co["name"]] if p)

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{MODERN_CSS}</style></head><body>
<div class="top-bar">
    <div>{logo_html}</div>
    <div class="co-block">
        <div class="co-name">{co["name"]}</div>
        <div class="co-detail">{co_detail}</div>
    </div>
</div>

<div class="accent-line"></div>
<div class="doc-title">Certificate of Completion</div>
<div class="doc-number">Storm Damage Restoration</div>

<div class="completion-card">
    <div class="checkmark">&#10003;</div>
    <div class="label">Work Complete</div>
</div>

<div class="detail-grid">
    <div>
        <div class="detail-item"><div class="detail-label">Property Owner</div><div class="detail-value">{cl["homeowner"]}</div></div>
        <div class="detail-item" style="margin-top:12pt;"><div class="detail-label">Property Address</div><div class="detail-value">{cl["address"]}</div></div>
    </div>
    <div>
        {"<div class='detail-item'><div class='detail-label'>Carrier</div><div class='detail-value'>" + cl["carrier"] + "</div></div>" if cl["carrier"] != "Insurance Carrier" else ""}
        {"<div class='detail-item' style='margin-top:12pt;'><div class='detail-label'>Date of Loss</div><div class='detail-value'>" + _fmt_date(cl['date_of_loss']) + "</div></div>" if cl["date_of_loss"] else ""}
        <div class="detail-item" style="margin-top:12pt;"><div class="detail-label">Completion Date</div><div class="detail-value">{_fmt_date(comp_date)}</div></div>
    </div>
</div>

<div class="section-title">Scope of Work Completed</div>
<p>{work_desc}</p>

{fin_html}
{warranty_html}

<div class="quote-block">
    I hereby certify that all work described above has been completed in a workmanlike manner
    and in compliance with applicable building codes and insurance scope of work.
</div>

<div class="sig-area">
    <div>
        <div class="sig-line"></div>
        <div class="sig-name">{sig_name}</div>
        <div class="sig-label">Authorized Signature</div>
    </div>
    <div>
        <div class="sig-line" style="width:120pt;"></div>
        <div class="sig-name">{_fmt_date(comp_date)}</div>
        <div class="sig-label">Date</div>
    </div>
</div>

<div class="footer">Generated by DumbRoof.ai &middot; {_fmt_date(None)}</div>
</body></html>"""
    return _html_to_pdf_bytes(html)


@_register("supplement_cover", "modern")
def _supp_modern(claim_data, company_profile, **kw):
    co = _extract_company(company_profile)
    cl = _extract_claim(claim_data)

    logo_html = f'<img src="{co["logo_b64"]}" alt="{co["name"]}">' if co["logo_b64"] else ""
    co_detail = "<br>".join(p for p in [co["address"], co["city_state_zip"], co["phone"], co["email"]] if p)

    variance = cl["contractor_rcv"] - cl["carrier_rcv"] if cl["contractor_rcv"] and cl["carrier_rcv"] else 0
    variance_html = f"""<p style="margin-top:8pt;">Our documented scope totals <strong>{_fmt_currency(cl['contractor_rcv'])}</strong>,
    compared to the current carrier scope of <strong>{_fmt_currency(cl['carrier_rcv'])}</strong> —
    a variance of <strong>{_fmt_currency(variance)}</strong>.</p>""" if variance > 0 else ""

    items_html = ""
    if kw.get("supplement_items"):
        rows = [f"<tr><td>{_safe(i.get('item'), 'Item')}</td><td>{_safe(i.get('description'), '')}</td>"
                f"<td class='amt'>{_fmt_currency(i.get('amount', 0))}</td></tr>" for i in kw["supplement_items"]]
        items_html = f"""<div class="section-title">Supplemental Items</div>
        <table><thead><tr><th>Item</th><th>Description</th><th class="amt">Amount</th></tr></thead>
        <tbody>{''.join(rows)}</tbody></table>"""

    sig_parts = []
    if co["contact_name"]:
        sig_parts.append(f"<strong>{co['contact_name']}</strong>")
    if co["contact_title"]:
        sig_parts.append(co["contact_title"])
    sig_parts.append(co["name"])

    notes_html = f'<div class="quote-block">{kw["additional_notes"]}</div>' if kw.get("additional_notes") else ""

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{MODERN_CSS}</style></head><body>
<div class="top-bar">
    <div>{logo_html}</div>
    <div class="co-block">
        <div class="co-name">{co["name"]}</div>
        <div class="co-detail">{co_detail}</div>
    </div>
</div>

<div class="accent-line"></div>
<div class="doc-title">Supplement Cover Letter</div>
<div class="doc-number">{_fmt_date(None)}</div>

<div class="address-card">
    <div style="font-weight:500;">{cl["carrier"]}</div>
    <div style="font-size:9pt; color:#888;">Claims Department</div>
    <div style="margin-top:8pt; font-size:9.5pt;">
        Insured: {cl["homeowner"]}<br>
        Property: {cl["address"]}
        {"<br>Claim #: " + cl["claim_number"] if cl["claim_number"] else ""}
        {"<br>Date of Loss: " + _fmt_date(cl["date_of_loss"]) if cl["date_of_loss"] else ""}
    </div>
</div>

<p>Dear Claims Department,</p>

<p style="margin-top:8pt;">Please find enclosed our supplemental documentation for the above-referenced claim.
After conducting a thorough inspection of the property at {cl["address"]}, we have identified
additional storm-related damages not included in the original scope of loss.</p>

{variance_html}
{items_html}

<div class="section-title">Enclosed Documentation</div>
<ul style="padding-left:18pt; margin:6pt 0; font-size:9.5pt; color:#555;">
    <li>Forensic Causation Report with photographic evidence</li>
    <li>Detailed Xactimate-style estimate</li>
    <li>Scope comparison analysis (carrier vs. contractor)</li>
</ul>

{notes_html}

<p style="margin-top:16pt;">We respectfully request review and consideration of this supplement.
Please do not hesitate to contact us with any questions or to schedule a re-inspection.</p>

<p style="margin-top:20pt;">Respectfully,</p>
<p style="margin-top:24pt;">{'<br>'.join(sig_parts)}</p>

<div class="footer">Generated by DumbRoof.ai &middot; {_fmt_date(None)}</div>
</body></html>"""
    return _html_to_pdf_bytes(html)


# ═══════════════════════════════════════════════════════════════════
#  STYLE 4 : CLASSIC  —  Current DumbRoof default (navy + blue)
# ═══════════════════════════════════════════════════════════════════
# This wraps the existing claim_brain_pdfs.py ReportLab generators
# so they're accessible through the unified template API.

@_register("invoice", "classic")
def _invoice_classic(claim_data, company_profile, **kw):
    from claim_brain_pdfs import generate_invoice_pdf
    return generate_invoice_pdf(
        claim_data, company_profile,
        payment_link=kw.get("payment_link"),
        invoice_number=kw.get("invoice_number"),
        due_date=kw.get("due_date"),
        line_items=kw.get("line_items"),
        notes=kw.get("notes"),
    )


@_register("coc", "classic")
def _coc_classic(claim_data, company_profile, **kw):
    from claim_brain_pdfs import generate_coc_pdf
    return generate_coc_pdf(
        claim_data, company_profile,
        completion_date=kw.get("completion_date"),
        work_description=kw.get("work_description"),
        warranty_terms=kw.get("warranty_terms"),
    )


@_register("supplement_cover", "classic")
def _supp_classic(claim_data, company_profile, **kw):
    from claim_brain_pdfs import generate_supplement_cover_pdf
    return generate_supplement_cover_pdf(
        claim_data, company_profile,
        supplement_items=kw.get("supplement_items"),
        additional_notes=kw.get("additional_notes"),
    )


# ═══════════════════════════════════════════════════════════════════
#  CLI — Quick test / preview generator
# ═══════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import sys

    # Sample data for previews
    SAMPLE_COMPANY = {
        "company_name": "USA Roof Masters",
        "address": "123 Main Street",
        "city_state_zip": "Stamford, CT 06902",
        "phone": "(203) 555-0100",
        "email": "info@usaroofmasters.com",
        "website": "www.usaroofmasters.com",
        "license_number": "HIC-0654321",
        "contact_name": "Thomas Kovack",
        "contact_title": "Owner / CEO",
        "logo_b64": "",  # No logo in sample — will use placeholder
    }
    SAMPLE_CLAIM = {
        "id": "a1b2c3d4-e5f6-7890",
        "homeowner_name": "John & Jane Smith",
        "address": "456 Oak Avenue, Greenwich, CT 06830",
        "carrier": "State Farm",
        "date_of_loss": "2025-08-15",
        "claim_number": "SF-2025-0012345",
        "contractor_rcv": 28750.00,
        "current_carrier_rcv": 18200.00,
        "deductible": 2500.00,
        "settlement_amount": 22000.00,
    }
    SAMPLE_LINE_ITEMS = [
        {"description": "Remove existing shingle roof system", "qty": 32, "unit_price": 85.00},
        {"description": "Install GAF Timberline HDZ shingles", "qty": 32, "unit_price": 425.00},
        {"description": "Replace damaged drip edge — aluminum", "qty": 180, "unit_price": 8.50},
        {"description": "Ice & water shield — eaves and valleys", "qty": 8, "unit_price": 145.00},
    ]
    SAMPLE_SUPPLEMENT = [
        {"item": "Ridge vent replacement", "description": "Existing ridge vent cracked by hail impact", "amount": 1850.00},
        {"item": "Pipe boot flashing", "description": "3 pipe boots — cracked/missing gaskets", "amount": 675.00},
        {"item": "Starter strip", "description": "Not included in original carrier scope", "amount": 420.00},
    ]

    output_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(output_dir, exist_ok=True)

    for style in STYLES:
        for doc_type in DOC_TYPES:
            kwargs = {}
            if doc_type == "invoice":
                kwargs = {"line_items": SAMPLE_LINE_ITEMS, "payment_link": "https://pay.dumbroof.ai/inv-123", "notes": "Thank you for your business!"}
            elif doc_type == "coc":
                kwargs = {"warranty_terms": "10-year manufacturer warranty on all materials. 5-year workmanship warranty."}
            elif doc_type == "supplement_cover":
                kwargs = {"supplement_items": SAMPLE_SUPPLEMENT}

            try:
                pdf = generate_pdf(doc_type, style, SAMPLE_CLAIM, SAMPLE_COMPANY, **kwargs)
                filename = f"{style}_{doc_type}.pdf"
                filepath = os.path.join(output_dir, filename)
                with open(filepath, "wb") as f:
                    f.write(pdf)
                print(f"  OK  {filename} ({len(pdf):,} bytes)")
            except Exception as e:
                print(f"  ERR {style}_{doc_type}: {e}")

    print(f"\nAll templates generated in {output_dir}/")
    print(f"Templates registered: {len(_BUILDERS)}")
    for t in list_templates():
        print(f"  • {t['label']}")
