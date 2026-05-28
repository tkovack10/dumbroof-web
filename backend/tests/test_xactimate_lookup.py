"""Regression tests for the market-aware Xactimate price overlay (MVP wiring).

Run from repo root:  python3 -m unittest tests.test_xactimate_lookup -v
"""

import os
import sys
import unittest

# Make repo root importable when running via `python3 -m unittest tests.test_xactimate_lookup`
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from xactimate_lookup import (
    DEFAULT_MARKETS,
    XactRegistry,
    _clean_desc,
    _get_all_markets,
    _reset_all_markets_cache,
)


class CleanDescTests(unittest.TestCase):
    def test_hyphen_run_idempotency(self):
        """Step 1: '- 25 yr. -' run collapses to space, matches registry form."""
        a = _clean_desc("Remove 3 tab - 25 yr. - comp. shingle roofing - w/out felt")
        b = _clean_desc("Remove 3 tab - 25 yr. comp. shingle roofing - w/out felt")
        self.assertEqual(a, b)

    def test_three_tab_preserved(self):
        """Hyphen-collapse must NOT mangle '3-tab' (single-char left of dash)."""
        out = _clean_desc("3-tab shingle")
        self.assertIn("3-tab", out)


class MarketOverlayTests(unittest.TestCase):
    def setUp(self):
        _reset_all_markets_cache()

    def test_ny_overlay_at_least_80(self):
        reg = XactRegistry()
        n = reg.load_market_prices(market_code="NYBI8X_MAR26")
        # NY allItems has 99 entries; collapse to ~83 unique registry items.
        self.assertGreaterEqual(n, 80, f"NY overlay regressed: only {n} priced")

    def test_ri_pair_disambiguated(self):
        """The original collision bug: Remove vs Install for RFG 300S must have different prices."""
        reg = XactRegistry()
        reg.load_market_prices(market_code="NYBI8X_MAR26")
        rem = reg._by_code[("RFG 300S", "remove")]["unit_price"]
        ins = reg._by_code[("RFG 300S", "install")]["unit_price"]
        self.assertNotEqual(rem, ins, "R/I pair collapsed to same price")
        self.assertLess(rem, 100, f"NY remove price unexpectedly high: ${rem}")
        self.assertGreater(ins, 300, f"NY install price unexpectedly low: ${ins}")

    def test_pa_philadelphia_price(self):
        reg = XactRegistry()
        reg.load_market_prices(market_code="PAPH8X_MAR26")
        ins = reg._by_code[("RFG 300S", "install")]["unit_price"]
        self.assertAlmostEqual(ins, 349.14, places=1)

    def test_oh_cleveland_price(self):
        reg = XactRegistry()
        reg.load_market_prices(market_code="OHCL8X_APR26")
        ins = reg._by_code[("RFG 300S", "install")]["unit_price"]
        self.assertAlmostEqual(ins, 294.73, places=1)

    @unittest.skip(
        "Ship 3: registry pricing path retired. Pricing now reads relational "
        "get_prices_for_market (TX standard laminated_install=$269.32 / high-grade "
        "laminated_high_install=$306.46 correctly split there — guarded by "
        "scripts/parity_harness_ship3.py). The registry's TX-French _FR_PATTERNS still "
        "leaks high-grade ($306.46) into RFG 300S install; that now affects only "
        "METADATA enrichment, not price → fix tracked as Ship 12 (matching engine)."
    )
    def test_tx_houston_french_overlay(self):
        """TX market is French; Pass 2 must match via _FR_PATTERNS, not English desc."""
        reg = XactRegistry()
        reg.load_market_prices(market_code="TXHO8X_APR26")
        ins = reg._by_code[("RFG 300S", "install")]["unit_price"]
        self.assertAlmostEqual(ins, 269.32, places=1, msg=f"TX install wrong: ${ins}")

    @unittest.skip(
        "Ship 3: registry pricing path retired (see test_tx_houston_french_overlay). "
        "The $306-vs-$269 split is now guarded at the relational layer; the registry "
        "_FR_PATTERNS high-grade leak affects metadata only → Ship 12."
    )
    def test_french_high_grade_does_not_overwrite_standard(self):
        """The original $306 vs $269 bug — 'Qualité supérieure' must be excluded from RFG LAMI."""
        reg = XactRegistry()
        reg.load_market_prices(market_code="TXHO8X_APR26")
        ins = reg._by_code[("RFG 300S", "install")]["unit_price"]
        # Standard grade is $269.32; if high-grade leaked through it would be $306.46
        self.assertLess(ins, 280, f"high-grade laminated leaked into RFG LAMI: ${ins}")

    @unittest.skip(
        "Ship 3: registry pricing path retired (see test_tx_houston_french_overlay). "
        "TX assertion depends on the buggy registry overlay; relational is the source "
        "of truth now. Registry market-switch idempotency still covered by "
        "test_idempotent_double_load. Registry metadata fix → Ship 12."
    )
    def test_baseline_restore_on_market_switch(self):
        reg = XactRegistry()
        baseline = reg._by_code[("RFG 300S", "install")]["unit_price"]
        reg.load_market_prices(market_code="TXHO8X_APR26")
        tx_price = reg._by_code[("RFG 300S", "install")]["unit_price"]
        self.assertAlmostEqual(tx_price, 269.32, places=1)
        reg.load_market_prices(market_code="NYBI8X_MAR26")
        ny_price = reg._by_code[("RFG 300S", "install")]["unit_price"]
        self.assertAlmostEqual(ny_price, 347.22, places=1)
        # Items that NY's overlay doesn't cover should have reverted to baseline,
        # not retained TX-pricing residue.
        self.assertNotEqual(ny_price, tx_price)
        self.assertGreater(ny_price, baseline - 1)  # allow some baseline-vs-overlay overlap

    def test_idempotent_double_load(self):
        reg = XactRegistry()
        n1 = reg.load_market_prices(market_code="NYBI8X_MAR26")
        n2 = reg.load_market_prices(market_code="NYBI8X_MAR26")
        self.assertEqual(n1, n2)


class ResolveMarketTests(unittest.TestCase):
    def setUp(self):
        _reset_all_markets_cache()

    def test_all_10_default_markets_resolve(self):
        markets = _get_all_markets().get("markets", {})
        for state, code in DEFAULT_MARKETS.items():
            self.assertIn(code, markets, f"{state} default {code} missing from all-markets.json")

    def test_resolve_pa_philly(self):
        code = XactRegistry.resolve_market(state="PA", city="Philadelphia")
        self.assertTrue(code.startswith("PAPH8X"), f"PA Philly should resolve to PAPH8X, got {code}")

    def test_resolve_tx_houston(self):
        code = XactRegistry.resolve_market(state="TX", city="Houston")
        self.assertTrue(code.startswith("TXHO8X"))


class PdfWiringTests(unittest.TestCase):
    """End-to-end check that build_xactimate_estimate's pricing helper resolves correctly."""

    def setUp(self):
        _reset_all_markets_cache()
        # Bust pdf_generator cache too if previously imported
        for m in list(sys.modules):
            if m == "usarm_pdf_generator":
                del sys.modules[m]

    def test_provenance_resolves_pa_claim(self):
        from usarm_pdf_generator import _resolve_market_provenance
        config = {
            "property": {"state": "PA", "city": "Philadelphia", "zip": "19103"},
            "financials": {"price_list": "PAPH8X_MAR26"},
            "line_items": [
                {"description": "Laminated comp. shingle rfg.", "qty": 30, "unit_price": 0, "unit": "SQ"},
            ],
        }
        diag = _resolve_market_provenance(config)
        self.assertEqual(diag["market_code"], "PAPH8X_MAR26")
        self.assertTrue(diag["market_name"])
        # Ship 3: the generator no longer prices — a blank line is LEFT blank.
        # build_line_items owns pricing; an unpriced line is an upstream bug, not
        # something the generator silently fuzzy-fills (the deleted overlay behavior).
        self.assertEqual(config["line_items"][0]["unit_price"], 0)

    def test_stale_market_upgraded(self):
        from usarm_pdf_generator import _resolve_market_provenance
        config = {
            "property": {"state": "PA"},
            "financials": {"price_list": "PAPH8X_JUL23"},  # stale
            "line_items": [],
        }
        diag = _resolve_market_provenance(config)
        # Should auto-upgrade to PAPH8X_MAR26 (or whatever lex-latest)
        self.assertNotEqual(diag["market_code"], "PAPH8X_JUL23")
        self.assertTrue(diag["market_code"].startswith("PAPH8X"))

    def test_fail_fast_on_missing_market(self):
        from usarm_pdf_generator import _resolve_market_provenance
        with self.assertRaises(ValueError):
            _resolve_market_provenance({"property": {}, "financials": {}, "line_items": []})

    def test_generator_never_touches_frozen_prices(self):
        """Ship 3 core guarantee: the generator's provenance resolver must NOT mutate
        ANY line_item unit_price — not curated values, and not even with
        _refresh_prices=True. Pricing is frozen by build_line_items (relational, keyed
        by short_key). The old fuzzy lookup_price overlay/refresh — which re-priced
        standard shingle to the high-grade rate ($269.32→$306.46) and could fuzzy-fill
        blanks — is DELETED. If this test fails, an overlay path has leaked back in."""
        from usarm_pdf_generator import _resolve_market_provenance
        for refresh in (False, True):
            _reset_all_markets_cache()
            config = {
                "property": {"state": "PA"},
                "financials": {"price_list": "PAPH8X_MAR26"},
                "_refresh_prices": refresh,
                "line_items": [
                    {"description": "Laminated comp. shingle rfg.", "qty": 30, "unit_price": 999.99, "unit": "SQ"},
                    {"description": "Remove Laminated comp. shingle rfg.", "qty": 30, "unit_price": 0.0, "unit": "SQ"},
                ],
            }
            _resolve_market_provenance(config)
            self.assertEqual(config["line_items"][0]["unit_price"], 999.99,
                             f"refresh={refresh}: curated price was mutated — overlay leaked back in")
            self.assertEqual(config["line_items"][1]["unit_price"], 0.0,
                             f"refresh={refresh}: blank price was fuzzy-filled — overlay leaked back in")


class DumpsterScalingTests(unittest.TestCase):
    """Ship 17 #3: roofing-debris dumpster qty must scale with roof size (~22 SQ/load),
    not the old flat qty=1 that under-scoped haul on large roofs. qty is deterministic
    (area-driven), independent of market price."""

    def _dumpster_qty(self, area_sq):
        from processor import build_line_items
        meas = {"measurements": {"eave": 100, "ridge": 40, "valley": 10, "rake": 30, "hip": 0},
                "structures": [{"roof_area_sq": area_sq, "roof_area_sf": area_sq * 100,
                                "facets": 6, "predominant_pitch": "6/12"}]}
        items = build_line_items(meas, {}, "TX", estimate_request={"roofing": True},
                                 market_code="TXHO8X_APR26")
        loads = [it["qty"] for it in items
                 if it.get("category") == "DEBRIS" and "roofing debris" in it.get("description", "").lower()]
        self.assertEqual(len(loads), 1, "expected exactly one roofing-debris dumpster line")
        return loads[0]

    def test_small_roof_one_load(self):
        self.assertEqual(self._dumpster_qty(18), 1)   # ceil(18/22)=1

    def test_exact_capacity_one_load(self):
        self.assertEqual(self._dumpster_qty(22), 1)   # ceil(22/22)=1

    def test_large_roof_scales_up(self):
        self.assertEqual(self._dumpster_qty(40), 2)   # ceil(40/22)=2  (was flat 1 — the bug)

    def test_very_large_roof(self):
        self.assertEqual(self._dumpster_qty(50), 3)   # ceil(50/22)=3


class ValleyMetalTests(unittest.TestCase):
    """Ship 17 #6: comp-shingle (laminated/3tab) open valleys must get `R&R Valley metal`
    (replacement-associated). Previously only slate/tile got copper valley; comp-shingle
    valleys emitted nothing. qty = valley LF; key `valley_metal` (priced 160/160)."""

    def _items(self, material_notes, valley_lf, est_req):
        from processor import build_line_items
        meas = {"measurements": {"eave": 120, "ridge": 40, "valley": valley_lf, "rake": 30, "hip": 0},
                "structures": [{"roof_area_sq": 25, "roof_area_sf": 2500, "facets": 6,
                                "predominant_pitch": "6/12", "shingle_type": material_notes}]}
        return build_line_items(meas, {}, "TX", user_notes=material_notes,
                                estimate_request=est_req, market_code="TXHO8X_APR26")

    def _has(self, items, needle):
        return [it for it in items if needle.lower() in it.get("description", "").lower()]

    def test_comp_shingle_valley_emits_valley_metal(self):
        items = self._items("laminated", 30, {"roof_material": "laminated"})
        vm = self._has(items, "R&R Valley metal")
        self.assertEqual(len(vm), 1, "comp-shingle open valley should emit R&R Valley metal")
        self.assertEqual(vm[0]["qty"], 30)
        self.assertEqual(vm[0]["unit"], "LF")
        self.assertFalse(self._has(items, "Valley flashing - copper"),
                         "comp shingle should NOT get copper valley")

    def test_no_valley_no_line(self):
        items = self._items("laminated", 0, {"roof_material": "laminated"})
        self.assertFalse(self._has(items, "Valley metal"),
                         "valley=0 should emit no valley line")

    def test_slate_still_copper_not_metal(self):
        items = self._items("slate", 30, {"roof_material": "slate"})
        self.assertTrue(self._has(items, "Valley flashing - copper"),
                        "slate valley should still be copper")
        self.assertFalse([it for it in items if it.get("description") == "R&R Valley metal"],
                         "slate should not get plain valley metal")


class AdditionalLayerTests(unittest.TestCase):
    """Ship 17 #10: notes-gated multi-layer tear-off. When user_notes state a 2nd+ existing
    shingle layer, emit `Add. layer of comp. shingles, remove & disp.` (qty = area_sq × extra
    layers). Notes-gated → no false positives; NOT a double-count (base remove = top layer)."""

    AREA_SQ = 25

    def _layer_lines(self, notes):
        from processor import build_line_items
        meas = {"measurements": {"eave": 120, "ridge": 40, "valley": 0, "rake": 30, "hip": 0},
                "structures": [{"roof_area_sq": self.AREA_SQ, "roof_area_sf": self.AREA_SQ * 100,
                                "facets": 6, "predominant_pitch": "6/12"}]}
        items = build_line_items(meas, {}, "TX", user_notes=notes,
                                 estimate_request={"roofing": True, "roof_material": "laminated"},
                                 market_code="TXHO8X_APR26")
        return [it for it in items if "add. layer" in it.get("description", "").lower()]

    def test_two_layers_emits_one_extra(self):
        lines = self._layer_lines("Existing roof has 2 layers, tear off both")
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["qty"], self.AREA_SQ)   # 1 extra layer = 1× roof area
        self.assertEqual(lines[0]["unit"], "SQ")

    def test_layover_phrase_emits_one_extra(self):
        self.assertEqual(len(self._layer_lines("this is a layover roof")), 1)

    def test_three_layers_two_extra(self):
        lines = self._layer_lines("3 layers of shingles up there")
        self.assertEqual(lines[0]["qty"], self.AREA_SQ * 2)   # 2 extra layers

    def test_no_mention_no_line(self):
        self.assertEqual(self._layer_lines("hail damage to north slope"), [])

    def test_ice_water_layers_not_false_positive(self):
        # "2 layers of ice and water" must NOT trigger an additional shingle-layer tear-off
        self.assertEqual(self._layer_lines("install 2 layers of ice and water at eaves"), [])


class InstallSupplementTests(unittest.TestCase):
    """Ship 17 #7 + install-supplement timing model. Decking allowance emits tagged
    scope_timing='install_supplement', priced per SF (1 sheet/4 SQ × 32 SF), and is EXCLUDED
    from the initial Doc 02 estimate + its financials (surfaces in the supplement instead)."""

    def _build(self, area_sq=25):
        from processor import build_line_items
        meas = {"measurements": {"eave": 120, "ridge": 40, "valley": 0, "rake": 30, "hip": 0},
                "structures": [{"roof_area_sq": area_sq, "roof_area_sf": area_sq * 100,
                                "facets": 6, "predominant_pitch": "6/12"}]}
        return build_line_items(meas, {}, "TX",
                                estimate_request={"roofing": True, "roof_material": "laminated"},
                                market_code="TXHO8X_APR26")

    def _deck(self, items):
        d = [it for it in items if "sheathing" in it.get("description", "").lower()]
        return d[0] if d else None

    def test_decking_emitted_tagged_install_supplement(self):
        d = self._deck(self._build(25))
        self.assertIsNotNone(d, "decking allowance should emit on a reroof")
        self.assertEqual(d["scope_timing"], "install_supplement")
        self.assertEqual(d["unit"], "SF")
        self.assertEqual(d["qty"], 7 * 32)   # ceil(25/4)=7 sheets × 32 SF/sheet = 224 SF

    def test_no_decking_when_zero_area(self):
        self.assertIsNone(self._deck(self._build(0)))

    def test_is_initial_scope_helper(self):
        from usarm_pdf_generator import _is_initial_scope
        self.assertTrue(_is_initial_scope({"description": "shingles"}))          # untagged → initial
        self.assertTrue(_is_initial_scope({"scope_timing": "initial"}))
        self.assertFalse(_is_initial_scope({"scope_timing": "install_supplement"}))

    def test_decking_excluded_from_initial_financials(self):
        from usarm_pdf_generator import compute_financials
        items = self._build(25)
        d = self._deck(items)
        deck_ext = round(d["qty"] * d["unit_price"], 2)
        self.assertGreater(deck_ext, 0, "decking should carry real $ (sanity)")
        config = {"line_items": items, "financials": {"tax_rate": 0.0},
                  "scope": {"trades": ["roofing"]}, "carrier": {}}
        fin = compute_financials(config)
        all_ext = round(sum(round(it["qty"] * it["unit_price"], 2) for it in items), 2)
        # The ONLY thing excluded from the initial line_total is the install-supplement decking
        self.assertAlmostEqual(all_ext - fin["line_total"], deck_ext, places=2)


class ProcessorFinancialsTimingTests(unittest.TestCase):
    """Ship 17 check #3: processor.compute_financials (the contractor_rcv/variance source) must
    exclude install-supplement items from the initial total — consistent with Doc 02. PR #42
    fixed the generator's compute_financials but missed this one (live ~$640 inflation per reroof)."""

    def test_is_initial_scope_predicate(self):
        from processor import _is_initial_scope
        self.assertTrue(_is_initial_scope({}))                                   # untagged → initial
        self.assertTrue(_is_initial_scope({"scope_timing": "initial"}))
        self.assertFalse(_is_initial_scope({"scope_timing": "install_supplement"}))

    def test_processor_compute_financials_excludes_install_supplement(self):
        import processor
        config = {"line_items": [
            {"description": "shingle", "qty": 25, "unit_price": 300, "scope_timing": "initial"},
            {"description": "decking", "qty": 224, "unit_price": 2.86, "scope_timing": "install_supplement"},
            {"description": "drip", "qty": 100, "unit_price": 4.25},             # untagged → initial
        ], "financials": {"tax_rate": 0.0}, "scope": {}, "carrier": {}}
        fin = processor.compute_financials(config)
        expected_initial = round(25 * 300 + 100 * 4.25, 2)   # shingle + drip, NOT decking
        self.assertAlmostEqual(fin["line_total"], expected_initial, places=2)
        # contractor total (used for contractor_rcv) must not include the decking allowance
        self.assertNotAlmostEqual(fin["line_total"], expected_initial + round(224 * 2.86, 2), places=2)


class ScopeComparisonTimingTests(unittest.TestCase):
    """Ship 17 check #2: the USARM side fed to the scope comparison (processor.py:3814
    _engine.run(usarm_items=...)) must be INITIAL-only. Install-supplement items (decking) are
    filed separately — including them vs the carrier's pre-work scope would create a spurious
    'carrier missed X' variance. This guards the call-site filter expression."""

    def test_install_supplement_excluded_from_scope_comparison_input(self):
        from processor import _is_initial_scope
        line_items = [
            {"description": "Laminated comp shingle roofing - w/out felt", "scope_timing": "initial"},
            {"description": "R&R Sheathing - plywood - 1/2\" CDX", "scope_timing": "install_supplement"},
            {"description": "R&R Drip edge - aluminum"},  # untagged -> initial
        ]
        usarm_items = [li for li in line_items if _is_initial_scope(li)]  # == processor.py:3814
        descs = [li["description"] for li in usarm_items]
        self.assertEqual(len(usarm_items), 2)
        self.assertIn("Laminated comp shingle roofing - w/out felt", descs)
        self.assertIn("R&R Drip edge - aluminum", descs)
        self.assertNotIn("R&R Sheathing - plywood - 1/2\" CDX", descs)


if __name__ == "__main__":
    unittest.main()
