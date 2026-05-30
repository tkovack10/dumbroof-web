"""Multi-tenancy hygiene: the inspector name must NEVER leak a USARM person
(the platform owner "Tom Kovack Jr." or the USARM inspector "Zach Roberts") onto
an EXTERNAL tenant's report.

Root cause (fixed): processor.py built
    config["inspectors"]["usarm_inspector"] = _contact_name or "Tom Kovack Jr."
so an external tenant with no resolved contact rendered the platform owner's name
as the inspector on their PDF. Fix: fall back to the tenant's OWN company name
(never a hardcoded USARM person). The generator's empty-name auto-default is
already USARM-gated (Zach only when the company is USA ROOF MASTERS).

Self-contained: python3 tests/test_inspector_name_leak.py
"""
import os
import sys
import tempfile
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
sys.path.insert(0, _BACKEND)

import usarm_pdf_generator as G  # noqa: E402

_OWNER = "Tom Kovack Jr."
_USARM_INSPECTOR = "Zach Roberts"


def _base(**over):
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


def _render(cfg):
    tmp = tempfile.mkdtemp(prefix="inspleak_")
    cfg = dict(cfg)
    cfg["_paths"] = {"claim_dir": tmp, "photos": tmp, "output": tmp, "source_docs": tmp}
    with open(G.build_forensic_report(cfg), "r", encoding="utf-8") as f:
        return f.read()


class TestInspectorNameLeak(unittest.TestCase):

    def test_external_tenant_company_fallback_no_owner_leak(self):
        """External tenant whose usarm_inspector resolved to their company name
        (what the fixed processor produces when no contact) must render THAT and
        never the platform owner / USARM inspector."""
        html = _render(_base(
            company={"name": "RoofBuds Roofing", "ceo_name": "", "ceo_title": "", "tagline": "",
                     "email": "", "cell_phone": "", "office_phone": "", "website": ""},
            inspectors={"usarm_inspector": "RoofBuds Roofing", "usarm_title": ""},
        ))
        self.assertNotIn(_OWNER, html, "platform owner name leaked onto an external tenant's report")
        self.assertNotIn(_USARM_INSPECTOR, html, "USARM inspector name leaked onto an external tenant")
        self.assertIn("RoofBuds Roofing", html)

    def test_external_tenant_empty_inspector_uses_contractor_not_homeowner(self):
        """Empty usarm_inspector on an external tenant must fall back to the
        CONTRACTOR's contact (never a USARM person, never the homeowner)."""
        html = _render(_base(
            company={"name": "RoofBuds Roofing", "ceo_name": "Guillermo Ortiz", "ceo_title": "Owner",
                     "tagline": "", "email": "", "cell_phone": "", "office_phone": "", "website": ""},
            insured={"name": "Harvey Homeowner DoNotInspect", "type": "homeowner"},
            inspectors={"usarm_inspector": "", "usarm_title": "Owner"},
        ))
        self.assertNotIn(_OWNER, html)
        self.assertNotIn(_USARM_INSPECTOR, html)
        # The inspector ROW must carry the contractor's contact, not the homeowner.
        import re
        m = re.search(r"Inspector\(s\)</strong></td><td>(.*?)</td>", html, re.S)
        self.assertIsNotNone(m, "inspector row not found in rendered report")
        inspector_cell = m.group(1)
        self.assertIn("Guillermo Ortiz", inspector_cell)
        self.assertNotIn("Harvey Homeowner", inspector_cell,
                         "homeowner name wrongly used as the inspector")

    def test_usarm_empty_inspector_still_gets_gated_default(self):
        """The USARM-gated default (Zach) must STILL work for USARM claims — the
        fix must not regress USARM's own behavior."""
        html = _render(_base(
            company={"name": "USA ROOF MASTERS", "ceo_name": "Tom Kovack Jr.", "ceo_title": "CEO",
                     "tagline": "", "email": "", "cell_phone": "", "office_phone": "", "website": ""},
            inspectors={"usarm_inspector": "", "usarm_title": ""},
        ))
        self.assertIn(_USARM_INSPECTOR, html, "USARM-gated inspector default regressed")

    def test_processor_source_has_no_hardcoded_owner_fallback(self):
        """Guard: the processor must not reintroduce the hardcoded owner fallback,
        and must keep the tenant-safe company-name fallback."""
        with open(os.path.join(_BACKEND, "processor.py"), "r", encoding="utf-8") as f:
            src = f.read()
        self.assertNotIn('or "Tom Kovack Jr."', src,
                         "hardcoded owner-name inspector fallback was reintroduced")
        self.assertIn('"usarm_inspector": _contact_name or (_cp.get("company_name")', src,
                      "tenant-safe company-name inspector fallback missing")


if __name__ == "__main__":
    unittest.main(verbosity=2)
