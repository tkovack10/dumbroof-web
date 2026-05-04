"""Richard post-flight middleware (governance v2 Day 5).

Three responsibilities, all running AFTER the LLM yields its tool calls:

1. **AUTO_CHAIN_RULES** — deterministic "if user said X and tool Y fired,
   also fire tool Z" rules. The flagship case: user says "add line item +
   reprocess" in one message, line-item tool fires, but trigger_reprocess
   does not. The auto-chain rule appends trigger_reprocess so the user
   doesn't need to type a second message.

2. **Tool-result reconciler** — compares ground-truth counts to what
   read-only tools returned. If a search returned <50% of what the user
   said exists, inject a corrective system-message-style note before
   Richard's next thinking step ("My tools showed 3 photos but the claim
   has 27 — let me search again").

3. **Working memory** — small "what we're doing right now" object stored
   on chat_messages that survives between turns. Richard updates it at
   end-of-turn; next turn injects it as `## In-progress: ...`. Cleared
   after 60min silence, on "forget that"/"never mind", or claim navigation.

These are deterministic safeties. The LLM-judgment versions of #1 and #2
ship in the Day 0 prompt rules (PR #1) — both layers active = defense in depth.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Any, Optional


# ─── Auto-chain rules ────────────────────────────────────────────────────


@dataclass
class AutoChainRule:
    """A deterministic rule that appends a tool call after a chat turn.

    Matches when:
      - user_message_regex matches the original user message (case-insensitive)
      - AND any tool in trigger_tools fired during the turn
      - AND append_tool did NOT already fire during the turn
    """
    name: str
    user_message_regex: re.Pattern
    trigger_tools: frozenset
    append_tool: str
    append_input_builder: Any  # callable(ctx) -> dict


def _reprocess_input(ctx: dict) -> dict:
    return {
        "reason": "auto-chained after line item / cause-of-loss change in same user turn",
    }


AUTO_CHAIN_RULES: list[AutoChainRule] = [
    AutoChainRule(
        name="auto_reprocess_after_line_item_change",
        user_message_regex=re.compile(
            r"\b(reprocess|regenerate|rebuild|update\s+the\s+report|refresh\s+the\s+report)\b",
            re.IGNORECASE,
        ),
        trigger_tools=frozenset({
            "add_line_item", "modify_line_item", "remove_line_item",
            "edit_photo_annotation", "exclude_photo_from_claim",
            "update_cause_of_loss", "set_estimate_total", "set_op_override",
        }),
        append_tool="trigger_reprocess",
        append_input_builder=_reprocess_input,
    ),
]


def evaluate_auto_chains(
    user_message: str,
    executed_tool_names: list[str],
) -> list[tuple[str, dict]]:
    """Return [(tool_name, tool_input), ...] of auto-chained tool calls
    that should fire AFTER the LLM's tool calls.

    Empty list if nothing matches.
    """
    chains: list[tuple[str, dict]] = []
    executed_set = set(executed_tool_names)

    for rule in AUTO_CHAIN_RULES:
        if rule.append_tool in executed_set:
            continue  # LLM already fired it
        if not rule.user_message_regex.search(user_message or ""):
            continue
        if not rule.trigger_tools.intersection(executed_set):
            continue
        try:
            tool_input = rule.append_input_builder({"user_message": user_message})
        except Exception:
            tool_input = {}
        chains.append((rule.append_tool, tool_input))

    return chains


# ─── Tool-result reconciler ──────────────────────────────────────────────


def reconcile_tool_result_against_ground_truth(
    tool_name: str,
    tool_result: dict,
    ground_truth_counts: dict,
) -> Optional[str]:
    """If a read-only tool returned far fewer results than ground truth
    says exist, return a corrective note for Richard's next thinking step.

    Returns None when no correction needed.
    """
    if not isinstance(tool_result, dict) or not isinstance(ground_truth_counts, dict):
        return None

    # Map tool name → (result_count_path, ground_truth_field)
    mapping = {
        "search_photos": ("data.photos", "photo_count"),
        "find_photo": ("data.matches", "photo_count"),
        "list_line_items": ("data.line_items", "line_item_count"),
        "check_carrier_emails": ("data.emails", "communication_count"),
        "get_claim_timeline": ("data.events", None),  # timeline can have many event types
    }
    if tool_name not in mapping:
        return None

    list_path, gt_key = mapping[tool_name]
    if not gt_key:
        return None

    expected = ground_truth_counts.get(gt_key) or 0
    if expected <= 0:
        return None

    # Walk the dotted path
    cur = tool_result
    for part in list_path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            cur = None
            break
    actual = len(cur) if isinstance(cur, list) else 0

    # Threshold: tool returned <50% of expected AND at least 3-item gap
    if actual < expected * 0.5 and (expected - actual) >= 3:
        return (
            f"⚠️ Reconciler: your {tool_name} returned {actual} item(s) "
            f"but the claim has {expected} ({gt_key}). Tell the user "
            f"'I see {actual} of the {expected} you mentioned' and "
            f"refine your search rather than denying their existence."
        )
    return None


# ─── Working memory ──────────────────────────────────────────────────────


# Bright-line clear regex — see governance v2 plan section "Bright-line clear rules"
_CLEAR_TRIGGERS = re.compile(
    r"\b(forget\s+that|never\s+mind|different\s+question|new\s+topic|"
    r"switching|let'?s\s+switch|start\s+over|nevermind)\b",
    re.IGNORECASE,
)


@dataclass
class WorkingMemory:
    """Cross-turn 'what we're doing right now' state.

    Stored in chat_messages.working_memory JSONB. Injected into next turn's
    system prompt as `## In-progress: ...`.
    """
    active_plan: str = ""
    completed_steps: list[str] = field(default_factory=list)
    pending_steps: list[str] = field(default_factory=list)
    updated_at: Optional[str] = None  # ISO timestamp string

    def is_empty(self) -> bool:
        return not (self.active_plan or self.completed_steps or self.pending_steps)

    def to_jsonb(self) -> dict:
        return {
            "active_plan": self.active_plan,
            "completed_steps": list(self.completed_steps),
            "pending_steps": list(self.pending_steps),
            "updated_at": self.updated_at or datetime.now(timezone.utc).isoformat(),
        }

    @classmethod
    def from_jsonb(cls, data: Optional[dict]) -> "WorkingMemory":
        if not isinstance(data, dict):
            return cls()
        return cls(
            active_plan=data.get("active_plan") or "",
            completed_steps=list(data.get("completed_steps") or []),
            pending_steps=list(data.get("pending_steps") or []),
            updated_at=data.get("updated_at"),
        )

    def to_prompt_block(self) -> str:
        """Format for system-prompt injection. Empty string if no plan."""
        if self.is_empty():
            return ""
        lines = ["## IN-PROGRESS PLAN (from last turn)"]
        if self.active_plan:
            lines.append(f"- **Goal:** {self.active_plan}")
        if self.completed_steps:
            lines.append("- **Completed:**")
            for s in self.completed_steps:
                lines.append(f"  - ✅ {s}")
        if self.pending_steps:
            lines.append("- **Still to do:**")
            for s in self.pending_steps:
                lines.append(f"  - ⏳ {s}")
        lines.append("")
        lines.append(
            "If the user's current message continues this plan, pick up "
            "where you left off. If they explicitly switch topics or say "
            "'forget that' / 'never mind', drop the plan and start fresh."
        )
        return "\n".join(lines) + "\n\n"


def should_clear_working_memory(
    user_message: str,
    last_message_at: Optional[datetime],
    silence_minutes: int = 60,
) -> bool:
    """Bright-line clear rules — no LLM judgment.

    Clears when:
      - 60+ min since last user/assistant message
      - Current message matches forget/nevermind/switching regex
    """
    # Silence check
    if last_message_at is not None:
        try:
            now = datetime.now(timezone.utc)
            if last_message_at.tzinfo is None:
                last_message_at = last_message_at.replace(tzinfo=timezone.utc)
            if (now - last_message_at) > timedelta(minutes=silence_minutes):
                return True
        except Exception:
            pass

    # Explicit clear trigger
    if _CLEAR_TRIGGERS.search(user_message or ""):
        return True

    return False


def load_working_memory(sb, scope: str, scope_key: str) -> WorkingMemory:
    """Pull the most recent chat_messages.working_memory for this scope.

    Best-effort: any failure returns an empty WorkingMemory.
    """
    try:
        res = sb.table("chat_messages").select(
            "working_memory,created_at"
        ).eq("scope", scope).eq("scope_key", scope_key).order(
            "created_at", desc=True
        ).limit(1).execute()
        if res.data:
            return WorkingMemory.from_jsonb(res.data[0].get("working_memory"))
    except Exception as e:
        # Column may not exist yet (pre-migration) — fail silently
        if "working_memory" not in str(e).lower():
            print(f"[WORKING_MEMORY] load failed for {scope}/{scope_key}: {e}", flush=True)
    return WorkingMemory()


def update_working_memory_from_turn(
    prior: WorkingMemory,
    user_message: str,
    executed_tool_names: list[str],
) -> WorkingMemory:
    """Heuristic update at end-of-turn.

    For MVP this is a tiny rule-based updater — when a tool that's in the
    pending_steps list fires, mark it complete. When user starts a new
    multi-step request (regex on 'and' connectors + 2+ verbs), reset.

    The richer LLM-driven version can come later — Day 5's deliverable is
    just persistence + injection.
    """
    if should_clear_working_memory(user_message, _safe_iso(prior.updated_at)):
        return WorkingMemory()

    # If no prior plan and this turn fired multiple state-changing tools,
    # seed a plan from the user's message.
    state_change_tools = {
        "add_line_item", "modify_line_item", "remove_line_item",
        "edit_photo_annotation", "exclude_photo_from_claim",
        "update_cause_of_loss", "set_estimate_total", "set_op_override",
        "trigger_reprocess",
    }
    fired_state = [t for t in executed_tool_names if t in state_change_tools]
    if prior.is_empty() and len(fired_state) >= 2:
        return WorkingMemory(
            active_plan=(user_message or "")[:200],
            completed_steps=fired_state,
            pending_steps=[],
            updated_at=datetime.now(timezone.utc).isoformat(),
        )

    # If we have a prior plan, mark fired tools as complete and remove
    # them from pending if they were listed there.
    if not prior.is_empty():
        completed = list(prior.completed_steps)
        pending = list(prior.pending_steps)
        for t in fired_state:
            if t not in completed:
                completed.append(t)
            pending = [p for p in pending if t not in p]
        return WorkingMemory(
            active_plan=prior.active_plan,
            completed_steps=completed,
            pending_steps=pending,
            updated_at=datetime.now(timezone.utc).isoformat(),
        )

    return prior


def _safe_iso(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None
