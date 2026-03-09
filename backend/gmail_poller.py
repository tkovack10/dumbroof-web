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
    TEAM_DOMAINS = {"usaroofmasters.com"}
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


# ===================================================================
# EMAIL CLASSIFICATION — Carrier Correspondence vs Edit Request
# ===================================================================

def classify_email(parsed: dict, carrier_name: str | None) -> str:
    """
    Classify an email as 'carrier_correspondence' or 'edit_request'.

    Rules:
    1. Forwarded + original_from is a known carrier domain → carrier_correspondence
    2. Direct (not forwarded) from authorized forwarder → edit_request
    3. Forwarded but original_from is NOT a carrier → edit_request
    """
    is_forwarded = parsed.get("is_forwarded", False)
    original_from = parsed.get("original_from") or ""

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

    # Direct email (not forwarded) from the team → edit request
    return "edit_request"


async def analyze_edit_request(text: str, subject: str, attachments: list) -> dict:
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
        response = client.messages.create(
            model="claude-sonnet-4-6",
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

            # Classify: carrier correspondence vs edit request
            email_type = classify_email(parsed, carrier_name)

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
                ai_result = await analyze_edit_request(body_text, subject_text, parsed["attachments"])

                edit_record = {
                    "claim_id": match["claim_id"],
                    "user_id": user_id,
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
