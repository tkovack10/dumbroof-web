"""
Claim Brain — Email Service
============================
Sends emails from the user's configured email (Gmail OAuth or Resend fallback).
Supports: supplement emails, invoices, COC notifications, custom emails.

Gmail OAuth flow:
  1. User clicks "Connect Gmail" in Settings
  2. Frontend redirects to /api/gmail-auth/authorize
  3. Google redirects back with auth code
  4. Backend exchanges code for refresh_token, stores in company_profiles
  5. Claim Brain sends via Gmail API using stored refresh_token

Resend fallback:
  If no Gmail connected, sends via Resend with user's company name as display name.
"""

from __future__ import annotations
import os
import json
import base64
from typing import Optional
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from datetime import datetime

from supabase import Client


# ───────────────────────────────────────────
# Gmail OAuth — send via user's Gmail account
# ───────────────────────────────────────────

GMAIL_CLIENT_ID = os.environ.get("GMAIL_OAUTH_CLIENT_ID", "")
GMAIL_CLIENT_SECRET = os.environ.get("GMAIL_OAUTH_CLIENT_SECRET", "")
GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
]


def get_gmail_auth_url(redirect_uri: str, state: str = "") -> str:
    """Generate the Google OAuth consent URL."""
    from urllib.parse import urlencode
    params = {
        "client_id": GMAIL_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(GMAIL_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"


def exchange_gmail_code(code: str, redirect_uri: str) -> dict:
    """Exchange authorization code for tokens."""
    import urllib.request
    data = json.dumps({
        "code": code,
        "client_id": GMAIL_CLIENT_ID,
        "client_secret": GMAIL_CLIENT_SECRET,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }).encode()
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def refresh_gmail_token(refresh_token: str) -> str:
    """Refresh an expired access token."""
    import urllib.request
    data = json.dumps({
        "client_id": GMAIL_CLIENT_ID,
        "client_secret": GMAIL_CLIENT_SECRET,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
        return result["access_token"]


def send_via_gmail(
    refresh_token: str,
    from_email: str,
    to_email: str,
    subject: str,
    body_html: str,
    cc: Optional[str] = None,
    attachments: Optional[list[dict]] = None,
) -> dict:
    """Send an email via Gmail API using OAuth refresh token."""
    import urllib.request

    access_token = refresh_gmail_token(refresh_token)

    # Build MIME message
    msg = MIMEMultipart()
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    if cc:
        msg["Cc"] = cc
    msg["Bcc"] = "claims@dumbroof.ai"

    msg.attach(MIMEText(body_html, "html"))

    # Add attachments
    if attachments:
        for att in attachments:
            part = MIMEApplication(att["content"], Name=att["filename"])
            part["Content-Disposition"] = f'attachment; filename="{att["filename"]}"'
            msg.attach(part)

    # Encode and send
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    data = json.dumps({"raw": raw}).encode()
    req = urllib.request.Request(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        data=data,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


# ───────────────────────────────────────────
# Gmail — read inbound emails (claim-number filtered)
# ───────────────────────────────────────────

def fetch_claim_emails_from_gmail(
    refresh_token: str,
    claim_numbers: list[str],
    max_results: int = 20,
) -> list[dict]:
    """Fetch emails from user's Gmail that contain claim numbers in subject.

    Only reads emails matching claim numbers — never touches personal emails.
    Returns list of {from, to, subject, date, snippet, body_text, thread_id, message_id}.
    """
    import urllib.request
    from html.parser import HTMLParser

    if not claim_numbers or not refresh_token:
        return []

    access_token = refresh_gmail_token(refresh_token)

    # Build Gmail search query: subject contains ANY claim number
    # e.g. "subject:5293M465L OR subject:JBG2746"
    query_parts = [f"subject:{cn}" for cn in claim_numbers if cn and cn != "Pending"]
    if not query_parts:
        return []
    query = " OR ".join(query_parts)

    # Search for matching messages
    from urllib.parse import urlencode
    params = urlencode({"q": query, "maxResults": max_results})
    req = urllib.request.Request(
        f"https://gmail.googleapis.com/gmail/v1/users/me/messages?{params}",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            search_result = json.loads(resp.read())
    except Exception as e:
        print(f"[GMAIL READ] Search failed: {e}", flush=True)
        return []

    messages = search_result.get("messages", [])
    if not messages:
        return []

    # Fetch each message's metadata + snippet
    results = []
    for msg_ref in messages[:max_results]:
        msg_id = msg_ref["id"]
        req = urllib.request.Request(
            f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        try:
            with urllib.request.urlopen(req) as resp:
                msg_data = json.loads(resp.read())
        except Exception:
            continue

        headers = {h["name"].lower(): h["value"] for h in msg_data.get("payload", {}).get("headers", [])}
        results.append({
            "message_id": msg_id,
            "thread_id": msg_data.get("threadId", ""),
            "from": headers.get("from", ""),
            "to": headers.get("to", ""),
            "subject": headers.get("subject", ""),
            "date": headers.get("date", ""),
            "snippet": msg_data.get("snippet", ""),
            "label_ids": msg_data.get("labelIds", []),
        })

    print(f"[GMAIL READ] Found {len(results)} emails matching claim numbers {claim_numbers}", flush=True)
    return results


def fetch_email_body(refresh_token: str, message_id: str) -> str:
    """Fetch the full body text of a specific email."""
    import urllib.request

    access_token = refresh_gmail_token(refresh_token)
    req = urllib.request.Request(
        f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}?format=full",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            msg_data = json.loads(resp.read())
    except Exception as e:
        return f"Error fetching email: {e}"

    # Extract text/plain or text/html body
    payload = msg_data.get("payload", {})

    def _extract_body(part):
        if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
            return base64.urlsafe_b64decode(part["body"]["data"]).decode("utf-8", errors="replace")
        for sub in part.get("parts", []):
            result = _extract_body(sub)
            if result:
                return result
        return ""

    body = _extract_body(payload)
    if not body and payload.get("body", {}).get("data"):
        body = base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")

    return body or "(no body text found)"


# ───────────────────────────────────────────
# Resend fallback — send with user's company as display name
# ───────────────────────────────────────────

def send_via_resend(
    company_name: str,
    to_email: str,
    subject: str,
    body_html: str,
    reply_to: Optional[str] = None,
    cc: Optional[str] = None,
    attachments: Optional[list[dict]] = None,
) -> dict:
    """Send via Resend API with company-branded from address."""
    import urllib.request

    resend_key = os.environ.get("RESEND_API_KEY", "")
    if not resend_key:
        raise ValueError("RESEND_API_KEY not configured")

    # Use company name in display name, send from dumbroof.ai domain
    from_addr = f"{company_name} via DumbRoof <claims@dumbroof.ai>"

    payload: dict = {
        "from": from_addr,
        "to": [to_email],
        "subject": subject,
        "html": body_html,
    }
    if reply_to:
        payload["reply_to"] = reply_to
    if cc:
        payload["cc"] = [cc]
    payload["bcc"] = ["claims@dumbroof.ai"]
    if attachments:
        payload["attachments"] = [
            {
                "filename": att["filename"],
                "content": base64.b64encode(att["content"]).decode(),
            }
            for att in attachments
        ]

    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=data,
        headers={
            "Authorization": f"Bearer {resend_key}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


# ───────────────────────────────────────────
# Unified send — auto-picks Gmail or Resend
# ───────────────────────────────────────────

def send_claim_email(
    sb: Client,
    user_id: str,
    claim_id: str,
    to_email: str,
    subject: str,
    body_html: str,
    cc: Optional[str] = None,
    attachments: Optional[list[dict]] = None,
    email_type: str = "supplement",
) -> dict:
    """
    Send an email for a claim, using the user's configured email method.
    Logs the email to the claim_emails table.
    """
    # Load user's company profile + email config
    profile_result = sb.table("company_profiles").select("*").eq("user_id", user_id).limit(1).execute()
    profile = (profile_result.data[0] if profile_result.data else {}) or {}

    company_name = profile.get("company_name", "Roofing Company")
    gmail_refresh_token = profile.get("gmail_refresh_token")
    sending_email = profile.get("sending_email") or profile.get("email", "")
    reply_to = sending_email or profile.get("email")
    admin_email = profile.get("email", "")

    # Auto-CC the company admin on all claim emails
    if admin_email and admin_email != to_email:
        cc = f"{cc}, {admin_email}" if cc else admin_email

    result = {}

    if gmail_refresh_token:
        # Send via user's Gmail — fall through to Resend on failure
        try:
            result = send_via_gmail(
                refresh_token=gmail_refresh_token,
                from_email=f"{company_name} <{sending_email}>",
                to_email=to_email,
                subject=subject,
                body_html=body_html,
                cc=cc,
                attachments=attachments,
            )
            send_method = "gmail"
        except Exception as e:
            print(f"[WARN] Gmail send failed, falling back to Resend: {e}", flush=True)
            result = send_via_resend(
                company_name=company_name,
                to_email=to_email,
                subject=subject,
                body_html=body_html,
                reply_to=reply_to,
                cc=cc,
                attachments=attachments,
            )
            send_method = "resend (gmail fallback)"
    else:
        # Fallback: Resend with company branding
        result = send_via_resend(
            company_name=company_name,
            to_email=to_email,
            subject=subject,
            body_html=body_html,
            reply_to=reply_to,
            cc=cc,
            attachments=attachments,
        )
        send_method = "resend"

    # Log to claim_emails table
    try:
        sb.table("claim_emails").insert({
            "claim_id": claim_id,
            "user_id": user_id,
            "email_type": email_type,
            "to_email": to_email,
            "cc_email": cc,
            "subject": subject,
            "body_html": body_html,
            "send_method": send_method,
            "status": "sent",
            "sent_at": datetime.utcnow().isoformat(),
            "metadata": json.dumps(result),
        }).execute()
    except Exception as e:
        print(f"[WARN] Failed to log email: {e}")

    return {"status": "sent", "method": send_method, "to": to_email, **result}
