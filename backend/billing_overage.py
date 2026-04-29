"""Backend → Vercel bridge for $75/claim overage metering.

Called from processor.py once per claim that crosses into overage. Posts to
the Vercel route /api/billing/meter-overage which holds the Stripe credentials
and lazy-attaches the metered subscription item.

Auth: shared CRON_SECRET (set in both Railway and Vercel). Same secret used
for cron auth — saves a separate env var on both sides.

Cloudflare-WAF resilient (uses a real browser User-Agent — see MEMORY note
about urllib being blocked when the default Python-urllib/x.y agent is used).
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Optional


METER_URL = "https://www.dumbroof.ai/api/billing/meter-overage"

_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/17.0 Safari/605.1.15"
)


def fire_overage_meter(
    *,
    user_id: str,
    subscription_user_id: str,
    claim_id: str,
    plan_id: str,
    overage_count_after: int,
    stripe_subscription_id: Optional[str] = None,
    stripe_overage_item_id: Optional[str] = None,
) -> dict:
    """POST one usage record to Stripe via the Vercel meter-overage route.

    Returns the JSON response. NEVER raises — billing failures must not block
    the user's claim from processing. The Vercel route writes a row to
    overage_events with status='failed' that the daily reconcile cron retries.
    """
    secret = (os.environ.get("CRON_SECRET") or "").strip()
    if not secret:
        print("[OVERAGE] CRON_SECRET not set — cannot meter overage", flush=True)
        return {"ok": False, "error": "no_cron_secret"}

    payload = json.dumps({
        "user_id": user_id,
        "subscription_user_id": subscription_user_id,
        "claim_id": claim_id,
        "plan_id": plan_id,
        "overage_count_after": overage_count_after,
        "stripe_subscription_id": stripe_subscription_id,
        "stripe_overage_item_id": stripe_overage_item_id,
    }).encode("utf-8")

    req = urllib.request.Request(
        METER_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {secret}",
            "User-Agent": _BROWSER_UA,
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode()
        except Exception:
            body = ""
        print(f"[OVERAGE] HTTP {e.code} from meter-overage: {body[:200]}", flush=True)
        return {"ok": False, "error": f"http_{e.code}", "body": body[:200]}
    except Exception as e:
        print(f"[OVERAGE] meter-overage request failed: {e}", flush=True)
        return {"ok": False, "error": str(e)}
