"""
Gmail Inbox Poller — claims@dumbroof.ai Email Ingestion
========================================================
Polls a Gmail inbox for new carrier correspondence AND edit requests:
  1. Fetches unread messages via Gmail API
  2. Detects forwarded emails (Gmail, Outlook, Apple Mail)
  3. Classifies: carrier correspondence vs. edit request
  4. Matches email to a claim (address, carrier, thread, claim number)
  5. Inserts carrier_correspondence OR edit_requests record
  6. Triggers AI analysis for matched emails

Classification logic:
  - Forwarded email + original_from is a carrier domain → carrier correspondence
  - Direct email from authorized forwarder (not forwarded) → edit request
  - Forwarded email but original_from is NOT a carrier → edit request
  - Unclear → AI classification fallback

Setup:
  - Create a Google Cloud project with Gmail API enabled
  - Create a service account OR OAuth2 credentials
  - For Google Workspace: use domain-wide delegation with service account
  - Set env vars: GMAIL_SERVICE_ACCOUNT_JSON, GMAIL_DELEGATED_USER (claims@dumbroof.ai)
"""

from __future__ import annotations

from model_config import MODEL  # unified model knob (see model_config.py)

import os
import re
import json
import base64
import email
import asyncio
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Optional

from supabase import Client

# Google API imports
from google.oauth2 import service_account
from googleapiclient.discovery import build

# ===================================================================
# CONFIG
# ===================================================================

POLL_INTERVAL_SECONDS = 60  # Check every 60 seconds
SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]
GMAIL_USER = os.environ.get("GMAIL_DELEGATED_USER", "claims@dumbroof.ai")

# Team email domains — outbound emails from these are our own sends (BCC copies),
# not inbound edit requests. Skip processing.
TEAM_DOMAINS: set[str] = {"usaroofmasters.com", "dumbroof.ai"}

# Known carrier email domains
CARRIER_DOMAINS: dict[str, str] = {
    "statefarm.com": "State Farm",
    "allstate.com": "Allstate",
    "libertymutual.com": "Liberty Mutual",
    "assurant.com": "Assurant",
    "nycm.com": "NYCM",
    "erieinsurance.com": "Erie Insurance",
    "travelers.com": "Travelers",
    "nationwide.com": "Nationwide",
    "progressive.com": "Progressive",
    "usaa.com": "USAA",
    "geico.com": "GEICO",
    "amica.com": "Amica",
    "hanover.com": "The Hanover",
    "thehartford.com": "The Hartford",
    "chubb.com": "Chubb",
    "safeco.com": "Safeco",
    "mapfre.com": "MAPFRE",
    "csaa.com": "CSAA",
    "farmersinsurance.com": "Farmers",
    # Added 2026-05-11 — Lemonade reply on 9 Highland would have skipped without this
    "lemonade.com": "Lemonade",
    "kemper.com": "Kemper",
    "metlife.com": "MetLife",
    "americanfamily.com": "American Family",
    "auto-owners.com": "Auto-Owners",
    "plymouthrock.com": "Plymouth Rock",
    "homesite.com": "Homesite",
    "esurance.com": "Esurance",
    "rootinsurance.com": "Root",
    "branch.com": "Branch",
    "haag.com": "Haag Engineering",  # often handles carrier inspections
    "nationalgeneral.com": "National General",
    "stillwater.com": "Stillwater",
    "encompassinsurance.com": "Encompass",
}


# ===================================================================
# GMAIL API CLIENT
# ===================================================================

def get_gmail_service():
    """Build Gmail API service using service account with domain-wide delegation."""
    sa_json = os.environ.get("GMAIL_SERVICE_ACCOUNT_JSON")
    if not sa_json:
        raise RuntimeError("GMAIL_SERVICE_ACCOUNT_JSON env var not set")

    # Support both file path and inline JSON
    if sa_json.startswith("{"):
        info = json.loads(sa_json)
    else:
        with open(sa_json) as f:
            info = json.load(f)

    creds = service_account.Credentials.from_service_account_info(
        info, scopes=SCOPES
    )
    # Delegate to claims@dumbroof.ai mailbox
    creds = creds.with_subject(GMAIL_USER)

    return build("gmail", "v1", credentials=creds, cache_discovery=False)


# ===================================================================
# EMAIL PARSING
# ===================================================================

def parse_gmail_message(service, msg_id: str) -> dict:
    """Fetch and parse a full Gmail message into a structured dict."""
    msg = service.users().messages().get(
        userId="me", id=msg_id, format="full"
    ).execute()

    headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}

    from_email = extract_email_address(headers.get("from", ""))
    subject = headers.get("subject", "")
    date_str = headers.get("date", "")
    message_id = headers.get("message-id", "")
    in_reply_to = headers.get("in-reply-to", "")
    references = headers.get("references", "")

    # Parse date
    msg_date = None
    if date_str:
        try:
            msg_date = parsedate_to_datetime(date_str).isoformat()
        except Exception:
            msg_date = None

    # Extract body
    text_body, html_body = extract_body(msg.get("payload", {}))

    # Extract attachments (PDFs and images)
    attachments = extract_attachments(service, msg_id, msg.get("payload", {}))

    # Detect forwarded email
    is_forwarded, original = parse_forwarded_email(from_email, subject, text_body)

    return {
        "gmail_id": msg_id,
        "thread_id": msg.get("threadId", ""),
        "message_id": message_id,
        "from_email": from_email,
        "subject": subject,
        "date": msg_date,
        "text_body": text_body,
        "html_body": html_body,
        "in_reply_to": in_reply_to,
        "references": references,
        "is_forwarded": is_forwarded,
        "original_from": original.get("from"),
        "original_subject": original.get("subject"),
        "original_date": original.get("date"),
        "original_body": original.get("body", text_body),
        "attachments": attachments,
        "label_ids": msg.get("labelIds", []),
    }


def extract_body(payload: dict) -> tuple[str, str]:
    """Recursively extract text and HTML body from Gmail payload."""
    text_body = ""
    html_body = ""

    mime_type = payload.get("mimeType", "")

    if mime_type == "text/plain" and payload.get("body", {}).get("data"):
        text_body = base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")
    elif mime_type == "text/html" and payload.get("body", {}).get("data"):
        html_body = base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")
    elif "parts" in payload:
        for part in payload["parts"]:
            t, h = extract_body(part)
            if t:
                text_body = text_body or t
            if h:
                html_body = html_body or h

    return text_body, html_body


def extract_attachments(service, msg_id: str, payload: dict) -> list[dict]:
    """Extract PDF and image attachments from Gmail message."""
    attachments = []

    def _walk_parts(parts):
        for part in parts:
            mime = part.get("mimeType", "")
            filename = part.get("filename", "")
            att_id = part.get("body", {}).get("attachmentId")

            if att_id and filename and (
                mime.startswith("application/pdf") or
                mime.startswith("image/")
            ):
                # Download attachment
                att = service.users().messages().attachments().get(
                    userId="me", messageId=msg_id, id=att_id
                ).execute()
                data = att.get("data", "")
                attachments.append({
                    "filename": filename,
                    "mimeType": mime,
                    "content": data,  # Already base64url encoded
                    "size": part.get("body", {}).get("size", 0),
                })

            # Recurse into nested parts
            if "parts" in part:
                _walk_parts(part["parts"])

    if "parts" in payload:
        _walk_parts(payload["parts"])

    return attachments


def extract_email_address(header_value: str) -> str:
    """Extract email from 'Name <email>' format."""
    match = re.search(r"<([^>]+)>", header_value)
    if match:
        return match.group(1).lower()
    # Bare email
    if "@" in header_value:
        return header_value.strip().lower()
    return header_value.strip().lower()


# ===================================================================
# FORWARD DETECTION
# ===================================================================

def parse_forwarded_email(
    from_email: str, subject: str, body: str
) -> tuple[bool, dict]:
    """Detect forwarded emails and extract original sender/subject/body."""
    original: dict = {}

    # Gmail forward marker
    gmail_marker = "---------- Forwarded message ----------"
    # Outlook forward marker
    outlook_marker = "-----Original Message-----"
    # Apple Mail
    apple_marker = "Begin forwarded message:"
    # Yahoo
    yahoo_marker = "----- Forwarded Message -----"

    markers = [gmail_marker, outlook_marker, apple_marker, yahoo_marker]

    body_lower = body if body else ""
    marker_pos = -1
    for marker in markers:
        pos = body_lower.find(marker)
        if pos >= 0:
            marker_pos = pos
            break

    if marker_pos < 0:
        # Check subject for "Fwd:" or "FW:"
        if re.match(r"^(Fwd?|FW)\s*:", subject, re.IGNORECASE):
            return True, original
        return False, original

    # Extract forwarded content after marker
    forwarded_section = body_lower[marker_pos:]

    # Extract From
    from_match = re.search(r"From:\s*(.+?)(?:\n|$)", forwarded_section)
    if from_match:
        original["from"] = extract_email_address(from_match.group(1).strip())

    # Extract Subject
    subj_match = re.search(r"Subject:\s*(.+?)(?:\n|$)", forwarded_section)
    if subj_match:
        original["subject"] = subj_match.group(1).strip()

    # Extract Date
    date_match = re.search(r"Date:\s*(.+?)(?:\n|$)", forwarded_section)
    if date_match:
        date_str = date_match.group(1).strip()
        try:
            original["date"] = parsedate_to_datetime(date_str).isoformat()
        except Exception:
            original["date"] = date_str

    # Extract body (everything after the headers block)
    # Find double newline after headers
    header_end = re.search(r"\n\s*\n", forwarded_section[len(markers[0]):] if marker_pos >= 0 else forwarded_section)
    if header_end:
        body_start = marker_pos + header_end.end()
        original["body"] = body[body_start:].strip()

    return True, original


# ===================================================================
# CLAIM MATCHING (ported from Edge Function)
# ===================================================================

def extract_claim_number(text: str) -> Optional[str]:
    """Extract claim/policy number from text."""
    patterns = [
        r"claim\s*#?\s*:?\s*([A-Z0-9][\w-]{4,20})",
        r"policy\s*#?\s*:?\s*([A-Z0-9][\w-]{4,20})",
        r"file\s*#?\s*:?\s*([A-Z0-9][\w-]{4,20})",
        r"reference\s*#?\s*:?\s*([A-Z0-9][\w-]{4,20})",
        r"\b(\d{7,15})\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1)
    return None


def extract_address(text: str) -> Optional[str]:
    """Extract street address from text."""
    match = re.search(
        r"\b(\d{1,5}\s+(?:[NSEW]\.?\s+)?(?:[A-Z][a-z]+\s*){1,4}"
        r"(?:St(?:reet)?|Ave(?:nue)?|Rd|Road|Blvd|Boulevard|Dr(?:ive)?|"
        r"Ln|Lane|Way|Ct|Court|Pl(?:ace)?|Pkwy|Cir(?:cle)?))\b",
        text, re.IGNORECASE
    )
    return match.group(1) if match else None


def identify_carrier(email_addr: str, body: str) -> Optional[str]:
    """Identify carrier from email domain or body text."""
    domain = email_addr.split("@")[-1].lower()
    if domain in CARRIER_DOMAINS:
        return CARRIER_DOMAINS[domain]

    body_lower = body.lower()
    for carrier_name in CARRIER_DOMAINS.values():
        if carrier_name.lower() in body_lower:
            return carrier_name
    return None


def normalize_address(addr: str) -> str:
    """Normalize address for matching."""
    result = addr.lower()
    replacements = {
        "street": "st", "avenue": "ave", "road": "rd",
        "boulevard": "blvd", "drive": "dr", "lane": "ln",
        "court": "ct", "place": "pl",
    }
    for full, abbr in replacements.items():
        result = re.sub(rf"\b{full}\b", abbr, result)
    result = re.sub(r"[.,#]", "", result)
    result = re.sub(r"\s+", " ", result).strip()
    return result


def fuzzy_address_match(a: str, b: str) -> bool:
    """Check if two normalized addresses match."""
    parts_a = a.split()
    parts_b = b.split()
    if not parts_a or not parts_b:
        return False
    # Street number must match
    if parts_a[0] != parts_b[0]:
        return False
    # At least one street name word must match
    words_a = set(parts_a[1:])
    words_b = set(parts_b[1:])
    return any(w in words_b and len(w) > 2 for w in words_a)


def match_to_claim(
    sb: Client, user_id: str,
    in_reply_to: str, claim_number: Optional[str],
    address: Optional[str], carrier_name: Optional[str],
    subject: str, forwarder_role: Optional[str] = None,
) -> dict:
    """Run claim matching algorithm. Returns match result dict."""

    # Strategy 1: Thread match via In-Reply-To header (confidence: 99)
    if in_reply_to:
        result = sb.table("email_drafts").select("claim_id").eq(
            "gmail_thread_id", in_reply_to
        ).limit(1).execute()
        if result.data and len(result.data) > 0 and result.data[0].get("claim_id"):
            return {
                "claim_id": result.data[0]["claim_id"],
                "method": "thread",
                "confidence": 99,
                "carrier_name": carrier_name,
                "claim_number": claim_number,
                "address": address,
            }

    # Get claims — admins can match ANY claim, regular users only their own
    if forwarder_role == "office_admin":
        claims_result = sb.table("claims").select("id, address, carrier").execute()
        print(f"[GMAIL POLLER] Admin override: searching all {len(claims_result.data or [])} claims", flush=True)
    else:
        claims_result = sb.table("claims").select(
            "id, address, carrier"
        ).eq("user_id", user_id).execute()
    user_claims = claims_result.data or []

    if not user_claims:
        return {
            "claim_id": None, "method": "none", "confidence": 0,
            "carrier_name": carrier_name, "claim_number": claim_number,
            "address": address,
        }

    # Strategy 2: Address match (confidence: 85)
    if address:
        norm_addr = normalize_address(address)
        for claim in user_claims:
            claim_addr = normalize_address(claim.get("address", ""))
            if claim_addr and norm_addr and fuzzy_address_match(norm_addr, claim_addr):
                return {
                    "claim_id": claim["id"],
                    "method": "address",
                    "confidence": 85,
                    "carrier_name": carrier_name or claim.get("carrier"),
                    "claim_number": claim_number,
                    "address": claim.get("address"),
                }

    # Strategy 3: Single carrier match (confidence: 75)
    if carrier_name:
        carrier_claims = [
            c for c in user_claims
            if carrier_name.lower() in (c.get("carrier") or "").lower()
        ]
        if len(carrier_claims) == 1:
            return {
                "claim_id": carrier_claims[0]["id"],
                "method": "carrier_single",
                "confidence": 75,
                "carrier_name": carrier_name,
                "claim_number": claim_number,
                "address": carrier_claims[0].get("address"),
            }

        # Strategy 4: Carrier + subject keywords (confidence: 60)
        if len(carrier_claims) > 1 and subject:
            subject_lower = subject.lower()
            for claim in carrier_claims:
                addr_words = (claim.get("address") or "").lower().split()
                if len(addr_words) >= 2:
                    street_num = addr_words[0]
                    street_name = " ".join(addr_words[1:3])
                    if street_num in subject_lower or street_name in subject_lower:
                        return {
                            "claim_id": claim["id"],
                            "method": "subject_keywords",
                            "confidence": 60,
                            "carrier_name": carrier_name,
                            "claim_number": claim_number,
                            "address": claim.get("address"),
                        }

    # No match
    return {
        "claim_id": None, "method": "none", "confidence": 0,
        "carrier_name": carrier_name, "claim_number": claim_number,
        "address": address,
    }


# ===================================================================
# USER RESOLUTION
# ===================================================================

def resolve_user_id(sb: Client, forwarder_email: str) -> tuple:
    """Map forwarder email to (user_id, role). Role is used for admin claim matching."""
    email_lower = forwarder_email.lower()

    # 1. Check authorized_forwarders table
    try:
        result = sb.table("authorized_forwarders").select("user_id, role").eq(
            "email", email_lower
        ).execute()
        if result.data and len(result.data) > 0:
            row = result.data[0]
            return (row["user_id"], row.get("role", "team_member"))
    except Exception:
        pass

    # 2. Check auth.users via admin API
    try:
        users = sb.auth.admin.list_users()
        for u in users:
            if hasattr(u, 'email') and u.email and u.email.lower() == email_lower:
                return (u.id, "team_member")
    except Exception:
        pass

    # 3. Domain-based fallback for team emails
    domain = forwarder_email.split("@")[-1].lower()
    if domain in TEAM_DOMAINS:
        try:
            # Look up any existing user to associate with
            admin_users = sb.auth.admin.list_users()
            admin_id = None
            for u in admin_users:
                if hasattr(u, 'id') and u.id:
                    admin_id = u.id
                    break
            if admin_id:
                sb.table("authorized_forwarders").insert({
                    "email": email_lower,
                    "user_id": admin_id,
                    "name": forwarder_email.split("@")[0].replace(".", " ").title(),
                    "role": "office_admin",
                }).execute()
                print(f"[GMAIL POLLER] Auto-registered team forwarder: {forwarder_email}", flush=True)
                return (admin_id, "office_admin")
        except Exception as e:
            print(f"[GMAIL POLLER] Failed to auto-register {forwarder_email}: {e}", flush=True)

    return (None, None)


# Per-process cache so we don't re-query company_profiles on every email.
# Key: user_id (str). Value: company_id (str | None).
_COMPANY_ID_CACHE: dict[str, str | None] = {}


def resolve_company_id(sb: Client, user_id: str) -> str | None:
    """Look up the company_id for a user_id (cached per-process).

    Stamped onto carrier_correspondence + edit_requests inserts so the rows
    are visible under company-scoped RLS.
    """
    if not user_id:
        return None
    if user_id in _COMPANY_ID_CACHE:
        return _COMPANY_ID_CACHE[user_id]
    company_id: str | None = None
    try:
        result = sb.table("company_profiles").select("company_id").eq(
            "user_id", user_id
        ).limit(1).execute()
        if result.data and len(result.data) > 0:
            company_id = result.data[0].get("company_id") or None
    except Exception as e:
        print(f"[GMAIL POLLER] resolve_company_id failed for {user_id}: {e}", flush=True)
    _COMPANY_ID_CACHE[user_id] = company_id
    return company_id


# ===================================================================
# EMAIL CLASSIFICATION — Carrier Correspondence vs Edit Request
# ===================================================================

def classify_email(parsed: dict, carrier_name: str | None) -> str:
    """
    Classify an email as 'carrier_correspondence', 'edit_request', or 'outbound_send'.

    Rules:
    0. Direct (not forwarded) from a team domain → outbound_send (BCC copy of our own send)
    1. Forwarded + original_from is a known carrier domain → carrier_correspondence
    2. Direct (not forwarded) from authorized forwarder → edit_request
    3. Forwarded but original_from is NOT a carrier → edit_request
    """
    is_forwarded = parsed.get("is_forwarded", False)
    original_from = parsed.get("original_from") or ""
    from_email = parsed.get("from_email") or ""
    from_domain = from_email.split("@")[-1].lower() if "@" in from_email else ""

    # Rule 0: Outbound email from the team (BCC copy from Send Documents, supplement
    # composer, AOB notify, etc.). These are NOT edit requests — they're our own sends
    # that got BCC'd to claims@dumbroof.ai. Skip processing.
    if not is_forwarded and from_domain in TEAM_DOMAINS:
        return "outbound_send"

    if is_forwarded and original_from:
        # Check if original sender is a carrier
        domain = original_from.split("@")[-1].lower() if "@" in original_from else ""
        if domain in CARRIER_DOMAINS:
            return "carrier_correspondence"
        # Forwarded but not from a carrier → edit request
        return "edit_request"

    if is_forwarded and not original_from:
        # Subject-only forward detection — could be either, check for carrier name in body
        if carrier_name:
            return "carrier_correspondence"
        return "edit_request"

    # Direct email (not forwarded) from non-team sender → edit request
    return "edit_request"


async def analyze_edit_request(text: str, subject: str, attachments: list,
                               sb: Client = None, claim_id: str = None) -> dict:
    """
    Use Sonnet to parse an edit request email into structured changes.

    Returns:
        {
            "changes": [{"action": "add", "item": "gutters", "details": "..."}],
            "request_type": "add_items",
            "confidence": 90
        }
    """
    import anthropic
    from telemetry import call_claude_logged

    attachment_summary = ""
    if attachments:
        att_names = [a.get("filename", "unknown") for a in attachments]
        attachment_summary = f"\nAttachments: {', '.join(att_names)}"

    prompt = f"""Analyze this email sent to claims@dumbroof.ai requesting changes to a claim report.

Subject: {subject}
Body: {text}{attachment_summary}

If the email includes PDF attachments that replace or update documents, classify EACH attachment
by its document type. Look at filenames and email context to determine type.

Common patterns:
- "EagleView", "measurements", "aerial", "roof report" → measurements
- "scope", "estimate", "insurance", "carrier", "Xactimate", "loss" → scope
- "photos", "inspection", "CompanyCam" → photos
- "weather", "NOAA", "HailTrace", "storm" → weather

Extract structured changes. Respond with JSON only:
{{
  "changes": [
    {{"action": "add|remove|update|replace", "item": "short item name", "details": "what to do"}}
  ],
  "request_type": "add_items|update_photos|carrier_scope|remove_items|replace_document|other",
  "document_type": "measurements|photos|scope|weather (only if replace_document AND all attachments are same type)",
  "per_file": {{"filename1.pdf": "measurements", "filename2.pdf": "scope"}},
  "confidence": 0-100
}}

IMPORTANT: If multiple attachments have DIFFERENT document types, you MUST include "per_file"
mapping each filename to its type. Use exact filenames from the Attachments list above."""

    try:
        client = anthropic.Anthropic()
        response = call_claude_logged(
            client, sb, claim_id,
            step_name="gmail_edit_request_analysis",
            model=MODEL,
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )
        text_content = response.content[0].text.strip()
        # Extract JSON from response
        if text_content.startswith("{"):
            return json.loads(text_content)
        # Try to find JSON block
        json_match = re.search(r"\{[\s\S]*\}", text_content)
        if json_match:
            return json.loads(json_match.group())
    except Exception as e:
        print(f"[GMAIL POLLER] Edit request analysis failed: {e}", flush=True)

    return {
        "changes": [{"action": "other", "item": "manual review needed", "details": subject}],
        "request_type": "other",
        "confidence": 30,
    }


# ===================================================================
# MAIN POLL LOOP
# ===================================================================

async def poll_gmail_inbox(sb: Client, backend_url: str = "http://localhost:8000"):
    """
    Background poller — fetches unread messages from claims@dumbroof.ai
    every POLL_INTERVAL_SECONDS.
    """
    # Check if Gmail credentials are configured
    if not os.environ.get("GMAIL_SERVICE_ACCOUNT_JSON"):
        print("[GMAIL POLLER] GMAIL_SERVICE_ACCOUNT_JSON not set — email polling disabled", flush=True)
        return

    print(f"[GMAIL POLLER] Starting — polling {GMAIL_USER} every {POLL_INTERVAL_SECONDS}s", flush=True)

    while True:
        try:
            # Run Gmail API calls in a thread to avoid blocking the event loop
            # (Gmail API client is synchronous — blocking here prevents claims/repairs pollers)
            service = await asyncio.to_thread(get_gmail_service)
            await _poll_once(service, sb, backend_url)
        except Exception as e:
            print(f"[GMAIL POLLER] Error: {e}", flush=True)

        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def _poll_once(service, sb: Client, backend_url: str):
    """Single poll iteration — fetch and process unread messages."""
    # List unread messages in inbox (run in thread — Gmail API is synchronous)
    results = await asyncio.to_thread(
        lambda: service.users().messages().list(
            userId="me",
            q="is:unread",
            maxResults=10,
        ).execute()
    )

    messages = results.get("messages", [])
    if not messages:
        return

    print(f"[GMAIL POLLER] Found {len(messages)} unread messages", flush=True)

    for msg_ref in messages:
        msg_id = msg_ref["id"]

        try:
            # Parse the full message
            parsed = parse_gmail_message(service, msg_id)

            # Dedup check on message_id (carrier_correspondence has message_id column)
            if parsed["message_id"]:
                existing = sb.table("carrier_correspondence").select("id").eq(
                    "message_id", parsed["message_id"]
                ).limit(1).execute()
                if existing.data:
                    print(f"[GMAIL POLLER] Duplicate (correspondence): {parsed['message_id']}", flush=True)
                    _mark_as_read(service, msg_id)
                    continue

            # Resolve who forwarded it
            user_id, forwarder_role = resolve_user_id(sb, parsed["from_email"])
            if not user_id:
                # Log unrecognized sender so nothing gets lost
                try:
                    sb.table("unrecognized_emails").insert({
                        "from_email": parsed["from_email"],
                        "subject": parsed.get("subject", ""),
                        "received_at": datetime.now().isoformat(),
                        "raw_snippet": (parsed.get("text_body", "") or "")[:500],
                    }).execute()
                except Exception as log_err:
                    print(f"[GMAIL POLLER] Failed to log unrecognized email: {log_err}", flush=True)
                print(f"[GMAIL POLLER] Unknown forwarder logged: {parsed['from_email']}", flush=True)
                _mark_as_read(service, msg_id)
                continue

            # Identify carrier
            carrier_email = parsed["original_from"] or parsed["from_email"]
            carrier_name = identify_carrier(carrier_email, parsed["text_body"])

            # Classify: carrier correspondence vs edit request vs outbound send
            email_type = classify_email(parsed, carrier_name)

            # Outbound sends (BCC copies of our own emails) — skip processing
            if email_type == "outbound_send":
                print(f"[GMAIL POLLER] Skipping outbound send from {parsed['from_email']}: {parsed['subject']}", flush=True)
                _mark_as_read(service, msg_id)
                continue

            # Extract claim number and address
            search_text = f"{parsed['subject']} {parsed.get('original_subject', '')} {parsed['text_body']}"
            claim_number = extract_claim_number(search_text)
            address_parsed = extract_address(search_text)

            # Match to claim
            match = match_to_claim(
                sb, user_id,
                in_reply_to=parsed["in_reply_to"],
                claim_number=claim_number,
                address=address_parsed,
                carrier_name=carrier_name,
                subject=parsed.get("original_subject") or parsed["subject"],
                forwarder_role=forwarder_role,
            )

            # Upload attachments to Supabase Storage
            attachment_paths = []
            claim_slug = "unmatched"
            if match["claim_id"]:
                slug_result = sb.table("claims").select("address").eq(
                    "id", match["claim_id"]
                ).single().execute()
                if slug_result.data:
                    claim_slug = re.sub(
                        r"[^a-z0-9]+", "-",
                        (slug_result.data.get("address") or "claim").lower()
                    )[:50]

            subfolder = "correspondence" if email_type == "carrier_correspondence" else "edit-requests"
            for att in parsed["attachments"]:
                storage_path = f"{user_id}/{claim_slug}/{subfolder}/{int(datetime.utcnow().timestamp())}_{att['filename']}"
                try:
                    # Gmail returns base64url, convert to bytes
                    file_bytes = base64.urlsafe_b64decode(att["content"] + "==")
                    upload_result = sb.storage.from_("claim-documents").upload(
                        storage_path, file_bytes,
                        {"content-type": att["mimeType"]}
                    )
                    attachment_paths.append(storage_path)
                except Exception as upload_err:
                    print(f"[GMAIL POLLER] Upload failed for {att['filename']}: {upload_err}", flush=True)

            # ---- EDIT REQUEST FLOW ----
            if email_type == "edit_request":
                # Dedup check on edit_requests table
                if parsed["message_id"]:
                    existing_edit = sb.table("edit_requests").select("id").eq(
                        "from_email", parsed["from_email"]
                    ).eq("original_subject", parsed["subject"]).limit(1).execute()
                    # Simple dedup — exact subject + sender match within recent window
                    # (edit_requests don't have message_id column, so use subject match)

                # Analyze with AI
                body_text = parsed.get("original_body") or parsed["text_body"] or ""
                subject_text = parsed.get("original_subject") or parsed["subject"] or ""
                ai_result = await analyze_edit_request(
                    body_text, subject_text, parsed["attachments"],
                    sb=sb, claim_id=match.get("claim_id"),
                )

                edit_record = {
                    "claim_id": match["claim_id"],
                    "user_id": user_id,
                    "company_id": resolve_company_id(sb, user_id),
                    "from_email": parsed["from_email"],
                    "original_subject": subject_text,
                    "original_body": body_text,
                    "request_type": ai_result.get("request_type", "other"),
                    "attachment_paths": attachment_paths,
                    "ai_summary": json.dumps(ai_result),
                    "status": "pending",
                }

                inserted = sb.table("edit_requests").insert(edit_record).execute()
                edit_id = inserted.data[0]["id"] if inserted.data else "unknown"
                print(f"[GMAIL POLLER] Created edit_request {edit_id}, type={ai_result.get('request_type')}, matched={bool(match['claim_id'])}", flush=True)

                # Update claim pending_edits count
                if match["claim_id"]:
                    claim_data = sb.table("claims").select("pending_edits").eq(
                        "id", match["claim_id"]
                    ).single().execute()
                    current_count = (claim_data.data or {}).get("pending_edits", 0) or 0
                    sb.table("claims").update({
                        "pending_edits": current_count + 1
                    }).eq("id", match["claim_id"]).execute()

                # ---- AUTO-REPLACE DOCUMENT FLOW ----
                if (ai_result.get("request_type") == "replace_document"
                        and match["claim_id"] and attachment_paths):

                    doc_type = ai_result.get("document_type", "measurements")
                    doc_map = {
                        "measurements": ("measurement_files", "measurements"),
                        "photos": ("photo_files", "photos"),
                        "scope": ("scope_files", "scope"),
                        "weather": ("weather_files", "weather"),
                    }

                    if doc_type in doc_map:
                        # Fetch ALL document fields so per-file routing can update any of them
                        claim_detail = sb.table("claims").select(
                            "file_path, measurement_files, photo_files, scope_files, weather_files"
                        ).eq("id", match["claim_id"]).single().execute()

                        if claim_detail.data:
                            claim_file_path = claim_detail.data["file_path"]
                            per_file = ai_result.get("per_file", {})
                            # Track which DB fields were updated
                            updated_fields = {}

                            for att_path in attachment_paths:
                                filename = att_path.split("/")[-1]
                                clean_name = re.sub(r"^\d+_", "", filename)

                                # Per-file classification — fall back to single doc_type
                                file_doc_type = per_file.get(clean_name, doc_type)
                                if file_doc_type not in doc_map:
                                    file_doc_type = doc_type

                                file_db_field, file_storage_folder = doc_map[file_doc_type]
                                target_path = f"{claim_file_path}/{file_storage_folder}/{clean_name}"

                                try:
                                    file_data = sb.storage.from_("claim-documents").download(att_path)
                                    sb.storage.from_("claim-documents").upload(
                                        target_path, file_data,
                                        {"content-type": "application/pdf", "upsert": "true"}
                                    )
                                    # Build per-field file lists
                                    if file_db_field not in updated_fields:
                                        updated_fields[file_db_field] = list(
                                            claim_detail.data.get(file_db_field) or []
                                        )
                                    if clean_name not in updated_fields[file_db_field]:
                                        updated_fields[file_db_field].append(clean_name)
                                    print(f"[GMAIL POLLER] Copied {att_path} -> {target_path} (type: {file_doc_type})", flush=True)
                                except Exception as copy_err:
                                    print(f"[GMAIL POLLER] Copy failed: {copy_err}", flush=True)

                            # Update all affected DB fields in one call
                            if updated_fields:
                                sb.table("claims").update(
                                    updated_fields
                                ).eq("id", match["claim_id"]).execute()

                            # Auto-trigger reprocessing
                            try:
                                sb.table("claims").update({
                                    "status": "processing"
                                }).eq("id", match["claim_id"]).execute()

                                from processor import process_claim
                                asyncio.create_task(process_claim(match["claim_id"]))
                                print(f"[GMAIL POLLER] Auto-reprocessing claim {match['claim_id']} after document replacement", flush=True)
                            except Exception as reprocess_err:
                                print(f"[GMAIL POLLER] Auto-reprocess failed: {reprocess_err}", flush=True)

                            # Mark edit request as auto-applied
                            if inserted.data:
                                sb.table("edit_requests").update({
                                    "status": "auto_applied"
                                }).eq("id", inserted.data[0]["id"]).execute()

                _mark_as_read(service, msg_id)
                continue

            # ---- CARRIER CORRESPONDENCE FLOW (existing) ----
            # Insert carrier_correspondence record
            record = {
                "claim_id": match["claim_id"],
                "user_id": user_id,
                "company_id": resolve_company_id(sb, user_id),
                "message_id": parsed["message_id"],
                "from_email": parsed["from_email"],
                "original_from": parsed["original_from"] or parsed["from_email"],
                "original_subject": parsed.get("original_subject") or parsed["subject"],
                "original_date": parsed.get("original_date") or parsed["date"],
                "text_body": parsed.get("original_body") or parsed["text_body"],
                "html_body": parsed["html_body"],
                "is_forwarded": parsed["is_forwarded"],
                "carrier_name": match["carrier_name"] or carrier_name,
                "claim_number_parsed": match["claim_number"] or claim_number,
                "address_parsed": match["address"] or address_parsed,
                "attachment_paths": attachment_paths,
                "match_method": match["method"],
                "match_confidence": match["confidence"],
                "status": "matched" if match["claim_id"] else "unmatched",
                "analysis_status": "pending",
            }

            inserted = sb.table("carrier_correspondence").insert(record).execute()
            corr_id = inserted.data[0]["id"] if inserted.data else "unknown"
            print(f"[GMAIL POLLER] Created correspondence {corr_id}, matched={bool(match['claim_id'])}, confidence={match['confidence']}", flush=True)

            # Update claim counts
            if match["claim_id"]:
                claim_data = sb.table("claims").select("correspondence_count").eq(
                    "id", match["claim_id"]
                ).single().execute()
                current_count = (claim_data.data or {}).get("correspondence_count", 0) or 0
                sb.table("claims").update({
                    "correspondence_count": current_count + 1
                }).eq("id", match["claim_id"]).execute()

            # Trigger AI analysis if matched with sufficient confidence
            if match["claim_id"] and match["confidence"] >= 50:
                try:
                    import httpx
                    async with httpx.AsyncClient() as client:
                        await client.post(
                            f"{backend_url}/api/analyze-correspondence/{corr_id}",
                            timeout=10,
                        )
                    print(f"[GMAIL POLLER] Triggered AI analysis for {corr_id}", flush=True)
                except Exception:
                    # Non-fatal — analysis can be triggered manually
                    # Fall back to direct function call
                    try:
                        from correspondence_analyzer import analyze_correspondence
                        await analyze_correspondence(sb, corr_id)
                        print(f"[GMAIL POLLER] Direct AI analysis complete for {corr_id}", flush=True)
                    except Exception as analysis_err:
                        print(f"[GMAIL POLLER] Analysis failed for {corr_id}: {analysis_err}", flush=True)

            # Mark as read in Gmail
            _mark_as_read(service, msg_id)

        except Exception as msg_err:
            print(f"[GMAIL POLLER] Error processing message {msg_id}: {msg_err}", flush=True)


def _mark_as_read(service, msg_id: str):
    """Remove UNREAD label from a Gmail message."""
    try:
        service.users().messages().modify(
            userId="me",
            id=msg_id,
            body={"removeLabelIds": ["UNREAD"]},
        ).execute()
    except Exception as e:
        print(f"[GMAIL POLLER] Failed to mark {msg_id} as read: {e}", flush=True)


# ===================================================================
# PER-USER GMAIL INBOX POLLER (Phase 3c follow-up, 2026-05-11)
# ===================================================================
#
# The existing poll_gmail_inbox() above polls the central claims@dumbroof.ai
# mailbox via service-account domain-wide delegation. That covers homeowner
# replies and forwarded carrier emails.
#
# This separate flow polls each contractor's OWN connected Gmail inbox
# (via OAuth refresh token stored on company_profiles.gmail_refresh_token)
# for direct carrier replies — Lemonade replying to Tom's supplement, etc.
#
# Cost-conscious by design: NO AI calls in the poll path. Just match-by-
# heuristic (carrier domain / thread / claim number) and INSERT into
# carrier_correspondence with analysis_status='pending'. AI analysis fires
# only when the user explicitly clicks "Analyze & Draft Response" in the
# per-claim Comms tab (existing CommunicationsCenter UI). At 100 connected
# inboxes the daily cost is essentially zero — Gmail API quota usage is
# ~0.01% of the 1B/day allowance and no LLM tokens are spent.

USER_POLL_INTERVAL_SECONDS = 3600  # hourly — see feedback_email_send_side_effects.md
USER_POLL_MAX_RESULTS = 20         # per user per cycle (most users get <5 unread/hour)


def get_gmail_service_for_user(refresh_token: str):
    """Build a Gmail API client for an individual user via their OAuth refresh token.

    Sibling to get_gmail_service() (above) which uses service-account delegation
    for the central claims@dumbroof.ai mailbox. This variant is for the per-user
    inbox flow where the user has granted offline access via the OAuth consent
    screen (`/api/gmail-auth/authorize` → callback stores refresh_token on
    company_profiles).
    """
    from google.oauth2.credentials import Credentials
    # Reuse the same exchange helper the outbound send path uses — same
    # OAuth client_id/secret env vars, same /oauth2/v4/token endpoint, same
    # error semantics ("invalid_grant" = user revoked, surface clearly).
    from claim_brain_email import refresh_gmail_token

    access_token = refresh_gmail_token(refresh_token)
    creds = Credentials(
        token=access_token,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        # client_id/secret intentionally None — we've already minted the access
        # token via refresh_gmail_token. Credentials only auto-refreshes when
        # the access_token expires mid-session; for our short polling window
        # (<60s of API calls per user per cycle) the minted token never needs
        # to refresh in-flight.
        scopes=["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.modify"],
    )
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _build_claim_number_subject_query(claim_numbers: list[str], sending_email: str = "") -> Optional[str]:
    """Build a Gmail search query that ONLY returns messages whose subject
    contains one of the user's claim numbers. Server-side filter — we never
    fetch or read any other emails.

    Returns None if the user has no claim numbers (skip the poll for this user).
    """
    # Sanitize: drop empties, dedupe, strip whitespace, skip values too short
    # to be unique (>=4 chars rules out single digits / common words).
    clean = sorted({(cn or "").strip() for cn in claim_numbers if cn and len(cn.strip()) >= 4})
    if not clean:
        return None

    # Gmail subject:(A OR B OR C) — token-level match. Cap at ~200 numbers per
    # query to stay well under Gmail's query length limit. Heaviest USARM user
    # today has <100 claims with numbers, so this is a future-proofing guard.
    if len(clean) > 200:
        clean = clean[-200:]  # newest claims most likely to have active comms

    subject_clause = "subject:(" + " OR ".join(clean) + ")"
    from_clause = f" -from:{sending_email}" if sending_email else ""
    # newer_than:7d (not 1d) because subject-precise queries have ~0 false
    # positive rate — safe to scan a wider window. Hourly cadence catches new
    # arrivals quickly; the 7d window is just belt-and-suspenders for the
    # edge case where the container restarts and misses a few hours.
    return f"{subject_clause} is:unread newer_than:7d{from_clause}"


async def _process_user_message(
    sb: Client, service, msg_id: str, user_id: str, sending_email: str,
    claim_lookup: dict[str, dict],
) -> None:
    """Process one Gmail message that ALREADY matched a user's claim number
    (Gmail's subject:() filter did the work). claim_lookup maps claim_number
    → {id, address, carrier} for O(1) resolution.

    Storage-only — no AI. Insert into carrier_correspondence with
    analysis_status='pending'. User triggers analysis on demand from the
    per-claim Comms tab.
    """
    try:
        parsed = await asyncio.to_thread(parse_gmail_message, service, msg_id)
    except Exception as e:
        print(f"[USER GMAIL POLLER] parse failed for {user_id}/{msg_id}: {type(e).__name__}: {e}", flush=True)
        return

    # Skip our own sends (defensive — the -from:me filter should catch these)
    from_email = (parsed.get("from_email") or "").lower().strip()
    if sending_email and from_email == sending_email.lower():
        await asyncio.to_thread(_mark_as_read, service, msg_id)
        return

    # Idempotency: skip messages we've already ingested
    if parsed.get("message_id"):
        dup = sb.table("carrier_correspondence").select("id").eq(
            "message_id", parsed["message_id"]
        ).limit(1).execute()
        if dup.data:
            await asyncio.to_thread(_mark_as_read, service, msg_id)
            return

    # Identify WHICH claim_number this matched (Gmail returned the message because
    # the subject contains ONE of the user's claim numbers — we just need to find
    # which one). Subject-token match means we look for any claim_number that
    # appears as a substring.
    subject = parsed.get("subject", "") or ""
    matched_claim = None
    matched_claim_number = None
    for cn, claim in claim_lookup.items():
        if cn in subject:
            matched_claim = claim
            matched_claim_number = cn
            break

    if not matched_claim:
        # Defensive — shouldn't happen because Gmail filtered to subject-match
        # only. If it does (e.g. the claim_number contained Gmail-special chars
        # that didn't tokenize cleanly), skip without marking as read.
        print(f"[USER GMAIL POLLER] {sending_email}: msg {msg_id} matched query but no claim_number found in subject={subject[:60]!r}", flush=True)
        return

    # Carrier name (informational only — not used for matching, but stored)
    carrier_name = identify_carrier(from_email, parsed.get("text_body", "")) or matched_claim.get("carrier")

    # Upload attachments (PDFs + images) to Supabase storage so the user can
    # download them from the per-claim Comms tab. Carriers often send updated
    # scopes, supplements, or denials as PDFs — this captures them.
    #
    # Path convention matches the central claims@dumbroof.ai poller:
    # `{user_id}/{claim_slug}/correspondence/{timestamp}_{filename}`. The claim_slug
    # is derived from the claim address (lowercase, alphanumeric+hyphen, max 50 chars).
    attachment_paths: list[str] = []
    attachments = parsed.get("attachments") or []
    if attachments:
        claim_slug = re.sub(
            r"[^a-z0-9]+", "-",
            (matched_claim.get("address") or "claim").lower()
        )[:50] or "claim"
        ts = int(datetime.utcnow().timestamp())
        for att in attachments:
            try:
                filename = att.get("filename") or "attachment.bin"
                # Gmail returns base64url-encoded content; pad and decode to raw bytes
                file_bytes = base64.urlsafe_b64decode((att.get("content") or "") + "==")
                if not file_bytes:
                    continue
                storage_path = f"{user_id}/{claim_slug}/correspondence/{ts}_{filename}"
                sb.storage.from_("claim-documents").upload(
                    storage_path, file_bytes,
                    {"content-type": att.get("mimeType") or "application/octet-stream"},
                )
                attachment_paths.append(storage_path)
                print(
                    f"[USER GMAIL POLLER]   attached: {filename} "
                    f"({len(file_bytes)//1024}KB, {att.get('mimeType','?')}) → {storage_path}",
                    flush=True,
                )
            except Exception as upload_err:
                # Most common failure: duplicate path collision (Gmail re-delivering
                # same msg in a race) — log + continue, don't fail the whole insert.
                emsg = str(upload_err)
                if "already exists" in emsg.lower() or "duplicate" in emsg.lower():
                    # File already uploaded on a prior cycle — reuse the path
                    attachment_paths.append(storage_path)
                else:
                    print(f"[USER GMAIL POLLER]   upload failed for {filename}: {emsg}", flush=True)

    record = {
        "claim_id": matched_claim["id"],
        "user_id": user_id,
        "company_id": resolve_company_id(sb, user_id),
        "message_id": parsed.get("message_id"),
        "from_email": parsed.get("from_email"),
        "original_from": parsed.get("from_email"),
        "original_subject": subject,
        "original_date": parsed.get("date"),
        "text_body": parsed.get("text_body"),
        "html_body": parsed.get("html_body"),
        "is_forwarded": False,
        "carrier_name": carrier_name,
        "claim_number_parsed": matched_claim_number,
        "address_parsed": matched_claim.get("address"),
        "attachment_paths": attachment_paths,
        "match_method": "claim_number_subject",
        "match_confidence": 95,  # subject contains exact claim_number = high confidence
        "analysis_status": "pending",  # NO AI yet
        "status": "matched",
    }

    try:
        result = sb.table("carrier_correspondence").insert(record).execute()
        corr_id = (result.data or [{}])[0].get("id") if result.data else None
        print(
            f"[USER GMAIL POLLER] {sending_email} → corr {corr_id}, "
            f"claim={matched_claim['id']}, claim_number={matched_claim_number}, "
            f"from={from_email}, subject={subject[:50]}",
            flush=True,
        )
    except Exception as e:
        msg_lower = str(e).lower()
        if "duplicate" in msg_lower or "unique" in msg_lower:
            pass
        else:
            print(f"[USER GMAIL POLLER] Insert failed for {user_id}/{msg_id}: {type(e).__name__}: {e}", flush=True)
            return

    # Safe to mark as read — we ONLY fetched claim-number-matched messages.
    await asyncio.to_thread(_mark_as_read, service, msg_id)


async def _poll_one_user(sb: Client, user: dict) -> None:
    """Poll one connected contractor's Gmail inbox for replies referencing
    their claim numbers in the subject line. Privacy-preserving: Gmail's
    subject:() filter means we never fetch any non-claim email.
    """
    refresh_token = user.get("gmail_refresh_token") or ""
    user_id = user.get("user_id") or ""
    sending_email = (user.get("sending_email") or "").strip()
    if not refresh_token or not user_id:
        return

    # Fetch THIS user's claim numbers + claim metadata. Empty claim_numbers =
    # nothing to scan for, skip the user entirely (zero Gmail API cost).
    try:
        claims_res = sb.table("claims").select(
            "id, claim_number, address, carrier"
        ).eq("user_id", user_id).not_.is_("claim_number", "null").execute()
    except Exception as e:
        print(f"[USER GMAIL POLLER] {sending_email or user_id}: claim lookup failed: {type(e).__name__}: {e}", flush=True)
        return

    claims = claims_res.data or []
    # Build {claim_number: {id, address, carrier}} for O(1) resolution after match
    claim_lookup = {(c.get("claim_number") or "").strip(): c for c in claims if c.get("claim_number")}
    if not claim_lookup:
        return  # User has no claims with claim_numbers — nothing to scan

    query = _build_claim_number_subject_query(list(claim_lookup.keys()), sending_email)
    if not query:
        return

    try:
        service = await asyncio.to_thread(get_gmail_service_for_user, refresh_token)
    except Exception as e:
        emsg = str(e)
        if "invalid_grant" in emsg.lower() or "revoke" in emsg.lower():
            print(f"[USER GMAIL POLLER] {sending_email or user_id}: refresh_token revoked — needs reconnect", flush=True)
        else:
            print(f"[USER GMAIL POLLER] {sending_email or user_id}: service init failed: {type(e).__name__}: {e}", flush=True)
        return

    try:
        results = await asyncio.to_thread(
            lambda: service.users().messages().list(
                userId="me",
                q=query,
                maxResults=USER_POLL_MAX_RESULTS,
            ).execute()
        )
    except Exception as e:
        print(f"[USER GMAIL POLLER] {sending_email or user_id}: list failed: {type(e).__name__}: {e}", flush=True)
        return

    messages = results.get("messages", []) or []
    if not messages:
        return  # No claim-number-matched unread — common case, log nothing

    print(f"[USER GMAIL POLLER] {sending_email or user_id}: {len(messages)} claim-matched message(s) ({len(claim_lookup)} claim numbers scanned)", flush=True)
    for msg_ref in messages:
        try:
            await _process_user_message(sb, service, msg_ref["id"], user_id, sending_email, claim_lookup)
        except Exception as e:
            print(f"[USER GMAIL POLLER] {user_id}/{msg_ref['id']}: process error: {type(e).__name__}: {e}", flush=True)


async def poll_user_gmail_inboxes(sb: Client) -> None:
    """Hourly poll of every contractor with a connected Gmail. Storage only,
    no AI. See module-level docstring above for cost rationale.

    Wired in backend/main.py lifespan alongside poll_gmail_inbox(sb).
    """
    # Defer first run to let claims@dumbroof.ai poller stabilize on cold-start
    await asyncio.sleep(120)

    print(f"[USER GMAIL POLLER] Starting — hourly poll of connected company inboxes (storage-only, no AI)", flush=True)
    while True:
        try:
            users_res = sb.table("company_profiles").select(
                "user_id, sending_email, gmail_refresh_token"
            ).not_.is_("gmail_refresh_token", "null").execute()
            users = [u for u in (users_res.data or []) if u.get("gmail_refresh_token")]
            print(f"[USER GMAIL POLLER] Cycle start — {len(users)} connected inboxes", flush=True)

            for user in users:
                try:
                    await _poll_one_user(sb, user)
                except Exception as e:
                    print(f"[USER GMAIL POLLER] user {user.get('user_id')} failed: {type(e).__name__}: {e}", flush=True)

        except Exception as e:
            print(f"[USER GMAIL POLLER] Top-level error: {type(e).__name__}: {e}", flush=True)

        await asyncio.sleep(USER_POLL_INTERVAL_SECONDS)
