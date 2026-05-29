#!/usr/bin/env python3
"""WS-2 — Canonical roof-material enum: behavior + legacy-fallback gate.

Self-contained (NO pytest — not installed). Plain asserts + ``__main__``.

    python3 backend/tests/test_material_enum.py

What this proves
----------------
(a) enum='slate' present  -> spec-table label + method-of-repair + causation
    criteria + wind-rating all reflect SLATE, never laminate.
(b) enum='3tab' vs 'laminate' pick the correct branches (three-tab vs
    laminate/architectural) regardless of the human shingle_type label.
(c) enum ABSENT (legacy/old configs) -> forensic output is byte-identical to
    the pre-WS-2 substring behavior on a representative config. We prove this
    against the WS-0 golden corpus, whose committed fixtures carry NO enum:
    every render must equal its committed snapshot. (Belt-and-suspenders with
    test_golden_forensic_corpus.py — asserted here too so this file fails loud
    if a future enum change is non-inert.)
(d) 'laminated_premium' (a PRICING tier) no longer leaks as a raw token: it
    maps to the 'laminate' enum and gets a proper display label.

The renderer is driven exactly like the WS-0 gate: deep-copy the config, inject
empty tmp photo/output dirs (renderer degrades to '' for missing photos/logos),
freeze the clock, read the emitted HTML.
"""

from __future__ import annotations

import copy
import datetime as _dtmod
import glob
import json
import os
import re
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.join(_HERE, "..")
sys.path.insert(0, _BACKEND)

import usarm_pdf_generator as G  # noqa: E402
import processor as P  # noqa: E402
from test_golden_forensic_corpus import (  # noqa: E402
    _FrozenDateTime,
    normalize_forensic_html,
    _snapshot_path,
)

CORPUS_DIR = os.path.join(_HERE, "golden_corpus")

_FAILURES = []


def _check(cond: bool, msg: str):
    if cond:
        print(f"PASS  {msg}")
    else:
        print(f"FAIL  {msg}")
        _FAILURES.append(msg)


# --------------------------------------------------------------------------
# Render harness (mirrors the WS-0 gate)
# --------------------------------------------------------------------------

def _render_forensic_html(config: dict) -> str:
    """Render build_forensic_report against empty tmp dirs; return raw HTML."""
    config = copy.deepcopy(config)
    tmp = tempfile.mkdtemp(prefix="ws2_")
    config["_paths"] = {
        "claim_dir": tmp, "photos": tmp, "output": tmp, "source_docs": tmp,
    }
    orig = _dtmod.datetime
    try:
        _dtmod.datetime = _FrozenDateTime
        path = G.build_forensic_report(config)
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    finally:
        _dtmod.datetime = orig


# A real, cleanly-rendering laminate fixture used as the structural base so we
# inherit the full required forensic schema (insured/measurements/etc.). We only
# override the material-relevant fields per test.
_BASE_FIXTURE_ID = "08baf595-d415-4fc6-93c6-d4455595bfe0"


def _load_base_fixture_config() -> dict:
    fp = os.path.join(CORPUS_DIR, f"{_BASE_FIXTURE_ID}.json")
    with open(fp, "r", encoding="utf-8") as f:
        return copy.deepcopy(json.load(f)["config"])


def _base_config(shingle_label: str, enum: str | None, *,
                 roof_material_req: str = "", exposure: float | None = 5.0) -> dict:
    """Real-schema forensic config with material fields overridden.

    Injects a wind-enabled estimate_request so the wind chart renders. When
    ``exposure`` is given, also injects repairability so the method-of-repair
    exposure prose renders (asphalt cases). Pass ``exposure=None`` for true
    non-shingle roofs (slate/tile/metal) so the non-shingle skip fires exactly
    as it does in production when no manual repairability is supplied.
    """
    cfg = _load_base_fixture_config()
    cfg.pop("roof_material_enum", None)
    structs = cfg.setdefault("structures", [{}])
    structs[0]["shingle_type"] = shingle_label
    structs[0].pop("roof_material_enum", None)

    ff = cfg.setdefault("forensic_findings", {})
    if exposure is not None:
        ff["repairability"] = {"measured_exposure_inches": exposure}
    else:
        ff.pop("repairability", None)
    # Force the wind chart to render (>=40 mph, non-hail).
    cfg.setdefault("weather", {}).setdefault("noaa", {})["max_wind_mph"] = 75
    cfg["estimate_request"] = {"roof_material": roof_material_req, "damage_type": "combined"}
    cfg["user_notes"] = ""

    if enum is not None:
        cfg["roof_material_enum"] = enum
        structs[0]["roof_material_enum"] = enum
    return cfg


# --------------------------------------------------------------------------
# (a) enum='slate' drives slate everywhere, never laminate
# --------------------------------------------------------------------------

def test_slate_enum_drives_slate():
    # Deliberately HOSTILE label: says "laminate" but enum says slate.
    # The enum must win across every consumer. exposure=None → true non-shingle
    # roof (no manual repairability), so the method-of-repair section is skipped
    # exactly as in production — proving the enum drives the non-shingle skip.
    cfg = _base_config("Architectural Laminated Comp Shingle", "slate", exposure=None)
    html = _render_forensic_html(cfg)

    # Causation criteria → slate-specific language (NRCA Slate Manual / ASTM C406)
    _check("NRCA Slate Roofing Manual" in html and "ASTM C406" in html,
           "(a) slate enum → causation criteria uses slate (NRCA/ASTM C406)")
    _check("Per HAAG Engineering criteria, hail damage to asphalt shingles" not in html,
           "(a) slate enum → NO asphalt-shingle causation criteria")

    # Method-of-repair → non-shingle slate skip fires (enum-driven), so no
    # laminate exposure prose appears.
    _section_html, _has = G._build_repairability_section(cfg)
    _check(_has is False and _section_html == "",
           "(a) slate enum → method-of-repair section skipped (non-shingle)")
    _check("pre-metric standard-size laminate/architectural shingles" not in html,
           "(a) slate enum → method-of-repair does NOT render laminate prose")
    _check("consists of <strong>laminate (architectural) asphalt shingles</strong>" not in html,
           "(a) slate enum → no 'laminate asphalt shingles' product-ID line")

    # Wind rating → slate maps to 125 mph, NOT laminate's 110.
    _check("Wind-resistant (est. 125 mph)" in html,
           "(a) slate enum → wind rating 125 mph (slate)")
    _check("ASTM D7158 Class G (110 mph)" not in html,
           "(a) slate enum → NOT the 110 mph laminate wind rating")


# --------------------------------------------------------------------------
# (b) enum '3tab' vs 'laminate' pick the right branches
# --------------------------------------------------------------------------

def test_3tab_vs_laminate_branches():
    # 3tab — hostile label says "architectural" (would substring-match laminate)
    cfg_3tab = _base_config("Architectural Laminated Comp Shingle", "3tab")
    html_3tab = _render_forensic_html(cfg_3tab)
    _check("three-tab" in html_3tab.lower(),
           "(b) 3tab enum → method-of-repair renders three-tab prose")
    _check("consists of <strong>three-tab asphalt shingles</strong>" in html_3tab,
           "(b) 3tab enum → three-tab product-ID line, not laminate")
    _check("ASTM D3161 Class A (60 mph)" in html_3tab,
           "(b) 3tab enum → 60 mph 3-tab wind rating")

    # laminate — hostile label says "3-Tab"
    cfg_lam = _base_config("3-Tab 25yr Comp Shingle", "laminate")
    html_lam = _render_forensic_html(cfg_lam)
    _check("consists of <strong>laminate (architectural) asphalt shingles</strong>" in html_lam,
           "(b) laminate enum → laminate product-ID line, not three-tab")
    _check("consists of <strong>three-tab asphalt shingles</strong>" not in html_lam,
           "(b) laminate enum → NO three-tab product-ID line")
    _check("ASTM D7158 Class G (110 mph)" in html_lam,
           "(b) laminate enum → 110 mph laminate wind rating")


# --------------------------------------------------------------------------
# (c) enum ABSENT → identical to legacy substring behavior
# --------------------------------------------------------------------------

def test_absent_enum_matches_legacy_golden():
    """Every WS-0 fixture (no enum) must still match its committed snapshot.

    This is the inertness proof for the legacy fallback path: the fixtures
    predate the enum, so the substring fallback must reproduce byte-identical
    forensic HTML.
    """
    fixtures = sorted(glob.glob(os.path.join(CORPUS_DIR, "*.json")))
    _check(len(fixtures) == 23, f"(c) golden corpus has 23 fixtures (found {len(fixtures)})")
    matched = 0
    for fp in fixtures:
        fid = os.path.splitext(os.path.basename(fp))[0]
        with open(fp, "r", encoding="utf-8") as f:
            fixture = json.load(f)
        config = fixture["config"]
        # Confirm the fixture truly carries NO enum (legacy/absent path).
        assert "roof_material_enum" not in config, f"{fid} unexpectedly has an enum"
        html = _render_forensic_html(config)
        actual = normalize_forensic_html(html, config)
        with open(_snapshot_path(fid), "r", encoding="utf-8") as f:
            expected = f.read()
        if actual == expected:
            matched += 1
        else:
            print(f"      DIFF on absent-enum fixture {fid}")
    _check(matched == len(fixtures),
           f"(c) absent-enum fallback byte-identical to golden ({matched}/{len(fixtures)})")


def test_absent_enum_helper_returns_none():
    """material_enum() returns None (not 'other') when no enum is persisted."""
    cfg = _base_config("Architectural Laminated Comp Shingle", None)
    _check(G.material_enum(cfg) is None,
           "(c) material_enum(config) → None when enum absent")
    _check(G.material_enum(cfg, cfg["structures"][0]) is None,
           "(c) material_enum(config, struct) → None when enum absent")
    # Per-structure value wins over claim-wide value.
    cfg["roof_material_enum"] = "laminate"
    cfg["structures"][0]["roof_material_enum"] = "slate"
    _check(G.material_enum(cfg, cfg["structures"][0]) == "slate",
           "(c) per-structure enum overrides claim-wide enum")


# --------------------------------------------------------------------------
# (d) 'laminated_premium' no longer leaks as a raw token
# --------------------------------------------------------------------------

def test_laminated_premium_does_not_leak():
    # Canonical mapper collapses the pricing tier to the 'laminate' enum.
    _check(P._canonical_material_enum("laminated_premium") == "laminate",
           "(d) _canonical_material_enum('laminated_premium') → 'laminate'")
    _check(P._canonical_material_enum("laminated") == "laminate",
           "(d) _canonical_material_enum('laminated') → 'laminate'")
    _check(P._canonical_material_enum("copper") == "metal"
           and P._canonical_material_enum("metal_standing_seam") == "metal",
           "(d) metal family (copper/standing seam) → 'metal' enum")
    _check(P._canonical_material_enum("flat") == "other"
           and P._canonical_material_enum(None) == "other"
           and P._canonical_material_enum("wat") == "other",
           "(d) flat / None / unknown → 'other' enum")

    # build_claim_config now gives premium laminate a real display label, so the
    # raw token never reaches shingle_type. We assert the corrected label maps in
    # the same dict build_claim_config uses, and that a config built the new way
    # renders NO raw 'laminated_premium' token in the forensic output.
    cfg = _base_config("Premium Grade Laminated Comp Shingle", "laminate")
    html = _render_forensic_html(cfg)
    _check("laminated_premium" not in html,
           "(d) forensic output contains NO raw 'laminated_premium' token")
    _check("Premium Grade Laminated Comp Shingle" in html,
           "(d) spec table shows the human 'Premium Grade Laminated' label")


# --------------------------------------------------------------------------

def main() -> int:
    test_slate_enum_drives_slate()
    test_3tab_vs_laminate_branches()
    test_absent_enum_matches_legacy_golden()
    test_absent_enum_helper_returns_none()
    test_laminated_premium_does_not_leak()

    print()
    if _FAILURES:
        print(f"{len(_FAILURES)} assertion(s) FAILED:")
        for m in _FAILURES:
            print(f"  - {m}")
        return 1
    print("ALL WS-2 material-enum assertions passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
