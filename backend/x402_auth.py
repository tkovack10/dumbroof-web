"""
x402 (HTTP 402 Payment Required) authentication for the public Richard API.

Accepts a signed X-Payment header, verifies amount + freshness + replay,
and records the payment for audit / refund. Coinbase's
agentic-wallet-skill is the canonical x402 client (https://x402.org/).

v1 NOTE on signature verification:
  Real on-chain signature verification (Base USDC contract) requires a
  Web3 client + the agentic-wallet-skill verifier SDK. This module does
  amount/freshness/replay checks and STORES the signature, but the
  cryptographic verification step is a stub for now (returns True if
  the signature is non-empty and looks plausible). Mark the TODO
  comment in `verify_signature` before the public endpoint accepts
  real wallet payments.
"""

from __future__ import annotations
import base64
import json
import time
from dataclasses import dataclass
from typing import Any, Optional
from supabase import Client


# ─── Pricing config ──────────────────────────────────────────────────────
# Anchor pricing for v1. Source of truth: docs/RICHARD_API_SPEC.md.
ENDPOINT_PRICES_USD: dict[str, float] = {
    "/v1/agent/process-claim": 50.00,
    "/v1/agent/draft-supplement": 5.00,
    "/v1/agent/annotate-photo": 0.50,
    # Free endpoints (caller still hits them but no x402 required)
    "/v1/agent/pricing": 0.00,
    "/v1/agent/job": 0.00,
}

ASSET = "USDC"
NETWORK = "base"
PAY_TO_ADDRESS = "0xDumbRoofWalletAddress"  # TODO: replace with real wallet on launch
PAYMENT_TTL_SECONDS = 600  # 10-minute window from signing to use


@dataclass
class X402Payment:
    """Decoded X-Payment header payload."""
    payment_id: str
    wallet_address: str
    amount_usd: float
    asset: str
    network: str
    endpoint: str
    signature: str
    expires_at: int  # unix timestamp
    raw_header: str


# ─── Header parsing ──────────────────────────────────────────────────────
def parse_payment_header(header_value: Optional[str]) -> Optional[X402Payment]:
    """Decode the base64 payload of an X-Payment header into an X402Payment.

    Header format (per x402 spec):
        X-Payment: <base64(json_payload)>
    where json_payload = {
        "payment_id": "x402_<ulid>",
        "wallet": "0x...",
        "amount": "50.00",
        "asset": "USDC",
        "network": "base",
        "endpoint": "/v1/agent/process-claim",
        "signature": "0x...",
        "expires_at": 1735689600
    }
    """
    if not header_value:
        return None
    try:
        # Allow either bare base64 or "x402 <base64>" form
        cleaned = header_value.strip()
        if cleaned.lower().startswith("x402 "):
            cleaned = cleaned[5:].strip()
        # Re-pad base64
        padded = cleaned + "=" * (-len(cleaned) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode()).decode()
        body = json.loads(decoded)
        return X402Payment(
            payment_id=str(body["payment_id"]),
            wallet_address=str(body["wallet"]),
            amount_usd=float(body["amount"]),
            asset=str(body.get("asset") or ASSET),
            network=str(body.get("network") or NETWORK),
            endpoint=str(body["endpoint"]),
            signature=str(body.get("signature") or ""),
            expires_at=int(body["expires_at"]),
            raw_header=header_value,
        )
    except (ValueError, KeyError, TypeError, json.JSONDecodeError, base64.binascii.Error):
        return None


# ─── Verification ────────────────────────────────────────────────────────
def verify_signature(p: X402Payment) -> bool:
    """v1 stub: accept any non-empty 0x-prefixed signature with reasonable length.

    TODO: replace with on-chain verification via the agentic-wallet-skill SDK.
    Real check: derive the message hash from (payment_id, wallet, amount,
    endpoint, expires_at), recover the signer's address, confirm it matches
    p.wallet_address. If the wallet is a smart contract (EIP-1271), call
    isValidSignature on the contract.
    """
    sig = (p.signature or "").lower()
    if not sig.startswith("0x"):
        return False
    # 65-byte ECDSA = 130 hex chars + 0x prefix = 132 chars; smart contract sigs longer
    if len(sig) < 132:
        return False
    return True


def is_replay(sb: Client, payment_id: str) -> bool:
    try:
        res = sb.table("x402_payments").select("payment_id").eq("payment_id", payment_id).limit(1).execute()
        return bool(res.data)
    except Exception as e:
        print(f"[x402_auth] is_replay check failed: {e}")
        return False


def verify_payment(
    sb: Client,
    p: X402Payment,
    expected_amount_usd: float,
    expected_endpoint: str,
) -> tuple[bool, str]:
    """Run all verification checks. Returns (ok, error_code).

    Error codes (match RICHARD_API_SPEC.md):
        "payment_invalid"   — bad signature
        "payment_expired"   — past TTL
        "payment_underpaid" — amount less than endpoint price
        "payment_replay"    — payment_id already used
        "payment_wrong_endpoint" — payment was for a different endpoint
    """
    if p.expires_at < int(time.time()):
        return False, "payment_expired"
    if p.endpoint != expected_endpoint:
        return False, "payment_wrong_endpoint"
    if p.amount_usd + 0.001 < expected_amount_usd:
        return False, "payment_underpaid"
    if not verify_signature(p):
        return False, "payment_invalid"
    if is_replay(sb, p.payment_id):
        return False, "payment_replay"
    return True, ""


def record_payment(sb: Client, p: X402Payment, endpoint: str) -> None:
    """Persist the verified payment for replay protection + audit + refunds."""
    try:
        sb.table("x402_payments").insert({
            "payment_id": p.payment_id,
            "wallet_address": p.wallet_address,
            "amount_usd": p.amount_usd,
            "asset": p.asset,
            "network": p.network,
            "endpoint": endpoint,
            "signature": p.signature[:512],
            "expires_at": p.expires_at,
            "status": "verified",
        }).execute()
    except Exception as e:
        # Non-fatal but loud — replay protection depends on this row landing.
        print(f"[x402_auth] record_payment FAILED for {p.payment_id}: {e}")


def mark_refunded(sb: Client, payment_id: str, reason: str = "") -> None:
    """Mark a payment as refunded (e.g. when a job fails). Async on-chain
    refund settlement is a separate cron job (not implemented in v1)."""
    try:
        sb.table("x402_payments").update({
            "status": "refund_pending",
            "refund_reason": reason[:500] if reason else None,
        }).eq("payment_id", payment_id).execute()
    except Exception as e:
        print(f"[x402_auth] mark_refunded FAILED for {payment_id}: {e}")


# ─── 402 challenge response builder ──────────────────────────────────────
def build_challenge_response(endpoint: str, public_origin: str = "https://api.dumbroof.ai") -> tuple[dict[str, str], dict[str, Any]]:
    """Build the (headers, body) for a 402 Payment Required response."""
    price = ENDPOINT_PRICES_USD.get(endpoint, 0.0)
    www_authenticate = (
        f'x402 realm="{public_origin}", '
        f'network="{NETWORK}", '
        f'asset="{ASSET}", '
        f'amount="{price:.2f}", '
        f'pay_to="{PAY_TO_ADDRESS}", '
        f'resource="{endpoint}", '
        f'expires_in="{PAYMENT_TTL_SECONDS}"'
    )
    body = {
        "error": "payment_required",
        "price_usd": price,
        "asset": ASSET,
        "network": NETWORK,
        "endpoint": endpoint,
        "pay_to": PAY_TO_ADDRESS,
        "expires_in_seconds": PAYMENT_TTL_SECONDS,
        "docs": f"{public_origin}/docs/x402",
    }
    headers = {"WWW-Authenticate": www_authenticate}
    return headers, body
