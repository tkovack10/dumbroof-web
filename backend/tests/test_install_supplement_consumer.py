"""Ship 17 install-supplement CONSUMER wiring (check #1).

_handle_supplement_email now sources the supplement cover's itemized scope from the frozen
line_items tagged scope_timing=="install_supplement" (single source of truth, no separate
field). This locks in: only install-supplement items reach the cover; the existing cover PDF
renders them without error.

Run: python3 -m unittest tests.test_install_supplement_consumer -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from claim_brain_tools import _install_supplement_items  # noqa: E402


class InstallSupplementConsumerTests(unittest.TestCase):
    def test_sources_only_install_supplement_items(self):
        claim_data = {"claim_config": {"line_items": [
            {"description": "Laminated comp shingle roofing - w/out felt", "qty": 25, "unit_price": 300, "scope_timing": "initial"},
            {"description": "R&R Sheathing - plywood - 1/2\" CDX", "qty": 224, "unit_price": 2.86, "scope_timing": "install_supplement"},
            {"description": "R&R Drip edge - aluminum", "qty": 100, "unit_price": 4.25},  # untagged -> initial
        ]}}
        items = _install_supplement_items(claim_data)
        self.assertEqual(len(items), 1, "only the scope_timing=install_supplement line should source")
        self.assertTrue(items[0]["description"].startswith("R&R Sheathing"))
        self.assertEqual(items[0]["amount"], round(224 * 2.86, 2))

    def test_empty_when_no_install_supplement(self):
        claim_data = {"claim_config": {"line_items": [
            {"description": "shingle", "qty": 1, "unit_price": 100},                 # untagged
            {"description": "drip", "qty": 1, "unit_price": 5, "scope_timing": "initial"},
        ]}}
        self.assertEqual(_install_supplement_items(claim_data), [])

    def test_handles_missing_or_malformed_config(self):
        self.assertEqual(_install_supplement_items({}), [])
        self.assertEqual(_install_supplement_items({"claim_config": None}), [])
        self.assertEqual(_install_supplement_items({"claim_config": {}}), [])

    def test_cover_pdf_accepts_sourced_items(self):
        # Sourced items flow into the existing cover PDF machinery without error (smoke).
        from claim_brain_pdfs import generate_supplement_cover_pdf
        items = [{"description": "R&R Sheathing - plywood - 1/2\" CDX", "amount": 640.64}]
        pdf = generate_supplement_cover_pdf({"address": "1 Test St"}, {"company_name": "Co"}, items)
        self.assertTrue(isinstance(pdf, (bytes, bytearray)) and len(pdf) > 500)


if __name__ == "__main__":
    unittest.main()
