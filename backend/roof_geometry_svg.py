"""
Real-geometry overhead roof-footprint SVG renderer.

Unlike compliance_svg.py (a parametric *generic* isometric house used as a
fallback diagram), this module draws the ACTUAL roof footprint from the
EagleView/Vision-extracted facet polygons stored in ``claims.roof_facets``.
The union of every facet polygon is the real overhead outline of the roof.

Each polygon EDGE is classified — eave / rake / ridge / valley / hip / wall /
unknown — and colored by the building-code zone it maps to (Ice & Water
Barrier on eaves, Drip Edge on rakes, Ridge Vent on ridges, Valley Metal in
valleys, Step Flashing along walls). A compact legend keys the colors.

SHARED DATA CONTRACT (the React renderer src/components/roof-photo-map.tsx and
this module both build to it):

    roof_facets_payload = {
      "roof_facets": [
        {
          "facet_id": "F1",
          "cardinal": "N",                  # unchanged
          "pitch": "6/12",                  # unchanged
          "area_pct": 18.5,                 # unchanged
          "polygon_pixels": [[x,y], ...],   # unchanged — N clockwise corners,
                                            #   normalized 0-1000 on both axes
          "edge_types": ["eave", "rake", ...]  # NEW parallel array, length N.
                                            #   edge_types[i] classifies the
                                            #   polygon edge from vertex i to
                                            #   vertex (i+1) % N.
        },
        ...
      ],
      "north_arrow_angle": 0.0,             # unchanged
      "scale_bar": {"pixels": ..., "feet": ...},  # unchanged
      "_synthesized": true|false,           # ~40% of claims are synthesized
                                            #   4-cardinal skeletons with EMPTY
                                            #   polygon_pixels -> render() returns None
    }

The polygon-to-path logic (pointsToPath / isRenderablePolygon — facets with
fewer than 3 corners are skipped) is ported conceptually from the shipped
React renderer so the backend overhead outline matches the on-screen map.

Colors are emitted as ``var(--token, #default)`` so the Spectral design tokens
can theme the diagram later without touching this module; the hard-coded
defaults render correctly with no CSS in scope (e.g. embedded in a PDF).
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

VIEWBOX_W = 1000
VIEWBOX_H = 1000

# ── Edge classification → code zone ──
# Each edge type maps to the building-code product/zone it drives, plus a
# CSS-variable-friendly stroke color (with a sensible hard default) and a legend
# label. hip/unknown are neutral (no specific code product on that edge).
#
# Stroke colors use `var(--token, #default)` so Spectral tokens can re-theme.
EDGE_ZONES: dict[str, dict[str, str]] = {
    "eave":    {"zone": "Ice & Water Barrier", "stroke": "var(--roof-eave, #2563eb)"},    # blue
    "rake":    {"zone": "Drip Edge",           "stroke": "var(--roof-rake, #16a34a)"},    # green
    "ridge":   {"zone": "Ridge Vent",          "stroke": "var(--roof-ridge, #dc2626)"},   # red
    "valley":  {"zone": "Valley Metal",        "stroke": "var(--roof-valley, #f59e0b)"},  # amber
    "hip":     {"zone": "Hip",                 "stroke": "var(--roof-hip, #94a3b8)"},     # slate (neutral)
    "wall":    {"zone": "Step Flashing",       "stroke": "var(--roof-wall, #9333ea)"},    # purple
    "unknown": {"zone": "Unclassified",        "stroke": "var(--roof-unknown, #94a3b8)"}, # slate (neutral)
}

# Order the legend renders in — only zones actually present are shown, but this
# fixes a stable left-to-right order when several are.
_LEGEND_ORDER = ["eave", "rake", "ridge", "valley", "wall", "hip", "unknown"]

# Light facet fill so the footprint reads as a filled shape under the edges.
_FACET_FILL = "var(--roof-facet-fill, rgba(148,163,184,0.12))"
_FACET_FILL_STROKE = "var(--roof-facet-edge, rgba(148,163,184,0.0))"  # facet body has no own outline; edges are drawn separately
_BACKGROUND = "var(--roof-bg, #ffffff)"
_EDGE_STROKE_WIDTH = 6
_NEUTRAL_TYPES = {"hip", "unknown"}

# Uniform inner margin (viewBox units) left around the fitted footprint so the
# edges/strokes never touch the frame. The footprint is scaled+translated to
# fill the remaining box while preserving aspect ratio (see _fit_transform).
_FIT_MARGIN = 60


# ── Geometry helpers — ported from roof-photo-map.tsx ──

def _coerce_point(raw: Any) -> Optional[tuple[float, float]]:
    """Coerce one [x, y] corner to a float tuple, or None if unusable."""
    if not isinstance(raw, (list, tuple)) or len(raw) < 2:
        return None
    try:
        x = float(raw[0])
        y = float(raw[1])
    except (TypeError, ValueError):
        return None
    # NaN / Infinity would poison the path string and break rendering.
    if x != x or y != y or x in (float("inf"), float("-inf")) or y in (float("inf"), float("-inf")):
        return None
    return (x, y)


def _clean_points(polygon_pixels: Any) -> list[tuple[float, float]]:
    """Coerce a polygon_pixels array to a list of valid float points.

    Drops individual malformed corners rather than failing the whole facet —
    but the result is only renderable if >= 3 survive (see _is_renderable).
    """
    if not isinstance(polygon_pixels, (list, tuple)):
        return []
    out: list[tuple[float, float]] = []
    for raw in polygon_pixels:
        pt = _coerce_point(raw)
        if pt is not None:
            out.append(pt)
    return out


def _is_renderable(points: list[tuple[float, float]]) -> bool:
    """Port of isRenderablePolygon: facets with fewer than 3 corners are skipped.

    A 0-2 point polygon renders an invisible / zero-area path in the React map;
    here it would contribute no footprint area, so we drop it.
    """
    return len(points) >= 3


def _points_to_path(points: list[tuple[float, float]]) -> str:
    """Port of pointsToPath: closed SVG path for a polygon (>= 3 corners).

    Returns "" for degenerate input so callers can guard.
    """
    if len(points) < 3:
        return ""
    segments = []
    for i, (x, y) in enumerate(points):
        cmd = "M" if i == 0 else "L"
        segments.append(f"{cmd}{_fmt(x)},{_fmt(y)}")
    return " ".join(segments) + " Z"


def _fmt(n: float) -> str:
    """Compact numeric formatting for SVG coordinates (trim trailing zeros)."""
    if n == int(n):
        return str(int(n))
    return f"{n:.2f}".rstrip("0").rstrip(".")


def _edge_type_for(edge_types: Any, index: int, n: int) -> str:
    """Resolve the classification for edge `index` (vertex i -> (i+1) % n).

    Missing / short / non-string entries degrade gracefully to 'unknown' so a
    facet that has polygons but no (or partial) edge_types still draws — just
    neutral.
    """
    if isinstance(edge_types, (list, tuple)) and index < len(edge_types):
        val = edge_types[index]
        if isinstance(val, str):
            key = val.strip().lower()
            if key in EDGE_ZONES:
                return key
    return "unknown"


# ── SVG building ──

def _escape(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _facet_polygon_svg(points: list[tuple[float, float]], facet_id: str) -> str:
    """The lightly-filled footprint shape for a single facet."""
    path = _points_to_path(points)
    return (
        f'<path class="roof-facet" data-facet-id="{_escape(facet_id)}" '
        f'd="{path}" fill="{_FACET_FILL}" stroke="{_FACET_FILL_STROKE}" '
        f'stroke-width="0" stroke-linejoin="round"/>'
    )


def _facet_edges_svg(
    points: list[tuple[float, float]],
    edge_types: Any,
    present_zones: set[str],
) -> list[str]:
    """One <line> per polygon edge, colored by its classification.

    Mutates `present_zones` to record which classifications were actually drawn
    so the legend only lists relevant entries.
    """
    n = len(points)
    lines: list[str] = []
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        etype = _edge_type_for(edge_types, i, n)
        present_zones.add(etype)
        stroke = EDGE_ZONES[etype]["stroke"]
        lines.append(
            f'<line class="roof-edge roof-edge--{etype}" '
            f'x1="{_fmt(x1)}" y1="{_fmt(y1)}" x2="{_fmt(x2)}" y2="{_fmt(y2)}" '
            f'stroke="{stroke}" stroke-width="{_EDGE_STROKE_WIDTH}" '
            f'stroke-linecap="round"/>'
        )
    return lines


def _legend_svg(present_zones: Iterable[str]) -> str:
    """Compact legend keying edge colors to code zones.

    Only classifications actually present in the drawing are shown.
    """
    ordered = [z for z in _LEGEND_ORDER if z in set(present_zones)]
    if not ordered:
        return ""

    # Layout: bottom-left stacked rows inside the viewBox.
    pad_x = 24
    base_y = VIEWBOX_H - 24 - (len(ordered) - 1) * 30
    row_h = 30
    swatch = 18

    parts = ['<g class="roof-legend" font-family="Helvetica, Arial, sans-serif">']
    # Backing panel so the legend stays readable over any facet fill.
    panel_h = len(ordered) * row_h + 16
    panel_y = base_y - swatch - 4
    parts.append(
        f'<rect x="{pad_x - 12}" y="{panel_y}" width="320" height="{panel_h}" '
        f'rx="8" fill="var(--roof-legend-bg, rgba(255,255,255,0.82))" '
        f'stroke="var(--roof-legend-border, rgba(15,23,42,0.12))" stroke-width="1"/>'
    )
    for idx, etype in enumerate(ordered):
        y = base_y + idx * row_h
        info = EDGE_ZONES[etype]
        label = f"{etype.capitalize()} → {info['zone']}"
        parts.append(
            f'<line x1="{pad_x}" y1="{y}" x2="{pad_x + swatch + 8}" y2="{y}" '
            f'stroke="{info["stroke"]}" stroke-width="{_EDGE_STROKE_WIDTH}" '
            f'stroke-linecap="round"/>'
        )
        parts.append(
            f'<text x="{pad_x + swatch + 18}" y="{y + 4}" '
            f'font-size="15" fill="var(--roof-legend-text, #1e293b)">'
            f'{_escape(label)}</text>'
        )
    parts.append("</g>")
    return "\n  ".join(parts)


def _bbox(points_lists: Iterable[list[tuple[float, float]]]) -> Optional[tuple[float, float, float, float]]:
    """Bounding box (min_x, min_y, max_x, max_y) of every point across facets."""
    xs: list[float] = []
    ys: list[float] = []
    for pts in points_lists:
        for x, y in pts:
            xs.append(x)
            ys.append(y)
    if not xs or not ys:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


def _fit_transform(bbox: tuple[float, float, float, float]) -> Optional[str]:
    """SVG transform that scales+translates the footprint bbox to FILL the viewBox.

    Computes a single uniform scale (preserving aspect ratio) so the longer axis
    of the footprint fills (viewBox - 2*margin), then centers it. Returns an SVG
    `transform="translate(...) scale(...)"` string applied to the drawing groups,
    or None when the footprint already maps 1:1 (degenerate / zero-span bbox).
    """
    min_x, min_y, max_x, max_y = bbox
    span_x = max_x - min_x
    span_y = max_y - min_y
    if span_x <= 0 and span_y <= 0:
        return None

    avail_w = VIEWBOX_W - 2 * _FIT_MARGIN
    avail_h = VIEWBOX_H - 2 * _FIT_MARGIN
    # Uniform scale: the binding axis fills its available extent; a zero-span axis
    # doesn't constrain the scale (avoid div-by-zero).
    scale_candidates = []
    if span_x > 0:
        scale_candidates.append(avail_w / span_x)
    if span_y > 0:
        scale_candidates.append(avail_h / span_y)
    scale = min(scale_candidates)

    # Center the scaled footprint inside the viewBox.
    scaled_w = span_x * scale
    scaled_h = span_y * scale
    tx = _FIT_MARGIN + (avail_w - scaled_w) / 2.0 - min_x * scale
    ty = _FIT_MARGIN + (avail_h - scaled_h) / 2.0 - min_y * scale

    return f'translate({_fmt(tx)},{_fmt(ty)}) scale({_fmt(scale)})'


def render_roof_footprint(roof_facets_payload: Any) -> Optional[str]:
    """Render the real overhead roof footprint from facet geometry.

    Args:
        roof_facets_payload: the ``claims.roof_facets`` payload (or any dict
            shaped like it). See the module docstring for the contract.

    Returns:
        An SVG string (viewBox "0 0 1000 1000") drawing the union of every
        facet polygon as the real overhead roof footprint, each facet lightly
        filled and each polygon edge colored by its `edge_types`
        classification, with a compact legend.

        Returns ``None`` when there is no usable polygon geometry — e.g. the
        ~40% synthesized 4-cardinal skeleton claims whose facets carry empty
        ``polygon_pixels``. The caller falls back to the generic-house diagram
        (compliance_svg.generate_house_svg) in that case.
    """
    if not isinstance(roof_facets_payload, dict):
        return None

    facets = roof_facets_payload.get("roof_facets")
    if not isinstance(facets, list) or not facets:
        return None

    # Build the renderable set first; if NONE are renderable (synthesized
    # skeleton with empty polygons), bail so the caller falls back.
    renderable: list[dict[str, Any]] = []
    for facet in facets:
        if not isinstance(facet, dict):
            continue
        points = _clean_points(facet.get("polygon_pixels"))
        if not _is_renderable(points):
            continue
        renderable.append(
            {
                "facet_id": str(facet.get("facet_id") or f"F{len(renderable) + 1}"),
                "points": points,
                "edge_types": facet.get("edge_types"),
            }
        )

    if not renderable:
        return None

    present_zones: set[str] = set()

    facet_polys: list[str] = []
    facet_edges: list[str] = []
    for f in renderable:
        facet_polys.append(_facet_polygon_svg(f["points"], f["facet_id"]))
        facet_edges.extend(_facet_edges_svg(f["points"], f["edge_types"], present_zones))

    legend = _legend_svg(present_zones)

    # Scale+translate the raw normalized facet coords so the footprint FILLS the
    # viewBox (uniform margin, aspect ratio preserved) instead of rendering small
    # in a big frame. The legend stays in absolute viewBox coords (drawn outside
    # the fit group) so it keeps its fixed, readable corner.
    fit_bbox = _bbox([f["points"] for f in renderable])
    transform = _fit_transform(fit_bbox) if fit_bbox else None
    fit_open = f'<g class="roof-fit" transform="{transform}">' if transform else ""
    fit_close = "</g>" if transform else ""

    svg_parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VIEWBOX_W} {VIEWBOX_H}" '
        f'width="100%" style="max-width: 900px; margin: 0 auto; display: block;" '
        f'role="img" aria-label="Overhead roof footprint">',
        f'  <rect class="roof-bg" width="{VIEWBOX_W}" height="{VIEWBOX_H}" fill="{_BACKGROUND}"/>',
    ]
    if fit_open:
        svg_parts.append(f"  {fit_open}")
    svg_parts.append("  <!-- Facet footprints (union = real overhead roof outline) -->")
    svg_parts.append('  <g class="roof-footprint" stroke-linejoin="round">')
    for poly in facet_polys:
        svg_parts.append(f"    {poly}")
    svg_parts.append("  </g>")
    svg_parts.append("  <!-- Code-zone edges -->")
    svg_parts.append('  <g class="roof-edges">')
    for edge in facet_edges:
        svg_parts.append(f"    {edge}")
    svg_parts.append("  </g>")
    if fit_close:
        svg_parts.append(f"  {fit_close}")
    if legend:
        svg_parts.append("  <!-- Legend -->")
        svg_parts.append(f"  {legend}")
    svg_parts.append("</svg>")

    return "\n".join(svg_parts)
