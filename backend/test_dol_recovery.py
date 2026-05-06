"""DOL recovery tests (E212 regression prevention).

Locks in:
- _normalize_date_iso accepts every common DOL format from the real
  carrier-scope corpus (MM/DD/YYYY, M/D/YY, ISO, "June 26, 2023").
- _recover_dol_from_text finds DOLs cited in carrier_arguments in the
  exact wording observed in production scopes.
- False positives are NOT extracted (line item dates, generic refs).

Run: python3 test_dol_recovery.py
"""
from __future__ import annotations
import unittest
from processor import _normalize_date_iso, _recover_dol_from_text


class NormalizeDateIsoTests(unittest.TestCase):
    def test_iso_passthrough(self):
        self.assertEqual(_normalize_date_iso("2023-06-26"), "2023-06-26")
    def test_us_slash_4digit(self):
        self.assertEqual(_normalize_date_iso("06/26/2023"), "2023-06-26")
        self.assertEqual(_normalize_date_iso("6/26/2023"), "2023-06-26")
    def test_us_dash_4digit(self):
        self.assertEqual(_normalize_date_iso("06-26-2023"), "2023-06-26")
    def test_us_2digit_year(self):
        self.assertEqual(_normalize_date_iso("6/26/23"), "2023-06-26")
        self.assertEqual(_normalize_date_iso("6/26/99"), "1999-06-26")
    def test_long_month(self):
        self.assertEqual(_normalize_date_iso("June 26, 2023"), "2023-06-26")
        self.assertEqual(_normalize_date_iso("Jun 26, 2023"), "2023-06-26")
        self.assertEqual(_normalize_date_iso("June 26 2023"), "2023-06-26")
    def test_unparseable(self):
        self.assertEqual(_normalize_date_iso(""), "")
        self.assertEqual(_normalize_date_iso("not a date"), "")
        self.assertEqual(_normalize_date_iso("13/42/9999"), "")  # Invalid month/day
    def test_whitespace_tolerant(self):
        self.assertEqual(_normalize_date_iso("  06/26/2023  "), "2023-06-26")


class RecoverDolFromTextTests(unittest.TestCase):
    """Exact wording from the real Camp Creek Ct, SC carrier scope (E212)."""

    def test_dated_phrase_real_world(self):
        # Verbatim from the SC claim's carrier_arguments.
        text = "Type of Loss: Hail damage dated 6/26/2023."
        self.assertEqual(_recover_dol_from_text([text]), "2023-06-26")

    def test_loss_occurred_on(self):
        text = "The loss occurred on 04/15/2025."
        self.assertEqual(_recover_dol_from_text([text]), "2025-04-15")

    def test_date_of_loss_colon(self):
        text = "Date of Loss: 9/30/2024"
        self.assertEqual(_recover_dol_from_text([text]), "2024-09-30")

    def test_dol_abbreviation(self):
        text = "DOL: 03-15-2024"
        self.assertEqual(_recover_dol_from_text([text]), "2024-03-15")

    def test_iso_in_text(self):
        text = "Storm event 2023-06-26 reported."
        self.assertEqual(_recover_dol_from_text([text]), "2023-06-26")

    def test_multiple_args_first_match_wins(self):
        # Pattern priority: "dated XX" beats other date refs in later strings.
        args = [
            "Other notes here.",
            "Hail damage dated 6/26/2023 affected the property.",
            "Estimate prepared 7/15/2023.",
        ]
        self.assertEqual(_recover_dol_from_text(args), "2023-06-26")

    def test_no_date_returns_empty(self):
        text = "Carrier acknowledges damage to roof system."
        self.assertEqual(_recover_dol_from_text([text]), "")

    def test_empty_input(self):
        self.assertEqual(_recover_dol_from_text([]), "")
        self.assertEqual(_recover_dol_from_text(""), "")
        self.assertEqual(_recover_dol_from_text(None), "")

    def test_string_input_accepted(self):
        # Helper accepts list OR string for caller convenience.
        self.assertEqual(_recover_dol_from_text("dated 6/26/2023"), "2023-06-26")

    def test_does_not_extract_estimate_date_alone(self):
        # When NO DOL phrasing exists, the ISO catch-all might match a generic
        # date — but the helper falls through to "" if nothing matches the
        # priority patterns AND nothing matches ISO. Test that bare "Estimate
        # date 7/15/2023" returns empty (it's not "dated", "loss", or "DOL:").
        text = "Estimate prepared 7/15/2023 by adjuster."
        self.assertEqual(_recover_dol_from_text([text]), "")

    def test_handles_non_string_items(self):
        # carrier_arguments is sometimes mixed (dicts from earlier extraction
        # iterations). Helper should coerce to string and search.
        args = [{"foo": "bar"}, "Hail damage dated 6/26/2023.", 42]
        self.assertEqual(_recover_dol_from_text(args), "2023-06-26")


if __name__ == "__main__":
    unittest.main()
