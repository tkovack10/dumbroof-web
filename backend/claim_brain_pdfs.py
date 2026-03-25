"""
Claim Brain — PDF Template Generator
======================================
Generates three types of PDFs from claim + company data:
  1. Invoice (with optional Stripe payment link)
  2. Certificate of Completion (COC)
  3. Supplement Cover Letter

ALL FIELDS ARE OPTIONAL. Missing fields are gracefully skipped — never block generation.
The PDFs use the user's company branding (name, logo, address, contact) when available,
and fall back to clean formatting without branding.

Usage:
    from claim_brain_pdfs import generate_invoice_pdf, generate_coc_pdf, generate_supplement_cover_pdf

    pdf_bytes = generate_invoice_pdf(claim_data, company_profile)
    pdf_bytes = generate_coc_pdf(claim_data, company_profile)
    pdf_bytes = generate_supplement_cover_pdf(claim_data, company_profile, supplement_items)
"""

from __future__ import annotations
import io
import os
from datetime import datetime, timedelta
from typing import Optional


def _safe(val, default=""):
    """Return val if truthy, else default. Never returns None."""
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return val
    return val if val else default


def _fmt_currency(amount) -> str:
    """Format a number as currency, handling None/0."""
    try:
        return f"${float(amount or 0):,.2f}"
    except (ValueError, TypeError):
        return "$0.00"


def _fmt_date(date_str, fmt="%B %d, %Y") -> str:
    """Format a date string, return empty string on failure."""
    if not date_str:
        return datetime.now().strftime(fmt)
    try:
        if "T" in str(date_str):
            return datetime.fromisoformat(str(date_str).replace("Z", "")).strftime(fmt)
        return datetime.strptime(str(date_str), "%Y-%m-%d").strftime(fmt)
    except Exception:
        return str(date_str)


# ═══════════════════════════════════════════
# INVOICE PDF
# ═══════════════════════════════════════════

def generate_invoice_pdf(
    claim_data: dict,
    company_profile: dict,
    payment_link: Optional[str] = None,
    invoice_number: Optional[str] = None,
    due_date: Optional[str] = None,
    line_items: Optional[list[dict]] = None,
    notes: Optional[str] = None,
) -> bytes:
    """
    Generate a professional invoice PDF.
    All fields optional — missing data is gracefully skipped.
    """
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.75*inch, bottomMargin=0.75*inch)
    styles = getSampleStyleSheet()
    story = []

    # Colors
    navy = colors.HexColor("#0f1729")
    accent = colors.HexColor("#4f8eff")
    light_gray = colors.HexColor("#f5f5f5")

    # Custom styles
    title_style = ParagraphStyle("InvoiceTitle", parent=styles["Heading1"], fontSize=24, textColor=navy, spaceAfter=4)
    label_style = ParagraphStyle("Label", parent=styles["Normal"], fontSize=8, textColor=colors.gray)
    value_style = ParagraphStyle("Value", parent=styles["Normal"], fontSize=10, textColor=navy, fontName="Helvetica-Bold")
    normal = ParagraphStyle("Body", parent=styles["Normal"], fontSize=10, textColor=navy)

    # ── Header ──
    company_name = _safe(company_profile.get("company_name"), "Roofing Company")
    company_addr = _safe(company_profile.get("address"))
    company_csz = _safe(company_profile.get("city_state_zip"))
    company_phone = _safe(company_profile.get("phone"))
    company_email = _safe(company_profile.get("email"))
    company_website = _safe(company_profile.get("website"))
    license_num = _safe(company_profile.get("license_number"))

    # Company info block
    company_lines = [Paragraph(f"<b>{company_name}</b>", ParagraphStyle("Co", parent=normal, fontSize=14, fontName="Helvetica-Bold"))]
    if company_addr:
        company_lines.append(Paragraph(company_addr, normal))
    if company_csz:
        company_lines.append(Paragraph(company_csz, normal))
    contact_parts = [p for p in [company_phone, company_email] if p]
    if contact_parts:
        company_lines.append(Paragraph(" | ".join(contact_parts), normal))
    if company_website:
        company_lines.append(Paragraph(company_website, normal))
    if license_num:
        company_lines.append(Paragraph(f"License: {license_num}", ParagraphStyle("Lic", parent=normal, fontSize=8, textColor=colors.gray)))

    for line in company_lines:
        story.append(line)
    story.append(Spacer(1, 12))

    # INVOICE title + number
    inv_num = invoice_number or f"INV-{datetime.now().strftime('%Y%m%d')}-{str(claim_data.get('id', ''))[:8].upper()}"
    story.append(Paragraph("INVOICE", title_style))
    story.append(Spacer(1, 4))

    # Invoice metadata
    homeowner = _safe(claim_data.get("homeowner_name"), "Homeowner")
    address = _safe(claim_data.get("address"), "Property Address")
    carrier = _safe(claim_data.get("carrier"), "Insurance Carrier")
    date_of_loss = _safe(claim_data.get("date_of_loss"))
    due = due_date or (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")

    meta_data = [
        ["Invoice #:", inv_num, "Bill To:", ""],
        ["Date:", _fmt_date(None), "", Paragraph(f"<b>{homeowner}</b><br/>{address}", normal)],
        ["Due Date:", _fmt_date(due), "", ""],
        ["Carrier:", carrier, "", ""],
    ]
    if date_of_loss:
        meta_data.append(["Date of Loss:", _fmt_date(date_of_loss), "", ""])

    meta_table = Table(meta_data, colWidths=[1.2*inch, 2.3*inch, 0.8*inch, 2.7*inch])
    meta_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.gray),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", color=navy, thickness=1))
    story.append(Spacer(1, 8))

    # ── Line Items ──
    header = ["Description", "Qty", "Unit Price", "Total"]
    rows = [header]
    subtotal = 0

    if line_items:
        for item in line_items:
            desc = _safe(item.get("description"), "Line item")
            qty = float(_safe(item.get("qty", item.get("quantity", 1)), 1))
            unit_price = float(_safe(item.get("unit_price", item.get("price", 0)), 0))
            total = qty * unit_price
            subtotal += total
            rows.append([desc, f"{qty:.1f}", _fmt_currency(unit_price), _fmt_currency(total)])
    else:
        # Default: use claim financial totals
        contractor_rcv = float(_safe(claim_data.get("contractor_rcv"), 0))
        carrier_rcv = float(_safe(claim_data.get("current_carrier_rcv", claim_data.get("original_carrier_rcv")), 0))
        deductible = float(_safe(claim_data.get("deductible"), 0))

        if contractor_rcv:
            rows.append(["Storm damage restoration per approved scope", "1", _fmt_currency(contractor_rcv), _fmt_currency(contractor_rcv)])
            subtotal = contractor_rcv
        if carrier_rcv:
            rows.append(["Less: Insurance payment received", "1", f"({_fmt_currency(carrier_rcv)})", f"({_fmt_currency(carrier_rcv)})"])
            subtotal -= carrier_rcv
        if deductible:
            rows.append(["Homeowner deductible", "1", _fmt_currency(deductible), _fmt_currency(deductible)])

    items_table = Table(rows, colWidths=[3.5*inch, 0.8*inch, 1.2*inch, 1.2*inch])
    items_table.setStyle(TableStyle([
        # Header
        ("BACKGROUND", (0, 0), (-1, 0), navy),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        # Body
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, light_gray]),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
    ]))
    story.append(items_table)

    # ── Totals ──
    story.append(Spacer(1, 8))
    total_due = max(subtotal, 0)
    totals = [
        ["", "", "Total Due:", _fmt_currency(total_due)],
    ]
    totals_table = Table(totals, colWidths=[3.5*inch, 0.8*inch, 1.2*inch, 1.2*inch])
    totals_table.setStyle(TableStyle([
        ("FONTNAME", (2, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 11),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("TEXTCOLOR", (3, 0), (3, 0), accent),
        ("LINEABOVE", (2, 0), (-1, 0), 1, navy),
    ]))
    story.append(totals_table)

    # ── Payment Link ──
    if payment_link:
        story.append(Spacer(1, 16))
        story.append(Paragraph(
            f'<b>Pay Online:</b> <a href="{payment_link}" color="blue">{payment_link}</a>',
            ParagraphStyle("PayLink", parent=normal, fontSize=10, textColor=accent),
        ))

    # ── Notes ──
    if notes:
        story.append(Spacer(1, 16))
        story.append(Paragraph("<b>Notes:</b>", label_style))
        story.append(Paragraph(notes, normal))

    # ── Footer ──
    story.append(Spacer(1, 24))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#e0e0e0"), thickness=0.5))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        f"Generated by DumbRoof.ai · {_fmt_date(None)}",
        ParagraphStyle("Footer", parent=normal, fontSize=7, textColor=colors.gray, alignment=1),
    ))

    doc.build(story)
    return buf.getvalue()


# ═══════════════════════════════════════════
# CERTIFICATE OF COMPLETION (COC) PDF
# ═══════════════════════════════════════════

def generate_coc_pdf(
    claim_data: dict,
    company_profile: dict,
    completion_date: Optional[str] = None,
    work_description: Optional[str] = None,
    warranty_terms: Optional[str] = None,
    completion_photos: Optional[list[bytes]] = None,
) -> bytes:
    """
    Generate a Certificate of Substantial Completion PDF.
    All fields optional — missing data gracefully skipped.
    completion_photos: list of image bytes (1-2 photos) to embed.
    """
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle, Image

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.75*inch, bottomMargin=0.75*inch)
    styles = getSampleStyleSheet()
    story = []

    navy = colors.HexColor("#0f1729")
    accent = colors.HexColor("#4f8eff")
    green = colors.HexColor("#059669")

    title_style = ParagraphStyle("COCTitle", parent=styles["Heading1"], fontSize=22, textColor=navy, alignment=1, spaceAfter=4)
    subtitle_style = ParagraphStyle("Subtitle", parent=styles["Normal"], fontSize=11, textColor=colors.gray, alignment=1)
    normal = ParagraphStyle("Body", parent=styles["Normal"], fontSize=10, textColor=navy, leading=14)
    bold_style = ParagraphStyle("Bold", parent=normal, fontName="Helvetica-Bold")

    company_name = _safe(company_profile.get("company_name"), "Roofing Company")
    company_addr = _safe(company_profile.get("address"))
    company_csz = _safe(company_profile.get("city_state_zip"))
    company_phone = _safe(company_profile.get("phone"))
    company_email = _safe(company_profile.get("email"))
    license_num = _safe(company_profile.get("license_number"))
    contact_name = _safe(company_profile.get("contact_name"))

    # ── Header ──
    story.append(Paragraph(f"<b>{company_name}</b>", ParagraphStyle("CoHeader", parent=normal, fontSize=14, alignment=1, fontName="Helvetica-Bold")))
    addr_parts = [p for p in [company_addr, company_csz] if p]
    if addr_parts:
        story.append(Paragraph(" · ".join(addr_parts), ParagraphStyle("CoAddr", parent=normal, fontSize=9, textColor=colors.gray, alignment=1)))
    contact_parts = [p for p in [company_phone, company_email] if p]
    if contact_parts:
        story.append(Paragraph(" | ".join(contact_parts), ParagraphStyle("CoContact", parent=normal, fontSize=9, textColor=colors.gray, alignment=1)))
    if license_num:
        story.append(Paragraph(f"License: {license_num}", ParagraphStyle("CoLic", parent=normal, fontSize=8, textColor=colors.gray, alignment=1)))

    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", color=navy, thickness=2))
    story.append(Spacer(1, 12))

    # ── Title ──
    story.append(Paragraph("CERTIFICATE OF SUBSTANTIAL COMPLETION", title_style))
    story.append(Paragraph("Storm Damage Restoration", subtitle_style))
    story.append(Spacer(1, 16))

    # ── Claim Details ──
    homeowner = _safe(claim_data.get("homeowner_name"), "Property Owner")
    address = _safe(claim_data.get("address"), "Property Address")
    carrier = _safe(claim_data.get("carrier"))
    date_of_loss = _safe(claim_data.get("date_of_loss"))
    comp_date = completion_date or datetime.now().strftime("%Y-%m-%d")

    details = []
    details.append(["Property Owner:", homeowner])
    details.append(["Property Address:", address])
    if carrier:
        details.append(["Insurance Carrier:", carrier])
    if date_of_loss:
        details.append(["Date of Loss:", _fmt_date(date_of_loss)])
    details.append(["Completion Date:", _fmt_date(comp_date)])

    detail_table = Table(details, colWidths=[1.8*inch, 4.5*inch])
    detail_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.gray),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(detail_table)
    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#e0e0e0"), thickness=0.5))
    story.append(Spacer(1, 12))

    # ── Work Description ──
    story.append(Paragraph("<b>Scope of Work Completed:</b>", bold_style))
    story.append(Spacer(1, 4))
    if work_description:
        story.append(Paragraph(work_description, normal))
    else:
        story.append(Paragraph(
            f"All storm damage restoration work at {address} has been completed in accordance with the "
            f"approved insurance scope of work and applicable building codes. Materials installed per "
            f"manufacturer specifications. All debris removed and property cleaned.",
            normal,
        ))
    story.append(Spacer(1, 12))

    # ── Completion Photos ──
    if completion_photos:
        story.append(Paragraph("<b>Completion Photos:</b>", bold_style))
        story.append(Spacer(1, 6))
        photo_cells = []
        for photo_bytes in completion_photos[:2]:  # Max 2 photos
            try:
                img_buf = io.BytesIO(photo_bytes)
                img = Image(img_buf)
                # Scale to fit: max 3 inches wide, maintain aspect ratio
                aspect = img.imageWidth / img.imageHeight if img.imageHeight else 1
                max_w = 3 * inch
                max_h = 2.5 * inch
                if aspect > 1:
                    w = min(max_w, img.imageWidth)
                    h = w / aspect
                    if h > max_h:
                        h = max_h
                        w = h * aspect
                else:
                    h = min(max_h, img.imageHeight)
                    w = h * aspect
                    if w > max_w:
                        w = max_w
                        h = w / aspect
                img.drawWidth = w
                img.drawHeight = h
                photo_cells.append(img)
            except Exception:
                pass  # Skip unreadable photos

        if len(photo_cells) == 2:
            photo_table = Table([[photo_cells[0], photo_cells[1]]], colWidths=[3.25*inch, 3.25*inch])
            photo_table.setStyle(TableStyle([
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]))
            story.append(photo_table)
        elif len(photo_cells) == 1:
            photo_table = Table([[photo_cells[0]]], colWidths=[6.5*inch])
            photo_table.setStyle(TableStyle([
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ]))
            story.append(photo_table)
        story.append(Spacer(1, 12))

    # ── Financial Summary with Depreciation ──
    contractor_rcv = float(_safe(claim_data.get("contractor_rcv"), 0))
    carrier_rcv = float(_safe(claim_data.get("current_carrier_rcv", claim_data.get("original_carrier_rcv")), 0))
    settlement = float(_safe(claim_data.get("settlement_amount"), 0))

    if contractor_rcv or carrier_rcv:
        story.append(Paragraph("<b>Financial Summary:</b>", bold_style))
        story.append(Spacer(1, 4))

        fin_rows = []
        if carrier_rcv:
            fin_rows.append(["Replacement Cost Value (RCV):", _fmt_currency(carrier_rcv)])

        # Depreciation = RCV - ACV (settlement is the ACV / amount actually paid)
        if carrier_rcv and settlement and settlement < carrier_rcv:
            depreciation = carrier_rcv - settlement
            fin_rows.append(["Less: Depreciation Held:", f"({_fmt_currency(depreciation)})"])
            fin_rows.append(["Actual Cash Value (ACV):", _fmt_currency(settlement)])
        elif settlement:
            fin_rows.append(["Amount Approved:", _fmt_currency(settlement)])

        if contractor_rcv and contractor_rcv != carrier_rcv:
            fin_rows.append(["Contractor Scope (RCV):", _fmt_currency(contractor_rcv)])

        if carrier_rcv and settlement and settlement < carrier_rcv:
            depreciation = carrier_rcv - settlement
            story.append(Spacer(1, 2))
            fin_rows.append(["", ""])  # spacer row
            fin_rows.append(["Depreciation Recoverable Upon Completion:", _fmt_currency(depreciation)])

        fin_table = Table(fin_rows, colWidths=[3.2*inch, 2*inch])
        fin_style = [
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]
        # Bold the depreciation recoverable row (last row)
        if len(fin_rows) > 0:
            last_idx = len(fin_rows) - 1
            fin_style.append(("FONTNAME", (0, last_idx), (-1, last_idx), "Helvetica-Bold"))
            fin_style.append(("TEXTCOLOR", (0, last_idx), (-1, last_idx), green))
        fin_table.setStyle(TableStyle(fin_style))
        story.append(fin_table)
        story.append(Spacer(1, 8))

        if carrier_rcv and settlement and settlement < carrier_rcv:
            depreciation = carrier_rcv - settlement
            story.append(Paragraph(
                f"Upon submission of this Certificate of Substantial Completion, the recoverable depreciation "
                f"of <b>{_fmt_currency(depreciation)}</b> is due and payable per the terms of the insurance policy.",
                ParagraphStyle("DepNote", parent=normal, fontSize=9, leading=12),
            ))
        story.append(Spacer(1, 12))

    # ── Certification Statement ──
    story.append(Spacer(1, 8))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#e0e0e0"), thickness=0.5))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        f"I hereby certify that all substantial work described above has been completed in a workmanlike manner "
        f"and in compliance with applicable building codes and the approved insurance scope of work. "
        f"Minor punch-list items, if any, do not affect the functional performance of the completed work.",
        ParagraphStyle("Cert", parent=normal, fontSize=9, textColor=colors.gray, leading=12),
    ))
    story.append(Spacer(1, 20))

    # Signature line
    sig_parts = [contact_name, company_name]
    sig_display = " — ".join([p for p in sig_parts if p])
    sig_data = [
        ["_" * 40, "", "_" * 25],
        [sig_display, "", _fmt_date(comp_date)],
        ["Authorized Signature", "", "Date"],
    ]
    sig_table = Table(sig_data, colWidths=[3*inch, 1*inch, 2.5*inch])
    sig_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("FONTSIZE", (0, 2), (-1, 2), 7),
        ("TEXTCOLOR", (0, 2), (-1, 2), colors.gray),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(sig_table)

    # ── Footer ──
    story.append(Spacer(1, 24))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#e0e0e0"), thickness=0.5))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        f"Generated by DumbRoof.ai · {_fmt_date(None)}",
        ParagraphStyle("Footer", parent=normal, fontSize=7, textColor=colors.gray, alignment=1),
    ))

    doc.build(story)
    return buf.getvalue()


# ═══════════════════════════════════════════
# SUPPLEMENT COVER LETTER PDF
# ═══════════════════════════════════════════

def generate_supplement_cover_pdf(
    claim_data: dict,
    company_profile: dict,
    supplement_items: Optional[list[dict]] = None,
    additional_notes: Optional[str] = None,
) -> bytes:
    """
    Generate a Supplement Cover Letter PDF.
    Sent to the carrier with the supplement package.
    All fields optional — missing data gracefully skipped.
    """
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.75*inch, bottomMargin=0.75*inch)
    styles = getSampleStyleSheet()
    story = []

    navy = colors.HexColor("#0f1729")
    normal = ParagraphStyle("Body", parent=styles["Normal"], fontSize=10, textColor=navy, leading=14)
    bold_style = ParagraphStyle("Bold", parent=normal, fontName="Helvetica-Bold")

    company_name = _safe(company_profile.get("company_name"), "Roofing Company")
    company_addr = _safe(company_profile.get("address"))
    company_csz = _safe(company_profile.get("city_state_zip"))
    company_phone = _safe(company_profile.get("phone"))
    company_email = _safe(company_profile.get("email"))
    license_num = _safe(company_profile.get("license_number"))
    contact_name = _safe(company_profile.get("contact_name"))
    contact_title = _safe(company_profile.get("contact_title"))

    # ── Letterhead ──
    story.append(Paragraph(f"<b>{company_name}</b>", ParagraphStyle("LH", parent=normal, fontSize=14, fontName="Helvetica-Bold")))
    for line in [company_addr, company_csz]:
        if line:
            story.append(Paragraph(line, ParagraphStyle("LHLine", parent=normal, fontSize=9, textColor=colors.gray)))
    contact_parts = [p for p in [company_phone, company_email] if p]
    if contact_parts:
        story.append(Paragraph(" | ".join(contact_parts), ParagraphStyle("LHContact", parent=normal, fontSize=9, textColor=colors.gray)))
    if license_num:
        story.append(Paragraph(f"License: {license_num}", ParagraphStyle("LHLic", parent=normal, fontSize=8, textColor=colors.gray)))

    story.append(Spacer(1, 12))
    story.append(HRFlowable(width="100%", color=navy, thickness=1))
    story.append(Spacer(1, 12))

    # ── Date + Address block ──
    story.append(Paragraph(_fmt_date(None), normal))
    story.append(Spacer(1, 8))

    carrier = _safe(claim_data.get("carrier"), "Insurance Carrier")
    homeowner = _safe(claim_data.get("homeowner_name"), "Insured")
    address = _safe(claim_data.get("address"), "Property Address")
    claim_number = _safe(claim_data.get("claim_number"))
    date_of_loss = _safe(claim_data.get("date_of_loss"))

    story.append(Paragraph(f"<b>{carrier}</b>", bold_style))
    story.append(Paragraph("Claims Department", normal))
    story.append(Spacer(1, 8))

    # Re: line
    re_parts = [f"Insured: {homeowner}", f"Property: {address}"]
    if claim_number:
        re_parts.append(f"Claim #: {claim_number}")
    if date_of_loss:
        re_parts.append(f"Date of Loss: {_fmt_date(date_of_loss)}")

    for part in re_parts:
        story.append(Paragraph(f"<b>Re:</b> {part}", normal))
    story.append(Spacer(1, 12))

    # ── Body ──
    story.append(Paragraph("Dear Claims Department,", normal))
    story.append(Spacer(1, 8))

    contractor_rcv = float(_safe(claim_data.get("contractor_rcv"), 0))
    carrier_rcv = float(_safe(claim_data.get("current_carrier_rcv", claim_data.get("original_carrier_rcv")), 0))
    variance = contractor_rcv - carrier_rcv if contractor_rcv and carrier_rcv else 0

    story.append(Paragraph(
        f"Please find enclosed our supplemental documentation for the above-referenced claim. "
        f"After conducting a thorough inspection of the property at {address}, we have identified "
        f"additional storm-related damages that were not included in the original scope of loss.",
        normal,
    ))
    story.append(Spacer(1, 8))

    if variance > 0:
        story.append(Paragraph(
            f"Our documented scope totals {_fmt_currency(contractor_rcv)}, compared to the current carrier "
            f"scope of {_fmt_currency(carrier_rcv)} — a variance of {_fmt_currency(variance)}. "
            f"The enclosed documentation provides the factual basis for each supplemental item.",
            normal,
        ))
        story.append(Spacer(1, 8))

    # ── Supplement Items Table ──
    if supplement_items:
        story.append(Paragraph("<b>Supplemental Items:</b>", bold_style))
        story.append(Spacer(1, 4))

        header = ["Item", "Description", "Amount"]
        rows = [header]
        for item in supplement_items:
            rows.append([
                _safe(item.get("item"), "Item"),
                _safe(item.get("description"), ""),
                _fmt_currency(item.get("amount", 0)),
            ])

        items_table = Table(rows, colWidths=[2*inch, 3*inch, 1.3*inch])
        items_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), navy),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ALIGN", (2, 0), (2, -1), "RIGHT"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f5f5")]),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(items_table)
        story.append(Spacer(1, 8))

    # ── Enclosed documents ──
    story.append(Paragraph("<b>Enclosed Documentation:</b>", bold_style))
    story.append(Spacer(1, 4))
    enclosed = [
        "Forensic Causation Report with photographic evidence",
        "Detailed Xactimate-style estimate",
        "Scope comparison analysis (carrier vs. contractor)",
    ]
    for item in enclosed:
        story.append(Paragraph(f"• {item}", normal))
    story.append(Spacer(1, 8))

    if additional_notes:
        story.append(Paragraph(additional_notes, normal))
        story.append(Spacer(1, 8))

    # ── Closing ──
    story.append(Paragraph(
        "We respectfully request review and consideration of this supplement. "
        "Please do not hesitate to contact us with any questions or to schedule a re-inspection.",
        normal,
    ))
    story.append(Spacer(1, 12))
    story.append(Paragraph("Respectfully,", normal))
    story.append(Spacer(1, 20))

    sig_parts = []
    if contact_name:
        sig_parts.append(f"<b>{contact_name}</b>")
    if contact_title:
        sig_parts.append(contact_title)
    sig_parts.append(company_name)
    story.append(Paragraph("<br/>".join(sig_parts), normal))

    # ── Footer ──
    story.append(Spacer(1, 24))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#e0e0e0"), thickness=0.5))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        f"Generated by DumbRoof.ai · {_fmt_date(None)}",
        ParagraphStyle("Footer", parent=normal, fontSize=7, textColor=colors.gray, alignment=1),
    ))

    doc.build(story)
    return buf.getvalue()
