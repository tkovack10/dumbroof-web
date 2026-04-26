"""
OAuth callback handlers for CRM / measurement integrations.

Pairs with claim_brain_tools.py::_handle_connect_crm which generates the
authorize URL. After the user authorizes on the third-party site, the
provider redirects to /api/oauth/{service}/callback?code=X&state=Y here.
We exchange the code for tokens and persist them on the user's
company_profiles row.

Each service has slight variations in token endpoints, request format,
and storage columns. The OAUTH_TOKEN_CONFIG registry encodes those
quirks; the rest of the code is generic.

Note (v1): TOKEN_URL values for some services are placeholders. They
follow the documented OAuth 2.0 RFC 6749 pattern but should be verified
against each provider's current docs before going live (each provider
may rotate their endpoints, version their auth flows, etc.). The
`{SERVICE}_OAUTH_CLIENT_ID` / `{SERVICE}_OAUTH_CLIENT_SECRET` env vars
must also be set on Railway before any service round-trips successfully.
"""

from __future__ import annotations
import os
import json
import base64
import time
from typing import Optional, Any
import httpx
from supabase import Client


# ─── Per-service OAuth config ────────────────────────────────────────────
# token_url: the provider's OAuth 2.0 token endpoint
# auth_method: "form" (application/x-www-form-urlencoded body) or
#              "basic"  (Basic auth header with client_id:client_secret,
#                        body still has code + grant_type)
# token_columns: which company_profiles columns receive the response
#                ({"access": col, "refresh": col, "connected_at": col})
# extra_token_args: extra fields some providers require (e.g. tenant)
OAUTH_TOKEN_CONFIG: dict[str, dict[str, Any]] = {
    "hover": {
        "token_url": "https://app.hover.to/oauth/token",
        "auth_method": "form",
        "token_columns": {
            "access": "hover_oauth_token",
            "refresh": "hover_oauth_refresh_token",
            "connected_at": "hover_connected_at",
        },
    },
    "roofr": {
        "token_url": "https://app.roofr.com/oauth/token",
        "auth_method": "form",
        "token_columns": {
            "access": "roofr_oauth_token",
            "refresh": "roofr_oauth_refresh_token",
            "connected_at": "roofr_connected_at",
        },
    },
    "jobnimbus": {
        "token_url": "https://app.jobnimbus.com/oauth/token",
        "auth_method": "form",
        "token_columns": {
            "access": "jobnimbus_oauth_token",
            "refresh": "jobnimbus_oauth_refresh_token",
            "connected_at": "jobnimbus_connected_at",
        },
    },
    "servicetitan": {
        "token_url": "https://auth.servicetitan.io/connect/token",
        "auth_method": "basic",
        "token_columns": {
            "access": "servicetitan_oauth_token",
            "refresh": "servicetitan_oauth_refresh_token",
            "connected_at": "servicetitan_connected_at",
        },
    },
    "salesforce": {
        "token_url": "https://login.salesforce.com/services/oauth2/token",
        "auth_method": "form",
        "token_columns": {
            "access": "salesforce_oauth_token",
            "refresh": "salesforce_oauth_refresh_token",
            "connected_at": "salesforce_connected_at",
        },
    },
    "hubspot": {
        "token_url": "https://api.hubapi.com/oauth/v1/token",
        "auth_method": "form",
        "token_columns": {
            "access": "hubspot_oauth_token",
            "refresh": "hubspot_oauth_refresh_token",
            "connected_at": "hubspot_connected_at",
        },
    },
    "acculynx_oauth": {
        "token_url": "https://app.acculynx.com/oauth/token",
        "auth_method": "form",
        "token_columns": {
            "access": "acculynx_oauth_token",
            "refresh": "acculynx_oauth_refresh_token",
            "connected_at": "acculynx_connected_at",
        },
    },
}


def decode_state(state: str) -> Optional[tuple[str, int]]:
    """Decode the state param emitted by connect_crm. Returns (user_id, ts) or None."""
    if not state:
        return None
    try:
        # Re-pad base64
        padded = state + "=" * (-len(state) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode()).decode()
        user_id, ts_str = decoded.split(":", 1)
        return user_id, int(ts_str)
    except Exception:
        return None


def is_state_fresh(ts: int, max_age_seconds: int = 600) -> bool:
    """OAuth flows should complete within 10 minutes; reject stale states."""
    return (int(time.time()) - ts) <= max_age_seconds


def public_origin() -> str:
    """Where to redirect the user after the callback completes."""
    return os.environ.get("PUBLIC_FRONTEND_ORIGIN") or "https://www.dumbroof.ai"


def build_redirect_uri(service: str) -> str:
    """The redirect_uri must MATCH the one we sent in connect_crm."""
    backend = os.environ.get("PUBLIC_BACKEND_ORIGIN") or os.environ.get("BACKEND_URL") or "https://api.dumbroof.ai"
    return f"{backend}/api/oauth/{service}/callback"


async def exchange_code_for_token(
    service: str,
    code: str,
) -> tuple[bool, dict[str, Any]]:
    """Exchange an authorization code for an access token.

    Returns (success, payload). On success, payload contains the parsed
    JSON response from the provider (typically access_token, refresh_token,
    expires_in, token_type). On failure, payload contains {"error": "..."}.
    """
    cfg = OAUTH_TOKEN_CONFIG.get(service)
    if not cfg:
        return False, {"error": f"Unknown OAuth service: {service}"}

    client_id = os.environ.get(f"{service.upper()}_OAUTH_CLIENT_ID")
    client_secret = os.environ.get(f"{service.upper()}_OAUTH_CLIENT_SECRET")
    if not client_id or not client_secret:
        return False, {
            "error": "oauth_not_configured",
            "missing_env": [
                f"{service.upper()}_OAUTH_CLIENT_ID" if not client_id else None,
                f"{service.upper()}_OAUTH_CLIENT_SECRET" if not client_secret else None,
            ],
        }

    redirect_uri = build_redirect_uri(service)
    body = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
    }
    headers: dict[str, str] = {"Accept": "application/json"}

    if cfg["auth_method"] == "basic":
        creds = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        headers["Authorization"] = f"Basic {creds}"
    else:
        body["client_id"] = client_id
        body["client_secret"] = client_secret

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(cfg["token_url"], data=body, headers=headers)
        if resp.status_code != 200:
            return False, {
                "error": "token_exchange_failed",
                "status": resp.status_code,
                "detail": resp.text[:500],
            }
        payload = resp.json()
        if "access_token" not in payload:
            return False, {"error": "no_access_token", "detail": json.dumps(payload)[:500]}
        return True, payload
    except (httpx.ConnectError, httpx.TimeoutException) as e:
        return False, {"error": "provider_unreachable", "detail": str(e)}
    except Exception as e:
        return False, {"error": "unexpected", "detail": f"{type(e).__name__}: {e}"}


def store_tokens(
    sb: Client,
    service: str,
    user_id: str,
    payload: dict[str, Any],
) -> tuple[bool, Optional[str]]:
    """Persist access + refresh tokens to company_profiles. Returns (ok, error_msg)."""
    cfg = OAUTH_TOKEN_CONFIG.get(service)
    if not cfg:
        return False, f"Unknown service: {service}"

    cols = cfg["token_columns"]
    from datetime import datetime, timezone
    update: dict[str, Any] = {
        cols["access"]: payload.get("access_token"),
        cols["connected_at"]: datetime.now(timezone.utc).isoformat(),
    }
    if "refresh" in cols and payload.get("refresh_token"):
        update[cols["refresh"]] = payload["refresh_token"]

    try:
        existing = sb.table("company_profiles").select("id").eq("user_id", user_id).limit(1).execute()
        if existing.data:
            sb.table("company_profiles").update(update).eq("user_id", user_id).execute()
        else:
            update["user_id"] = user_id
            sb.table("company_profiles").insert(update).execute()
        return True, None
    except Exception as e:
        return False, f"db_write_failed: {type(e).__name__}: {e}"


def success_redirect_url(service: str) -> str:
    return f"{public_origin()}/dashboard/settings?oauth_connected={service}"


def failure_redirect_url(service: str, reason: str) -> str:
    return f"{public_origin()}/dashboard/settings?oauth_failed={service}&reason={reason}"
