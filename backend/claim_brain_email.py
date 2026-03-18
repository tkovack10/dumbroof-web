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
GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send"]


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
    profile_result = sb.table("company_profiles").select("*").eq("user_id", user_id).single().execute()
    profile = profile_result.data or {}

    company_name = profile.get("company_name", "Roofing Company")
    gmail_refresh_token = profile.get("gmail_refresh_token")
    sending_email = profile.get("sending_email") or profile.get("email", "")
    reply_to = sending_email or profile.get("email")

    result = {}

    if gmail_refresh_token:
        # Send via user's Gmail
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
