"""
Public Richard API — x402-callable agent endpoints.

Implements the v1 spec at docs/RICHARD_API_SPEC.md. Routes:

    GET  /v1/agent/pricing               (free)
    POST /v1/agent/process-claim         ($50 USDC via x402)
    POST /v1/agent/draft-supplement      ($5 USDC via x402)
    POST /v1/agent/annotate-photo        ($0.50 USDC via x402)
    GET  /v1/agent/job/{id}              (free; auth = job_id ownership)

Every paid endpoint follows the x402 challenge protocol:
    - Caller hits endpoint without X-Payment header → 402 with challenge
    - Caller signs payment via Coinbase agentic-wallet-skill → retries
    - Server verifies signature/amount/expiry/replay → 200 or 202

This module owns ROUTE wiring + payment gating. Heavy work
(actual claim processing, photo analysis) defers to existing
processor.py and claim_brain_tools.py code paths via async tasks.
"""

from __future__ import annotations
import json
import time
import uuid
from typing import Any, Optional
from fastapi import APIRouter, Request, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from x402_auth import (
    ENDPOINT_PRICES_USD,
    parse_payment_header,
    verify_payment,
    record_payment,
    mark_refunded,
    build_challenge_response,
)
from processor import get_supabase_client


router = APIRouter(prefix="/v1/agent", tags=["public-agent-api"])


# ─── Request / response models ───────────────────────────────────────────
class ProcessClaimRequest(BaseModel):
    property_address: str
    carrier: Optional[str] = None
    claim_number: Optional[str] = None
    date_of_loss: Optional[str] = None
    eagleview_pdf_url: Optional[str] = None
    measurements_inline: Optional[dict] = None
    carrier_scope_pdf_url: Optional[str] = None
    photos: list[dict] = []
    user_role: str = "contractor"
    callback_url: Optional[str] = None


class DraftSupplementRequest(BaseModel):
    claim_id: Optional[str] = None
    carrier_scope: Optional[dict] = None
    dumbroof_scope: Optional[dict] = None
    carrier_name: Optional[str] = None
    user_role: str = "contractor"


class AnnotatePhotoRequest(BaseModel):
    photo_url: str
    context: dict = {}


# ─── 402 helper ──────────────────────────────────────────────────────────
def _402_challenge(endpoint: str) -> JSONResponse:
    headers, body = build_challenge_response(endpoint)
    return JSONResponse(status_code=402, content=body, headers=headers)


def _payment_or_402(request: Request, endpoint: str):
    """Returns (payment, error_response). If payment is None and error_response
    is set, the caller should `return error_response` immediately."""
    header = request.headers.get("X-Payment") or request.headers.get("x-payment")
    if not header:
        return None, _402_challenge(endpoint)

    p = parse_payment_header(header)
    if p is None:
        return None, JSONResponse(status_code=402, content={
            "error": "payment_invalid",
            "message": "Could not parse X-Payment header. Expected base64-encoded JSON payload.",
        })

    expected_amount = ENDPOINT_PRICES_USD.get(endpoint, 0.0)
    sb = get_supabase_client()
    ok, err = verify_payment(sb, p, expected_amount, endpoint)
    if not ok:
        status = 409 if err == "payment_replay" else 402
        return None, JSONResponse(status_code=status, content={
            "error": err,
            "message": _err_message(err, expected_amount),
        })

    record_payment(sb, p, endpoint)
    return p, None


def _err_message(code: str, expected_amount: float) -> str:
    return {
        "payment_invalid": "Payment signature failed verification.",
        "payment_expired": "Payment commitment expired. Sign a fresh payment and retry.",
        "payment_underpaid": f"Payment amount is less than the endpoint price (${expected_amount:.2f}).",
        "payment_wrong_endpoint": "Payment was authorized for a different endpoint.",
        "payment_replay": "This payment_id has already been used.",
    }.get(code, "Payment verification failed.")


# ─── Routes ──────────────────────────────────────────────────────────────
@router.get("/pricing")
async def agent_pricing():
    """Free endpoint — returns current pricing in USDC on Base."""
    return {
        "currency": "USD",
        "asset": "USDC",
        "network": "base",
        "endpoints": [
            {"path": "/v1/agent/process-claim", "price": ENDPOINT_PRICES_USD["/v1/agent/process-claim"], "unit": "per call"},
            {"path": "/v1/agent/draft-supplement", "price": ENDPOINT_PRICES_USD["/v1/agent/draft-supplement"], "unit": "per call"},
            {"path": "/v1/agent/annotate-photo", "price": ENDPOINT_PRICES_USD["/v1/agent/annotate-photo"], "unit": "per call"},
            {"path": "/v1/agent/job/{id}", "price": 0.00, "unit": "free polling"},
            {"path": "/v1/agent/pricing", "price": 0.00, "unit": "free"},
        ],
        "version": "v1.0",
        "spec_url": "https://api.dumbroof.ai/docs/spec",
    }


@router.post("/process-claim")
async def agent_process_claim(
    body: ProcessClaimRequest,
    request: Request,
    background_tasks: BackgroundTasks,
):
    payment, err_resp = _payment_or_402(request, "/v1/agent/process-claim")
    if err_resp is not None:
        return err_resp

    sb = get_supabase_client()
    job_id = f"rch_{uuid.uuid4().hex[:24]}"

    try:
        sb.table("x402_jobs").insert({
            "job_id": job_id,
            "payment_id": payment.payment_id,
            "status": "queued",
            "endpoint": "/v1/agent/process-claim",
            "request_payload": body.model_dump(),
        }).execute()
    except Exception as e:
        # If we can't enqueue, refund.
        mark_refunded(sb, payment.payment_id, f"queue_failed: {e}")
        return JSONResponse(status_code=503, content={
            "error": "internal_error",
            "message": "Could not queue job; payment will be refunded.",
        })

    background_tasks.add_task(_run_process_claim_job, job_id)

    return JSONResponse(status_code=202, content={
        "job_id": job_id,
        "status": "queued",
        "estimated_seconds": 120,
        "poll_url": f"/v1/agent/job/{job_id}",
        "payment_id": payment.payment_id,
        "amount_charged_usd": payment.amount_usd,
    })


@router.post("/draft-supplement")
async def agent_draft_supplement(
    body: DraftSupplementRequest,
    request: Request,
):
    """Synchronous endpoint — returns a supplement letter draft directly."""
    payment, err_resp = _payment_or_402(request, "/v1/agent/draft-supplement")
    if err_resp is not None:
        return err_resp

    sb = get_supabase_client()

    # Stub draft path — real implementation would call into claim_brain_email
    # or a dedicated supplement-drafter using the carrier playbook.
    # See docs/RICHARD_API_SPEC.md for the response contract.
    try:
        result = await _build_supplement_draft(sb, body)
    except Exception as e:
        mark_refunded(sb, payment.payment_id, f"draft_failed: {type(e).__name__}: {e}")
        return JSONResponse(status_code=500, content={
            "error": "internal_error",
            "message": "Draft generation failed; payment will be refunded.",
            "detail": str(e)[:300],
        })

    return result


@router.post("/annotate-photo")
async def agent_annotate_photo(
    body: AnnotatePhotoRequest,
    request: Request,
):
    payment, err_resp = _payment_or_402(request, "/v1/agent/annotate-photo")
    if err_resp is not None:
        return err_resp

    sb = get_supabase_client()
    try:
        result = await _annotate_single_photo(body)
    except Exception as e:
        mark_refunded(sb, payment.payment_id, f"annotate_failed: {type(e).__name__}: {e}")
        return JSONResponse(status_code=500, content={
            "error": "internal_error",
            "message": "Photo annotation failed; payment will be refunded.",
            "detail": str(e)[:300],
        })
    return result


@router.get("/job/{job_id}")
async def agent_get_job(job_id: str):
    """Free polling endpoint. job_id acts as opaque auth — only the caller
    who paid for the job knows it."""
    sb = get_supabase_client()
    try:
        res = sb.table("x402_jobs").select("*").eq("job_id", job_id).limit(1).execute()
    except Exception as e:
        return JSONResponse(status_code=500, content={
            "error": "internal_error",
            "message": str(e)[:300],
        })
    rows = res.data or []
    if not rows:
        return JSONResponse(status_code=404, content={
            "error": "not_found",
            "message": "Unknown job_id.",
        })
    job = rows[0]
    payload: dict[str, Any] = {
        "job_id": job["job_id"],
        "status": job["status"],
        "started_at": job.get("created_at"),
    }
    if job["status"] == "succeeded":
        payload["completed_at"] = job.get("completed_at")
        payload["outputs"] = job.get("result_payload") or {}
    elif job["status"] == "failed":
        payload["completed_at"] = job.get("completed_at")
        payload["error"] = {
            "code": job.get("error_code"),
            "message": job.get("error_message"),
            "refund_initiated": True,
        }
    return payload


# ─── Background workers ──────────────────────────────────────────────────
async def _run_process_claim_job(job_id: str) -> None:
    """Pull job from x402_jobs, run the full claim pipeline, write results.

    v1 STUB: marks the job 'failed' with a 'not_yet_implemented' error
    and triggers a refund. The real wiring routes the request payload
    through processor.py::process_claim with synthesized claim_id, then
    serializes the resulting 5-PDF package into signed URLs — out of
    scope for this commit; see follow-up task.
    """
    from datetime import datetime, timezone
    sb = get_supabase_client()
    try:
        sb.table("x402_jobs").update({
            "status": "running",
        }).eq("job_id", job_id).execute()

        # TODO: integrate with processor.process_claim using the request
        # payload — this is the heavy lift deferred from v1.
        sb.table("x402_jobs").update({
            "status": "failed",
            "error_code": "not_yet_implemented",
            "error_message": "process-claim end-to-end pipeline integration is in progress. Refund issued.",
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("job_id", job_id).execute()

        # Fetch payment_id to mark refunded
        res = sb.table("x402_jobs").select("payment_id").eq("job_id", job_id).limit(1).execute()
        if res.data and res.data[0].get("payment_id"):
            mark_refunded(sb, res.data[0]["payment_id"], "not_yet_implemented")
    except Exception as e:
        print(f"[public_richard] _run_process_claim_job({job_id}) crashed: {e}")


async def _build_supplement_draft(sb: Any, body: DraftSupplementRequest) -> dict:
    """Build a supplement draft. v1 STUB — returns a placeholder structure
    that matches the spec contract; real LLM-driven drafting deferred."""
    return {
        "subject": "Supplement request — draft (v1 stub)",
        "body_html": "<p>Stub response — wire up to claim_brain supplement drafter in follow-up.</p>",
        "body_text": "Stub response — wire up to claim_brain supplement drafter in follow-up.",
        "differential_summary": {
            "missed_items": [],
            "underpriced_items": [],
            "total_underpayment_usd": 0.0,
        },
        "carrier_playbook_used": (body.carrier_name or "").lower().replace(" ", "_") + "_v1_stub" if body.carrier_name else None,
        "v1_stub": True,
    }


async def _annotate_single_photo(body: AnnotatePhotoRequest) -> dict:
    """v1 STUB — returns placeholder annotation. Real Claude Vision call
    deferred (will reuse photo_utils.py annotation pipeline)."""
    return {
        "annotation": "Stub annotation — wire up to photo_utils annotation pipeline in follow-up.",
        "tags": {
            "damage_type": (body.context or {}).get("expected_damage_type", "unknown"),
            "severity": "unknown",
            "repairable": None,
            "slope": None,
            "material": None,
        },
        "scoring": {
            "damage_score_contribution": 0,
            "evidence_strength": "unknown",
        },
        "v1_stub": True,
    }
