"""
Claim Events — event-sourced timeline helper.

Writes to the `claim_events` table (created in 20260419_platform_expansion.sql).
Every meaningful claim state transition or activity logs a row here.
Richard reads the timeline as context, and the claim-detail UI renders it.

Registry-driven: event_type maps to category + default title via CLAIM_EVENT_TYPES.
Idempotent: (claim_id, event_type, occurred_at) is unique, so re-runs are safe.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)


# ============================================================
# Event type registry — single source of truth for the UI,
# Richard's tool, and backend instrumentation.
# ============================================================

# Category keys: milestone | communication | document | action | system
CLAIM_EVENT_TYPES: dict[str, dict[str, str]] = {
    # --- Milestones ---
    "claim_opened":                {"category": "milestone", "title": "Claim opened",                     "icon": "home"},
    "aob_signed":                  {"category": "milestone", "title": "AOB signed",                       "icon": "pen"},
    "forensic_generated":          {"category": "milestone", "title": "Forensic report generated",        "icon": "file-search"},
    "scope_received":              {"category": "milestone", "title": "Carrier scope received",           "icon": "inbox"},
    "adjuster_meeting_scheduled":  {"category": "milestone", "title": "Adjuster meeting scheduled",       "icon": "calendar"},
    "adjuster_meeting_completed":  {"category": "milestone", "title": "Adjuster meeting completed",       "icon": "check-circle"},
    "supplement_sent":             {"category": "milestone", "title": "Supplement sent",                  "icon": "send"},
    "supplement_approved":         {"category": "milestone", "title": "Supplement approved",              "icon": "award"},
    "aob_sent":                    {"category": "milestone", "title": "AOB sent to carrier",              "icon": "send"},
    "aob_for_signature_sent":      {"category": "milestone", "title": "AOB sent for signature",           "icon": "pen"},
    "production_ready":            {"category": "milestone", "title": "Ready to build",                   "icon": "tool"},
    "production_sent":             {"category": "milestone", "title": "Sent to production",               "icon": "truck"},
    "install_scheduled":           {"category": "milestone", "title": "Install scheduled",                "icon": "calendar"},
    "install_complete":            {"category": "milestone", "title": "Install complete",                 "icon": "check-square"},
    "install_supplement_sent":     {"category": "milestone", "title": "Install supplement sent",          "icon": "send"},
    "coc_sent":                    {"category": "milestone", "title": "Certificate of completion sent",   "icon": "award"},
    "payment_received":            {"category": "milestone", "title": "Payment received",                 "icon": "dollar-sign"},
    "closed":                      {"category": "milestone", "title": "Claim closed",                     "icon": "archive"},
    "win_detected":                {"category": "milestone", "title": "Win detected",                     "icon": "trending-up"},

    # --- Communications ---
    "homeowner_email_sent":        {"category": "communication", "title": "Email sent to homeowner",      "icon": "mail"},
    "homeowner_email_opened":      {"category": "communication", "title": "Homeowner opened email",       "icon": "eye"},
    "homeowner_email_replied":     {"category": "communication", "title": "Homeowner replied",            "icon": "reply"},
    "homeowner_email_bounced":     {"category": "communication", "title": "Homeowner email bounced",      "icon": "alert-triangle"},
    "carrier_email_received":      {"category": "communication", "title": "Carrier email received",       "icon": "inbox"},
    "carrier_email_sent":          {"category": "communication", "title": "Email sent to carrier",        "icon": "send"},
    "cadence_scheduled":           {"category": "communication", "title": "Follow-up cadence scheduled",  "icon": "clock"},
    "cadence_followup_sent":       {"category": "communication", "title": "Cadence follow-up sent",       "icon": "send"},
    "sms_sent":                    {"category": "communication", "title": "SMS sent",                     "icon": "message-square"},

    # --- Documents ---
    "forensic_pdf_generated":      {"category": "document", "title": "Forensic PDF generated",            "icon": "file-text"},
    "estimate_pdf_generated":      {"category": "document", "title": "Estimate PDF generated",            "icon": "file-text"},
    "supplement_pdf_generated":    {"category": "document", "title": "Supplement PDF generated",          "icon": "file-text"},
    "production_pdf_generated":    {"category": "document", "title": "Production packet generated",       "icon": "file-text"},
    "scope_uploaded":              {"category": "document", "title": "Scope uploaded",                    "icon": "upload"},
    "photo_uploaded":              {"category": "document", "title": "Photo uploaded",                    "icon": "image"},
    "photos_batch_uploaded":       {"category": "document", "title": "Photos uploaded",                   "icon": "images"},

    # --- Actions ---
    "rep_assigned":                {"category": "action", "title": "Rep assigned",                        "icon": "user"},
    "colors_selected":             {"category": "action", "title": "Colors selected",                     "icon": "palette"},
    "note_added":                  {"category": "action", "title": "Note added",                          "icon": "edit"},
    "override_applied":            {"category": "action", "title": "Validation override applied",         "icon": "alert-octagon"},
    "teammate_invited":            {"category": "action", "title": "Teammate invited",                    "icon": "user-plus"},
    "teammate_joined":             {"category": "action", "title": "Teammate joined",                     "icon": "users"},
    "crm_pushed":                  {"category": "action", "title": "Pushed to CRM",                       "icon": "share"},
    "contact_updated":             {"category": "action", "title": "Contact info updated",                "icon": "edit-3"},
    "sequence_started":            {"category": "action", "title": "Homeowner comms started",             "icon": "play"},
    "sequence_paused":             {"category": "action", "title": "Homeowner comms paused",              "icon": "pause"},
    "sequence_resumed":            {"category": "action", "title": "Homeowner comms resumed",             "icon": "play"},
    "sequence_completed":          {"category": "action", "title": "Homeowner comms completed",           "icon": "check"},

    # --- System ---
    "ai_analysis_complete":        {"category": "system", "title": "AI analysis complete",                "icon": "cpu"},
    "gmail_poll_match":            {"category": "system", "title": "Gmail poll matched",                  "icon": "mail"},
    "stripe_event":                {"category": "system", "title": "Stripe event",                        "icon": "credit-card"},
    "referral_rewarded":           {"category": "system", "title": "Referral reward applied",             "icon": "gift"},
}


def get_event_meta(event_type: str) -> dict[str, str]:
    """Return registry entry for event_type, or a generic 'action' fallback."""
    entry = CLAIM_EVENT_TYPES.get(event_type)
    if entry:
        return entry
    # Unknown event — don't crash, log under 'action' with humanized title
    return {
        "category": "action",
        "title": event_type.replace("_", " ").capitalize(),
        "icon": "activity",
    }


def log_claim_event(
    sb: Any,
    claim_id: str,
    event_type: str,
    *,
    source: str = "system",
    title: Optional[str] = None,
    description: Optional[str] = None,
    metadata: Optional[dict] = None,
    occurred_at: Optional[datetime | str] = None,
    created_by: Optional[str] = None,
) -> Optional[str]:
    """
    Insert a row into `claim_events`. Idempotent via UNIQUE (claim_id, event_type, occurred_at).

    Args:
        sb: Supabase client (service role).
        claim_id: UUID of the claim.
        event_type: Must be in CLAIM_EVENT_TYPES (unknown types logged under 'action').
        source: user | system | homeowner_reply | carrier_email | processor | cron | backfill
        title: Overrides registry default.
        description: Human-readable detail.
        metadata: Arbitrary jsonb context (email_id, amount, etc).
        occurred_at: Defaults to now. Pass historical timestamps for backfill.
        created_by: user_id who triggered (NULL for system).

    Returns:
        The inserted row's id, or None on error or conflict (row already exists).
    """
    if not claim_id or not event_type:
        logger.warning("log_claim_event: missing claim_id or event_type — skipping")
        return None

    meta = get_event_meta(event_type)

    # Normalize occurred_at to ISO 8601 UTC
    if occurred_at is None:
        occurred_at = datetime.now(tz=timezone.utc)
    if isinstance(occurred_at, datetime):
        if occurred_at.tzinfo is None:
            occurred_at = occurred_at.replace(tzinfo=timezone.utc)
        occurred_at = occurred_at.isoformat()

    row = {
        "claim_id": claim_id,
        "event_type": event_type,
        "event_category": meta["category"],
        "title": title or meta["title"],
        "description": description,
        "metadata": metadata or {},
        "occurred_at": occurred_at,
        "source": source,
    }
    if created_by:
        row["created_by"] = created_by

    try:
        # Use upsert with on_conflict to be idempotent — if the unique
        # constraint (claim_id, event_type, occurred_at) already matches a
        # row, do nothing. supabase-py's on_conflict="ignore_duplicates" isn't
        # available; use insert with try/except on duplicate.
        resp = sb.table("claim_events").insert(row).execute()
        data = getattr(resp, "data", None)
        if data and len(data) > 0:
            return data[0].get("id")
    except Exception as e:
        msg = str(e)
        # Unique constraint violation = row already exists, not an error
        if "duplicate key" in msg.lower() or "unique constraint" in msg.lower():
            logger.debug(
                "log_claim_event: duplicate (%s / %s / %s) — skipped",
                claim_id, event_type, occurred_at,
            )
            return None
        logger.warning(
            "log_claim_event failed for claim=%s event=%s: %s",
            claim_id, event_type, e,
        )
    return None


def bulk_log_claim_events(sb: Any, rows: list[dict]) -> int:
    """
    Bulk-insert many claim_events in one call. Each row dict should have the
    shape returned by building a log_claim_event call (claim_id, event_type,
    optional: title, description, metadata, occurred_at, source, created_by).

    Returns count of rows successfully inserted (conflicts silently skipped).
    """
    if not rows:
        return 0

    normalized: list[dict] = []
    for r in rows:
        event_type = r.get("event_type")
        if not event_type or not r.get("claim_id"):
            continue
        meta = get_event_meta(event_type)
        occurred_at = r.get("occurred_at") or datetime.now(tz=timezone.utc)
        if isinstance(occurred_at, datetime):
            if occurred_at.tzinfo is None:
                occurred_at = occurred_at.replace(tzinfo=timezone.utc)
            occurred_at = occurred_at.isoformat()
        normalized.append({
            "claim_id": r["claim_id"],
            "event_type": event_type,
            "event_category": meta["category"],
            "title": r.get("title") or meta["title"],
            "description": r.get("description"),
            "metadata": r.get("metadata") or {},
            "occurred_at": occurred_at,
            "source": r.get("source", "system"),
            **({"created_by": r["created_by"]} if r.get("created_by") else {}),
        })

    if not normalized:
        return 0

    try:
        resp = sb.table("claim_events").insert(normalized).execute()
        return len(getattr(resp, "data", []) or [])
    except Exception as e:
        msg = str(e)
        if "duplicate key" in msg.lower() or "unique constraint" in msg.lower():
            # Fall back to per-row inserts so valid ones still land
            inserted = 0
            for row in normalized:
                try:
                    sb.table("claim_events").insert(row).execute()
                    inserted += 1
                except Exception:
                    pass
            return inserted
        logger.warning("bulk_log_claim_events failed: %s", e)
        return 0


def get_claim_timeline(
    sb: Any,
    claim_id: str,
    *,
    limit: int = 50,
    category_filter: Optional[str] = None,
) -> list[dict]:
    """
    Return the most recent events for a claim (reverse chronological).
    Used by Richard's get_claim_timeline tool and the timeline rail API.
    """
    q = (
        sb.table("claim_events")
        .select("id,event_type,event_category,title,description,metadata,occurred_at,source,created_by")
        .eq("claim_id", claim_id)
        .order("occurred_at", desc=True)
        .limit(limit)
    )
    if category_filter:
        q = q.eq("event_category", category_filter)
    try:
        resp = q.execute()
        return list(getattr(resp, "data", []) or [])
    except Exception as e:
        logger.warning("get_claim_timeline failed for claim=%s: %s", claim_id, e)
        return []
