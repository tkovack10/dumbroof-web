"""
Claim Brain — AOB (Assignment of Benefits) Handler
====================================================
Two flows:
  1. User HAS a signed AOB → generate cover letter + send AOB to carrier
  2. User DOES NOT have signed AOB → generate AOB for digital signature → send to homeowner

Digital signature:
  Uses Supabase-hosted signing page (simple — homeowner clicks link, types name, saves).
  For production: integrate DocuSign, HelloSign, or PandaDoc API.

All fields optional — missing data never blocks generation.
"""

from __future__ import annotations
import io
import os
import json
from datetime import datetime
from typing import Optional

from claim_brain_pdfs import _safe, _fmt_date, _fmt_currency


# ═══════════════════════════════════════════
# AOB DOCUMENT — Generate for Signature
# ═══════════════════════════════════════════

def generate_aob_pdf(
    claim_data: dict,
    company_profile: dict,
    additional_terms: Optional[str] = None,
) -> bytes:
    """
    Generate an Assignment of Benefits (AOB) / Assignment of Claim Benefits contract.
    Designed for homeowner signature. All fields optional.
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
    title_style = ParagraphStyle("AOBTitle", parent=styles["Heading1"], fontSize=18, textColor=navy, alignment=1, spaceAfter=4)
    small = ParagraphStyle("Small", parent=normal, fontSize=9, textColor=colors.gray, leading=12)

    company_name = _safe(company_profile.get("company_name"), "Contractor")
    company_addr = _safe(company_profile.get("address"))
    company_csz = _safe(company_profile.get("city_state_zip"))
    company_phone = _safe(company_profile.get("phone"))
    company_email = _safe(company_profile.get("email"))
    license_num = _safe(company_profile.get("license_number"))

    homeowner = _safe(claim_data.get("homeowner_name"), "Property Owner")
    address = _safe(claim_data.get("address"), "Property Address")
    carrier = _safe(claim_data.get("carrier"), "Insurance Company")
    claim_number = _safe(claim_data.get("claim_number"))
    policy_number = _safe(claim_data.get("policy_number"))
    date_of_loss = _safe(claim_data.get("date_of_loss"))

    # ── Header ──
    story.append(Paragraph("ASSIGNMENT OF CLAIM BENEFITS", title_style))
    story.append(Paragraph("Insurance Claim — Storm Damage Restoration", ParagraphStyle("Sub", parent=normal, fontSize=11, textColor=colors.gray, alignment=1)))
    story.append(Spacer(1, 12))
    story.append(HRFlowable(width="100%", color=navy, thickness=2))
    story.append(Spacer(1, 12))

    # ── Parties ──
    story.append(Paragraph("<b>PARTIES:</b>", bold_style))
    story.append(Spacer(1, 4))

    parties_data = []
    parties_data.append(["Insured (Assignor):", homeowner])
    parties_data.append(["Property Address:", address])
    parties_data.append(["Contractor (Assignee):", company_name])
    if company_addr:
        contractor_full = company_addr
        if company_csz:
            contractor_full += f", {company_csz}"
        parties_data.append(["Contractor Address:", contractor_full])
    parties_data.append(["Insurance Carrier:", carrier])
    if claim_number:
        parties_data.append(["Claim Number:", claim_number])
    if policy_number:
        parties_data.append(["Policy Number:", policy_number])
    if date_of_loss:
        parties_data.append(["Date of Loss:", _fmt_date(date_of_loss)])

    parties_table = Table(parties_data, colWidths=[1.8*inch, 4.5*inch])
    parties_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.gray),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(parties_table)
    story.append(Spacer(1, 12))

    # ── Assignment Terms ──
    story.append(Paragraph("<b>ASSIGNMENT:</b>", bold_style))
    story.append(Spacer(1, 4))

    terms = [
        f"I, {homeowner}, the insured/policyholder at the above-referenced property, hereby assign "
        f"to {company_name} all insurance rights, benefits, and proceeds relating to the claim for "
        f"storm damage at {address}, including but not limited to:",

        "1. The right to communicate directly with the insurance carrier regarding the scope of loss, "
        "supplemental claims, and dispute resolution;",

        "2. The right to receive payment of insurance proceeds for the covered loss directly from the "
        "carrier, or to be named as co-payee on any such payments;",

        "3. The right to pursue any remedies available under the insurance policy, including appraisal, "
        "mediation, or other dispute resolution mechanisms;",

        f"4. This assignment does not relieve {homeowner} of the obligation to pay any applicable "
        f"deductible as set forth in the insurance policy.",
    ]

    for term in terms:
        story.append(Paragraph(term, normal))
        story.append(Spacer(1, 6))

    if additional_terms:
        story.append(Spacer(1, 4))
        story.append(Paragraph(additional_terms, normal))
        story.append(Spacer(1, 6))

    # ── Acknowledgment ──
    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>ACKNOWLEDGMENT:</b>", bold_style))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "The Insured acknowledges that this Assignment of Benefits is voluntary and does not affect "
        "the Insured's rights under their insurance policy beyond the specific benefits assigned herein. "
        "The Insured retains all other rights under the policy.",
        normal,
    ))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "The Insured further acknowledges the right to rescind this Assignment within the timeframe "
        "permitted by applicable state law.",
        small,
    ))

    # ── Signature Blocks ──
    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#e0e0e0"), thickness=0.5))
    story.append(Spacer(1, 12))

    sig_data = [
        ["INSURED / POLICYHOLDER:", "", "CONTRACTOR:"],
        ["", "", ""],
        ["_" * 35, "", "_" * 35],
        [f"{homeowner}", "", f"{_safe(company_profile.get('contact_name'), company_name)}"],
        ["Signature", "", "Signature"],
        ["", "", ""],
        ["_" * 35, "", "_" * 35],
        ["Date", "", "Date"],
    ]
    sig_table = Table(sig_data, colWidths=[3*inch, 0.5*inch, 3*inch])
    sig_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, 4), (-1, 4), colors.gray),
        ("TEXTCOLOR", (0, 7), (-1, 7), colors.gray),
        ("FONTSIZE", (0, 4), (-1, 4), 7),
        ("FONTSIZE", (0, 7), (-1, 7), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(sig_table)

    # ── Footer ──
    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#e0e0e0"), thickness=0.5))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        f"Generated by DumbRoof.ai · {_fmt_date(None)} · This document should be reviewed by legal counsel.",
        ParagraphStyle("Footer", parent=normal, fontSize=7, textColor=colors.gray, alignment=1),
    ))

    doc.build(story)
    return buf.getvalue()


# ═══════════════════════════════════════════
# AOB COVER LETTER — Send to Carrier
# ═══════════════════════════════════════════

def generate_aob_cover_letter_pdf(
    claim_data: dict,
    company_profile: dict,
) -> bytes:
    """Generate a cover letter for sending a signed AOB to the carrier."""
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.75*inch, bottomMargin=0.75*inch)
    styles = getSampleStyleSheet()
    story = []

    navy = colors.HexColor("#0f1729")
    normal = ParagraphStyle("Body", parent=styles["Normal"], fontSize=10, textColor=navy, leading=14)
    bold_style = ParagraphStyle("Bold", parent=normal, fontName="Helvetica-Bold")

    company_name = _safe(company_profile.get("company_name"), "Contractor")
    contact_name = _safe(company_profile.get("contact_name"))
    contact_title = _safe(company_profile.get("contact_title"))
    company_addr = _safe(company_profile.get("address"))
    company_csz = _safe(company_profile.get("city_state_zip"))
    company_phone = _safe(company_profile.get("phone"))
    company_email = _safe(company_profile.get("email"))
    license_num = _safe(company_profile.get("license_number"))

    homeowner = _safe(claim_data.get("homeowner_name"), "Insured")
    address = _safe(claim_data.get("address"), "Property Address")
    carrier = _safe(claim_data.get("carrier"), "Insurance Carrier")
    claim_number = _safe(claim_data.get("claim_number"))

    # Letterhead
    story.append(Paragraph(f"<b>{company_name}</b>", ParagraphStyle("LH", parent=normal, fontSize=14, fontName="Helvetica-Bold")))
    for line in [company_addr, company_csz]:
        if line:
            story.append(Paragraph(line, ParagraphStyle("LHL", parent=normal, fontSize=9, textColor=colors.gray)))
    contact_parts = [p for p in [company_phone, company_email] if p]
    if contact_parts:
        story.append(Paragraph(" | ".join(contact_parts), ParagraphStyle("LHC", parent=normal, fontSize=9, textColor=colors.gray)))
    if license_num:
        story.append(Paragraph(f"License: {license_num}", ParagraphStyle("LHLic", parent=normal, fontSize=8, textColor=colors.gray)))

    story.append(Spacer(1, 12))
    story.append(HRFlowable(width="100%", color=navy, thickness=1))
    story.append(Spacer(1, 12))

    story.append(Paragraph(_fmt_date(None), normal))
    story.append(Spacer(1, 8))
    story.append(Paragraph(f"<b>{carrier}</b>", bold_style))
    story.append(Paragraph("Claims Department", normal))
    story.append(Spacer(1, 8))

    re_parts = [f"Insured: {homeowner}", f"Property: {address}"]
    if claim_number:
        re_parts.append(f"Claim #: {claim_number}")
    for part in re_parts:
        story.append(Paragraph(f"<b>Re:</b> {part}", normal))
    story.append(Spacer(1, 12))

    story.append(Paragraph("Dear Claims Department,", normal))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        f"Please find enclosed the executed Assignment of Claim Benefits for the above-referenced claim. "
        f"The insured, {homeowner}, has assigned benefits to {company_name} for the purpose of storm damage "
        f"restoration at {address}.",
        normal,
    ))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        f"Please update your records to include {company_name} as an authorized representative and "
        f"co-payee on all claim-related payments. All future correspondence regarding this claim should "
        f"be directed to:",
        normal,
    ))
    story.append(Spacer(1, 8))

    contact_block = [company_name]
    if company_addr:
        contact_block.append(company_addr)
    if company_csz:
        contact_block.append(company_csz)
    if company_phone:
        contact_block.append(f"Phone: {company_phone}")
    if company_email:
        contact_block.append(f"Email: {company_email}")
    for line in contact_block:
        story.append(Paragraph(f"    {line}", bold_style))

    story.append(Spacer(1, 12))
    story.append(Paragraph(
        "Please confirm receipt of this Assignment at your earliest convenience.",
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

    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Enclosure:</b> Executed Assignment of Claim Benefits", normal))

    # Footer
    story.append(Spacer(1, 24))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#e0e0e0"), thickness=0.5))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        f"Generated by DumbRoof.ai · {_fmt_date(None)}",
        ParagraphStyle("Footer", parent=normal, fontSize=7, textColor=colors.gray, alignment=1),
    ))

    doc.build(story)
    return buf.getvalue()
