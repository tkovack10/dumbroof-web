"""
SVG House Rendering Engine for Building Code Compliance Report.

Generates a parametric isometric house diagram with annotated code callouts
pointing to specific zones (eaves, rakes, ridge, walls, corners, etc.).

Measurements from EagleView drive the annotations. Code citations from
code_compliance.py drive the callout content.
"""

import math
from typing import Optional

# ── Zone coordinate system ──
# The house is rendered in a simplified isometric view showing front + right side + roof.
# Viewbox: 0 0 900 650 (landscape, fits well on letter PDF)

VIEWBOX_W = 900
VIEWBOX_H = 650

# House geometry constants (these scale based on stories/pitch)
_HOUSE_LEFT = 180
_HOUSE_RIGHT = 620
_HOUSE_BOTTOM = 520
_WALL_WIDTH = 440   # front wall
_SIDE_DEPTH = 180   # side wall visual depth (isometric offset)
_SIDE_SKEW_X = 50   # horizontal offset for 3D effect


def _wall_height(stories: int) -> int:
    return 180 if stories >= 2 else 130


def _roof_peak_y(stories: int, pitch_fraction: float) -> int:
    """Calculate roof peak Y based on stories and pitch."""
    wall_top = _HOUSE_BOTTOM - _wall_height(stories)
    # pitch_fraction: e.g., 0.5 for 6/12, 0.75 for 9/12
    roof_rise = int((_WALL_WIDTH / 2) * max(0.1, min(pitch_fraction, 0.85)) * 0.45)
    return wall_top - roof_rise - 30


def _parse_pitch(pitch_str: str) -> float:
    """Parse '7/12' style pitch to a fraction."""
    if not pitch_str:
        return 0.5
    try:
        parts = pitch_str.replace("/12", "").strip().split("/")
        return float(parts[0]) / 12.0
    except (ValueError, IndexError):
        return 0.5


# ── Zone definitions (callable with stories/pitch to get coordinates) ──

def _get_house_points(stories: int, pitch: float):
    """Calculate all key house geometry points."""
    wh = _wall_height(stories)
    wall_top = _HOUSE_BOTTOM - wh
    peak_y = _roof_peak_y(stories, pitch)
    mid_x = (_HOUSE_LEFT + _HOUSE_RIGHT) / 2

    # Front wall corners
    fl = (_HOUSE_LEFT, _HOUSE_BOTTOM)      # front-left bottom
    fr = (_HOUSE_RIGHT, _HOUSE_BOTTOM)     # front-right bottom
    ftl = (_HOUSE_LEFT, wall_top)          # front-top-left
    ftr = (_HOUSE_RIGHT, wall_top)         # front-top-right

    # Side wall corners (isometric offset)
    sr = (_HOUSE_RIGHT + _SIDE_SKEW_X, _HOUSE_BOTTOM - 60)   # side-right bottom
    str_ = (_HOUSE_RIGHT + _SIDE_SKEW_X, wall_top - 60)      # side-right top

    # Gable peak
    peak = (mid_x, peak_y)

    # Roof corners
    roof_fl = (_HOUSE_LEFT - 15, wall_top - 8)               # front-left overhang
    roof_fr = (_HOUSE_RIGHT + 15, wall_top - 8)              # front-right overhang
    roof_sr = (_HOUSE_RIGHT + _SIDE_SKEW_X + 15, wall_top - 68)  # side-right overhang
    roof_peak_front = (mid_x, peak_y - 8)
    roof_peak_side = (mid_x + _SIDE_SKEW_X, peak_y - 68)

    # Ridge line
    ridge_front = roof_peak_front
    ridge_back = (mid_x + _SIDE_SKEW_X, peak_y - 68)

    return {
        "fl": fl, "fr": fr, "ftl": ftl, "ftr": ftr,
        "sr": sr, "str": str_,
        "peak": peak,
        "roof_fl": roof_fl, "roof_fr": roof_fr, "roof_sr": roof_sr,
        "roof_peak_front": roof_peak_front, "roof_peak_side": roof_peak_side,
        "ridge_front": ridge_front, "ridge_back": ridge_back,
        "wall_top": wall_top, "wh": wh,
    }


# ── Annotation slot positions ──
# 8 positions around the house perimeter for callout boxes
SLOT_POSITIONS = {
    "top-left":     (10, 30),
    "top-right":    (620, 30),
    "left-upper":   (10, 160),
    "left-lower":   (10, 340),
    "right-upper":  (680, 140),
    "right-lower":  (680, 320),
    "bottom-left":  (10, 540),
    "bottom-right": (500, 560),
}

# Zone → preferred slot mapping
ZONE_TO_SLOT = {
    "ridge":          "top-right",
    "eave-front":     "bottom-left",
    "eave-side":      "right-lower",
    "rake-left":      "left-upper",
    "rake-right":     "top-right",
    "roof-field":     "top-left",
    "valley":         "left-upper",
    "wall-front":     "left-lower",
    "wall-side":      "right-lower",
    "corner":         "right-upper",
    "window-front":   "left-lower",
    "step-flash-zone":"right-upper",
    "gutter":         "bottom-right",
    "penetration":    "top-left",
    "chimney":        "top-right",
}

# Zone → anchor point on the house (where the arrow points TO)
def _get_zone_anchor(zone: str, pts: dict) -> tuple:
    """Get the (x, y) coordinate where the annotation arrow should point."""
    wt = pts["wall_top"]
    mid_x = (pts["fl"][0] + pts["fr"][0]) / 2

    anchors = {
        "eave-front":     (mid_x, _HOUSE_BOTTOM + 2),
        "eave-side":      (pts["fr"][0] + 30, _HOUSE_BOTTOM - 30),
        "rake-left":      (pts["fl"][0] - 5, (wt + pts["roof_peak_front"][1]) / 2),
        "rake-right":     (pts["fr"][0] + 5, (wt + pts["roof_peak_front"][1]) / 2),
        "ridge":          ((pts["ridge_front"][0] + pts["ridge_back"][0]) / 2,
                           (pts["ridge_front"][1] + pts["ridge_back"][1]) / 2),
        "roof-field":     (mid_x - 40, (wt + pts["roof_peak_front"][1]) / 2 + 30),
        "valley":         (mid_x - 60, (wt + pts["roof_peak_front"][1]) / 2 + 20),
        "wall-front":     (mid_x - 60, wt + pts["wh"] / 2),
        "wall-side":      (pts["fr"][0] + 40, wt + pts["wh"] / 2 - 30),
        "corner":         (pts["fr"][0] + 3, wt + pts["wh"] / 3),
        "window-front":   (mid_x - 80, wt + pts["wh"] * 0.4),
        "step-flash-zone":(pts["fr"][0] + 10, wt - 10),
        "gutter":         (mid_x, _HOUSE_BOTTOM + 12),
        "penetration":    (mid_x + 50, (wt + pts["roof_peak_front"][1]) / 2 + 40),
        "chimney":        (mid_x + 80, (wt + pts["roof_peak_front"][1]) / 2 - 10),
    }
    return anchors.get(zone, (mid_x, wt))


# ── SVG Generation ──

def _svg_house_structure(pts: dict, has_siding: bool, stories: int) -> str:
    """Generate the house structure SVG elements."""
    wt = pts["wall_top"]

    # Colors
    wall_fill = "#e4e8ed" if not has_siding else "#d6dce5"
    wall_side_fill = "#ccd3dc" if not has_siding else "#bfc8d4"
    roof_fill = "#8b9bb0"
    roof_side_fill = "#7a8a9e"
    stroke = "#2c3e50"

    elements = []

    # Front wall
    elements.append(f'<rect x="{pts["fl"][0]}" y="{wt}" width="{_WALL_WIDTH}" '
                     f'height="{pts["wh"]}" fill="{wall_fill}" stroke="{stroke}" stroke-width="2"/>')

    # Side wall (parallelogram)
    sx = pts["fr"][0]
    elements.append(f'<polygon points="{sx},{wt} {sx},{_HOUSE_BOTTOM} '
                     f'{pts["sr"][0]},{pts["sr"][1]} {pts["str"][0]},{pts["str"][1]}" '
                     f'fill="{wall_side_fill}" stroke="{stroke}" stroke-width="2"/>')

    # Front gable triangle
    mid_x = (pts["fl"][0] + pts["fr"][0]) / 2
    elements.append(f'<polygon points="{pts["fl"][0]},{wt} {pts["fr"][0]},{wt} '
                     f'{mid_x},{pts["peak"][1]}" '
                     f'fill="{wall_fill}" stroke="{stroke}" stroke-width="2"/>')

    # Roof — front plane
    rpf = pts["roof_peak_front"]
    rfl = pts["roof_fl"]
    rfr = pts["roof_fr"]
    rpb = pts["roof_peak_side"]
    rsr = pts["roof_sr"]
    elements.append(f'<polygon points="{rpf[0]},{rpf[1]} {rfl[0]},{rfl[1]} '
                     f'{rfl[0] + _SIDE_SKEW_X},{rfl[1] - 60} {rpb[0]},{rpb[1]}" '
                     f'fill="{roof_fill}" stroke="{stroke}" stroke-width="2" opacity="0.85"/>')

    # Roof — side plane
    elements.append(f'<polygon points="{rpf[0]},{rpf[1]} {rfr[0]},{rfr[1]} '
                     f'{rsr[0]},{rsr[1]} {rpb[0]},{rpb[1]}" '
                     f'fill="{roof_side_fill}" stroke="{stroke}" stroke-width="2" opacity="0.85"/>')

    # Ridge line
    elements.append(f'<line x1="{rpf[0]}" y1="{rpf[1]}" x2="{rpb[0]}" y2="{rpb[1]}" '
                     f'stroke="{stroke}" stroke-width="3" stroke-linecap="round"/>')

    # Windows — front wall
    win_y = wt + pts["wh"] * 0.25
    win_h = pts["wh"] * 0.35
    for wx in [pts["fl"][0] + 60, pts["fl"][0] + 200, pts["fl"][0] + 320]:
        elements.append(f'<rect x="{wx}" y="{win_y}" width="55" height="{win_h}" '
                         f'rx="2" fill="#a8c4e0" stroke="{stroke}" stroke-width="1.5"/>')
        # Window cross
        elements.append(f'<line x1="{wx}" y1="{win_y + win_h/2}" x2="{wx+55}" y2="{win_y + win_h/2}" '
                         f'stroke="{stroke}" stroke-width="1"/>')
        elements.append(f'<line x1="{wx+27}" y1="{win_y}" x2="{wx+27}" y2="{win_y + win_h}" '
                         f'stroke="{stroke}" stroke-width="1"/>')

    # Door — front wall
    door_x = pts["fl"][0] + _WALL_WIDTH / 2 - 25
    door_h = pts["wh"] * 0.55
    door_y = _HOUSE_BOTTOM - door_h
    elements.append(f'<rect x="{door_x}" y="{door_y}" width="50" height="{door_h}" '
                     f'rx="2" fill="#6b4c3b" stroke="{stroke}" stroke-width="1.5"/>')

    # Side windows (use explicit parallelogram instead of skewY to avoid position displacement)
    side_win_x = pts["fr"][0] + 20
    side_win_h = pts["wh"] * 0.3
    side_win_y = wt + side_win_h - 20
    # Parallelogram points for isometric side window
    sw_tl = (side_win_x, side_win_y - 20)
    sw_tr = (side_win_x + 40, side_win_y - 20 - 12)
    sw_br = (side_win_x + 40, side_win_y + side_win_h - 12)
    sw_bl = (side_win_x, side_win_y + side_win_h)
    elements.append(f'<polygon points="{sw_tl[0]},{sw_tl[1]} {sw_tr[0]},{sw_tr[1]} '
                     f'{sw_br[0]},{sw_br[1]} {sw_bl[0]},{sw_bl[1]}" '
                     f'fill="#a8c4e0" stroke="{stroke}" stroke-width="1.5"/>')

    # Foundation line
    elements.append(f'<rect x="{pts["fl"][0] - 5}" y="{_HOUSE_BOTTOM}" '
                     f'width="{_WALL_WIDTH + 10}" height="12" fill="#8c9aab" stroke="{stroke}" stroke-width="1"/>')

    # Eave gutter line
    elements.append(f'<line x1="{pts["fl"][0] - 10}" y1="{_HOUSE_BOTTOM + 3}" '
                     f'x2="{pts["fr"][0] + 10}" y2="{_HOUSE_BOTTOM + 3}" '
                     f'stroke="#5a6878" stroke-width="4" stroke-linecap="round"/>')

    return "\n    ".join(elements)


def _svg_zone_highlights(zones: list[str], pts: dict) -> str:
    """Add subtle highlights to active annotation zones."""
    elements = []
    wt = pts["wall_top"]
    mid_x = (pts["fl"][0] + pts["fr"][0]) / 2

    for zone in zones:
        if zone == "eave-front":
            elements.append(f'<line x1="{pts["fl"][0] - 10}" y1="{_HOUSE_BOTTOM + 3}" '
                             f'x2="{pts["fr"][0] + 10}" y2="{_HOUSE_BOTTOM + 3}" '
                             f'stroke="#e74c3c" stroke-width="6" opacity="0.6" stroke-linecap="round"/>')
        elif zone == "rake-left":
            rpf = pts["roof_peak_front"]
            elements.append(f'<line x1="{rpf[0]}" y1="{rpf[1]}" '
                             f'x2="{pts["roof_fl"][0]}" y2="{pts["roof_fl"][1]}" '
                             f'stroke="#e74c3c" stroke-width="5" opacity="0.6" stroke-linecap="round"/>')
        elif zone == "ridge":
            rpf = pts["roof_peak_front"]
            rpb = pts["roof_peak_side"]
            elements.append(f'<line x1="{rpf[0]}" y1="{rpf[1]}" x2="{rpb[0]}" y2="{rpb[1]}" '
                             f'stroke="#e74c3c" stroke-width="5" opacity="0.6" stroke-linecap="round"/>')
        elif zone == "corner":
            elements.append(f'<line x1="{pts["fr"][0]}" y1="{wt}" x2="{pts["fr"][0]}" y2="{_HOUSE_BOTTOM}" '
                             f'stroke="#e74c3c" stroke-width="8" opacity="0.5" stroke-linecap="round"/>')
        elif zone == "wall-front":
            elements.append(f'<rect x="{pts["fl"][0] + 2}" y="{wt + 2}" '
                             f'width="{_WALL_WIDTH - 4}" height="{pts["wh"] - 4}" '
                             f'fill="#e74c3c" opacity="0.08" rx="3"/>')
        elif zone == "roof-field":
            rpf = pts["roof_peak_front"]
            elements.append(f'<polygon points="{rpf[0]},{rpf[1]} '
                             f'{pts["roof_fl"][0]},{pts["roof_fl"][1]} '
                             f'{pts["roof_fr"][0]},{pts["roof_fr"][1]}" '
                             f'fill="#e74c3c" opacity="0.08"/>')

    return "\n    ".join(elements)


def _svg_annotation(zone: str, code_tag: str, title: str, measurement: str,
                     pts: dict, slot_pos: tuple, is_critical: bool) -> str:
    """Generate a single annotation callout with arrow."""
    anchor = _get_zone_anchor(zone, pts)
    box_x, box_y = slot_pos
    box_w = 230
    box_h = 58

    # Arrow from callout box edge to zone anchor
    # Calculate box center
    bcx = box_x + box_w / 2
    bcy = box_y + box_h / 2

    # Arrow start point: closest edge of box to anchor
    dx = anchor[0] - bcx
    dy = anchor[1] - bcy
    dist = max(1, math.sqrt(dx * dx + dy * dy))
    # Clamp arrow start to box edge
    ax = bcx + dx / dist * min(box_w / 2 + 10, dist * 0.3)
    ay = bcy + dy / dist * min(box_h / 2 + 10, dist * 0.3)

    # Colors
    border_color = "#c0392b" if is_critical else "#2c3e50"
    bg_color = "#fdf2f2" if is_critical else "#f0f4f8"
    tag_color = "#c0392b" if is_critical else "#1a5276"
    arrow_color = border_color

    svg = f'''
    <!-- Annotation: {title} -->
    <line x1="{ax:.0f}" y1="{ay:.0f}" x2="{anchor[0]:.0f}" y2="{anchor[1]:.0f}"
          stroke="{arrow_color}" stroke-width="2" stroke-dasharray="6,3"
          marker-end="url(#arrowhead-{'red' if is_critical else 'blue'})"/>
    <rect x="{box_x}" y="{box_y}" width="{box_w}" height="{box_h}"
          rx="6" fill="{bg_color}" stroke="{border_color}" stroke-width="1.5"
          filter="url(#shadow)"/>
    <text x="{box_x + 10}" y="{box_y + 18}" font-family="Helvetica, Arial, sans-serif"
          font-size="10" font-weight="bold" fill="{tag_color}">{_escape(code_tag)}</text>
    <text x="{box_x + 10}" y="{box_y + 33}" font-family="Helvetica, Arial, sans-serif"
          font-size="11" fill="#2c3e50">{_escape(title[:35])}</text>
    <text x="{box_x + 10}" y="{box_y + 48}" font-family="Helvetica, Arial, sans-serif"
          font-size="9" fill="#5d6d7e">{_escape(measurement[:40])}</text>
    '''
    return svg


def _escape(text: str) -> str:
    """Escape text for SVG."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


# ── CODE_TO_ZONE mapping ──

CODE_TO_ZONE = {
    # Roofing codes
    "R905.1.2":   {"zone": "eave-front",      "label": "Ice & Water Barrier",          "priority": 1, "critical": True},
    "R905.1.1":   {"zone": "roof-field",       "label": "Underlayment Required",        "priority": 5, "critical": False},
    "R905.1":     {"zone": "roof-field",       "label": "Manufacturer Install = Law",   "priority": 2, "critical": True},
    "R905.2.8.5": {"zone": "rake-left",        "label": "Drip Edge Required",           "priority": 3, "critical": True},
    "R908.3":     {"zone": "roof-field",       "label": "Full Tear-Off Required",       "priority": 6, "critical": False},
    "R806":       {"zone": "ridge",            "label": "Ridge Ventilation",            "priority": 7, "critical": False},
    "R806.1":     {"zone": "ridge",            "label": "Ridge Ventilation",            "priority": 7, "critical": False},
    "R905.2.8.3": {"zone": "step-flash-zone",  "label": "Step Flashing Required",      "priority": 4, "critical": False},
    "R905.2.8":   {"zone": "penetration",      "label": "Pipe Boot Flashing",          "priority": 8, "critical": False},
    "R905.2":     {"zone": "roof-field",       "label": "Shingle Installation",        "priority": 9, "critical": False},
    # Siding codes
    "R703.2":     {"zone": "wall-front",       "label": "House Wrap (WRB) Required",   "priority": 1, "critical": True},
    "R703.1":     {"zone": "corner",           "label": "WRB Must Wrap Corners",       "priority": 1, "critical": True},
    "R703.3":     {"zone": "wall-side",        "label": "Siding per Manufacturer",     "priority": 3, "critical": False},
    "R703.4":     {"zone": "window-front",     "label": "Window/Door Flashing",        "priority": 4, "critical": False},
    "R703.8":     {"zone": "window-front",     "label": "Wall Flashing Required",      "priority": 2, "critical": True},
}


def generate_house_svg(config: dict, annotations: list[dict]) -> str:
    """
    Generate the complete annotated house SVG.

    Args:
        config: Full claim config with measurements, structures, scope
        annotations: List of dicts with keys: code_tag, title, measurement, zone, is_critical

    Returns:
        Complete SVG string ready for HTML embedding.
    """
    # Extract parameters
    structures = config.get("structures", [{}])
    main_struct = structures[0] if structures else {}
    pitch_str = main_struct.get("predominant_pitch", "6/12")
    stories = config.get("property", {}).get("stories", 1) or 1
    if isinstance(stories, str):
        stories = int(stories) if stories.isdigit() else 1
    has_siding = "siding" in [t.lower() for t in (config.get("scope", {}).get("trades") or [])]

    pitch = _parse_pitch(pitch_str)
    pts = _get_house_points(stories, pitch)

    # Assign annotation slots (deduplicate by zone)
    used_slots = set()
    assigned = []
    active_zones = []

    for ann in sorted(annotations, key=lambda a: a.get("priority", 99)):
        zone = ann.get("zone", "roof-field")
        preferred_slot = ZONE_TO_SLOT.get(zone, "top-left")

        if preferred_slot in used_slots:
            # Find next available slot
            for alt_slot in SLOT_POSITIONS:
                if alt_slot not in used_slots:
                    preferred_slot = alt_slot
                    break
            else:
                continue  # All slots full, skip this annotation

        used_slots.add(preferred_slot)
        active_zones.append(zone)
        assigned.append({**ann, "slot": preferred_slot, "slot_pos": SLOT_POSITIONS[preferred_slot]})

        if len(assigned) >= 8:
            break

    # Build SVG
    svg_parts = [f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VIEWBOX_W} {VIEWBOX_H}"
     width="100%" style="max-width: 850px; margin: 0 auto; display: block;">
  <defs>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="2" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.12"/>
    </filter>
    <marker id="arrowhead-blue" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#2c3e50"/>
    </marker>
    <marker id="arrowhead-red" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#c0392b"/>
    </marker>
  </defs>

  <!-- Background -->
  <rect width="{VIEWBOX_W}" height="{VIEWBOX_H}" fill="#fafbfc" rx="8"/>

  <!-- Ground line -->
  <line x1="100" y1="{_HOUSE_BOTTOM + 14}" x2="780" y2="{_HOUSE_BOTTOM + 14}"
        stroke="#bdc3c7" stroke-width="1" stroke-dasharray="4,4"/>
''']

    # House structure
    svg_parts.append("  <!-- House structure -->")
    svg_parts.append(f"  {_svg_house_structure(pts, has_siding, stories)}")

    # Zone highlights
    svg_parts.append("  <!-- Zone highlights -->")
    svg_parts.append(f"  {_svg_zone_highlights(active_zones, pts)}")

    # Annotations
    svg_parts.append("  <!-- Annotations -->")
    for ann in assigned:
        svg_parts.append(_svg_annotation(
            zone=ann["zone"],
            code_tag=ann["code_tag"],
            title=ann["title"],
            measurement=ann.get("measurement", ""),
            pts=pts,
            slot_pos=ann["slot_pos"],
            is_critical=ann.get("is_critical", False),
        ))

    # Title bar at bottom
    svg_parts.append(f'''
  <!-- Legend -->
  <rect x="180" y="{VIEWBOX_H - 40}" width="540" height="30" rx="4" fill="#2c3e50" opacity="0.9"/>
  <circle cx="220" cy="{VIEWBOX_H - 25}" r="5" fill="#c0392b"/>
  <text x="230" y="{VIEWBOX_H - 21}" font-family="Helvetica, Arial" font-size="10" fill="white">
    Code items commonly omitted by carriers</text>
  <circle cx="500" cy="{VIEWBOX_H - 25}" r="5" fill="#2c3e50"/>
  <text x="510" y="{VIEWBOX_H - 21}" font-family="Helvetica, Arial" font-size="10" fill="white">
    Standard code requirements</text>
''')

    svg_parts.append("</svg>")
    return "\n".join(svg_parts)


def collect_annotations_from_config(config: dict) -> list[dict]:
    """
    Scan line items for code citations and build annotation list
    for the house rendering.
    """
    from building_codes import lookup as _bc_lookup
    annotations = []
    seen_zones = set()
    measurements = config.get("measurements", {})
    state = config.get("property", {}).get("state", "NY").upper()
    jurisdiction = _bc_lookup.get_prefix(state)

    for li in config.get("line_items", []):
        cc = li.get("code_citation")
        if not cc:
            continue

        section = cc.get("section", "") or ""
        # Find matching CODE_TO_ZONE entry (longest match first to avoid R905.1 stealing R905.1.2)
        for code_key, zone_info in sorted(CODE_TO_ZONE.items(), key=lambda x: -len(x[0])):
            if section.startswith(code_key) or section == code_key:
                zone = zone_info["zone"]
                if zone in seen_zones:
                    continue
                seen_zones.add(zone)

                # Build measurement string from EagleView data
                meas_str = _build_measurement_string(zone, measurements, li)

                # Build code tag with jurisdiction
                code_tag = f"{jurisdiction} {section}" if section else (cc.get("code_tag") or "")

                annotations.append({
                    "zone": zone,
                    "code_tag": code_tag,
                    "title": zone_info["label"],
                    "measurement": meas_str,
                    "priority": zone_info["priority"],
                    "is_critical": zone_info.get("critical", False),
                    "full_citation": cc,
                })
                break

    return annotations


def _build_measurement_string(zone: str, measurements: dict, line_item: dict) -> str:
    """Build a human-readable measurement string for the annotation."""
    qty = float(line_item.get("qty", 0) or 0)
    unit = line_item.get("unit", "") or ""
    ev_formula = line_item.get("ev_formula", "") or ""

    if ev_formula:
        return f"{qty:.0f} {unit} ({ev_formula})"

    zone_meas = {
        "eave-front": f"Eave: {measurements.get('eave', 0):.0f} LF",
        "eave-side": f"Eave: {measurements.get('eave', 0):.0f} LF",
        "rake-left": f"Rake: {measurements.get('rake', 0):.0f} LF",
        "rake-right": f"Rake: {measurements.get('rake', 0):.0f} LF",
        "ridge": f"Ridge: {measurements.get('ridge', 0):.0f} LF",
        "valley": f"Valley: {measurements.get('valley', 0):.0f} LF",
        "wall-front": f"Wall: {qty:.0f} {unit}",
        "wall-side": f"Wall: {qty:.0f} {unit}",
        "corner": "Wrap min 12\" around corners",
        "roof-field": f"Roof: {measurements.get('total_area', 0):.0f} SF",
    }

    return zone_meas.get(zone, f"{qty:.0f} {unit}")
