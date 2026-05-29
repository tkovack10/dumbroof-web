#!/usr/bin/env python3
"""WS-4 — unit tests for the wind-amplification chart math (E270 fix).

The wind chart in usarm_pdf_generator._build_wind_amplification_chart used to
treat ASCE 7 roof-zone PRESSURE coefficients {1.35, 1.6, 2.0} as VELOCITY
multipliers and applied a redundant ×1.3 gust factor, yielding physically
impossible 174-250 mph "wind speeds". The fix:

  * base gust = NOAA max_wind_mph as-is (NOAA/SPC report peak gust; ASCE 7's
    basic wind speed is itself a 3-sec gust — no second sustained→gust factor),
  * equivalent zone velocity = base_gust * sqrt(pressure_ratio),
  * displayed velocities are capped at a physically defensible bound,
  * "EXCEEDS shingle rating" fires ONLY when the corrected zone velocity
    actually exceeds the ASTM rating.

Also covers the SEPARATE hail-aging-chart guard: "EXCEEDS THRESHOLD" must never
render on a non-positive / garbage confirmed-hail value.

Self-contained — NO pytest. Plain asserts + __main__.
    python3 backend/tests/test_wind_amplification_math.py
"""

from __future__ import annotations

import math
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import usarm_pdf_generator as G  # noqa: E402

# Must match the cap inside _build_wind_amplification_chart.
VELOCITY_CAP_MPH = 200


def _wind_html(max_wind, material="laminate", damage_type="wind"):
    cfg = {
        "weather": {"noaa": {"max_wind_mph": max_wind}},
        "estimate_request": {"roof_material": material, "damage_type": damage_type},
        "structures": [{}],
    }
    return G._build_wind_amplification_chart(cfg)


def _bar_velocities(html):
    """Every '<NN> mph' value rendered in a bar-value cell, in row order."""
    return [int(m.group(1)) for m in re.finditer(r'bar-value[^>]*>([0-9]+) mph', html)]


# -------------------------------------------------------------------------
# sqrt(pressure ratio) is applied — NOT the raw pressure ratio
# -------------------------------------------------------------------------

def test_zone_velocities_use_sqrt_of_pressure_ratio():
    base = 96
    html = _wind_html(base)
    vals = _bar_velocities(html)
    # Rows: [base gust, Zone1(1.35), Zone2(1.6), Zone3(2.0)]
    assert vals[0] == base, vals
    assert vals[1] == round(base * math.sqrt(1.35)), vals   # ~112
    assert vals[2] == round(base * math.sqrt(1.6)), vals    # ~121
    assert vals[3] == round(base * math.sqrt(2.0)), vals    # ~136
    # The OLD bug would have produced 96*1.3*2.0 = 250 for the corner.
    assert vals[3] != round(base * 1.3 * 2.0), "still multiplying velocity by pressure ratio"
    assert vals[3] < 140, "Zone 3 corner velocity is not physically defensible"


def test_no_redundant_gust_factor():
    # base gust row equals the NOAA value exactly (no extra ×1.3).
    for w in (50, 72, 96, 102):
        assert _bar_velocities(_wind_html(w))[0] == w


# -------------------------------------------------------------------------
# Cap — no displayed velocity exceeds the physical bound
# -------------------------------------------------------------------------

def test_velocity_cap_enforced_on_absurd_input():
    html = _wind_html(300)
    vals = _bar_velocities(html)
    assert max(vals) <= VELOCITY_CAP_MPH, vals
    # the cap is actually exercised here (300*sqrt(2) ~ 424 would blow past it)
    assert VELOCITY_CAP_MPH in vals, vals


def test_no_velocity_exceeds_cap_across_range():
    for w in range(40, 260, 7):
        for vel in _bar_velocities(_wind_html(w)):
            assert vel <= VELOCITY_CAP_MPH, (w, vel)


# -------------------------------------------------------------------------
# EXCEEDS fires ONLY when the corrected zone velocity truly exceeds the rating
# -------------------------------------------------------------------------

def test_no_exceeds_when_below_rating():
    # 50 mph gust on a 110-mph laminate: even Zone 3 (~71) is well below rating.
    html = _wind_html(50, material="laminate")
    assert "EXCEEDS shingle rating" not in html
    assert "All zones below shingle rating" in html


def test_exceeds_only_when_corrected_velocity_beats_rating():
    # 96 mph gust on a 110-mph laminate: Zone 3 ~136 EXCEEDS, base/zone1 don't.
    html = _wind_html(96, material="laminate")
    assert "Zone 3 (corners): 136 mph &mdash; EXCEEDS shingle rating by 26 mph" in html
    # The corrected math must NOT claim the impossible old delta (250-110=140).
    assert "by 140 mph" not in html


def test_three_tab_low_rating_exceeds_is_real():
    # 3-tab rating is 60 mph; an 96 mph gust legitimately exceeds even the field zone.
    html = _wind_html(96, material="3-tab")
    vals = _bar_velocities(html)
    # every zone velocity that the summary calls EXCEEDS must actually be > 60
    for m in re.finditer(r'Zone [23] \([a-z]+\): (\d+) mph &mdash; EXCEEDS', html):
        assert int(m.group(1)) > 60, html


def test_hail_only_claim_skips_wind_chart():
    assert _wind_html(96, damage_type="hail") == ""


def test_low_wind_skips_chart():
    assert _wind_html(35) == ""


# -------------------------------------------------------------------------
# Aging-chart EXCEEDS guard — non-positive / garbage confirmed-hail
# -------------------------------------------------------------------------

def _aging_html(confirmed):
    cfg = {
        "structures": [{"age": 10}],
        "weather": {"noaa": {}, "damage_thresholds": [{"confirmed_size": confirmed}]},
        "scoring": {},
    }
    return G._build_threshold_aging_chart(cfg)


def test_aging_chart_no_exceeds_on_zero_hail():
    html = _aging_html('0"')
    assert "EXCEEDS THRESHOLD" not in html
    assert html == ""  # chart suppressed entirely on non-positive hail


def test_aging_chart_no_crash_on_garbage_dot():
    # a bare "." used to crash float(); now it is ignored and the chart suppressed.
    html = _aging_html(".")
    assert html == ""
    assert "EXCEEDS THRESHOLD" not in html


def test_aging_chart_exceeds_on_real_hail():
    html = _aging_html('1.5"')
    assert "EXCEEDS THRESHOLD" in html


# -------------------------------------------------------------------------

def _run():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failures = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL {fn.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f"ERROR {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(fns) - failures}/{len(fns)} wind-math tests passed.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(_run())
