"""Retail estimate measurement parser — fully isolated from the claims pipeline.

Per Tom 2026-05-22: "retail and insurance two completely different work flows,
dont want any mixing of the two". This module is deliberately self-contained:
no imports from processor.py, no shared helpers with the claims path. The
parser is tuned for the retail builder's 10-field measurement form, not the
claims processor's richer multi-structure + walls + penetrations schema.

Public surface:
    extract_retail_measurements(client, pdf_path) → dict
        Returns flat dict matching the retail builder fields:
        roof_area_sq, eave_lf, rake_lf, ridge_lf, hip_lf, valley_lf,
        ridge_lf_vented, pipe_count_standard, step_flash_lf, counter_flash_lf
"""

from __future__ import annotations

from model_config import MODEL  # unified model knob (see model_config.py)

import base64
import json
import logging
import re
import time
from pathlib import Path

import anthropic

logger = logging.getLogger(__name__)

# Retail builder fields (mirror src/app/dashboard/retail-estimate/retail-estimate-client.tsx)
RETAIL_FIELDS = (
    "roof_area_sq",
    "eave_lf",
    "rake_lf",
    "ridge_lf",
    "hip_lf",
    "valley_lf",
    "ridge_lf_vented",
    "pipe_count_standard",
    "step_flash_lf",
    "counter_flash_lf",
)


def _file_to_base64(path: str | Path) -> str:
    """Read a file and return its base64-encoded contents. No processor.py dependency."""
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def _parse_json_response(text: str) -> dict:
    """Extract the first JSON object from Claude's response text. Tolerates
    markdown code fences and prose preamble/postamble."""
    if not text:
        return {}
    # Strip ```json ... ``` fences if present
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if fence:
        text = fence.group(1)
    # Otherwise grab the first {...} block
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        return {}
    blob = text[start : end + 1]
    try:
        return json.loads(blob)
    except json.JSONDecodeError as e:
        logger.warning("retail_measurements: JSON parse failed: %s", e)
        return {}


def _call_claude(client: anthropic.Anthropic, pdf_b64: str, prompt: str, max_retries: int = 3, sb=None) -> str:
    """Call Claude with the retail-measurement prompt and return the raw text.

    Ship 0.5: when `sb` is provided, route through telemetry.call_claude_logged so the retail
    vision spend is recorded in processing_logs (step_name="retail_measurements"). claim_id is
    NULL — retail is a standalone pre-claim tool, so the log records the cost-generating EVENT,
    not a claim (processing_logs.claim_id is nullable; see DECISIONS). Telemetry is the ONLY
    shared dependency — no other claims-pipeline behavior is imported. Without `sb` (standalone
    usage / tests) the module keeps its self-contained direct path + local retry, so it stays
    importable and testable in full isolation."""
    kwargs = dict(
        model=MODEL,
        max_tokens=2048,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_b64,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )

    if sb is not None:
        from telemetry import call_claude_logged
        response = call_claude_logged(client, sb, None, step_name="retail_measurements", **kwargs)
        return response.content[0].text if response.content else ""

    # Standalone / test path — unchanged, self-contained retry (no telemetry).
    last_err: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            response = client.messages.create(**kwargs)
            return response.content[0].text if response.content else ""
        except (anthropic.APIStatusError, anthropic.APIConnectionError) as e:
            last_err = e
            if attempt == max_retries:
                raise
            wait = 2 ** attempt
            logger.warning(
                "retail_measurements: Claude call attempt %d/%d failed (%s), retrying in %ds",
                attempt,
                max_retries,
                e.__class__.__name__,
                wait,
            )
            time.sleep(wait)
    if last_err:
        raise last_err
    return ""


_PROMPT = """You are extracting roof measurements from a roof report (EagleView, HOVER, GAF QuickMeasure, Roofr, Hover, or similar) for a residential RETAIL roofing estimate. Return ONLY valid JSON in EXACTLY this shape — no markdown, no prose:

{
  "roof_area_sq": 0,
  "eave_lf": 0,
  "rake_lf": 0,
  "ridge_lf": 0,
  "hip_lf": 0,
  "valley_lf": 0,
  "ridge_lf_vented": 0,
  "pipe_count_standard": 0,
  "step_flash_lf": 0,
  "counter_flash_lf": 0,
  "_meta": {
    "vendor": "EagleView|HOVER|GAF|Roofr|other",
    "predominant_pitch": "X/12",
    "stories": 1,
    "address_line": "street address if found",
    "confidence": "high|medium|low"
  }
}

Rules:
- roof_area_sq is in roofing SQUARES (1 SQ = 100 SF). If the report only gives SF, divide by 100.
- All linear measurements (eave, rake, ridge, hip, valley) in LINEAR FEET.
- ridge_lf_vented: linear feet of ridge that is currently vented. If the report doesn't break this out, return same value as ridge_lf (assume full ridge vented).
- pipe_count_standard: count of standard plumbing pipe penetrations. Excludes large vents and chimneys.
- step_flash_lf: linear feet of step flashing along walls (chimney/dormer/sidewall against roof).
- counter_flash_lf: linear feet of counter flashing (typically masonry chimney top edge).
- Use 0 for any value not present in the report.
- _meta.confidence: "high" if all 10 fields found explicitly; "medium" if 5-9 found; "low" if <5.
- _meta.vendor: identify the source PDF vendor by header/logo/format.
- This is a SINGLE-STRUCTURE retail estimate — if the report covers multiple structures, return values for the LARGEST/PRIMARY structure only.
- DO NOT return walls, elevations, window counts, or any siding fields — those are not used by the retail builder.
"""


def extract_retail_measurements(client: anthropic.Anthropic, pdf_path: str | Path, sb=None) -> dict:
    """Parse a roof-measurement PDF into the retail builder's flat 10-field schema.

    Returns a dict with the 10 RETAIL_FIELDS keys (all numeric) plus a "_meta"
    object with vendor/confidence/etc. Missing fields default to 0.

    Raises if Claude is unreachable after retries.

    `sb` (optional): a Supabase client. When supplied (the live router passes one), the vision
    call is logged to processing_logs for cost visibility (Ship 0.5, claim_id=NULL). Omit it for
    standalone/test use — the parse runs identically without telemetry.
    """
    pdf_b64 = _file_to_base64(pdf_path)
    raw_text = _call_claude(client, pdf_b64, _PROMPT, sb=sb)
    parsed = _parse_json_response(raw_text)

    out: dict = {}
    for k in RETAIL_FIELDS:
        v = parsed.get(k, 0)
        try:
            out[k] = float(v) if "_lf" in k or k.endswith("_sq") or "_flash_" in k else int(v)
        except (TypeError, ValueError):
            out[k] = 0
    out["_meta"] = parsed.get("_meta") or {}

    # If everything is zero, the parse likely failed silently — flag it
    if all(out.get(k, 0) == 0 for k in RETAIL_FIELDS):
        out["_meta"] = {**out["_meta"], "confidence": "low", "warning": "no fields extracted"}
        logger.warning("retail_measurements: parser returned all zeros for %s", pdf_path)

    return out
