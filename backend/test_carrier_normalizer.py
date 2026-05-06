"""Lock-in tests for canonical_carrier_name() — every observed spelling
in production carrier_tactics + claim_outcomes (as of 2026-05-05) must
route to the expected canonical bucket.

Run: python3 test_carrier_normalizer.py
"""
from __future__ import annotations
import unittest
from carrier_normalizer import canonical_carrier_name, is_tpa, display_name


class CarrierNormalizerTests(unittest.TestCase):
    """Each test pairs (raw, canonical). Real-world spellings as observed."""

    def assert_canonical(self, raw: str, expected: str):
        self.assertEqual(canonical_carrier_name(raw), expected,
                         msg=f"{raw!r} should canonicalize to {expected!r}")

    # ── State Farm ──
    def test_state_farm_basic(self):
        self.assert_canonical("State Farm", "State Farm")
    def test_state_farm_trailing_space(self):
        self.assert_canonical("State Farm ", "State Farm")
    def test_state_farm_uppercase(self):
        self.assert_canonical("STATE FARM", "State Farm")
    def test_state_farm_full(self):
        self.assert_canonical("State Farm Fire and Casualty Company", "State Farm")

    # ── Liberty Mutual family ──
    def test_liberty_mutual_basic(self):
        self.assert_canonical("Liberty Mutual Insurance", "Liberty Mutual")
    def test_liberty_mutual_mid_atlantic(self):
        self.assert_canonical("Liberty Mutual Mid Atlantic Insurance Company", "Liberty Mutual")
    def test_liberty_mutual_first_liberty(self):
        self.assert_canonical("The First Liberty Insurance Corporation", "Liberty Mutual")
    def test_liberty_mutual_safeco(self):
        # Safeco is owned by Liberty Mutual
        self.assert_canonical("Safeco Insurance Company", "Liberty Mutual")
    def test_liberty_mutual_fire(self):
        self.assert_canonical("Liberty Mutual Fire Insurance Company", "Liberty Mutual")
    def test_liberty_mutual_short(self):
        self.assert_canonical("Liberty Mutual", "Liberty Mutual")

    # ── Travelers / Travco ──
    def test_travelers_travco(self):
        self.assert_canonical("Travco Insurance Company", "Travelers")
    def test_travelers_uppercase_travco(self):
        self.assert_canonical("TRAVCO INSURANCE COMPANY", "Travelers")
    def test_travelers_home_marine(self):
        self.assert_canonical("The Travelers Home and Marine Insurance Company", "Travelers")
    def test_travelers_compound(self):
        self.assert_canonical("Travelers / Travco Insurance Company", "Travelers")
    def test_travelers_parens(self):
        self.assert_canonical("Travelers Insurance Company (Travco Insurance Company)", "Travelers")
    def test_travelers_fidelity(self):
        # Fidelity and Guaranty Insurance Underwriters Inc. is a Travelers brand
        self.assert_canonical("FIDELITY AND GUARANTY INSURANCE UNDERWRITERS INC.", "Travelers")

    # ── Allstate family ──
    def test_allstate_basic(self):
        self.assert_canonical("Allstate Insurance Company", "Allstate")
    def test_allstate_nj(self):
        self.assert_canonical("Allstate New Jersey Insurance Company", "Allstate")
    def test_allstate_indemnity(self):
        self.assert_canonical("Allstate Indemnity Company", "Allstate")
    def test_allstate_vehicle_property(self):
        self.assert_canonical("Allstate Vehicle and Property Insurance Company", "Allstate")
    def test_allstate_paren(self):
        self.assert_canonical("Allstate Insurance Company (Allstate Indemnity Company)", "Allstate")

    # ── Farmers family (broad) ──
    def test_farmers_property_casualty(self):
        self.assert_canonical("Farmers Property and Casualty Insurance Company", "Farmers")
    def test_farmers_foremost(self):
        self.assert_canonical("Farmers Property and Casualty Insurance Company (Foremost Insurance Group)", "Farmers")
    def test_farmers_short(self):
        self.assert_canonical("Farmers", "Farmers")
    def test_farmers_exchange(self):
        self.assert_canonical("Farmers Insurance Exchange", "Farmers")
    def test_farmers_truck(self):
        self.assert_canonical("Truck Insurance Exchange (Farmers Insurance)", "Farmers")
    def test_farmers_mid_century(self):
        self.assert_canonical("Mid-Century Insurance Company", "Farmers")

    # ── USAA ──
    def test_usaa_basic(self):
        self.assert_canonical("USAA Casualty Insurance Company", "USAA")
    def test_usaa_general(self):
        self.assert_canonical("USAA General Indemnity Company", "USAA")
    def test_usaa_general_caps(self):
        self.assert_canonical("USAA GENERAL INDEMNITY COMPANY", "USAA")
    def test_usaa_full(self):
        self.assert_canonical("United Services Automobile Association", "USAA")

    # ── NYCM ──
    def test_nycm_basic(self):
        self.assert_canonical("NYCM Insurance", "NYCM")
    def test_nycm_full(self):
        self.assert_canonical("New York Central Mutual Fire Insurance Company (NYCM Insurance)", "NYCM")
    def test_nycm_alt(self):
        self.assert_canonical("New York Central Mutual Insurance", "NYCM")

    # ── Nationwide / Crestbrook ──
    def test_nationwide_general(self):
        self.assert_canonical("Nationwide General Insurance Company", "Nationwide")
    def test_nationwide_crestbrook(self):
        self.assert_canonical("Nationwide / Crestbrook Insurance (Private Client)", "Nationwide")
    def test_nationwide_pc(self):
        self.assert_canonical("Nationwide Property & Casualty Insurance Company", "Nationwide")

    # ── Encompass ──
    def test_encompass_natcat(self):
        self.assert_canonical("Encompass Insurance / National Catastrophe Center", "Encompass")
    def test_encompass_short(self):
        self.assert_canonical("Encompass / National Catastrophe Center", "Encompass")

    # ── Single-pattern carriers ──
    def test_columbia_lloyds(self):
        self.assert_canonical("Columbia Lloyds Insurance Co.", "Columbia Lloyds")
    def test_goodville(self):
        self.assert_canonical("Goodville Mutual Casualty Company", "Goodville Mutual")
    def test_hanover(self):
        self.assert_canonical("The Hanover Insurance Group", "Hanover")
    def test_guideone(self):
        self.assert_canonical("GuideOne", "GuideOne")
    def test_chubb(self):
        self.assert_canonical("CHUBB", "Chubb")
    def test_amica(self):
        self.assert_canonical("Amica Mutual Insurance Company", "Amica")
    def test_pure_caps(self):
        self.assert_canonical("PURE Insurance", "Pure")
    def test_pure_proper(self):
        self.assert_canonical("Pure Insurance", "Pure")
    def test_progressive_asi(self):
        self.assert_canonical("Progressive Insurance (ASI)", "Progressive")
    def test_homesite(self):
        self.assert_canonical("Homesite Insurance Company Of New York", "Homesite")
    def test_homesite_midwest(self):
        self.assert_canonical("Homesite Insurance Company of the Midwest", "Homesite")

    # ── TPAs (NOT carriers) ──
    def test_sedgwick_tpa(self):
        out = canonical_carrier_name("Sedgwick")
        self.assertEqual(out, "tpa:Sedgwick")
        self.assertTrue(is_tpa(out))
    def test_jsh_tpa(self):
        self.assertEqual(canonical_carrier_name("J.S. Held, LLC"), "tpa:J.S. Held")
    def test_dorner_tpa(self):
        self.assertEqual(canonical_carrier_name("John M Dorner Adjustment Company"), "tpa:John M Dorner")
    def test_eberl_tpa(self):
        self.assertEqual(canonical_carrier_name("Eberl Claims Service"), "tpa:Eberl Claims Service")
    def test_cis_tpa(self):
        self.assertEqual(canonical_carrier_name("CIS Specialty Claim Services"), "tpa:CIS Specialty")
    def test_decker_tpa(self):
        self.assertEqual(canonical_carrier_name("Decker Associates"), "tpa:Decker Associates")
    def test_lamarche_tpa(self):
        self.assertEqual(canonical_carrier_name("LaMarche Associates"), "tpa:LaMarche Associates")
    def test_pca_tpa(self):
        self.assertEqual(canonical_carrier_name("Professional Claims Adjustment, LLC"), "tpa:Professional Claims Adjustment")

    # ── Garbage / unusable ──
    def test_garbage_empty(self):
        self.assertEqual(canonical_carrier_name(""), "")
    def test_garbage_none(self):
        self.assertEqual(canonical_carrier_name(None), "")
    def test_garbage_question(self):
        self.assertEqual(canonical_carrier_name("?"), "")
    def test_garbage_na(self):
        self.assertEqual(canonical_carrier_name("N/A"), "")
        self.assertEqual(canonical_carrier_name("NA"), "")
        self.assertEqual(canonical_carrier_name("Not Available"), "")
    def test_garbage_unknown(self):
        self.assertEqual(canonical_carrier_name("Unknown"), "")
        self.assertEqual(canonical_carrier_name("Unknown - Inferred from IA Report"), "")
    def test_garbage_placeholder(self):
        self.assertEqual(canonical_carrier_name("Insurance Company Name"), "")
    def test_garbage_pending(self):
        self.assertEqual(canonical_carrier_name("Pending"), "")

    # ── Unknown carriers preserve cleanly ──
    def test_unknown_carrier_preserved(self):
        # Novel carrier that isn't in the alias map yet — should preserve
        # title-cased so it has its own bucket until we add a regex.
        self.assertEqual(canonical_carrier_name("Novel Carrier Co."), "Novel Carrier Co.")
        self.assertEqual(canonical_carrier_name("  weird   spacing  "), "Weird Spacing")

    # ── Whitespace-collapse fix (code review #1) ──
    def test_allstate_split_word(self):
        # "All State" with a space used to fall through to title-case fallback
        # creating an orphan bucket. Now collapses + matches Allstate.
        self.assertEqual(canonical_carrier_name("All State"), "Allstate")
        self.assertEqual(canonical_carrier_name("All State "), "Allstate")
        self.assertEqual(canonical_carrier_name("All state"), "Allstate")
    def test_nationwide_split_word(self):
        self.assertEqual(canonical_carrier_name("Nation wide"), "Nationwide")
        self.assertEqual(canonical_carrier_name("Nation Wide"), "Nationwide")
        self.assertEqual(canonical_carrier_name("nation wide "), "Nationwide")
    def test_extreme_whitespace_does_not_create_orphan(self):
        # Multiple spaces should still match canonical, not split into "Nation Wide".
        self.assertEqual(canonical_carrier_name("nation   wide"), "Nationwide")

    # ── Helpers ──
    def test_is_tpa(self):
        self.assertTrue(is_tpa("tpa:Sedgwick"))
        self.assertFalse(is_tpa("State Farm"))
        self.assertFalse(is_tpa(""))
    def test_display_name(self):
        self.assertEqual(display_name("tpa:Sedgwick"), "Sedgwick")
        self.assertEqual(display_name("State Farm"), "State Farm")


if __name__ == "__main__":
    unittest.main()
