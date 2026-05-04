"""Track 1 — deterministic unit tests for governance v2 layers.

Run: `python3 -m pytest backend/richard_evals/track1_unit.py -v`

These tests exercise the pure-function layers we control:
- richard_middleware.detect_language()
- richard_middleware.is_per_claim_question()
- richard_middleware.GroundTruth.to_prompt_block()
- richard_post.evaluate_auto_chains()
- richard_post.reconcile_tool_result_against_ground_truth()
- richard_post.should_clear_working_memory()
- richard_post.WorkingMemory roundtrip
- richard_tool_preconditions.check_preconditions()
- claim_brain_tools._handle_preview_set_estimate_total() strategy correctness

No LLM calls. No Supabase calls. Runs in <1s. CI gate.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone, timedelta

# Make backend/ importable when running via pytest from repo root or backend/
_THIS = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_THIS)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import pytest

# Skip gracefully if a sister-PR's module isn't on this branch yet. Once
# all governance v2 PRs merge into main, all imports resolve and the
# whole suite runs. On an isolated PR branch (e.g. only Day 8-9 merged),
# ALL tests in this file get skipped — better than a failing CI gate
# that just means "not all sibling PRs are in yet."
pytest.importorskip("richard_middleware", reason="ships in Day 2-3a (PR #4)")
pytest.importorskip("richard_post", reason="ships in Day 5 (PR #7)")
pytest.importorskip("richard_tool_preconditions", reason="ships in Day 4 (PR #6)")


# ─── Language detection ─────────────────────────────────────────────────


@pytest.mark.parametrize("message,expected", [
    ("Hola, agrega un line item para 2 SQ de remove drip edge", "es"),
    ("Add a line item for 2 SQ of drip edge removal", "en"),
    ("Just say OPERATIONAL and stop", "en"),
    ("¿Cuántas fotos tengo?", "es"),  # diacritic
    ("What integrations do I have connected?", "en"),
    ("", "en"),  # empty defaults to en
    ("a", "en"),  # too short
    ("Necesito que agregues una línea para el techo", "es"),
])
def test_detect_language(message, expected):
    from richard_middleware import detect_language
    assert detect_language(message) == expected, f"failed for: {message!r}"


# ─── Per-claim question detection ───────────────────────────────────────


@pytest.mark.parametrize("message,expected", [
    ("How do I edit the report", True),
    ("add a line item for 2 SQ of drip edge", True),
    ("the carrier denied the supplement, what now?", True),
    ("reprocess this claim", True),
    ("send the email to State Farm", True),
    ("Help me connect Gmail", False),
    ("What integrations do I have?", False),
    ("I want to invite a new team member", False),
    ("How do I set up CompanyCam?", False),
])
def test_is_per_claim_question(message, expected):
    from richard_middleware import is_per_claim_question
    assert is_per_claim_question(message) == expected, f"failed for: {message!r}"


# ─── GroundTruth prompt block ───────────────────────────────────────────


def test_ground_truth_empty_returns_empty_block():
    from richard_middleware import GroundTruth
    assert GroundTruth().to_prompt_block() == ""


def test_ground_truth_populated_block_has_counts_and_trust_directive():
    from richard_middleware import GroundTruth
    gt = GroundTruth(photo_count=27, communication_count=3, line_item_count=18)
    block = gt.to_prompt_block()
    assert "GROUND TRUTH" in block
    assert "27" in block  # photo count
    assert "3" in block   # email count
    assert "18" in block  # line items
    assert "TRUST THEM" in block


def test_ground_truth_includes_total_rcv_when_set():
    from richard_middleware import GroundTruth
    gt = GroundTruth(photo_count=10, total_rcv=19632.14)
    block = gt.to_prompt_block()
    assert "$19,632.14" in block


# ─── Auto-chain rules ───────────────────────────────────────────────────


def test_auto_chain_fires_reprocess_when_user_says_reprocess_and_line_item_changed():
    from richard_post import evaluate_auto_chains
    chains = evaluate_auto_chains(
        "add a line item for $500 drip edge and reprocess",
        ["add_line_item"],
    )
    assert len(chains) == 1
    assert chains[0][0] == "trigger_reprocess"


def test_auto_chain_suppressed_if_reprocess_already_fired():
    from richard_post import evaluate_auto_chains
    chains = evaluate_auto_chains(
        "add a line item and reprocess",
        ["add_line_item", "trigger_reprocess"],
    )
    assert chains == []


def test_auto_chain_suppressed_if_user_didnt_say_reprocess():
    from richard_post import evaluate_auto_chains
    chains = evaluate_auto_chains(
        "add a line item for $500 drip edge",
        ["add_line_item"],
    )
    assert chains == []


def test_auto_chain_suppressed_if_no_state_change_tool_fired():
    from richard_post import evaluate_auto_chains
    chains = evaluate_auto_chains(
        "show me the timeline and reprocess",
        ["get_claim_timeline"],
    )
    assert chains == []


def test_auto_chain_matches_synonyms():
    from richard_post import evaluate_auto_chains
    for verb in ("regenerate", "rebuild", "update the report"):
        chains = evaluate_auto_chains(
            f"add line item and {verb}",
            ["add_line_item"],
        )
        assert len(chains) == 1, f"failed for synonym: {verb}"


# ─── Tool-result reconciler ─────────────────────────────────────────────


def test_reconciler_flags_large_gap():
    from richard_post import reconcile_tool_result_against_ground_truth
    note = reconcile_tool_result_against_ground_truth(
        "search_photos",
        {"data": {"photos": [1, 2, 3]}},
        {"photo_count": 27},
    )
    assert note is not None
    assert "3" in note and "27" in note


def test_reconciler_silent_on_full_match():
    from richard_post import reconcile_tool_result_against_ground_truth
    note = reconcile_tool_result_against_ground_truth(
        "search_photos",
        {"data": {"photos": [1] * 25}},
        {"photo_count": 27},
    )
    assert note is None


def test_reconciler_silent_on_unknown_tool():
    from richard_post import reconcile_tool_result_against_ground_truth
    note = reconcile_tool_result_against_ground_truth(
        "some_random_tool",
        {"data": {"items": []}},
        {"photo_count": 100},
    )
    assert note is None


# ─── Working memory clear rules ─────────────────────────────────────────


@pytest.mark.parametrize("trigger", [
    "forget that",
    "never mind",
    "let's switch topics",
    "new topic please",
    "different question",
    "start over",
])
def test_clear_triggers_match(trigger):
    from richard_post import should_clear_working_memory
    assert should_clear_working_memory(trigger, None) is True


def test_clear_does_not_match_normal_message():
    from richard_post import should_clear_working_memory
    assert should_clear_working_memory("add a line item", None) is False


def test_clear_silence_threshold():
    from richard_post import should_clear_working_memory
    old = datetime.now(timezone.utc) - timedelta(minutes=90)
    recent = datetime.now(timezone.utc) - timedelta(minutes=30)
    assert should_clear_working_memory("continue", old) is True
    assert should_clear_working_memory("continue", recent) is False


def test_working_memory_roundtrip():
    from richard_post import WorkingMemory
    wm = WorkingMemory(
        active_plan="adjust estimate to $19,632.14",
        completed_steps=["exclude_photo_from_claim"],
        pending_steps=["modify_line_item shingles"],
    )
    blob = wm.to_jsonb()
    restored = WorkingMemory.from_jsonb(blob)
    assert restored.active_plan == wm.active_plan
    assert restored.completed_steps == wm.completed_steps
    assert restored.pending_steps == wm.pending_steps


def test_working_memory_empty_yields_empty_block():
    from richard_post import WorkingMemory
    assert WorkingMemory().to_prompt_block() == ""


# ─── Tool preconditions ─────────────────────────────────────────────────


def test_invite_blocked_when_no_company_profile():
    """The Ronaldo case (governance v2 plan, mistake #7)."""
    from richard_tool_preconditions import check_preconditions
    res = check_preconditions(
        sb=None,
        tool_name="invite_team_member",
        claim_data={},
        company_profile={},  # empty profile
        user_id="ronaldomonroe070@gmail.com",
        tool_input={"email": "alice@example.com"},
    )
    assert res is not None
    assert res["action"] == "error"
    assert res["precondition_failed"] == "company_profile_incomplete"


def test_invite_blocked_when_role_insufficient():
    from richard_tool_preconditions import check_preconditions
    res = check_preconditions(
        sb=None,
        tool_name="invite_team_member",
        claim_data={},
        company_profile={"company_name": "Acme Roof", "contact_name": "Alice", "role": "member"},
        user_id="alice@example.com",
        tool_input={"email": "bob@example.com"},
    )
    assert res is not None
    assert res["precondition_failed"] == "insufficient_role"


def test_invite_blocked_when_email_missing():
    from richard_tool_preconditions import check_preconditions
    res = check_preconditions(
        sb=None,
        tool_name="invite_team_member",
        claim_data={},
        company_profile={"company_name": "Acme Roof", "contact_name": "Alice", "role": "owner"},
        user_id="alice@example.com",
        tool_input={},  # missing email
    )
    assert res is not None
    assert res["precondition_failed"] == "missing_or_invalid_email"


def test_invite_passes_when_all_preconditions_met():
    from richard_tool_preconditions import check_preconditions
    res = check_preconditions(
        sb=None,
        tool_name="invite_team_member",
        claim_data={},
        company_profile={"company_name": "Acme Roof", "contact_name": "Alice", "role": "owner"},
        user_id="alice@example.com",
        tool_input={"email": "bob@example.com"},
    )
    assert res is None


def test_unknown_tool_has_no_preconditions():
    from richard_tool_preconditions import check_preconditions
    res = check_preconditions(
        sb=None, tool_name="random_unknown_tool",
        claim_data={}, company_profile={}, user_id="x", tool_input={},
    )
    assert res is None


# ─── set_estimate_total strategy correctness ────────────────────────────


def test_set_estimate_total_default_strategy_is_balancing_line():
    from claim_brain_tools import _handle_preview_set_estimate_total
    res = _handle_preview_set_estimate_total(
        sb=None, claim_id="claim-x",
        claim_data={"contractor_rcv": 23421.93},
        tool_input={"target_total": 19632.14, "reason": "carrier-approved cap"},
    )
    assert res["action"] == "preview"
    preview = res["preview"]
    assert preview["strategy"] == "balancing_line"
    # delta = 19632.14 - 23421.93 = -3789.79
    assert abs(preview["delta"] - (-3789.79)) < 0.01
    bl = preview["balancing_line_proposal"]
    assert bl is not None
    assert bl["xactimate_code"] == "EST ADJ"
    # No warning on the safe default
    assert preview["warning"] is None


def test_set_estimate_total_scale_all_warns():
    from claim_brain_tools import _handle_preview_set_estimate_total
    res = _handle_preview_set_estimate_total(
        sb=None, claim_id="claim-x",
        claim_data={"contractor_rcv": 10000},
        tool_input={"target_total": 8000, "strategy": "scale_all", "reason": "test"},
    )
    assert res["action"] == "preview"
    assert res["preview"]["warning"] is not None
    assert "fabricated" in res["preview"]["warning"].lower() or "WARNING" in res["preview"]["warning"]


def test_set_estimate_total_invalid_target_returns_error():
    from claim_brain_tools import _handle_preview_set_estimate_total
    res = _handle_preview_set_estimate_total(
        sb=None, claim_id="claim-x",
        claim_data={"contractor_rcv": 10000},
        tool_input={"target_total": -100, "reason": "test"},
    )
    assert res["action"] == "error"


def test_set_estimate_total_unknown_strategy_returns_error():
    from claim_brain_tools import _handle_preview_set_estimate_total
    res = _handle_preview_set_estimate_total(
        sb=None, claim_id="claim-x",
        claim_data={"contractor_rcv": 10000},
        tool_input={"target_total": 9000, "strategy": "made_up_strategy", "reason": "test"},
    )
    assert res["action"] == "error"


# ─── update_date_of_loss validation ─────────────────────────────────────


def test_update_dol_rejects_bad_date_format():
    from claim_brain_tools import _handle_preview_update_date_of_loss
    res = _handle_preview_update_date_of_loss(
        sb=None, claim_id="x",
        claim_data={"date_of_loss": "2024-01-01"},
        tool_input={"new_date_of_loss": "August 15, 2024", "reason": "test"},
    )
    assert res["action"] == "error"


def test_update_dol_accepts_iso_date():
    from claim_brain_tools import _handle_preview_update_date_of_loss
    res = _handle_preview_update_date_of_loss(
        sb=None, claim_id="x",
        claim_data={"date_of_loss": "2024-01-01"},
        tool_input={"new_date_of_loss": "2024-08-15", "reason": "homeowner correction"},
    )
    assert res["action"] == "preview"
    assert "Reprocess is NOT auto-triggered" in res["message"]
