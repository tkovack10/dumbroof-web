"""Regression tests for E269 — the cold-climate ice-&-water justification leak.

E269 (LIVE production defect): the ice-barrier requirement text hardcoded a
cold-climate code mandate — "Climate Zones 5A+ including OH/NY" / "average daily
temperature in January is <=25F" — and emitted it for ANY claim with I&W in
scope. Warm-state claims (Amarillo TX, Glendale AZ, SC, FL) therefore carried an
ice-barrier citation justified by a cold-climate mandate that is FALSE there.

The CLIMATE-GATE ship is a REFRAME, NOT a removal (owner-chosen):
  * COLD states (IRC Climate Zone 5A+ — NY/OH/PA/NJ/…): UNCHANGED. Keep the
    cold-climate code-mandate citation verbatim.
  * WARM states (TX/AZ/SC/FL/…): the SAME I&W requirement is reframed onto the
    MANUFACTURER-installation-as-code basis ("required at valleys and roof
    penetrations per the manufacturer's installation instructions — enforceable
    under R905.1"), which is TRUE everywhere. The literal "Climate Zones 5A+
    including OH/NY" + the "January <=25F" rationale are DROPPED.
  * The I&W requirement / line item is KEPT in both — it is manufacturer-
    justified at valleys/penetrations. So the code_violations COUNT — and the
    damage_score — are UNCHANGED for both cold and warm.

This locks all FOUR I&W demand paths:
  1. code_compliance.get_code_citation        (Doc 06 + estimate citation)
  2. scope_comparison.rules.check_ice_water    (supplement comparison)
  3. damage_scoring.code_triggers              (score parity — text-independent)
  4. processor._build_code_violations          (forensic Doc 01 table)

Self-contained: plain unittest, no pytest dependency.
    python3 backend/tests/test_climate_gate_ice_barrier.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from building_codes import lookup as bc_lookup
from code_compliance import get_code_citation
from scope_comparison import rules as scope_rules
import processor

# Cold-climate literals that MUST NOT appear in any warm-state I&W justification.
COLD_LITERALS = ("OH/NY", "January", "Climate Zones 5A", "Climate Zone 5A")
MANUF_BASIS = "manufacturer"

COLD_STATES = ["NY", "OH", "PA", "NJ"]
WARM_STATES = ["TX", "AZ", "SC", "FL"]

ICE_WATER_DESC = "Ice & water barrier (2 courses eaves + 1 course valleys)"


def _no_cold_literal(text: str) -> bool:
    return all(lit not in (text or "") for lit in COLD_LITERALS)


# ──────────────────────────────────────────────────────────────────────
# PATH 0 — the data gate (state_codes.json code_mandated flag)
# ──────────────────────────────────────────────────────────────────────
class TestClimateFlag(unittest.TestCase):
    def test_irc_default_is_warm(self):
        self.assertFalse(bc_lookup.is_ice_barrier_code_mandated("IRC"))
        self.assertFalse(bc_lookup.get_ice_barrier("IRC")["code_mandated"])

    def test_cold_states_mandated(self):
        for st in COLD_STATES:
            self.assertTrue(bc_lookup.is_ice_barrier_code_mandated(st), f"{st} should be cold-mandated")

    def test_warm_states_not_mandated(self):
        for st in WARM_STATES:
            self.assertFalse(bc_lookup.is_ice_barrier_code_mandated(st), f"{st} should NOT be cold-mandated")

    def test_thin_override_inherits_default_ice_barrier_keys(self):
        """A cold state carrying only {code_mandated:true} still inherits the IRC
        default description/eave_courses/valley_* via the ice_barrier deep-merge."""
        ice = bc_lookup.get_ice_barrier("IA")  # IA = thin {code_mandated:true}
        self.assertTrue(ice["code_mandated"])
        self.assertEqual(ice["eave_courses"], 2)
        self.assertEqual(ice["valley_width_ft"], 3)
        self.assertEqual(ice["valley_sides"], 2)

    def test_named_full_block_states_unchanged_code_ref(self):
        """NY/OH/PA/NJ keep their own code_ref through the deep-merge."""
        self.assertEqual(bc_lookup.get_ice_barrier("NY")["code_ref"], "RCNYS R905.1.2")
        self.assertEqual(bc_lookup.get_ice_barrier("OH")["code_ref"], "RCO R905.1.2")
        self.assertEqual(bc_lookup.get_ice_barrier("PA")["code_ref"], "UCC R905.1.2")
        self.assertEqual(bc_lookup.get_ice_barrier("NJ")["code_ref"], "NJUCC R905.1.2")


# ──────────────────────────────────────────────────────────────────────
# PATH 1 — code_compliance.get_code_citation (citation engine)
# ──────────────────────────────────────────────────────────────────────
class TestCitationPath(unittest.TestCase):
    def test_warm_state_iw_reframed_to_manufacturer_basis(self):
        for st in WARM_STATES:
            c = get_code_citation("RFG IWS", "install", st, ICE_WATER_DESC)
            self.assertIsNotNone(c, f"{st}: I&W citation must STILL be emitted (kept, not dropped)")
            # reframed section + manufacturer basis present
            self.assertEqual(c["section"], "R905.1", f"{st}: warm I&W -> R905.1")
            self.assertIn(MANUF_BASIS, c["requirement"].lower())
            self.assertIn(MANUF_BASIS, c["supplement_argument"].lower())
            # no cold rationale anywhere in the citation text
            blob = " ".join([c["title"], c["requirement"], c["supplement_argument"], c["code_tag"]])
            self.assertTrue(_no_cold_literal(blob), f"{st}: cold literal leaked into citation: {blob}")

    def test_cold_state_iw_unchanged(self):
        for st in COLD_STATES:
            c = get_code_citation("RFG IWS", "install", st, ICE_WATER_DESC)
            self.assertIsNotNone(c)
            self.assertEqual(c["section"], "R905.1.2", f"{st}: cold I&W stays R905.1.2")

    def test_warm_iw_requirement_still_emitted(self):
        """The reframe KEEPS the requirement — get_code_citation never returns None."""
        for st in WARM_STATES:
            self.assertIsNotNone(get_code_citation("RFG IWS", "install", st, ICE_WATER_DESC))


# ──────────────────────────────────────────────────────────────────────
# PATH 2 — scope_comparison.rules.check_ice_water (supplement comparison)
# ──────────────────────────────────────────────────────────────────────
class TestScopeComparisonPath(unittest.TestCase):
    MEAS = {"eave_lf": 120, "valley_lf": 40}

    def _missing_finding(self, state):
        # carrier scope has NO I&W -> MISSING finding
        return scope_rules.check_ice_water([], self.MEAS, state=state)

    def _under_finding(self, state):
        # carrier scope has a tiny I&W qty -> UNDER_QTY finding
        carrier = [{"description": "Ice & water shield", "qty": 50, "extension": 117.5}]
        return scope_rules.check_ice_water(carrier, self.MEAS, state=state)

    def test_warm_missing_reframed_no_cold_literal_and_emitted(self):
        for st in WARM_STATES:
            f = self._missing_finding(st)
            self.assertIsNotNone(f, f"{st}: I&W finding must STILL fire (requirement kept)")
            self.assertTrue(_no_cold_literal(f.detail), f"{st}: cold literal in detail: {f.detail}")
            self.assertIn(MANUF_BASIS, f.detail.lower())
            self.assertTrue(f.code_reference.endswith("R905.1"), f"{st}: {f.code_reference}")

    def test_warm_under_qty_reframed_no_cold_literal_and_emitted(self):
        for st in WARM_STATES:
            f = self._under_finding(st)
            self.assertIsNotNone(f, f"{st}: under-qty I&W finding must STILL fire")
            self.assertTrue(_no_cold_literal(f.detail), f"{st}: cold literal in detail: {f.detail}")
            self.assertIn(MANUF_BASIS, f.detail.lower())
            self.assertTrue(f.code_reference.endswith("R905.1"))

    def test_cold_missing_unchanged(self):
        for st in COLD_STATES:
            f = self._missing_finding(st)
            self.assertIsNotNone(f)
            # cold path keeps the state code_ref (NOT the R905.1 manufacturer ref)
            self.assertFalse(f.code_reference.endswith("R905.1"), f"{st}: {f.code_reference}")

    def test_warm_required_sf_unchanged_vs_cold(self):
        """SCOPE (required SF / quantities) must be identical regardless of climate —
        only the justification text differs. Build a warm + cold finding on the SAME
        measurements and assert the correct_qty matches."""
        warm = self._missing_finding("TX")
        cold = self._missing_finding("NY")
        self.assertEqual(warm.correct_qty, cold.correct_qty)
        self.assertEqual(warm.unit, cold.unit)


# ──────────────────────────────────────────────────────────────────────
# PATH 4 — processor._build_code_violations (forensic Doc 01 table)
# ──────────────────────────────────────────────────────────────────────
_ROOF_ITEMS = [
    {"category": "ROOFING", "description": "Ice & water barrier (2 courses eaves + 1 course valleys)"},
    {"category": "ROOFING", "description": "Laminated comp. shingle"},
]


def _iw_violation(state):
    vios = processor._build_code_violations(state, _ROOF_ITEMS, ["ROOFING"])
    ice = [v for v in vios if "ice" in (v.get("requirement", "") + v.get("code", "")).lower()]
    return vios, ice


class TestForensicViolationsPath(unittest.TestCase):
    def test_warm_violation_reframed_kept_no_cold_literal(self):
        for st in WARM_STATES:
            vios, ice = _iw_violation(st)
            self.assertEqual(len(ice), 1, f"{st}: I&W violation must be KEPT (count=1)")
            iw = ice[0]
            self.assertTrue(iw["code"].endswith("R905.1"), f"{st}: {iw['code']}")
            self.assertIn(MANUF_BASIS, iw["requirement"].lower())
            self.assertTrue(_no_cold_literal(iw["requirement"]), f"{st}: {iw['requirement']}")

    def test_cold_violation_unchanged_keeps_cold_literal(self):
        for st in COLD_STATES:
            vios, ice = _iw_violation(st)
            self.assertEqual(len(ice), 1, f"{st}: cold I&W violation present")
            self.assertIn("OH/NY", ice[0]["requirement"], f"{st}: cold rationale verbatim")
            self.assertIn("January", ice[0]["requirement"])

    def test_damage_score_parity_violation_count_preserved(self):
        """damage_score parity: the I&W code_violation is PRESENT in BOTH a warm and
        a cold claim built on the same scope — and the total violation count matches —
        so the CT5 len(code_violations) tally (and thus the score) is unchanged."""
        warm_vios, warm_ice = _iw_violation("TX")
        cold_vios, cold_ice = _iw_violation("OH")
        self.assertEqual(len(warm_ice), 1)
        self.assertEqual(len(cold_ice), 1)
        # same scope -> same number of violations regardless of climate
        self.assertEqual(len(warm_vios), len(cold_vios),
                         "violation COUNT must be climate-invariant (score parity)")


if __name__ == "__main__":
    unittest.main(verbosity=2)
