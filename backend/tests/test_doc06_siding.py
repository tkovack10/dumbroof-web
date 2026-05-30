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
