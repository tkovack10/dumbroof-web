#!/usr/bin/env python3
"""Tests for backend/roof_geometry_svg.render_roof_footprint.

Proves the real-geometry overhead footprint renderer:
  * draws footprint path/polygon + per-edge <line> elements from facet polygons,
  * colors EAVE edges with the Ice & Water Barrier zone color,
  * emits a legend,
  * returns None when there's no usable polygon geometry (synthesized 4-cardinal
    skeleton claims whose facets carry empty polygon_pixels).

Runs with pytest if present, else as a plain script:
    python3 backend/tests/test_roof_geometry_svg.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from roof_geometry_svg import (  # noqa: E402
    EDGE_ZONES,
    render_roof_footprint,
)

# The literal default for the eave/I&W stroke — what the SVG must carry on eave
# edges. Pulled from the source of truth so the test tracks any future re-theme.
EAVE_STROKE = EDGE_ZONES["eave"]["stroke"]


def _mock_payload():
    """2 facets, each a closed quad with polygon_pixels + a full edge_types array.

    F1 is a south-facing front slope: eave (bottom), rake (right), ridge (top),
    rake (left). F2 is the back slope sharing the ridge, with a valley on one
    side and a wall (step-flashing) edge on the other.
    """
    return {
        "roof_facets": [
            {
                "facet_id": "F1",
                "cardinal": "S",
                "pitch": "6/12",
                "area_pct": 50.0,
                # clockwise: top-left -> top-right -> bottom-right -> bottom-left
                "polygon_pixels": [[200, 200], [800, 200], [800, 500], [200, 500]],
                # edge i = vertex i -> (i+1)%N :
                #   0: TL->TR  (top)    = ridge
                #   1: TR->BR  (right)  = rake
                #   2: BR->BL  (bottom) = eave
                #   3: BL->TL  (left)   = rake
                "edge_types": ["ridge", "rake", "eave", "rake"],
            },
            {
                "facet_id": "F2",
                "cardinal": "N",
                "pitch": "6/12",
                "area_pct": 50.0,
                "polygon_pixels": [[200, 500], [800, 500], [700, 750], [300, 750]],
                #   0: ->  (top, shared ridge)  = ridge
                #   1: ->  (right)              = valley
                #   2: ->  (bottom)             = eave
                #   3: ->  (left)               = wall
                "edge_types": ["ridge", "valley", "eave", "wall"],
            },
        ],
        "north_arrow_angle": 0.0,
        "scale_bar": {"pixels": 100, "feet": 20},
        "_synthesized": False,
    }


def _synthesized_payload():
    """The ~40% case: a 4-cardinal skeleton with EMPTY polygon_pixels."""
    return {
        "roof_facets": [
            {"facet_id": "N", "cardinal": "N", "pitch": "6/12", "area_pct": 25, "polygon_pixels": [], "edge_types": []},
            {"facet_id": "E", "cardinal": "E", "pitch": "6/12", "area_pct": 25, "polygon_pixels": [], "edge_types": []},
            {"facet_id": "S", "cardinal": "S", "pitch": "6/12", "area_pct": 25, "polygon_pixels": [], "edge_types": []},
            {"facet_id": "W", "cardinal": "W", "pitch": "6/12", "area_pct": 25, "polygon_pixels": [], "edge_types": []},
        ],
        "north_arrow_angle": 0.0,
        "scale_bar": None,
        "_synthesized": True,
    }


def test_renders_footprint_geometry():
    svg = render_roof_footprint(_mock_payload())
    assert svg is not None, "expected an SVG for real polygon geometry"
    assert "<svg" in svg and "viewBox=\"0 0 1000 1000\"" in svg
    # Footprint = filled facet paths. Both facets present + closed (Z).
    assert svg.count('class="roof-facet"') == 2, "both facet footprints should render"
    assert "data-facet-id=\"F1\"" in svg and "data-facet-id=\"F2\"" in svg
    assert " Z" in svg, "facet paths must be closed polygons"
    # Per-edge lines: 4 edges per quad * 2 facets = 8. Count the per-edge
    # marker `roof-edge--<type>` (the `roof-edges` group wrapper shares the
    # `roof-edge` prefix, so match the double-dash modifier instead).
    assert svg.count('roof-edge--') == 8, "one <line> per polygon edge expected"


def test_eave_edges_carry_iw_barrier_color():
    svg = render_roof_footprint(_mock_payload())
    assert svg is not None
    # The eave classification must map to the Ice & Water Barrier zone...
    assert EDGE_ZONES["eave"]["zone"] == "Ice & Water Barrier"
    # ...and eave edges in the drawing must carry that stroke color.
    assert f'stroke="{EAVE_STROKE}"' in svg, "eave edges must use the I&W barrier zone color"
    # Specifically: an edge tagged as an eave must use the eave stroke.
    import re
    eave_lines = re.findall(r'<line class="roof-edge roof-edge--eave"[^>]*>', svg)
    assert eave_lines, "expected at least one eave-classified edge line"
    assert all(f'stroke="{EAVE_STROKE}"' in ln for ln in eave_lines), \
        "every eave edge must be stroked with the Ice & Water Barrier color"


def test_legend_present():
    svg = render_roof_footprint(_mock_payload())
    assert svg is not None
    assert 'class="roof-legend"' in svg, "a legend group must be present"
    # Legend keys colors to code zones — the eave row names the I&W barrier.
    assert "Ice &amp; Water Barrier" in svg, "legend should name the I&W barrier zone"
    assert "Drip Edge" in svg, "legend should name the Drip Edge (rake) zone"
    # Only classifications actually drawn appear — F1/F2 have no 'hip', so it's absent.
    assert "Hip →" not in svg and "Hip →" not in svg


def test_returns_none_on_empty_geometry():
    assert render_roof_footprint(_synthesized_payload()) is None, \
        "synthesized 4-cardinal skeleton (empty polygons) must return None for fallback"


def test_returns_none_on_missing_or_malformed_input():
    assert render_roof_footprint(None) is None
    assert render_roof_footprint({}) is None
    assert render_roof_footprint({"roof_facets": []}) is None
    assert render_roof_footprint({"roof_facets": [{"facet_id": "x"}]}) is None
    # A facet with fewer than 3 corners is skipped (ported isRenderablePolygon).
    two_corner = {"roof_facets": [{"facet_id": "x", "polygon_pixels": [[1, 1], [2, 2]], "edge_types": ["eave", "rake"]}]}
    assert render_roof_footprint(two_corner) is None


def test_partial_edge_types_degrade_to_neutral():
    """A facet with polygons but missing/partial edge_types still renders (neutral edges)."""
    payload = {
        "roof_facets": [
            {
                "facet_id": "F1",
                "polygon_pixels": [[200, 200], [800, 200], [500, 500]],
                "edge_types": ["eave"],  # only 1 of 3 edges classified
            }
        ]
    }
    svg = render_roof_footprint(payload)
    assert svg is not None, "missing edge_types must not suppress the footprint"
    assert svg.count('roof-edge--') == 3, "all 3 edges of the triangle render"
    # Edge 0 is the classified eave; edges 1 & 2 fall back to 'unknown' (neutral).
    assert 'roof-edge--eave' in svg
    assert 'roof-edge--unknown' in svg


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
