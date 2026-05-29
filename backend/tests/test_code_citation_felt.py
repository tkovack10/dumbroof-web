"""Regression tests for E267 — felt/underlayment mis-resolving to RFG IWS.

E267 (LIVE production defect): in backend/code_compliance.py, the
_DESC_TO_CODE_KEY description-keyword fallback listed the ice/i&w keys BEFORE
the felt/underlayment keys. get_code_citation lowercases the description and
breaks on the FIRST keyword found. The felt line build_line_items emits is
"Underlayment - felt 15#/30# (deck area not covered by I&W)" — it contains
"i&w", so felt mis-resolved to RFG IWS (Ice Barrier, R905.1.2) and carried the
GAF WeatherWatch warranty-void block: a FALSE code citation + FALSE
manufacturer-warranty claim on carrier-facing reports.

Fix: reorder _DESC_TO_CODE_KEY so "felt"/"underlayment" precede the ice/i&w
keys. The real ice & water line ("Ice & water barrier ...") contains neither
"felt" nor "underlayment", so it still resolves to RFG IWS with WeatherWatch.

Self-contained: plain unittest, no pytest dependency.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from code_compliance import get_code_citation


def _has_weatherwatch(citation: dict) -> bool:
    """True if any manufacturer spec references GAF WeatherWatch."""
    for spec in citation.get("manufacturer_specs", []):
        blob = " ".join(
            str(spec.get(k, "")) for k in ("manufacturer", "document", "warranty_text", "requirement")
        ).lower()
        if "weatherwatch" in blob:
            return True
    return False


# Canonical descriptions build_line_items actually emits (processor.py).
FELT_15 = "Underlayment - felt 15# (deck area not covered by I&W)"
FELT_30 = "Underlayment - felt 30# (deck area not covered by I&W)"
ICE_WATER = "Ice & water barrier (2 courses eaves + 1 course valleys)"


class TestFeltCitation(unittest.TestCase):
    def test_felt_15_resolves_to_underlayment_section(self):
        """(a) felt 15# desc -> R905.1.1 Underlayment, no warranty void, no WeatherWatch."""
        c = get_code_citation("", "install", "NY", FELT_15)
        self.assertIsNotNone(c, "felt 15# description should resolve to a citation")
        self.assertEqual(c["section"], "R905.1.1")
        self.assertFalse(c["has_warranty_void"])
        self.assertFalse(_has_weatherwatch(c), "felt must NOT carry the WeatherWatch warranty-void block")

    def test_felt_30_resolves_to_underlayment_section(self):
        """felt 30# (slate/tile) desc -> R905.1.1 Underlayment, no warranty void, no WeatherWatch."""
        c = get_code_citation("", "install", "NY", FELT_30)
        self.assertIsNotNone(c)
        self.assertEqual(c["section"], "R905.1.1")
        self.assertFalse(c["has_warranty_void"])
        self.assertFalse(_has_weatherwatch(c))

    def test_underlayment_keyword_resolves_to_underlayment_section(self):
        """Bare 'Underlayment - base sheet (flat roof)' (no felt, no i&w) -> R905.1.1."""
        c = get_code_citation("", "install", "NY", "Underlayment - base sheet (flat roof)")
        self.assertIsNotNone(c)
        self.assertEqual(c["section"], "R905.1.1")
        self.assertFalse(c["has_warranty_void"])

    def test_ice_water_still_resolves_to_ice_barrier_with_weatherwatch(self):
        """(b) real ice & water desc -> R905.1.2 Ice Barrier WITH WeatherWatch warranty void."""
        c = get_code_citation("", "install", "NY", ICE_WATER)
        self.assertIsNotNone(c, "ice & water description should resolve to a citation")
        self.assertEqual(c["section"], "R905.1.2")
        self.assertTrue(c["has_warranty_void"], "ice & water SHOULD carry the warranty-void block")
        self.assertTrue(_has_weatherwatch(c), "ice & water SHOULD carry the WeatherWatch block")

    def test_ice_water_description_contains_no_felt_or_underlayment(self):
        """Guards the reorder fix: real I&W line must not contain felt/underlayment,
        otherwise anchoring the match (not reordering) would have been required."""
        low = ICE_WATER.lower()
        self.assertNotIn("felt", low)
        self.assertNotIn("underlayment", low)

    def test_explicit_iws_code_unaffected_by_desc(self):
        """Explicit RFG IWS code still wins (description fallback only fires w/o code)."""
        c = get_code_citation("RFG IWS", "install", "NY", FELT_15)
        self.assertEqual(c["section"], "R905.1.2")
        self.assertTrue(_has_weatherwatch(c))


class TestRegressionUnchanged(unittest.TestCase):
    """(c) Items unrelated to the reorder must resolve exactly as before."""

    def test_drip_edge_unchanged(self):
        c = get_code_citation("", "install", "NY", "Drip edge")
        self.assertIsNotNone(c)
        self.assertEqual(c["section"], "R905.2.8.5")

    def test_starter_unchanged(self):
        c = get_code_citation("", "install", "NY", "Starter course / strip")
        self.assertIsNotNone(c)
        self.assertEqual(c["section"], "R905.1")

    def test_step_flashing_unchanged(self):
        c = get_code_citation("", "install", "NY", "Step flashing")
        self.assertIsNotNone(c)
        self.assertEqual(c["section"], "R905.2.8.3")

    def test_pipe_boot_unchanged_not_drip_edge(self):
        """pipe boot must resolve to R905.2.8 (general flashing), NOT drip edge R905.2.8.5."""
        c = get_code_citation("", "install", "NY", "Pipe boot / pipe jack flashing")
        self.assertIsNotNone(c)
        self.assertEqual(c["section"], "R905.2.8")
        self.assertNotEqual(c["section"], "R905.2.8.5")

    def test_house_wrap_unchanged(self):
        c = get_code_citation("", "r&r", "NY", "House wrap / weather-resistive barrier")
        self.assertIsNotNone(c)
        self.assertEqual(c["section"], "R703.2")


if __name__ == "__main__":
    unittest.main(verbosity=2)
