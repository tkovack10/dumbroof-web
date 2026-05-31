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

from model_config import MODEL  # unified model knob (see model_config.py)

import os
import json
import time
import base64
import hashlib
import traceback
from datetime import datetime
from typing import Optional, Any

from supabase import Client

import email_voice  # human email voice + AI-tell linter (shared with bulk/cadence)


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
        "name": "get_slope_damage",
        "description": (
            "Return the per-roof-slope damage breakdown for this claim — each facet "
            "with its cardinal direction, pitch, damage %, number of photos showing "
            "damage, and dominant damage type. Also returns the full-reroof trigger "
            "status (area-weighted ≥25% across the roof). Use when asked 'which slope "
            "is worst?', 'does this qualify for full reroof?', 'what's the damage "
            "distribution?', or when building a full-roof-replacement supplement "
            "argument. Empty if no EagleView facets have been extracted yet."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "min_damage_pct": {
                    "type": "number",
                    "description": "Only return slopes with weighted damage >= this (0-1 scale). Default 0 (all slopes).",
                    "default": 0,
                },
            },
            "required": [],
        },
    },
    # ─────────────────────────────────────────────
    # Admin / onboarding — integrations + team + templates
    # These tools are company-scoped (not claim-scoped). They still run
    # inside the claim-brain endpoint because users chat there, but the
    # claim context is ignored for these.
    # ─────────────────────────────────────────────
    {
        "name": "list_integrations",
        "description": (
            "Show the connection status of every integration on this account — "
            "Gmail, CompanyCam, AccuLynx, Roofr, Hover, GAF QuickMeasure, "
            "JobNimbus, ServiceTitan. Use when the user asks 'what's connected', "
            "'what API keys do I have set up', or as part of an onboarding "
            "checklist. Also returns company profile completeness (logo, "
            "company name, address, etc.)."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_integration_setup_guide",
        "description": (
            "Return step-by-step instructions for setting up a specific third-"
            "party integration: where to get the API key, exact menu path, "
            "gotchas, and what Richard unlocks once it's connected. Use when "
            "the user asks 'how do I connect X', 'help me set up Hover', etc."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "service": {
                    "type": "string",
                    "enum": ["gmail", "microsoft_365", "generic_smtp", "companycam", "acculynx", "roofr", "hover", "gaf_quickmeasure", "jobnimbus", "servicetitan"],
                    "description": "Which integration to explain.",
                },
            },
            "required": ["service"],
        },
    },
    {
        "name": "save_integration_key",
        "description": (
            "Save an API key for a third-party integration on the user's company "
            "profile. Use AFTER the user has followed get_integration_setup_guide "
            "and pasted their key. REQUIRES USER APPROVAL (keys are credentials)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "service": {
                    "type": "string",
                    "enum": ["companycam", "acculynx", "roofr", "hover", "gaf_quickmeasure", "jobnimbus", "servicetitan"],
                    "description": "Which service this key is for. Gmail uses OAuth, not a key.",
                },
                "api_key": {"type": "string", "description": "The API key / token the user pasted."},
                "tenant_id": {"type": "string", "description": "ServiceTitan only — tenant ID."},
                "client_id": {"type": "string", "description": "ServiceTitan only — client ID."},
                "client_secret": {"type": "string", "description": "ServiceTitan only — client secret."},
            },
            "required": ["service", "api_key"],
        },
    },
    {
        "name": "invite_team_member",
        "description": (
            "Invite a new team member to this company's DumbRoof account. "
            "Sends a signup link with the company domain pre-linked. REQUIRES "
            "USER APPROVAL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "email": {"type": "string", "description": "Team member's email."},
                "role": {
                    "type": "string",
                    "enum": ["admin", "user"],
                    "description": "Role. Admins can manage integrations + team; users can only submit claims.",
                    "default": "user",
                },
                "name": {"type": "string", "description": "Optional display name."},
            },
            "required": ["email"],
        },
    },
    # ─── Branding / profile (approval-gated writes) ───
    {
        "name": "upload_company_logo",
        "description": (
            "Set the company logo. The user uploads via the chat input — Richard receives a Supabase "
            "storage path. This tool sets that path as the active company logo. REQUIRES USER APPROVAL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "storage_path": {"type": "string", "description": "Supabase storage path of the uploaded logo image."},
                "filename": {"type": "string", "description": "Display filename for the preview card."},
            },
            "required": ["storage_path"],
        },
    },
    {
        "name": "update_company_profile",
        "description": (
            "Update one or more fields on the company profile: company name, address, license number, "
            "brand color, primary email, phone. Pass only the fields the user is changing. "
            "REQUIRES USER APPROVAL — preview shows a diff before commit."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "company_name": {"type": "string"},
                "address": {"type": "string"},
                "city_state_zip": {"type": "string"},
                "contact_name": {"type": "string"},
                "email": {"type": "string"},
                "phone": {"type": "string"},
                "license_number": {"type": "string"},
                "brand_color": {"type": "string", "description": "Hex code, e.g. #6366F1"},
                "website": {"type": "string"},
            },
            "required": [],
        },
    },
    {
        "name": "connect_crm",
        "description": (
            "Start the OAuth flow to connect a CRM or measurement provider. Returns an authorization "
            "URL the user clicks to grant access. Use when the user says 'connect Hover' or 'connect "
            "JobNimbus' and the service supports OAuth (Hover, Roofr, JobNimbus, ServiceTitan, "
            "Salesforce, HubSpot). For API-key services use save_integration_key instead."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "service": {
                    "type": "string",
                    "enum": ["hover", "roofr", "jobnimbus", "servicetitan", "salesforce", "hubspot", "acculynx_oauth"],
                },
            },
            "required": ["service"],
        },
    },
    {
        "name": "disconnect_integration",
        "description": (
            "Remove a previously-saved integration credential or OAuth token. Use when the user says "
            "'disconnect X' or 'remove my Y key'. REQUIRES USER APPROVAL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "service": {
                    "type": "string",
                    "enum": ["companycam", "acculynx", "roofr", "hover", "gaf_quickmeasure", "jobnimbus", "servicetitan", "gmail", "microsoft_365", "generic_smtp", "salesforce", "hubspot"],
                },
            },
            "required": ["service"],
        },
    },
    # ─── CompanyCam photo import ──────────────────
    {
        "name": "list_companycam_projects",
        "description": (
            "List the user's CompanyCam projects so they can pick one to pull photos from. "
            "Use when the user says things like 'import my CompanyCam photos', 'grab the photos "
            "from CompanyCam', or 'which CompanyCam job has the roof shots'. Requires the user to "
            "have CompanyCam connected (a saved API key). If they are NOT connected, the tool says "
            "so — then guide them to connect it first (save_integration_key for the API key). "
            "Returns up to ~20 projects per page with their id + address; show the list and ask "
            "which one to import, then call import_companycam_photos with the chosen project_id."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Optional address/name filter to narrow the project list."},
                "page": {"type": "integer", "description": "Page of results (1-based). Default 1.", "default": 1},
            },
            "required": [],
        },
    },
    {
        "name": "import_companycam_photos",
        "description": (
            "Import the photos from a chosen CompanyCam project INTO a claim. Call this AFTER "
            "list_companycam_projects when the user has picked which project to pull. Downloads the "
            "CompanyCam originals and stores them on the claim's photos so they flow into the report. "
            "Requires CompanyCam connected. The claim is the one currently open in chat by default; "
            "on the dashboard (no claim open) you MUST pass claim_id for the target claim. Imports up "
            "to 100 photos. This is a real write but is non-destructive (only adds photos) — it runs "
            "without a separate approval gate."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "CompanyCam project id chosen from list_companycam_projects."},
                "claim_id": {"type": "string", "description": "Target claim id to import into. Optional in a per-claim chat (defaults to the open claim); REQUIRED from the dashboard where no claim is open."},
            },
            "required": ["project_id"],
        },
    },
    # ─── Company-scope (admin/owner only) ─────────
    {
        "name": "list_company_claims",
        "description": (
            "List claims across ALL users in the company. Owner/admin only. "
            "Use when the user asks for a portfolio view or company-wide claim list. "
            "Filterable by status, carrier, and minimum variance."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["any", "open", "ready", "processing", "won", "needs_attention"],
                    "default": "any",
                },
                "carrier": {"type": "string", "description": "Filter by carrier name (case-insensitive substring match)."},
                "min_variance_usd": {"type": "number", "description": "Only return claims with variance ≥ this dollar amount."},
                "limit": {"type": "integer", "default": 25, "minimum": 1, "maximum": 100},
            },
            "required": [],
        },
    },
    {
        "name": "get_company_portfolio_summary",
        "description": (
            "Owner/admin only. Return a portfolio-level snapshot: open claims, pending supplements, "
            "YTD wins, average variance, top carriers, integration completeness. Always call this "
            "first when the user opens with a vague company-wide question."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "compare_team_performance",
        "description": (
            "Owner/admin only. Compare reps within the company on claims processed, supplements won, "
            "average variance, and average response time. Returns ranked list with concrete numbers."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "window_days": {"type": "integer", "default": 90, "minimum": 7, "maximum": 365},
            },
            "required": [],
        },
    },
    {
        "name": "get_team_member_workload",
        "description": (
            "Owner/admin only. Return current workload per rep: open claims, overdue follow-ups, "
            "pending supplements. Use when the user asks 'who is overloaded' or 'who needs help'."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "bulk_supplement_campaign",
        "description": (
            "Owner/admin only. Build a COMPANY-WIDE bulk supplement-to-carrier campaign PREVIEW across every "
            "eligible claim in the company. Eligible = paid (payment/check received) + post-scope phase + "
            "a real carrier RCV + a positive supplement amount + 2+ code-cited scope gaps + the scope-"
            "comparison PDF on file + an adjuster or known carrier-intake target + not already supplemented. "
            "Each email is human, varied (4 rotating tones), code-cited, and attaches the scope comparison + "
            "code-compliance + estimate PDFs; the carrier subject is the bare claim number. "
            "\n\nPREVIEW-ONLY / HUMAN-APPROVAL-GATED. Calling this tool ALWAYS just builds a preview and SENDS "
            "NOTHING — it returns the eligible-claim list, counts, per-row target type (named adjuster vs shared "
            "carrier-intake), the carrier-intake count, and ONE rendered sample email. You CANNOT send: the "
            "actual blast runs only after the human clicks Approve on the preview card (a server-side gate). So "
            "just call it, show the user the list + sample, and tell them to click Approve when ready. There is "
            "no 'execute' you can trigger. Company scope is resolved server-side from the signed-in owner/admin "
            "— you cannot target another company."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "min_gap_items": {
                    "type": "integer",
                    "default": 2,
                    "minimum": 1,
                    "description": "Minimum number of scope-comparison gap items required for a claim to be eligible.",
                },
                "max_claims": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Optional cap on how many claims to include (highest-supplement-value first).",
                },
                "include_carrier_intake": {
                    "type": "boolean",
                    "default": True,
                    "description": "When true (default), claims with no named adjuster email fall back to a shared carrier claims-intake address (e.g. State Farm/Allstate/Guard intake). Set false to send ONLY to named adjusters and skip no-adjuster claims. The preview flags every carrier-intake row and gives a count so the human sees them before approving.",
                },
                "exclude_claim_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Claim ids to skip (e.g. ones the user said to hold back after seeing the preview).",
                },
            },
            "required": [],
        },
    },
    {
        "name": "bulk_forensic_campaign",
        "description": (
            "Owner/admin only. Build a COMPANY-WIDE bulk forensic-causation-report-to-carrier campaign PREVIEW "
            "across every eligible claim in the company. Eligible = a forensic causation PDF on file + an "
            "adjuster or known carrier-intake target + not already sent to the carrier + de-duplicated by "
            "property. Each email is human, varied (6 rotating tones), attaches the forensic report, and "
            "(carrier subject = bare claim number when on file). The homeowner is CC'd when a valid address "
            "exists."
            "\n\nPREVIEW-ONLY / HUMAN-APPROVAL-GATED. Calling this tool ALWAYS just builds a preview and SENDS "
            "NOTHING — it returns the eligible-claim list, counts, per-row target type (named adjuster vs shared "
            "carrier-intake), the carrier-intake count, and ONE rendered sample email. You CANNOT send: the "
            "actual blast runs only after the human clicks Approve on the preview card (a server-side gate). "
            "Just call it, show the user the list + sample, and tell them to click Approve. Company scope is "
            "resolved server-side from the signed-in owner/admin — you cannot target another company."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "max_claims": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Optional cap on how many claims to include.",
                },
                "include_carrier_intake": {
                    "type": "boolean",
                    "default": True,
                    "description": "When true (default), claims with no named adjuster email fall back to a shared carrier claims-intake address. Set false to send ONLY to named adjusters and skip no-adjuster claims. The preview flags every carrier-intake row and gives a count so the human sees them before approving.",
                },
                "exclude_claim_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Claim ids to skip (e.g. ones the user said to hold back after seeing the preview).",
                },
            },
            "required": [],
        },
    },
    {
        "name": "find_photo",
        "description": (
            "Find a specific photo on this claim by annotation key (e.g. 'p11_02'), "
            "description text, position (e.g. 'the 23rd photo'), or damage type. "
            "Use before edit_photo_annotation or exclude_photo_from_claim so you "
            "know the exact photo_id to target. Returns up to 5 matches ordered by "
            "relevance with UUID + current annotation + tags."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query. Can be an annotation_key like 'p11_02', free-text like 'chimney flashing', a position like '23' or '2nd on page 11', or a damage descriptor.",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "edit_photo_annotation",
        "description": (
            "Edit a photo's annotation (description) and/or tags (damage_type, "
            "material, severity). The edit writes to annotation_feedback so it "
            "SURVIVES reprocess — the processor re-injects user-corrected "
            "annotations as few-shot examples on subsequent runs. Also updates "
            "the photos table directly for immediate display. REQUIRES USER APPROVAL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "photo_id": {"type": "string", "description": "UUID from find_photo."},
                "annotation_text": {"type": "string", "description": "New description for the photo."},
                "damage_type": {"type": "string", "description": "New damage type tag (hail, wind, mechanical, etc.)."},
                "material": {"type": "string", "description": "New material tag (shingle, siding, flashing, etc.)."},
                "severity": {"type": "string", "description": "New severity tag (minor, moderate, severe)."},
                "reason": {"type": "string", "description": "Why this correction is needed."},
            },
            "required": ["photo_id", "reason"],
        },
    },
    {
        "name": "exclude_photo_from_claim",
        "description": (
            "Mark a photo as excluded so it does NOT appear in the forensic report "
            "or evidence exhibits. Use when a photo is a duplicate, shows something "
            "unrelated, is blurry, or otherwise shouldn't be in the claim. Writes "
            "to claims.excluded_photos (JSONB array, survives reprocess). "
            "REQUIRES USER APPROVAL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "photo_id": {"type": "string", "description": "UUID from find_photo."},
                "annotation_key": {"type": "string", "description": "Alternative to photo_id — the annotation_key like 'p11_02'."},
                "reason": {"type": "string", "description": "Why this photo should be excluded."},
            },
            "required": ["reason"],
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
        "name": "upload_user_estimate",
        "description": (
            "Replace the platform-generated Xactimate-style estimate with the user's own "
            "line items. Sets manual_scope_locked=true so future reprocesses preserve the "
            "user's prices exactly (no registry overlay, no line-item rebuild). The scope "
            "comparison + supplement composer rebuild against the user's items automatically "
            "via the reprocess kick. Use when the user uploads their own Xactimate JSON "
            "export, or pastes line items they want to lock in. REQUIRES USER APPROVAL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "line_items": {
                    "type": "array",
                    "description": (
                        "Array of line items. Each item REQUIRES description (string), qty "
                        "(positive number), unit_price (non-negative number). Optional: unit "
                        "(defaults EA), category (ROOFING/SIDING/GUTTERS/INTERIOR/GENERAL), "
                        "trade (roofing/siding/gutters/...), xactimate_code."
                    ),
                    "items": {"type": "object"},
                },
                "reason": {
                    "type": "string",
                    "description": "Why the user is uploading their own estimate (informational — shown in the preview).",
                },
            },
            "required": ["line_items"],
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
    {
        "name": "get_claim_timeline",
        "description": (
            "Return the chronological event timeline for this claim — milestones, "
            "communications, documents, actions, and system events. Use to answer "
            "questions like 'when did the adjuster meeting happen?', 'what's the "
            "most recent activity?', or 'show me every email sent on this claim'. "
            "Events are stored as they happen (claim opened, AOB signed, scope "
            "received, supplement sent, carrier replies, homeowner communications, "
            "wins detected, etc.)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Max number of events to return (most recent first). Default 50.",
                    "default": 50,
                },
                "category_filter": {
                    "type": "string",
                    "enum": ["milestone", "communication", "document", "action", "system"],
                    "description": "Optional: only return events in this category.",
                },
            },
        },
    },
    # ─── New claim-level mutation tools (governance v2 Day 4) ────────────
    {
        "name": "update_date_of_loss",
        "description": (
            "Change the date of loss on this claim. Use when the homeowner "
            "misremembered the date or the carrier rejected the original DOL. "
            "Triggers an automatic NOAA re-query in the background to refresh "
            "weather evidence for the new date. Does NOT auto-trigger reprocess "
            "— the user must explicitly ask for that. APPROVAL-GATED because "
            "DOL drives statute-of-limitations and forensic synthesis."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "new_date_of_loss": {
                    "type": "string",
                    "description": "New DOL in YYYY-MM-DD format (e.g. '2024-08-15').",
                },
                "reason": {
                    "type": "string",
                    "description": "Why the DOL is changing (homeowner correction, carrier rejection, NOAA verification, etc).",
                },
            },
            "required": ["new_date_of_loss", "reason"],
        },
    },
    {
        "name": "update_cause_of_loss",
        "description": (
            "Add or remove hail / wind / other from the cause of loss array on "
            "this claim. Use when forensic evidence shows the carrier missed a "
            "peril (e.g. wind damage on a 'hail-only' claim) or vice versa. "
            "Auto-approved because internal-state and reversible. Auto-triggers "
            "the reprocess auto-chain rule (Day 5) if user said 'reprocess' in "
            "the same turn or the claim is in 'ready' status."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "causes": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["hail", "wind", "wind_driven_rain", "fallen_tree", "other"]},
                    "description": "The full new cause-of-loss list (replaces current). Pass an empty list only with explicit user intent.",
                },
                "reason": {
                    "type": "string",
                    "description": "Forensic justification (which photos / measurements support each cause).",
                },
            },
            "required": ["causes", "reason"],
        },
    },
    {
        "name": "set_estimate_total",
        "description": (
            "Hit a specific contractor RCV target (e.g. 'I want the estimate to "
            "be exactly $19,632.14'). Default strategy adds an 'Estimator's "
            "Scope Adjustment' line item at the bottom (Xactimate code EST ADJ) "
            "with the necessary delta — preserves real Xactimate prices on "
            "every other line item so carriers cannot reject for fabricated "
            "unit prices. Use when the user says 'make the total be X', 'I "
            "want the estimate at X', 'cap the estimate at X', etc."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "target_total": {
                    "type": "number",
                    "description": "Target contractor RCV in dollars. Example: 19632.14.",
                },
                "strategy": {
                    "type": "string",
                    "enum": ["balancing_line", "scale_all", "adjust_primary"],
                    "description": (
                        "balancing_line (default): add an 'EST ADJ' line item at the bottom. "
                        "scale_all: proportionally scale every line item's unit price (WARNING: corrupts real Xactimate prices). "
                        "adjust_primary: modify shingle qty + accessories proportionally."
                    ),
                    "default": "balancing_line",
                },
                "reason": {
                    "type": "string",
                    "description": "Why the user wants this total (carrier-approved cap, lump-sum bid, scope alignment, etc).",
                },
            },
            "required": ["target_total", "reason"],
        },
    },
    {
        "name": "set_op_override",
        "description": (
            "Force GC overhead & profit on or off, regardless of trade count. "
            "Defaults follow the 3+ trades rule (10% O + 11% P), but contractors "
            "sometimes need to override (e.g. complex single-trade jobs that "
            "warrant O&P, or carrier-stipulated waivers). Auto-approved — "
            "internal state. Triggers recompute_estimate after the override "
            "is set so totals reflect the new policy."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "enabled": {
                    "type": "boolean",
                    "description": "True to apply O&P, False to suppress. None to revert to auto (3+ trades rule).",
                },
                "overhead_pct": {
                    "type": "number",
                    "description": "Overhead percentage (default 0.10 = 10%). Pass null to use platform default.",
                },
                "profit_pct": {
                    "type": "number",
                    "description": "Profit percentage (default 0.11 = 11%). Pass null to use platform default.",
                },
                "reason": {
                    "type": "string",
                    "description": "Why the override (carrier stipulation, complex single-trade scope, etc).",
                },
            },
            "required": ["enabled", "reason"],
        },
    },
    {
        "name": "send_install_supplement",
        "description": (
            "Send a post-installation supplement email to the carrier. "
            "Different template from the pre-scope supplement — references "
            "the completed work and auto-attaches the generated COC PDF. "
            "Use after the roof has been installed and the contractor needs "
            "to bill final RCV with proof of completion. APPROVAL-GATED "
            "(outbound carrier comms)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "include_coc": {
                    "type": "boolean",
                    "description": "Auto-attach the most recent COC PDF (default true). Set false only if a custom COC is being sent separately.",
                    "default": True,
                },
                "additional_notes": {
                    "type": "string",
                    "description": "Optional carrier-facing notes to include in the email body (e.g. 'requesting final payment per attached COC').",
                },
            },
        },
    },

    # ─── Phase 4: Retail tools ──────────────────────────────────────
    {
        "name": "create_retail_estimate",
        "description": (
            "Create a retail estimate for a non-insurance customer (cash, "
            "homeowner-funded job). NOT a claim — retail jobs live in their "
            "own table. Pulls per-unit prices from the company's retail price "
            "list (company_profiles.settings.retail.price_list). Returns a "
            "draft proposal for user approval. Use when the user says things "
            "like 'make a retail estimate for the Smiths' or 'cash quote for "
            "the gutter job at 12 Main St'. APPROVAL-GATED."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_name": {"type": "string", "description": "Homeowner / customer name (required)"},
                "customer_email": {"type": "string", "description": "Customer email (optional but required to email the proposal)"},
                "customer_phone": {"type": "string", "description": "Customer phone (optional)"},
                "address": {"type": "string", "description": "Job address"},
                "city_state_zip": {"type": "string", "description": "City, State ZIP"},
                "scope_description": {"type": "string", "description": "Free-form scope description Richard will parse for line items if line_items is omitted"},
                "line_items": {
                    "type": "array",
                    "description": "Explicit line items override. If omitted, Richard infers from scope_description + company retail price list.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {"type": "string"},
                            "qty": {"type": "number"},
                            "unit": {"type": "string", "description": "SQ, SF, LF, EA, HR"},
                            "unit_price": {"type": "number", "description": "Dollars (not cents)"},
                        },
                        "required": ["description", "qty", "unit_price"],
                    },
                },
                "deposit_pct": {"type": "number", "description": "Deposit percentage (e.g. 25 for 25%). Falls back to company default."},
                "send_now": {"type": "boolean", "description": "If true and customer_email is set, presents a draft email alongside the proposal. Default false (estimate saved as draft).", "default": False},
                "notes": {"type": "string"},
            },
            "required": ["customer_name", "scope_description"],
        },
    },
    {
        "name": "send_company_intro_email",
        "description": (
            "Send a branded 'about us / why work with us' intro email to a "
            "prospective customer. Pulls company logo, address, license, "
            "website, and (optionally) recent wins from company_profiles. "
            "Use when the user says 'send the Smiths our about-us info' or "
            "'intro email to that lead'. APPROVAL-GATED."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "to_email": {"type": "string", "description": "Recipient email (required)"},
                "first_name": {"type": "string", "description": "Recipient first name for the greeting (optional — defaults to 'there')"},
                "customer_context": {"type": "string", "description": "Optional 1-line context to tailor the email (e.g. 'asked about gutter replacement' or 'referred by Jane Smith')"},
                "include_recent_wins": {"type": "boolean", "description": "Include a 'recent jobs' highlight line. Default true.", "default": True},
                "retail_job_id": {"type": "string", "description": "Link this send to a retail job (optional — for tracking on the job's timeline)"},
            },
            "required": ["to_email"],
        },
    },
    {
        "name": "send_retail_invoice",
        "description": (
            "Create a Stripe Connect payment link for a retail job and email "
            "it to the customer. Routes funds to the company's connected "
            "Stripe account (company_profiles.stripe_connect_account_id). "
            "Supports deposit, progress, balance, or full invoices. Use when "
            "the user says 'send the Smiths their deposit invoice' or "
            "'invoice $4,500 for the balance'. APPROVAL-GATED."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "retail_job_id": {"type": "string", "description": "Existing retail_jobs.id (required when invoicing against a saved job)"},
                "to_email": {"type": "string", "description": "Customer email (defaults to retail_jobs.customer_email if omitted)"},
                "amount": {"type": "number", "description": "Invoice amount in dollars (not cents)"},
                "description": {"type": "string", "description": "What this invoice is for"},
                "kind": {"type": "string", "enum": ["deposit", "progress", "balance", "full"], "default": "full", "description": "Invoice kind — drives the email subject + copy"},
                "notes": {"type": "string"},
            },
            "required": ["retail_job_id", "amount", "description"],
        },
    },
    {
        "name": "create_claim_from_minimal_input",
        "description": (
            "Create the user's FIRST claim from the onboarding conversation, then "
            "start processing it immediately. Call this ONCE you have: (a) the user "
            "has uploaded at least inspection PHOTOS, the carrier's SCOPE/estimate, "
            "or a MEASUREMENT report (EagleView/HOVER/Roofr/GAF) via the upload box, "
            "AND (b) their property ADDRESS. You do NOT pass files — they're already "
            "staged under the onboarding session; just pass the 'slug' (given to you "
            "in context) plus the address, and (if known) the insurance carrier and "
            "date of loss. The report type auto-detects from what they uploaded: "
            "photos -> forensic damage report (date of loss is strongly recommended "
            "— it drives the storm/weather corroboration); carrier scope -> instant "
            "supplement; measurements only -> Xactimate-style estimate; any "
            "combination -> full package. Creates immediately (no approval needed). "
            "ONBOARDING ONLY — for users who have not made a claim yet."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "slug": {"type": "string", "description": "The onboarding session id provided to you in context. Identifies where the user's uploaded files are staged. Required."},
                "address": {"type": "string", "description": "Property street address (required). If the user genuinely won't provide one, pass 'Pending — please update'."},
                "carrier": {"type": "string", "description": "Insurance carrier name if known (optional)."},
                "date_of_loss": {"type": "string", "description": "Date of loss as YYYY-MM-DD if known. Optional but strongly recommended for photo/forensic claims — it drives the NOAA storm-weather section of the report."},
            },
            "required": ["slug", "address"],
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
        # Load claim + profile (needed by claim-scoped handlers; admin/company-scope
        # tools pass a sentinel claim_id like "admin" — load is best-effort).
        try:
            claim_result = sb.table("claims").select("*").eq("id", claim_id).limit(1).execute()
            claim_data = (claim_result.data or [{}])[0] if claim_result.data else {}
        except Exception:
            claim_data = {}

        try:
            profile_result = sb.table("company_profiles").select("*").eq("user_id", user_id).limit(1).execute()
            company_profile = (profile_result.data or [{}])[0] if profile_result.data else {}
        except Exception:
            company_profile = {}

        # ─── Tool preconditions (governance v2 Day 4) ───
        # Catch schema-level constraints (e.g. invite_team_member with no
        # company_profile) before dispatching to handlers that would crash.
        # See backend/richard_tool_preconditions.py.
        try:
            from richard_tool_preconditions import check_preconditions
            precond_result = check_preconditions(
                sb, tool_name, claim_data, company_profile, user_id, tool_input
            )
            if precond_result is not None:
                _audit_log(sb, claim_id, user_id, tool_name, tool_input, precond_result, time.time() - start)
                return precond_result
        except ImportError:
            # Module not present (rolled-back state) — skip preconditions
            pass

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
        elif tool_name == "get_claim_timeline":
            result = _handle_get_claim_timeline(sb, claim_id, tool_input)
        elif tool_name == "get_slope_damage":
            result = _handle_get_slope_damage(claim_data, tool_input)
        elif tool_name == "coach_photo_documentation":
            result = _handle_coach_photo_documentation(sb, claim_id, claim_data, tool_input)
        elif tool_name == "list_integrations":
            result = _handle_list_integrations(sb, user_id)
        elif tool_name == "get_integration_setup_guide":
            result = _handle_get_integration_setup_guide(tool_input)
        elif tool_name == "save_integration_key":
            result = _handle_preview_save_integration_key(sb, user_id, tool_input)
        elif tool_name == "invite_team_member":
            result = _handle_preview_invite_team_member(sb, user_id, tool_input)
        # ─── Branding / profile ─────────────────
        elif tool_name == "upload_company_logo":
            result = _handle_preview_upload_company_logo(sb, user_id, tool_input)
        elif tool_name == "update_company_profile":
            result = _handle_preview_update_company_profile(sb, user_id, tool_input)
        elif tool_name == "connect_crm":
            result = _handle_connect_crm(sb, user_id, tool_input)
        elif tool_name == "disconnect_integration":
            result = _handle_preview_disconnect_integration(sb, user_id, tool_input)
        # ─── CompanyCam photo import ──────────────
        elif tool_name == "list_companycam_projects":
            result = await _handle_list_companycam_projects(sb, user_id, tool_input)
        elif tool_name == "import_companycam_photos":
            result = await _handle_import_companycam_photos(sb, claim_id, user_id, tool_input)
        # ─── Company-scope (owner/admin only) ─────
        elif tool_name == "list_company_claims":
            result = _handle_list_company_claims(sb, user_id, tool_input)
        elif tool_name == "get_company_portfolio_summary":
            result = _handle_get_company_portfolio_summary(sb, user_id, company_profile.get("company_id"))
        elif tool_name == "compare_team_performance":
            result = _handle_compare_team_performance(sb, user_id, tool_input)
        elif tool_name == "get_team_member_workload":
            result = _handle_get_team_member_workload(sb, user_id)
        elif tool_name == "bulk_supplement_campaign":
            result = await _handle_bulk_supplement_campaign(sb, user_id, tool_input)
        elif tool_name == "bulk_forensic_campaign":
            result = await _handle_bulk_forensic_campaign(sb, user_id, tool_input)
        elif tool_name == "find_photo":
            result = _handle_find_photo(sb, claim_id, tool_input)
        elif tool_name == "edit_photo_annotation":
            result = _handle_preview_edit_photo(sb, claim_id, tool_input)
        elif tool_name == "exclude_photo_from_claim":
            result = _handle_preview_exclude_photo(sb, claim_id, tool_input)
        # ─── R2 classify ──────────────────────────────
        elif tool_name == "classify_uploaded_file":
            result = await _handle_classify_uploaded_file(sb, claim_id, tool_input)
        # ─── R3 destructive writes (preview → approval) ──
        elif tool_name == "attach_to_claim":
            result = _handle_preview_attach_to_claim(claim_data, tool_input)
        elif tool_name == "trigger_reprocess":
            result = _handle_preview_trigger_reprocess(claim_data, tool_input)
        elif tool_name == "upload_user_estimate":
            result = _handle_preview_upload_user_estimate(claim_data, tool_input)
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
        # ─── New mutation tools (governance v2 Day 4) ───
        elif tool_name == "update_date_of_loss":
            result = _handle_preview_update_date_of_loss(sb, claim_id, claim_data, tool_input)
        elif tool_name == "update_cause_of_loss":
            result = _handle_preview_update_cause_of_loss(sb, claim_id, claim_data, tool_input)
        elif tool_name == "set_estimate_total":
            result = _handle_preview_set_estimate_total(sb, claim_id, claim_data, tool_input)
        elif tool_name == "set_op_override":
            result = _handle_preview_set_op_override(sb, claim_id, claim_data, tool_input)
        elif tool_name == "send_install_supplement":
            result = await _handle_preview_send_install_supplement(sb, claim_id, user_id, claim_data, company_profile, tool_input)
        # ─── Phase 4: Retail tools ─────────────────────────
        elif tool_name == "create_retail_estimate":
            result = await _handle_create_retail_estimate(sb, user_id, company_profile, tool_input)
        elif tool_name == "send_company_intro_email":
            result = await _handle_send_company_intro_email(sb, user_id, company_profile, tool_input)
        elif tool_name == "send_retail_invoice":
            result = await _handle_send_retail_invoice(sb, user_id, company_profile, tool_input)
        # ─── Onboarding: create the user's first claim (Phase 1a activation) ──
        elif tool_name == "create_claim_from_minimal_input":
            result = _handle_create_claim_from_minimal_input(sb, user_id, tool_input)
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


def _handle_create_claim_from_minimal_input(sb: Client, user_id: str, tool_input: dict) -> dict:
    """Onboarding (Phase 1a activation): create the user's FIRST claim conversationally.

    The /welcome upload box has already staged the user's files under
    {user_id}/{slug}/{photos|measurements|scope}/ (authed upload route). Richard
    passes only the session `slug` + address (+ optional carrier/date_of_loss);
    this handler DISCOVERS the uploaded files by listing storage, INFERS the
    report_mode from what's present, and inserts the claim with status='uploaded'
    so the existing poller (main.poll_for_claims) processes it. No file moves, no
    second pricing path — mirrors the proven instant-intake/claim insert recipe.

    Idempotent on (user_id, slug): re-invocation returns the existing claim rather
    than creating a duplicate (the model may call this more than once). The
    backend is already brand-safe with no logo (processor renders neutral
    "Your Roofing Company"); the UI prompts for the logo AFTER the report builds.
    Returns action='complete' (auto-create — no approval gate, per product spec).
    See project_richard_onboarding_activation.
    """
    import re as _re

    slug = (tool_input.get("slug") or "").strip()
    address = (tool_input.get("address") or "").strip()
    carrier = (tool_input.get("carrier") or "").strip()
    dol = (tool_input.get("date_of_loss") or "").strip()

    # Slug must match the onboarding-session format the UI generates. Reject
    # anything else so a hallucinated slug can't point file_path at another
    # user's prefix (it's always under {user_id}/ anyway, but be strict).
    if not slug or not _re.match(r"^[A-Za-z0-9_-]{4,64}$", slug):
        return {"action": "error", "message": "Missing or invalid onboarding session id (slug)."}

    file_path = f"{user_id}/{slug}"
    BUCKET = "claim-documents"

    # Idempotency — if this onboarding session already produced a claim, return it.
    try:
        existing = (
            sb.table("claims").select("id,slug,report_mode")
            .eq("user_id", user_id).eq("slug", slug).limit(1).execute()
        )
        if existing.data:
            row = existing.data[0]
            return {
                "action": "complete",
                "message": "Your claim is already being created — hang tight.",
                "data": {"claim_id": row["id"], "slug": row["slug"], "already_existed": True},
            }
    except Exception:
        pass  # fall through to create

    def _list_folder(folder: str) -> list:
        try:
            res = sb.storage.from_(BUCKET).list(f"{file_path}/{folder}")
            return [f["name"] for f in (res or []) if f.get("id") is not None]
        except Exception:
            return []

    photos = _list_folder("photos")
    measurements = _list_folder("measurements")
    scope = _list_folder("scope")

    # Meet the user where they are — any ONE input is enough to start:
    #   photos       -> forensic causation report
    #   carrier scope -> instant supplement
    #   measurements -> Xactimate-style estimate (Doc 02 + priced code-compliance Doc 06)
    #   any combination -> full appeal package
    # Only a truly empty upload is rejected.
    if not photos and not scope and not measurements:
        return {
            "action": "error",
            "message": (
                "Nothing's staged yet. Ask the user to upload roof photos (for a forensic "
                "damage report), a measurement report like EagleView/HOVER (for an "
                "Xactimate-style estimate), and/or the carrier's scope/estimate (for a "
                "supplement) — any one is enough to start — then call this again."
            ),
        }

    # Infer report_mode (matches instant-intake + the processor's auto-upgrade
    # semantics: a second input upgrades a minimal mode toward 'full').
    if scope and not photos:
        report_mode, phase = "supplement_only", "post-scope"
    elif photos and not scope and not measurements:
        report_mode, phase = "forensic_only", "pre-scope"
    elif measurements and not photos and not scope:
        report_mode, phase = "estimate_only", "pre-scope"
    else:
        report_mode, phase = "full", ("post-scope" if scope else "pre-scope")

    payload = {
        "user_id": user_id,
        "slug": slug,
        "address": address or "Pending — please update",
        "carrier": carrier,
        "phase": phase,
        "status": "uploaded",
        "file_path": file_path,
        "report_mode": report_mode,
        "photo_files": photos or None,
        "measurement_files": measurements or None,
        "scope_files": scope or None,
        "user_notes": "[richard onboarding] first claim created conversationally",
    }
    if dol and _re.match(r"^\d{4}-\d{2}-\d{2}$", dol):
        payload["date_of_loss"] = dol

    try:
        ins = sb.table("claims").insert(payload).execute()
    except Exception as e:
        return {"action": "error", "message": f"Could not create the claim: {type(e).__name__}: {e}"}

    row = (ins.data or [{}])[0] if isinstance(ins.data, list) else (ins.data or {})
    claim_id = row.get("id")
    rslug = row.get("slug", slug)
    label = {
        "forensic_only": "forensic damage report",
        "supplement_only": "instant supplement",
        "estimate_only": "estimate / scope build",
        "full": "full appeal package",
    }.get(report_mode, "claim")

    return {
        "action": "complete",
        "message": f"Created the claim for {address or 'this property'} — building the {label} now.",
        "data": {
            "claim_id": claim_id,
            "slug": rslug,
            "report_mode": report_mode,
            "photo_count": len(photos),
            "has_scope": bool(scope),
            "has_measurements": bool(measurements),
        },
    }


def _install_supplement_items(claim_data: dict) -> list[dict]:
    """Itemize install-supplement scope for the supplement cover: line_items tagged
    scope_timing=="install_supplement" (decking allowance, hidden-damage discoveries, ...) ->
    [{description, amount}]. Single source of truth — config.line_items filtered by tag, NOT a
    separate field. These were EXCLUDED from the initial Doc 02 estimate (_is_initial_scope) and
    surface here. Ship 17 install-supplement timing model (see project_install_supplement_flow)."""
    cfg = claim_data.get("claim_config") if isinstance(claim_data, dict) else None
    line_items = (cfg or {}).get("line_items") or []
    items = []
    for li in line_items:
        if (li.get("scope_timing") or "initial") == "install_supplement":
            amount = round((li.get("qty") or 0) * (li.get("unit_price") or 0), 2)
            items.append({"description": li.get("description", ""), "amount": amount})
    return items


# ═══════════════════════════════════════════════════════════════════════
# HUMAN, VARIED CARRIER-EMAIL COPY
# ═══════════════════════════════════════════════════════════════════════
# Carrier-facing supplement / completion / AOB emails used to open with stiff
# boilerplate ("Dear {carrier} Claims Department, Please find enclosed ...").
# To an adjuster that reads as template/AI output — and identical wording
# across every USARM email screams the same thing. These helpers produce
# natural, contractor-written copy and rotate through several distinctly-worded
# variants, chosen deterministically per claim so the same claim is always
# reproducible but different claims read differently.
#
# Compliance note: CONTRACTOR mode. Factual + warm, no public-adjuster advocacy
# ("demand", "on behalf of", "appeal", statute citations). Multi-tenant — every
# company-specific token comes from variables, nothing is hardcoded to USARM.
#
# Subject lines are intentionally NOT varied for carrier sends: the platform
# rule (richard_prompts/claim/compliance_contractor_mode.md + the Gmail reply
# poller that matches on `subject:{claim_number}`, claim_brain_email.py) requires
# the bare claim number as the subject for carrier auto-routing. Only the BODY
# rotates.

# Human email-voice helpers now live in email_voice.py (single source of truth,
# shared with bulk_campaigns + main cadence). These thin shims keep every
# existing call site in this file working against that module.

def _adjuster_first_name(claim_data: dict, fallback: str = "there") -> str:
    return email_voice.adjuster_first_name(claim_data, fallback)


def _variant_index(claim_data: dict, n: int, salt: str = "") -> int:
    return email_voice.variant_index(
        claim_data.get("id") or claim_data.get("claim_id") or "",
        claim_data.get("company_id") or "",
        n=n, salt=salt,
    )


def _greeting(first_name: str) -> str:
    return email_voice.greeting(first_name)


def _sign_off(rep_name: Optional[str], company_name: str, salt: str, claim_data: dict) -> str:
    # Legacy arg order (rep, company, salt, claim) → email_voice.sign_off order.
    return email_voice.sign_off(rep_name, company_name, claim_data, salt)


def _supplement_email_body(
    claim_data: dict,
    company_profile: dict,
    *,
    items: Optional[list[dict]] = None,
    contractor_rcv: Optional[float] = None,
    coc_attached: bool = False,
    additional_notes: str = "",
    completion: bool = False,
) -> str:
    """Build a human, varied carrier-facing supplement / completion email body.

    `completion=False` → a scope-supplement note (the estimate missed some items;
    here's the supplement + supporting docs).
    `completion=True`  → a post-install completion + final-supplement note.

    Variants rotate per claim. Everything is driven by the passed-in claim /
    company variables — provider-agnostic, no hardcoded company.

    Implementation now lives in email_voice.supplement_body (shared with the
    bulk campaign + cadence paths and run through the AI-tell linter); this
    wrapper preserves the long-standing call signature."""
    return email_voice.supplement_body(
        claim_data,
        company_profile,
        items=items,
        contractor_rcv=contractor_rcv,
        coc_attached=coc_attached,
        additional_notes=additional_notes,
        completion=completion,
    )


async def _handle_supplement_email(sb, claim_id, user_id, claim_data, company_profile, tool_input):
    """Generate supplement email draft + cover letter PDF for approval."""
    from claim_brain_pdfs import generate_supplement_cover_pdf

    # Source itemized install-supplement scope from the frozen line_items (decking allowance
    # etc.) tagged scope_timing="install_supplement" — excluded from the initial Doc 02 estimate,
    # they surface on the supplement cover. (Ship 17 install-supplement consumer wiring.)
    supplement_items = _install_supplement_items(claim_data)

    # Generate supplement cover letter PDF
    pdf_bytes = generate_supplement_cover_pdf(claim_data, company_profile, supplement_items or None)

    # Upload to Supabase storage
    file_path = f"{claim_data.get('file_path', claim_id)}/brain/supplement_cover_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    sb.storage.from_("claim-documents").upload(file_path, pdf_bytes, {"content-type": "application/pdf"})

    # Subject = claim number only (carrier auto-routing + Gmail reply matching).
    # Fall back to the LLM-supplied subject if no claim number is on file yet.
    claim_number = _resolve_claim_number_or_error(claim_data)
    subject = claim_number or (tool_input.get("subject") or "").strip()

    # Human, varied body. The supplement composer used to emit stiff, identical
    # boilerplate; this rotates natural contractor-written copy per claim. Any
    # extra context the model wrote in `body` is folded in as a closing note so
    # claim-specific detail isn't lost.
    extra_note = (tool_input.get("body") or "").strip()
    # If the model handed us plain text (no tags), pass it through as a note; if
    # it handed us HTML we leave it out of the note to avoid double-formatting.
    plain_note = extra_note if (extra_note and "<" not in extra_note) else ""
    body_html = _supplement_email_body(
        claim_data,
        company_profile,
        items=supplement_items or None,
        additional_notes=plain_note,
    )

    return {
        "action": "preview",
        "type": "email",
        "tool_name": "send_supplement_email",
        "draft": {
            "to": tool_input["to_email"],
            "cc": claim_data.get("homeowner_email") if tool_input.get("cc_homeowner") else None,
            "subject": subject,
            "body_html": body_html,
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
        address = claim_data.get("address", "the property")
        # Human, varied completion-certificate note (shared pool + AI-tell linter).
        # Subject keeps the claim number when we have one (carrier routing);
        # otherwise the descriptive fallback.
        coc_body = email_voice.coc_body(claim_data, company_profile, coc_attached=True)
        claim_number = _resolve_claim_number_or_error(claim_data)
        result["draft"] = {
            "to": tool_input["send_to_email"],
            "subject": claim_number or f"Certificate of Completion — {address}",
            "body_html": coc_body,
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

    address = claim_data.get("address", "the property")

    # Human, varied AOB-submission note (shared pool + AI-tell linter). Factual,
    # contractor-neutral — homeowner authorized us, please add us to the file.
    aob_body = email_voice.aob_carrier_body(claim_data, company_profile)
    claim_number = _resolve_claim_number_or_error(claim_data)

    return {
        "action": "preview",
        "type": "email",
        "tool_name": "send_aob_to_carrier",
        "draft": {
            "to": tool_input["to_email"],
            "subject": claim_number or f"Assignment of Claim Benefits — {address}",
            "body_html": aob_body,
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
    """Draft a custom email for approval.

    Richard writes this body freely, so it's the most likely place for an
    AI-tell to slip through. Run it through the linter before the preview so
    the reviewer sees clean copy plus a heads-up on anything we flagged."""
    body_html, ai_tells = email_voice.scrub_tells(tool_input["body"])
    return {
        "action": "preview",
        "type": "email",
        "tool_name": "send_custom_email",
        "draft": {
            "to": tool_input["to_email"],
            "cc": tool_input.get("cc"),
            "subject": tool_input["subject"],
            "body_html": body_html,
            "attachments": [],
        },
        "ai_tells_cleaned": ai_tells,
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
        # Pin to the historical 0.05° (~3.5mi) radius. processor.py widened the
        # default to 0.362° (~25mi) for the forensic-report enrichment path, but
        # Richard's `get_storm_data` tool callers (homeowner Q&A, scope chats)
        # expect the tight property-centric view they had before. Bump explicitly
        # in the tool description if Tom decides to widen this later.
        client = NOAAClient(search_radius_deg=0.05)
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


def _handle_get_claim_timeline(sb: Client, claim_id: str, tool_input: dict) -> dict:
    """Return the claim_events timeline for this claim.

    Reads from the `claim_events` table (event-sourced — every milestone,
    communication, document, and action logged as it happens). The main.py
    system prompt already inlines the most recent 20 events; this tool lets
    Richard drill into the full history or filter by category.
    """
    from claim_events import get_claim_timeline  # local helper

    limit = int(tool_input.get("limit") or 50)
    limit = max(1, min(limit, 200))
    category_filter = tool_input.get("category_filter") or None

    events = get_claim_timeline(sb, claim_id, limit=limit, category_filter=category_filter)

    if not events:
        scope = f" in category '{category_filter}'" if category_filter else ""
        return {
            "action": "complete",
            "type": "claim_timeline",
            "data": {"events": [], "count": 0},
            "message": f"No events found{scope}. The timeline is populated as activity happens.",
        }

    # Compose a short human-readable summary (first 10 events) for Richard's reply
    summary_lines = []
    for ev in events[:10]:
        occurred = (ev.get("occurred_at") or "")[:10]
        cat = ev.get("event_category") or ""
        title = ev.get("title") or ev.get("event_type") or ""
        summary_lines.append(f"• {occurred} — {title} [{cat}]")
    more = f"\n…and {len(events) - 10} more" if len(events) > 10 else ""
    summary = "\n".join(summary_lines) + more

    return {
        "action": "complete",
        "type": "claim_timeline",
        "data": {"events": events, "count": len(events)},
        "message": f"Timeline ({len(events)} events):\n{summary}",
    }


def _handle_get_slope_damage(claim_data: dict, tool_input: dict) -> dict:
    """Return per-slope damage breakdown + full-reroof trigger status.

    Reads `claims.slope_damage` (aggregated by backend/slope_mapping.aggregate_slope_damage)
    and `claims.roof_facets` (extracted by extract_roof_facets). Both are written
    together on every processor run when an EagleView PDF is present.
    """
    slope_damage = claim_data.get("slope_damage") or []
    roof_facets_payload = claim_data.get("roof_facets") or {}
    facets = roof_facets_payload.get("roof_facets") if isinstance(roof_facets_payload, dict) else []
    trigger = bool(claim_data.get("full_reroof_trigger"))

    if not slope_damage and not facets:
        return {
            "action": "complete",
            "type": "slope_damage",
            "data": {
                "slopes": [],
                "total_slopes": 0,
                "full_reroof_trigger": False,
            },
            "message": (
                "No per-slope roof data available yet. This claim needs an EagleView "
                "(or equivalent) measurement PDF processed to extract facet polygons."
            ),
        }

    def _num(val, default=0.0):
        """Coerce possibly-string/null DB values to float, falling back to default."""
        if val is None:
            return default
        try:
            return float(val)
        except (TypeError, ValueError):
            return default

    min_pct = _num(tool_input.get("min_damage_pct"), 0.0)

    # Filter + enrich each slope row with a human-readable summary line.
    # Also capture the unassigned bucket separately so the LLM knows how many
    # photos couldn't be placed (signal that the area-weighted trigger may be
    # less trustworthy).
    slopes = []
    unassigned = None
    for row in slope_damage:
        if not isinstance(row, dict):
            continue
        if row.get("facet_id") == "_unassigned":
            unassigned = {
                "total_photos": int(_num(row.get("total_photos"), 0)),
                "damage_photos": int(_num(row.get("damage_photos"), 0)),
            }
            continue
        weighted = _num(row.get("weighted_damage_pct"), 0.0)
        if weighted < min_pct:
            continue
        slopes.append({
            "facet_id": row.get("facet_id"),
            "cardinal": row.get("cardinal"),
            "pitch": row.get("pitch"),
            "area_pct_of_roof": row.get("area_pct"),
            "total_photos": int(_num(row.get("total_photos"), 0)),
            "damage_photos": int(_num(row.get("damage_photos"), 0)),
            "weighted_damage_pct": weighted,
            "dominant_damage_type": row.get("dominant_damage_type"),
        })

    # Rank worst-first so the LLM sees the actionable slopes immediately.
    # Use _num on the sort key too in case any row snuck through with a None.
    slopes.sort(key=lambda s: _num(s.get("weighted_damage_pct"), 0.0), reverse=True)

    worst = slopes[0] if slopes else None
    # Count of slopes that individually would qualify (≥3 damage photos and
    # weighted >= 0.25). Useful context even when the area-weighted roof-level
    # trigger doesn't fire.
    above_threshold = sum(
        1 for s in slopes
        if (s.get("damage_photos") or 0) >= 3 and s.get("weighted_damage_pct", 0) >= 0.25
    )

    msg_parts = [f"{len(slopes)} slope(s)"]
    if worst:
        wp = int((worst.get("weighted_damage_pct") or 0) * 100)
        msg_parts.append(
            f"worst: {worst.get('facet_id')} ({worst.get('cardinal') or '—'}) at {wp}% damage"
        )
    if trigger:
        msg_parts.append("FULL REROOF TRIGGER FIRED (area-weighted ≥25% across roof)")
    elif above_threshold:
        msg_parts.append(
            f"{above_threshold} slope(s) individually qualify (≥3 damage photos @ ≥25%), "
            "but roof-level area-weighted threshold not yet met"
        )

    # reroof_justification is nested inside the persisted claim_config blob
    _cfg = claim_data.get("claim_config") if isinstance(claim_data, dict) else None
    rj = _cfg.get("reroof_justification") if isinstance(_cfg, dict) else None

    return {
        "action": "complete",
        "type": "slope_damage",
        "data": {
            "slopes": slopes,
            "total_slopes": len(slopes),
            "slopes_individually_above_threshold": above_threshold,
            "full_reroof_trigger": trigger,
            "unassigned": unassigned,  # None when all photos placed; else {total_photos, damage_photos}
            "north_arrow_angle": roof_facets_payload.get("north_arrow_angle") if isinstance(roof_facets_payload, dict) else None,
            "reroof_justification": rj,
        },
        "message": " | ".join(msg_parts),
    }


# ═══════════════════════════════════════════
# R2 — CLASSIFY UPLOADED FILE
# ═══════════════════════════════════════════

# ─────────────────────────────────────────────────────────────────────
# Shared Vision classifier core
#
# The prompt + Vision call + JSON parse below is the SINGLE source of truth
# for "what kind of insurance document is this file?". It is reused by:
#   * _handle_classify_uploaded_file — the claim_id-bound Richard tool, and
#   * classify_intake_file           — the claim-LESS intake classifier used by
#                                       POST /api/classify-intake (instant funnel +
#                                       authed drop boxes).
# Keep the prompt/labels here only — never fork them into a second copy.
# ─────────────────────────────────────────────────────────────────────

# Fine Vision labels (what the prompt asks the model to emit).
_VISION_CLASSIFY_LABELS = ("AOB", "COC", "CARRIER_SCOPE", "EAGLEVIEW",
                           "SUPPLEMENT_RESPONSE", "CONTRACT", "PHOTO", "OTHER")

_VISION_CLASSIFY_PROMPT = (
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


def _vision_doc_block(file_bytes: bytes, filename_or_path: str) -> Optional[dict]:
    """Build the multimodal content block for a file, or None if the file type
    is not Vision-supported (caller falls back to filename heuristics)."""
    lower = (filename_or_path or "").lower()
    is_pdf = lower.endswith(".pdf")
    is_image = any(lower.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"))
    b64 = base64.standard_b64encode(file_bytes).decode("utf-8")
    if is_pdf:
        return {"type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": b64}}
    if is_image:
        media = "image/jpeg"
        if lower.endswith(".png"):
            media = "image/png"
        elif lower.endswith(".webp"):
            media = "image/webp"
        return {"type": "image",
                "source": {"type": "base64", "media_type": media, "data": b64}}
    return None


def _run_vision_classification(
    file_bytes: bytes,
    filename_or_path: str,
    *,
    sb: Optional[Client] = None,
    claim_id: Optional[str] = None,
    step_name: str = "classify_uploaded_file",
) -> dict:
    """Run the shared Vision classifier on raw file bytes.

    Returns a dict ``{classification, confidence, signals, suggested_action}``
    (classification is one of _VISION_CLASSIFY_LABELS, UPPER). On any failure
    (unsupported type, Vision error, unparseable response) returns a low-confidence
    OTHER rather than raising — callers decide how to surface that. ``sb``+``claim_id``
    are optional: when present the call is metered through telemetry; when absent
    (claim-less intake) it goes straight to the Anthropic client.
    """
    doc_block = _vision_doc_block(file_bytes, filename_or_path)
    if doc_block is None:
        # Unsupported file type for Vision — caller handles the filename fallback.
        return {"classification": None, "confidence": 0.0, "signals": [], "suggested_action": ""}

    import anthropic
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    # Matches the model used elsewhere in this backend (processor, carrier_analyst,
    # repair_processor, main.py chat) so billing/quota behave predictably.
    primary_model = os.environ.get("CLAIM_BRAIN_VISION_MODEL", MODEL)
    fallback_model = os.environ.get("CLAIM_BRAIN_VISION_FALLBACK_MODEL", MODEL)

    messages = [{
        "role": "user",
        "content": [doc_block, {"type": "text", "text": _VISION_CLASSIFY_PROMPT}],
    }]

    def _call_vision(model_name: str):
        # Meter through telemetry ONLY when we have a claim to attribute spend to
        # (Ship 0.5). The claim-less intake path has no claim_id → call the client
        # directly (still our spend, but not attributable to a claim row).
        if sb is not None and claim_id:
            from telemetry import call_claude_logged
            return call_claude_logged(
                client, sb, claim_id,
                step_name=step_name,
                model=model_name,
                max_tokens=512,
                messages=messages,
            )
        return client.messages.create(model=model_name, max_tokens=512, messages=messages)

    try:
        msg = _call_vision(primary_model)
    except Exception as e_primary:
        try:
            msg = _call_vision(fallback_model)
        except Exception as e_fallback:
            # Fail open — never raise out of the classifier. OTHER + 0 confidence.
            # The `error` key lets the claim-bound handler preserve its original
            # error-surfacing contract; the claim-LESS intake path ignores it and
            # keeps the file (its whole job is to never block an upload).
            print(f"[CLASSIFY] Vision failed (primary={primary_model}: {e_primary}; "
                  f"fallback={fallback_model}: {e_fallback})", flush=True)
            return {"classification": "OTHER", "confidence": 0.0,
                    "signals": ["vision_error"], "suggested_action": "",
                    "error": (f"Vision classification failed. Primary ({primary_model}): "
                              f"{e_primary}. Fallback ({fallback_model}): {e_fallback}")}

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
    try:
        confidence = float(parsed.get("confidence") or 0.0)
    except (TypeError, ValueError):
        confidence = 0.0
    return {
        "classification": classification,
        "confidence": confidence,
        "signals": parsed.get("signals") or [],
        "suggested_action": parsed.get("suggested_action") or "",
    }


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

    # Unsupported file type for Vision → classify by filename only.
    if _vision_doc_block(file_bytes, filename or storage_path) is None:
        return _classify_by_filename(filename or storage_path, storage_path)

    vc = _run_vision_classification(file_bytes, filename or storage_path, sb=sb, claim_id=claim_id)
    # Preserve this tool's original contract: a hard Vision failure surfaces as an
    # error (the intake path, by contrast, fails open and keeps the file).
    if vc.get("error"):
        return {"action": "error", "message": vc["error"]}
    classification = vc["classification"] or "OTHER"
    confidence = vc["confidence"]
    signals = vc["signals"]
    suggested_action = vc["suggested_action"]

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


# ─────────────────────────────────────────────────────────────────────
# Intake classifier (claim-LESS) — powers POST /api/classify-intake
#
# A single drop box on the instant/onboarding/dashboard funnel can self-sort:
# this maps the fine Vision label onto one of the three intake FOLDERS the
# create-claim path infers report type from ("photos" | "measurements" |
# "scope"), plus "other" for the leftovers. It NEVER raises — on any
# failure it returns "other" (or "photos" when MIME says it's clearly an
# image) so the file is always kept and the user can correct the guess.
# ─────────────────────────────────────────────────────────────────────

# Fine Vision label  ->  intake FOLDER ("photos" | "measurements" | "scope")
_FINE_LABEL_TO_INTAKE_CATEGORY = {
    "PHOTO": "photos",
    "EAGLEVIEW": "measurements",       # measurement / aerial reports
    "CARRIER_SCOPE": "scope",          # carrier estimate / adjuster report
    "AOB": "scope",                    # claim docs ride with the scope bucket
    "COC": "scope",
    "SUPPLEMENT_RESPONSE": "scope",
    "CONTRACT": "scope",
    "OTHER": "other",
}

_IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".gif", ".bmp", ".tif", ".tiff")


def _intake_category_for_label(label: Optional[str]) -> str:
    return _FINE_LABEL_TO_INTAKE_CATEGORY.get((label or "").upper(), "other")


def _looks_like_image(filename: str, content_type: Optional[str] = None) -> bool:
    if content_type and content_type.lower().startswith("image/"):
        return True
    lower = (filename or "").lower()
    return any(lower.endswith(ext) for ext in _IMAGE_EXTS)


def classify_intake_file(
    *,
    file_bytes: Optional[bytes] = None,
    filename: str = "",
    storage_path: Optional[str] = None,
    content_type: Optional[str] = None,
    sb: Optional[Client] = None,
) -> dict:
    """Classify an intake file into an intake CATEGORY without needing a claim.

    Inputs (provide one of file_bytes OR storage_path):
      * ``file_bytes`` + ``filename``  — bytes already in hand (multipart upload), or
      * ``storage_path``               — a path in the ``claim-documents`` bucket the
                                         caller has already authorized; ``sb`` must be
                                         passed so we can download it.

    Returns ``{"category", "label", "confidence"}`` where:
      * ``category`` ∈ {"photos","measurements","scope","other"} — the intake folder, and
      * ``label``    is the fine Vision label (PHOTO/EAGLEVIEW/CARRIER_SCOPE/...), and
      * ``confidence`` is a 0-1 float.

    GUARDRAILS: this function NEVER raises. On download failure, unsupported type,
    Vision error, or unparseable output it falls back to a filename heuristic, then
    to "photos" if the file is clearly an image by extension/MIME, else "other".
    """
    name = filename or (storage_path.rsplit("/", 1)[-1] if storage_path else "")

    # Resolve bytes if only a storage path was given.
    if file_bytes is None and storage_path and sb is not None:
        try:
            file_bytes = sb.storage.from_("claim-documents").download(storage_path)
        except Exception as e:
            print(f"[CLASSIFY-INTAKE] download failed for {storage_path}: {e}", flush=True)
            file_bytes = None

    # No bytes to inspect → best-effort from the name/MIME alone (never raise).
    if not file_bytes:
        if _looks_like_image(name, content_type):
            return {"category": "photos", "label": "PHOTO", "confidence": 0.4}
        fb = _classify_by_filename(name or (storage_path or ""), storage_path or "")
        flabel = (fb.get("data", {}).get("classification") or "OTHER")
        return {
            "category": _intake_category_for_label(flabel),
            "label": flabel,
            "confidence": float(fb.get("data", {}).get("confidence") or 0.0),
        }

    # Unsupported-for-Vision file type → filename heuristic (still never raises).
    if _vision_doc_block(file_bytes, name) is None:
        if _looks_like_image(name, content_type):
            return {"category": "photos", "label": "PHOTO", "confidence": 0.4}
        fb = _classify_by_filename(name or (storage_path or ""), storage_path or "")
        flabel = (fb.get("data", {}).get("classification") or "OTHER")
        return {
            "category": _intake_category_for_label(flabel),
            "label": flabel,
            "confidence": float(fb.get("data", {}).get("confidence") or 0.0),
        }

    try:
        vc = _run_vision_classification(file_bytes, name, step_name="classify_intake_file")
    except Exception as e:  # defense-in-depth — _run_vision_classification already fails open
        print(f"[CLASSIFY-INTAKE] classify failed for {name}: {e}", flush=True)
        return {
            "category": "photos" if _looks_like_image(name, content_type) else "other",
            "label": "OTHER",
            "confidence": 0.0,
        }

    label = vc.get("classification") or "OTHER"
    confidence = float(vc.get("confidence") or 0.0)
    category = _intake_category_for_label(label)
    # Low-confidence backstop: if Vision wasn't sure but the file is obviously an
    # image, keep it as a photo rather than dumping it in "other".
    if category == "other" and confidence < 0.5 and _looks_like_image(name, content_type):
        return {"category": "photos", "label": "PHOTO", "confidence": confidence}
    return {"category": category, "label": label, "confidence": confidence}


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


def _handle_preview_upload_user_estimate(claim_data: dict, tool_input: dict) -> dict:
    """Preview for upload_user_estimate. Sanitizes line_items the same way
    /api/claim/upload-estimate does, then returns a preview the user must
    approve. On approval, the execution path (in main.py) writes
    claim_config.line_items + manual_scope_locked=true and triggers reprocess.
    """
    raw_items = tool_input.get("line_items")
    if not isinstance(raw_items, list):
        return {"action": "error", "message": "line_items must be an array."}
    if not raw_items:
        return {"action": "error", "message": "line_items cannot be empty."}
    if len(raw_items) > 500:
        return {"action": "error", "message": f"line_items too large ({len(raw_items)} provided; 500 max)."}

    cleaned: list[dict] = []
    for i, raw in enumerate(raw_items):
        if not isinstance(raw, dict):
            return {"action": "error", "message": f"line_items[{i}] must be an object."}
        description = (raw.get("description") or "").strip() if isinstance(raw.get("description"), str) else ""
        if not description:
            return {"action": "error", "message": f"line_items[{i}].description is required."}
        try:
            qty = float(raw.get("qty"))
            if qty <= 0:
                raise ValueError("non-positive")
        except (TypeError, ValueError):
            return {"action": "error", "message": f"line_items[{i}].qty must be a positive number."}
        try:
            unit_price = float(raw.get("unit_price"))
            if unit_price < 0:
                raise ValueError("negative")
        except (TypeError, ValueError):
            return {"action": "error", "message": f"line_items[{i}].unit_price must be a non-negative number."}
        cleaned.append({
            "description": description,
            "qty": qty,
            "unit": (raw.get("unit") or "EA").strip() if isinstance(raw.get("unit"), str) else "EA",
            "unit_price": unit_price,
            "category": (raw.get("category") or "GENERAL").strip().upper() if isinstance(raw.get("category"), str) else "GENERAL",
            "trade": (raw.get("trade") or "general").strip().lower() if isinstance(raw.get("trade"), str) else "general",
            "xactimate_code": (raw.get("xactimate_code") or "").strip() if isinstance(raw.get("xactimate_code"), str) else "",
            "source": "user_uploaded",
        })

    total = sum(it["qty"] * it["unit_price"] for it in cleaned)
    reason = (tool_input.get("reason") or "").strip()

    return {
        "action": "preview",
        "type": "upload_user_estimate",
        "tool_name": "upload_user_estimate",
        "preview": {
            "action_label": "Upload User Estimate",
            "claim_address": claim_data.get("address"),
            "line_items_count": len(cleaned),
            "estimate_total": round(total, 2),
            "reason": reason or None,
            "side_effects": [
                "Replaces claim_config.line_items with the uploaded items",
                "Sets manual_scope_locked=true (future reprocesses won't overwrite prices)",
                "Triggers a reprocess so scope_comparison + supplement composer + PDFs rebuild",
            ],
            "line_items": cleaned,  # included so the approval UI can show a diff
        },
        "message": (
            f"Ready to replace the platform estimate with {len(cleaned)} user-supplied line items "
            f"(total ${total:,.2f}). Future reprocesses will preserve these prices."
        ),
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

    # Richard-authored forensic cover body → run the AI-tell linter before the
    # adjuster ever sees it, surfacing what we cleaned on the preview card.
    body_html, ai_tells = email_voice.scrub_tells(body_html)

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
            "ai_tells_cleaned": ai_tells,
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
# ADMIN / ONBOARDING INTEGRATIONS
#
# Step-by-step setup playbooks Richard walks users through. Each service
# has: where to sign in, exact menu path to get the API key, gotchas,
# and the DumbRoof capabilities unlocked once connected.
# ═══════════════════════════════════════════

_INTEGRATION_PLAYBOOK = {
    "microsoft_365": {
        "display_name": "Microsoft 365 / Outlook",
        "category": "Email",
        "auth_type": "OAuth 2.0 (Microsoft Entra ID)",
        "db_fields": ["microsoft_refresh_token", "microsoft_email", "microsoft_connected_at"],
        "status": "coming_soon",
        "unlocks": [
            "Send all carrier emails from YOUR @yourcompany.com Microsoft-hosted address",
            "Richard searches your Outlook inbox for carrier replies matching claim numbers",
            "Automatic classification of incoming adjuster emails",
        ],
        "steps": [
            "⚠️ Microsoft 365 OAuth is NOT live yet — we're finalizing the Azure AD app registration.",
            "Expected live date: within 2-3 weeks. In the meantime, you have two options:",
            "  • **Option A**: Connect via generic SMTP (app password). Works today. See the "
            "'Generic SMTP' setup guide.",
            "  • **Option B**: Use claims@dumbroof.ai as your sender (your company name is in the "
            "display name). Works immediately with zero setup.",
            "When Microsoft OAuth lands, you'll click 'Connect Outlook' in Settings → Email "
            "Integration, sign in with your Microsoft 365 credentials, and approve Mail.Send + "
            "Mail.Read scopes. Microsoft consent screen is cleaner than Google's — no scary "
            "warning.",
        ],
        "gotchas": [
            "Microsoft 365 admins: your tenant may require admin consent for third-party apps. "
            "If OAuth fails, ask your IT admin to grant tenant-wide consent OR grant it user-by-user.",
            "Shared mailboxes aren't directly supported via personal OAuth — use the mailbox owner's account.",
        ],
    },
    "generic_smtp": {
        "display_name": "Generic SMTP (Custom Email Provider)",
        "category": "Email",
        "auth_type": "SMTP credentials (app password)",
        "db_fields": ["smtp_host", "smtp_port", "smtp_username", "smtp_password_encrypted", "smtp_from_email"],
        "unlocks": [
            "Send emails from ANY provider: GoDaddy, Namecheap, Zoho, self-hosted Exchange, Yahoo, custom domain, etc.",
            "Your @yourcompany.com shows as the sender — carriers see you, not DumbRoof",
            "Fallback for providers without OAuth (which is most non-Google/non-Microsoft providers)",
        ],
        "steps": [
            "Find your email provider's SMTP settings. Common ones:",
            "  • **GoDaddy / Microsoft 365 (non-OAuth)**: smtp.office365.com, port 587, STARTTLS",
            "  • **Yahoo**: smtp.mail.yahoo.com, port 465 or 587",
            "  • **Zoho**: smtp.zoho.com, port 465 or 587",
            "  • **Namecheap Private Email**: mail.privateemail.com, port 465 or 587",
            "  • **Custom domain via your own mail server**: check with your IT",
            "Generate an **app password** (NOT your regular password) — most providers require this "
            "for third-party SMTP access. Usually in Account Security → App Passwords.",
            "Provide these values here or in Settings → Email:\n"
            "  - SMTP host (e.g. smtp.office365.com)\n"
            "  - SMTP port (usually 587 for STARTTLS or 465 for SSL)\n"
            "  - SMTP username (usually your full email address)\n"
            "  - App password (NOT your regular login password)\n"
            "  - From email (your display 'from' address, usually same as username)",
            "We send a test email to verify the credentials work. If it fails, we'll tell you "
            "what went wrong.",
        ],
        "gotchas": [
            "Regular passwords almost never work — providers require app passwords for third-party SMTP. "
            "If you don't see an 'app passwords' option, 2FA may need to be enabled first.",
            "SMTP passwords are encrypted at rest in our DB. Only the SMTP send process can decrypt them.",
            "Some providers (Outlook.com free accounts) have disabled SMTP for new accounts entirely — "
            "if you hit this, use Microsoft 365 OAuth instead once it's live.",
        ],
    },
    "gmail": {
        "display_name": "Gmail",
        "category": "Email",
        "auth_type": "OAuth 2.0 (Google sign-in)",
        "db_fields": ["gmail_refresh_token", "sending_email"],
        "unlocks": [
            "Send supplement, AOB, COC emails from YOUR @yourcompany.com address (not claims@dumbroof.ai)",
            "Richard can search your inbox for carrier replies matching claim numbers",
            "Carrier email polling — new adjuster responses auto-classified + routed",
        ],
        "steps": [
            "Go to Settings → Email Integration in the DumbRoof dashboard.",
            "Click 'Connect Gmail'. You'll be redirected to Google sign-in.",
            "IMPORTANT: you will see a 'Google hasn't verified this app' warning — "
            "this is normal, we're still in OAuth review. Click 'Advanced' → "
            "'Go to DumbRoof (unsafe)' to continue. Once Google approves our app, "
            "this warning will go away.",
            "Grant the 3 requested scopes: send, readonly, modify. (Read-only is "
            "used ONLY to find emails with your claim numbers in the subject — "
            "we never access personal email.)",
            "You'll be redirected back to DumbRoof with Gmail connected.",
        ],
        "gotchas": [
            "Google Workspace admins: may need to whitelist dumbroof.ai as an "
            "allowed third-party app. Admin Console → Security → API controls.",
            "If you disconnect and reconnect, your refresh token updates — no action needed.",
        ],
    },
    "companycam": {
        "display_name": "CompanyCam",
        "category": "Photo management",
        "auth_type": "API Key",
        "db_fields": ["companycam_api_key", "companycam_connected_at"],
        "unlocks": [
            "Import photos from any CompanyCam project directly into a claim",
            "Richard can pull CompanyCam photos when you drop a file in chat",
            "Photo annotations sync with CompanyCam comments",
        ],
        "steps": [
            "Sign in to app.companycam.com.",
            "Click your profile avatar (top right) → **API Keys**.",
            "Click **Create New Key**. Name it 'DumbRoof'. Copy the key immediately — "
            "you can't view it again.",
            "Paste the key in DumbRoof Settings → Integrations → CompanyCam, OR "
            "paste it here and I'll save it for you.",
        ],
        "gotchas": [
            "CompanyCam keys are account-wide, not project-scoped. Anyone with the "
            "key can read ALL your projects.",
            "If your CompanyCam account has multiple admins, decide who owns the key.",
        ],
    },
    "acculynx": {
        "display_name": "AccuLynx",
        "category": "CRM / Job management",
        "auth_type": "API Key",
        "db_fields": ["acculynx_api_key", "acculynx_connected_at"],
        "unlocks": [
            "Create AccuLynx jobs automatically from DumbRoof claims",
            "Sync claim status back to AccuLynx (won / lost / active)",
            "Richard can look up job details by homeowner address",
        ],
        "steps": [
            "Sign in to app.acculynx.com.",
            "Go to **Settings → Integrations → API Access**. (You may need admin "
            "permission — ask your AccuLynx admin if you don't see it.)",
            "Click **Generate New Key**. Name it 'DumbRoof' so you can revoke it "
            "cleanly if needed.",
            "Copy the key and paste it in DumbRoof Settings → Integrations → "
            "AccuLynx. Or tell me the key and I'll save it.",
        ],
        "gotchas": [
            "AccuLynx API rate limits: 100 req/min per key. We stay well under.",
            "If you're on AccuLynx Basic, API access may not be included — "
            "check your subscription tier.",
        ],
    },
    "roofr": {
        "display_name": "Roofr",
        "category": "Estimating / measurements",
        "auth_type": "API Key",
        "db_fields": ["roofr_api_key", "roofr_connected_at"],
        "unlocks": [
            "Pull Roofr measurement reports directly into a claim (replaces uploading PDF)",
            "Sync Roofr estimates with DumbRoof line items",
            "Richard can check if a Roofr measurement exists for the address",
        ],
        "steps": [
            "Sign in to app.roofr.com.",
            "Click your profile (top right) → **Account Settings → Integrations**.",
            "Look for 'DumbRoof' or 'API Access'. If not listed, contact "
            "support@roofr.com — Roofr is actively expanding their partner API.",
            "Copy the key and paste it here, or in Settings → Integrations → Roofr.",
        ],
        "gotchas": [
            "Roofr's partner API is still rolling out as of 2026 — you may need "
            "to specifically request API access from their team.",
        ],
    },
    "hover": {
        "display_name": "Hover",
        "category": "Measurements",
        "auth_type": "API Key",
        "db_fields": ["hover_api_key", "hover_connected_at"],
        "unlocks": [
            "Import Hover 3D measurement reports (pitch-level areas + facet counts)",
            "Richard uses Hover data as the canonical EagleView replacement when no EagleView is uploaded",
            "Hover's siding sq footage feeds directly into the estimate",
        ],
        "steps": [
            "Sign in to app.hover.to.",
            "Go to **Settings → API & Integrations** (or Developer Settings on some accounts).",
            "Click **Generate API Key**. Name: 'DumbRoof'.",
            "Copy the key. Paste it here or in Settings → Integrations → Hover.",
        ],
        "gotchas": [
            "Hover key is per-user, not per-company. If multiple people on your team use "
            "Hover, each can connect their own key.",
            "Hover has 'Commercial' vs 'Residential' API endpoints — we query both automatically.",
        ],
    },
    "gaf_quickmeasure": {
        "display_name": "GAF QuickMeasure",
        "category": "Measurements (GAF)",
        "auth_type": "API Key",
        "db_fields": ["gaf_quickmeasure_api_key", "gaf_quickmeasure_connected_at"],
        "unlocks": [
            "Order QuickMeasure reports directly from DumbRoof",
            "Pull delivered QuickMeasure PDFs into a claim automatically",
            "Richard can check QuickMeasure availability for an address",
        ],
        "steps": [
            "Sign in to contractors.gaf.com (GAF Pro Portal).",
            "Navigate to **Tools → QuickMeasure → API Settings**. (Only visible "
            "to GAF Certified Contractors.)",
            "Click **Generate Key**. Copy it.",
            "Paste the key in DumbRoof Settings → Integrations → GAF QuickMeasure, or here.",
        ],
        "gotchas": [
            "GAF QuickMeasure API is gated to GAF Certified Contractors only. "
            "If you're not certified, contact GAF at 1-800-ROOF-411 about the "
            "contractor program.",
            "QuickMeasure reports are billed per-order. Your GAF account handles billing, not us.",
        ],
    },
    "jobnimbus": {
        "display_name": "JobNimbus",
        "category": "CRM",
        "auth_type": "API Key",
        "db_fields": ["jobnimbus_api_key", "jobnimbus_connected_at"],
        "unlocks": [
            "Create JobNimbus jobs from DumbRoof claims",
            "Sync status back — won claims appear as Won jobs in JobNimbus",
            "Richard can pull contact info by homeowner name",
        ],
        "steps": [
            "Sign in to app.jobnimbus.com.",
            "Click your avatar → **Settings → API**.",
            "Click **Generate API Key**. Copy it. Set expiration to 'Never' (or your "
            "company's preferred rotation interval).",
            "Paste the key here or in Settings → Integrations → JobNimbus.",
        ],
        "gotchas": [
            "JobNimbus uses per-user keys. If your team wants shared access, create a "
            "dedicated 'DumbRoof Integration' user and generate the key from that account.",
        ],
    },
    "servicetitan": {
        "display_name": "ServiceTitan",
        "category": "CRM / Operations",
        "auth_type": "OAuth client credentials (tenant + client_id + client_secret)",
        "db_fields": ["servicetitan_tenant_id", "servicetitan_client_id", "servicetitan_client_secret", "servicetitan_connected_at"],
        "unlocks": [
            "Create ServiceTitan jobs from DumbRoof claims",
            "Sync estimate data into the ServiceTitan job record",
            "Pull customer records for auto-filling homeowner info",
        ],
        "steps": [
            "Sign in to **go.servicetitan.com** as an admin.",
            "Go to **Settings → Integrations → API Application Access**. (Admin-only.)",
            "Click **Connect New App** → search for 'DumbRoof' in the marketplace. "
            "If not listed, create a custom integration: **Settings → Developer → "
            "Create new application**.",
            "Approve the required scopes: JPM (Job Management), Customers, Invoices, Forms.",
            "Copy the three values: **Tenant ID**, **Client ID**, **Client Secret**.",
            "Paste all three in Settings → Integrations → ServiceTitan, or give them "
            "to me here.",
        ],
        "gotchas": [
            "ServiceTitan's API is only available on their Advanced or Enterprise tiers — "
            "if you're on Starter, contact your ServiceTitan rep.",
            "Client secrets are shown ONCE. If you don't copy it, you have to regenerate.",
            "ServiceTitan rate limit: 1200 req/hour per app. We batch requests to stay under.",
        ],
    },
}


def _handle_list_integrations(sb: Client, user_id: str) -> dict:
    if not user_id:
        return {"action": "error", "message": "No user_id in request context."}
    try:
        res = sb.table("company_profiles").select("*").eq("user_id", user_id).limit(1).execute()
        profile = (res.data or [{}])[0] if res.data else {}
    except Exception as e:
        return {"action": "error", "message": f"Profile lookup failed: {e}"}

    def _status(key: str) -> str:
        v = profile.get(key)
        return "connected" if v else "not_connected"

    integrations = {
        "gmail": {
            "connected": bool(profile.get("gmail_refresh_token")),
            "sending_email": profile.get("sending_email") or profile.get("email"),
        },
        "microsoft_365": {
            "connected": bool(profile.get("microsoft_refresh_token")),
            "sending_email": profile.get("microsoft_email"),
            "status": "coming_soon",
        },
        "generic_smtp": {
            "connected": bool(profile.get("smtp_host") and profile.get("smtp_password_encrypted")),
            "sending_email": profile.get("smtp_from_email"),
        },
        "companycam": {
            "connected": bool(profile.get("companycam_api_key")),
            "connected_at": profile.get("companycam_connected_at"),
        },
        "acculynx": {
            "connected": bool(profile.get("acculynx_api_key")),
            "connected_at": profile.get("acculynx_connected_at"),
        },
        "roofr": {
            "connected": bool(profile.get("roofr_api_key")),
            "connected_at": profile.get("roofr_connected_at"),
        },
        "hover": {
            "connected": bool(profile.get("hover_api_key")),
            "connected_at": profile.get("hover_connected_at"),
        },
        "gaf_quickmeasure": {
            "connected": bool(profile.get("gaf_quickmeasure_api_key")),
            "connected_at": profile.get("gaf_quickmeasure_connected_at"),
        },
        "jobnimbus": {
            "connected": bool(profile.get("jobnimbus_api_key")),
            "connected_at": profile.get("jobnimbus_connected_at"),
        },
        "servicetitan": {
            "connected": bool(profile.get("servicetitan_client_secret")),
            "connected_at": profile.get("servicetitan_connected_at"),
        },
    }

    # Profile completeness
    profile_fields = ["company_name", "address", "city_state_zip", "email", "phone", "logo_path", "contact_name"]
    profile_completeness = {
        f: bool(profile.get(f)) for f in profile_fields
    }
    profile_complete = all(profile_completeness.values())

    connected_count = sum(1 for v in integrations.values() if v["connected"])

    return {
        "action": "complete",
        "type": "integrations_status",
        "data": {
            "integrations": integrations,
            "connected_count": connected_count,
            "total_count": len(integrations),
            "profile_completeness": profile_completeness,
            "profile_complete": profile_complete,
        },
        "message": (
            f"{connected_count}/{len(integrations)} integrations connected. "
            + ("Company profile complete." if profile_complete
               else "Profile missing: " + ", ".join([k for k, v in profile_completeness.items() if not v]) + ".")
        ),
    }


def _handle_get_integration_setup_guide(tool_input: dict) -> dict:
    service = (tool_input.get("service") or "").strip().lower()
    guide = _INTEGRATION_PLAYBOOK.get(service)
    if not guide:
        return {"action": "error", "message": f"Unknown service '{service}'. Known: {list(_INTEGRATION_PLAYBOOK.keys())}"}

    return {
        "action": "complete",
        "type": "integration_setup_guide",
        "data": {
            "service": service,
            **guide,
        },
        "message": f"Setup guide for {guide['display_name']} ({len(guide['steps'])} steps, unlocks {len(guide['unlocks'])} capabilities).",
    }


_KEY_SERVICE_FIELDS = {
    "companycam": {"api_key": "companycam_api_key", "connected_at": "companycam_connected_at"},
    "acculynx": {"api_key": "acculynx_api_key", "connected_at": "acculynx_connected_at"},
    "roofr": {"api_key": "roofr_api_key", "connected_at": "roofr_connected_at"},
    "hover": {"api_key": "hover_api_key", "connected_at": "hover_connected_at"},
    "gaf_quickmeasure": {"api_key": "gaf_quickmeasure_api_key", "connected_at": "gaf_quickmeasure_connected_at"},
    "jobnimbus": {"api_key": "jobnimbus_api_key", "connected_at": "jobnimbus_connected_at"},
    "servicetitan": {
        "client_secret": "servicetitan_client_secret",
        "client_id": "servicetitan_client_id",
        "tenant_id": "servicetitan_tenant_id",
        "connected_at": "servicetitan_connected_at",
    },
    # generic_smtp has multi-field payload — save_integration_key doesn't
    # cleanly fit. Users should go through the dedicated /api/smtp/save
    # endpoint (which encrypts the password + test-sends before storing).
    # We keep the entry for completeness but the approve dispatcher will
    # route SMTP to the dedicated path.
    "generic_smtp": {
        "_uses_dedicated_endpoint": "POST /api/smtp/save",
    },
}


def _handle_preview_save_integration_key(sb: Client, user_id: str, tool_input: dict) -> dict:
    service = (tool_input.get("service") or "").strip().lower()
    api_key = (tool_input.get("api_key") or "").strip()

    if not user_id:
        return {"action": "error", "message": "No user_id in request context."}
    if not service or not api_key:
        return {"action": "error", "message": "service and api_key are required"}
    if service not in _KEY_SERVICE_FIELDS:
        return {"action": "error", "message": f"Can't save keys for '{service}'. Use OAuth for Gmail."}

    # Basic length sanity
    if len(api_key) < 10:
        return {"action": "error", "message": "API key looks too short — double-check you copied the full key."}

    playbook = _INTEGRATION_PLAYBOOK.get(service, {})
    # Mask for preview display — show first 4 + last 4, never full value
    masked = api_key[:4] + "…" + api_key[-4:] if len(api_key) > 10 else "…"

    preview_extra: dict = {}
    if service == "servicetitan":
        for field in ("tenant_id", "client_id"):
            val = (tool_input.get(field) or "").strip()
            if not val:
                return {"action": "error", "message": f"ServiceTitan requires tenant_id, client_id, AND client_secret. Missing: {field}"}
            preview_extra[field] = val

    return {
        "action": "preview",
        "type": "save_integration_key",
        "tool_name": "save_integration_key",
        "preview": {
            "action_label": f"Save {playbook.get('display_name', service)} API key",
            "service": service,
            "display_name": playbook.get("display_name", service),
            "api_key_masked": masked,
            "api_key": api_key,  # not displayed; used by execute path
            "unlocks": playbook.get("unlocks", []),
            **preview_extra,
        },
        "message": f"Ready to save {playbook.get('display_name', service)} key ({masked}). Unlocks {len(playbook.get('unlocks', []))} capabilities.",
    }


def _handle_preview_invite_team_member(sb: Client, user_id: str, tool_input: dict) -> dict:
    email = (tool_input.get("email") or "").strip().lower()
    role = (tool_input.get("role") or "user").strip().lower()
    name = tool_input.get("name") or ""

    if not email or "@" not in email:
        return {"action": "error", "message": "Valid email is required."}
    if role not in ("admin", "user"):
        return {"action": "error", "message": "role must be 'admin' or 'user'"}

    # Look up inviting user's company domain for context
    inviter_company = ""
    try:
        if user_id:
            res = sb.table("company_profiles").select("company_name, email").eq("user_id", user_id).limit(1).execute()
            prof = (res.data or [{}])[0] if res.data else {}
            inviter_company = prof.get("company_name") or ""
    except Exception:
        pass

    return {
        "action": "preview",
        "type": "invite_team_member",
        "tool_name": "invite_team_member",
        "preview": {
            "action_label": "Invite Team Member",
            "email": email,
            "role": role,
            "name": name or None,
            "company": inviter_company,
        },
        "message": f"Ready to invite {email} as {role}" + (f" to {inviter_company}" if inviter_company else "") + ".",
    }


# ═══════════════════════════════════════════
# BRANDING / PROFILE / OAUTH
#
# Tools for setting company logo, updating profile fields, and starting OAuth
# flows for CRM/measurement providers. Mutating tools return preview cards
# that the user approves before commit.
# ═══════════════════════════════════════════


# Public OAuth-redirect base URLs. Backend webhook URL pattern:
#   GET /api/oauth/{service}/callback?state=<user_id>&code=<...>
# (callback handlers are out of scope here — see backend/oauth_callbacks.py
# in a follow-up; for now the connect_crm tool returns the URL and the user
# completes the flow in their browser.)
OAUTH_AUTHORIZE_URLS: dict[str, str] = {
    "hover": "https://app.hover.to/oauth/authorize",
    "roofr": "https://app.roofr.com/oauth/authorize",
    "jobnimbus": "https://app.jobnimbus.com/oauth/authorize",
    "servicetitan": "https://auth.servicetitan.io/connect/authorize",
    "salesforce": "https://login.salesforce.com/services/oauth2/authorize",
    "hubspot": "https://app.hubspot.com/oauth/authorize",
    "acculynx_oauth": "https://app.acculynx.com/oauth/authorize",
}

# Column names per service for stored credentials. Used by disconnect_integration.
SERVICE_COLUMNS: dict[str, list[str]] = {
    "companycam": ["companycam_api_key", "companycam_connected_at"],
    "acculynx": ["acculynx_api_key", "acculynx_connected_at"],
    "acculynx_oauth": ["acculynx_oauth_token", "acculynx_oauth_refresh_token", "acculynx_connected_at"],
    "roofr": ["roofr_api_key", "roofr_oauth_token", "roofr_oauth_refresh_token", "roofr_connected_at"],
    "hover": ["hover_api_key", "hover_oauth_token", "hover_oauth_refresh_token", "hover_connected_at"],
    "gaf_quickmeasure": ["gaf_api_key", "gaf_connected_at"],
    "jobnimbus": ["jobnimbus_api_key", "jobnimbus_oauth_token", "jobnimbus_oauth_refresh_token", "jobnimbus_connected_at"],
    "servicetitan": ["servicetitan_api_key", "servicetitan_tenant_id", "servicetitan_client_id", "servicetitan_client_secret", "servicetitan_oauth_token", "servicetitan_connected_at"],
    "gmail": ["gmail_oauth_token", "gmail_oauth_refresh_token", "gmail_connected_at"],
    "microsoft_365": ["microsoft_oauth_token", "microsoft_oauth_refresh_token", "microsoft_connected_at"],
    "generic_smtp": ["smtp_host", "smtp_port", "smtp_username", "smtp_password_encrypted", "smtp_from_email", "smtp_connected_at"],
    "salesforce": ["salesforce_oauth_token", "salesforce_oauth_refresh_token", "salesforce_connected_at"],
    "hubspot": ["hubspot_oauth_token", "hubspot_oauth_refresh_token", "hubspot_connected_at"],
}


def _handle_preview_upload_company_logo(sb: Client, user_id: str, tool_input: dict) -> dict:
    storage_path = (tool_input.get("storage_path") or "").strip()
    filename = (tool_input.get("filename") or "").strip()
    if not storage_path:
        return {"action": "error", "message": "storage_path is required (the uploaded image's Supabase path)."}

    # Try to build a preview signed URL for the approval card
    preview_url: Optional[str] = None
    try:
        signed = sb.storage.from_("company-assets").create_signed_url(storage_path, 600)
        preview_url = signed.get("signedURL") or signed.get("signed_url")
    except Exception:
        pass

    return {
        "action": "preview",
        "type": "upload_company_logo",
        "tool_name": "upload_company_logo",
        "preview": {
            "action_label": "Set Company Logo",
            "filename": filename or storage_path.split("/")[-1],
            "storage_path": storage_path,
            "preview_url": preview_url,
        },
        "message": f"Ready to set this image as your company logo: {filename or storage_path}.",
    }


def _handle_preview_update_company_profile(sb: Client, user_id: str, tool_input: dict) -> dict:
    """Build a diff preview between current profile and proposed changes."""
    fields = ["company_name", "address", "city_state_zip", "contact_name", "email", "phone", "license_number", "brand_color", "website"]
    proposed = {k: tool_input[k].strip() for k in fields if isinstance(tool_input.get(k), str) and tool_input[k].strip()}

    if not proposed:
        return {"action": "error", "message": "No profile fields supplied."}

    if "brand_color" in proposed:
        bc = proposed["brand_color"]
        if not (bc.startswith("#") and len(bc) in (4, 7)):
            return {"action": "error", "message": "brand_color must be a hex code, e.g. #6366F1."}

    try:
        res = sb.table("company_profiles").select(",".join(fields)).eq("user_id", user_id).limit(1).execute()
        current = (res.data or [{}])[0] if res.data else {}
    except Exception:
        current = {}

    diff = []
    for k, new_val in proposed.items():
        old_val = current.get(k) or ""
        if (old_val or "") == new_val:
            continue
        diff.append({"field": k, "from": old_val, "to": new_val})

    if not diff:
        return {"action": "complete", "message": "No changes — submitted values match the current profile.", "data": {"changed": []}}

    return {
        "action": "preview",
        "type": "update_company_profile",
        "tool_name": "update_company_profile",
        "preview": {
            "action_label": "Update Company Profile",
            "diff": diff,
        },
        "message": f"Ready to update {len(diff)} profile field{'s' if len(diff) != 1 else ''}.",
    }


def _handle_connect_crm(sb: Client, user_id: str, tool_input: dict) -> dict:
    """Return an OAuth authorize URL for the chosen service. Non-mutating: no approval gate."""
    service = (tool_input.get("service") or "").lower().strip()
    base = OAUTH_AUTHORIZE_URLS.get(service)
    if not base:
        return {"action": "error", "message": f"Unknown OAuth service: {service}. Use save_integration_key for API-key services instead."}

    public_origin = os.environ.get("PUBLIC_BACKEND_ORIGIN") or os.environ.get("BACKEND_URL") or "https://api.dumbroof.ai"
    redirect_uri = f"{public_origin}/api/oauth/{service}/callback"
    state = base64.urlsafe_b64encode(f"{user_id}:{int(time.time())}".encode()).decode().rstrip("=")
    client_id_env = f"{service.upper()}_OAUTH_CLIENT_ID"
    client_id = os.environ.get(client_id_env) or "<not_configured>"

    from urllib.parse import urlencode
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "state": state,
    }
    authorize_url = f"{base}?{urlencode(params)}"

    configured = client_id != "<not_configured>"

    return {
        "action": "complete",
        "type": "oauth_redirect",
        "tool_name": "connect_crm",
        "data": {
            "service": service,
            "authorize_url": authorize_url if configured else None,
            "redirect_uri": redirect_uri,
            "configured": configured,
            "missing_env_var": None if configured else client_id_env,
        },
        "message": (
            f"Click to authorize {service.replace('_', ' ').title()}." if configured
            else f"OAuth not yet configured for {service}. Set {client_id_env} on the backend, then retry."
        ),
    }


def _companycam_connected(sb: Client, user_id: str) -> bool:
    """True if the user (or a company admin via the shared-key fallback) has a
    CompanyCam API key on file. Mirrors the resolution order in main's
    _get_user_integration_client (own profile → company admin), but only checks
    presence — it never returns the key itself."""
    if not user_id:
        return False
    try:
        res = sb.table("company_profiles").select(
            "companycam_api_key, company_id"
        ).eq("user_id", user_id).limit(1).execute()
        prof = (res.data or [{}])[0] if res.data else {}
    except Exception:
        return False
    if prof.get("companycam_api_key"):
        return True
    company_id = prof.get("company_id")
    if company_id:
        try:
            admin = sb.table("company_profiles").select("companycam_api_key").eq(
                "company_id", company_id).eq("is_admin", True).execute()
            return any(a.get("companycam_api_key") for a in (admin.data or []))
        except Exception:
            return False
    return False


_COMPANYCAM_NOT_CONNECTED = {
    "action": "error",
    "message": (
        "CompanyCam isn't connected yet. Ask the user for their CompanyCam API key "
        "(CompanyCam → Account → Integrations → Access Tokens), then save it with "
        "save_integration_key(service='companycam', api_key=...) — or have their "
        "company admin connect it — and try again."
    ),
}


async def _handle_list_companycam_projects(sb: Client, user_id: str, tool_input: dict) -> dict:
    """List the user's CompanyCam projects (read-only). Requires a connected key."""
    if not _companycam_connected(sb, user_id):
        return _COMPANYCAM_NOT_CONNECTED

    query = (tool_input.get("query") or "").strip()
    try:
        page = int(tool_input.get("page") or 1)
    except (TypeError, ValueError):
        page = 1
    if page < 1:
        page = 1

    # Reuse main's resolver (own key → company-admin fallback) + the CompanyCam client.
    from main import _get_user_integration_client  # type: ignore
    from integrations.companycam import CompanyCamAuthError, CompanyCamUnavailableError
    try:
        client = await _get_user_integration_client(user_id, "companycam")
        projects = await client.search_projects(query=query, page=page)
    except CompanyCamAuthError as e:
        return {"action": "error", "message": f"CompanyCam rejected the saved key — ask the user to reconnect it. ({e})"}
    except CompanyCamUnavailableError as e:
        return {"action": "error", "message": f"CompanyCam is unreachable right now — try again shortly. ({e})"}
    except Exception as e:
        return {"action": "error", "message": f"Couldn't list CompanyCam projects: {type(e).__name__}: {e}"}

    # Trim each project to the fields the chat needs to present a pick-list.
    slim = []
    for p in (projects or []):
        addr = p.get("address") if isinstance(p.get("address"), dict) else {}
        addr_str = ", ".join(
            str(addr.get(k)) for k in ("street_address_1", "city", "state") if addr.get(k)
        ) if isinstance(addr, dict) else ""
        slim.append({
            "project_id": p.get("id"),
            "name": p.get("name"),
            "address": addr_str or (p.get("name") or ""),
            "photo_count": p.get("photo_count"),
            "status": p.get("status"),
        })

    return {
        "action": "complete",
        "type": "companycam_projects",
        "data": {"projects": slim, "page": page, "count": len(slim)},
        "message": (
            f"Found {len(slim)} CompanyCam project(s)"
            + (f" matching '{query}'" if query else "")
            + ". Ask the user which one to import, then call import_companycam_photos with its project_id."
            if slim else
            "No CompanyCam projects found"
            + (f" matching '{query}'" if query else "")
            + ". Try a different search, or confirm the project exists in CompanyCam."
        ),
    }


async def _handle_import_companycam_photos(
    sb: Client, bound_claim_id: str, user_id: str, tool_input: dict
) -> dict:
    """Import a CompanyCam project's photos into a claim.

    Target claim = explicit ``claim_id`` arg if given, else the chat's bound
    claim_id. The dashboard/onboarding Richard runs with the sentinel
    ``"admin"`` claim_id, so it MUST pass claim_id explicitly. Cross-tenant safe:
    the caller must own the claim or share its company_id (_user_can_access_claim).
    Photos land in the CLAIM's own storage area (claim.file_path/photos), not the
    chatting user's, so a teammate import writes to the right place.
    """
    project_id = (tool_input.get("project_id") or "").strip()
    if not project_id:
        return {"action": "error", "message": "project_id is required (get it from list_companycam_projects)."}

    if not _companycam_connected(sb, user_id):
        return _COMPANYCAM_NOT_CONNECTED

    # Resolve the target claim id (explicit arg wins; else the bound chat claim).
    target_claim_id = (tool_input.get("claim_id") or "").strip() or (bound_claim_id or "")
    if not target_claim_id or target_claim_id == "admin":
        return {
            "action": "error",
            "message": (
                "No claim to import into. From the dashboard, pass claim_id for the "
                "claim you want the photos on (or open the claim and run this inside it)."
            ),
        }

    # Load + authorize the claim (owner OR same company_id).
    try:
        cres = sb.table("claims").select("id, user_id, company_id, file_path, slug").eq(
            "id", target_claim_id).limit(1).execute()
        claim_row = (cres.data or [{}])[0] if cres.data else {}
    except Exception as e:
        return {"action": "error", "message": f"Couldn't load that claim: {type(e).__name__}: {e}"}
    if not claim_row.get("id"):
        return {"action": "error", "message": f"Claim {target_claim_id} not found."}

    from main import _user_can_access_claim, companycam_import_photos_core  # type: ignore
    if not _user_can_access_claim(sb, user_id, claim_row):
        return {"action": "error", "message": "You don't have access to that claim."}

    # Import INTO the claim's own storage area so shared-company teammates land
    # photos in the right place (file_path = "{owner_user_id}/{slug}").
    target_path = claim_row.get("file_path") or f"{claim_row.get('user_id')}/{claim_row.get('slug')}"

    result = await companycam_import_photos_core(
        user_id,
        project_id,
        target_path=target_path,
        target_folder="photos",
    )

    err = result.get("error") if isinstance(result, dict) else None
    if err == "companycam_auth_failed":
        return {"action": "error", "message": f"CompanyCam rejected the saved key — ask the user to reconnect it. ({result.get('message')})"}
    if err == "companycam_unavailable":
        return {"action": "error", "message": f"CompanyCam is unreachable right now — try again shortly. ({result.get('message')})"}
    if err:
        return {"action": "error", "message": result.get("message") or "CompanyCam import failed."}

    count = result.get("count", 0)
    failed = result.get("failed") or []
    requested = result.get("requested", count)
    msg = f"Imported {count} photo(s) from CompanyCam into the claim."
    if failed:
        msg += f" {len(failed)} of {requested} couldn't be pulled (skipped)."
    msg += " They'll appear on the claim and flow into the report on the next reprocess."

    return {
        "action": "complete",
        "type": "companycam_import",
        "data": {
            "claim_id": target_claim_id,
            "project_id": project_id,
            "imported": count,
            "requested": requested,
            "failed_count": len(failed),
            "paths": result.get("paths") or [],
        },
        "message": msg,
    }


def _handle_preview_disconnect_integration(sb: Client, user_id: str, tool_input: dict) -> dict:
    service = (tool_input.get("service") or "").lower().strip()
    cols = SERVICE_COLUMNS.get(service)
    if not cols:
        return {"action": "error", "message": f"Unknown service: {service}."}

    try:
        res = sb.table("company_profiles").select(",".join(cols)).eq("user_id", user_id).limit(1).execute()
        current = (res.data or [{}])[0] if res.data else {}
    except Exception:
        current = {}

    has_anything = any(current.get(c) for c in cols)
    if not has_anything:
        return {"action": "complete", "message": f"{service} is already disconnected.", "data": {"service": service}}

    return {
        "action": "preview",
        "type": "disconnect_integration",
        "tool_name": "disconnect_integration",
        "preview": {
            "action_label": "Disconnect Integration",
            "service": service,
            "columns_to_clear": cols,
        },
        "message": f"Ready to disconnect {service}. This clears stored credentials but does not affect the third-party account.",
    }


# ═══════════════════════════════════════════
# COMPANY-SCOPE TOOLS (owner/admin only)
#
# Surface portfolio insights across all claims under the caller's company.
# Role gate is enforced upstream in main.py admin_brain_chat handler before
# dispatch; these handlers trust that the caller is owner/admin.
# ═══════════════════════════════════════════


def _ensure_company_role(sb: Client, user_id: str) -> Optional[dict]:
    """Defense-in-depth role gate for the company-scope tools.

    The chat handler in main.py role-gates at the system-prompt level
    (scope='company' requires owner/admin), but the tool handlers can
    still be reached if the model decides to call them in scope='user'
    or if a malicious caller bypasses the system-prompt gate. This
    function returns None for owner/admin (proceed) or an error dict
    (return immediately) for member/unknown.
    """
    try:
        res = sb.table("company_profiles").select("role").eq("user_id", user_id).limit(1).execute()
        rows = res.data or []
        role = (rows[0].get("role") if rows else None) or ""
    except Exception:
        role = ""
    if role.lower() not in ("owner", "admin"):
        return {
            "action": "error",
            "message": (
                "This tool is restricted to company owners and admins. "
                "Use the user-scope assistant for personal queries."
            ),
        }
    return None


def _company_user_ids(sb: Client, user_id: str) -> tuple[Optional[str], list[str]]:
    """Resolve company_id for the caller and return (company_id, list of user_ids in company).
    Returns (None, [user_id]) if no company link found — caller falls back to single-user view."""
    try:
        me = sb.table("company_profiles").select("company_id").eq("user_id", user_id).limit(1).execute()
        rows = me.data or []
        if not rows or not rows[0].get("company_id"):
            return None, [user_id]
        company_id = rows[0]["company_id"]
        team = sb.table("company_profiles").select("user_id").eq("company_id", company_id).execute()
        ids = [r["user_id"] for r in (team.data or []) if r.get("user_id")]
        if user_id not in ids:
            ids.append(user_id)
        return company_id, ids
    except Exception:
        return None, [user_id]


# ═══════════════════════════════════════════════════════════════════════
# Company-scoped BULK carrier-comms campaigns (admin/owner, approval-gated)
# ═══════════════════════════════════════════════════════════════════════
# Productized, multi-tenant translations of the proven USARM one-off scripts.
# Eligibility + body composition live in backend/bulk_campaigns.py. These
# handlers own: (1) the role gate, (2) the server-side company_id resolution,
# (3) the preview/execute split, and (4) the actual send + side-effects on
# execute. NOTHING is hardcoded to USARM.

def _bulk_resolve_company(sb: Client, user_id: str) -> tuple[Optional[dict], Optional[str]]:
    """Gate + resolve. Returns (error_dict, None) to reject, or (None, company_id)
    to proceed. company_id comes ONLY from the authenticated user_id."""
    role_err = _ensure_company_role(sb, user_id)
    if role_err:
        return role_err, None
    company_id, _ids = _company_user_ids(sb, user_id)
    if not company_id:
        return {
            "action": "error",
            "message": (
                "I couldn't resolve your company. Bulk campaigns run across your company's claims, "
                "so your account needs to be linked to a company first."
            ),
        }, None
    return None, company_id


async def _handle_bulk_supplement_campaign(sb: Client, user_id: str, tool_input: dict) -> dict:
    """Company-wide bulk supplement→carrier campaign — PREVIEW ONLY.

    This handler NEVER sends. It builds the company-scoped batch and returns
    action="preview". The admin-brain chat loop persists the preview (including the
    resolved batch) as a pending action keyed by an approval_id; the actual send runs
    ONLY when a human clicks Approve, which routes through approve_admin_action ->
    _bulk_execute. The `mode` tool param is intentionally ignored here — there is no
    model-reachable execute path (prompt-injection / confused-model hardening)."""
    from bulk_campaigns import build_supplement_batch

    err, company_id = _bulk_resolve_company(sb, user_id)
    if err:
        return err

    min_gap_items = int(tool_input.get("min_gap_items") or 2)
    max_claims = tool_input.get("max_claims")
    max_claims = int(max_claims) if max_claims else None
    exclude = tool_input.get("exclude_claim_ids") or []
    include_carrier_intake = _bulk_bool(tool_input.get("include_carrier_intake"), default=True)

    try:
        batch, skip = build_supplement_batch(
            sb, company_id, user_id,
            min_gap_items=min_gap_items, max_claims=max_claims, exclude_claim_ids=exclude,
            include_carrier_intake=include_carrier_intake,
        )
    except Exception as e:
        return {"action": "error", "message": f"Failed to build supplement campaign: {type(e).__name__}: {e}"}

    total_value = round(sum(float(b.get("supplement_value") or 0) for b in batch), 2)
    intake_count = sum(1 for b in batch if b.get("target_type") == "carrier_intake")

    # PREVIEW — list + ONE rendered sample + counts. Sends nothing. The resolved
    # `batch` rides along in the pending action so approve_admin_action can execute
    # it WITHOUT re-trusting any model input.
    sample = _bulk_sample(batch[0]) if batch else None
    rows = [{
        "claim_id": b["claim_id"],
        "address": b.get("address"),
        "claim_number": b.get("claim_number"),
        "carrier": b.get("carrier"),
        "adjuster": b.get("adjuster"),
        "to_email": b["to_email"],
        "target_type": b.get("target_type"),
        "n_gaps": b.get("n_gaps"),
        "top_gaps": b.get("top_gaps"),
        "supplement_value": b.get("supplement_value"),
        "attachments": b.get("attachment_filenames"),
        "rep": b.get("rep_name"),
    } for b in batch]
    return {
        "action": "preview",
        "type": "bulk_supplement_campaign",
        "tool_name": "bulk_supplement_campaign",
        # Resolved, server-side send plan. Read ONLY by approve_admin_action ->
        # _bulk_execute; never surfaced to or trusted from the model.
        "batch": batch,
        "company_id": company_id,
        "campaign": "supplement",
        "preview": {
            "action_label": f"Send {len(batch)} supplement email{'s' if len(batch) != 1 else ''}",
            "campaign": "supplement",
            "company_id": company_id,
            "eligible_count": len(batch),
            "total_supplement_value": total_value,
            "carrier_intake_count": intake_count,
            "include_carrier_intake": include_carrier_intake,
            "skipped": skip,
            "min_gap_items": min_gap_items,
            "sample_email": sample,
            "claims": rows,
        },
        "message": (
            f"{len(batch)} eligible supplement{'s' if len(batch) != 1 else ''} ready "
            f"(${total_value:,.0f} total supplement value"
            + (f"; {intake_count} would go to a shared carrier-intake address rather than a named adjuster"
               if intake_count else "")
            + f"). Nothing has been sent. Review the list and the sample email below; when you click "
            f"Approve I'll run the campaign — I can't send these myself."
        ),
    }


async def _handle_bulk_forensic_campaign(sb: Client, user_id: str, tool_input: dict) -> dict:
    """Company-wide bulk forensic→carrier campaign — PREVIEW ONLY.

    Same server-gated approval pattern as _handle_bulk_supplement_campaign: this
    NEVER sends. The resolved batch is returned in the preview and executed only via
    a human Approve through approve_admin_action -> _bulk_execute."""
    from bulk_campaigns import build_forensic_batch

    err, company_id = _bulk_resolve_company(sb, user_id)
    if err:
        return err

    max_claims = tool_input.get("max_claims")
    max_claims = int(max_claims) if max_claims else None
    exclude = tool_input.get("exclude_claim_ids") or []
    include_carrier_intake = _bulk_bool(tool_input.get("include_carrier_intake"), default=True)

    try:
        batch, skip = build_forensic_batch(
            sb, company_id, user_id, max_claims=max_claims, exclude_claim_ids=exclude,
            include_carrier_intake=include_carrier_intake,
        )
    except Exception as e:
        return {"action": "error", "message": f"Failed to build forensic campaign: {type(e).__name__}: {e}"}

    intake_count = sum(1 for b in batch if b.get("target_type") == "carrier_intake")

    sample = _bulk_sample(batch[0]) if batch else None
    rows = [{
        "claim_id": b["claim_id"],
        "address": b.get("address"),
        "claim_number": b.get("claim_number"),
        "carrier": b.get("carrier"),
        "adjuster": b.get("adjuster"),
        "to_email": b["to_email"],
        "target_type": b.get("target_type"),
        "attachments": b.get("attachment_filenames"),
        "cc_homeowner": b.get("cc_homeowner"),
        "rep": b.get("rep_name"),
    } for b in batch]
    return {
        "action": "preview",
        "type": "bulk_forensic_campaign",
        "tool_name": "bulk_forensic_campaign",
        "batch": batch,
        "company_id": company_id,
        "campaign": "forensic",
        "preview": {
            "action_label": f"Send {len(batch)} forensic report{'s' if len(batch) != 1 else ''}",
            "campaign": "forensic",
            "company_id": company_id,
            "eligible_count": len(batch),
            "carrier_intake_count": intake_count,
            "include_carrier_intake": include_carrier_intake,
            "skipped": skip,
            "sample_email": sample,
            "claims": rows,
        },
        "message": (
            f"{len(batch)} eligible forensic report{'s' if len(batch) != 1 else ''} ready to send to "
            f"carriers"
            + (f" ({intake_count} would route to a shared carrier-intake address rather than a named adjuster)"
               if intake_count else "")
            + f". Nothing has been sent. Review the list and the sample email below; when you click "
            f"Approve I'll run the campaign — I can't send these myself."
        ),
    }


def _bulk_bool(v, *, default: bool) -> bool:
    """Coerce a tool-input flag to bool, tolerating strings ('false'/'no'/'0')."""
    if v is None:
        return default
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    return str(v).strip().lower() not in ("false", "no", "0", "off", "")


def _bulk_sample(b: dict) -> dict:
    """A single rendered email for the preview card."""
    return {
        "claim_id": b["claim_id"],
        "address": b.get("address"),
        "to": b["to_email"],
        "cc": b.get("cc"),
        "subject": b["subject"],
        "body_html": b["body_html"],
        "attachments": b.get("attachment_filenames"),
    }


async def _bulk_execute(sb: Client, company_id: str, batch: list[dict], *, campaign: str) -> dict:
    """Send every prepared email in the batch from its assigned rep, then fire the
    email side-effects (supplement_sent / forensic_* events + 3/7/15 cadence).

    SECURITY: reachable ONLY from approve_admin_action (a human Approve carrying the
    popped approval_id). The model has no path here. Even so this stays defense-in-
    depth: each claim's company_id is RE-VERIFIED before sending, the assigned-rep
    sender is confirmed to belong to the company, and the live already-sent set is
    re-queried at execute start so a concurrent send (or a stale preview) can't double
    up. Per-claim sent/skip results are returned."""
    from claim_brain_email import send_claim_email
    # Reuse main.py's idempotent side-effect recorder (events + cadence) so bulk
    # sends and single-claim Richard sends share one code path.
    try:
        from main import _record_email_send_side_effects
    except Exception as e:
        _record_email_send_side_effects = None
        print(f"[BULK] side-effect recorder import failed (sends will still go out): {e}", flush=True)

    # tool_name drives the side-effect recorder's event-type + cadence preset.
    side_effect_tool = "send_supplement_email" if campaign == "supplement" else "send_to_carrier"

    # The company's authoritative user-id set, resolved DIRECTLY from the
    # server-side company_id we're executing for (NOT from the batch, and NOT via
    # any rep in it — a reassigned/orphaned rep could resolve to a different
    # company). Used for the sender-in-company guard below.
    company_uid_set: set[str] = set()
    try:
        team = sb.table("company_profiles").select("user_id").eq("company_id", company_id).execute()
        company_uid_set = {r["user_id"] for r in (team.data or []) if r.get("user_id")}
    except Exception as te:
        print(f"[BULK] company user-id set load failed for {company_id}: {type(te).__name__}: {te}", flush=True)

    # Fix 4: recompute the LIVE already-sent set at execute start (shrinks the
    # concurrent / stale-preview double-send window vs. the build-time skip-set).
    from bulk_campaigns import _claim_event_ids
    sent_event_types = ["supplement_sent"] if campaign == "supplement" else ["forensic_sent_to_carrier"]
    try:
        already_sent_live = _claim_event_ids(sb, [b["claim_id"] for b in batch if b.get("claim_id")], sent_event_types)
    except Exception as ae:
        already_sent_live = set()
        print(f"[BULK] live already-sent recompute failed (proceeding on build-time skip-set): {type(ae).__name__}: {ae}", flush=True)

    results: list[dict] = []
    sent = 0
    for b in batch:
        cid = b["claim_id"]
        send_user_id = b.get("send_user_id")
        if not send_user_id:
            results.append({"claim_id": cid, "address": b.get("address"), "status": "skipped", "reason": "no assigned rep"})
            continue

        # Fix 4: skip anything that became sent since the preview was built.
        if cid in already_sent_live:
            results.append({"claim_id": cid, "address": b.get("address"), "status": "skipped", "reason": "already_sent"})
            continue

        # Fix 3: sender-in-company guard. The resolved send mailbox must belong to a
        # member of THIS company; otherwise a reassigned/orphaned claim could send
        # from a mailbox outside the company. Only enforced when we have a usable set.
        if company_uid_set and send_user_id not in company_uid_set:
            results.append({"claim_id": cid, "address": b.get("address"), "status": "skipped", "reason": "rep_not_in_company"})
            continue

        # Defense-in-depth: confirm the claim still belongs to this company before
        # sending. (The batch was company-scoped at build time; this guards against
        # any drift between preview and execute.)
        try:
            chk = sb.table("claims").select("company_id, file_path").eq("id", cid).maybe_single().execute()
            row = (chk.data if chk else None) or {}
            if row.get("company_id") != company_id:
                results.append({"claim_id": cid, "address": b.get("address"), "status": "skipped", "reason": "company mismatch"})
                continue
        except Exception as ce:
            results.append({"claim_id": cid, "address": b.get("address"), "status": "skipped", "reason": f"verify failed: {type(ce).__name__}"})
            continue

        # Resolve attachments (storage paths -> bytes). Refuse the SEND if any
        # attachment is missing — adjusters shouldn't get an email that claims a
        # report is attached when it isn't.
        resolved: list[dict] = []
        failed: list[str] = []
        for path in (b.get("attachment_paths") or []):
            try:
                content = sb.storage.from_("claim-documents").download(path)
                resolved.append({"filename": path.rsplit("/", 1)[-1], "content": content})
            except Exception as ae:
                failed.append(path)
                print(f"[BULK] attachment download failed {path}: {type(ae).__name__}: {ae}", flush=True)
        if failed:
            results.append({"claim_id": cid, "address": b.get("address"), "status": "skipped",
                            "reason": f"{len(failed)} attachment(s) missing"})
            continue

        try:
            email_result = send_claim_email(
                sb=sb,
                claim_id=cid,
                user_id=send_user_id,
                to_email=b["to_email"],
                subject=b["subject"],
                body_html=b["body_html"],
                cc=b.get("cc"),
                attachments=resolved or None,
                email_type=b.get("email_type") or "custom",
            )
            status = email_result.get("status", "sent")
        except Exception as se:
            results.append({"claim_id": cid, "address": b.get("address"), "status": "error",
                            "reason": f"{type(se).__name__}: {se}"})
            continue

        # Side-effects: fire supplement_sent / forensic_* events + schedule cadence.
        # Pass a draft-shaped dict so the recorder's attachment/forensic detection
        # and cadence subject logic work exactly as on the single-claim path.
        if _record_email_send_side_effects:
            try:
                _record_email_send_side_effects(
                    sb=sb,
                    claim_id=cid,
                    user_id=send_user_id,
                    tool_name=side_effect_tool,
                    draft_or_preview={
                        "to": b["to_email"],
                        "cc": b.get("cc"),
                        "subject": b["subject"],
                        "body_html": b["body_html"],
                        "attachment_paths": b.get("attachment_paths") or [],
                    },
                    email_id=email_result.get("email_id"),
                )
            except Exception as fe:
                print(f"[BULK] side-effects failed for {cid} (email already sent): {type(fe).__name__}: {fe}", flush=True)

        sent += 1
        results.append({
            "claim_id": cid,
            "address": b.get("address"),
            "to_email": b["to_email"],
            "status": status,
            "method": email_result.get("method"),
            "supplement_value": b.get("supplement_value"),
        })

    skipped = sum(1 for r in results if r["status"] not in ("sent",))
    return {
        "action": "complete",
        "type": f"bulk_{campaign}_campaign",
        "tool_name": f"bulk_{campaign}_campaign",
        "data": {
            "company_id": company_id,
            "attempted": len(batch),
            "sent": sent,
            "skipped": skipped,
            "results": results,
        },
        "message": (
            f"{campaign.capitalize()} campaign complete: {sent} sent"
            + (f", {skipped} skipped" if skipped else "")
            + ". 3/7/15-day follow-up cadences were scheduled for the sends with a claim number on file."
        ),
    }


def _handle_list_company_claims(sb: Client, user_id: str, tool_input: dict) -> dict:
    """List claims across the caller's company. Filterable by status/carrier/variance."""
    err = _ensure_company_role(sb, user_id)
    if err:
        return err
    status_filter = (tool_input.get("status") or "any").lower()
    carrier_filter = (tool_input.get("carrier") or "").strip().lower()
    min_variance = float(tool_input.get("min_variance_usd") or 0)
    limit = int(tool_input.get("limit") or 25)
    limit = max(1, min(limit, 100))

    company_id, user_ids = _company_user_ids(sb, user_id)

    try:
        # claims.last_touched_at is the recency column (claims.updated_at
        # does not exist — see schema. Other touch columns: last_processed_at,
        # created_at).
        q = sb.table("claims").select(
            "id, address, carrier, status, original_carrier_rcv, contractor_rcv, created_at, last_touched_at, user_id"
        ).in_("user_id", user_ids).order("last_touched_at", desc=True).limit(limit * 3)
        res = q.execute()
        claims = res.data or []
    except Exception as e:
        return {"action": "error", "message": f"Failed to load company claims: {e}"}

    def _matches(c: dict) -> bool:
        if status_filter != "any" and (c.get("status") or "").lower() != status_filter:
            return False
        if carrier_filter and carrier_filter not in (c.get("carrier") or "").lower():
            return False
        carrier_rcv = float(c.get("original_carrier_rcv") or 0)
        contractor_rcv = float(c.get("contractor_rcv") or 0)
        variance = contractor_rcv - carrier_rcv
        if variance < min_variance:
            return False
        return True

    filtered = [c for c in claims if _matches(c)][:limit]

    rows = []
    for c in filtered:
        carrier_rcv = float(c.get("original_carrier_rcv") or 0)
        contractor_rcv = float(c.get("contractor_rcv") or 0)
        variance = contractor_rcv - carrier_rcv
        rows.append({
            "claim_id": c.get("id"),
            "address": c.get("address"),
            "carrier": c.get("carrier"),
            "status": c.get("status"),
            "carrier_rcv": round(carrier_rcv, 2),
            "contractor_rcv": round(contractor_rcv, 2),
            "variance": round(variance, 2),
            "rep_user_id": c.get("user_id"),
            "last_touched_at": c.get("last_touched_at"),
        })

    return {
        "action": "complete",
        "type": "company_claims_list",
        "tool_name": "list_company_claims",
        "data": {
            "company_id": company_id,
            "team_size": len(user_ids),
            "total_returned": len(rows),
            "filters": {
                "status": status_filter,
                "carrier": carrier_filter or None,
                "min_variance_usd": min_variance,
            },
            "claims": rows,
        },
        "message": f"Found {len(rows)} claim{'s' if len(rows) != 1 else ''} matching the filter across {len(user_ids)} team member{'s' if len(user_ids) != 1 else ''}.",
    }


def _handle_get_company_portfolio_summary(sb: Client, user_id: str, company_id: Optional[str] = None) -> dict:
    """Topline portfolio stats for the caller's company."""
    err = _ensure_company_role(sb, user_id)
    if err:
        return err
    _company_id, user_ids = _company_user_ids(sb, user_id)
    company_id = company_id or _company_id

    try:
        res = sb.table("claims").select(
            "id, status, carrier, original_carrier_rcv, contractor_rcv, created_at, claim_outcome, settlement_amount"
        ).in_("user_id", user_ids).execute()
        claims = res.data or []
    except Exception as e:
        return {"action": "error", "message": f"Failed to load portfolio: {e}"}

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    ytd_start = datetime(now.year, 1, 1, tzinfo=timezone.utc)

    open_claims = 0
    pending_supplements = 0
    ytd_wins = 0
    ytd_supplements_usd = 0.0
    total_variance = 0.0
    variance_count = 0
    carrier_counts: dict[str, int] = {}

    for c in claims:
        status = (c.get("status") or "").lower()
        carrier = c.get("carrier") or "Unknown"
        carrier_counts[carrier] = carrier_counts.get(carrier, 0) + 1

        if status not in ("won", "closed", "denied"):
            open_claims += 1

        carrier_rcv = float(c.get("original_carrier_rcv") or 0)
        contractor_rcv = float(c.get("contractor_rcv") or 0)
        variance = contractor_rcv - carrier_rcv

        if variance > 0 and status not in ("won", "closed", "denied"):
            pending_supplements += 1

        if variance != 0:
            total_variance += variance
            variance_count += 1

        if c.get("claim_outcome") == "won":
            try:
                created = c.get("created_at") or ""
                created_dt = datetime.fromisoformat(created.replace("Z", "+00:00")) if created else None
                if created_dt and created_dt >= ytd_start:
                    ytd_wins += 1
                    ytd_supplements_usd += float(c.get("settlement_amount") or 0)
            except Exception:
                pass

    avg_variance = round(total_variance / variance_count, 2) if variance_count else 0.0
    top_carriers = sorted(carrier_counts.items(), key=lambda kv: kv[1], reverse=True)[:5]

    return {
        "action": "complete",
        "type": "company_portfolio_summary",
        "tool_name": "get_company_portfolio_summary",
        "data": {
            "company_id": company_id,
            "team_size": len(user_ids),
            "total_claims": len(claims),
            "open_claims": open_claims,
            "pending_supplements": pending_supplements,
            "ytd_wins": ytd_wins,
            "ytd_supplements_usd": round(ytd_supplements_usd, 2),
            "average_variance_usd": avg_variance,
            "top_carriers": [{"carrier": c, "claim_count": n} for c, n in top_carriers],
        },
        "message": f"Portfolio: {open_claims} open, {pending_supplements} pending supplements, {ytd_wins} wins YTD totaling ${ytd_supplements_usd:,.2f}.",
    }


def _handle_compare_team_performance(sb: Client, user_id: str, tool_input: dict) -> dict:
    """Per-rep performance: claims processed, supplements won, average variance, response time proxy."""
    err = _ensure_company_role(sb, user_id)
    if err:
        return err
    window_days = int(tool_input.get("window_days") or 90)
    window_days = max(7, min(window_days, 365))

    company_id, user_ids = _company_user_ids(sb, user_id)

    from datetime import datetime, timedelta, timezone
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
    cutoff_iso = cutoff.isoformat()

    try:
        team_res = sb.table("company_profiles").select("user_id, contact_name, email, role").in_("user_id", user_ids).execute()
        team = {r["user_id"]: r for r in (team_res.data or []) if r.get("user_id")}

        claims_res = sb.table("claims").select(
            "id, user_id, status, original_carrier_rcv, contractor_rcv, claim_outcome, created_at, last_touched_at"
        ).in_("user_id", user_ids).gte("created_at", cutoff_iso).execute()
        claims = claims_res.data or []
    except Exception as e:
        return {"action": "error", "message": f"Failed to compare team: {e}"}

    rep_stats: dict[str, dict] = {}
    for c in claims:
        uid = c.get("user_id")
        if not uid:
            continue
        s = rep_stats.setdefault(uid, {
            "claims_processed": 0,
            "wins": 0,
            "total_variance_usd": 0.0,
            "variance_count": 0,
            "total_cycle_hours": 0.0,
            "cycle_count": 0,
        })
        s["claims_processed"] += 1
        if c.get("claim_outcome") == "won":
            s["wins"] += 1
        carrier_rcv = float(c.get("original_carrier_rcv") or 0)
        contractor_rcv = float(c.get("contractor_rcv") or 0)
        variance = contractor_rcv - carrier_rcv
        if variance != 0:
            s["total_variance_usd"] += variance
            s["variance_count"] += 1
        try:
            created = c.get("created_at") or ""
            touched = c.get("last_touched_at") or ""
            if created and touched:
                cd = datetime.fromisoformat(created.replace("Z", "+00:00"))
                td = datetime.fromisoformat(touched.replace("Z", "+00:00"))
                hours = (td - cd).total_seconds() / 3600
                if hours > 0:
                    s["total_cycle_hours"] += hours
                    s["cycle_count"] += 1
        except Exception:
            pass

    rows = []
    for uid, s in rep_stats.items():
        member = team.get(uid, {})
        rows.append({
            "user_id": uid,
            "name": member.get("contact_name") or member.get("email") or uid[:8],
            "email": member.get("email"),
            "role": member.get("role"),
            "claims_processed": s["claims_processed"],
            "wins": s["wins"],
            "win_rate_pct": round((s["wins"] / s["claims_processed"]) * 100, 1) if s["claims_processed"] else 0.0,
            "average_variance_usd": round(s["total_variance_usd"] / s["variance_count"], 2) if s["variance_count"] else 0.0,
            "average_cycle_hours": round(s["total_cycle_hours"] / s["cycle_count"], 1) if s["cycle_count"] else 0.0,
        })

    rows.sort(key=lambda r: (r["wins"], r["average_variance_usd"]), reverse=True)

    return {
        "action": "complete",
        "type": "team_performance",
        "tool_name": "compare_team_performance",
        "data": {
            "company_id": company_id,
            "window_days": window_days,
            "team_size": len(user_ids),
            "members_with_activity": len(rows),
            "ranking": rows,
        },
        "message": f"Compared {len(rows)} rep{'s' if len(rows) != 1 else ''} over the last {window_days} days.",
    }


def _handle_get_team_member_workload(sb: Client, user_id: str) -> dict:
    """Current per-rep load: open claims, pending supplements, overdue follow-ups."""
    err = _ensure_company_role(sb, user_id)
    if err:
        return err
    company_id, user_ids = _company_user_ids(sb, user_id)

    try:
        team_res = sb.table("company_profiles").select("user_id, contact_name, email, role").in_("user_id", user_ids).execute()
        team = {r["user_id"]: r for r in (team_res.data or []) if r.get("user_id")}

        claims_res = sb.table("claims").select(
            "id, user_id, status, original_carrier_rcv, contractor_rcv, last_touched_at"
        ).in_("user_id", user_ids).execute()
        claims = claims_res.data or []
    except Exception as e:
        return {"action": "error", "message": f"Failed to load workload: {e}"}

    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    overdue_cutoff = now - timedelta(days=7)

    workload: dict[str, dict] = {}
    for c in claims:
        uid = c.get("user_id")
        if not uid:
            continue
        s = workload.setdefault(uid, {
            "open_claims": 0,
            "pending_supplements": 0,
            "overdue_follow_ups": 0,
        })
        status = (c.get("status") or "").lower()
        if status not in ("won", "closed", "denied"):
            s["open_claims"] += 1
            carrier_rcv = float(c.get("original_carrier_rcv") or 0)
            contractor_rcv = float(c.get("contractor_rcv") or 0)
            if (contractor_rcv - carrier_rcv) > 0:
                s["pending_supplements"] += 1
            try:
                touched = c.get("last_touched_at") or ""
                td = datetime.fromisoformat(touched.replace("Z", "+00:00")) if touched else None
                if td and td < overdue_cutoff:
                    s["overdue_follow_ups"] += 1
            except Exception:
                pass

    rows = []
    for uid in user_ids:
        s = workload.get(uid, {"open_claims": 0, "pending_supplements": 0, "overdue_follow_ups": 0})
        member = team.get(uid, {})
        rows.append({
            "user_id": uid,
            "name": member.get("contact_name") or member.get("email") or uid[:8],
            "email": member.get("email"),
            "role": member.get("role"),
            **s,
        })

    rows.sort(key=lambda r: (r["overdue_follow_ups"], r["open_claims"]), reverse=True)

    return {
        "action": "complete",
        "type": "team_workload",
        "tool_name": "get_team_member_workload",
        "data": {
            "company_id": company_id,
            "team_size": len(user_ids),
            "members": rows,
        },
        "message": f"Workload snapshot for {len(user_ids)} team member{'s' if len(user_ids) != 1 else ''}.",
    }


# ═══════════════════════════════════════════
# PHOTO EDIT / EXCLUDE
#
# Lets users fix bad AI annotations in natural language ("page 11 2nd photo
# says wrong thing, fix it to X"). Edits write to annotation_feedback so
# they survive reprocess — the processor re-injects user-corrected
# annotations as few-shot training signal on subsequent runs.
# ═══════════════════════════════════════════


def _handle_find_photo(sb: Client, claim_id: str, tool_input: dict) -> dict:
    """Locate photos by annotation_key, position, or text match."""
    import re as _re

    query = (tool_input.get("query") or "").strip()
    if not query:
        return {"action": "error", "message": "query is required"}

    try:
        # NOTE: photos table has NO `structure` column (that lives on line_items).
        # See E185 — selecting it returned 400 and broke find_photo end-to-end.
        res = sb.table("photos").select(
            "id, annotation_key, annotation_text, damage_type, material, trade, severity"
        ).eq("claim_id", claim_id).order("annotation_key", desc=False).execute()
        all_photos = res.data or []
    except Exception as e:
        return {"action": "error", "message": f"Photo lookup failed: {e}"}

    if not all_photos:
        return {
            "action": "complete",
            "type": "photo_find",
            "data": {"matches": [], "query": query, "total_on_claim": 0},
            "message": "No photos on this claim yet.",
        }

    q_lower = query.lower().strip()
    matches: list[dict] = []

    # 1. Exact annotation_key match (e.g. "p11_02")
    key_match = _re.match(r"^p?(\d+)[_\-\s]+(\d+)$", q_lower)
    if key_match:
        page, idx = key_match.group(1), key_match.group(2)
        target_key = f"p{int(page):02d}_{int(idx):02d}"
        for p in all_photos:
            ak = (p.get("annotation_key") or "").lower()
            if ak == target_key or ak.startswith(f"p{page}_") and idx in ak:
                matches.append({**p, "match_reason": f"annotation_key {ak}"})

    # 2. "Nth photo" or "photo 23" or just a number
    if not matches:
        pos_match = _re.search(r"\b(\d+)(?:st|nd|rd|th)?\b", q_lower)
        if pos_match and len(q_lower.split()) <= 4:
            idx = int(pos_match.group(1)) - 1
            if 0 <= idx < len(all_photos):
                p = all_photos[idx]
                matches.append({**p, "match_reason": f"position #{idx + 1} of {len(all_photos)}"})

    # 3. "page N, Mth photo" — find N-th photo on page (by annotation_key prefix)
    if not matches:
        page_photo = _re.search(r"page\s*(\d+).*?(\d+)(?:st|nd|rd|th)?", q_lower)
        if page_photo:
            page = int(page_photo.group(1))
            idx = int(page_photo.group(2))
            page_photos = [p for p in all_photos if (p.get("annotation_key") or "").startswith(f"p{page:02d}_")]
            if 1 <= idx <= len(page_photos):
                matches.append({**page_photos[idx - 1], "match_reason": f"page {page}, photo #{idx}"})

    # 4. Free-text fuzzy match against annotation_text + tags
    if not matches:
        q_tokens = set(q_lower.split()) - {"the", "a", "an", "photo", "image", "pic"}
        scored = []
        for p in all_photos:
            haystack = " ".join([
                str(p.get("annotation_text") or ""),
                str(p.get("damage_type") or ""),
                str(p.get("material") or ""),
                str(p.get("trade") or ""),
                str(p.get("severity") or ""),
                str(p.get("annotation_key") or ""),
            ]).lower()
            hay_tokens = set(haystack.split())
            overlap = len(q_tokens & hay_tokens)
            if overlap > 0 or q_lower in haystack:
                score = overlap + (5 if q_lower in haystack else 0)
                scored.append((score, p))
        scored.sort(key=lambda x: x[0], reverse=True)
        matches = [{**p, "match_reason": f"text match (score {s})"} for s, p in scored[:5]]

    return {
        "action": "complete",
        "type": "photo_find",
        "data": {
            "matches": matches[:5],
            "query": query,
            "total_on_claim": len(all_photos),
        },
        "message": (
            f"{len(matches)} photo{'s' if len(matches) != 1 else ''} matched '{query}'"
            if matches
            else f"No photos matched '{query}' on this claim ({len(all_photos)} total)."
        ),
    }


def _handle_preview_edit_photo(sb: Client, claim_id: str, tool_input: dict) -> dict:
    photo_id = (tool_input.get("photo_id") or "").strip()
    reason = (tool_input.get("reason") or "").strip()
    if not photo_id or not reason:
        return {"action": "error", "message": "photo_id and reason are required"}

    # At least one field must actually change
    new_annotation = tool_input.get("annotation_text")
    new_damage = tool_input.get("damage_type")
    new_material = tool_input.get("material")
    new_severity = tool_input.get("severity")
    if new_annotation is None and new_damage is None and new_material is None and new_severity is None:
        return {"action": "error", "message": "Provide at least one of annotation_text, damage_type, material, severity."}

    try:
        res = sb.table("photos").select(
            "id, annotation_key, annotation_text, damage_type, material, severity"
        ).eq("id", photo_id).eq("claim_id", claim_id).limit(1).execute()
        rows = res.data or []
    except Exception as e:
        return {"action": "error", "message": f"Photo lookup failed: {e}"}

    if not rows:
        return {"action": "error", "message": f"Photo {photo_id} not found on this claim."}

    original = rows[0]
    return {
        "action": "preview",
        "type": "edit_photo_annotation",
        "tool_name": "edit_photo_annotation",
        "preview": {
            "action_label": "Edit Photo Annotation",
            "photo_id": photo_id,
            "annotation_key": original.get("annotation_key"),
            "original_annotation": original.get("annotation_text"),
            "new_annotation": new_annotation,
            "original_damage_type": original.get("damage_type"),
            "new_damage_type": new_damage,
            "original_material": original.get("material"),
            "new_material": new_material,
            "original_severity": original.get("severity"),
            "new_severity": new_severity,
            "reason": reason,
        },
        "message": f"Ready to edit annotation for {original.get('annotation_key')}. Will survive reprocess via annotation_feedback.",
    }


def _handle_preview_exclude_photo(sb: Client, claim_id: str, tool_input: dict) -> dict:
    photo_id = (tool_input.get("photo_id") or "").strip()
    annotation_key = (tool_input.get("annotation_key") or "").strip()
    reason = (tool_input.get("reason") or "").strip()
    if not reason:
        return {"action": "error", "message": "reason is required"}
    if not photo_id and not annotation_key:
        return {"action": "error", "message": "Provide either photo_id or annotation_key"}

    # Resolve to the photo row — we need annotation_key for the excluded_photos
    # array (that column stores keys, not UUIDs; see CLAUDE.md notes).
    try:
        if photo_id:
            res = sb.table("photos").select("id, annotation_key, annotation_text").eq("id", photo_id).eq("claim_id", claim_id).limit(1).execute()
        else:
            res = sb.table("photos").select("id, annotation_key, annotation_text").eq("annotation_key", annotation_key).eq("claim_id", claim_id).limit(1).execute()
        rows = res.data or []
    except Exception as e:
        return {"action": "error", "message": f"Photo lookup failed: {e}"}

    if not rows:
        return {"action": "error", "message": "Photo not found on this claim."}

    row = rows[0]
    return {
        "action": "preview",
        "type": "exclude_photo_from_claim",
        "tool_name": "exclude_photo_from_claim",
        "preview": {
            "action_label": "Exclude Photo from Claim",
            "photo_id": row.get("id"),
            "annotation_key": row.get("annotation_key"),
            "current_annotation": row.get("annotation_text"),
            "reason": reason,
        },
        "message": f"Ready to exclude {row.get('annotation_key')} from the forensic report. Reason: {reason}",
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

    # Digital microscope photos — 10-50x magnification of hail impact sites.
    # This is the premium forensic evidence that separates a legit hail claim
    # from a "cosmetic" denial. Shows crushed-vs-powdered granules and
    # granule-embedment-in-mat (downward-impact signature that ONLY hail
    # produces).
    microscope_photos = _count_by_keywords(
        photos, ["microscope", "macro", "10x", "20x", "50x", "magnified", "magnification", "zoomed"]
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
        "microscope_photos": microscope_photos,
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

    # DIGITAL MICROSCOPE (hail claims) — the premium forensic evidence.
    # Handheld USB microscopes are ~$30 on Amazon. 10-50x magnification of a
    # hail impact site shows evidence that carriers simply cannot argue with,
    # because the signatures are physically specific to downward-force impact.
    if (show_all or focus == "roof") and coverage["is_hail_claim"] and coverage["microscope_photos"] == 0:
        steps.append({
            "title": "Digital microscope hail-impact photos (10-50x)",
            "importance": "critical",
            "area": "roof",
            "instruction": (
                "Use a handheld USB digital microscope (~$30 on Amazon) to photograph "
                "individual hail impact sites at 10-50x magnification. This is the "
                "evidence that ends 'cosmetic only' denials because the signatures "
                "at this scale are physically specific to hail.\n\n"
                "**What to look for (and label in the photo caption):**\n\n"
                "  ✅ **Crushed granules** — granules broken into smaller but still-"
                "solid particles. This is HAIL. Label: \"crushed granules, hail impact\".\n\n"
                "  🚫 **Powdery residue** — fine dust (like sifted flour) around an "
                "impact site. This is MAN-MADE damage (hammer/mallet, fraud indicator). "
                "Do NOT submit this as hail evidence — it will get you denied for "
                "misrepresentation. If you see it, note it honestly.\n\n"
                "  ✅ **White threads / fiberglass visible** — those white threads are "
                "the shingle MAT (the fiberglass mesh underneath the granule layer). "
                "Visible mat = granule displacement has exposed the structural layer. "
                "NORMAL after severe hail impact.\n\n"
                "  ✅ **Granules pressed INTO the mat** — this is the nuclear signature. "
                "Granules should NEVER be embedded in the mat under normal conditions. "
                "Embedment means **downward force** hit that spot — which hail is the "
                "only natural cause of. Foot traffic doesn't do this (wrong angle), "
                "wind doesn't do this (no downward component). Label: \"granule "
                "embedment into mat — downward impact signature\".\n\n"
                "Shoot 5-8 impact sites. Vary slope (front / rear / sides). Each photo "
                "should clearly show the damage feature + a reference (the microscope "
                "barrel is usually ~1 inch = built-in scale)."
            ),
            "damage_score_impact": "+18 points",
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
        # maybe_single — claim row may be missing during recompute previews on
        # ephemeral / mid-rebuild claims. Don't 500 the tool, just compute zeros.
        claim_res = sb.table("claims").select("contractor_rcv, current_carrier_rcv, original_carrier_rcv, o_and_p_enabled, tax_rate").eq("id", claim_id).maybe_single().execute()
        claim = (claim_res.data if claim_res else {}) or {}
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


# ═══════════════════════════════════════════════════════════════════════
# NEW MUTATION TOOL HANDLERS (governance v2 Day 4)
# ═══════════════════════════════════════════════════════════════════════

import re as _re


def _handle_preview_update_date_of_loss(sb: Client, claim_id: str, claim_data: dict, tool_input: dict) -> dict:
    """Preview a DOL change. Approval-gated — affects NOAA queries +
    statute of limitations + forensic synthesis."""
    new_dol = (tool_input.get("new_date_of_loss") or "").strip()
    reason = (tool_input.get("reason") or "").strip()

    if not _re.match(r"^\d{4}-\d{2}-\d{2}$", new_dol):
        return {
            "action": "error",
            "message": f"Invalid date format '{new_dol}' — expected YYYY-MM-DD (e.g. 2024-08-15).",
        }
    if not reason:
        return {
            "action": "error",
            "message": "Need a reason for the DOL change (homeowner correction, carrier rejection, NOAA verification, etc).",
        }

    current_dol = claim_data.get("date_of_loss") or "(not set)"
    return {
        "action": "preview",
        "tool_name": "update_date_of_loss",
        "type": "claim_field_update",
        "preview": {
            "field": "date_of_loss",
            "current_value": current_dol,
            "new_value": new_dol,
            "reason": reason,
            "side_effects": [
                "NOAA storm-event re-query will fire in the background",
                "Existing forensic report references to DOL become stale until reprocess",
            ],
        },
        "message": (
            f"Ready to change date of loss from **{current_dol}** to **{new_dol}**. "
            f"Reason: {reason}. NOAA re-query will fire automatically. Reprocess is NOT auto-triggered."
        ),
    }


def _handle_preview_update_cause_of_loss(sb: Client, claim_id: str, claim_data: dict, tool_input: dict) -> dict:
    """Preview a cause-of-loss array update. Auto-approved (internal state)."""
    causes = tool_input.get("causes")
    reason = (tool_input.get("reason") or "").strip()

    if not isinstance(causes, list):
        return {"action": "error", "message": "`causes` must be an array (e.g. ['hail', 'wind'])."}
    valid = {"hail", "wind", "wind_driven_rain", "fallen_tree", "other"}
    bad = [c for c in causes if c not in valid]
    if bad:
        return {"action": "error", "message": f"Unknown causes: {bad}. Valid: {sorted(valid)}."}
    if not reason:
        return {"action": "error", "message": "Need a forensic justification for the cause-of-loss change."}

    current = claim_data.get("cause_of_loss") or []
    if isinstance(current, str):
        # legacy single-value column
        current = [current] if current else []
    return {
        "action": "preview",
        "tool_name": "update_cause_of_loss",
        "type": "claim_field_update",
        "preview": {
            "field": "cause_of_loss",
            "current_value": current,
            "new_value": causes,
            "reason": reason,
        },
        "message": f"Ready to update cause of loss from {current or '(empty)'} → {causes}. Reason: {reason}.",
    }


def _handle_preview_set_estimate_total(sb: Client, claim_id: str, claim_data: dict, tool_input: dict) -> dict:
    """Preview hitting a target contractor RCV. Auto-approved.

    Default strategy = balancing_line: adds an 'EST ADJ' line item with the
    necessary delta. Real Xactimate prices on every other line item stay
    untouched.
    """
    try:
        target = float(tool_input.get("target_total") or 0)
    except (TypeError, ValueError):
        return {"action": "error", "message": "`target_total` must be a number."}
    if target <= 0:
        return {"action": "error", "message": "`target_total` must be > 0."}

    strategy = (tool_input.get("strategy") or "balancing_line").lower()
    if strategy not in ("balancing_line", "scale_all", "adjust_primary"):
        return {"action": "error", "message": f"Unknown strategy '{strategy}'. Use balancing_line | scale_all | adjust_primary."}

    reason = (tool_input.get("reason") or "").strip()
    if not reason:
        return {"action": "error", "message": "Need a reason for the target total (e.g. carrier-approved cap, lump-sum bid)."}

    current_rcv = float(claim_data.get("contractor_rcv") or 0)
    delta = round(target - current_rcv, 2)

    warning = None
    if strategy == "scale_all":
        warning = (
            "WARNING: scale_all proportionally modifies every line item's unit price. "
            "Resulting prices will NOT match real Xactimate codes — carriers may "
            "reject for fabricated unit prices. balancing_line is safer."
        )

    return {
        "action": "preview",
        "tool_name": "set_estimate_total",
        "type": "estimate_total_adjust",
        "preview": {
            "current_rcv": current_rcv,
            "target_rcv": target,
            "delta": delta,
            "strategy": strategy,
            "reason": reason,
            "warning": warning,
            "balancing_line_proposal": (
                {
                    "description": "Estimator's Scope Adjustment",
                    "qty": 1,
                    "unit": "EA",
                    "unit_price": delta,
                    "xactimate_code": "EST ADJ",
                    "reason": f"Scope adjustment to hit target RCV ${target:,.2f}: {reason}",
                }
                if strategy == "balancing_line" else None
            ),
        },
        "message": (
            f"Ready to adjust estimate from **${current_rcv:,.2f}** → **${target:,.2f}** "
            f"(delta ${delta:+,.2f}) using **{strategy}** strategy."
            + (f" ⚠️ {warning}" if warning else "")
        ),
    }


def _handle_preview_set_op_override(sb: Client, claim_id: str, claim_data: dict, tool_input: dict) -> dict:
    """Preview an O&P override. Auto-approved (internal state)."""
    enabled = tool_input.get("enabled")
    if enabled is None or not isinstance(enabled, bool):
        return {"action": "error", "message": "`enabled` must be true or false."}
    overhead = tool_input.get("overhead_pct")
    profit = tool_input.get("profit_pct")
    reason = (tool_input.get("reason") or "").strip()
    if not reason:
        return {"action": "error", "message": "Need a reason for the O&P override."}

    # Default platform values when overrides are absent
    overhead = float(overhead) if isinstance(overhead, (int, float)) else 0.10
    profit = float(profit) if isinstance(profit, (int, float)) else 0.11

    current_enabled = bool(claim_data.get("o_and_p_enabled"))
    return {
        "action": "preview",
        "tool_name": "set_op_override",
        "type": "claim_field_update",
        "preview": {
            "field": "op_override",
            "current_value": {"enabled": current_enabled, "auto_via_trade_count": True},
            "new_value": {
                "enabled": enabled,
                "overhead_pct": overhead,
                "profit_pct": profit,
                "manual_override": True,
            },
            "reason": reason,
        },
        "message": (
            f"Ready to {'enable' if enabled else 'disable'} GC O&P "
            f"({overhead*100:.0f}% overhead + {profit*100:.0f}% profit). Reason: {reason}."
        ),
    }


async def _handle_preview_send_install_supplement(
    sb: Client,
    claim_id: str,
    user_id: str,
    claim_data: dict,
    company_profile: dict,
    tool_input: dict,
) -> dict:
    """Preview a post-installation supplement email. Approval-gated.

    Code-review fix #8: original implementation tried to delegate to
    _handle_supplement_email with `template='install'` — but that handler
    ignores `template` and KeyErrors if `to_email`/`subject`/`body` aren't
    in tool_input. send_install_supplement's input schema doesn't include
    those, so it would crash on every call.

    Standalone handler: derives the carrier address from claim_data
    (adjuster_email or previous_carrier_data.adjuster_email), sets the
    subject to the claim number per email-rules convention, and composes
    a post-installation supplement body inline.
    """
    include_coc = bool(tool_input.get("include_coc", True))
    additional_notes = (tool_input.get("additional_notes") or "").strip()

    # Derive carrier address — same fallback chain as _build_claim_brain_prompt
    prev_data = claim_data.get("previous_carrier_data") or {}
    adjuster_email = (
        claim_data.get("adjuster_email")
        or (prev_data.get("adjuster_email") if isinstance(prev_data, dict) else None)
        or ""
    )
    if not adjuster_email:
        return {
            "action": "error",
            "message": "Cannot send install supplement: no adjuster email on file. Update the claim with the adjuster's address first.",
        }

    claim_number = (
        claim_data.get("claim_number")
        or (prev_data.get("claim_number") if isinstance(prev_data, dict) else None)
        or ""
    )
    if not claim_number:
        return {
            "action": "error",
            "message": "Cannot send install supplement: claim number is missing. Per email rules, the subject must be the claim number only.",
        }

    contractor_rcv = float(claim_data.get("contractor_rcv") or 0)

    # Find the most recent COC PDF for this claim (best-effort)
    attachments: list[dict] = []
    if include_coc:
        try:
            res = sb.table("claim_emails").select("attachments").eq("claim_id", claim_id).eq(
                "email_type", "coc"
            ).order("sent_at", desc=True).limit(1).execute()
            if res.data:
                stored = res.data[0].get("attachments") or []
                if isinstance(stored, list):
                    for att in stored:
                        if isinstance(att, dict):
                            path = att.get("path") or att.get("storage_path")
                            fname = att.get("filename") or "Certificate_of_Completion.pdf"
                            if path:
                                attachments.append({"path": path, "filename": fname})
                                break
        except Exception as e:
            print(f"[install_supplement] COC lookup failed (non-fatal): {e}", flush=True)

    # Human, varied completion + install-supplement body. Contractor mode — no
    # advocacy language; copy rotates per claim so adjusters don't see identical
    # templates. (Was the stiff "Dear adjuster, This message confirms ..." block.)
    body_html = _supplement_email_body(
        claim_data,
        company_profile,
        contractor_rcv=contractor_rcv,
        coc_attached=bool(attachments),
        additional_notes=additional_notes,
        completion=True,
    )

    return {
        "action": "preview",
        "type": "email",
        "tool_name": "send_install_supplement",
        "draft": {
            "to": adjuster_email,
            "cc": None,
            "subject": claim_number,  # Per email rules: subject = claim number only
            "body_html": body_html,
            "attachments": attachments,
        },
        "message": (
            f"Draft post-installation supplement ready for {adjuster_email} "
            f"(claim {claim_number}, contractor RCV ${contractor_rcv:,.2f})."
            + (f" COC attached." if attachments else " No COC found — sending without attachment.")
        ),
    }


# ═══════════════════════════════════════════════════════════════════════
# PHASE 4 — RETAIL TOOL HANDLERS
# ═══════════════════════════════════════════════════════════════════════
# Three tools that operate on the new retail_jobs / retail_invoices tables
# (NOT claims). All three return preview payloads — the user approves in
# chat, then the frontend POSTs to the corresponding TS endpoint to actually
# write/send. This mirrors the existing send_custom_email / generate_invoice
# pattern.


async def _handle_create_retail_estimate(sb, user_id, company_profile, tool_input):
    """Create a draft retail estimate. Saves a retail_jobs row in 'draft'
    status and returns a preview payload for user approval.

    Pricing: company_profiles.settings.retail.price_list (per Tom 2026-05-16
    decision). If no price list is configured, falls back to whatever
    line_items the caller supplied; if neither exists, returns an error
    pointing the user to Company Settings → Retail.
    """
    company_id = company_profile.get("company_id")
    if not company_id:
        return {
            "action": "error",
            "message": "You don't have a company on your profile yet — set one up in Company Settings before creating retail estimates.",
        }

    settings = company_profile.get("settings") or {}
    retail_cfg = settings.get("retail") or {}
    company_price_list = {
        # Normalize description → unit_price for fuzzy match below
        (it.get("description") or "").strip().lower(): it
        for it in (retail_cfg.get("price_list") or [])
        if isinstance(it, dict) and it.get("description")
    }
    default_tax_rate = float(retail_cfg.get("default_tax_rate") or 0)
    default_deposit_pct = float(
        tool_input.get("deposit_pct")
        if tool_input.get("deposit_pct") is not None
        else retail_cfg.get("default_deposit_pct") or 0
    )
    default_terms = retail_cfg.get("default_terms") or ""
    default_payment_schedule = retail_cfg.get("default_payment_schedule") or ""

    # Resolve line items
    raw_items = tool_input.get("line_items") or []
    if not raw_items:
        if not company_price_list:
            return {
                "action": "error",
                "message": (
                    "No line_items provided AND no retail price list configured in Company "
                    "Settings → Retail. Either pass explicit line_items or set up your retail "
                    "price list first."
                ),
                "tool_name": "create_retail_estimate",
            }
        # No items supplied — surface as a draft asking the user to confirm a
        # blank estimate they can edit on the retail page.
        raw_items = []

    line_items = []
    subtotal_cents = 0
    warnings: list[str] = []
    # Normalize price list keys the same way PUT /api/admin/retail/settings
    # normalizes them: trim + lowercase + collapse internal whitespace. Keeps
    # "Laminate  shingle" (double space) matching "Laminate shingle".
    import re as _re
    def _norm(s: str) -> str:
        return _re.sub(r"\s+", " ", (s or "").strip().lower())
    normalized_price_list = {
        _norm(k): v for k, v in company_price_list.items()
    }
    for it in raw_items:
        desc = (it.get("description") or "").strip()
        try:
            qty = float(it.get("qty") or 0)
        except (TypeError, ValueError):
            qty = 0
        unit = it.get("unit") or "EA"
        unit_price_in = it.get("unit_price")
        matched_by_list = False
        unit_price = None
        if unit_price_in is not None:
            try:
                unit_price = float(unit_price_in)
            except (TypeError, ValueError):
                unit_price = None
        if unit_price is None:
            match = normalized_price_list.get(_norm(desc))
            if match:
                try:
                    unit_price = float(match.get("unit_price") or 0)
                except (TypeError, ValueError):
                    unit_price = 0
                unit = match.get("unit") or unit
                matched_by_list = True

        if unit_price is None or unit_price <= 0:
            warnings.append(
                f"No price found for \"{desc}\" — add it to your retail price list "
                f"(Retail → Prices & terms) or pass unit_price explicitly."
            )
            unit_price = 0
        if qty <= 0:
            warnings.append(
                f"Quantity for \"{desc}\" is 0 — line will not contribute to the total."
            )

        amount = round(qty * unit_price, 2)
        amount_cents = int(round(amount * 100))
        subtotal_cents += amount_cents
        line_items.append({
            "description": desc,
            "qty": qty,
            "unit": unit,
            "unit_price": unit_price,
            "amount": amount,
            "matched_by_price_list": matched_by_list,
        })

    tax_cents = int(round(subtotal_cents * default_tax_rate))
    total_cents = subtotal_cents + tax_cents

    # Persist as draft so the retail page picks it up immediately on approve.
    insert_payload = {
        "company_id": company_id,
        "created_by": user_id,
        "assigned_user_id": user_id,
        "customer_name": tool_input["customer_name"],
        "customer_email": tool_input.get("customer_email"),
        "customer_phone": tool_input.get("customer_phone"),
        "address": tool_input.get("address"),
        "city_state_zip": tool_input.get("city_state_zip"),
        "scope_description": tool_input.get("scope_description"),
        "line_items": line_items,
        "subtotal_cents": subtotal_cents,
        "tax_rate": default_tax_rate,
        "tax_cents": tax_cents,
        "total_cents": total_cents,
        "terms": default_terms or None,
        "deposit_pct": default_deposit_pct,
        "payment_schedule": default_payment_schedule or None,
        "status": "draft",
        "notes": tool_input.get("notes"),
    }

    try:
        res = sb.table("retail_jobs").insert(insert_payload).execute()
        job_row = (res.data or [{}])[0]
        retail_job_id = job_row.get("id")
    except Exception as e:
        return {
            "action": "error",
            "message": f"Failed to save retail draft: {e}",
            "tool_name": "create_retail_estimate",
        }

    preview = {
        "action": "preview",
        "type": "retail_estimate",
        "tool_name": "create_retail_estimate",
        "retail_job_id": retail_job_id,
        "summary": {
            "customer": tool_input["customer_name"],
            "address": tool_input.get("address") or "—",
            "line_count": len(line_items),
            "subtotal": subtotal_cents / 100,
            "tax_rate_pct": default_tax_rate * 100,
            "tax": tax_cents / 100,
            "total": total_cents / 100,
            "deposit_pct": default_deposit_pct,
            "deposit_amount": (total_cents / 100) * (default_deposit_pct / 100) if default_deposit_pct else None,
        },
        "line_items": line_items,
        "warnings": warnings,
        "review_url": f"/dashboard/admin/retail/{retail_job_id}",
        "message": (
            (
                f"⚠️ {len(warnings)} pricing issue{'s' if len(warnings) != 1 else ''} — "
                if warnings else ""
            )
            + f"Retail estimate drafted for {tool_input['customer_name']}: "
            f"${total_cents / 100:,.2f} across {len(line_items)} line items. "
            f"Review and send from the retail page."
        ),
    }

    if tool_input.get("send_now") and tool_input.get("customer_email"):
        company_name = company_profile.get("company_name") or company_profile.get("name") or "your roofing team"
        preview["draft_email"] = {
            "to": tool_input["customer_email"],
            "subject": f"Your estimate from {company_name}",
            "body_html": (
                f"<p>Hi {(tool_input['customer_name'].split() or ['there'])[0]},</p>"
                f"<p>Thanks for the opportunity to bid on your project. The full "
                f"estimate totals <strong>${total_cents / 100:,.2f}</strong> "
                f"({len(line_items)} line items). The detailed proposal PDF is attached.</p>"
                + (
                    f"<p>To get on the schedule we ask for a "
                    f"<strong>{default_deposit_pct:.0f}% deposit</strong> "
                    f"(${(total_cents / 100) * (default_deposit_pct / 100):,.2f}); "
                    f"the rest is due on completion.</p>"
                    if default_deposit_pct else ""
                )
                + f"<p>Reply to this email with any questions.</p>"
                  f"<p>— {company_name}</p>"
            ),
        }

    return preview


async def _handle_send_company_intro_email(sb, user_id, company_profile, tool_input):
    """Build a branded 'about us' intro email. Returns a draft for approval —
    the existing custom-email send path executes on user approve.
    """
    company_name = (
        company_profile.get("company_name")
        or company_profile.get("name")
        or "our roofing team"
    )
    address = company_profile.get("address") or ""
    city_state_zip = company_profile.get("city_state_zip") or ""
    license_number = company_profile.get("license_number") or ""
    website = company_profile.get("website") or ""
    phone = company_profile.get("phone") or company_profile.get("office_phone") or ""
    sending_email = company_profile.get("sending_email") or ""

    first_name = (tool_input.get("first_name") or "there").strip() or "there"
    context_line = (tool_input.get("customer_context") or "").strip()

    # Recent wins — optional, best-effort (don't block on errors)
    wins_html = ""
    if tool_input.get("include_recent_wins", True):
        try:
            company_id = company_profile.get("company_id")
            if company_id:
                res = (
                    sb.table("claims")
                    .select("address, financials, status")
                    .eq("company_id", company_id)
                    .eq("status", "won")
                    .order("last_touched_at", desc=True)
                    .limit(3)
                    .execute()
                )
                wins = res.data or []
                if wins:
                    rows = []
                    for w in wins:
                        addr = w.get("address") or "a recent project"
                        total = ((w.get("financials") or {}).get("total")) or 0
                        rows.append(f"<li><strong>{addr}</strong> — ${total:,.0f} recovered</li>")
                    wins_html = (
                        "<p><strong>Recent wins:</strong></p><ul>"
                        + "".join(rows)
                        + "</ul>"
                    )
        except Exception:
            wins_html = ""

    address_block = ""
    if address or city_state_zip:
        address_block = f"<p style='color:#666;font-size:12px;margin-top:24px'>{address}{', ' + city_state_zip if address and city_state_zip else city_state_zip}</p>"

    body_html = (
        f"<p>Hi {first_name},</p>"
        + (f"<p>{context_line}</p>" if context_line else "")
        + f"<p>I wanted to take a minute to introduce <strong>{company_name}</strong>.</p>"
        + (f"<p>We're licensed (#{license_number}) and based locally. " if license_number else "<p>We're based locally. ")
        + "We specialize in storm-damage restoration and full-replacement roofing — "
        + "the difference is we use forensic photo documentation and Xactimate-grade "
        + "scoping so you get every dollar your policy entitles you to.</p>"
        + wins_html
        + (f"<p>Best way to reach me directly: <strong>{phone}</strong>"
           + (f" or <a href='{website if website.startswith('http') else 'https://' + website}'>{website}</a>." if website else ".")
           + "</p>"
           if phone or website else "")
        + f"<p>Looking forward to talking,<br/>{company_name}</p>"
        + address_block
    )

    subject = f"Quick intro — {company_name}"

    draft = {
        "to": tool_input["to_email"],
        "subject": subject,
        "body_html": body_html,
        "attachments": [],
    }

    # Optional: stamp the retail_job's intro_email_sent_at *after* user approves.
    # The frontend send path is responsible for that write on success.
    return {
        "action": "preview",
        "type": "email",
        "tool_name": "send_company_intro_email",
        "draft": draft,
        "retail_job_id": tool_input.get("retail_job_id"),
        "from_email": sending_email or None,
        "message": f"Intro email draft ready for {tool_input['to_email']}.",
    }


async def _handle_send_retail_invoice(sb, user_id, company_profile, tool_input):
    """Stage a retail_invoices row and return a preview. The frontend executes
    the actual Stripe Connect payment-link creation on approve via the same
    mechanism used by /api/invoices/payment-link (claim invoices), so we don't
    duplicate Stripe SDK code in Python.

    Admin-only: retail invoicing moves real money out of the company's Connect
    account. RLS on retail_invoices is admin-FOR-ALL, so a non-admin rep would
    get a raw RLS exception on insert — surface a clean message instead.
    """
    if not company_profile.get("is_admin"):
        return {
            "action": "error",
            "message": (
                "Retail invoicing is admin-only. Ask a company admin to send the invoice, "
                "or have them grant you admin role first."
            ),
            "tool_name": "send_retail_invoice",
        }

    company_id = company_profile.get("company_id")
    if not company_id:
        return {
            "action": "error",
            "message": "No company on profile — connect one in Company Settings first.",
        }

    retail_job_id = tool_input.get("retail_job_id")
    if not retail_job_id:
        return {
            "action": "error",
            "message": "retail_job_id is required — create the estimate first, then invoice against it.",
        }

    # Fetch the retail job
    try:
        res = sb.table("retail_jobs").select("*").eq("id", retail_job_id).limit(1).execute()
        job = (res.data or [{}])[0] if res.data else {}
    except Exception as e:
        return {"action": "error", "message": f"Failed to load retail job: {e}"}

    if not job or job.get("company_id") != company_id:
        return {"action": "error", "message": "Retail job not found in your company."}

    to_email = tool_input.get("to_email") or job.get("customer_email")
    if not to_email:
        return {
            "action": "error",
            "message": "No customer email on file. Pass to_email or update the retail job first.",
        }

    try:
        amount_dollars = float(tool_input.get("amount") or 0)
    except (TypeError, ValueError):
        amount_dollars = 0
    if amount_dollars <= 0:
        return {"action": "error", "message": "amount must be > 0"}
    amount_cents = int(round(amount_dollars * 100))

    kind = tool_input.get("kind") or "full"
    description = tool_input.get("description") or f"{kind.title()} invoice — {job.get('customer_name','')}"

    connect_account_id = company_profile.get("stripe_connect_account_id")
    connect_status = company_profile.get("stripe_connect_status")
    if connect_status != "active" or not connect_account_id:
        return {
            "action": "error",
            "message": (
                "Stripe Connect isn't active for this company yet. Connect it in "
                "Company Settings → Payments before invoicing retail customers."
            ),
        }

    # Stage the invoice row as draft. Frontend executes the Stripe
    # payment-link creation on approve and flips status → sent.
    try:
        ins = sb.table("retail_invoices").insert({
            "retail_job_id": retail_job_id,
            "company_id": company_id,
            "created_by": user_id,
            "kind": kind,
            "amount_cents": amount_cents,
            "description": description,
            "sent_to_email": to_email,
            "stripe_connect_account_id": connect_account_id,
            "status": "draft",
            "notes": tool_input.get("notes"),
        }).execute()
        invoice_row = (ins.data or [{}])[0]
        invoice_id = invoice_row.get("id")
    except Exception as e:
        return {"action": "error", "message": f"Failed to stage retail invoice: {e}"}

    company_name = company_profile.get("company_name") or company_profile.get("name") or "your roofing team"
    subject_map = {
        "deposit": f"Deposit invoice — {company_name}",
        "progress": f"Progress invoice — {company_name}",
        "balance": f"Balance due — {company_name}",
        "full": f"Invoice — {company_name}",
    }
    subject = subject_map.get(kind, subject_map["full"])

    return {
        "action": "preview",
        "type": "retail_invoice",
        "tool_name": "send_retail_invoice",
        "retail_invoice_id": invoice_id,
        "retail_job_id": retail_job_id,
        "summary": {
            "customer": job.get("customer_name"),
            "amount": amount_dollars,
            "kind": kind,
            "description": description,
            "to_email": to_email,
            "connect_account_id": connect_account_id,
        },
        "draft_email": {
            "to": to_email,
            "subject": subject,
            "body_html": (
                f"<p>Hi {(job.get('customer_name') or 'there').split()[0]},</p>"
                f"<p>Your {kind} invoice for "
                f"<strong>${amount_dollars:,.2f}</strong> is ready: {description}.</p>"
                "<p>A secure payment link will be embedded when this email sends — click to pay by card.</p>"
                f"<p>Thanks,<br/>{company_name}</p>"
            ),
        },
        "execute_endpoint": f"/api/admin/retail/{retail_job_id}/invoices/{invoice_id}/send",
        "message": (
            f"Retail invoice staged: ${amount_dollars:,.2f} ({kind}) for "
            f"{job.get('customer_name')}. Approve to create the Stripe Connect "
            f"payment link and email it to {to_email}."
        ),
    }
