"""
Claim Brain — Tool Definitions + Execution
=============================================
Tools that Claim Brain can invoke during chat. Two classes:

  1. READ-ONLY TOOLS (R1) — fetch context for Richard. No approval gate.
     Examples: get_scope_comparison, lookup_xactimate_price, search_photos.

  2. DRAFT / CLASSIFY TOOLS (R2) — inspect user uploads, produce drafts.
     No side effects. Examples: classify_uploaded_file, send_custom_email (draft).

  3. WRITE TOOLS (existing) — produce a preview and wait for user approval
     before anything ships. Examples: send_supplement_email, generate_coc.

Every invocation is recorded to public.claim_brain_audit.
"""

from __future__ import annotations
import os
import json
import time
import base64
import traceback
from datetime import datetime
from typing import Optional, Any

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
    # ─────────────────────────────────────────────
    # R1 — Read-only tools. No approval gate.
    # ─────────────────────────────────────────────
    {
        "name": "get_scope_comparison",
        "description": (
            "Return the line-by-line scope comparison between the contractor estimate "
            "and the carrier scope for this claim. Use this when the user asks 'what did "
            "the carrier miss?', 'where are the gaps?', or 'break down the variance'. "
            "Returns every row with carrier $, contractor $, delta, and notes. Can filter "
            "to only rows with a positive delta (money the carrier owes)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "gaps_only": {
                    "type": "boolean",
                    "description": "If true, return only rows where contractor > carrier (actual gaps).",
                    "default": False,
                },
                "limit": {
                    "type": "integer",
                    "description": "Max rows to return. Default 50.",
                    "default": 50,
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_carrier_playbook",
        "description": (
            "Return tactical intelligence for the carrier on this claim — known "
            "denial patterns, typical underpayment tactics, winning supplement "
            "arguments, inspector patterns. Use this BEFORE drafting any carrier-facing "
            "email or argument. Returns the full playbook markdown if available."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "lookup_xactimate_price",
        "description": (
            "Look up the current Xactimate price for a line item by description or code. "
            "Returns code, install price, remove price, and unit. Uses the state/market "
            "from this claim (NY/NJ/PA/MD/DE/OH/MI/IL/MN/TX) if available. Use this when "
            "the user asks 'what does step flashing cost?', 'price for drip edge in NJ', "
            "or when building a supplement argument that needs dollar figures."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "description": {
                    "type": "string",
                    "description": "Free-text description, e.g. 'step flashing', 'ice and water', 'drip edge'.",
                },
                "state": {
                    "type": "string",
                    "description": "Two-letter state code. Defaults to claim's state.",
                },
            },
            "required": ["description"],
        },
    },
    {
        "name": "get_noaa_weather",
        "description": (
            "Look up verified NOAA storm events (hail, high wind, severe thunderstorm) "
            "for the claim's county around the date of loss. Use this when building a "
            "causation argument or verifying the storm the carrier is disputing. Returns "
            "events with date, magnitude, distance from property. Requires claim to have "
            "a date_of_loss and geocodable address."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "window_days": {
                    "type": "integer",
                    "description": "Days before/after date of loss to search. Default 3.",
                    "default": 3,
                },
            },
            "required": [],
        },
    },
    {
        "name": "search_photos",
        "description": (
            "Search the claim's photo set by damage type, material, trade, or severity. "
            "Returns matching annotation_keys + descriptions. Use this when asked "
            "'do we have hail photos?', 'find shingle damage photos', or when assembling "
            "evidence for a supplement argument."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "damage_type": {
                    "type": "string",
                    "description": "e.g. hail, wind, mechanical, granule_loss",
                },
                "material": {
                    "type": "string",
                    "description": "e.g. shingle, siding, gutter, flashing",
                },
                "trade": {
                    "type": "string",
                    "description": "e.g. roofing, siding, gutters",
                },
                "severity": {
                    "type": "string",
                    "description": "e.g. minor, moderate, severe",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max photos to return. Default 20.",
                    "default": 20,
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_damage_scores",
        "description": (
            "Return the Damage Score (DS — photo-based evidence strength) and "
            "Technical Approval Score (TAS — likelihood of carrier approval) for this "
            "claim, with grade letter and component breakdown. Use when asked 'how "
            "strong is this claim?', 'will the carrier approve this?', or for training."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    # ─────────────────────────────────────────────
    # R3 — Destructive writes. Approval-gated.
    # ─────────────────────────────────────────────
    {
        "name": "attach_to_claim",
        "description": (
            "Attach a file (uploaded to chat) to the claim under the correct document slot: "
            "AOB / COC / CARRIER_SCOPE / EAGLEVIEW / CONTRACT / OTHER. Use AFTER "
            "classify_uploaded_file has returned a classification with confidence >= 0.90. "
            "If confidence is below 0.90, ASK THE USER first rather than calling this tool. "
            "REQUIRES USER APPROVAL — returns a preview and waits."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "storage_path": {"type": "string", "description": "Supabase storage path of the uploaded file."},
                "doc_type": {
                    "type": "string",
                    "enum": ["AOB", "COC", "CARRIER_SCOPE", "EAGLEVIEW", "CONTRACT", "PHOTO", "SUPPLEMENT_RESPONSE", "OTHER"],
                    "description": "Classification from classify_uploaded_file.",
                },
                "filename": {"type": "string", "description": "Original filename."},
                "classification_confidence": {
                    "type": "number",
                    "description": "Confidence score 0.0-1.0 from classify_uploaded_file.",
                },
            },
            "required": ["storage_path", "doc_type", "filename"],
        },
    },
    {
        "name": "trigger_reprocess",
        "description": (
            "Re-run the full claim processing pipeline — regenerates photo annotations, "
            "estimate, scope comparison, damage scores, and PDFs. Use after a new carrier "
            "scope or updated measurements have been attached. Takes 1-2 minutes to complete. "
            "REQUIRES USER APPROVAL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Why reprocessing is needed — e.g. 'new carrier scope attached' or 'updated EagleView measurements'.",
                },
            },
            "required": ["reason"],
        },
    },
    # ─────────────────────────────────────────────
    # R4 — Agentic sends + cadence. Approval-gated.
    # ─────────────────────────────────────────────
    {
        "name": "send_to_carrier",
        "description": (
            "Generic email-send to the insurance carrier with one or more attachments "
            "(already uploaded to Supabase storage). Use when the specific-purpose email "
            "tools (send_supplement_email / send_aob_to_carrier / generate_coc) don't fit. "
            "Subject MUST be the claim number only — platform rule, carriers auto-reject "
            "anything else. REQUIRES USER APPROVAL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "to_email": {"type": "string", "description": "Carrier adjuster email."},
                "cc": {"type": "string", "description": "Comma-separated CC list. Optional."},
                "body_html": {"type": "string", "description": "Email body. HTML supported."},
                "attachment_paths": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Supabase storage paths to attach.",
                },
            },
            "required": ["to_email", "body_html"],
        },
    },
    {
        "name": "schedule_follow_up_cadence",
        "description": (
            "Schedule a series of follow-up emails to the carrier if they don't respond. "
            "Writes rows to claim_brain_cadence_sends; a cron sends them at scheduled_at. "
            "Typical AOB cadence: days [3, 7, 14, 21]. Typical supplement cadence: [3, 7, 15]. "
            "All follow-ups must include the claim number in the subject. REQUIRES APPROVAL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "cadence_type": {
                    "type": "string",
                    "enum": ["aob_submission", "supplement", "coc", "custom"],
                    "description": "What kind of cadence this is.",
                },
                "to_email": {"type": "string", "description": "Carrier adjuster email."},
                "cc": {"type": "string", "description": "CC list. Optional."},
                "days": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": "Day offsets from now for each follow-up. e.g. [3, 7, 14].",
                },
                "attachment_paths": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Supabase storage paths to re-attach on each follow-up.",
                },
            },
            "required": ["cadence_type", "to_email", "days"],
        },
    },
    {
        "name": "cancel_cadence",
        "description": (
            "Cancel all pending follow-up sends for this claim. Use when the carrier has "
            "responded, the claim has closed, or the user no longer wants follow-ups. "
            "Does NOT affect already-sent emails. REQUIRES APPROVAL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Why cancelling — e.g. 'carrier approved', 'user request', 'claim closed'.",
                },
            },
            "required": ["reason"],
        },
    },
    # ─────────────────────────────────────────────
    # R2 — Classify uploaded files. No side effects.
    # ─────────────────────────────────────────────
    {
        "name": "classify_uploaded_file",
        "description": (
            "Classify a file the user just dropped into this chat. Uses Claude Vision to "
            "determine what kind of document it is: AOB (Assignment of Benefits), COC "
            "(Certificate of Completion), CARRIER_SCOPE (carrier's estimate/adjuster "
            "report), EAGLEVIEW (measurement report), SUPPLEMENT_RESPONSE (carrier "
            "replying to a supplement), CONTRACT, PHOTO, or OTHER. Returns "
            "classification + confidence + suggested next action. USE THIS TOOL "
            "AUTOMATICALLY whenever the user message includes attachments — it is the "
            "gateway to routing the file correctly. Does NOT attach the file to the "
            "claim or send anything — that requires a separate approved tool."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "storage_path": {
                    "type": "string",
                    "description": "Supabase storage path of the uploaded file (from claim-documents bucket).",
                },
                "filename": {
                    "type": "string",
                    "description": "Original filename, used as a hint.",
                },
            },
            "required": ["storage_path"],
        },
    },
]


# ═══════════════════════════════════════════
# TOOL EXECUTION
# ═══════════════════════════════════════════

def _audit_log(
    sb: Client,
    claim_id: str,
    user_id: str,
    tool_name: str,
    tool_input: dict,
    result: dict,
    duration_ms: int,
    error: Optional[str] = None,
) -> None:
    """Insert one row into claim_brain_audit. Non-fatal — swallows errors."""
    try:
        # Supabase jsonb expects a dict (NOT pre-serialized JSON); truncate oversize inputs.
        safe_input: Any = tool_input if isinstance(tool_input, dict) else {"_raw": str(tool_input)[:2000]}
        # Cap total serialized size to keep audit rows small and predictable.
        try:
            if len(json.dumps(safe_input, default=str)) > 10000:
                safe_input = {"_truncated": True, "tool_name": tool_name}
        except Exception:
            safe_input = {"_truncated": True, "tool_name": tool_name}
        summary = (result.get("message") or "")[:500] if isinstance(result, dict) else ""
        sb.table("claim_brain_audit").insert({
            "claim_id": claim_id,
            "user_id": user_id or None,
            "tool_name": tool_name,
            "tool_input": safe_input,
            "action": (result.get("action") if isinstance(result, dict) else None),
            "result_summary": summary,
            "approval_id": (result.get("approval_id") if isinstance(result, dict) else None),
            "duration_ms": duration_ms,
            "error": error,
        }).execute()
    except Exception as e:
        print(f"[BRAIN AUDIT] Failed to log tool invocation (non-fatal): {e}")


async def execute_tool(
    sb: Client,
    claim_id: str,
    user_id: str,
    tool_name: str,
    tool_input: dict,
) -> dict:
    """
    Execute a Claim Brain tool call. Returns a result dict with:
      - action: "preview" (needs user approval) or "complete" (done) or "error"
      - For previews: draft content, PDF preview, approval buttons
      - For completed: confirmation message + data payload

    Every invocation is logged to public.claim_brain_audit.
    """
    start = time.time()
    result: dict = {"action": "error", "message": "Unknown error"}
    err: Optional[str] = None
    try:
        # Load claim + profile (needed by every handler)
        claim_result = sb.table("claims").select("*").eq("id", claim_id).single().execute()
        claim_data = claim_result.data or {}

        try:
            profile_result = sb.table("company_profiles").select("*").eq("user_id", user_id).limit(1).execute()
            company_profile = (profile_result.data or [{}])[0] if profile_result.data else {}
        except Exception:
            company_profile = {}

        # ─── Write tools (existing) ───────────────────
        if tool_name == "send_supplement_email":
            result = await _handle_supplement_email(sb, claim_id, user_id, claim_data, company_profile, tool_input)
        elif tool_name == "generate_invoice":
            result = await _handle_generate_invoice(sb, claim_id, user_id, claim_data, company_profile, tool_input)
        elif tool_name == "generate_coc":
            result = await _handle_generate_coc(sb, claim_id, user_id, claim_data, company_profile, tool_input)
        elif tool_name == "send_aob_to_carrier":
            result = await _handle_aob_to_carrier(sb, claim_id, user_id, claim_data, company_profile, tool_input)
        elif tool_name == "send_aob_for_signature":
            result = await _handle_aob_for_signature(sb, claim_id, user_id, claim_data, company_profile, tool_input)
        elif tool_name == "send_custom_email":
            result = await _handle_custom_email(sb, claim_id, user_id, claim_data, company_profile, tool_input)
        elif tool_name == "check_claim_status":
            result = await _handle_check_status(sb, claim_id, claim_data)
        elif tool_name == "check_carrier_emails":
            result = await _handle_check_carrier_emails(sb, claim_id, user_id, claim_data)
        # ─── R1 read-only tools ───────────────────────
        elif tool_name == "get_scope_comparison":
            result = _handle_get_scope_comparison(claim_data, tool_input)
        elif tool_name == "get_carrier_playbook":
            result = _handle_get_carrier_playbook(claim_data)
        elif tool_name == "lookup_xactimate_price":
            result = _handle_lookup_xactimate_price(claim_data, tool_input)
        elif tool_name == "get_noaa_weather":
            result = _handle_get_noaa_weather(claim_data, tool_input)
        elif tool_name == "search_photos":
            result = _handle_search_photos(sb, claim_id, tool_input)
        elif tool_name == "get_damage_scores":
            result = _handle_get_damage_scores(claim_data)
        # ─── R2 classify ──────────────────────────────
        elif tool_name == "classify_uploaded_file":
            result = await _handle_classify_uploaded_file(sb, claim_id, tool_input)
        # ─── R3 destructive writes (preview → approval) ──
        elif tool_name == "attach_to_claim":
            result = _handle_preview_attach_to_claim(claim_data, tool_input)
        elif tool_name == "trigger_reprocess":
            result = _handle_preview_trigger_reprocess(claim_data, tool_input)
        # ─── R4 agentic sends + cadence (preview → approval) ──
        elif tool_name == "send_to_carrier":
            result = _handle_preview_send_to_carrier(claim_data, tool_input)
        elif tool_name == "schedule_follow_up_cadence":
            result = _handle_preview_schedule_cadence(claim_data, tool_input)
        elif tool_name == "cancel_cadence":
            result = _handle_preview_cancel_cadence(sb, claim_id, tool_input)
        else:
            result = {"action": "error", "message": f"Unknown tool: {tool_name}"}
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        print(f"[BRAIN TOOL ERROR] {tool_name}: {err}\n{traceback.format_exc()}")
        result = {"action": "error", "message": err}
    finally:
        duration_ms = int((time.time() - start) * 1000)
        _audit_log(sb, claim_id, user_id, tool_name, tool_input, result, duration_ms, err)

    return result


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


# ═══════════════════════════════════════════
# R1 — READ-ONLY HANDLERS
# ═══════════════════════════════════════════

def _claim_state(claim_data: dict) -> str:
    """Infer two-letter state code from claim data.

    Returns "" when unknown. Callers should NOT silently default — a wrong state
    can misroute pricing now that we have 84-market data (NY/NJ/PA/MD/DE/OH/MI/
    IL/MN/TX). Treat empty-return as "ask the user" rather than "default to NY".
    """
    state = (claim_data.get("state") or "").strip().upper()
    if len(state) == 2:
        return state
    csz = claim_data.get("city_state_zip") or ""
    import re
    m = re.search(r"\b([A-Z]{2})\b\s*\d{5}", csz)
    if m:
        return m.group(1).upper()
    addr = claim_data.get("address") or ""
    m = re.search(r",\s*([A-Z]{2})\s", addr)
    return m.group(1).upper() if m else ""


def _handle_get_scope_comparison(claim_data: dict, tool_input: dict) -> dict:
    """Return the line-by-line scope comparison rows, optionally filtered to gaps."""
    rows = claim_data.get("scope_comparison") or []
    if not rows:
        return {
            "action": "complete",
            "type": "scope_comparison",
            "data": {"rows": [], "total_gap": 0, "row_count": 0},
            "message": "No scope comparison data on this claim yet. Reprocess with a carrier scope to generate one.",
        }

    gaps_only = bool(tool_input.get("gaps_only"))
    limit = int(tool_input.get("limit") or 50)

    normalized = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        carrier_amt = float(r.get("carrier_amount") or 0)
        usarm_amt = float(r.get("usarm_amount") or 0)
        delta = usarm_amt - carrier_amt
        if gaps_only and delta <= 0:
            continue
        normalized.append({
            "item": r.get("checklist_desc") or r.get("usarm_desc") or r.get("carrier_desc") or "Unknown",
            "carrier_amount": carrier_amt,
            "usarm_amount": usarm_amt,
            "delta": delta,
            "status": r.get("status"),
            "note": r.get("note") or r.get("notes"),
        })

    normalized.sort(key=lambda x: x["delta"], reverse=True)
    total_gap = sum(r["delta"] for r in normalized if r["delta"] > 0)

    return {
        "action": "complete",
        "type": "scope_comparison",
        "data": {
            "rows": normalized[:limit],
            "total_gap": round(total_gap, 2),
            "row_count": len(normalized),
            "truncated": len(normalized) > limit,
        },
        "message": (
            f"{len(normalized)} row{'s' if len(normalized) != 1 else ''} — "
            f"${total_gap:,.2f} in gaps."
        ),
    }


def _handle_get_carrier_playbook(claim_data: dict) -> dict:
    """Return the carrier playbook markdown, if available."""
    carrier = (claim_data.get("carrier") or "").strip()
    if not carrier:
        return {
            "action": "complete",
            "type": "carrier_playbook",
            "data": {"carrier": None, "playbook": None},
            "message": "No carrier on this claim.",
        }

    # Reuse the existing loader (file-based on Railway).
    try:
        from main import _load_carrier_playbook  # type: ignore
        playbook = _load_carrier_playbook(carrier) or ""
    except Exception:
        playbook = ""

    if not playbook:
        return {
            "action": "complete",
            "type": "carrier_playbook",
            "data": {"carrier": carrier, "playbook": None},
            "message": f"No playbook on file for {carrier}.",
        }

    return {
        "action": "complete",
        "type": "carrier_playbook",
        "data": {"carrier": carrier, "playbook": playbook[:8000]},
        "message": f"Loaded {carrier} playbook ({len(playbook)} chars).",
    }


def _handle_lookup_xactimate_price(claim_data: dict, tool_input: dict) -> dict:
    """Look up an Xactimate price for a line item description."""
    description = (tool_input.get("description") or "").strip()
    if not description:
        return {"action": "error", "message": "description is required"}

    explicit_state = (tool_input.get("state") or "").strip().upper()
    resolved_state = explicit_state or _claim_state(claim_data)
    if not resolved_state:
        return {
            "action": "complete",
            "type": "xactimate_price",
            "data": {"description": description, "state": None, "match": None},
            "message": "State unknown for this claim — pass state explicitly to avoid misrouted pricing.",
        }

    try:
        from xactimate_lookup import XactRegistry
        reg = XactRegistry()
        match = reg.lookup_price(description)
    except Exception as e:
        return {"action": "error", "message": f"Xactimate registry unavailable: {e}"}

    if not match:
        return {
            "action": "complete",
            "type": "xactimate_price",
            "data": {"description": description, "state": resolved_state, "match": None},
            "message": f"No Xactimate match found for '{description}'.",
        }

    # Canonical registry shape (verified in xactimate_prices.json): xact_code, action,
    # description, unit, unit_price. Older/alias shapes may use price or install_price.
    code = match.get("xact_code") or match.get("code") or ""
    raw_price = (
        match.get("unit_price")
        or match.get("install_price")
        or match.get("price")
        or 0
    )
    try:
        price = float(raw_price or 0)
    except (TypeError, ValueError):
        price = 0.0
    unit = match.get("unit") or "unit"

    return {
        "action": "complete",
        "type": "xactimate_price",
        "data": {
            "description": description,
            "state": resolved_state,
            "match": {
                **match,
                "code": code,
                "price": price,
                "unit": unit,
            },
        },
        "message": f"Found: {code or description} — ${price:.2f}/{unit}",
    }


def _handle_get_noaa_weather(claim_data: dict, tool_input: dict) -> dict:
    """Query NOAA for storm events near the claim around its date of loss.

    NOAAClient.query(lat, lon, date_of_loss, address="") uses its own internal
    date window — the window_days input parameter is accepted in the tool schema
    for forward-compatibility but is not passed through. Document this in the
    response so Claude doesn't lie about a custom window being applied.
    """
    dol = claim_data.get("date_of_loss") or ""
    if not dol:
        return {
            "action": "complete",
            "type": "noaa_weather",
            "data": {"events": [], "reason": "no_date_of_loss"},
            "message": "No date of loss on this claim — cannot query NOAA.",
        }

    lat = claim_data.get("lat") or claim_data.get("latitude")
    lon = claim_data.get("lng") or claim_data.get("lon") or claim_data.get("longitude")
    if lat is None or lon is None:
        return {
            "action": "complete",
            "type": "noaa_weather",
            "data": {"events": [], "reason": "no_geocode"},
            "message": "Claim is not geocoded — reprocess to geocode it, then ask again.",
        }

    try:
        from noaa_weather.api import NOAAClient
        client = NOAAClient()
        data = client.query(
            float(lat),
            float(lon),
            str(dol),
            address=claim_data.get("address", "") or "",
        )
    except Exception as e:
        return {"action": "error", "message": f"NOAA query failed: {e}"}

    # data may be a NOAAStormData with .events, or a list — normalize.
    events_raw = []
    if hasattr(data, "events"):
        events_raw = data.events or []
    elif isinstance(data, list):
        events_raw = data
    elif isinstance(data, dict):
        events_raw = data.get("events") or []

    events = []
    for e in events_raw[:15]:
        if hasattr(e, "to_summary"):
            events.append(e.to_summary())
        elif hasattr(e, "to_dict"):
            events.append(e.to_dict())
        elif isinstance(e, dict):
            events.append(e)

    return {
        "action": "complete",
        "type": "noaa_weather",
        "data": {
            "events": events,
            "date_of_loss": dol,
            "total": len(events),
        },
        "message": f"{len(events)} NOAA storm event{'s' if len(events) != 1 else ''} near {dol}.",
    }


def _handle_search_photos(sb: Client, claim_id: str, tool_input: dict) -> dict:
    """Search the claim's photos by damage_type / material / trade / severity."""
    query = sb.table("photos").select(
        "annotation_key, annotation_text, damage_type, material, trade, severity"
    ).eq("claim_id", claim_id)

    damage_type = tool_input.get("damage_type")
    material = tool_input.get("material")
    trade = tool_input.get("trade")
    severity = tool_input.get("severity")

    if damage_type:
        query = query.eq("damage_type", damage_type)
    if material:
        query = query.eq("material", material)
    if trade:
        query = query.eq("trade", trade)
    if severity:
        query = query.eq("severity", severity)

    limit = int(tool_input.get("limit") or 20)
    result = query.limit(limit).execute()
    photos = result.data or []

    return {
        "action": "complete",
        "type": "photo_search",
        "data": {
            "photos": photos,
            "total": len(photos),
            "filters": {
                "damage_type": damage_type,
                "material": material,
                "trade": trade,
                "severity": severity,
            },
        },
        "message": f"{len(photos)} photo{'s' if len(photos) != 1 else ''} matched.",
    }


def _handle_get_damage_scores(claim_data: dict) -> dict:
    """Return damage score + approval score + grade."""
    ds = claim_data.get("damage_score")
    tas = claim_data.get("approval_score")
    ds_grade = claim_data.get("damage_grade") or ""
    tas_grade = claim_data.get("approval_grade") or ""
    if ds is None and tas is None:
        return {
            "action": "complete",
            "type": "damage_scores",
            "data": {"damage_score": None, "approval_score": None},
            "message": "No scores computed yet. Reprocess the claim to generate them.",
        }

    return {
        "action": "complete",
        "type": "damage_scores",
        "data": {
            "damage_score": ds,
            "damage_grade": ds_grade,
            "approval_score": tas,
            "approval_grade": tas_grade,
            "photo_integrity": claim_data.get("photo_integrity") or {},
        },
        "message": f"DS: {ds} ({ds_grade}) | TAS: {tas} ({tas_grade})",
    }


# ═══════════════════════════════════════════
# R2 — CLASSIFY UPLOADED FILE
# ═══════════════════════════════════════════

async def _handle_classify_uploaded_file(sb: Client, claim_id: str, tool_input: dict) -> dict:
    """
    Claude Vision classifies a user-uploaded file into one of:
      AOB, COC, CARRIER_SCOPE, EAGLEVIEW, SUPPLEMENT_RESPONSE, CONTRACT, PHOTO, OTHER
    """
    storage_path = (tool_input.get("storage_path") or "").strip()
    filename = tool_input.get("filename") or storage_path.rsplit("/", 1)[-1] if storage_path else ""
    if not storage_path:
        return {"action": "error", "message": "storage_path is required"}

    # Download file from Supabase Storage
    try:
        file_bytes = sb.storage.from_("claim-documents").download(storage_path)
    except Exception as e:
        return {"action": "error", "message": f"Failed to download file: {e}"}

    if not file_bytes:
        return {"action": "error", "message": "Empty file downloaded."}

    # Determine media type from extension
    lower = (filename or storage_path).lower()
    is_pdf = lower.endswith(".pdf")
    is_image = any(lower.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"))

    import anthropic
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    # Build multimodal content for Vision
    b64 = base64.standard_b64encode(file_bytes).decode("utf-8")
    if is_pdf:
        doc_block = {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": b64},
        }
    elif is_image:
        media = "image/jpeg"
        if lower.endswith(".png"): media = "image/png"
        elif lower.endswith(".webp"): media = "image/webp"
        doc_block = {
            "type": "image",
            "source": {"type": "base64", "media_type": media, "data": b64},
        }
    else:
        # Unsupported file — classify by filename only
        return _classify_by_filename(filename or storage_path, storage_path)

    classify_prompt = (
        "You are classifying a document for an insurance claim workflow. "
        "Identify which ONE of these categories this document is:\n\n"
        "- AOB: Assignment of Benefits (signed or unsigned)\n"
        "- COC: Certificate of Completion / Completion certificate\n"
        "- CARRIER_SCOPE: Insurance carrier's estimate or adjuster report (Xactimate/ESX/PDF)\n"
        "- EAGLEVIEW: EagleView / Hover measurement report\n"
        "- SUPPLEMENT_RESPONSE: A carrier email or letter responding to a prior supplement\n"
        "- CONTRACT: Homeowner/contractor agreement (scope of work)\n"
        "- PHOTO: A damage photograph\n"
        "- OTHER: Anything else\n\n"
        "Respond with ONLY a JSON object, no prose. Schema:\n"
        "{\"classification\": \"<CATEGORY>\", \"confidence\": 0.0-1.0, "
        "\"signals\": [\"short evidence 1\", \"short evidence 2\"], "
        "\"suggested_action\": \"one-sentence next step\"}"
    )

    # Matches the model used elsewhere in this backend (processor, carrier_analyst,
    # repair_processor, main.py chat) so billing/quota behave predictably.
    primary_model = os.environ.get("CLAIM_BRAIN_VISION_MODEL", "claude-opus-4-6")
    fallback_model = "claude-sonnet-4-6"

    def _call_vision(model_name: str):
        return client.messages.create(
            model=model_name,
            max_tokens=512,
            messages=[{
                "role": "user",
                "content": [
                    doc_block,
                    {"type": "text", "text": classify_prompt},
                ],
            }],
        )

    try:
        msg = _call_vision(primary_model)
    except Exception as e_primary:
        try:
            msg = _call_vision(fallback_model)
        except Exception as e_fallback:
            return {
                "action": "error",
                "message": f"Vision classification failed. Primary ({primary_model}): {e_primary}. Fallback ({fallback_model}): {e_fallback}",
            }

    raw_text = ""
    for block in msg.content:
        if getattr(block, "type", None) == "text":
            raw_text += block.text

    # Extract JSON (model sometimes wraps in markdown)
    parsed: dict[str, Any] = {}
    try:
        raw_stripped = raw_text.strip()
        if raw_stripped.startswith("```"):
            # strip fences
            raw_stripped = raw_stripped.split("```", 2)[1]
            if raw_stripped.startswith("json"):
                raw_stripped = raw_stripped[4:]
            raw_stripped = raw_stripped.strip("`").strip()
        parsed = json.loads(raw_stripped)
    except Exception:
        # Last-ditch: look for a brace-enclosed section
        import re
        m = re.search(r"\{.*\}", raw_text, re.DOTALL)
        if m:
            try:
                parsed = json.loads(m.group(0))
            except Exception:
                parsed = {}

    classification = (parsed.get("classification") or "OTHER").upper()
    confidence = float(parsed.get("confidence") or 0.0)
    signals = parsed.get("signals") or []
    suggested_action = parsed.get("suggested_action") or ""

    return {
        "action": "complete",
        "type": "file_classification",
        "data": {
            "storage_path": storage_path,
            "filename": filename,
            "classification": classification,
            "confidence": confidence,
            "signals": signals,
            "suggested_action": suggested_action,
            "low_confidence": confidence < 0.9,
        },
        "message": (
            f"Classified '{filename or 'file'}' as {classification} "
            f"({int(confidence * 100)}% confidence)."
        ),
    }


# ═══════════════════════════════════════════
# R3 + R4 — DESTRUCTIVE WRITE PREVIEWS
#
# Each tool here returns `action: "preview"` with a `tool_name` + `tool_input`
# snapshot. Nothing is executed until the frontend POSTs to the approve-action
# endpoint, which dispatches to the corresponding execute_* function in main.py.
# ═══════════════════════════════════════════

_DOC_TYPE_TO_COLUMN = {
    "AOB": "aob_files",
    "COC": "coc_files",
    "CARRIER_SCOPE": "scope_files",
    "EAGLEVIEW": "measurement_files",
    "CONTRACT": "other_files",
    "PHOTO": "photo_files",
    "SUPPLEMENT_RESPONSE": "other_files",
    "OTHER": "other_files",
}


def _handle_preview_attach_to_claim(claim_data: dict, tool_input: dict) -> dict:
    storage_path = (tool_input.get("storage_path") or "").strip()
    doc_type = (tool_input.get("doc_type") or "").strip().upper()
    filename = tool_input.get("filename") or storage_path.rsplit("/", 1)[-1]
    confidence = tool_input.get("classification_confidence")

    if not storage_path or not doc_type:
        return {"action": "error", "message": "storage_path and doc_type are required."}

    if doc_type not in _DOC_TYPE_TO_COLUMN:
        return {"action": "error", "message": f"Unsupported doc_type: {doc_type}"}

    # Safety gate — refuse to attach when classification confidence is low.
    # When confidence isn't provided we err on the side of allowing (Claude might
    # be calling this from a user-verified context), but we flag it in the preview.
    if confidence is not None:
        try:
            if float(confidence) < 0.9:
                return {
                    "action": "error",
                    "message": (
                        f"Classification confidence {confidence} is below 0.9 — ask the user "
                        f"to confirm the document type before attaching. Do not call this tool "
                        f"again until the user explicitly confirms."
                    ),
                }
        except (TypeError, ValueError):
            pass

    return {
        "action": "preview",
        "type": "attach_to_claim",
        "tool_name": "attach_to_claim",
        "preview": {
            "action_label": "Attach to Claim",
            "doc_type": doc_type,
            "column": _DOC_TYPE_TO_COLUMN[doc_type],
            "filename": filename,
            "storage_path": storage_path,
            "claim_address": claim_data.get("address"),
            "classification_confidence": confidence,
        },
        "message": f"Ready to attach {filename} as {doc_type} on this claim.",
    }


def _handle_preview_trigger_reprocess(claim_data: dict, tool_input: dict) -> dict:
    reason = (tool_input.get("reason") or "").strip()
    return {
        "action": "preview",
        "type": "trigger_reprocess",
        "tool_name": "trigger_reprocess",
        "preview": {
            "action_label": "Reprocess Claim",
            "reason": reason,
            "claim_address": claim_data.get("address"),
            "estimated_duration_seconds": 90,
            "regenerates": [
                "Photo annotations",
                "Estimate + line items",
                "Scope comparison",
                "Damage / approval scores",
                "PDF documents",
            ],
        },
        "message": f"Ready to reprocess this claim. Reason: {reason or 'not specified'}.",
    }


def _resolve_claim_number_or_error(claim_data: dict) -> Optional[str]:
    """Return the claim number or None. Carrier sends without a claim number
    must fail loudly — CLAUDE.md rule, State Farm + others auto-reject.
    """
    cn = (claim_data.get("claim_number") or "").strip()
    if cn:
        return cn
    prev = claim_data.get("previous_carrier_data") or {}
    if isinstance(prev, dict):
        cn = (prev.get("claim_number") or "").strip()
        if cn:
            return cn
    return None


def _handle_preview_send_to_carrier(claim_data: dict, tool_input: dict) -> dict:
    to_email = (tool_input.get("to_email") or "").strip()
    cc = tool_input.get("cc") or None
    body_html = tool_input.get("body_html") or ""
    attachment_paths = tool_input.get("attachment_paths") or []

    if not to_email:
        return {"action": "error", "message": "to_email is required"}
    if not body_html:
        return {"action": "error", "message": "body_html is required"}

    claim_number = _resolve_claim_number_or_error(claim_data)
    if not claim_number:
        return {
            "action": "error",
            "message": (
                "Claim number missing — every carrier email MUST have the claim number as "
                "the subject. Ask the user for it before calling this tool again."
            ),
        }

    return {
        "action": "preview",
        "type": "send_to_carrier",
        "tool_name": "send_to_carrier",
        "preview": {
            "action_label": "Send to Carrier",
            "to_email": to_email,
            "cc": cc,
            "subject": claim_number,  # platform rule
            "body_html": body_html,
            "attachment_paths": list(attachment_paths),
            "attachment_count": len(attachment_paths),
            "claim_address": claim_data.get("address"),
            "carrier": claim_data.get("carrier"),
        },
        "message": f"Ready to send to {to_email} with {len(attachment_paths)} attachment{'s' if len(attachment_paths) != 1 else ''}.",
    }


def _handle_preview_schedule_cadence(claim_data: dict, tool_input: dict) -> dict:
    cadence_type = (tool_input.get("cadence_type") or "").strip()
    to_email = (tool_input.get("to_email") or "").strip()
    cc = tool_input.get("cc") or None
    days = tool_input.get("days") or []
    attachment_paths = tool_input.get("attachment_paths") or []

    if not cadence_type or not to_email or not days:
        return {"action": "error", "message": "cadence_type, to_email, and days are required"}

    try:
        days_int = [int(d) for d in days if d is not None]
    except (TypeError, ValueError):
        return {"action": "error", "message": "days must be a list of integers"}
    if not days_int:
        return {"action": "error", "message": "days must contain at least one offset"}

    claim_number = _resolve_claim_number_or_error(claim_data)
    if not claim_number:
        return {
            "action": "error",
            "message": "Cadence follow-ups require a claim number. Ask the user before scheduling.",
        }

    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    schedule = [
        {
            "followup_number": i + 1,
            "offset_days": d,
            "scheduled_at": (now + timedelta(days=d)).isoformat(),
        }
        for i, d in enumerate(days_int)
    ]

    return {
        "action": "preview",
        "type": "schedule_follow_up_cadence",
        "tool_name": "schedule_follow_up_cadence",
        "preview": {
            "action_label": "Schedule Follow-Ups",
            "cadence_type": cadence_type,
            "to_email": to_email,
            "cc": cc,
            "subject": claim_number,
            "days": days_int,
            "schedule": schedule,
            "attachment_paths": list(attachment_paths),
            "claim_address": claim_data.get("address"),
            "carrier": claim_data.get("carrier"),
        },
        "message": f"Ready to schedule {len(days_int)} follow-up{'s' if len(days_int) != 1 else ''} at days {days_int}.",
    }


def _handle_preview_cancel_cadence(sb: Client, claim_id: str, tool_input: dict) -> dict:
    reason = (tool_input.get("reason") or "").strip() or "no reason provided"
    # Count pending sends so the preview shows what will be cancelled
    try:
        res = sb.table("claim_brain_cadence_sends").select(
            "id", count="exact"
        ).eq("claim_id", claim_id).eq("status", "pending").execute()
        pending_count = res.count or 0
    except Exception:
        pending_count = 0

    return {
        "action": "preview",
        "type": "cancel_cadence",
        "tool_name": "cancel_cadence",
        "preview": {
            "action_label": "Cancel Pending Follow-Ups",
            "reason": reason,
            "pending_count": pending_count,
        },
        "message": f"Ready to cancel {pending_count} pending follow-up{'s' if pending_count != 1 else ''}. Reason: {reason}.",
    }


def _classify_by_filename(filename: str, storage_path: str) -> dict:
    """Fallback classifier when we can't use Vision (unsupported file type)."""
    lower = filename.lower()
    classification = "OTHER"
    if "aob" in lower or "assignment" in lower:
        classification = "AOB"
    elif "coc" in lower or "completion" in lower:
        classification = "COC"
    elif "eagleview" in lower or "measure" in lower or "hover" in lower:
        classification = "EAGLEVIEW"
    elif "estimate" in lower or "scope" in lower or "xactimate" in lower:
        classification = "CARRIER_SCOPE"
    elif "contract" in lower:
        classification = "CONTRACT"

    return {
        "action": "complete",
        "type": "file_classification",
        "data": {
            "storage_path": storage_path,
            "filename": filename,
            "classification": classification,
            "confidence": 0.5,
            "signals": ["filename-based fallback — unsupported file type for Vision"],
            "suggested_action": "Verify classification with user before taking action.",
            "low_confidence": True,
        },
        "message": f"Classified '{filename}' as {classification} by filename (low confidence).",
    }
