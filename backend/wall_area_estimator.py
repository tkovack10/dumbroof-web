"""
Shared wall-area estimator — ONE wall-area brain, two consumers.
================================================================
Estimates total exterior SIDING wall area (sq ft) for a structure from:
  (1) the roof footprint measurements (eave/rake LF, roof area, stories), and
  (2) photos of each siding elevation (front/back/left/right), read by Claude Vision.

Consumers (call estimate_wall_area):
  - Retail siding estimates (backend/retail_router.py) — first consumer.
  - Claim siding supplements (backend/processor.py) — replaces the crude
    sqrt(footprint) fallback used when no EagleView walls report is present.

Even with NO photos, estimate_wall_area_geometric() is already better than a
sqrt(footprint) guess because it uses the actual measured eave+rake perimeter.

Standalone + dependency-light: imports only model_config + anthropic + stdlib,
so EITHER path can import it with zero coupling (no processor / no retail deps).
"""
from __future__ import annotations

import base64
import json
import logging
import re

import anthropic

from model_config import MODEL  # unified model knob (see model_config.py)

log = logging.getLogger(__name__)

# Tunables — exterior-wall geometry + average opening sizes (sq ft) to subtract.
WALL_HEIGHT_PER_STORY_FT = 9.0
WINDOW_SF = 15.0
DOOR_SF = 21.0
GARAGE_DOOR_SF = 112.0  # ~7' x 16' single-wide; subtracted as a non-siding opening


def estimate_wall_area_geometric(roof: dict) -> dict:
    """Pure-geometry wall-area estimate from roof footprint measurements.

    Footprint perimeter ≈ the roof's eave + rake edge run (the wall line), so
    `perimeter × wall_height × stories` is the gross exterior wall area. This is
    strictly better than the sqrt(footprint) fallback because it uses the real
    measured perimeter when present; it only falls back to a square-footprint
    assumption (from roof_area_sq) when no eave/rake LF is available.
    """
    roof = roof if isinstance(roof, dict) else {}
    eave = _num(roof.get("eave_lf"))
    rake = _num(roof.get("rake_lf"))
    stories = max(1.0, _num(roof.get("stories"), default=1.0))
    perimeter = eave + rake
    fallback = False
    if perimeter <= 0:
        fallback = True
        roof_area_sf = _num(roof.get("roof_area_sq")) * 100.0
        side = roof_area_sf ** 0.5 if roof_area_sf > 0 else 0.0
        perimeter = side * 4.0
    gross = perimeter * WALL_HEIGHT_PER_STORY_FT * stories
    return {
        "wall_area_sf": round(gross),
        "gross_wall_area_sf": round(gross),
        "perimeter_lf": round(perimeter),
        "stories": int(stories),
        "window_count": 0,
        "door_count": 0,
        "method": "geometry",
        "source": "geometry_only",
        "confidence": "low" if (fallback or perimeter <= 0) else "medium",
    }


_VISION_PROMPT = """You are a siding estimator. The images are exterior ELEVATION photos of ONE house (ideally the front, back, left, and right sides). Judge the SIDING wall area.

Return STRICT JSON only (no prose), for the WHOLE house:
{
  "stories": <int 1-3>,
  "window_count": <int total windows across all elevations>,
  "door_count": <int exterior man-doors>,
  "garage_door_count": <int>,
  "non_siding_pct": <0-100 percent of wall that is brick/stone/other non-siding to EXCLUDE>,
  "estimated_wall_area_sf": <int total sidable wall area if you can judge scale, else null>,
  "per_elevation": [{"side": "front|back|left|right|unknown", "notes": "<short>"}],
  "confidence": "high|medium|low",
  "notes": "<one short line>"
}
Count openings so they can be subtracted. If sides are missing or photos are unclear, lower the confidence. Output ONLY the JSON object."""


def _sniff_media_type(b: bytes) -> str:
    """Detect image media-type from magic bytes (Claude accepts jpeg/png/webp/gif)."""
    if b[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "image/webp"
    if b[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return "image/jpeg"


def estimate_wall_area(
    roof: dict,
    elevation_images: list[bytes] | None = None,
    client: anthropic.Anthropic | None = None,
) -> dict:
    """Combine the geometric base with a Claude Vision read of the elevation photos.

    roof:             measurement dict (eave_lf, rake_lf, roof_area_sq, stories).
    elevation_images: raw image bytes per elevation (front/back/left/right). May be None.
    client:           an anthropic.Anthropic instance. If None (or no images), returns
                      the geometry-only estimate (still better than sqrt(footprint)).

    Returns: wall_area_sf + opening counts + confidence + per-elevation breakdown +
    `method`/`source` so the caller can show how it was derived.
    """
    geo = estimate_wall_area_geometric(roof)
    if not elevation_images or client is None:
        return geo

    content: list[dict] = [
        {
            "type": "image",
            "source": {"type": "base64", "media_type": _sniff_media_type(b), "data": base64.b64encode(b).decode("ascii")},
        }
        for b in elevation_images[:8]  # cap the number of images sent
    ]
    content.append({"type": "text", "text": _VISION_PROMPT})

    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            messages=[{"role": "user", "content": content}],
        )
        raw = resp.content[0].text if getattr(resp, "content", None) else "{}"
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        v = json.loads(m.group(0)) if m else {}
    except Exception as e:  # noqa: BLE001 — Vision is best-effort; geometry still stands
        log.warning("[wall_area_estimator] vision failed (%s) — geometry only", e)
        return {**geo, "vision_error": str(e)}

    # Reconcile: refine the geometric gross with Vision's story count, subtract
    # openings + non-siding (brick/stone), then average with Vision's direct
    # estimate when it gave one (two noisy signals → the mean is more robust).
    stories = max(1.0, _num(v.get("stories"), default=geo["stories"]))
    perimeter = geo["perimeter_lf"]
    gross = perimeter * WALL_HEIGHT_PER_STORY_FT * stories
    non_siding = max(0.0, min(0.9, _num(v.get("non_siding_pct")) / 100.0))
    windows = int(_num(v.get("window_count")))
    doors = int(_num(v.get("door_count")))
    garages = int(_num(v.get("garage_door_count")))
    openings_sf = windows * WINDOW_SF + doors * DOOR_SF + garages * GARAGE_DOOR_SF
    net = gross * (1.0 - non_siding) - openings_sf

    v_direct = v.get("estimated_wall_area_sf")
    if isinstance(v_direct, (int, float)) and v_direct > 0:
        net = (net + float(v_direct)) / 2.0
    net = max(0.0, net)

    return {
        "wall_area_sf": round(net),
        "gross_wall_area_sf": round(gross),
        "perimeter_lf": round(perimeter),
        "stories": int(stories),
        "window_count": windows,
        "door_count": doors + garages,
        "non_siding_pct": round(non_siding * 100),
        "confidence": v.get("confidence") or "medium",
        "per_elevation": v.get("per_elevation") or [],
        "notes": v.get("notes") or "",
        "method": "geometry+vision",
        "source": "geometry+vision",
    }


def _num(value, default: float = 0.0) -> float:
    """Coerce a possibly-str/None value to float; default on failure."""
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default
