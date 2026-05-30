"""WS-7 — Doc 06 PRICED, GATED code-compliance supplement (One-Click-Code replacement).

Doc 06 is a FILTERED VIEW of Doc 02's code-required line items (those carrying a
code_citation), shown with code section + qty + correct PER-MARKET unit price. It
is a SUBSET of Doc 02 — NEVER additive (no new claim dollars).

The WS-0 golden corpus is Doc-01 (forensic) ONLY and CANNOT cover Doc 06, so this
file is the Doc-06-specific gate. It asserts:

  1. PRICED mode (measurements OR carrier scope) renders the priced table +
     CODE-COMPLIANCE SUPPLEMENT SUBTOTAL + AHJ / code-edition header + the
     non-additive (is_attribution_view) marker.
  2. FORENSIC-ONLY mode (no measurements, no carrier scope) renders
     requirements-only + the upload notice + NO subtotal / price.
  3. SUBSET INVARIANT: the supplement subtotal equals the sum of the SAME
     line_items' round(qty*price,2) as Doc 02 computes them — never additive.
  4. scope_timing=='install_supplement' code items are EXCLUDED from the subset
     (keeps the subset-of-Doc-02 invariant — Doc 02 also renders initial only).
  5. PER-ROW PROVENANCE: a row whose price fell back to a NY-baseline
     (hardcoded-fallback) is flagged internally, and a hardcoded-fallback row
     must NEVER be presentable as if it were a native per-market rate.
  6. Carrier cross-ref: each code item is marked INCLUDED vs OMITTED.
  7. WS-0 golden corpus stays 23/23 (Doc 06 not in it → Doc 01 inert).

Self-contained: plain unittest, no pytest dependency.
    python3 backend/tests/test_doc06_priced_supplement.py
"""
import copy
import json
import glob
import os
import re
import sys
import tempfile
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
sys.path.insert(0, _BACKEND)

import compliance_report as CR
import processor as P
from usarm_pdf_generator import compute_financials, _is_initial_scope

_CORPUS = os.path.join(_HERE, "golden_corpus")


def _load(claim_id):
    with open(os.path.join(_CORPUS, f"{claim_id}.json")) as f:
        return json.load(f)["config"]


# A fixture WITH measurements + carrier scope + many code-cited line items.
PRICED_FIXTURE_ID = "74597c34-a482-4a0d-b476-69e3987f9149"  # TX


def _priced_cfg():
    cfg = _load(PRICED_FIXTURE_ID)
    cfg.setdefault("_paths", {})["output"] = tempfile.mkdtemp()
    return cfg


class TestPricedMode(unittest.TestCase):
    def setUp(self):
        self.cfg = _priced_cfg()
        self.sup = CR.build_priced_supplement(self.cfg)
        self.html = self.sup["html"]

    def test_gating_is_priced(self):
        self.assertTrue(CR.has_measurements(self.cfg) or CR.carrier_scope_present(self.cfg))

    def test_renders_priced_table(self):
        self.assertIn("supplement-table", self.html)
        self.assertIn("Unit Price", self.html)
        self.assertIn("Line Total", self.html)
        # has at least one priced row
        self.assertGreater(self.sup["row_count"], 0)

    def test_subtotal_present(self):
        self.assertIn("CODE-COMPLIANCE SUPPLEMENT SUBTOTAL", self.html)
        self.assertIn(f"${self.sup['subtotal']:,.2f}", self.html)
        self.assertGreater(self.sup["subtotal"], 0)

    def test_ahj_header_present(self):
        ahj = CR._ahj_header(self.cfg)
        self.assertIn('data-ahj="true"', self.html)
        self.assertIn(ahj["base_code"], self.html)          # e.g. "IRC 2021"
        self.assertIn(ahj["jurisdiction"], self.html)       # full jurisdiction name

    def test_non_additive_marker(self):
        # machine-readable marker
        self.assertTrue(self.sup["is_attribution_view"])
        self.assertIn('data-attribution-view="true"', self.html)
        # human-visible label
        self.assertIn("already included in the Xactimate estimate", self.html)
        self.assertIn("not additional money", self.html.lower().replace("&mdash;", " "))


class TestSubsetInvariant(unittest.TestCase):
    """The keystone: supplement subtotal == sum of the SAME line_items in Doc 02.
    NEVER additive."""

    def setUp(self):
        self.cfg = _priced_cfg()

    def test_subtotal_equals_doc02_subset(self):
        sup = CR.build_priced_supplement(self.cfg)
        code_items = CR._code_line_items(self.cfg)
        # Doc 02 computes per-line round(qty*unit_price, 2) then sums.
        doc02_subset = round(
            sum(round(float(li["qty"]) * float(li["unit_price"]), 2) for li in code_items), 2
        )
        self.assertAlmostEqual(sup["subtotal"], doc02_subset, places=2)

    def test_never_additive_subtotal_equals_code_subset_sum(self):
        # FIX 4: the TRUE non-additive invariant is the subset-SUM identity, not
        # 'subtotal <= Doc 02 line_total'. The <= form can INVERT under a
        # hypothetical negative/credit line item (a credit would pull the full
        # total below a positive code subset, falsely "failing" a correct
        # supplement). The subset-sum '==' holds UNCONDITIONALLY: the supplement
        # subtotal is, by construction, the sum of round(qty*unit_price,2) over
        # exactly the SAME code line_items Doc 02 renders — never additive.
        sup = CR.build_priced_supplement(self.cfg)
        code_items = CR._code_line_items(self.cfg)
        code_subset_sum = round(
            sum(round(float(li["qty"]) * float(li["unit_price"]), 2) for li in code_items), 2
        )
        self.assertAlmostEqual(sup["subtotal"], code_subset_sum, places=2)
        # And that subset is itself a SUBSET of Doc 02's initial line total — the
        # code subset is necessarily ≤ the full line total when every code line's
        # extension is non-negative (true for all real configs). We assert the
        # subset membership directly rather than the fragile magnitude inequality.
        fin = compute_financials(self.cfg)
        all_initial_sum = round(
            sum(
                round(float(li.get("qty", 0) or 0) * float(li.get("unit_price", 0) or 0), 2)
                for li in self.cfg.get("line_items", [])
                if _is_initial_scope(li)
            ),
            2,
        )
        self.assertAlmostEqual(all_initial_sum, fin["line_total"], places=2)
        self.assertLessEqual(code_subset_sum, all_initial_sum + 0.005)

    def test_every_supplement_item_is_in_doc02(self):
        # Each code line item the supplement prices must be an INITIAL Doc-02 item.
        for li in CR._code_line_items(self.cfg):
            self.assertTrue(_is_initial_scope(li))
            self.assertTrue(li.get("code_citation"))
            self.assertGreater(float(li.get("qty", 0) or 0), 0)


class TestScopeTimingExclusion(unittest.TestCase):
    """install_supplement code items must be EXCLUDED from the subset so the
    subtotal can still equal the Doc-02 (initial-only) subset."""

    def test_install_supplement_excluded(self):
        cfg = _priced_cfg()
        # Pick a code-cited item whose description is UNIQUE among code items
        # (this TX fixture has duplicate descs across facets; tagging one of a
        # dup pair would still leave the sibling rendering).
        code_items = [li for li in cfg["line_items"] if li.get("code_citation")
                      and float(li.get("qty", 0) or 0) > 0]
        self.assertGreaterEqual(len(code_items), 2)
        from collections import Counter
        desc_counts = Counter(li["description"] for li in code_items)
        victim = next(li for li in code_items if desc_counts[li["description"]] == 1)
        victim_desc = victim["description"]
        victim_line_total = round(float(victim["qty"]) * float(victim["unit_price"]), 2)

        baseline = CR.build_priced_supplement(copy.deepcopy(cfg))

        victim["scope_timing"] = "install_supplement"
        after = CR.build_priced_supplement(cfg)

        # The victim no longer appears in the priced subset.
        included_descs = {li["description"] for li in CR._code_line_items(cfg)}
        self.assertNotIn(victim_desc, included_descs)
        # Subtotal dropped by exactly that line's contribution.
        self.assertAlmostEqual(after["subtotal"], baseline["subtotal"] - victim_line_total, places=2)
        self.assertEqual(after["row_count"], baseline["row_count"] - 1)


class TestCarrierCrossRef(unittest.TestCase):
    def test_marks_included_vs_omitted(self):
        cfg = _priced_cfg()
        self.assertTrue(CR.carrier_scope_present(cfg))
        sup = CR.build_priced_supplement(cfg)
        # Carrier column is rendered and at least one OMITTED appears (this TX
        # fixture genuinely omits ridge cap / ridge vent / underlayment-felt).
        self.assertIn("Carrier Scope", sup["html"])
        self.assertIn("OMITTED", sup["html"])
        self.assertGreater(sup["omitted_count"], 0)
        # FIX 1: a matched-Included row must also be rendered (the old bug
        # defaulted everything to OMITTED, so "Included" never appeared).
        self.assertIn("Included", sup["html"])

    def test_no_false_omissions_for_included_items(self):
        # FIX 1 — the credibility-critical assertion: items the carrier ACTUALLY
        # INCLUDED on this fixture (ice & water, laminated shingle, drip edge,
        # step flashing — all carrier status 'under' = present) must be matched
        # 'included', NEVER falsely defaulted to OMITTED.
        cfg = _priced_cfg()
        smap = CR._carrier_status_map(cfg)
        for desc_substr, expected in [
            ("ice & water barrier", "included"),
            ("laminated comp shingle roofing - w/out felt", "included"),
            ("r&r drip edge", "included"),
            ("r&r step flashing", "included"),
            # genuinely-absent (carrier status 'missing' / NOT INCLUDED):
            ("underlayment - felt 15#", "omitted"),
            ("r&r ridge cap - laminated", "omitted"),
            ("r&r ridge vent - shingle over", "omitted"),
        ]:
            matches = {k: v for k, v in smap.items() if desc_substr in k}
            self.assertTrue(matches, f"no status-map entry for {desc_substr!r}")
            for k, v in matches.items():
                self.assertEqual(v, expected, f"{k!r} should be {expected}, got {v}")

    def test_true_omitted_count_not_inflated(self):
        # FIX 1: the OMITTED count must be the TRUE number of genuinely-absent
        # code rows — NOT the old 24/25 that fell out of the default-to-OMITTED
        # bug. This TX fixture genuinely omits 3 distinct items (underlayment
        # felt, ridge cap, ridge vent), each repeated across 3 facets → 9 rows.
        cfg = _priced_cfg()
        sup = CR.build_priced_supplement(cfg)
        self.assertEqual(sup["row_count"], 25)
        self.assertEqual(sup["omitted_count"], 9)
        # Rendered OMITTED cells equal the counted omissions (no neutral row is
        # mislabeled, no Included row is mislabeled).
        self.assertEqual(sup["html"].count('class="carrier-omitted">OMITTED'), 9)
        # And the formerly-omitted-but-actually-included items now render Included.
        self.assertGreaterEqual(sup["html"].count('class="carrier-included">Included'), 1)

    def test_unmatched_rows_render_neutral_not_omitted(self):
        # FIX 1: a code item with NO positive carrier match renders a NEUTRAL
        # dash, NOT a fabricated OMITTED. (Starter strip matches no carrier row
        # at the conservative threshold on this fixture → neutral, not OMITTED.)
        cfg = _priced_cfg()
        sup = CR.build_priced_supplement(cfg)
        smap = CR._carrier_status_map(cfg)
        # 'starter' is in USARM scope but has no positive match → absent from map.
        starter_keys = [k for k in smap if "starter strip" in k]
        self.assertEqual(starter_keys, [], "starter should be UNMATCHED (neutral), not in the status map")
        # The neutral dash cell is rendered for the unmatched rows.
        self.assertIn('color:#95a5a6;">&mdash;</td>', sup["html"])

    def test_status_map_classifies_missing_as_omitted(self):
        cfg = _priced_cfg()
        smap = CR._carrier_status_map(cfg)
        # At least one row in this fixture is a carrier 'missing' (NOT INCLUDED).
        self.assertIn("omitted", set(smap.values()))


class TestRequirementsOnlyMode(unittest.TestCase):
    """No measurements AND no carrier scope → requirements-only, NO price."""

    def _forensic_only_cfg(self):
        cfg = _priced_cfg()
        # Strip every measurement signal + the carrier scope so gating falls to
        # requirements-only.
        cfg["measurements"] = {}
        for s in cfg.get("structures", []) or []:
            if isinstance(s, dict):
                s.pop("roof_area_sq", None)
                s.pop("roof_area_sf", None)
        cfg.setdefault("carrier", {})["carrier_line_items"] = []
        return cfg

    def test_gating_is_requirements_only(self):
        cfg = self._forensic_only_cfg()
        self.assertFalse(CR.has_measurements(cfg))
        self.assertFalse(CR.carrier_scope_present(cfg))

    def test_renders_requirements_only(self):
        cfg = self._forensic_only_cfg()
        html = CR.build_requirements_only_supplement(cfg)
        self.assertIn('data-requirements-only="true"', html)
        self.assertIn("Upload roof measurements or the carrier scope", html)
        # AHJ header is still present.
        self.assertIn('data-ahj="true"', html)

    def test_no_subtotal_or_price_in_requirements_only(self):
        cfg = self._forensic_only_cfg()
        html = CR.build_requirements_only_supplement(cfg)
        self.assertNotIn("CODE-COMPLIANCE SUPPLEMENT SUBTOTAL", html)
        # No priced TABLE (the priced supplement table class) and no priced
        # column HEADERS. ("Unit Price"/"Line Total" appear only inside the
        # descriptive upload-notice copy, which is intentional — so we assert on
        # the table structure + actual money figures, not the notice prose.)
        self.assertNotIn("supplement-table", html)
        self.assertNotIn("<th>Unit Price</th>", html)
        self.assertNotIn("<th>Line Total</th>", html)
        # No dollar figures anywhere in the requirements-only body.
        self.assertNotRegex(html, r"\$\d")

    def test_full_report_uses_requirements_only_branch(self):
        cfg = self._forensic_only_cfg()
        path = CR.build_compliance_report(cfg)
        self.assertTrue(path)
        with open(path) as f:
            html = f.read()
        self.assertIn("Requirements Only", html)
        self.assertNotIn("CODE-COMPLIANCE SUPPLEMENT SUBTOTAL", html)


class TestPerRowProvenance(unittest.TestCase):
    """A row whose price fell back to a NY-baseline (hardcoded-fallback) must be
    flagged internally — and must NEVER be presentable as a native rate."""

    def test_priced_function_records_sources(self):
        pricing = {
            "ice_water": 2.50,
            "_market_code": "TXDF8X",
            "_price_source": "relational",
            "_legacy_state_keys": {"scaffold_staging"},
            "scaffold_staging": 1405.0,
        }
        P._priced(pricing, "ice_water", 2.24)           # native relational
        P._priced(pricing, "scaffold_staging", 1405.0)  # legacy per-state JSON
        P._priced(pricing, "metal_install", 850.0)      # missing → hardcoded
        ks = pricing["_key_sources"]
        self.assertEqual(ks["ice_water"], "relational")
        self.assertEqual(ks["scaffold_staging"], "state-json-fallback")
        self.assertEqual(ks["metal_install"], "hardcoded-fallback")

    def test_apply_price_provenance_stamps_items(self):
        pricing = {
            "_market_code": "TXDF8X",
            "_price_source": "relational",
            "ice_water": 2.50,
            "metal_install": 850.0,  # present → relational
        }
        # exercise so _key_sources populates
        P._priced(pricing, "ice_water", 2.24)
        items = [
            {"description": "Ice & water barrier (2 courses eaves + 1 course valleys)",
             "qty": 10, "unit_price": 2.50},
            {"description": "A manual / derived item with no key", "qty": 1, "unit_price": 99.0},
        ]
        P.apply_price_provenance(items, pricing)
        self.assertEqual(items[0]["_price_source"], "relational")
        self.assertFalse(items[0].get("_price_source_inferred", False))
        # Unmapped item is still labeled (claim-level) and flagged inferred.
        self.assertEqual(items[1]["_price_source"], "relational")
        self.assertTrue(items[1]["_price_source_inferred"])

    def test_hardcoded_fallback_row_is_flagged_not_native(self):
        # HARD FAIL guard: a code item priced from the hardcoded NY baseline must
        # carry _price_source='hardcoded-fallback' — never silently 'relational'.
        pricing = {
            "_market_code": "TXDF8X",
            "_price_source": "relational",
            # NOTE: 'ice_water' deliberately ABSENT → _priced returns the hardcoded
            # NY-baseline fallback.
        }
        P._priced(pricing, "ice_water", 2.24)
        items = [
            {"description": "Ice & water barrier (2 courses eaves + 1 course valleys)",
             "qty": 10, "unit_price": 2.24, "code_citation": {"section": "R905.1.2"}},
        ]
        P.apply_price_provenance(items, pricing)
        self.assertEqual(items[0]["_price_source"], "hardcoded-fallback")
        # The test that would FAIL if a fallback row rendered as native:
        self.assertNotEqual(items[0]["_price_source"], "relational")

    def test_provenance_never_printed_on_pdf(self):
        # The internal _price_source must NOT leak onto the carrier-facing PDF.
        cfg = _priced_cfg()
        for li in cfg["line_items"]:
            li["_price_source"] = "hardcoded-fallback"  # worst case
        sup = CR.build_priced_supplement(cfg)
        self.assertNotIn("_price_source", sup["html"])
        self.assertNotIn("hardcoded-fallback", sup["html"])


class TestCosmeticFixes(unittest.TestCase):
    def test_address_deduped(self):
        # property.address already carries the full "..., City, ST ZIP, USA".
        prop = {"address": "9800 International Dr, Orlando, FL 32819, USA",
                "city": "ORLANDO", "state": "FL", "zip": "32819"}
        out = CR._format_property_address(prop)
        # City appears exactly once; no ", USA" tail.
        self.assertEqual(out.lower().count("orlando"), 1)
        self.assertNotIn("USA", out)
        self.assertEqual(out.count("32819"), 1)

    def test_address_composed_when_parts_missing(self):
        prop = {"address": "123 Main St", "city": "Marion", "state": "IN", "zip": "46953"}
        out = CR._format_property_address(prop)
        self.assertIn("123 Main St", out)
        self.assertIn("Marion", out)
        self.assertIn("46953", out)

    def test_summary_table_wires_carrier_status(self):
        # With a carrier scope present, the previously-dropped omission column is wired.
        cfg = _priced_cfg()
        from compliance_svg import collect_annotations_from_config
        anns = collect_annotations_from_config(cfg)
        summary = CR._build_summary_table(anns, cfg)
        self.assertIn("Carrier Scope", summary)
        self.assertNotIn("VERIFY", summary)  # the old placeholder is gone


class TestCodeSupplementPricingFlag(unittest.TestCase):
    """FIX 2 — CODE_SUPPLEMENT_FALLBACK_PRICED is a NON-BLOCKING MEDIUM flag that
    surfaces how many code-supplement rows use a non-relational fallback price.
    It NEVER alters the rendered price and can NEVER flip qa_blocked."""

    def _code_li(self, src, **extra):
        li = {
            "description": "Ice & water barrier",
            "qty": 10, "unit_price": 2.24,
            "code_citation": {"section": "R905.1.2"},
            "scope_timing": "initial",
        }
        if src is not None:
            li["_price_source"] = src
        li.update(extra)
        return li

    def test_fires_medium_on_fallback_price(self):
        from qa_auditor import compute_code_supplement_pricing_flags
        cfg = {"line_items": [
            self._code_li("relational"),
            self._code_li("hardcoded-fallback"),
            self._code_li("state-json-fallback"),
        ]}
        flags = compute_code_supplement_pricing_flags(cfg, {})
        self.assertEqual(len(flags), 1)
        f = flags[0]
        self.assertEqual(f["issue"], "CODE_SUPPLEMENT_FALLBACK_PRICED")
        self.assertEqual(f["severity"], "medium")           # never critical
        self.assertEqual(f["found"], 2)                      # 2 of 3 are fallback
        self.assertEqual(f["total_code_rows"], 3)
        self.assertIn("hardcoded-fallback", f["by_source"])

    def test_silent_when_all_relational(self):
        from qa_auditor import compute_code_supplement_pricing_flags
        cfg = {"line_items": [self._code_li("relational"), self._code_li("relational")]}
        self.assertEqual(compute_code_supplement_pricing_flags(cfg, {}), [])

    def test_ignores_non_code_and_non_initial_rows(self):
        from qa_auditor import compute_code_supplement_pricing_flags
        cfg = {"line_items": [
            # fallback BUT not code-cited → ignored
            {"description": "x", "qty": 1, "unit_price": 5, "_price_source": "hardcoded-fallback"},
            # fallback + code-cited BUT install_supplement → ignored (not in Doc 02 initial)
            self._code_li("hardcoded-fallback", scope_timing="install_supplement"),
            # fallback + code-cited BUT qty 0 → ignored
            self._code_li("hardcoded-fallback", qty=0),
        ]}
        self.assertEqual(compute_code_supplement_pricing_flags(cfg, {}), [])

    def test_missing_source_treated_as_fallback(self):
        from qa_auditor import compute_code_supplement_pricing_flags
        cfg = {"line_items": [self._code_li(None)]}  # no _price_source
        flags = compute_code_supplement_pricing_flags(cfg, {})
        self.assertEqual(len(flags), 1)
        self.assertEqual(flags[0]["found"], 1)

    def test_fires_on_real_fixture_when_stamped_fallback(self):
        from qa_auditor import compute_code_supplement_pricing_flags
        cfg = _priced_cfg()
        for li in cfg["line_items"]:
            if li.get("code_citation"):
                li["_price_source"] = "hardcoded-fallback"
        flags = compute_code_supplement_pricing_flags(cfg, {})
        self.assertEqual(len(flags), 1)
        self.assertGreater(flags[0]["found"], 0)
        # The flag NEVER alters the rendered price — the subset invariant holds.
        sup = CR.build_priced_supplement(cfg)
        code_items = CR._code_line_items(cfg)
        subset = round(sum(round(float(li["qty"]) * float(li["unit_price"]), 2)
                           for li in code_items), 2)
        self.assertAlmostEqual(sup["subtotal"], subset, places=2)


class TestGoldenCorpusUntouched(unittest.TestCase):
    """Doc 06 is NOT in the WS-0 forensic corpus → Doc 01 must stay 23/23."""

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
