"""Versioned Richard prompt fragments (governance v2 Day 6-7).

The Day 0 trainer recommendations were applied as inline edits to
_build_claim_brain_prompt in main.py. That works but doesn't scale —
each new trainer rec grows the inline f-string by another paragraph,
the rules collide invisibly, and trainer-PR diffs become noisy.

This module externalizes the rules into discrete versioned markdown
files so:
- Each rule has its own file, its own commit history, its own diff
- The richard-trainer agent's `target_path` points at a specific file
  (e.g. `backend/richard_prompts/claim/trust_hierarchy.md`) instead of
  `backend/main.py:_build_claim_brain_prompt`
- A future trainer can mass-prune redundant rules by deleting/merging
  the relevant file rather than editing in the middle of a 294-line
  string

Layout:
    common/   — rules that apply to BOTH Setup and Claim Richard
    claim/    — Claim Richard only (per-claim chats)
    setup/    — Setup Richard only (onboarding chats)

Usage:
    from richard_prompts import load_prompt, compose

    rules_block = compose([
        load_prompt("common/language_rule"),
        load_prompt("common/communication_style_matching"),
        load_prompt("common/execution_bias"),
        load_prompt("claim/trust_hierarchy"),
        load_prompt("claim/ui_awareness"),
        load_prompt("claim/auto_reprocess_hint"),
    ])
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Iterable

_PROMPT_DIR = os.path.dirname(os.path.abspath(__file__))


@lru_cache(maxsize=64)
def load_prompt(name: str) -> str:
    """Load a prompt fragment by name.

    `name` is a path relative to backend/richard_prompts/, with or without
    the .md extension. Examples:
      - "common/language_rule"
      - "claim/trust_hierarchy.md"
      - "setup/scope"

    Returns the file contents (markdown). Returns "" if the file doesn't
    exist (so a missing rule never crashes the chat handler — it just
    becomes a no-op).
    """
    if not name.endswith(".md"):
        name = name + ".md"
    path = os.path.join(_PROMPT_DIR, name)
    if not os.path.exists(path):
        return ""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip() + "\n\n"
    except Exception as e:
        print(f"[RICHARD_PROMPTS] failed to read {path}: {e}", flush=True)
        return ""


def compose(parts: Iterable[str]) -> str:
    """Join non-empty prompt fragments with a single blank line between."""
    return "".join(p for p in parts if p)


def list_available() -> list[str]:
    """Discover all prompt files. Useful for the trainer agent + tests."""
    out: list[str] = []
    for root, _dirs, files in os.walk(_PROMPT_DIR):
        for f in files:
            if not f.endswith(".md"):
                continue
            full = os.path.join(root, f)
            rel = os.path.relpath(full, _PROMPT_DIR)
            out.append(rel.replace(os.sep, "/").removesuffix(".md"))
    return sorted(out)
