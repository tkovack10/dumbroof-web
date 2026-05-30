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
import re
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
    → DIMINISHED VALUE (4). Damage is ALWAYS first; code never leads. The fixture
    is CONTRACTOR, so layers 3+4 (advocacy) are absent — only damage+code render
    (see TestSidingArgumentUppaStepCount for the variable step count)."""

    def setUp(self):
        self.cfg = _load_cfg()
        self.arg = CR.build_priced_supplement(self.cfg)["siding_argument"]

    def test_argument_is_rendered_for_siding_claim(self):
        self.assertTrue(self.arg)
        self.assertIn('data-siding-argument="true"', self.arg)

    def test_layer_order_contractor_is_damage_then_code_only(self):
        # CONTRACTOR mode (the fixture): only the two factual layers render, in
        # order. The advocacy layers (appearance/matching + diminished value) are
        # DROPPED entirely (UPPA — see TestSidingArgumentUppaStepCount).
        import re
        order = re.findall(r'data-arg-layer="(\w+)"', self.arg)
        self.assertEqual(order, ["damage", "code"])

    def test_layer_order_advocate_is_full_four(self):
        # PA/attorney mode keeps the full four-step chain in invariant order.
        pa = copy.deepcopy(self.cfg)
        pa["compliance"]["user_role"] = "public_adjuster"
        import re
        arg = CR.build_priced_supplement(pa)["siding_argument"]
        order = re.findall(r'data-arg-layer="(\w+)"', arg)
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


class TestSidingArgumentUppaStepCount(unittest.TestCase):
    """UPPA OWNER-MANDATE — the siding argument renders a VARIABLE step count
    driven by compliance.user_role:
      * CONTRACTOR → ONLY ① DAMAGE + ② CODE (the corner rule). These are factual
        and contractor-safe. ③ matching/appearance + ④ diminished-value/indemnity
        are CLAIM ADVOCACY (= public adjusting) and are DROPPED ENTIRELY.
      * PA / attorney / homeowner → the FULL four steps (advocacy is their job).
    The priced dollar subset is IDENTICAL in both — only prose changes."""

    # Tokens that may appear ONLY when steps 3/4 render (advocacy).
    _STEP34_TOKENS = (
        "diminished value",
        "indemnity",
        "matching",
        "mdl-902",
        "like kind and quality",
        'data-arg-layer="appearance"',
        'data-arg-layer="diminished_value"',
    )

    def _arg(self, role):
        cfg = _load_cfg()
        cfg["compliance"]["user_role"] = role
        return CR.build_priced_supplement(cfg)["siding_argument"]

    def test_contractor_renders_exactly_two_steps(self):
        arg = self._arg("contractor")
        layers = re.findall(r'data-arg-layer="(\w+)"', arg)
        self.assertEqual(layers, ["damage", "code"], "contractor = 2 factual steps")
        # The step-number badges 3 and 4 must NOT appear.
        self.assertNotIn('<span class="siding-arg-num">3</span>', arg)
        self.assertNotIn('<span class="siding-arg-num">4</span>', arg)

    def test_contractor_drops_step3_and_step4_advocacy_entirely(self):
        low = self._arg("contractor").lower()
        for tok in self._STEP34_TOKENS:
            self.assertNotIn(
                tok, low,
                f"contractor mode must NOT render step-3/step-4 advocacy token {tok!r} "
                "(UPPA-prohibited claim advocacy)",
            )

    def test_advocate_renders_all_four_steps(self):
        for role in ("public_adjuster", "attorney", "homeowner"):
            arg = self._arg(role)
            layers = re.findall(r'data-arg-layer="(\w+)"', arg)
            self.assertEqual(
                layers, ["damage", "code", "appearance", "diminished_value"],
                f"{role} = full 4 steps",
            )
            low = arg.lower()
            self.assertIn("diminished value", low, f"{role} must carry step 4")
            self.assertIn("matching", low, f"{role} must carry step 3 matching framing")
            self.assertIn('<span class="siding-arg-num">3</span>', arg)
            self.assertIn('<span class="siding-arg-num">4</span>', arg)

    def test_step_count_does_not_move_the_priced_subset(self):
        # Dropping the two advocacy layers is PROSE-ONLY — the priced $ subset is
        # byte-identical between contractor and every advocate role.
        base = _load_cfg()
        base_sub = CR.build_priced_supplement(base)["subtotal"]
        self.assertGreater(base_sub, 0)
        for role in ("public_adjuster", "attorney", "homeowner"):
            cfg = copy.deepcopy(base)
            cfg["compliance"]["user_role"] = role
            self.assertAlmostEqual(
                CR.build_priced_supplement(cfg)["subtotal"], base_sub, places=2,
                msg=f"{role} subset must equal the contractor subset",
            )


class TestSidingMatchingStateGate(unittest.TestCase):
    """NO-statute states (NY/PA/NJ) frame MDL-902 as INDUSTRY EVIDENCE only;
    matching-statute states (e.g. OH) cite the rule directly. Driven by claim state.

    The matching/appearance layer is step 3 (advocacy) — it renders only in
    ADVOCATE mode, so these tests run on a public_adjuster copy. The STATE gate is
    orthogonal to the UPPA role gate: which framing applies is a property of the
    state; whether step 3 renders at all is a property of the role."""

    def _advocate_cfg(self, state=None):
        cfg = _load_cfg()  # NY contractor by default
        cfg["compliance"]["user_role"] = "public_adjuster"  # step 3 only in advocate mode
        if state:
            cfg["property"]["state"] = state
        return cfg

    def test_ny_is_industry_evidence_only(self):
        arg = CR.build_priced_supplement(self._advocate_cfg())["siding_argument"]  # NY
        self.assertIn('data-matching-statute="false"', arg)
        low = arg.lower()
        self.assertIn("industry evidence", low)
        self.assertIn("not as an enforceable", low)

    def test_statute_state_cites_the_rule_directly(self):
        cfg = self._advocate_cfg("OH")  # Ohio has a matching regulation
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
        # NY prices wall flashing from its OWN-state legacy Xactimate JSON
        # (nybi26.json $4.85) — its TRUE provenance is 'state-json-fallback:NY', the
        # NY-native rate, NOT a coarse cross-market fallback. (The prior assertion
        # 'relational' was reading a HAND-STAMPED fixture, masking the real source.)
        # It is also now KEY-ATTRIBUTED (reverse map), so it is not 'inferred'.
        self.assertEqual(wf[0].get("_price_source"), "state-json-fallback:NY")
        self.assertIsNot(wf[0].get("_price_source_inferred"), True)


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


class TestSidingSignalNotOverEager(unittest.TestCase):
    """detect_siding_damage_signal must NOT auto-enable whole-house siding on:
      * a GUTTERS-trade photo with material 'siding_trim' + a damage type,
      * a ROOFING-trade photo with 'fiber_cement_siding' + a roof signature,
      * user_notes 'new siding installed last year, roof hail damage' (bag-of-words).
    It MUST still fire on a genuine SIDING-trade cladding + hail-dent. Adversarial-
    panel correctness fix: a bare 'siding' substring + roof-shingle damage types +
    bag-of-words notes were over-firing."""

    def _meas(self):
        return {
            "measurements": {"eave": 100, "rake": 80},
            "structures": [{"roof_area_sq": 25, "roof_area_sf": 2500, "facets": 4,
                            "predominant_pitch": "6/12"}],
            "stories": 2,
            "walls": {"total_wall_area_sf": 2280, "window_count": 8, "door_count": 2,
                      "elevations": [{"name": "Front", "openings": 4}]},
        }

    # ---- signal detector (unit) ----
    def test_gutter_trim_photo_does_not_fire(self):
        import processor as P
        dmg = {"photo_tags": {"p01": {"trade": "gutters", "material": "siding_trim",
                                      "damage_type": "crack"}}}
        self.assertFalse(P.detect_siding_damage_signal(dmg),
                         "a gutters-trade trim photo must not auto-enable siding")

    def test_roofing_fiber_cement_photo_does_not_fire(self):
        import processor as P
        # ROOFING trade, fiber_cement_siding material, granule_loss (a roof signature).
        dmg = {"photo_tags": {"p01": {"trade": "roofing", "material": "fiber_cement_siding",
                                      "damage_type": "granule_loss"}}}
        self.assertFalse(P.detect_siding_damage_signal(dmg),
                         "a roofing-trade photo must not auto-enable siding")
        # Even with a real cladding damage type, the ROOFING trade still excludes it.
        dmg2 = {"photo_tags": {"p01": {"trade": "roofing", "material": "fiber_cement_siding",
                                       "damage_type": "hail_dent"}}}
        self.assertFalse(P.detect_siding_damage_signal(dmg2),
                         "trade=roofing must never trip the siding-damage signal")

    def test_new_siding_plus_roof_damage_notes_does_not_fire(self):
        import processor as P
        notes = "new siding installed last year, roof hail damage"
        self.assertFalse(P.detect_siding_damage_signal({}, notes),
                         "bag-of-words 'siding' + unrelated 'roof hail damage' must not fire")

    def test_real_siding_cladding_hail_dent_fires(self):
        import processor as P
        dmg = {"photo_tags": {"p01": {"trade": "siding", "material": "vinyl_siding",
                                      "damage_type": "hail_dent"}}}
        self.assertTrue(P.detect_siding_damage_signal(dmg),
                        "a real siding-cladding + hail-dent photo MUST fire")

    def test_explicit_siding_damage_notes_fires(self):
        import processor as P
        self.assertTrue(P.detect_siding_damage_signal({}, "cracked siding on the rear elevation"))
        self.assertTrue(P.detect_siding_damage_signal({}, "hail damage to the vinyl siding"))

    # ---- end-to-end through build_line_items ----
    def test_gutter_trim_photo_no_siding_line_items(self):
        import processor as P
        photo = {"trades_identified": ["roofing", "gutters"],
                 "photo_tags": {"p01": {"trade": "gutters", "material": "siding_trim",
                                        "damage_type": "crack"}}}
        items = P.build_line_items(self._meas(), photo, "NY", user_notes="",
                                   estimate_request=None, market_code="")
        siding = [i for i in items if i.get("category") == "SIDING"]
        self.assertEqual(siding, [], "gutter-trim photo must produce NO siding line items")

    def test_roofing_fiber_cement_photo_no_siding_line_items(self):
        import processor as P
        photo = {"trades_identified": ["roofing"],
                 "photo_tags": {"p01": {"trade": "roofing", "material": "fiber_cement_siding",
                                        "damage_type": "granule_loss"}}}
        items = P.build_line_items(self._meas(), photo, "NY", user_notes="",
                                   estimate_request={"roof_material": "comp_shingle"},
                                   market_code="")
        siding = [i for i in items if i.get("category") == "SIDING"]
        self.assertEqual(siding, [], "roofing fiber-cement photo must produce NO siding line items")

    def test_new_siding_notes_no_siding_line_items(self):
        import processor as P
        photo = {"trades_identified": ["roofing"],
                 "photo_tags": {"p01": {"trade": "roofing", "material": "comp_shingle_laminated",
                                        "damage_type": "hail_dent"}}}
        items = P.build_line_items(self._meas(), photo, "NY",
                                   user_notes="new siding installed last year, roof hail damage",
                                   estimate_request={"roof_material": "comp_shingle"},
                                   market_code="")
        siding = [i for i in items if i.get("category") == "SIDING"]
        self.assertEqual(siding, [], "'new siding + roof damage' notes must produce NO siding line items")


class TestSidingFallbackFlagThroughRealProcessor(unittest.TestCase):
    """CODE_SUPPLEMENT_FALLBACK_PRICED is NOISE no more. Built THROUGH THE REAL
    PROCESSOR (build_line_items + apply_price_provenance), not a hand-stamped
    fixture — the prior test masked the real provenance.

    SILENT on the NY siding fixture's real build (house_wrap/wall_flashing/siding
    resolve to the OWN-state native NYBI26 rate = 'state-json-fallback:NY', not
    coarse). FIRES on a TX copy (TX market lacks those short_keys → they fall to
    'hardcoded-fallback' = a genuinely-coarse cross-market NY baseline)."""

    @staticmethod
    def _build_siding_config(state):
        """Run the REAL siding scope through build_line_items + apply_price_provenance
        for `state`, then shape a config whose code-supplement subset is the priced
        siding rows. This is the path a real processor run produces — no hand-stamped
        _price_source anywhere."""
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
        items = P.build_line_items(meas, photo, state, user_notes="",
                                   estimate_request=None, market_code="")
        # Make the SIDING rows qualify as code-supplement rows (the flag only
        # inspects initial, code-cited, qty>0 rows). We do NOT touch _price_source —
        # apply_price_provenance already stamped it during the real build.
        cc = {"section": "R703.2", "code_tag": "RCNYS R703.2",
              "requirement": "WRB", "title": "wrb"}
        siding_rows = []
        for it in items:
            if it.get("category") in ("SIDING", "DEBRIS"):
                it["code_citation"] = cc
                it.setdefault("scope_timing", "initial")
                siding_rows.append(it)
        assert siding_rows, "siding scope must produce rows"
        return {"property": {"state": state}, "line_items": items}

    def test_ny_real_build_flag_silent(self):
        from qa_auditor import compute_code_supplement_pricing_flags
        cfg = self._build_siding_config("NY")
        # Sanity: house_wrap/wall_flashing/siding are the OWN-state native rate, and
        # are key-attributed (not inferred) thanks to the reverse-map additions.
        by_src = {}
        for li in cfg["line_items"]:
            if li.get("category") == "SIDING":
                by_src.setdefault(li.get("_price_source"), 0)
                by_src[li.get("_price_source")] += 1
                self.assertIsNot(li.get("_price_source_inferred"), True,
                                 f"{li['description']!r} should be key-attributed, not inferred")
        # Every siding row is either native relational or own-state NY legacy — none coarse.
        for src in by_src:
            self.assertTrue(
                src == "relational" or src == "state-json-fallback:NY",
                f"unexpected coarse source on a NY siding row: {src!r}",
            )
        flags = compute_code_supplement_pricing_flags(cfg, {})
        self.assertEqual(
            flags, [],
            "NY own-state native siding pricing must NOT raise the fallback flag "
            f"(sources seen: {by_src})",
        )

    def test_tx_real_build_flag_fires(self):
        from qa_auditor import compute_code_supplement_pricing_flags
        cfg = self._build_siding_config("TX")
        # TX (a non-priced siding market) → house_wrap/wall_flashing/siding fall to
        # 'hardcoded-fallback' (the cross-market NY baseline) = genuinely coarse.
        flags = compute_code_supplement_pricing_flags(cfg, {})
        self.assertTrue(flags, "TX coarse-priced siding must FIRE the fallback flag")
        f = flags[0]
        self.assertEqual(f["issue"], "CODE_SUPPLEMENT_FALLBACK_PRICED")
        self.assertEqual(f["severity"], "medium")  # MEDIUM-only / never blocking
        self.assertGreaterEqual(f["found"], 1)
        # The coarse source is the hardcoded NY baseline, not an own-state legacy rate.
        self.assertIn("hardcoded-fallback", f["by_source"])

    def test_fixture_still_silent_in_ny(self):
        # The hand-stamped NY fixture (every row 'relational') is also silent — the
        # genuinely-coarse rule treats native relational as non-coarse.
        from qa_auditor import compute_code_supplement_pricing_flags
        cfg = _load_cfg()
        self.assertEqual(compute_code_supplement_pricing_flags(cfg, {}), [])


# ── PHASE 1 COSMETIC — TRADE-AWARE LEAD CITATION ──
#
# The generic Doc-06 lead (cover + visual-reference) must cite the MANUFACTURER-
# INSTALL basis that matches the report's trade: a SIDING report cites R703.3
# (exterior wall coverings), a ROOFING/mixed report cites R905.1 (roofing). A
# siding report must NEVER lead with the roofing R905.1 citation.
class TestSidingTradeAwareLead(unittest.TestCase):
    def _render(self, cfg):
        cfg.setdefault("_paths", {})["output"] = tempfile.mkdtemp()
        with open(CR.build_compliance_report(cfg)) as f:
            return f.read()

    def test_detector_classifies_pure_siding_as_siding(self):
        cfg = _load_cfg()  # all R703.x, no roofing
        self.assertTrue(CR._report_is_siding(cfg))
        self.assertEqual(CR._lead_code_basis(cfg)["section"], "R703.3")

    def test_siding_report_leads_with_r703_3_not_r905_1(self):
        html = self._render(_load_cfg())
        # Trade-aware siding lead present.
        self.assertIn("R703.3", html)
        self.assertIn("Exterior wall coverings shall be installed", html)
        # The roofing manufacturer-install lead must NOT appear on a siding report.
        self.assertNotIn("Roofing shall be applied", html)
        self.assertNotIn("R905.1", html)

    def test_mixed_roof_and_siding_keeps_roofing_lead(self):
        # A claim with BOTH a roofing (R905.x) and a siding (R703.x) code item is
        # roof-predominant → stays on the R905.1 lead (roof governs).
        cfg = _load_cfg()
        cfg["line_items"].append({
            "category": "ROOFING", "trade": "ROOFING",
            "description": "Laminated comp shingle roofing", "qty": 30.0, "unit": "SQ",
            "unit_price": 285.27, "scope_timing": "initial",
            "code_citation": {"section": "R905.1", "code_tag": "RCNYS R905.1",
                              "requirement": "roof covering", "title": "roof"},
        })
        self.assertFalse(CR._report_is_siding(cfg))
        self.assertEqual(CR._lead_code_basis(cfg)["section"], "R905.1")

    def test_roofing_fixture_keeps_r905_1_lead(self):
        # The roofing golden-corpus fixture must still lead with the roofing basis.
        import os as _os
        with open(_os.path.join(_HERE, "golden_corpus",
                                "74597c34-a482-4a0d-b476-69e3987f9149.json")) as f:
            roof_cfg = json.load(f)["config"]
        self.assertFalse(CR._report_is_siding(roof_cfg))
        self.assertEqual(CR._lead_code_basis(roof_cfg)["section"], "R905.1")
        html = self._render(roof_cfg)
        self.assertIn("R905.1", html)
        self.assertIn("Roofing shall be applied", html)


# ── PHASE 1 COSMETIC — CORNER-WRAP DISTANCE RECONCILED ──
#
# The legacy House-Wrap Corner Detail diagram said 12"; the canonical doctrine
# (building_codes state_codes supplement_sentence) cites the DuPont Tyvek 6 in.
# minimum. The siding content must standardize on "6 in. minimum (Tyvek)"
# EVERYWHERE — no conflicting 12" survives.
class TestCornerWrapReconciled(unittest.TestCase):
    def _render(self, cfg):
        cfg.setdefault("_paths", {})["output"] = tempfile.mkdtemp()
        with open(CR.build_compliance_report(cfg)) as f:
            return f.read()

    def test_corner_wrap_is_6_in_minimum_tyvek(self):
        html = self._render(_load_cfg())
        # The diagram + caption both now state the 6 in. minimum.
        self.assertIn("Min 6 in. wrap", html)
        self.assertIn("minimum of 6 in.", html)
        self.assertIn("Tyvek", html)

    def test_no_conflicting_12_inch_corner_wrap(self):
        html = self._render(_load_cfg())
        # None of the old 12" corner-wrap phrasings survive (SVG geometry uses a
        # bare height="12" / width="12" which is NOT a wrap distance, so we assert
        # only on the human-readable wrap phrasings).
        for stale in ('Min 12" wrap', "minimum 12 inches", 'wraps 12"', "12\"+"):
            self.assertNotIn(stale, html, f"stale 12-inch corner-wrap phrasing survived: {stale!r}")

    def test_doctrine_supplement_sentence_uses_6_in(self):
        # Cross-check the doctrine source: the supplement sentence the hero renders
        # already standardizes on the 6 in. Tyvek minimum (no 12" there either).
        from building_codes import lookup as _bc
        sent = _bc.get_house_wrap_doctrine("NY").get("supplement_sentence", "")
        self.assertIn("6 in", sent)
        self.assertNotIn("12 in", sent)


class TestSidingWallAreaUsesRealPerimeter(unittest.TestCase):
    """SHIP — the no-walls-report fallback now delegates to the SHARED wall-area
    brain (wall_area_estimator.estimate_wall_area_geometric) instead of an inline
    sqrt(footprint) guess. That estimator uses the REAL measured eave+rake
    perimeter when present (strictly better) and only falls back to a square-
    footprint assumption (sqrt of roof_area_sq) when no eave/rake LF exists.

    Three cases, mirroring the task spec:
      (a) eave+rake present, NO walls report → wall area from the real perimeter
          (DIFFERS from the old sqrt value; MATCHES the shared estimator);
      (b) NEITHER walls report NOR eave/rake → still a sane sqrt-based wall area
          (no crash, > 0);
      (c) walls report present (total_wall_area_sf > 0) → UNCHANGED (real walls win).
    """

    @staticmethod
    def _siding_qty(items):
        """The R&R siding row qty == the wall area the builder scoped (SF)."""
        rr = [i for i in items if i.get("category") == "SIDING"
              and "siding -" in i["description"].lower()
              and "house wrap" not in i["description"].lower()]
        assert rr, "no R&R siding row emitted"
        return float(rr[0]["qty"])

    def _photo(self):
        # A genuine siding-damage signal so the scope AUTO-enables (no opt-in needed).
        return {"trades_identified": ["roofing", "siding"], "siding_type": "vinyl",
                "photo_tags": {"p01": {"trade": "siding", "material": "vinyl_siding",
                                       "damage_type": "crack", "severity": "moderate"}}}

    def _old_sqrt_wall_area(self, area_sf, stories):
        """Reproduce the REMOVED inline sqrt(footprint) heuristic so case (a) can
        prove the new real-perimeter value DIFFERS from the old guess."""
        import math
        _footprint = area_sf / max(1, stories)
        _perimeter = round(math.sqrt(_footprint) * 4)
        _wall_height = max(1, stories) * 9
        return round(_perimeter * _wall_height)

    def test_a_uses_real_eave_rake_perimeter_not_sqrt(self):
        import processor as P
        from wall_area_estimator import estimate_wall_area_geometric
        eave, rake, stories, area_sf = 100, 80, 2, 2500
        meas = {
            "measurements": {"eave": eave, "rake": rake},
            "structures": [{"roof_area_sq": area_sf / 100, "roof_area_sf": area_sf,
                            "facets": 4, "predominant_pitch": "6/12"}],
            "stories": stories,
            # NO walls report — this is the fallback path under test.
        }
        items = P.build_line_items(meas, self._photo(), "NY", user_notes="",
                                   estimate_request=None, market_code="")
        scoped = self._siding_qty(items)

        # It MATCHES the shared geometric estimator fed the real eave+rake perimeter.
        expected = estimate_wall_area_geometric({
            "eave_lf": eave, "rake_lf": rake, "stories": stories,
            "roof_area_sq": area_sf / 100.0,
        })["wall_area_sf"]
        self.assertEqual(scoped, expected,
                         "builder must scope the shared real-perimeter wall area")
        # The real perimeter is eave+rake = 180 LF (not 4*sqrt(footprint)).
        self.assertEqual(expected, (eave + rake) * 9 * stories)
        # And it DIFFERS from the old sqrt(footprint) guess (proof we stopped using it).
        self.assertNotEqual(scoped, self._old_sqrt_wall_area(area_sf, stories))

    def test_b_no_walls_no_measured_perimeter_still_sane(self):
        import processor as P
        from wall_area_estimator import estimate_wall_area_geometric
        # NO walls report AND no MEASURED eave/rake in the input. Through the real
        # builder this still produces a sane, positive wall area and never crashes:
        # the roofing path derives eave/rake from roof area first, so the geometric
        # estimator gets a (derived) perimeter to work from. The point of case (b) is
        # the NO-CRASH / SANE-AREA guarantee on a perimeter-less claim — verified two
        # ways: (1) end-to-end through build_line_items, and (2) the estimator's own
        # square-footprint sqrt fallback when eave/rake are genuinely absent.
        stories, area_sf = 2, 2500
        meas = {
            "measurements": {},  # no eave / rake supplied
            "structures": [{"roof_area_sq": area_sf / 100, "roof_area_sf": area_sf,
                            "facets": 4, "predominant_pitch": "6/12"}],
            "stories": stories,
        }
        items = P.build_line_items(meas, self._photo(), "NY", user_notes="",
                                   estimate_request=None, market_code="")
        siding = [i for i in items if i.get("category") == "SIDING"]
        self.assertTrue(siding, "fallback must still scope siding (no crash)")
        self.assertGreater(self._siding_qty(items), 0, "wall area must be sane (> 0)")

        # (2) The estimator's TRUE sqrt-footprint fallback (eave/rake genuinely 0):
        # sane, positive, and flagged low-confidence so the builder logs it as the
        # sqrt fallback rather than a real-perimeter estimate.
        fb = estimate_wall_area_geometric({
            "eave_lf": 0, "rake_lf": 0, "stories": stories,
            "roof_area_sq": area_sf / 100.0,
        })
        self.assertGreater(fb["wall_area_sf"], 0)
        self.assertEqual(fb["confidence"], "low")
        # = (4 * sqrt(roof_area_sf)) perimeter * 9 ft/story * stories — a square-
        # footprint guess from roof_area_sq alone (no measured perimeter).
        side = area_sf ** 0.5
        self.assertEqual(fb["wall_area_sf"], round(side * 4.0 * 9.0 * stories))

    def test_c_walls_report_path_unchanged(self):
        import processor as P
        # total_wall_area_sf > 0 → the REAL walls report wins; the fallback is never
        # reached and the scoped wall area is the report value verbatim (unchanged).
        wall_report_sf = 2280
        meas = {
            "measurements": {"eave": 100, "rake": 80},
            "structures": [{"roof_area_sq": 25, "roof_area_sf": 2500, "facets": 4,
                            "predominant_pitch": "6/12"}],
            "stories": 2,
            "walls": {"total_wall_area_sf": wall_report_sf, "window_count": 8,
                      "door_count": 2,
                      "elevations": [{"name": "Front", "openings": 4},
                                     {"name": "Right", "openings": 3},
                                     {"name": "Left", "openings": 3},
                                     {"name": "Rear", "openings": 4}]},
        }
        items = P.build_line_items(meas, self._photo(), "NY", user_notes="",
                                   estimate_request=None, market_code="")
        self.assertEqual(self._siding_qty(items), float(wall_report_sf),
                         "walls report must win — fallback must not touch it")


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
