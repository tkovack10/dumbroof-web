"""
Email provider adapters — Microsoft 365 (OAuth + Graph API) and Generic SMTP.

Companion to claim_brain_email.py which already handles Gmail (OAuth) and
Resend (fallback). This file adds the two remaining paths so users can send
as their own @companydomain.com regardless of email provider.

Env vars needed:
  - AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_REDIRECT_URI (Microsoft OAuth)
  - EMAIL_ENCRYPTION_KEY (Fernet key, base64 urlsafe) — encrypts SMTP passwords at rest

If a provider's env vars aren't set, the corresponding functions raise a
clear error. The dispatcher in claim_brain_email.send_claim_email catches
these and falls back to Resend.
"""

from __future__ import annotations
import os
import json
import base64
import smtplib
import ssl
import urllib.parse
import urllib.request
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from typing import Optional


# ═══════════════════════════════════════════
# ENCRYPTION FOR SMTP PASSWORDS
# ═══════════════════════════════════════════

def _get_cipher():
    """Lazy-initialized Fernet cipher. Raises if EMAIL_ENCRYPTION_KEY is missing."""
    from cryptography.fernet import Fernet
    key = os.environ.get("EMAIL_ENCRYPTION_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "EMAIL_ENCRYPTION_KEY is not set. Generate one with "
            "`python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"` "
            "and set it in Railway env vars before storing any SMTP credentials."
        )
    return Fernet(key.encode())


def encrypt_password(plain: str) -> str:
    """Encrypt a password for at-rest storage. Returns a urlsafe-base64 string."""
    if not plain:
        return ""
    cipher = _get_cipher()
    return cipher.encrypt(plain.encode()).decode()


def decrypt_password(cipher_text: str) -> str:
    """Decrypt a previously-encrypted password. Returns plaintext."""
    if not cipher_text:
        return ""
    cipher = _get_cipher()
    return cipher.decrypt(cipher_text.encode()).decode()


# ═══════════════════════════════════════════
# MICROSOFT 365 / OUTLOOK — OAuth + Graph send
# ═══════════════════════════════════════════

_MS_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
_MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
_MS_GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# Mail.Send + Mail.ReadWrite (read needed for inbox search like Gmail)
# offline_access forces refresh_token issuance
_MS_SCOPES = "offline_access Mail.Send Mail.ReadWrite User.Read"


def _ms_env() -> tuple[str, str, str]:
    """Return (client_id, client_secret, redirect_uri). Raises if missing."""
    client_id = os.environ.get("AZURE_CLIENT_ID", "").strip()
    client_secret = os.environ.get("AZURE_CLIENT_SECRET", "").strip()
    redirect_uri = os.environ.get("AZURE_REDIRECT_URI", "").strip()
    if not (client_id and client_secret and redirect_uri):
        raise RuntimeError(
            "Microsoft 365 OAuth is not configured. Set AZURE_CLIENT_ID, "
            "AZURE_CLIENT_SECRET, and AZURE_REDIRECT_URI in Railway env "
            "vars, then register the redirect URI in your Azure AD app."
        )
    return client_id, client_secret, redirect_uri


def get_microsoft_auth_url(state: str = "") -> str:
    """Build the Microsoft consent URL the user is redirected to."""
    client_id, _, redirect_uri = _ms_env()
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "response_mode": "query",
        "scope": _MS_SCOPES,
        "state": state or "",
    }
    return f"{_MS_AUTH_URL}?{urllib.parse.urlencode(params)}"


def _ms_token_request(body_params: dict) -> dict:
    """POST to Microsoft token endpoint and return the parsed JSON."""
    body = urllib.parse.urlencode(body_params).encode()
    req = urllib.request.Request(
        _MS_TOKEN_URL,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; DumbRoof/1.0)",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def exchange_microsoft_code(code: str) -> dict:
    """Trade an auth code for access + refresh tokens + user info."""
    client_id, client_secret, redirect_uri = _ms_env()
    token_resp = _ms_token_request({
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": _MS_SCOPES,
        "code": code,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    })
    # Pull the user's primary SMTP / UPN so we know who to send as
    access_token = token_resp.get("access_token", "")
    user_email = ""
    if access_token:
        try:
            req = urllib.request.Request(
                f"{_MS_GRAPH_BASE}/me",
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                me = json.loads(resp.read().decode())
                user_email = me.get("mail") or me.get("userPrincipalName") or ""
        except Exception as e:
            print(f"[MS-OAUTH] /me lookup failed: {e}")
    return {
        "refresh_token": token_resp.get("refresh_token", ""),
        "access_token": access_token,
        "expires_in": token_resp.get("expires_in"),
        "email": user_email,
    }


def refresh_microsoft_token(refresh_token: str) -> str:
    """Exchange a refresh_token for a fresh access_token."""
    client_id, client_secret, _ = _ms_env()
    resp = _ms_token_request({
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": _MS_SCOPES,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    })
    at = resp.get("access_token", "")
    if not at:
        raise RuntimeError(f"Microsoft token refresh failed: {resp}")
    return at


def send_via_microsoft(
    refresh_token: str,
    from_email: str,
    to_email: str,
    subject: str,
    body_html: str,
    cc: Optional[str] = None,
    bcc: Optional[str] = None,
    attachments: Optional[list[dict]] = None,
) -> dict:
    """Send an email via Microsoft Graph API /me/sendMail.

    Attachments are base64-encoded and inlined in the JSON body. Graph has a
    4MB limit per message for this endpoint; larger messages need the
    createUploadSession flow (out of scope here).
    """
    access_token = refresh_microsoft_token(refresh_token)

    to_list = [{"emailAddress": {"address": a.strip()}} for a in (to_email or "").split(",") if a.strip()]
    cc_list = [{"emailAddress": {"address": a.strip()}} for a in (cc or "").split(",") if a.strip()]
    bcc_list = [{"emailAddress": {"address": a.strip()}} for a in (bcc or "").split(",") if a.strip()]

    message: dict = {
        "subject": subject,
        "body": {"contentType": "HTML", "content": body_html},
        "toRecipients": to_list,
    }
    if cc_list:
        message["ccRecipients"] = cc_list
    if bcc_list:
        message["bccRecipients"] = bcc_list

    if attachments:
        att_list = []
        for att in attachments:
            content = att.get("content")
            if not content:
                continue
            if isinstance(content, (bytes, bytearray)):
                b64 = base64.b64encode(content).decode()
            else:
                b64 = str(content)
            att_list.append({
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": att.get("filename", "attachment"),
                "contentBytes": b64,
            })
        if att_list:
            message["attachments"] = att_list

    payload = json.dumps({"message": message, "saveToSentItems": True}).encode()
    req = urllib.request.Request(
        f"{_MS_GRAPH_BASE}/me/sendMail",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; DumbRoof/1.0)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            # /sendMail returns 202 Accepted with empty body on success
            status = resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode() if hasattr(e, "read") else ""
        raise RuntimeError(f"Microsoft send failed ({e.code}): {body[:500]}")

    if status not in (200, 202):
        raise RuntimeError(f"Microsoft send returned unexpected status {status}")

    return {
        "send_method": "microsoft",
        "from_email": from_email,
        "status": "sent",
    }


# ═══════════════════════════════════════════
# GENERIC SMTP — any provider with username + app password
# ═══════════════════════════════════════════

def send_via_smtp(
    host: str,
    port: int,
    username: str,
    password: str,
    from_email: str,
    to_email: str,
    subject: str,
    body_html: str,
    cc: Optional[str] = None,
    bcc: Optional[str] = None,
    attachments: Optional[list[dict]] = None,
) -> dict:
    """Send via an arbitrary SMTP server. Uses STARTTLS on 587, SSL on 465.

    `password` here is the PLAINTEXT password — caller is responsible for
    decrypting via decrypt_password() before calling this.
    """
    if not (host and port and username and password and from_email and to_email):
        raise ValueError("Missing required SMTP parameters.")

    msg = MIMEMultipart("mixed")
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    if cc:
        msg["Cc"] = cc

    html_part = MIMEText(body_html, "html", "utf-8")
    msg.attach(html_part)

    # Attachments
    for att in (attachments or []):
        content = att.get("content")
        filename = att.get("filename", "attachment")
        if not content:
            continue
        if not isinstance(content, (bytes, bytearray)):
            try:
                content = base64.b64decode(content)
            except Exception:
                content = str(content).encode()
        part = MIMEBase("application", "octet-stream")
        part.set_payload(content)
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", f'attachment; filename="{filename}"')
        msg.attach(part)

    # Collect actual recipient list for smtplib.send_message — has to include
    # CC and BCC even though BCC doesn't appear in headers.
    recipients = [a.strip() for a in to_email.split(",") if a.strip()]
    if cc:
        recipients.extend(a.strip() for a in cc.split(",") if a.strip())
    if bcc:
        recipients.extend(a.strip() for a in bcc.split(",") if a.strip())

    context = ssl.create_default_context()
    if int(port) == 465:
        # Implicit SSL
        with smtplib.SMTP_SSL(host, int(port), context=context, timeout=30) as server:
            server.login(username, password)
            server.send_message(msg, from_addr=from_email, to_addrs=recipients)
    else:
        # STARTTLS (587 or custom)
        with smtplib.SMTP(host, int(port), timeout=30) as server:
            server.ehlo()
            server.starttls(context=context)
            server.ehlo()
            server.login(username, password)
            server.send_message(msg, from_addr=from_email, to_addrs=recipients)

    return {
        "send_method": "smtp",
        "from_email": from_email,
        "status": "sent",
    }


def test_smtp_connection(host: str, port: int, username: str, password: str) -> dict:
    """Verify SMTP credentials work by opening + authenticating + quitting.

    Returns {"ok": True} on success or {"ok": False, "error": "..."} on failure.
    Does NOT send an email.
    """
    try:
        context = ssl.create_default_context()
        if int(port) == 465:
            with smtplib.SMTP_SSL(host, int(port), context=context, timeout=15) as server:
                server.login(username, password)
        else:
            with smtplib.SMTP(host, int(port), timeout=15) as server:
                server.ehlo()
                server.starttls(context=context)
                server.ehlo()
                server.login(username, password)
        return {"ok": True}
    except smtplib.SMTPAuthenticationError as e:
        return {"ok": False, "error": f"Authentication failed — check username/password or app password. ({e.smtp_code}: {e.smtp_error.decode() if isinstance(e.smtp_error, bytes) else e.smtp_error})"}
    except smtplib.SMTPConnectError as e:
        return {"ok": False, "error": f"Connection failed — check host/port. ({e})"}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}
