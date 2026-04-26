"""
Persistent chat history for Richard.

Replaces the in-process Python dicts (`_admin_brain_conversations`,
`_claim_brain_conversations`) with Supabase-backed storage so conversations
survive Railway redeploys.

Scope tuple identifies a conversation thread:
    ('user',    user_id)   — onboarding / settings Richard
    ('company', user_id)   — owner/admin portfolio Richard
    ('claim',   claim_id)  — per-claim Richard

Migration: supabase/migrations/20260426_richard_chat_messages.sql
"""

from __future__ import annotations
from typing import Any, Optional
from supabase import Client

VALID_SCOPES = ("user", "company", "claim")
DEFAULT_LIMIT = 50  # tail length to load — matches the prior in-memory cap
MAX_LIMIT = 200


def load_conversation(
    sb: Client,
    scope: str,
    scope_key: str,
    limit: int = DEFAULT_LIMIT,
) -> list[dict]:
    """Load the most recent `limit` messages for (scope, scope_key) in chronological order.

    Returns a list of {"role": str, "content": str} dicts (the shape Anthropic
    expects in `messages=` for client.messages.create). Tool actions are stored
    server-side but not returned here — they're a frontend-render concern only,
    not part of the Anthropic conversation context.
    """
    if scope not in VALID_SCOPES:
        return []
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))

    try:
        res = (
            sb.table("chat_messages")
            .select("role, content, created_at")
            .eq("scope", scope)
            .eq("scope_key", str(scope_key))
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        rows = res.data or []
    except Exception as e:
        print(f"[chat_storage] load_conversation failed: {e}")
        return []

    # rows are newest-first; flip to chronological for Anthropic
    rows.reverse()
    return [{"role": r["role"], "content": r["content"]} for r in rows if r.get("role") and r.get("content")]


def append_message(
    sb: Client,
    scope: str,
    scope_key: str,
    user_id: str,
    role: str,
    content: str,
    tool_actions: Optional[list[Any]] = None,
) -> None:
    """Append one message to the conversation. Fail-soft on DB errors so a
    Supabase outage doesn't take Richard offline — the chat still streams to
    the user, it just won't survive a backend restart."""
    if scope not in VALID_SCOPES or not user_id or not content:
        return
    if role not in ("user", "assistant"):
        return

    payload: dict[str, Any] = {
        "scope": scope,
        "scope_key": str(scope_key),
        "user_id": user_id,
        "role": role,
        "content": content,
    }
    if tool_actions:
        payload["tool_actions"] = tool_actions

    try:
        sb.table("chat_messages").insert(payload).execute()
    except Exception as e:
        print(f"[chat_storage] append_message failed (scope={scope}, key={scope_key}): {e}")


def clear_conversation(sb: Client, scope: str, scope_key: str) -> int:
    """Delete all messages for (scope, scope_key). Returns number of rows
    deleted (best-effort; Supabase delete may not return a count)."""
    if scope not in VALID_SCOPES:
        return 0
    try:
        res = (
            sb.table("chat_messages")
            .delete()
            .eq("scope", scope)
            .eq("scope_key", str(scope_key))
            .execute()
        )
        return len(res.data or [])
    except Exception as e:
        print(f"[chat_storage] clear_conversation failed: {e}")
        return 0


def trim_conversation(sb: Client, scope: str, scope_key: str, keep_last: int = MAX_LIMIT) -> None:
    """Optional housekeeping — keep only the last N messages for a thread.
    Avoids unbounded growth on long-running conversations. Called opportunistically
    on append, not every turn."""
    if scope not in VALID_SCOPES:
        return
    keep_last = max(50, min(int(keep_last), 1000))
    try:
        # Find the cutoff timestamp (the created_at of the Nth most recent row)
        res = (
            sb.table("chat_messages")
            .select("created_at")
            .eq("scope", scope)
            .eq("scope_key", str(scope_key))
            .order("created_at", desc=True)
            .range(keep_last, keep_last)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return
        cutoff = rows[0]["created_at"]
        sb.table("chat_messages").delete().eq("scope", scope).eq("scope_key", str(scope_key)).lt("created_at", cutoff).execute()
    except Exception as e:
        print(f"[chat_storage] trim_conversation failed: {e}")
