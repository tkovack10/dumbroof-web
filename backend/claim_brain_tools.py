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
    {
        "name": "coach_photo_documentation",
        "description": (
            "Analyze the current photo set for this claim and return specific, "
            "actionable coaching instructions to strengthen the evidence before "
            "sending to the carrier. Identifies gaps in the documentation against "
            "the forensic photo checklist (test squares, chalk-contrast flashings, "
            "labeled elevations, scale-reference close-ups, etc.) and returns step-"
            "by-step instructions for each missing item. Use when the user asks "
            "'what photos am I missing?', 'how do I document this better?', 'what "
            "else should I photograph?', or whenever damage_score is below 70."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "focus_area": {
                    "type": "string",
                    "enum": ["roof", "siding", "gutters", "flashing", "interior", "all"],
                    "description": "Limit coaching to one area. Default 'all'.",
                    "default": "all",
                },
            },
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
    # Line item surgery (approval-gated for mutations)
    # ─────────────────────────────────────────────
    {
        "name": "list_line_items",
        "description": (
            "Return the current line items on this claim's estimate. Use before proposing "
            "add_line_item / remove_line_item / modify_line_item so you know exact line IDs "
            "and current quantities. Filter by source ('usarm' = contractor, 'carrier', "
            "'user_added' = previously added by a user through Richard)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "source": {
                    "type": "string",
                    "enum": ["usarm", "carrier", "user_added", "all"],
                    "description": "Filter by source. 'all' returns everything.",
                    "default": "usarm",
                },
                "trade": {"type": "string", "description": "Optional trade filter (roofing, siding, gutters, etc)."},
                "limit": {"type": "integer", "description": "Max rows. Default 50.", "default": 50},
            },
            "required": [],
        },
    },
    {
        "name": "add_line_item",
        "description": (
            "Add a new line item to the claim's estimate. Survives reprocess (stored with "
            "source='user_added'). Use when the carrier's scope or contractor's estimate is "
            "missing an item that should be there. REQUIRES USER APPROVAL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "description": {"type": "string", "description": "Full line item description, e.g. 'R&R Step flashing - 5 inch'."},
                "qty": {"type": "number", "description": "Quantity."},
                "unit": {"type": "string", "description": "Unit (LF, SF, SQ, EA, etc.)."},
                "unit_price": {"type": "number", "description": "Price per unit."},
                "category": {
                    "type": "string",
                    "enum": ["ROOFING", "SIDING", "GUTTERS", "FLASHING", "EXTERIOR", "INTERIOR", "CODE", "MANUFACTURER_INSTALL", "LABOR", "GENERAL"],
                    "description": "Category. Default GENERAL.",
                },
                "xactimate_code": {"type": "string", "description": "Xactimate code if known, e.g. 'RFG STEP'."},
                "trade": {"type": "string", "description": "Trade: roofing, siding, gutters, etc."},
                "reason": {"type": "string", "description": "Why this item should be added — code citation, evidence, or missing-item rationale."},
            },
            "required": ["description", "qty", "unit", "unit_price", "reason"],
        },
    },
    {
        "name": "remove_line_item",
        "description": (
            "Exclude a line item from the claim's estimate. Adds to claims.excluded_line_items "
            "which survives reprocess. Use when the carrier included something that shouldn't "
            "be there (wrong material, duplicate line, etc.). REQUIRES USER APPROVAL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "line_item_id": {"type": "string", "description": "UUID from list_line_items."},
                "reason": {"type": "string", "description": "Why this item is being excluded."},
            },
            "required": ["line_item_id", "reason"],
        },
    },
    {
        "name": "modify_line_item",
        "description": (
            "Change quantity and/or unit_price on a line item. Writes line_item_feedback which "
            "survives reprocess and also trains the platform. Use for quantity disputes or "
            "pricing corrections. REQUIRES USER APPROVAL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "line_item_id": {"type": "string", "description": "UUID from list_line_items."},
                "qty": {"type": "number", "description": "Corrected quantity."},
                "unit_price": {"type": "number", "description": "Corrected unit price."},
                "reason": {"type": "string", "description": "Why this change is needed."},
            },
            "required": ["line_item_id", "reason"],
        },
    },
    {
        "name": "recompute_estimate",
        "description": (
            "Recalculate the claim's contractor_rcv + variance from the current line_items "
            "table. Faster than trigger_reprocess (no photo/PDF regen) — useful right after "
            "add/remove/modify operations. REQUIRES USER APPROVAL."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
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
        elif tool_name == "coach_photo_documentation":
            result = _handle_coach_photo_documentation(sb, claim_id, claim_data, tool_input)
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
        # ─── Line item surgery ──────────────────────
        elif tool_name == "list_line_items":
            result = _handle_list_line_items(sb, claim_id, tool_input)
        elif tool_name == "add_line_item":
            result = _handle_preview_add_line_item(tool_input, sb=sb, claim_id=claim_id)
        elif tool_name == "remove_line_item":
            result = _handle_preview_remove_line_item(sb, claim_id, tool_input)
        elif tool_name == "modify_line_item":
            result = _handle_preview_modify_line_item(sb, claim_id, tool_input)
        elif tool_name == "recompute_estimate":
            result = _handle_preview_recompute_estimate(sb, claim_id)
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


# ═══════════════════════════════════════════
# PHOTO DOCUMENTATION COACHING
# ═══════════════════════════════════════════

# Forensic photo playbook — the "standard of evidence" that maximizes carrier
# approval. Each entry checks the current photo set for a specific technique
# and, if missing, returns a coaching step with the exact instruction.
#
# Richard calls coach_photo_documentation and this engine tells the user
# EXACTLY what to shoot (including technique), not just "take more photos".


def _photo_matches_any(photo: dict, keywords: list[str]) -> bool:
    haystack = " ".join([
        str(photo.get("annotation_text") or ""),
        str(photo.get("damage_type") or ""),
        str(photo.get("material") or ""),
        str(photo.get("trade") or ""),
        str(photo.get("annotation_key") or ""),
    ]).lower()
    return any(kw in haystack for kw in keywords)


def _count_by_keywords(photos: list[dict], keywords: list[str]) -> int:
    return sum(1 for p in photos if _photo_matches_any(p, keywords))


def _analyze_photo_coverage(photos: list[dict], focus: str, claim_data: dict) -> dict:
    """Build a coverage report from the claim's photo set."""
    total = len(photos)

    # Elevation coverage — overview shots of each side
    has_front = _count_by_keywords(photos, ["front elevation", "front overview", "facade"])
    has_rear = _count_by_keywords(photos, ["rear elevation", "back elevation", "rear overview"])
    has_left = _count_by_keywords(photos, ["left elevation", "left side"])
    has_right = _count_by_keywords(photos, ["right elevation", "right side"])
    elevations_covered = sum(1 for x in [has_front, has_rear, has_left, has_right] if x > 0)

    # Slope coverage
    slope_photos = _count_by_keywords(photos, ["slope", "roof overview", "shingle"])

    # Test square evidence — a high-value documentation technique that most
    # contractors skip. Carriers explicitly ask for these (State Farm + Liberty).
    test_squares = _count_by_keywords(
        photos, ["test square", "10x10", "10 x 10", "10'x10'", "chalk circle", "marked hits"]
    )

    # Chalk-contrast flashings
    chalk_flashing = sum(
        1 for p in photos
        if _photo_matches_any(p, ["flashing"]) and _photo_matches_any(p, ["chalk", "chalked"])
    )

    # Scale reference in close-ups (quarter / ruler / tape measure)
    scale_refs = _count_by_keywords(photos, ["quarter", "coin", "ruler", "tape measure", "scale"])

    # Flashings generally
    chimney_flashing = _count_by_keywords(photos, ["chimney"])
    step_flashing = _count_by_keywords(photos, ["step flashing"])
    valley_photos = _count_by_keywords(photos, ["valley"])

    # Siding
    siding_photos = _count_by_keywords(photos, ["siding", "vinyl", "aluminum siding", "cedar"])

    # Gutters
    gutter_photos = _count_by_keywords(photos, ["gutter", "downspout"])

    # Interior / attic
    interior_photos = _count_by_keywords(photos, ["interior", "ceiling", "drywall", "attic"])

    # Hail / wind close-ups
    hail_close = _count_by_keywords(photos, ["hail", "bruise", "granule loss"])
    wind_close = _count_by_keywords(photos, ["wind", "creased", "lifted", "missing shingle"])

    # ── Forensic-level plays (the stuff carriers can't argue with) ──

    # Nail head photos — wind-claim killer. Unrusted nails = recent wind event.
    # Rusted nails under a "missing shingle" = shingle was gone before the storm.
    nail_head_photos = _count_by_keywords(
        photos, ["nail head", "nail heads", "shiny nail", "unrusted nail", "exposed nail", "nail bright"]
    )

    # Brittle test — the repairability death-sentence argument. If shingle
    # cracks when bent, spot-repair is impossible, full replacement required.
    brittle_test_photos = _count_by_keywords(
        photos, ["brittle", "brittle test", "cracked when bent", "shingle cracked", "snap test"]
    )

    # Shingle exposure measurement — a 5" exposure = discontinued product =
    # full roof replacement argument (matching statute / NAIC MDL-902).
    # Tom's rule (MEMORY): 5" exposure is unrepairable.
    exposure_measurement_photos = _count_by_keywords(
        photos, ["exposure", "tape measure on shingle", "5 inch exposure", '5" exposure', "reveal measurement"]
    )

    # Manufacturer stamp / batch code — proves age and ties to discontinuation
    manufacturer_stamp_photos = _count_by_keywords(
        photos, ["manufacturer stamp", "batch code", "shingle stamp", "back of shingle", "backside shingle"]
    )

    # Mat exposure — thermal splitting, proves shingle is compromised beyond hail marks
    mat_exposure_photos = _count_by_keywords(
        photos, ["mat exposure", "mat exposed", "thermal split", "shingle mat"]
    )

    # Granule embedment brush-off — handheld brush to show how much granule loss
    granule_test_photos = _count_by_keywords(
        photos, ["granule test", "brush off", "granule loss close", "granule embedment"]
    )

    # Sheathing / attic shots — interior proof of exterior penetration
    sheathing_photos = _count_by_keywords(
        photos, ["sheathing", "decking", "plywood", "osb", "attic underside"]
    )

    # Soft-metal collateral — chalk tests on gutters/downspouts/fascia/
    # aluminum siding/window wraps/mailbox. Hail's fingerprint is all over
    # soft metals; chalk makes dents readable. Different from flashing chalk.
    soft_metal_chalk_photos = sum(
        1 for p in photos
        if _photo_matches_any(p, [
            "gutter", "downspout", "mailbox", "window wrap", "fascia",
            "aluminum siding", "soft metal", "condenser", "ac unit",
        ]) and _photo_matches_any(p, ["chalk", "chalked"])
    )
    # Track whether any soft-metal close-ups exist at all (chalked or not)
    soft_metal_photos = _count_by_keywords(
        photos, ["mailbox", "window wrap", "fascia", "aluminum siding", "condenser", "ac unit"]
    )

    # Screen damage — holes/tears in window/door/porch screens is
    # direct hail-impact evidence that can't be dismissed as age.
    screen_photos = _count_by_keywords(
        photos, ["screen", "window screen", "door screen", "porch screen", "torn screen", "screen hole"]
    )

    # Hail splatter — impact-direction marks on painted surfaces,
    # wood, asphalt driveway, concrete, decks. Shows storm direction + size.
    splatter_photos = _count_by_keywords(
        photos, ["splatter", "splash mark", "splat", "impact mark", "pock mark", "driveway hit"]
    )

    # ── Infer damage type from scope_comparison + photos ──
    scope_rows = claim_data.get("scope_comparison") or []
    scope_text = " ".join(
        str(r.get("checklist_desc", "") or "") + " " + str(r.get("usarm_desc", "") or "") + " " + str(r.get("carrier_desc", "") or "")
        for r in scope_rows if isinstance(r, dict)
    ).lower()
    photo_damage_types = " ".join(str(p.get("damage_type", "") or "") for p in photos).lower()
    combined = scope_text + " " + photo_damage_types
    is_wind_claim = any(kw in combined for kw in ["wind", "creased", "lifted", "missing shingle"])
    is_hail_claim = any(kw in combined for kw in ["hail", "bruise", "granule"])

    return {
        "total_photos": total,
        "elevations_covered": elevations_covered,  # 0-4
        "slope_photos": slope_photos,
        "test_squares": test_squares,
        "chalk_flashing": chalk_flashing,
        "scale_refs": scale_refs,
        "chimney_flashing": chimney_flashing,
        "step_flashing": step_flashing,
        "valley_photos": valley_photos,
        "siding_photos": siding_photos,
        "gutter_photos": gutter_photos,
        "interior_photos": interior_photos,
        "hail_close": hail_close,
        "wind_close": wind_close,
        # forensic plays
        "nail_head_photos": nail_head_photos,
        "brittle_test_photos": brittle_test_photos,
        "exposure_measurement_photos": exposure_measurement_photos,
        "manufacturer_stamp_photos": manufacturer_stamp_photos,
        "mat_exposure_photos": mat_exposure_photos,
        "granule_test_photos": granule_test_photos,
        "sheathing_photos": sheathing_photos,
        "soft_metal_chalk_photos": soft_metal_chalk_photos,
        "soft_metal_photos": soft_metal_photos,
        "screen_photos": screen_photos,
        "splatter_photos": splatter_photos,
        # damage type inference
        "is_wind_claim": is_wind_claim,
        "is_hail_claim": is_hail_claim,
    }


def _generate_coaching_steps(coverage: dict, claim_data: dict, focus: str) -> list[dict]:
    """For each gap in coverage, emit a step with a concrete instruction."""
    steps: list[dict] = []
    show_all = focus == "all"

    # Elevations — critical baseline
    if (show_all or focus == "roof") and coverage["elevations_covered"] < 4:
        missing = 4 - coverage["elevations_covered"]
        steps.append({
            "title": "Cover all 4 elevations",
            "importance": "critical",
            "area": "roof",
            "instruction": (
                f"Missing {missing} elevation overview shot(s). Stand 15-20 feet back from "
                "each side of the house and capture a ground-level photo showing the full "
                "facade + roof edge. Label each photo by direction: front / rear / left / right. "
                "Carriers use these as the baseline map for every other photo."
            ),
            "damage_score_impact": f"+{missing * 3} points",
        })

    # Test squares — the highest-leverage missing technique
    if (show_all or focus == "roof") and coverage["test_squares"] == 0:
        steps.append({
            "title": "Mark test squares on each damaged slope",
            "importance": "critical",
            "area": "roof",
            "instruction": (
                "On each damaged slope, mark a 10×10 ft test square with chalk. "
                "Shoot THREE photos per square:\n"
                "  1. **Wide overview** of the square showing its location on the slope. "
                "Use chalk to draw the square outline.\n"
                "  2. **Marked damage**: circle every hail/wind hit inside the square with "
                "chalk. Shoot directly above.\n"
                "  3. **Close-up with scale**: pick the worst hit in the square, place a "
                "quarter next to it, shoot from 12 inches away.\n"
                "Write on a slate in the first photo: *\"Rear slope, H = [height] ft, W = "
                "[width] ft\"* so the carrier can't dispute location."
            ),
            "damage_score_impact": "+15 points",
        })

    # Chalk-contrast flashings
    if (show_all or focus == "flashing") and coverage["chalk_flashing"] == 0:
        steps.append({
            "title": "Chalk-contrast the flashings",
            "importance": "high",
            "area": "flashing",
            "instruction": (
                "Flashing dents and creases are nearly invisible in photos without contrast. "
                "Rub chalk horizontally across each flashing surface — the chalk fills every "
                "indentation and makes damage visible. Sequence:\n"
                "  1. **Before**: wide shot of flashing location\n"
                "  2. **Apply chalk**: run chalk across the metal\n"
                "  3. **After**: close-up showing every chalked dent, with a ruler or quarter "
                "for scale\n"
                "Do this on: chimney flashing (all 4 sides), step flashing, counter flashing, "
                "valley flashing, and drip edge."
            ),
            "damage_score_impact": "+10 points",
        })

    # Scale references in close-ups
    if coverage["scale_refs"] < 3 and coverage["total_photos"] >= 5:
        steps.append({
            "title": "Add scale reference to close-up damage photos",
            "importance": "high",
            "area": "all",
            "instruction": (
                "Every close-up of damage needs a scale reference — quarter, ruler, or "
                "tape measure — or the carrier will call the damage 'unmeasurable' and "
                "discount it. For each hail bruise or wind-damaged shingle, place a quarter "
                "in-frame and re-shoot from 12 inches away. Aim for 5+ scale-referenced "
                "close-ups across the claim."
            ),
            "damage_score_impact": "+8 points",
        })

    # Chimney — carriers almost always scope this low
    if (show_all or focus == "flashing") and coverage["chimney_flashing"] < 2:
        steps.append({
            "title": "Document chimney fully (all 4 sides)",
            "importance": "medium",
            "area": "flashing",
            "instruction": (
                "Shoot the chimney from all 4 sides. For each side: wide shot of the flashing "
                "transition + close-up of the counter-flashing joint. If any side shows "
                "dented flashing or rust streaks, chalk-contrast it per the 'Chalk-contrast' "
                "step above. Carriers under-scope chimney work ~70% of the time."
            ),
            "damage_score_impact": "+5 points",
        })

    # Valleys
    if (show_all or focus == "roof") and coverage["valley_photos"] == 0 and coverage["slope_photos"] > 0:
        steps.append({
            "title": "Capture all valleys",
            "importance": "medium",
            "area": "roof",
            "instruction": (
                "For every valley: one full-length overview + one close-up at mid-span "
                "showing the ice-and-water barrier condition and any granule wash. Valleys "
                "are where carriers hide 'partial repair' arguments — full photo coverage "
                "kills that tactic."
            ),
            "damage_score_impact": "+4 points",
        })

    # Siding — only prompt if there's siding on the claim
    trade_count = int(claim_data.get("trade_count") or 0)
    if (show_all or focus == "siding") and coverage["siding_photos"] < 4 and trade_count >= 2:
        steps.append({
            "title": "Siding — every elevation",
            "importance": "high",
            "area": "siding",
            "instruction": (
                "Siding claims need: (a) overview of EACH elevation, (b) close-up of a hail "
                "hit or crack with a quarter for scale, (c) corner shots showing the house "
                "wrap behind the siding (if accessible) to document R703.2 compliance or "
                "violation. Also shoot window wraps, shutters (if present), and j-channel "
                "at corners."
            ),
            "damage_score_impact": "+8 points",
        })

    # Gutters
    if (show_all or focus == "gutters") and coverage["gutter_photos"] < 2:
        steps.append({
            "title": "Gutter damage close-ups",
            "importance": "medium",
            "area": "gutters",
            "instruction": (
                "Shoot gutter damage from below (shows dents) AND from above at roof level "
                "(shows the gutter apron / drip edge). Include end-caps and downspouts "
                "separately — carriers often scope gutters but forget end-caps and splash "
                "guards. Run chalk along dented sections for contrast."
            ),
            "damage_score_impact": "+4 points",
        })

    # Interior
    if (show_all or focus == "interior") and coverage["interior_photos"] == 0:
        steps.append({
            "title": "Check for interior damage",
            "importance": "low",
            "area": "interior",
            "instruction": (
                "If there's any ceiling staining, drywall damage, or attic leakage, "
                "document it: room overview + close-up of the stain + attic shot from "
                "underneath showing the sheathing. Interior damage is often the ONLY way "
                "to prove roof penetration when the carrier claims \"no visible exterior damage.\""
            ),
            "damage_score_impact": "+3 points if present",
        })

    # Hail close-ups — count-based
    if (show_all or focus == "roof") and coverage["is_hail_claim"] and coverage["hail_close"] < 5:
        steps.append({
            "title": "More hail-hit close-ups",
            "importance": "high",
            "area": "roof",
            "instruction": (
                "Hail claims need at least 5 close-ups of individual hits on shingles. "
                "Each should show: (a) the bruise or granule-loss hole, (b) a scale "
                "reference (quarter is ideal — hail is usually 1\"+). Shoot from directly "
                "above, 12 inches away. Vary hit sizes and locations across slopes."
            ),
            "damage_score_impact": "+10 points",
        })

    # ── Forensic-level plays ── (the moves adjusters can't counter)

    # SHINGLE EXPOSURE MEASUREMENT — the matching-argument nuclear option.
    # 5" exposure = discontinued manufacturer product = full roof replacement
    # per NAIC MDL-902 + policy like-kind-quality. One tape-measure photo
    # changes a spot-repair denial into a full-replacement approval.
    if (show_all or focus == "roof") and coverage["exposure_measurement_photos"] == 0 and coverage["slope_photos"] > 0:
        steps.append({
            "title": "Measure shingle exposure with tape — CRITICAL for matching argument",
            "importance": "critical",
            "area": "roof",
            "instruction": (
                "Put a tape measure vertically across 3 shingle courses to show the "
                "exposure (reveal). Shoot from directly above, close enough to read "
                "the tape clearly.\n\n"
                "**Why this matters:** 5-inch exposure shingles are DISCONTINUED by most "
                "manufacturers (modern laminates are 5⅝\"). If the measurement shows 5\", "
                "the product is unavailable and the carrier's spot-repair argument dies — "
                "matching under NAIC MDL-902 + policy like-kind-quality language requires "
                "full slope or full roof replacement. Tom's rule: **5\" = unrepairable.**\n\n"
                "Shoot one measurement per slope minimum. Include the tape + the shingle "
                "row + enough context to identify the slope."
            ),
            "damage_score_impact": "+20 points",
        })

    # BRITTLE TEST — repairability killer. Shingles that crack on bend
    # cannot be lifted to replace adjacent pieces. Forces full replacement.
    if (show_all or focus == "roof") and coverage["brittle_test_photos"] == 0 and coverage["slope_photos"] > 0:
        steps.append({
            "title": "Brittle test — prove repair is impossible",
            "importance": "high",
            "area": "roof",
            "instruction": (
                "Pick a sample shingle from the damaged slope and bend the tab 90 degrees. "
                "If it cracks, snaps, or can't lift without breaking, the shingle is brittle — "
                "which means adjacent shingles CAN'T be lifted during spot repair without "
                "also breaking. Repair is physically impossible.\n\n"
                "Photo sequence:\n"
                "  1. Shingle being bent (mid-bend, tab raised 45°+)\n"
                "  2. Close-up of the crack/snap line after release\n"
                "  3. Wide shot of the slope with the tested shingle's location labeled\n\n"
                "This is the argument that turns \"repair the damaged hip cap\" into "
                "\"replace the slope.\" Adjusters can't counter a physical-impossibility "
                "demonstration."
            ),
            "damage_score_impact": "+12 points",
        })

    # NAIL HEADS — wind-claim causation proof. Unrusted/shiny nails under
    # missing or severely creased shingles = recent wind event, not age.
    if (show_all or focus == "roof") and coverage["is_wind_claim"] and coverage["nail_head_photos"] == 0:
        steps.append({
            "title": "Photograph exposed nail heads — proves recent wind damage",
            "importance": "critical",
            "area": "roof",
            "instruction": (
                "Every missing shingle and severely creased shingle has exposed nail heads. "
                "Shoot close-ups of each exposed nail so the metal condition is readable.\n\n"
                "**Why this matters:** Unrusted / shiny / bright nail heads = the shingle "
                "came off recently (the nail has only just been exposed to weather). "
                "Rusted nails = the shingle was missing for months/years. This kills the "
                "adjuster's classic \"wear and tear\" / \"pre-existing\" denial.\n\n"
                "Sequence per missing-shingle location:\n"
                "  1. Wide shot of the void showing all exposed nails in the row\n"
                "  2. Close-up of 1-2 nail heads with a quarter for scale\n"
                "  3. Same sequence for severely creased shingles (lift the tab to "
                "expose the nail head underneath)\n\n"
                "Label: \"Rear slope, exposed nails shiny/unrusted → recent separation.\""
            ),
            "damage_score_impact": "+15 points",
        })

    # MANUFACTURER STAMP — age / discontinuation proof
    if (show_all or focus == "roof") and coverage["manufacturer_stamp_photos"] == 0 and coverage["slope_photos"] > 0:
        steps.append({
            "title": "Photograph manufacturer stamp on a removed shingle",
            "importance": "medium",
            "area": "roof",
            "instruction": (
                "Pull one damaged shingle and photograph the back side — the "
                "manufacturer stamp + batch code are printed there. This proves:\n"
                "  1. The product's manufacturer (ties to discontinuation databases)\n"
                "  2. Approximate age (batch codes encode year)\n"
                "  3. Product line for matching disputes\n\n"
                "Close-up, no glare, readable. Label which slope it came from."
            ),
            "damage_score_impact": "+4 points",
        })

    # SOFT-METAL CHALK TEST (hail claims) — gutters / downspouts / fascia /
    # aluminum siding / window wraps / mailbox / A/C condenser. Hail signs
    # its work on every soft metal in the yard; chalk makes the dents
    # readable. This is one of the strongest corroborating-evidence plays
    # because it proves the storm actually hit the property (not a neighbor
    # 2 blocks over).
    if (show_all or focus in ("roof", "gutters", "siding")) and coverage["is_hail_claim"] and coverage["soft_metal_chalk_photos"] == 0:
        steps.append({
            "title": "Chalk-contrast every soft metal — hail's corroborating evidence",
            "importance": "critical",
            "area": "roof",
            "instruction": (
                "Hail dents every soft metal it hits — gutters, downspouts, window "
                "wraps, fascia, aluminum siding, mailbox, A/C condenser fins. These "
                "dents are subtle without chalk. Rub chalk horizontally across each "
                "metal surface, then shoot a close-up — every dent fills with chalk "
                "and becomes countable.\n\n"
                "Hit list (work around the property):\n"
                "  • **Gutters** — chalk the front face, shoot from below. Hail hits the "
                "top lip too; get a ladder shot.\n"
                "  • **Downspouts** — all 4 elevations. Dents concentrated on the "
                "storm-facing side tell you the wind direction.\n"
                "  • **Window wraps & capping** — aluminum wraps around windows dent "
                "easily. Chalk them.\n"
                "  • **Fascia / rake boards** — if aluminum-wrapped, chalk and shoot.\n"
                "  • **Aluminum siding / rear garage walls** — common overlooked target.\n"
                "  • **Mailbox** — if metal, it's a free hail-size reference shot.\n"
                "  • **A/C condenser unit** — fin damage is 100% hail. Shoot the "
                "coil fins close-up.\n\n"
                "**Why this matters:** Adjusters love to call roof damage 'cosmetic' "
                "or 'pre-existing.' Soft-metal dents across the yard prove a storm "
                "actually hit THIS property with hail large enough to deform metal — "
                "which is the same force that damaged the shingles."
            ),
            "damage_score_impact": "+12 points",
        })

    # SCREEN DAMAGE (hail claims) — direct impact evidence
    if (show_all or focus == "siding") and coverage["is_hail_claim"] and coverage["screen_photos"] == 0:
        steps.append({
            "title": "Check window & door screens for hail holes",
            "importance": "high",
            "area": "siding",
            "instruction": (
                "Walk the house and inspect every window screen, door screen, and "
                "porch screen. Hail punches clean holes or tears the mesh — adjusters "
                "can't argue age-related wear against a screen that's been in place for "
                "10 years without holes and now has 6.\n\n"
                "For each damaged screen:\n"
                "  1. Wide shot of the window/door showing location\n"
                "  2. Close-up of the hole/tear with a quarter for scale\n"
                "  3. Count holes per screen — adjusters have per-screen replacement "
                "unit pricing. More holes = more replacement.\n\n"
                "If screens are clean, that's worth noting too — if the rest of the "
                "house shows hail evidence but screens are intact, adjuster may argue "
                "hail size was sub-screen. Rare, but worth checking."
            ),
            "damage_score_impact": "+6 points",
        })

    # HAIL SPLATTER (hail claims) — directional impact marks
    if (show_all or focus == "roof") and coverage["is_hail_claim"] and coverage["splatter_photos"] == 0:
        steps.append({
            "title": "Document hail splatter marks on hard surfaces",
            "importance": "high",
            "area": "roof",
            "instruction": (
                "Hail leaves wet/dirt splatter marks on surfaces it strikes — painted "
                "wood, asphalt driveways, concrete walks, deck boards, painted fences. "
                "These marks are: (a) directional (show storm angle), (b) sized (the "
                "impact diameter = rough hail size), and (c) undeniable storm evidence.\n\n"
                "Walk the property and shoot:\n"
                "  • **Driveway / concrete walks** — pock marks where hail hit wet "
                "surface. Close-up with quarter for scale.\n"
                "  • **Painted deck boards / fences** — splatter marks or dirt "
                "residue. Shoot overhead.\n"
                "  • **Wooden fences / posts** — impact dings, lighter marks where "
                "paint was chipped.\n"
                "  • **Garage door panels** — metal dimples or paint chips.\n\n"
                "If you can include a ruler ACROSS the splatter mark, that's a "
                "measurable hail-size argument that backs up the NOAA storm data."
            ),
            "damage_score_impact": "+7 points",
        })

    # MAT EXPOSURE — thermal splitting indicator
    if (show_all or focus == "roof") and coverage["is_hail_claim"] and coverage["mat_exposure_photos"] == 0:
        steps.append({
            "title": "Document any mat-exposure or thermal splitting",
            "importance": "medium",
            "area": "roof",
            "instruction": (
                "If any shingle shows the fiberglass mat exposed (white/fibrous material "
                "visible under the granules), photograph it close-up with scale. Mat "
                "exposure is not just cosmetic — it means water ingress is imminent and "
                "the shingle is functionally failed. Adjusters can't argue 'cosmetic only' "
                "against exposed mat."
            ),
            "damage_score_impact": "+4 points",
        })

    # SHEATHING — penetration proof
    if (show_all or focus == "roof" or focus == "interior") and coverage["sheathing_photos"] == 0:
        steps.append({
            "title": "Attic/sheathing shots for penetration evidence",
            "importance": "low",
            "area": "interior",
            "instruction": (
                "From inside the attic, shoot the underside of the roof sheathing where "
                "damage is suspected. Look for: water staining, daylight, nail-pop, or "
                "delamination. If any present, shoot the stain + the corresponding "
                "exterior location so carrier can tie cause to effect. This defeats the "
                "\"no visible damage\" denial even when exterior evidence is limited."
            ),
            "damage_score_impact": "+3 points if damage present",
        })

    return steps


def _handle_coach_photo_documentation(sb: Client, claim_id: str, claim_data: dict, tool_input: dict) -> dict:
    focus = (tool_input.get("focus_area") or "all").strip().lower()

    try:
        photos_res = sb.table("photos").select(
            "annotation_key, annotation_text, damage_type, material, trade, severity"
        ).eq("claim_id", claim_id).execute()
        photos = photos_res.data or []
    except Exception as e:
        return {"action": "error", "message": f"Photo lookup failed: {e}"}

    coverage = _analyze_photo_coverage(photos, focus, claim_data)
    steps = _generate_coaching_steps(coverage, claim_data, focus)

    total_impact = sum(
        int(s.get("damage_score_impact", "0").replace("+", "").split()[0] or 0)
        for s in steps
        if "damage_score_impact" in s and s["damage_score_impact"].startswith("+")
    ) if steps else 0

    return {
        "action": "complete",
        "type": "photo_coaching",
        "data": {
            "photo_count": len(photos),
            "focus": focus,
            "coverage": coverage,
            "coaching_steps": steps,
            "estimated_damage_score_gain": total_impact,
            "current_damage_score": claim_data.get("damage_score"),
            "current_damage_grade": claim_data.get("damage_grade"),
        },
        "message": (
            f"{len(steps)} coaching step{'s' if len(steps) != 1 else ''} "
            f"to strengthen documentation"
            + (f" (+{total_impact} DS points available)" if total_impact > 0 else "")
            + "."
        ),
    }


# ═══════════════════════════════════════════
# LINE ITEM SURGERY
# ═══════════════════════════════════════════

def _handle_list_line_items(sb: Client, claim_id: str, tool_input: dict) -> dict:
    """Read-only — return current line items on this claim."""
    source = (tool_input.get("source") or "usarm").strip().lower()
    trade = tool_input.get("trade")
    limit = int(tool_input.get("limit") or 50)

    query = sb.table("line_items").select(
        "id, category, description, qty, unit, unit_price, total, xactimate_code, trade, source, structure"
    ).eq("claim_id", claim_id)

    if source != "all":
        query = query.eq("source", source)
    if trade:
        query = query.eq("trade", trade)

    result = query.order("created_at", desc=False).limit(limit).execute()
    items = result.data or []

    total_value = sum(float(i.get("total") or (float(i.get("qty") or 0) * float(i.get("unit_price") or 0))) for i in items)

    return {
        "action": "complete",
        "type": "line_items",
        "data": {
            "items": items,
            "count": len(items),
            "source": source,
            "total_value": round(total_value, 2),
        },
        "message": f"{len(items)} line item{'s' if len(items) != 1 else ''} (source={source}) totaling ${total_value:,.2f}.",
    }


def _handle_preview_add_line_item(tool_input: dict, sb: Optional[Client] = None, claim_id: Optional[str] = None) -> dict:
    description = (tool_input.get("description") or "").strip()
    qty_raw = tool_input.get("qty")
    unit = (tool_input.get("unit") or "").strip()
    price_raw = tool_input.get("unit_price")
    reason = (tool_input.get("reason") or "").strip()

    if not description or qty_raw is None or not unit or price_raw is None or not reason:
        return {"action": "error", "message": "description, qty, unit, unit_price, and reason are required"}

    try:
        qty = float(qty_raw)
        unit_price = float(price_raw)
    except (TypeError, ValueError):
        return {"action": "error", "message": "qty and unit_price must be numeric"}

    if qty <= 0:
        return {"action": "error", "message": "qty must be > 0"}
    if unit_price < 0:
        return {"action": "error", "message": "unit_price cannot be negative"}

    # Guard: zero-price with positive qty almost always means Xactimate lookup
    # whiffed and Richard is about to add a free line. Force ask-the-user.
    if unit_price == 0 and qty > 0:
        return {
            "action": "error",
            "message": (
                f"Refusing to add '{description}' at $0/{unit}. Either call lookup_xactimate_price "
                f"with a more specific description, or ask the user for the correct unit price."
            ),
        }

    # Duplicate detection — fuzzy-match description against existing line items
    # on THIS claim. Not a hard block (e.g. "R&R 2 skylights" is legit even if
    # a "skylight" line exists) but surfaces the risk in the preview.
    potential_dupes: list[dict] = []
    if sb and claim_id:
        try:
            existing_res = sb.table("line_items").select(
                "id, description, qty, unit, unit_price, source"
            ).eq("claim_id", claim_id).execute()
            existing = existing_res.data or []
            desc_norm = _normalize_desc_for_match(description)
            for e in existing:
                e_desc_norm = _normalize_desc_for_match(e.get("description") or "")
                if _desc_similarity(desc_norm, e_desc_norm) >= 0.7:
                    potential_dupes.append({
                        "id": e.get("id"),
                        "description": e.get("description"),
                        "qty": e.get("qty"),
                        "unit": e.get("unit"),
                        "unit_price": e.get("unit_price"),
                        "source": e.get("source"),
                    })
        except Exception as e:
            print(f"[add_line_item] dupe check failed (non-fatal): {e}")

    total = qty * unit_price
    return {
        "action": "preview",
        "type": "add_line_item",
        "tool_name": "add_line_item",
        "preview": {
            "action_label": "Add Line Item",
            "description": description,
            "qty": qty,
            "unit": unit,
            "unit_price": unit_price,
            "total": total,
            "category": (tool_input.get("category") or "GENERAL").upper(),
            "xactimate_code": tool_input.get("xactimate_code"),
            "trade": tool_input.get("trade"),
            "reason": reason,
            "potential_dupes": potential_dupes[:3],  # cap at 3 most similar
        },
        "message": (
            f"Ready to add: {description} — {qty} {unit} @ ${unit_price:.2f} = ${total:,.2f}"
            + (f" ⚠ {len(potential_dupes)} similar line item{'s' if len(potential_dupes) != 1 else ''} already on claim" if potential_dupes else "")
        ),
    }


def _normalize_desc_for_match(s: str) -> str:
    """Lowercase, strip punctuation, keep alphanumerics + spaces for fuzzy match."""
    import re
    return re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower()).strip()


def _desc_similarity(a: str, b: str) -> float:
    """Token-overlap Jaccard similarity. Cheap, handles reordered words well."""
    if not a or not b:
        return 0.0
    ta = set(a.split())
    tb = set(b.split())
    if not ta or not tb:
        return 0.0
    # Remove tiny words that don't carry meaning
    stop = {"a", "an", "the", "of", "and", "for", "to", "in", "on", "or", "with", "per"}
    ta -= stop
    tb -= stop
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _handle_preview_remove_line_item(sb: Client, claim_id: str, tool_input: dict) -> dict:
    line_item_id = (tool_input.get("line_item_id") or "").strip()
    reason = (tool_input.get("reason") or "").strip()
    if not line_item_id or not reason:
        return {"action": "error", "message": "line_item_id and reason required"}

    # Confirm the line item exists on this claim — prevents cross-claim tampering.
    try:
        res = sb.table("line_items").select(
            "id, description, qty, unit, unit_price, total, source"
        ).eq("id", line_item_id).eq("claim_id", claim_id).limit(1).execute()
        rows = res.data or []
    except Exception as e:
        return {"action": "error", "message": f"Line item lookup failed: {e}"}

    if not rows:
        return {"action": "error", "message": f"Line item {line_item_id} not found on this claim."}

    item = rows[0]
    return {
        "action": "preview",
        "type": "remove_line_item",
        "tool_name": "remove_line_item",
        "preview": {
            "action_label": "Remove Line Item",
            "line_item_id": line_item_id,
            "description": item.get("description"),
            "qty": item.get("qty"),
            "unit": item.get("unit"),
            "unit_price": item.get("unit_price"),
            "total": item.get("total"),
            "source": item.get("source"),
            "reason": reason,
        },
        "message": f"Ready to exclude: {item.get('description')} (${float(item.get('total') or 0):,.2f}). Reason: {reason}",
    }


def _handle_preview_modify_line_item(sb: Client, claim_id: str, tool_input: dict) -> dict:
    line_item_id = (tool_input.get("line_item_id") or "").strip()
    reason = (tool_input.get("reason") or "").strip()
    if not line_item_id or not reason:
        return {"action": "error", "message": "line_item_id and reason required"}

    new_qty = tool_input.get("qty")
    new_price = tool_input.get("unit_price")
    if new_qty is None and new_price is None:
        return {"action": "error", "message": "Provide at least one of qty or unit_price."}

    try:
        res = sb.table("line_items").select(
            "id, description, qty, unit, unit_price, total, source"
        ).eq("id", line_item_id).eq("claim_id", claim_id).limit(1).execute()
        rows = res.data or []
    except Exception as e:
        return {"action": "error", "message": f"Line item lookup failed: {e}"}

    if not rows:
        return {"action": "error", "message": f"Line item {line_item_id} not found on this claim."}

    item = rows[0]
    old_qty = float(item.get("qty") or 0)
    old_price = float(item.get("unit_price") or 0)
    next_qty = float(new_qty) if new_qty is not None else old_qty
    next_price = float(new_price) if new_price is not None else old_price

    if next_qty <= 0:
        return {"action": "error", "message": "qty must be > 0"}
    if next_price < 0:
        return {"action": "error", "message": "unit_price cannot be negative"}

    old_total = old_qty * old_price
    new_total = next_qty * next_price

    return {
        "action": "preview",
        "type": "modify_line_item",
        "tool_name": "modify_line_item",
        "preview": {
            "action_label": "Modify Line Item",
            "line_item_id": line_item_id,
            "description": item.get("description"),
            "unit": item.get("unit"),
            "old_qty": old_qty,
            "new_qty": next_qty,
            "old_unit_price": old_price,
            "new_unit_price": next_price,
            "old_total": old_total,
            "new_total": new_total,
            "delta": new_total - old_total,
            "source": item.get("source"),
            "reason": reason,
        },
        "message": (
            f"Ready to modify: {item.get('description')}. "
            f"{old_qty}{item.get('unit','')} × ${old_price:.2f} = ${old_total:,.2f} → "
            f"{next_qty}{item.get('unit','')} × ${next_price:.2f} = ${new_total:,.2f} "
            f"(Δ ${new_total - old_total:+,.2f})."
        ),
    }


def _handle_preview_recompute_estimate(sb: Client, claim_id: str) -> dict:
    """Preview a fast recompute — sums current line_items, projects new contractor_rcv."""
    try:
        res = sb.table("line_items").select("qty, unit_price, total").eq("claim_id", claim_id).execute()
        items = res.data or []
    except Exception as e:
        return {"action": "error", "message": f"Line item lookup failed: {e}"}

    line_total = sum(float(i.get("total") or (float(i.get("qty") or 0) * float(i.get("unit_price") or 0))) for i in items)

    try:
        claim_res = sb.table("claims").select("contractor_rcv, current_carrier_rcv, original_carrier_rcv, o_and_p_enabled, tax_rate").eq("id", claim_id).single().execute()
        claim = claim_res.data or {}
    except Exception:
        claim = {}

    tax_rate = float(claim.get("tax_rate") or 0)
    op_enabled = bool(claim.get("o_and_p_enabled"))
    tax = line_total * tax_rate
    op = line_total * 0.21 if op_enabled else 0.0
    projected_rcv = line_total + tax + op

    old_rcv = float(claim.get("contractor_rcv") or 0)
    carrier_rcv = float(claim.get("current_carrier_rcv") or claim.get("original_carrier_rcv") or 0)
    projected_variance = projected_rcv - carrier_rcv

    return {
        "action": "preview",
        "type": "recompute_estimate",
        "tool_name": "recompute_estimate",
        "preview": {
            "action_label": "Recompute Estimate",
            "line_item_count": len(items),
            "line_total": round(line_total, 2),
            "tax_rate": tax_rate,
            "tax": round(tax, 2),
            "o_and_p_enabled": op_enabled,
            "op": round(op, 2),
            "old_contractor_rcv": old_rcv,
            "projected_contractor_rcv": round(projected_rcv, 2),
            "delta": round(projected_rcv - old_rcv, 2),
            "carrier_rcv": carrier_rcv,
            "projected_variance": round(projected_variance, 2),
        },
        "message": f"Will update contractor_rcv: ${old_rcv:,.2f} → ${projected_rcv:,.2f} ({projected_rcv - old_rcv:+,.2f}).",
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
