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


if __name__ == "__main__":
    unittest.main()
