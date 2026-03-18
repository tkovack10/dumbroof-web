"""
Claim Brain — Tool Definitions + Execution
=============================================
Tools that Claim Brain can invoke during chat. Each tool:
  1. Generates the artifact (PDF, email draft)
  2. Returns a preview to the user for approval
  3. Executes on approval (sends email, uploads PDF)

Tool calls go through an APPROVAL GATE — nothing sends without user clicking "Approve."
"""

from __future__ import annotations
import os
import json
import base64
from datetime import datetime
from typing import Optional

from supabase import Client


# ═══════════════════════════════════════════
# TOOL DEFINITIONS (for Claude API)
# ═══════════════════════════════════════════

CLAIM_BRAIN_TOOLS = [
    {
        "name": "send_supplement_email",
        "description": (
            "Draft and send a supplement email to the insurance carrier's adjuster. "
            "Includes the supplement cover letter PDF and any attached documentation. "
            "ALWAYS presents draft to user for approval before sending."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "to_email": {"type": "string", "description": "Adjuster/carrier email address"},
                "subject": {"type": "string", "description": "Email subject line"},
                "body": {"type": "string", "description": "Email body text (professional tone)"},
                "cc_homeowner": {"type": "boolean", "description": "Whether to CC the homeowner", "default": False},
                "attach_supplement_cover": {"type": "boolean", "description": "Attach supplement cover letter PDF", "default": True},
            },
            "required": ["to_email", "subject", "body"],
        },
    },
    {
        "name": "generate_invoice",
        "description": (
            "Generate an invoice PDF for the homeowner or carrier. "
            "Includes line items from the claim scope, payment link (if Stripe configured). "
            "Can email the invoice directly to the homeowner."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "send_to_email": {"type": "string", "description": "Email address to send invoice to (optional — omit to just generate PDF)"},
                "invoice_type": {"type": "string", "enum": ["homeowner_deductible", "homeowner_balance", "carrier_supplement", "custom"], "description": "Type of invoice"},
                "notes": {"type": "string", "description": "Notes to include on invoice"},
                "include_payment_link": {"type": "boolean", "description": "Include Stripe payment link", "default": True},
            },
            "required": ["invoice_type"],
        },
    },
    {
        "name": "generate_coc",
        "description": (
            "Generate a Certificate of Completion PDF and optionally send it to the carrier. "
            "Confirms all contracted work has been completed per the approved scope."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "send_to_email": {"type": "string", "description": "Email address to send COC to (carrier adjuster)"},
                "completion_date": {"type": "string", "description": "Date work was completed (YYYY-MM-DD)"},
                "work_description": {"type": "string", "description": "Description of completed work (optional — auto-generated if omitted)"},
                "warranty_terms": {"type": "string", "description": "Warranty terms to include"},
            },
            "required": [],
        },
    },
    {
        "name": "send_aob_to_carrier",
        "description": (
            "Send a signed AOB (Assignment of Benefits) to the insurance carrier with a cover letter. "
            "Use when the homeowner has ALREADY signed the AOB and it needs to go to the carrier."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "to_email": {"type": "string", "description": "Carrier adjuster email"},
                "signed_aob_path": {"type": "string", "description": "Supabase storage path to the signed AOB document"},
            },
            "required": ["to_email"],
        },
    },
    {
        "name": "send_aob_for_signature",
        "description": (
            "Generate an AOB document and send it to the homeowner for digital signature. "
            "Use when the homeowner has NOT yet signed the AOB. "
            "Generates the AOB PDF and sends a signing link to the homeowner."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "homeowner_email": {"type": "string", "description": "Homeowner's email address"},
                "additional_terms": {"type": "string", "description": "Additional terms to include in the AOB"},
            },
            "required": ["homeowner_email"],
        },
    },
    {
        "name": "send_custom_email",
        "description": (
            "Send a custom email related to this claim. Use for any email that doesn't fit "
            "the other specific tools (follow-ups, scheduling, status updates, etc.). "
            "ALWAYS presents draft to user for approval before sending."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "to_email": {"type": "string", "description": "Recipient email address"},
                "subject": {"type": "string", "description": "Email subject"},
                "body": {"type": "string", "description": "Email body (HTML supported)"},
                "cc": {"type": "string", "description": "CC email address"},
            },
            "required": ["to_email", "subject", "body"],
        },
    },
    {
        "name": "check_claim_status",
        "description": (
            "Check the current status of the claim including financial ledger, "
            "pending emails, outstanding invoices, and next actions."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "check_carrier_emails",
        "description": (
            "Check the user's Gmail inbox for emails from the insurance carrier "
            "related to this claim. Only reads emails with the claim number in the "
            "subject line — never touches personal emails. Returns carrier responses, "
            "adjuster communications, and any scope revisions received."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
]


# ═══════════════════════════════════════════
# TOOL EXECUTION
# ═══════════════════════════════════════════

async def execute_tool(
    sb: Client,
    claim_id: str,
    user_id: str,
    tool_name: str,
    tool_input: dict,
) -> dict:
    """
    Execute a Claim Brain tool call. Returns a result dict with:
      - action: "preview" (needs user approval) or "complete" (done)
      - For previews: draft content, PDF preview, approval buttons
      - For completed: confirmation message
    """

    # Load claim + profile
    claim_result = sb.table("claims").select("*").eq("id", claim_id).single().execute()
    claim_data = claim_result.data or {}

    profile_result = sb.table("company_profiles").select("*").eq("user_id", user_id).single().execute()
    company_profile = profile_result.data or {}

    if tool_name == "send_supplement_email":
        return await _handle_supplement_email(sb, claim_id, user_id, claim_data, company_profile, tool_input)

    elif tool_name == "generate_invoice":
        return await _handle_generate_invoice(sb, claim_id, user_id, claim_data, company_profile, tool_input)

    elif tool_name == "generate_coc":
        return await _handle_generate_coc(sb, claim_id, user_id, claim_data, company_profile, tool_input)

    elif tool_name == "send_aob_to_carrier":
        return await _handle_aob_to_carrier(sb, claim_id, user_id, claim_data, company_profile, tool_input)

    elif tool_name == "send_aob_for_signature":
        return await _handle_aob_for_signature(sb, claim_id, user_id, claim_data, company_profile, tool_input)

    elif tool_name == "send_custom_email":
        return await _handle_custom_email(sb, claim_id, user_id, claim_data, company_profile, tool_input)

    elif tool_name == "check_claim_status":
        return await _handle_check_status(sb, claim_id, claim_data)

    elif tool_name == "check_carrier_emails":
        return await _handle_check_carrier_emails(sb, claim_id, user_id, claim_data)

    return {"action": "error", "message": f"Unknown tool: {tool_name}"}


async def _handle_supplement_email(sb, claim_id, user_id, claim_data, company_profile, tool_input):
    """Generate supplement email draft + cover letter PDF for approval."""
    from claim_brain_pdfs import generate_supplement_cover_pdf

    # Generate supplement cover letter PDF
    pdf_bytes = generate_supplement_cover_pdf(claim_data, company_profile)

    # Upload to Supabase storage
    file_path = f"{claim_data.get('file_path', claim_id)}/brain/supplement_cover_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    sb.storage.from_("claim-documents").upload(file_path, pdf_bytes, {"content-type": "application/pdf"})

    return {
        "action": "preview",
        "type": "email",
        "tool_name": "send_supplement_email",
        "draft": {
            "to": tool_input["to_email"],
            "cc": claim_data.get("homeowner_email") if tool_input.get("cc_homeowner") else None,
            "subject": tool_input["subject"],
            "body_html": tool_input["body"],
            "attachments": [{"path": file_path, "filename": "Supplement_Cover_Letter.pdf"}],
        },
        "message": f"Draft supplement email ready for {tool_input['to_email']}. Supplement cover letter PDF attached.",
    }


async def _handle_generate_invoice(sb, claim_id, user_id, claim_data, company_profile, tool_input):
    """Generate invoice PDF and optionally email it."""
    from claim_brain_pdfs import generate_invoice_pdf

    # Generate payment link if Stripe configured
    payment_link = None
    if tool_input.get("include_payment_link"):
        # Placeholder — actual Stripe integration goes here
        payment_link = None  # Set to Stripe payment link URL when configured

    pdf_bytes = generate_invoice_pdf(
        claim_data, company_profile,
        payment_link=payment_link,
        notes=tool_input.get("notes"),
    )

    # Upload to storage
    file_path = f"{claim_data.get('file_path', claim_id)}/brain/invoice_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    sb.storage.from_("claim-documents").upload(file_path, pdf_bytes, {"content-type": "application/pdf"})

    result = {
        "action": "preview" if tool_input.get("send_to_email") else "complete",
        "type": "invoice",
        "tool_name": "generate_invoice",
        "pdf_path": file_path,
        "message": f"Invoice generated and saved.",
    }

    if tool_input.get("send_to_email"):
        company_name = company_profile.get("company_name", "Your Roofing Company")
        address = claim_data.get("address", "the property")
        result["draft"] = {
            "to": tool_input["send_to_email"],
            "subject": f"Invoice — Storm Damage Restoration at {address}",
            "body_html": (
                f"<p>Dear {claim_data.get('homeowner_name', 'Homeowner')},</p>"
                f"<p>Please find attached the invoice for storm damage restoration services "
                f"at {address}.</p>"
                f"<p>If you have any questions, please don't hesitate to contact us.</p>"
                f"<p>Thank you,<br/>{company_name}</p>"
            ),
            "attachments": [{"path": file_path, "filename": "Invoice.pdf"}],
        }
        result["message"] = f"Invoice ready to send to {tool_input['send_to_email']}."

    return result


async def _handle_generate_coc(sb, claim_id, user_id, claim_data, company_profile, tool_input):
    """Generate COC PDF and optionally email to carrier."""
    from claim_brain_pdfs import generate_coc_pdf

    pdf_bytes = generate_coc_pdf(
        claim_data, company_profile,
        completion_date=tool_input.get("completion_date"),
        work_description=tool_input.get("work_description"),
        warranty_terms=tool_input.get("warranty_terms"),
    )

    file_path = f"{claim_data.get('file_path', claim_id)}/brain/coc_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    sb.storage.from_("claim-documents").upload(file_path, pdf_bytes, {"content-type": "application/pdf"})

    result = {
        "action": "preview" if tool_input.get("send_to_email") else "complete",
        "type": "coc",
        "tool_name": "generate_coc",
        "pdf_path": file_path,
        "message": "Certificate of Completion generated.",
    }

    if tool_input.get("send_to_email"):
        company_name = company_profile.get("company_name", "Your Roofing Company")
        address = claim_data.get("address", "the property")
        carrier = claim_data.get("carrier", "Insurance Carrier")
        result["draft"] = {
            "to": tool_input["send_to_email"],
            "subject": f"Certificate of Completion — {address}",
            "body_html": (
                f"<p>Dear {carrier} Claims Department,</p>"
                f"<p>Please find attached the Certificate of Completion for storm damage restoration "
                f"work at {address}. All work has been completed in accordance with the approved scope "
                f"and applicable building codes.</p>"
                f"<p>Please process final payment at your earliest convenience.</p>"
                f"<p>Respectfully,<br/>{company_name}</p>"
            ),
            "attachments": [{"path": file_path, "filename": "Certificate_of_Completion.pdf"}],
        }
        result["message"] = f"COC ready to send to {tool_input['send_to_email']}."

    return result


async def _handle_aob_to_carrier(sb, claim_id, user_id, claim_data, company_profile, tool_input):
    """Send signed AOB + cover letter to carrier."""
    from claim_brain_aob import generate_aob_cover_letter_pdf

    # Generate cover letter
    cover_bytes = generate_aob_cover_letter_pdf(claim_data, company_profile)
    cover_path = f"{claim_data.get('file_path', claim_id)}/brain/aob_cover_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    sb.storage.from_("claim-documents").upload(cover_path, cover_bytes, {"content-type": "application/pdf"})

    attachments = [{"path": cover_path, "filename": "AOB_Cover_Letter.pdf"}]

    # Include signed AOB if path provided
    if tool_input.get("signed_aob_path"):
        attachments.append({"path": tool_input["signed_aob_path"], "filename": "Signed_AOB.pdf"})

    company_name = company_profile.get("company_name", "Your Roofing Company")
    address = claim_data.get("address", "the property")
    carrier = claim_data.get("carrier", "Insurance Carrier")

    return {
        "action": "preview",
        "type": "email",
        "tool_name": "send_aob_to_carrier",
        "draft": {
            "to": tool_input["to_email"],
            "subject": f"Assignment of Claim Benefits — {address}",
            "body_html": (
                f"<p>Dear {carrier} Claims Department,</p>"
                f"<p>Please find enclosed the executed Assignment of Claim Benefits for the above-referenced property. "
                f"Please update your records to include {company_name} as an authorized representative.</p>"
                f"<p>Respectfully,<br/>{company_name}</p>"
            ),
            "attachments": attachments,
        },
        "message": f"AOB package ready to send to {tool_input['to_email']}.",
    }


async def _handle_aob_for_signature(sb, claim_id, user_id, claim_data, company_profile, tool_input):
    """Generate AOB and send to homeowner for digital signature."""
    from claim_brain_aob import generate_aob_pdf

    # Generate AOB PDF
    pdf_bytes = generate_aob_pdf(
        claim_data, company_profile,
        additional_terms=tool_input.get("additional_terms"),
    )
    pdf_path = f"{claim_data.get('file_path', claim_id)}/brain/aob_unsigned_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    sb.storage.from_("claim-documents").upload(pdf_path, pdf_bytes, {"content-type": "application/pdf"})

    # Create signing record in DB
    try:
        sign_result = sb.table("aob_signatures").insert({
            "claim_id": claim_id,
            "user_id": user_id,
            "homeowner_email": tool_input["homeowner_email"],
            "homeowner_name": claim_data.get("homeowner_name", ""),
            "unsigned_pdf_path": pdf_path,
            "status": "pending",
        }).execute()
        sign_id = sign_result.data[0]["id"] if sign_result.data else "pending"
    except Exception:
        sign_id = "pending"

    # Generate signing link
    base_url = os.environ.get("NEXT_PUBLIC_SITE_URL", "https://dumbroof.ai")
    sign_link = f"{base_url}/sign/{sign_id}"

    company_name = company_profile.get("company_name", "Your Roofing Company")
    address = claim_data.get("address", "the property")

    return {
        "action": "preview",
        "type": "email",
        "tool_name": "send_aob_for_signature",
        "draft": {
            "to": tool_input["homeowner_email"],
            "subject": f"Assignment of Benefits — Signature Required for {address}",
            "body_html": (
                f"<p>Dear {claim_data.get('homeowner_name', 'Homeowner')},</p>"
                f"<p>As discussed, please review and sign the attached Assignment of Benefits for your "
                f"insurance claim at {address}. This allows {company_name} to communicate directly with "
                f"your insurance carrier on your behalf regarding the storm damage restoration.</p>"
                f"<p><strong>Sign online:</strong> <a href=\"{sign_link}\">{sign_link}</a></p>"
                f"<p>A copy of the document is also attached for your records.</p>"
                f"<p>If you have any questions, please don't hesitate to contact us.</p>"
                f"<p>Thank you,<br/>{company_name}</p>"
            ),
            "attachments": [{"path": pdf_path, "filename": "Assignment_of_Benefits.pdf"}],
        },
        "sign_link": sign_link,
        "message": f"AOB ready to send to {tool_input['homeowner_email']} for digital signature.",
    }


async def _handle_custom_email(sb, claim_id, user_id, claim_data, company_profile, tool_input):
    """Draft a custom email for approval."""
    return {
        "action": "preview",
        "type": "email",
        "tool_name": "send_custom_email",
        "draft": {
            "to": tool_input["to_email"],
            "cc": tool_input.get("cc"),
            "subject": tool_input["subject"],
            "body_html": tool_input["body"],
            "attachments": [],
        },
        "message": f"Email draft ready for {tool_input['to_email']}.",
    }


async def _handle_check_status(sb, claim_id, claim_data):
    """Return current claim status summary."""
    # Count emails
    emails_result = sb.table("claim_emails").select("id", count="exact").eq("claim_id", claim_id).execute()
    email_count = emails_result.count or 0

    # Count correspondence
    corr_result = sb.table("carrier_correspondence").select("id", count="exact").eq("claim_id", claim_id).execute()
    corr_count = corr_result.count or 0

    contractor_rcv = float(claim_data.get("contractor_rcv") or 0)
    carrier_rcv = float(claim_data.get("current_carrier_rcv") or claim_data.get("original_carrier_rcv") or 0)
    variance = contractor_rcv - carrier_rcv if contractor_rcv else 0

    return {
        "action": "complete",
        "type": "status",
        "data": {
            "address": claim_data.get("address"),
            "carrier": claim_data.get("carrier"),
            "phase": claim_data.get("phase"),
            "status": claim_data.get("status"),
            "contractor_rcv": contractor_rcv,
            "carrier_rcv": carrier_rcv,
            "variance": variance,
            "emails_sent": email_count,
            "carrier_correspondence": corr_count,
            "damage_score": claim_data.get("damage_score"),
            "damage_grade": claim_data.get("damage_grade"),
        },
        "message": "Status loaded.",
    }


async def _handle_check_carrier_emails(sb, claim_id, user_id, claim_data):
    """Check user's Gmail for carrier emails related to this claim."""
    from claim_brain_email import fetch_claim_emails_from_gmail

    # Get user's Gmail refresh token
    try:
        profile_result = sb.table("company_profiles").select("gmail_refresh_token, sending_email").eq("user_id", user_id).limit(1).execute()
        profile = (profile_result.data or [{}])[0] if profile_result.data else {}
    except Exception:
        profile = {}

    refresh_token = profile.get("gmail_refresh_token")
    if not refresh_token:
        return {
            "action": "complete",
            "type": "info",
            "data": {"message": "Gmail not connected. Go to Settings → Connect Gmail to enable email monitoring."},
            "message": "Gmail not connected.",
        }

    # Get claim numbers to search for
    # claim_number is a direct column in the claims table
    claim_number = claim_data.get("claim_number") or ""
    # Also try nested carrier dict (legacy config format)
    if not claim_number and isinstance(claim_data.get("carrier"), dict):
        claim_number = claim_data["carrier"].get("claim_number", "")

    claim_numbers = []
    if claim_number and claim_number != "Pending":
        claim_numbers.append(claim_number)

    # Also search by address keywords as fallback
    address = claim_data.get("address", "")
    address_parts = address.split(",")[0].strip() if address else ""

    if not claim_numbers and address_parts:
        claim_numbers.append(address_parts)

    if not claim_numbers:
        return {
            "action": "complete",
            "type": "info",
            "data": {"message": "No claim number found to search for."},
            "message": "No claim number available.",
        }

    # Fetch emails from Gmail
    emails = fetch_claim_emails_from_gmail(
        refresh_token=refresh_token,
        claim_numbers=claim_numbers,
        max_results=15,
    )

    if not emails:
        return {
            "action": "complete",
            "type": "info",
            "data": {
                "message": f"No emails found with claim number(s): {', '.join(claim_numbers)}",
                "searched": claim_numbers,
            },
            "message": f"No carrier emails found for {', '.join(claim_numbers)}.",
        }

    # Return summary for Claim Brain to analyze
    email_summaries = []
    for e in emails:
        email_summaries.append({
            "from": e["from"],
            "subject": e["subject"],
            "date": e["date"],
            "snippet": e["snippet"],
            "is_inbound": "INBOX" in e.get("label_ids", []),
        })

    return {
        "action": "complete",
        "type": "carrier_emails",
        "data": {
            "emails": email_summaries,
            "total": len(email_summaries),
            "searched_claim_numbers": claim_numbers,
        },
        "message": f"Found {len(email_summaries)} emails related to this claim.",
    }
