"""
Grounding-scrub regression tests (damage_detective #18).

#18 = "unsupported causal/temporal inferences stated as fact." It was the only one
of damage_detective #17/#18/#19 still OPEN -- #17 (EPDM-on-shingle) and #19
(laminated default) were already fixed in prod by WS-3 (#82) and are regression-
locked by claim-invariants. This is the real fix for #18.

The fix has three parts in processor.py:
  1. a GROUNDING block in the analyze_photos vision prompt,
  2. a GROUNDING rule line in each synthesis prompt (exec summary + conclusion), and
  3. a post-synthesis FLAG scrub (_find_ungrounded_inferences /
     _flag_ungrounded_inference / _flag_ungrounded_paragraphs), wired at the
     synthesis call sites after the weasel scrub.

The scrub is deliberately CONSERVATIVE: it flags ungrounded dates/durations and
absence-of-degradation verdicts, but must NEVER flag grounded recency tied to a
visible cue ("no rust confirms recent loss") or "consistent with X" cause language
-- those are legitimate forensic indicators the wind/hail methodology relies on.

Also locks the _strip_weasel_advocacy `dropped`-counter against the
UnboundLocalError class. (Verified NOT a live bug -- `dropped = 0` is correctly
initialised; this keeps it so.)

Self-contained: `python tests/test_photo_grounding.py`. Also collected by pytest.
"""
from __future__ import annotations

import inspect
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import processor


# ----- The scrub FLAGS ungrounded inference -----
def test_flags_duration_over_multiple_seasons():
    found = processor._find_ungrounded_inferences(
        "The granule loss accumulated over multiple seasons of exposure."
    )
    assert found, "expected 'over multiple seasons' to be flagged"
    assert any(cat == "duration" for cat, _ in found)


def test_flags_deteriorated_over_years():
    found = processor._find_ungrounded_inferences(
        "The shingles deteriorated over several years of weathering."
    )
    assert any(cat == "duration" for cat, _ in found)


def test_flags_manufacturing_defect_verdict():
    found = processor._find_ungrounded_inferences(
        "There is no manufacturing defect; the damage is impact-driven."
    )
    assert any(cat == "verdict" for cat, _ in found), found


def test_flags_no_adhesive_degradation_verdict():
    found = processor._find_ungrounded_inferences(
        "No adhesive degradation visible at the seal line."
    )
    assert any(cat == "verdict" for cat, _ in found), found


def test_flags_bare_named_storm_date():
    found = processor._find_ungrounded_inferences(
        "The roof was damaged in the April 12 storm."
    )
    assert any(cat == "date" for cat, _ in found), found


def test_flags_year_hail_event():
    found = processor._find_ungrounded_inferences(
        "This is attributable to the 2023 hail event."
    )
    assert any(cat == "date" for cat, _ in found), found


# ----- The scrub does NOT flag GROUNDED language (the critical nuance) -----
def test_does_not_flag_no_rust_recency():
    found = processor._find_ungrounded_inferences(
        "The absence of rust on the exposed mat confirms a recent loss."
    )
    assert found == [], f"grounded recency wrongly flagged: {found}"


def test_does_not_flag_bright_metal_recency():
    found = processor._find_ungrounded_inferences(
        "Bright, un-oxidized fracture faces indicate recent impact."
    )
    assert found == [], f"grounded recency wrongly flagged: {found}"


def test_does_not_flag_consistent_with_hail():
    found = processor._find_ungrounded_inferences(
        "The circular depressions are consistent with hail impact."
    )
    assert found == [], f"'consistent with' cause wrongly flagged: {found}"


def test_does_not_flag_consistent_with_wind():
    found = processor._find_ungrounded_inferences(
        "The directional creasing is consistent with wind uplift."
    )
    assert found == [], f"'consistent with' cause wrongly flagged: {found}"


def test_does_not_flag_plain_finding():
    found = processor._find_ungrounded_inferences(
        "Functional damage confirmed: the mat is fractured and soft to the touch."
    )
    assert found == [], f"plain forensic finding wrongly flagged: {found}"


def test_does_not_flag_empty_or_none():
    assert processor._find_ungrounded_inferences("") == []
    assert processor._find_ungrounded_inferences(None) == []


# ----- FLAG, never delete -----
def test_flag_returns_text_unchanged_when_ungrounded():
    text = "The damage accumulated over multiple seasons. Impact bruising confirmed."
    assert processor._flag_ungrounded_inference(text) == text


def test_flag_returns_text_unchanged_when_clean():
    text = "Hail bruising consistent with impact; no rust confirms recent loss."
    assert processor._flag_ungrounded_inference(text) == text


def test_flag_paragraphs_returns_list_unchanged():
    paras = ["Functional damage confirmed.", "Deteriorated over several years."]
    assert processor._flag_ungrounded_paragraphs(paras) == paras


def test_flag_paragraphs_empty():
    assert processor._flag_ungrounded_paragraphs([]) == []


# ----- The prompts carry the grounding guidance -----
def test_photo_prompt_has_grounding_block():
    src = inspect.getsource(processor.analyze_photos)
    assert "damage_detective #18" in src, "photo prompt missing #18 grounding marker"
    assert "over multiple seasons" in src, "photo prompt missing duration ban"
    assert "no rust" in src.lower(), "photo prompt dropped the grounded-recency carve-out"


def test_exec_summary_prompt_has_grounding_line():
    src = inspect.getsource(processor.synthesize_executive_summary)
    assert "damage_detective #18" in src
    assert "consistent with" in src.lower()


def test_conclusion_prompt_has_grounding_line():
    src = inspect.getsource(processor.synthesize_conclusion)
    assert "damage_detective #18" in src
    assert "consistent with" in src.lower()


# ----- _strip_weasel_advocacy `dropped`-counter lock (verified NOT a live bug) -----
def test_strip_weasel_advocacy_no_match_runs_clean():
    paras = ["Functional damage confirmed.", "The mat is fractured and soft to the touch."]
    out = processor._strip_weasel_advocacy(paras)
    assert out == paras  # nothing stripped, no exception, `dropped` stayed 0


def test_strip_weasel_advocacy_empty_input():
    assert processor._strip_weasel_advocacy([]) == []


def test_strip_weasel_advocacy_returns_list_no_exception():
    # The function must always return a list and never raise (the
    # UnboundLocalError class) regardless of whether a sentence is dropped.
    out = processor._strip_weasel_advocacy(["A documented forensic finding sentence."])
    assert isinstance(out, list)


def _main():
    import traceback

    tests = [v for k, v in sorted(globals().items())
             if k.startswith("test_") and callable(v)]
    passed = 0
    failed = []
    for t in tests:
        try:
            t()
            passed += 1
        except Exception as e:  # noqa: BLE001
            failed.append(t.__name__)
            print(f"FAIL: {t.__name__}: {e}")
            traceback.print_exc()
    print("=" * 70)
    if failed:
        print(f"{len(failed)} test(s) FAILED: {failed}")
        sys.exit(1)
    print("ALL PHOTO-GROUNDING (#18) TESTS PASSED")
    print(f"  ({passed} tests)")
    print("=" * 70)


if __name__ == "__main__":
    _main()
