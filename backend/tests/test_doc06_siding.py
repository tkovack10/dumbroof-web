"""WS-7 — Doc 06 SIDING gate (PHASE 1: build the net FIRST).

This is the SIDING-specific gate that every later WS-7 commit (the SIDING MODULE
phase that renders the corner-rule argument hierarchy) must keep green. It locks
down the *current* behavior of the priced code-compliance supplement on a
realistic NY-market siding claim so a regression in any later phase is caught.

Fixture: tests/fixtures/siding_claim_ny.json — a two-story NY (Tonawanda) vinyl-
siding claim with:
  * forensic_findings showing storm SIDING damage on all four elevations,
  * the FULL siding scope as code-cited line_items (R&R vinyl siding, house wrap /
    SDG WRAP, fanfold, outside corner posts, wall flashing) — each priced at the
    NY native rate from pricing/nybi26.json and read OFF the frozen line item
    (B.7 — Doc 06 never re-resolves a price),
  * walls.elevations[] for Front/Right/Left/Rear,
  * carrier_line_items that approve siding on ONLY the Front + Right elevations
    and mark house wrap / fanfold / corner posts / wall flashing 'missing' — so
    the carrier-OMITTED cross-reference has real omissions to render.

NY is the deliberate choice: house_wrap PRICES NATIVELY there ($0.64/SF, the
Xactimate SDG WRAP rate), so the WS-7 CODE_SUPPLEMENT_FALLBACK_PRICED flag
correctly stays SILENT (it only fires in non-NY/PA/NJ markets lacking a native
house_wrap rate — queue the Alfonso SDG WRAP export for those as a follow-up;
NOT built here).

What this gate asserts TODAY (kept structural so the SIDING MODULE phase extends,
not rewrites, these):
  1. The siding fixture renders a PRICED Doc-06 with siding rows + the house_wrap
     row carrying the canonical R703.2 citation (the corner-rule anchor).
  2. SUBSET INVARIANT: supplement subtotal == the SAME siding line_items summed
     the way Doc 02 sums them — never additive.
  3. Carrier-OMITTED marking is present for the omitted siding code items
     (house wrap / fanfold / corner posts / wall flashing), and the matched
     siding R&R row is marked Included (Front + Right approved).
  4. The doctrine citations (R703.1 corner / R703.2 WRB / R703.3 siding /
     R703.4 flashing) are exactly the codebase-canonical sections — no invented
     citation collides with an existing one.
  5. UPPA gating hook: the fixture is compliance.user_role='contractor' and a
     deepcopy can be flipped to 'public_adjuster' (the PA/attorney advocacy path
     the SIDING MODULE phase will branch on) and still renders.
  6. WS-0 golden corpus stays 23/23 (Doc 06 is not in it).

Self-contained: plain stdlib unittest, no pytest dependency.
    python3 backend/tests/test_doc06_siding.py
"""
import copy
import json
import os
import sys
import tempfile
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
sys.path.insert(0, _BACKEND)

import compliance_report as CR
from usarm_pdf_generator import _is_initial_scope

_FIXTURE = os.path.join(_HERE, "fixtures", "siding_claim_ny.json")

# Canonical siding-doctrine citations, verified against backend/code_compliance.py
# + backend/compliance_svg.py CODE_TO_ZONE + building_codes/state_codes.json. These
# are the codebase's existing sections — the SIDING MODULE phase must not invent a
# colliding one (cf. the R905.2.2 climate-gate collision lesson).
SIDING_SECTIONS = {
    "R703.1": "Continuous weather-resistant wall envelope (corner rule)",
    "R703.2": "Water-resistive barrier / house wrap (wraps outside corners)",
    "R703.3": "Exterior wall covering / siding installation",
    "R703.4": "Wall flashing at openings & penetrations",
}

# The siding code items the carrier OMITTED on this fixture (carrier status
# 'missing'). Used to assert the OMITTED cross-reference has real omissions.
OMITTED_SIDING_DESCS = {
    "house wrap",
    "fanfold",
    "outside corner post",
    "wall flashing",
}


def _load_cfg():
    with open(_FIXTURE) as f:
        cfg = json.load(f)["config"]
    cfg.setdefault("_paths", {})["output"] = tempfile.mkdtemp()
    return cfg


class TestSidingFixtureShape(unittest.TestCase):
    """Guardrails on the fixture itself so later phases can trust its shape."""

    def setUp(self):
        self.cfg = _load_cfg()

    def test_is_ny_market(self):
        self.assertEqual(self.cfg["property"]["state"], "NY")

    def test_contractor_role_default(self):
        # USARM default — UPPA-safe baseline (factual code language, no advocacy).
        self.assertEqual(self.cfg["compliance"]["user_role"], "contractor")

    def test_walls_has_four_elevations(self):
        elevs = self.cfg["walls"]["elevations"]
        names = {e["name"] for e in elevs}
        self.assertEqual(names, {"Front", "Right", "Left", "Rear"})
        # Every elevation is storm-damaged (the covered peril anchor).
        self.assertTrue(all(e.get("siding_damaged") for e in elevs))

    def test_forensic_shows_siding_damage(self):
        ff = self.cfg["forensic_findings"]
        self.assertIn("siding", (ff.get("damage_summary") or "").lower())
        self.assertIn("siding", (ff.get("executive_summary") or "").lower())

    def test_full_siding_scope_present_as_code_items(self):
        # R&R siding, house wrap, fanfold, corner post, wall flashing — each an
        # INITIAL, code-cited, qty>0 line item.
        code_items = CR._code_line_items(self.cfg)
        descs = " | ".join(li["description"].lower() for li in code_items)
        for needle in ("siding - vinyl", "house wrap", "fanfold",
                       "outside corner post", "wall flashing"):
            self.assertIn(needle, descs, f"siding scope missing {needle!r}")
        for li in code_items:
            self.assertTrue(_is_initial_scope(li))
            self.assertGreater(float(li.get("qty", 0) or 0), 0)
            self.assertTrue(li.get("code_citation"))

    def test_carrier_scope_partial_siding(self):
        # Carrier approved siding on Front + Right only (status 'under'); the rest
        # of the siding scope is 'missing' → real omissions to mark.
        rows = self.cfg["carrier"]["carrier_line_items"]
        present = [r for r in rows if (r.get("status") or "").lower() in ("under", "over", "match")]
        missing = [r for r in rows if (r.get("status") or "").lower() == "missing"]
        self.assertGreaterEqual(len(present), 2)   # Front + Right siding
        self.assertGreaterEqual(len(missing), 4)   # wrap + fanfold + corner + flashing


class TestSidingPricedRender(unittest.TestCase):
    """The siding fixture renders a PRICED Doc-06 with siding rows + R703.2."""

    def setUp(self):
        self.cfg = _load_cfg()
        self.sup = CR.build_priced_supplement(self.cfg)
        self.html = self.sup["html"]

    def test_gating_is_priced(self):
        # A siding-only claim legitimately has NO roof measurements; the carrier
        # scope drives priced mode (the realistic siding path).
        self.assertFalse(CR.has_measurements(self.cfg))
        self.assertTrue(CR.carrier_scope_present(self.cfg))

    def test_renders_priced_table_with_siding_rows(self):
        self.assertIn("supplement-table", self.html)
        self.assertIn("Unit Price", self.html)
        self.assertIn("Line Total", self.html)
        self.assertEqual(self.sup["row_count"], 5)
        self.assertGreater(self.sup["subtotal"], 0)

    def test_house_wrap_row_carries_r703_2(self):
        # The corner-rule anchor: the house_wrap line item must surface its
        # canonical R703.2 citation in the rendered supplement.
        self.assertIn("R703.2", self.html)
        self.assertIn("RCNYS R703.2", self.html)
        # And the house_wrap line item itself is the one carrying it.
        wrap = next(li for li in CR._code_line_items(self.cfg)
                    if "house wrap" in li["description"].lower())
        self.assertEqual(wrap["code_citation"]["section"], "R703.2")

    def test_all_doctrine_citations_present_and_canonical(self):
        # Every doctrine section appears in the rendered supplement AND matches the
        # codebase-canonical CODE_TO_ZONE entry (no invented/colliding citation).
        from compliance_svg import CODE_TO_ZONE
        cited = {(li.get("code_citation") or {}).get("section")
                 for li in CR._code_line_items(self.cfg)}
        for section in SIDING_SECTIONS:
            self.assertIn(section, cited, f"{section} not cited on a siding line item")
            self.assertIn(section, CODE_TO_ZONE,
                          f"{section} is not a codebase-canonical siding citation")
            self.assertIn(section, self.html)

    def test_ahj_header_is_new_york(self):
        ahj = CR._ahj_header(self.cfg)
        self.assertIn('data-ahj="true"', self.html)
        self.assertEqual(ahj["prefix"], "RCNYS")
        self.assertIn(ahj["base_code"], self.html)          # IRC 2018
        self.assertIn(ahj["jurisdiction"], self.html)       # Residential Code of New York State

    def test_non_additive_marker(self):
        self.assertTrue(self.sup["is_attribution_view"])
        self.assertIn('data-attribution-view="true"', self.html)
        self.assertIn("already included in the Xactimate estimate", self.html)


class TestSidingSubsetInvariant(unittest.TestCase):
    """The keystone: supplement subtotal == the SAME siding line_items summed the
    way Doc 02 sums them. NEVER additive."""

    def setUp(self):
        self.cfg = _load_cfg()

    def test_subtotal_equals_doc02_siding_subset(self):
        sup = CR.build_priced_supplement(self.cfg)
        code_items = CR._code_line_items(self.cfg)
        doc02_subset = round(
            sum(round(float(li["qty"]) * float(li["unit_price"]), 2) for li in code_items), 2
        )
        self.assertAlmostEqual(sup["subtotal"], doc02_subset, places=2)

    def test_every_supplement_item_is_initial_and_code_cited(self):
        for li in CR._code_line_items(self.cfg):
            self.assertTrue(_is_initial_scope(li))
            self.assertTrue(li.get("code_citation"))
            self.assertGreater(float(li.get("qty", 0) or 0), 0)

    def test_unit_prices_read_off_frozen_line_items(self):
        # B.7 — Doc 06 reads the price OFF the line item; it must equal the NY
        # native rate already on the frozen item (no re-resolution).
        by_desc = {li["description"].lower(): li for li in CR._code_line_items(self.cfg)}
        wrap = next(li for k, li in by_desc.items() if "house wrap" in k)
        self.assertAlmostEqual(float(wrap["unit_price"]), 0.64, places=2)  # nybi26 house_wrap
        self.assertEqual(wrap.get("_price_source"), "relational")          # NY native, not a fallback


class TestSidingCarrierOmissions(unittest.TestCase):
    """Carrier-OMITTED marking has real omissions to show (the supplement gap)."""

    def setUp(self):
        self.cfg = _load_cfg()
        self.sup = CR.build_priced_supplement(self.cfg)
        self.smap = CR._carrier_status_map(self.cfg)

    def test_omitted_marking_present(self):
        self.assertIn("Carrier Scope", self.sup["html"])
        self.assertIn("OMITTED", self.sup["html"])
        self.assertGreater(self.sup["omitted_count"], 0)

    def test_the_omitted_siding_items_are_marked_omitted(self):
        # House wrap, fanfold, corner posts, wall flashing — all carrier 'missing'
        # → must resolve OMITTED (the carrier left out exactly the corner-rule
        # code items the doctrine forces back in).
        for needle in OMITTED_SIDING_DESCS:
            matches = {k: v for k, v in self.smap.items() if needle in k}
            self.assertTrue(matches, f"no status-map entry for {needle!r}")
            for k, v in matches.items():
                self.assertEqual(v, "omitted", f"{k!r} should be OMITTED, got {v}")

    def test_approved_siding_rr_is_included(self):
        # The siding R&R line matches the present Front/Right carrier rows → Included.
        rr = next(k for k in self.smap if "siding - vinyl" in k)
        self.assertEqual(self.smap[rr], "included")
        self.assertIn("Included", self.sup["html"])

    def test_omitted_count_matches_rendered_cells(self):
        # Structural: counted omissions == rendered OMITTED cells == the 4 missing
        # siding code items. (Kept as an exact count so a later phase that adds a
        # siding row must consciously update it.)
        self.assertEqual(self.sup["omitted_count"], 4)
        self.assertEqual(self.sup["html"].count('class="carrier-omitted">OMITTED'), 4)
        self.assertEqual(self.sup["html"].count('class="carrier-included">Included'), 1)


class TestSidingUppaGating(unittest.TestCase):
    """UPPA hook — the SIDING MODULE phase branches advocacy language on
    compliance.user_role. This phase locks the flip point + that both modes
    render; the wording assertions land in the SIDING MODULE phase."""

    def test_contractor_baseline_renders(self):
        cfg = _load_cfg()
        self.assertEqual(cfg["compliance"]["user_role"], "contractor")
        sup = CR.build_priced_supplement(cfg)
        self.assertGreater(sup["subtotal"], 0)

    def test_public_adjuster_flip_renders_same_subset(self):
        base = _load_cfg()
        pa = copy.deepcopy(base)
        pa["compliance"]["user_role"] = "public_adjuster"
        sup_c = CR.build_priced_supplement(base)
        sup_pa = CR.build_priced_supplement(pa)
        # Same priced subset today (no advocacy branch yet); the SIDING MODULE
        # phase adds the role-gated narrative WITHOUT moving the dollar subset.
        self.assertEqual(pa["compliance"]["user_role"], "public_adjuster")
        self.assertAlmostEqual(sup_c["subtotal"], sup_pa["subtotal"], places=2)


class TestSidingFallbackFlagSilentInNY(unittest.TestCase):
    """NY house_wrap prices natively → CODE_SUPPLEMENT_FALLBACK_PRICED stays
    SILENT. (The flag fires in non-NY/PA/NJ markets lacking a native rate — the
    Alfonso SDG WRAP export follow-up; NOT exercised here.)"""

    def test_flag_silent_for_native_ny_pricing(self):
        from qa_auditor import compute_code_supplement_pricing_flags
        cfg = _load_cfg()
        # Every siding code item is stamped _price_source='relational' (NY native).
        flags = compute_code_supplement_pricing_flags(cfg, {})
        self.assertEqual(flags, [], "NY native siding pricing must not raise the fallback flag")


# ── PHASE 3 — THE SIDING ARGUMENT (corner-rule flagship) ──
#
# These tests lock the role- and state-gated siding argument block: the invariant
# argument ORDER (damage first), the contractor/PA advocacy-verb gate, the
# NY-vs-statute-state matching framing, wall-flashing emission, and the
# default-full-siding-on-damage processor trigger. They EXTEND the Phase 1/2 gate.

# Carrier-directed advocacy / demand / indemnification-as-obligation framing that
# is UPPA-prohibited for a contractor (CLAUDE.md) — must be ABSENT in contractor
# mode and is what PA/attorney mode adds. NOT a ban on factual code-requirement
# language ("the code requires a WRB"), which contractor mode legitimately uses.
_ADVOCACY_MARKERS = (
    "demand",
    "on behalf of",
    "does not satisfy",
    "making the insured whole",
    "opposite of indemnity",
    "carrier-created diminished value",
)


class TestSidingArgumentOrder(unittest.TestCase):
    """The argument ORDER is load-bearing: DAMAGE (1) → CODE (2) → APPEARANCE (3)
    → DIMINISHED VALUE (4). Damage is ALWAYS first; code never leads."""

    def setUp(self):
        self.cfg = _load_cfg()
        self.arg = CR.build_priced_supplement(self.cfg)["siding_argument"]

    def test_argument_is_rendered_for_siding_claim(self):
        self.assertTrue(self.arg)
        self.assertIn('data-siding-argument="true"', self.arg)

    def test_layer_order_damage_first_then_code_appearance_dv(self):
        import re
        order = re.findall(r'data-arg-layer="(\w+)"', self.arg)
        self.assertEqual(order, ["damage", "code", "appearance", "diminished_value"])

    def test_damage_layer_leads_and_anchors_on_forensic_finding(self):
        # The #1 layer is the covered peril and quotes the forensic siding damage —
        # it must NOT lead with a code citation. Isolate the damage layer by slicing
        # from its marker to the start of the NEXT layer (the code layer).
        damage_start = self.arg.index('data-arg-layer="damage"')
        code_start = self.arg.index('data-arg-layer="code"')
        damage_block = self.arg[damage_start:code_start]
        self.assertIn("damage", damage_block.lower())
        self.assertNotIn("R703", damage_block)  # damage layer never leads with code
        # And damage precedes code in the document.
        self.assertLess(damage_start, code_start)

    def test_corner_rule_is_the_hero_in_the_code_layer(self):
        self.assertIn("siding-corner-hero", self.arg)
        self.assertIn("wrap", self.arg.lower())
        self.assertIn("corner", self.arg.lower())
        # Hero carries the canonical corner sections.
        self.assertIn("R703.1", self.arg)
        self.assertIn("R703.2", self.arg)

    def test_no_siding_argument_on_roofing_only_claim(self):
        # A config with only ROOFING code items renders NO siding argument.
        roof_only = copy.deepcopy(self.cfg)
        roof_only["line_items"] = [{
            "category": "ROOFING", "trade": "ROOFING",
            "description": "Laminated comp shingle roofing", "qty": 30.0, "unit": "SQ",
            "unit_price": 285.27, "scope_timing": "initial",
            "code_citation": {"section": "R905.1", "code_tag": "RCNYS R905.1",
                              "requirement": "roof covering", "title": "roof"},
        }]
        self.assertEqual(CR._build_siding_argument(roof_only), "")
        self.assertFalse(CR.build_priced_supplement(roof_only)["has_siding_argument"])


class TestSidingArgumentUppaGate(unittest.TestCase):
    """Contractor mode = factual code statements, NO carrier-directed advocacy/
    demand verbs. PA/attorney mode = full advocacy. Driven by compliance.user_role."""

    def test_contractor_has_no_advocacy_verbs(self):
        cfg = _load_cfg()
        self.assertEqual(cfg["compliance"]["user_role"], "contractor")
        arg = CR.build_priced_supplement(cfg)["siding_argument"].lower()
        self.assertIn('data-can-advocate="false"', CR.build_priced_supplement(cfg)["siding_argument"])
        for marker in _ADVOCACY_MARKERS:
            self.assertNotIn(marker, arg, f"contractor mode must not contain advocacy marker {marker!r}")

    def test_public_adjuster_has_advocacy_verbs(self):
        base = _load_cfg()
        pa = copy.deepcopy(base)
        pa["compliance"]["user_role"] = "public_adjuster"
        arg = CR.build_priced_supplement(pa)["siding_argument"]
        self.assertIn('data-can-advocate="true"', arg)
        low = arg.lower()
        # PA mode adds the indemnification-as-obligation framing the contractor lacks.
        self.assertTrue(
            any(m in low for m in ("does not satisfy", "making the insured whole",
                                   "opposite of indemnity")),
            "PA mode must carry advocacy framing",
        )

    def test_attorney_can_advocate(self):
        base = _load_cfg()
        atty = copy.deepcopy(base)
        atty["compliance"]["user_role"] = "attorney"
        self.assertTrue(CR._can_advocate(atty))
        self.assertFalse(CR._can_advocate(base))  # contractor cannot

    def test_contractor_and_pa_render_identical_priced_subset(self):
        # The advocacy branch moves PROSE only — never the dollar subset.
        base = _load_cfg()
        pa = copy.deepcopy(base)
        pa["compliance"]["user_role"] = "public_adjuster"
        self.assertAlmostEqual(
            CR.build_priced_supplement(base)["subtotal"],
            CR.build_priced_supplement(pa)["subtotal"],
            places=2,
        )


class TestSidingMatchingStateGate(unittest.TestCase):
    """NO-statute states (NY/PA/NJ) frame MDL-902 as INDUSTRY EVIDENCE only;
    matching-statute states (e.g. OH) cite the rule directly. Driven by claim state."""

    def test_ny_is_industry_evidence_only(self):
        cfg = _load_cfg()  # NY
        arg = CR.build_priced_supplement(cfg)["siding_argument"]
        self.assertIn('data-matching-statute="false"', arg)
        low = arg.lower()
        self.assertIn("industry evidence", low)
        self.assertIn("not as an enforceable", low)

    def test_statute_state_cites_the_rule_directly(self):
        cfg = _load_cfg()
        cfg["property"]["state"] = "OH"  # Ohio has a matching regulation
        arg = CR.build_priced_supplement(cfg)["siding_argument"]
        self.assertIn('data-matching-statute="true"', arg)
        low = arg.lower()
        self.assertIn("adopted a matching standard", low)
        self.assertIn("ohio administrative code", low)
        # And NOT framed as mere industry evidence.
        self.assertNotIn("not as an enforceable", low)

    def test_pa_and_nj_are_no_statute_like_ny(self):
        from building_codes import lookup as _bc
        for s in ("NY", "PA", "NJ"):
            self.assertFalse(_bc.has_matching_statute(s), f"{s} must be no-statute")
        for s in ("OH", "CA", "FL", "MN"):
            self.assertTrue(_bc.has_matching_statute(s), f"{s} must be a statute state")


class TestSidingWallFlashingEmitted(unittest.TestCase):
    """CLAUDE.md: siding ALWAYS includes wall flashing (R703.4). The processor's
    siding scope must emit a wall-flashing line with the correct citation."""

    def test_processor_emits_wall_flashing_on_siding_scope(self):
        import processor as P
        meas = {
            "measurements": {"eave": 100, "rake": 80},
            "structures": [{"roof_area_sq": 25, "roof_area_sf": 2500, "facets": 4,
                            "predominant_pitch": "6/12"}],
            "stories": 2,
            "walls": {"total_wall_area_sf": 2280, "window_count": 8, "door_count": 2,
                      "elevations": [{"name": "Front", "openings": 4},
                                     {"name": "Right", "openings": 3},
                                     {"name": "Left", "openings": 3},
                                     {"name": "Rear", "openings": 4}]},
        }
        photo = {"trades_identified": ["roofing", "siding"], "siding_type": "vinyl",
                 "photo_tags": {"p01": {"trade": "siding", "material": "vinyl_siding",
                                        "damage_type": "crack", "severity": "moderate"}}}
        items = P.build_line_items(meas, photo, "NY", user_notes="",
                                   estimate_request=None, market_code="")
        siding = [i for i in items if i.get("category") == "SIDING"]
        wf = [i for i in siding if "wall flashing" in i["description"].lower()]
        hw = [i for i in siding if "house wrap" in i["description"].lower()
              or "tyvek" in i["description"].lower()]
        self.assertTrue(wf, "siding scope must emit a wall-flashing line")
        self.assertTrue(hw, "siding scope must emit a house-wrap line")
        self.assertIn("R703.4", wf[0]["description"])
        self.assertGreater(float(wf[0]["qty"]), 0)
        # NY prices wall flashing natively (seeded) — relational, not fallback.
        self.assertEqual(wf[0].get("_price_source"), "relational")


class TestDefaultFullSidingOnDamage(unittest.TestCase):
    """Phase 3b — a genuine forensic siding-DAMAGE signal + wall measurements
    AUTO-ENABLES the full siding scope WITHOUT the estimate_request opt-in; a
    roofing-only claim is UNAFFECTED."""

    def _meas(self):
        return {
            "measurements": {"eave": 100, "rake": 80},
            "structures": [{"roof_area_sq": 25, "roof_area_sf": 2500, "facets": 4,
                            "predominant_pitch": "6/12"}],
            "stories": 2,
            "walls": {"total_wall_area_sf": 2280, "window_count": 8, "door_count": 2,
                      "elevations": [{"name": "Front", "openings": 4}]},
        }

    def test_signal_detector_fires_on_siding_damage_tag(self):
        import processor as P
        dmg = {"photo_tags": {"p01": {"trade": "siding", "material": "vinyl_siding",
                                      "damage_type": "crack"}}}
        self.assertTrue(P.detect_siding_damage_signal(dmg))

    def test_signal_detector_silent_on_overview_wall_photo(self):
        import processor as P
        # A wall PHOTOGRAPHED for context (overview) is NOT damage.
        overview = {"trades_identified": ["roofing", "siding"],
                    "photo_tags": {"p01": {"trade": "general", "material": "vinyl_siding",
                                           "damage_type": "overview"}}}
        self.assertFalse(P.detect_siding_damage_signal(overview))

    def test_default_on_fires_without_opt_in(self):
        import processor as P
        photo = {"trades_identified": ["roofing", "siding"], "siding_type": "vinyl",
                 "photo_tags": {"p01": {"trade": "siding", "material": "vinyl_siding",
                                        "damage_type": "crack"}}}
        items = P.build_line_items(self._meas(), photo, "NY", user_notes="",
                                   estimate_request=None, market_code="")
        siding = [i for i in items if i.get("category") == "SIDING"]
        self.assertTrue(siding, "siding-damage signal + walls must auto-enable siding")

    def test_roofing_only_claim_gets_no_siding(self):
        import processor as P
        photo = {"trades_identified": ["roofing"],
                 "photo_tags": {"p01": {"trade": "roofing",
                                        "material": "comp_shingle_laminated",
                                        "damage_type": "hail_dent"},
                                "p02": {"trade": "general", "material": "vinyl_siding",
                                        "damage_type": "overview"}}}
        items = P.build_line_items(self._meas(), photo, "NY", user_notes="",
                                   estimate_request={"roof_material": "comp_shingle"},
                                   market_code="")
        siding = [i for i in items if i.get("category") == "SIDING"]
        self.assertEqual(siding, [], "roofing-only claim must get NO siding line items")

    def test_explicit_masonry_opt_out_beats_damage_default(self):
        import processor as P
        photo = {"photo_tags": {"p01": {"trade": "siding", "material": "vinyl_siding",
                                        "damage_type": "crack"}}}
        items = P.build_line_items(self._meas(), photo, "NY", user_notes="",
                                   estimate_request={"siding_type": "brick_veneer"},
                                   market_code="")
        siding = [i for i in items if i.get("category") == "SIDING"]
        self.assertEqual(siding, [], "explicit masonry selection must beat the damage default")


class TestSidingFallbackFlagOtherMarket(unittest.TestCase):
    """CODE_SUPPLEMENT_FALLBACK_PRICED stays SILENT for NY-native house_wrap and
    FIRES for an other-market house_wrap priced from a fallback (the Alfonso SDG
    WRAP export follow-up). Driven by _price_source on the frozen row."""

    def test_ny_native_house_wrap_no_flag(self):
        from qa_auditor import compute_code_supplement_pricing_flags
        cfg = _load_cfg()  # every code row stamped _price_source='relational'
        self.assertEqual(compute_code_supplement_pricing_flags(cfg, {}), [])

    def test_other_market_fallback_house_wrap_fires_flag(self):
        from qa_auditor import compute_code_supplement_pricing_flags
        cfg = _load_cfg()
        cfg["property"]["state"] = "TX"
        # Simulate the other-market reality: house_wrap fell to a non-relational
        # fallback (TX lacks a native house_wrap rate today).
        for li in cfg["line_items"]:
            if "house wrap" in li["description"].lower():
                li["_price_source"] = "hardcoded-fallback"
        flags = compute_code_supplement_pricing_flags(cfg, {})
        self.assertTrue(flags, "other-market fallback house_wrap must fire the flag")
        self.assertEqual(flags[0]["issue"], "CODE_SUPPLEMENT_FALLBACK_PRICED")
        self.assertGreaterEqual(flags[0]["found"], 1)


class TestGoldenCorpusUntouched(unittest.TestCase):
    """Doc 06 (and this siding fixture) are NOT in the WS-0 forensic corpus →
    Doc 01 must stay 23/23 byte-identical."""

    def test_golden_corpus_byte_identical(self):
        import subprocess
        env = dict(os.environ)
        env.pop("REGEN_GOLDEN", None)
        proc = subprocess.run(
            [sys.executable, os.path.join(_HERE, "test_golden_forensic_corpus.py")],
            capture_output=True, text=True, env=env,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stdout[-2000:] + proc.stderr[-2000:])
        self.assertIn("23/23 fixtures byte-identical", proc.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
