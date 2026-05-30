"""FastAPI sub-router for retail estimate backend endpoints.

Mounted onto the main FastAPI app via `app.include_router(retail_router)`
in main.py. Imports only retail_measurements.py + the shared, dependency-light
wall_area_estimator.py (a neutral module the claims path also uses) — NO
processor.py / claims-pipeline dependencies. Keeps the retail workflow
physically segregated from the insurance/claims pipeline.
"""

from __future__ import annotations

import logging
import os
import tempfile

import anthropic
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from retail_measurements import extract_retail_measurements
from wall_area_estimator import estimate_wall_area

logger = logging.getLogger(__name__)

retail_router = APIRouter(prefix="/api/retail-measurements", tags=["retail"])


_MAX_PDF_BYTES = 25 * 1024 * 1024  # 25 MB ceiling (Anthropic doc input ~32MB after b64)
_MAX_IMG_BYTES = 15 * 1024 * 1024  # 15 MB/elevation photo
_ALLOWED_CONTENT_TYPES = {"application/pdf", "application/x-pdf", "binary/octet-stream"}


def _get_anthropic_client() -> anthropic.Anthropic:
    """Build a fresh Anthropic client from env. Isolated from any shared
    helper in processor.py — retail endpoints construct their own."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")
    return anthropic.Anthropic(api_key=api_key)


def _get_supabase_client():
    """Build a service-role Supabase client from env for PASSIVE cost-telemetry only
    (Ship 0.5 — retail vision spend → processing_logs, claim_id=NULL). Self-contained
    like _get_anthropic_client (no processor.py import). Returns None if creds are
    absent so the parse still succeeds without telemetry — logging is best-effort,
    never a hard dependency of the retail route."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        return None
    try:
        from supabase import create_client
        return create_client(url, key)
    except Exception:
        logger.warning("retail_measurements: Supabase client unavailable — telemetry skipped", exc_info=True)
        return None


@retail_router.post("/parse")
async def parse_retail_measurements(file: UploadFile = File(...)) -> dict:
    """POST /api/retail-measurements/parse — accepts a PDF upload (EagleView,
    HOVER, GAF QuickMeasure, Roofr, etc.) and returns the 10-field retail
    measurement schema (roof_area_sq, eave_lf, ..., counter_flash_lf).

    No claim_id and no claim-table writes — this is a one-shot parse the retail
    builder client uses to pre-populate its form. The only Supabase write is a
    PASSIVE cost-telemetry log to processing_logs (claim_id=NULL, Ship 0.5) so
    retail vision spend is visible; it's best-effort and never blocks the parse.
    """
    if file.content_type and file.content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported content-type {file.content_type}; expected PDF.",
        )

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file upload.")
    if len(contents) > _MAX_PDF_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"PDF exceeds {_MAX_PDF_BYTES // (1024 * 1024)} MB limit.",
        )

    # Write to a temp file so the parser can pass a path to Anthropic
    suffix = ".pdf"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        client = _get_anthropic_client()
        result = extract_retail_measurements(client, tmp_path, sb=_get_supabase_client())
    except anthropic.APIStatusError as e:
        logger.exception("retail_measurements parse: Anthropic API error")
        raise HTTPException(status_code=502, detail=f"Anthropic upstream: {e}")
    except Exception as e:
        logger.exception("retail_measurements parse failed")
        raise HTTPException(status_code=500, detail=f"Parse failed: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    return {"ok": True, "measurements": result}


@retail_router.post("/estimate-siding")
async def estimate_siding_wall_area(
    photos: list[UploadFile] = File(default=[]),
    measurements: str = Form(default="{}"),
) -> dict:
    """POST /api/retail-measurements/estimate-siding — guesstimate wall_area_sf for
    a siding job from the roof footprint measurements + elevation photos (Claude
    Vision). The shared brain lives in wall_area_estimator.py (the claim siding
    path uses the same function), so retail is just its first consumer.

    Multipart: `photos` = elevation images (front/back/left/right); `measurements`
    = a JSON string of the roof measurements (eave_lf, rake_lf, roof_area_sq,
    stories). With no photos it returns the geometry-only estimate.
    """
    import json as _json

    try:
        roof = _json.loads(measurements) if measurements else {}
        if not isinstance(roof, dict):
            roof = {}
    except Exception:
        roof = {}

    images: list[bytes] = []
    for p in photos[:8]:
        b = await p.read()
        if b and len(b) <= _MAX_IMG_BYTES:
            images.append(b)

    try:
        client = _get_anthropic_client() if images else None
        result = estimate_wall_area(roof, images or None, client)
    except anthropic.APIStatusError as e:
        logger.exception("estimate-siding: Anthropic API error")
        raise HTTPException(status_code=502, detail=f"Anthropic upstream: {e}")
    except Exception as e:
        logger.exception("estimate-siding failed")
        raise HTTPException(status_code=500, detail=f"Estimate failed: {e}")

    return {"ok": True, "estimate": result}
