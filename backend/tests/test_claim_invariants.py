"""The OUTCOME / INVARIANT prevention gate — exercises claim_invariants.py.

TWO halves:

(A) CORPUS BATTERY — run the WHOLE invariant battery across EVERY committed
    golden_corpus fixture (rendering each forensic report once). A violation
    here is NOT a test bug — it surfaces a REAL latent defect that the
    byte-stable snapshot gate cannot see. We REPORT every violation (printed +
    asserted) rather than silently passing. Pre-existing latent violations are
    enumerated in ``KNOWN_LATENT_VIOLATIONS`` with the bug class + fixture so the
    gate stays green WHILE documenting the debt; any NEW or UNEXPECTED violation
    fails loudly.

(B) NEGATIVE TESTS — feed each invariant a deliberately BROKEN input and assert
    it FIRES. This proves the checks aren't hollow (a check that always returns
    [] would pass half (A) trivially).

Self-contained: plain unittest, no pytest.
    python3 backend/tests/test_claim_invariants.py
"""

from __future__ import annotations

import copy
import datetime as _dtmod
import glob
import json
import os
import sys
import tempfile
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
sys.path.insert(0, _BACKEND)
sys.path.insert(0, _HERE)

import claim_invariants as inv  # noqa: E402

# Reuse the golden-corpus render harness (clock freeze + tmp dirs + normalization
# of nondeterministic tokens) so we render forensic HTML EXACTLY as the snapshot
# gate does — same source of truth, no duplicate render plumbing.
import test_golden_forensic_corpus as gc  # noqa: E402

CORPUS_DIR = os.path.join(_HERE, "golden_corpus")
# NEW diverse fixtures live OUTSIDE golden_corpus/ so the WS-0 snapshot gate
# (which globs golden_corpus/*.json and requires a matching snapshot) stays
# exactly 23/23 — this gate is purely additive.
NEW_FIXTURE_DIR = os.path.join(_HERE, "fixtures", "invariant_corpus")


# ──────────────────────────────────────────────────────────────────────────
# Latent-violation ledger
# ──────────────────────────────────────────────────────────────────────────
# Each entry: fixture-id-prefix -> set of bug-class TAGS expected to fire on that
# committed fixture TODAY. These are REAL latent defects baked into the fixtures
# (predating the live production fixes on main); we record them so the gate is
# green while making the debt explicit. A fixture that fires a tag NOT listed
# here — or stops firing a listed one — fails the gate.
#
# Discovered empirically (see test_report_corpus_violations, which prints the
# full ledger). The dominant class is the pre-state-aware NY-8%-default tax leak
# (#7/E274) on non-NY fixtures captured before that fix shipped.
_TAG_TAX = "#7/E274"
_TAG_CLIMATE = "E269"
_TAG_TENANT = "E272"
_TAG_MATERIAL = "#4"
_TAG_HAIL = "#6"
_TAG_UNDERSCOPE = "E273"

_ALL_TAGS = (_TAG_TENANT, _TAG_CLIMATE, _TAG_TAX, _TAG_MATERIAL, _TAG_HAIL, _TAG_UNDERSCOPE)


def _tags_in(violations: list[str]) -> set[str]:
    out = set()
    for v in violations:
        for tag in _ALL_TAGS:
            if v.startswith(tag):
                out.add(tag)
    return out


def _load_fixtures():
    out = []
    for fp in sorted(glob.glob(os.path.join(CORPUS_DIR, "*.json"))):
        fid = os.path.splitext(os.path.basename(fp))[0]
        with open(fp, "r", encoding="utf-8") as f:
            out.append((fid, json.load(f)))
    return out


def _render_forensic(fixture: dict) -> str:
    """Render a fixture's forensic report to RAW html (we want the literal text,
    not the whitespace-collapsed snapshot, so phrase checks see real content)."""
    import usarm_pdf_generator as G

    config = copy.deepcopy(fixture["config"])
    tmp_photos = tempfile.mkdtemp(prefix="inv_photos_")
    tmp_output = tempfile.mkdtemp(prefix="inv_out_")
    config["_paths"] = {
        "claim_dir": tmp_output, "photos": tmp_photos,
        "output": tmp_output, "source_docs": tmp_output,
    }
    orig = _dtmod.datetime
    try:
        _dtmod.datetime = gc._FrozenDateTime
        path = G.build_forensic_report(config)
        with open(path, "r", encoding="utf-8") as f:
            html = f.read()
    finally:
        _dtmod.datetime = orig
    return html


# Computed once, shared across corpus tests.
def _scan_corpus():
    results = {}  # fid -> {"config":..., "violations":[...], "tags":set()}
    for fid, fixture in _load_fixtures():
        config = fixture["config"]
        html = _render_forensic(fixture)
        violations = inv.run_doc_battery(config, html)
        results[fid] = {
            "config": config,
            "html": html,
            "violations": violations,
            "tags": _tags_in(violations),
        }
    return results


_CORPUS_CACHE = None


def corpus():
    global _CORPUS_CACHE
    if _CORPUS_CACHE is None:
        _CORPUS_CACHE = _scan_corpus()
    return _CORPUS_CACHE


# ══════════════════════════════════════════════════════════════════════════
# (A) CORPUS BATTERY
# ══════════════════════════════════════════════════════════════════════════
class TestCorpusBattery(unittest.TestCase):

    def test_report_corpus_violations(self):
        """REPORT (do not hide) every invariant violation across the corpus.

        This always prints the full ledger so a human running the suite sees the
        latent debt. It asserts the corpus is non-empty (the gate must actually
        be exercising fixtures)."""
        c = corpus()
        self.assertGreaterEqual(len(c), 23, "expected the >=23 WS-0 golden fixtures")
        print("\n──── CLAIM-INVARIANT CORPUS LEDGER ────")
        any_v = False
        for fid in sorted(c):
            vs = c[fid]["violations"]
            if vs:
                any_v = True
                st = (c[fid]["config"].get("property") or {}).get("state", "?")
                print(f"  {fid[:18]} [{st}] :: {sorted(c[fid]['tags'])}")
                for v in vs:
                    print(f"      - {v}")
        if not any_v:
            print("  (no latent violations — corpus is clean)")
        print("───────────────────────────────────────")

    def test_no_tenant_identity_leak_in_corpus(self):
        """E272 — NO fixture may leak a USARM identity onto a non-USARM tenant.

        This is a HARD invariant: the E272 production fix already landed on main,
        so every committed fixture must be clean. Any hit is a real regression."""
        offenders = {fid: r["violations"] for fid, r in corpus().items()
                     if _TAG_TENANT in r["tags"]}
        self.assertEqual(offenders, {},
                         f"E272 tenant-identity leak in committed fixtures: {offenders}")

    def test_no_climate_text_leak_in_corpus(self):
        """E269 — no warm-state fixture may carry cold-climate ice-dam text.

        The E269 fix shipped; committed fixtures must be clean."""
        offenders = {fid: r["violations"] for fid, r in corpus().items()
                     if _TAG_CLIMATE in r["tags"]}
        self.assertEqual(offenders, {},
                         f"E269 cold-climate text on a warm-state fixture: {offenders}")

    def test_no_material_contradiction_in_corpus(self):
        """#4 — no fixture may assert two contradictory roof-surface materials
        for the SAME surface. Judged structurally (material_enum + shingle_type),
        so legitimate multi-structure dual-system properties (e.g. the MO fixture
        c7173e4f: metal main + shingle lower) do NOT fire. HARD invariant."""
        offenders = {fid: r["violations"] for fid, r in corpus().items()
                     if _TAG_MATERIAL in r["tags"]}
        self.assertEqual(offenders, {},
                         f"#4 contradictory roof material in fixtures: {offenders}")

    def test_corpus_material_false_positive_avoided(self):
        """Regression guard for the #4 design: the MO dual-roof-system fixture
        (legitimately metal main + asphalt lower) must NOT be flagged. A naive
        prose 'metal AND asphalt co-occur' check WOULD mis-fire here — proving why
        #4 is anchored on the structural source of truth, not rendered prose."""
        c = corpus()
        mo = c.get("c7173e4f-38de-415b-917e-f31f0bd30c92")
        self.assertIsNotNone(mo, "expected the MO dual-system fixture in the corpus")
        self.assertNotIn(_TAG_MATERIAL, mo["tags"],
                         "legitimate multi-structure dual roof wrongly flagged as a #4 contradiction")

    # The three corpus fixtures that render with NO near-property NOAA hail.
    # Ground truth established by READING each rendered report (not recomputed
    # from the invariant's own helpers — that would be tautological and could
    # launder a false positive into the lock):
    #   KS      08052909 — winter storm, but the NARRATIVE asserts hail causation
    #            ("scope of hail damage documented at this property",
    #             "attributable to the reported hail event"). GENUINE latent bug.
    #   IN_WIND 2afacee4 — high-wind claim; the ONLY hail token is the HAAG
    #            "Damage Criteria" boilerplate. NOT a bug.
    #   PA      eff5889b — same HAAG boilerplate only. NOT a bug.
    _HAIL_KS = "08052909-4d67-4b31-b735-eba46480c2e8"
    _HAIL_IN_WIND = "2afacee4-7939-4274-a0cb-8b1332bcc763"
    _HAIL_PA = "eff5889b-0cf4-4f21-8547-95b25d7a1987"

    def test_hail_without_noaa_latent_violations_reported(self):
        """#6 — REPORT (not hide) the fixtures whose forensic NARRATIVE asserts
        hail as the cause of loss while their storm-of-record carries NO NOAA
        hail and no measured hail size.

        The expected set is HAND-VERIFIED from the rendered reports (see the
        _HAIL_* constants above) — only the KS winter-storm fixture genuinely
        asserts hail causation without NOAA support. Locking to that constant
        means: a NEW unsupported-hail fixture trips the gate; a silently-'fixed'
        KS (config given NOAA hail, or prose de-hailed) also trips it; and a
        boilerplate-only false positive (the original build's bug) trips it too."""
        firing = {fid for fid, r in corpus().items() if _TAG_HAIL in r["tags"]}
        self.assertEqual(
            firing, {self._HAIL_KS},
            "#6 firing set drifted from the hand-verified expectation (only the "
            "KS winter-storm fixture genuinely asserts hail without NOAA).\n"
            f"  firing={sorted(firing)}\n  expected={[self._HAIL_KS]}")

    def test_hail_boilerplate_false_positive_avoided(self):
        """Regression guard for the #6 scrub (the #4-class lesson applied to
        hail): the IN-wind and PA fixtures DO carry a hail token in their
        rendered text — the HAAG "Damage Criteria" boilerplate — and have NO
        NOAA hail, so a NAIVE raw-prose scan WOULD mis-fire (exactly the false
        positives the first build produced). This proves the boilerplate scrub,
        not luck, is what keeps them quiet."""
        for fid in (self._HAIL_IN_WIND, self._HAIL_PA):
            r = corpus()[fid]
            raw_text = inv._visible_text(r["html"])
            # A naive scan (no scrub) DOES see a hail token ...
            self.assertTrue(
                inv._present_phrases(raw_text, inv._HAIL_DAMAGE_PHRASES),
                f"{fid[:8]}: expected the HAAG boilerplate hail token in raw text")
            self.assertFalse(inv._noaa_has_near_hail(r["config"]),
                             f"{fid[:8]}: expected no NOAA hail")
            # ... but after scrubbing, no CAUSAL hail language remains -> quiet.
            self.assertEqual(
                inv.check_hail_only_with_noaa(r["config"], r["html"]), [],
                f"{fid[:8]}: boilerplate-only hail mention must not fire #6")

    def test_tax_vs_state_latent_violations_are_exactly_the_known_set(self):
        """#7/E274 — the tax-vs-state invariant DOES fire on the pre-fix fixtures
        (proving the latent bug is real and the invariant is live). We assert the
        firing set is exactly the non-NY fixtures carrying the flat NY 8% default,
        so a NEW tax-leak fixture (or a silently-fixed one) trips the gate.

        These are LATENT BUGS in the committed fixtures — they were captured
        before the E275 state-aware-tax fix shipped to main. Reported, not hidden.
        """
        firing = {fid for fid, r in corpus().items() if _TAG_TAX in r["tags"]}
        # Independently recompute the EXPECTED set from first principles: any
        # non-NY fixture whose stored tax_rate is the flat 0.08 NY default, OR a
        # rate exceeding state_base+3%. (Mirrors the invariant's own logic, but
        # derived from the raw fixtures — not copied from a hand list — so the
        # ledger can't silently rot.)
        expected = set()
        for fid, r in corpus().items():
            cfg = r["config"]
            st = ((cfg.get("property") or {}).get("state") or "").upper()
            tr = (cfg.get("financials") or {}).get("tax_rate")
            if st in ("", "NY") or tr is None:
                continue
            try:
                tr = float(tr)
            except (TypeError, ValueError):
                continue
            base = inv._bc_lookup.get_sales_tax(st)
            if abs(tr - 0.08) < 1e-9 or tr > base + 0.03 + 1e-9:
                expected.add(fid)
        self.assertEqual(
            firing, expected,
            "tax-vs-state firing set drifted from the independently-derived "
            f"expectation.\n  firing={sorted(firing)}\n  expected={sorted(expected)}",
        )
        # And there really ARE latent tax bugs (the invariant is not hollow on
        # the corpus). If a future corpus refresh fixes them all, flip this to
        # assertEqual(firing, set()) — but that is a DELIBERATE corpus change.
        self.assertTrue(firing, "expected pre-fix fixtures to carry the NY-8% tax leak")


# ══════════════════════════════════════════════════════════════════════════
# (A.2) NEW DIVERSE FIXTURES — full battery on the added fixtures
# ══════════════════════════════════════════════════════════════════════════
def _load_new_fixture(name: str) -> dict:
    with open(os.path.join(NEW_FIXTURE_DIR, name), "r", encoding="utf-8") as f:
        return json.load(f)


class TestNewDiverseFixtures(unittest.TestCase):
    """The two added diverse fixtures (a warm-state TX external tenant with a
    blank/incomplete company profile, and a metal-roof claim) are CLEAN under the
    whole battery — they represent correct, modern claims. They also let the
    battery exercise paths the legacy golden corpus can't: a properly-zeroed TX
    tax, the E272 company-name inspector fallback, and a genuine metal roof that
    must NOT trip #4."""

    def test_tx_external_blank_profile_is_clean(self):
        fx = _load_new_fixture("tx_external_blank_profile.json")
        cfg = fx["config"]
        html = _render_forensic(fx)
        # Battery is clean.
        self.assertEqual(inv.run_doc_battery(cfg, html), [],
                         "TX external blank-profile fixture should be invariant-clean")
        # And specifically: no USARM identity leaked onto the external tenant.
        self.assertNotIn("Tom Kovack Jr.", html)
        self.assertNotIn("Zach Roberts", html)
        # And the TX tax is 0 (not the 8% leak).
        self.assertEqual(inv.check_tax_vs_state(cfg), [])

    def test_metal_roof_fixture_is_clean(self):
        fx = _load_new_fixture("metal_roof_oh.json")
        cfg = fx["config"]
        html = _render_forensic(fx)
        self.assertEqual(inv.run_doc_battery(cfg, html), [],
                         "metal-roof fixture should be invariant-clean")
        # A real metal roof must NOT trip the material-self-consistency check.
        self.assertEqual(inv.check_material_self_consistency(cfg, html), [])

    def test_broken_tx_fixture_trips_tax_invariant(self):
        """Deliberately re-inject the NY-8% leak into the TX fixture: the tax
        invariant must fire (proves the fixture exercises the gate, not decoration)."""
        fx = _load_new_fixture("tx_external_blank_profile.json")
        cfg = copy.deepcopy(fx["config"])
        cfg["financials"]["tax_rate"] = 0.08
        v = inv.check_tax_vs_state(cfg)
        self.assertTrue(v)
        self.assertIn("#7/E274", v[0])

    def test_broken_metal_fixture_trips_material_invariant(self):
        """Flip the metal fixture's human label to asphalt while the enum stays
        metal: #4 must fire (one surface, two contradictory coverings)."""
        fx = _load_new_fixture("metal_roof_oh.json")
        cfg = copy.deepcopy(fx["config"])
        cfg["structures"][0]["shingle_type"] = "Architectural Laminated Comp Shingle"
        v = inv.check_material_self_consistency(cfg, "")
        self.assertTrue(v)
        self.assertIn("#4", v[0])


# ══════════════════════════════════════════════════════════════════════════
# (B) NEGATIVE TESTS — each invariant must FIRE on a deliberately broken input
# ══════════════════════════════════════════════════════════════════════════

def _min_config(**over):
    """A minimal but valid forensic config (reused from the inspector-leak test
    shape). Override any top-level key via kwargs."""
    cfg = {
        "phase": "post-scope",
        "company": {"name": "USA ROOF MASTERS", "tagline": "", "ceo_name": "Tom Kovack Jr.",
                    "ceo_title": "CEO", "email": "t@x.com", "cell_phone": "", "office_phone": "", "website": ""},
        "property": {"address": "1 Test St, Town, TX 77000", "city": "Town", "state": "TX", "zip": "77000"},
        "insured": {"name": "Jane Homeowner", "type": "homeowner"},
        "carrier": {"name": "State Farm", "claim_number": "CLM-1", "policy_number": "POL-9"},
        "dates": {"date_of_loss": "March 16, 2026", "report_date": "March 20, 2026",
                  "usarm_inspection_date": "March 18, 2026"},
        "inspectors": {"usarm_inspector": "Zach", "usarm_title": "Inspector"},
        "scope": {"trades": ["roofing"], "o_and_p": False},
        "financials": {"tax_rate": 0.0, "price_list": "TXHO26", "deductible": 0},
        "structures": [{"name": "Main Dwelling", "roof_area_sf": 2500, "roof_area_sq": 25,
                        "facets": 6, "predominant_pitch": "6/12", "style": "gable",
                        "shingle_type": "laminate", "shingle_condition": "fair"}],
        "weather": {"hail_size": "1.75 inches", "storm_date": "March 16, 2026",
                    "storm_description": "Hail event near property"},
        "measurements": {"eave": 120, "rake": 80, "total_area": 2500},
        "line_items": [{"category": "ROOFING", "description": "R&R Shingle", "qty": 25,
                        "unit": "SQ", "unit_price": 300.0, "trade": "roofing"}],
        "photo_annotations": {}, "photo_sections": [],
        "forensic_findings": {"damage_summary": "Storm damage observed.",
                              "code_violations": [], "key_arguments": [], "total_photos": 5},
        "appeal_letter": {"demand_items": [], "enclosed_documents": [], "requested_actions": []},
        "cover_letter": {},
    }
    for k, v in over.items():
        cfg[k] = v
    return cfg


class TestNegativeTenantIdentity(unittest.TestCase):
    def test_fires_on_external_tenant_with_usarm_inspector(self):
        cfg = _min_config(company={"name": "RoofBuds Roofing", "ceo_name": "", "ceo_title": "",
                                   "tagline": "", "email": "", "cell_phone": "", "office_phone": "", "website": ""})
        html = "<html>Inspector: Tom Kovack Jr. — Owner. Storm damage report.</html>"
        v = inv.check_tenant_identity_leak(cfg, html)
        self.assertTrue(v, "must FIRE: USARM owner name on an external tenant's doc")
        self.assertIn("E272", v[0])

    def test_fires_on_zach_leak_external(self):
        cfg = _min_config(company={"name": "Storm Nation", "ceo_name": "", "ceo_title": "",
                                   "tagline": "", "email": "", "cell_phone": "", "office_phone": "", "website": ""})
        html = "<html>Zach Roberts, HAAG Certified Inspector</html>"
        self.assertTrue(inv.check_tenant_identity_leak(cfg, html))

    def test_quiet_for_usarm_tenant(self):
        cfg = _min_config(company={"name": "USA ROOF MASTERS", "ceo_name": "Tom Kovack Jr.", "ceo_title": "CEO",
                                   "tagline": "", "email": "", "cell_phone": "", "office_phone": "", "website": ""})
        html = "<html>Zach Roberts. Tom Kovack Jr.</html>"
        self.assertEqual(inv.check_tenant_identity_leak(cfg, html), [],
                         "USARM identities are legitimate on USARM's own docs")


class TestNegativeClimateText(unittest.TestCase):
    def test_fires_on_tx_with_cold_text(self):
        cfg = _min_config(property={"address": "x", "city": "Amarillo", "state": "TX", "zip": "79101"})
        html = ("<html>Ice barrier required ... min 2 feet inside exterior wall line "
                "(Climate Zones 5A+ including OH/NY).</html>")
        v = inv.check_climate_text_vs_state(cfg, html)
        self.assertTrue(v, "must FIRE: cold-climate ice-dam text on a warm TX claim")
        self.assertIn("E269", v[0])

    def test_quiet_for_cold_state(self):
        cfg = _min_config(property={"address": "x", "city": "Albany", "state": "NY", "zip": "12207"})
        html = "<html>... (Climate Zones 5A+ including OH/NY) ...</html>"
        self.assertEqual(inv.check_climate_text_vs_state(cfg, html), [],
                         "cold state: the cold-climate text is correct")

    def test_quiet_for_warm_state_with_manufacturer_reframe(self):
        cfg = _min_config(property={"address": "x", "city": "Houston", "state": "TX", "zip": "77002"})
        html = ("<html>Ice & water barrier required at valleys and roof penetrations per the "
                "manufacturer's installation instructions — enforceable as code under R905.1.</html>")
        self.assertEqual(inv.check_climate_text_vs_state(cfg, html), [],
                         "warm reframe (R905.1, no cold literals) is correct")


class TestNegativeTaxVsState(unittest.TestCase):
    def test_fires_on_tx_with_ny_default_rate(self):
        cfg = _min_config(property={"address": "x", "city": "Dallas", "state": "TX", "zip": "75201"},
                          financials={"tax_rate": 0.08, "price_list": "TXHO26", "deductible": 0})
        v = inv.check_tax_vs_state(cfg)
        self.assertTrue(v, "must FIRE: flat NY 8% default on a TX claim")
        self.assertIn("#7/E274", v[0])

    def test_fires_on_fl_with_ny_default_rate(self):
        cfg = _min_config(property={"address": "x", "city": "Miami", "state": "FL", "zip": "33101"},
                          financials={"tax_rate": 0.08})
        self.assertTrue(inv.check_tax_vs_state(cfg))

    def test_quiet_for_ny_at_8pct(self):
        cfg = _min_config(property={"address": "x", "city": "Albany", "state": "NY", "zip": "12207"},
                          financials={"tax_rate": 0.08})
        self.assertEqual(inv.check_tax_vs_state(cfg), [], "NY's real rate IS 8%")

    def test_quiet_for_pa_at_zero(self):
        cfg = _min_config(property={"address": "x", "city": "Philadelphia", "state": "PA", "zip": "19103"},
                          financials={"tax_rate": 0.0})
        self.assertEqual(inv.check_tax_vs_state(cfg), [], "PA = 0% is correct")

    def test_quiet_for_nj_at_local_rate(self):
        cfg = _min_config(property={"address": "x", "city": "Newark", "state": "NJ", "zip": "07101"},
                          financials={"tax_rate": 0.06625})
        self.assertEqual(inv.check_tax_vs_state(cfg), [], "NJ 6.625% is its real rate")


class TestNegativeCarrierUnderscope(unittest.TestCase):
    def test_fires_on_phantom_additive_area(self):
        result = {
            "tactics_found": [{
                "tactic": "Roof area underscope",
                "severity": "high",
                "detail": "Our scope is 43.24 SQ but the carrier only paid 17.3 SQ — 60% underscoped",
                "counter_argument": "Demand the full 43.24 SQ.",
                "dollar_impact_estimate": 5800,
            }],
            "overall_assessment": "Carrier underscoped the roof.",
            "supplement_priority": ["roof area"],
        }
        v = inv.check_carrier_underscope_area(result, measured_roof_sf=1740)  # 17.4 SQ
        self.assertTrue(v, "must FIRE: 43.24 SQ cited vs a 17.4 SQ measured roof")
        self.assertIn("E273", v[0])

    def test_quiet_on_legitimate_underscope(self):
        result = {
            "tactics_found": [{
                "tactic": "Missing I&W",
                "severity": "medium",
                "detail": "Carrier omitted ice & water barrier at valleys.",
                "counter_argument": "Add I&W per manufacturer spec.",
            }],
            "overall_assessment": "Accessory items missing.",
            "supplement_priority": ["ice & water"],
        }
        self.assertEqual(inv.check_carrier_underscope_area(result, measured_roof_sf=1740), [],
                         "a real accessory underscope (no phantom area) must not fire")

    def test_fires_via_config_roof_area(self):
        """Config-driven path: resolve the roof area from the config (gated on
        the production has_measurements) and still catch the phantom."""
        cfg = _min_config()  # structures[0].roof_area_sf = 2500 -> 25 SQ
        self.assertTrue(inv._compliance_report.has_measurements(cfg))
        self.assertAlmostEqual(inv.measured_roof_sf_from_config(cfg), 2500.0)
        result = {"tactics_found": [{
            "tactic": "Roof area underscope",
            "detail": "Our scope is 71 SQ vs carrier 25 SQ — massively underscoped",
            "counter_argument": "Demand 71 SQ.",
        }]}
        v = inv.check_carrier_underscope_area(result, config=cfg)
        self.assertTrue(v, "must FIRE: 71 SQ cited vs the config's 25 SQ measured roof")
        self.assertIn("E273", v[0])

    def test_abstains_without_measurements(self):
        """No usable measurements (the E273 root-cause denominator=0) -> abstain,
        never invent an area."""
        cfg = _min_config(measurements={}, structures=[{"name": "Main"}])
        self.assertFalse(inv._compliance_report.has_measurements(cfg))
        result = {"tactics_found": [{"tactic": "x", "detail": "100 SQ vs 10 SQ"}]}
        self.assertEqual(inv.check_carrier_underscope_area(result, config=cfg), [],
                         "with no measured denominator the invariant must abstain")


class TestNegativeMaterialSelfConsistency(unittest.TestCase):
    """#4 is judged from the STRUCTURAL source of truth (the canonical
    material_enum + per-structure shingle_type label), NOT prose — because a
    forensic report legitimately mentions multiple materials (HAAG methodology
    boilerplate, metal siding, rooftop-HVAC housings, multi-structure dual
    systems). See test_corpus_material_false_positive_avoided for the real
    fixtures that prove the prose approach would mis-fire."""

    def test_fires_on_enum_vs_label_contradiction(self):
        """enum=metal but the structure's human label says asphalt laminate ->
        a single surface asserting two contradictory coverings."""
        cfg = _min_config(
            roof_material_enum="metal",
            structures=[{"name": "Main", "roof_area_sf": 2500, "roof_area_sq": 25,
                         "facets": 6, "predominant_pitch": "6/12", "style": "gable",
                         "roof_material_enum": "metal",
                         "shingle_type": "Architectural Laminated Comp Shingle"}],
        )
        v = inv.check_material_self_consistency(cfg, "")
        self.assertTrue(v, "must FIRE: enum=metal contradicts an asphalt label on one surface")
        self.assertIn("#4", v[0])

    def test_fires_on_single_label_naming_two_families(self):
        cfg = _min_config(
            structures=[{"name": "Main", "roof_area_sf": 2500, "roof_area_sq": 25,
                         "shingle_type": "asphalt shingle / standing seam metal roof"}],
        )
        v = inv.check_material_self_consistency(cfg, "")
        self.assertTrue(v, "must FIRE: one shingle_type label names asphalt AND metal")
        self.assertIn("#4", v[0])

    def test_fires_on_config_enum_vs_lone_structure(self):
        cfg = _min_config(
            roof_material_enum="metal",
            structures=[{"name": "Main", "roof_area_sf": 2500, "roof_area_sq": 25,
                         "roof_material_enum": "laminate", "shingle_type": "laminate"}],
        )
        v = inv.check_material_self_consistency(cfg, "")
        self.assertTrue(v, "must FIRE: config enum=metal vs the single structure's laminate")

    def test_quiet_on_consistent_metal_roof(self):
        cfg = _min_config(
            roof_material_enum="metal",
            structures=[{"name": "Main", "roof_area_sf": 2500, "roof_area_sq": 25,
                         "roof_material_enum": "metal", "shingle_type": "Standing Seam Metal Roof"}],
        )
        self.assertEqual(inv.check_material_self_consistency(cfg, ""), [],
                         "a consistent metal roof must not fire")

    def test_quiet_on_multi_structure_dual_system(self):
        """A LEGITIMATE dual-system property (metal main + asphalt addition on
        SEPARATE structures) is NOT a contradiction."""
        cfg = _min_config(
            structures=[
                {"name": "Main", "roof_area_sf": 1800, "roof_material_enum": "metal",
                 "shingle_type": "Standing Seam Metal Roof"},
                {"name": "Addition", "roof_area_sf": 700, "roof_material_enum": "laminate",
                 "shingle_type": "Architectural Laminated Comp Shingle"},
            ],
        )
        self.assertEqual(inv.check_material_self_consistency(cfg, ""), [],
                         "different coverings on different structures is legitimate")

    def test_quiet_on_legacy_config_without_enum(self):
        """The golden corpus carries NO enum; a label-only asphalt roof must not
        false-fire just because prose elsewhere mentions metal."""
        cfg = _min_config(
            structures=[{"name": "Main", "roof_area_sf": 2500,
                         "shingle_type": "Architectural Laminated Comp Shingle"}],
        )
        self.assertEqual(inv.check_material_self_consistency(cfg, ""), [])


class TestNegativeHailOnlyWithNoaa(unittest.TestCase):
    def test_fires_on_hail_language_without_noaa(self):
        cfg = _min_config(weather={"hail_size": "", "storm_date": "March 16, 2026",
                                   "storm_description": "Wind event near property",
                                   "noaa": {"events": [
                                       {"event_type": "Thunderstorm Wind", "distance_miles": 2.0}]}})
        html = "<html>Extensive hail damage observed across all roof slopes; hail bruising on shingles.</html>"
        v = inv.check_hail_only_with_noaa(cfg, html)
        self.assertTrue(v, "must FIRE: hail-damage language with NO NOAA hail")
        self.assertIn("#6", v[0])

    def test_quiet_with_measured_hail_size(self):
        cfg = _min_config(weather={"hail_size": "1.75 inches", "storm_date": "x", "storm_description": "Hail"})
        html = "<html>Hail damage observed; hailstone impacts on the soft metals.</html>"
        self.assertEqual(inv.check_hail_only_with_noaa(cfg, html), [],
                         "measured hail size supports hail language")

    def test_quiet_with_near_noaa_hail_event(self):
        cfg = _min_config(weather={"hail_size": "", "storm_date": "x", "storm_description": "Storm",
                                   "noaa": {"events": [{"event_type": "Hail", "distance_miles": 0.8,
                                                        "magnitude": 1.75}]}})
        html = "<html>Hail impact damage consistent with the storm of record.</html>"
        self.assertEqual(inv.check_hail_only_with_noaa(cfg, html), [],
                         "a near-property NOAA hail event supports hail language")

    def test_quiet_when_no_hail_language(self):
        cfg = _min_config(weather={"hail_size": "", "storm_date": "x", "storm_description": "Wind"})
        html = "<html>Wind damage: lifted and creased shingles along the windward slope.</html>"
        self.assertEqual(inv.check_hail_only_with_noaa(cfg, html), [],
                         "no hail language -> nothing to support")

    def test_quiet_on_haag_boilerplate_only(self):
        """The HAAG 'Damage Criteria' definitional line mentions 'hail damage' in
        EVERY report regardless of peril — it is scaffolding, not a causal claim,
        so it must NOT fire even with no NOAA hail (the IN-wind / PA bug class)."""
        cfg = _min_config(weather={"hail_size": "", "storm_date": "x",
                                   "storm_description": "Straight-line wind event",
                                   "noaa": {"events": [
                                       {"event_type": "Thunderstorm Wind", "distance_miles": 1.0}]}})
        html = ("<html><p>Per HAAG Engineering criteria, hail damage to asphalt shingles "
                "is identified by:</p><ul><li>Circular indentations with granule "
                "displacement</li></ul><p>Wind damage: creased and lifted shingles along "
                "the windward slope.</p></html>")
        self.assertEqual(inv.check_hail_only_with_noaa(cfg, html), [],
                         "HAAG boilerplate alone (no causal hail assertion) must not fire")

    def test_quiet_on_differentiation_grid_hail_row_only(self):
        """A wind claim's differentiation grid lists 'Hail Impact' as a ruled-OUT
        potential cause; that generic row (rendered with the same injected
        <strong> tags the generator emits) must not trip #6 absent causal prose.
        Exercises the flatten-then-scrub path on real markup."""
        cfg = _min_config(weather={"hail_size": "", "storm_date": "x",
                                   "storm_description": "Wind", "noaa": {"events": []}})
        html = ("<html><h3>Damage Differentiation Analysis</h3><table>"
                "<tr><th>Potential Cause</th><th>Expected Characteristics</th>"
                "<th>Observed?</th><th>Conclusion</th></tr>"
                "<tr><td><strong>Hail Impact</strong></td>"
                "<td><strong>Circular</strong> /oval depressions with <strong>granule "
                "displacement</strong> , <strong>mat fracture</strong> , soft metal denting</td>"
                "<td><strong style=\"color:#c8102e;\">No</strong></td>"
                "<td><strong style=\"color:#c8102e;\">NOT CONSISTENT</strong></td></tr></table>"
                "<p>Directional creasing confirms wind as the proximate cause.</p></html>")
        self.assertEqual(inv.check_hail_only_with_noaa(cfg, html), [],
                         "generic differentiation hail row must not fire absent causal prose")

    def test_fires_on_causal_hail_despite_boilerplate(self):
        """A report carrying BOTH the HAAG boilerplate AND a genuine causal hail
        assertion (the KS bug shape) must still fire when NOAA shows no hail —
        proves the scrub is not so aggressive it goes hollow."""
        cfg = _min_config(weather={"hail_size": "", "storm_date": "x",
                                   "storm_description": "Winter storm", "noaa": {"events": []}})
        html = ("<html><p>Per HAAG Engineering criteria, hail damage to asphalt shingles "
                "is identified by: circular indentations.</p>"
                "<p>The carrier's scope does not reflect the scope of hail damage "
                "documented at this property; damage is attributable to the reported "
                "hail event.</p></html>")
        v = inv.check_hail_only_with_noaa(cfg, html)
        self.assertTrue(v, "must FIRE: causal hail assertion survives boilerplate scrub")
        self.assertIn("#6", v[0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
