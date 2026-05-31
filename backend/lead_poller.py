"""
Lead Inbox Poller — tom@dumbroof.ai prospect detection
======================================================
DumbRoof's onboarding/nurture emails send from tom@dumbroof.ai. When a prospect
replies ("demo", "interested", a question) — or emails fresh — it lands in
tom@dumbroof.ai and was getting missed (Tom: "a couple requested demos, I missed
the emails"). This poller surfaces EVERY genuine inbound (Tom's call: no strict
filter — a fresh inquiry counts as much as a nurture reply), skipping only
obvious automated/bulk/team mail.

Reuses the EXISTING Gmail service account (domain-wide delegation) — the same one
the claims@ poller uses — impersonating tom@dumbroof.ai. NON-DESTRUCTIVE: it adds
a Gmail label ("DumbRoof-Lead") rather than marking mail read, so Tom's inbox
state is untouched and the label doubles as the dedup marker.

For each lead it:
  - logs to ``nurture_replies`` (so the /admin Leads tab can render it),
  - opts the user out of further nurture if they're a known signup,
  - email-alerts Tom's monitored inbox (LEAD_ALERT_TO = tkovack@usaroofmasters.com).

First-run seed safety: when the label does not yet exist (the very first run), we
LABEL + LOG the existing backlog but do NOT email-alert — otherwise the first
pass would blast Tom with one alert per unread email already sitting there. The
backlog is still recoverable in the Leads tab; new mail thereafter alerts.

Branding (see feedback_dumbroof_external_comms_branding): the alert is INTERNAL
(to Tom). Replying to a lead must go out as tom@dumbroof.ai (the /admin Leads tab
reply does this via Resend) — never usaroofmasters.com. The alert sets no
reply-to precisely so a careless "Reply" from the USARM inbox isn't encouraged.
"""
from __future__ import annotations

import os
import re
import asyncio
from typing import Optional

from supabase import Client

from gmail_poller import (
    get_gmail_service,
    parse_gmail_message,
    extract_email_address,
    TEAM_DOMAINS,
)

LEAD_INBOX_USER = os.environ.get("LEAD_INBOX_USER", "tom@dumbroof.ai")
LEAD_PROCESSED_LABEL = "DumbRoof-Lead"
LEAD_POLL_INTERVAL_SECONDS = int(os.environ.get("LEAD_POLL_INTERVAL_SECONDS", "300"))  # 5 min
LEAD_ALERT_TO = os.environ.get("LEAD_ALERT_TO", "tkovack@usaroofmasters.com")
LEAD_LOOKBACK = os.environ.get("LEAD_LOOKBACK", "45d")

# High-confidence automation/no-reply senders — never a prospect lead.
_NOISE_SENDER = re.compile(
    r"(no[\-_.]?reply|donotreply|do[\-_.]?not[\-_.]?reply|notifications?@|mailer-daemon|"
    r"bounce|postmaster@|@.*\.facebookmail\.com|business-updates@|calendar-notification)",
    re.IGNORECASE,
)
# ESP / bulk subdomains like mail.retailmenot.com, e.raymourflanigan.com — note
# the trailing-dot requirement so consumer TLDs (mail.com) are NOT blocked.
_ESP_SUBDOMAIN = re.compile(
    r"@(?:e|em|email|mail|news|info|mailer|updates|marketing|reply|send|cmail|mktg)\.[a-z0-9-]+\.[a-z]{2,}$",
    re.IGNORECASE,
)


def _looks_like_noise(from_email: str) -> bool:
    """Conservative: drop only clear automation/bulk/team mail. Err toward
    catching a lead (Tom triages) rather than silently dropping one."""
    fe = (from_email or "").strip().lower()
    if not fe or "@" not in fe:
        return True
    domain = fe.split("@")[-1]
    if domain in TEAM_DOMAINS:  # our own platform sends + USARM team
        return True
    if _NOISE_SENDER.search(fe):
        return True
    if _ESP_SUBDOMAIN.search(fe):
        return True
    return False


def _get_or_create_label(service) -> tuple[Optional[str], bool]:
    """Return (label_id, was_created). was_created=True ⇒ first run ever ⇒ seed."""
    try:
        labels = service.users().labels().list(userId="me").execute().get("labels", [])
        for l in labels:
            if l.get("name") == LEAD_PROCESSED_LABEL:
                return l.get("id"), False
        created = service.users().labels().create(
            userId="me",
            body={
                "name": LEAD_PROCESSED_LABEL,
                "labelListVisibility": "labelShow",
                "messageListVisibility": "show",
            },
        ).execute()
        return created.get("id"), True
    except Exception as e:
        print(f"[LEAD POLLER] label get/create failed: {e}", flush=True)
        return None, False


def _add_label(service, msg_id: str, label_id: str) -> None:
    try:
        service.users().messages().modify(
            userId="me", id=msg_id, body={"addLabelIds": [label_id]}
        ).execute()
    except Exception as e:
        print(f"[LEAD POLLER] add label failed {msg_id}: {e}", flush=True)


def _load_user_map(sb: Client) -> dict:
    """email(lowercased) -> {id, email} for all platform users (one call/poll)."""
    try:
        resp = sb.rpc("list_platform_users").execute()
        return {
            (u.get("email") or "").strip().lower(): u
            for u in (getattr(resp, "data", None) or [])
            if u.get("email")
        }
    except Exception as e:
        print(f"[LEAD POLLER] user map load failed: {e}", flush=True)
        return {}


def _opt_out_nurture(sb: Client, user_id: str, email: str) -> None:
    try:
        prof = (
            sb.table("company_profiles").select("settings").eq("user_id", user_id).limit(1).execute()
        )
        rows = getattr(prof, "data", None) or []
        settings = (rows[0].get("settings") if rows else None) or {}
        settings["nurture_opted_out"] = True
        if rows:
            sb.table("company_profiles").update({"settings": settings}).eq("user_id", user_id).execute()
        else:
            sb.table("company_profiles").insert(
                {"user_id": user_id, "email": email, "settings": settings}
            ).execute()
    except Exception as e:
        print(f"[LEAD POLLER] opt-out failed for {user_id}: {e}", flush=True)


def _guess_touch(subject: Optional[str]) -> Optional[str]:
    """Best-effort tag of which sequence/touch a reply is to, from the subject
    (replies arrive as 'Re: <original subject>'). Lets the /admin Leads tab show
    WHAT the contractor is responding to instead of an untagged blob. Substring
    match against the subjects in src/lib/nurture/templates.ts +
    repeat-usage-templates.ts; returns None when nothing matches."""
    s = (subject or "").lower()
    if not s:
        return None
    # Repeat-usage (existing contractors — the "build another" re-engagement drip).
    if "build my next claim" in s:
        return "reuse_cta"
    if "hard part" in s:
        return "reuse_d3"
    if "supplement adds" in s or "average dumbroof supplement" in s or "$9,400" in s:
        return "reuse_d7"
    if "roof to write up" in s:
        return "reuse_d12"
    if "stack of claims" in s:
        return "reuse_d18"
    if "settings are still warm" in s or "settings are warm" in s:
        return "reuse_d25"
    if "whenever the next one lands" in s:
        return "reuse_d35"
    if "i'll be here" in s or "ill be here" in s:
        return "reuse_d50"
    # Onboarding nurture (signups who haven't created a first claim).
    if "60-second first claim" in s or "you're in" in s or "youre in" in s:
        return "day_0_welcome"
    if "dominic" in s or "xpro" in s:
        return "day_3_proof"
    if "photos yet" in s or "don't have photos" in s or "dont have photos" in s:
        return "day_7_objection"
    if "15 min with tom" in s or "first claim live" in s:
        return "day_10_demo_invite"
    if "closing your invite" in s:
        return "day_14_lastcall"
    return None


def _log_lead(sb: Client, from_email: str, subject: str, body: str, gmail_id: str, user: Optional[dict]) -> None:
    try:
        sb.table("nurture_replies").insert({
            "user_id": user.get("id") if user else None,
            "from_email": from_email,
            "subject": subject,
            "body_excerpt": (body or "")[:2000],
            "raw_payload": {"gmail_id": gmail_id, "source": "lead_poller", "inbox": LEAD_INBOX_USER},
            "matched_touch": _guess_touch(subject),
            "opted_out": bool(user),
        }).execute()
    except Exception as e:
        print(f"[LEAD POLLER] nurture_replies insert failed: {e}", flush=True)


def _send_alert(from_email: str, subject: str, body: str, is_user: bool) -> None:
    try:
        from claim_brain_email import send_via_resend  # local import avoids any import cycle

        excerpt = (body or "").strip()[:600].replace("<", "&lt;")
        who = "known signup — nurture auto-paused" if is_user else "not a current user (fresh inbound)"
        html = (
            '<div style="font-family:-apple-system,sans-serif;max-width:640px;color:#1a1a2e;line-height:1.5;">'
            f"<p><strong>{from_email}</strong> emailed tom@dumbroof.ai ({who}).</p>"
            f"<p><strong>Subject:</strong> {subject or '(none)'}</p>"
            '<hr style="border:none;border-top:1px solid #e5e7eb;margin:14px 0;" />'
            f'<pre style="white-space:pre-wrap;background:#f9fafb;padding:12px;border-radius:6px;font-size:13px;">{excerpt}</pre>'
            '<p style="font-size:12px;color:#9ca3af;margin-top:18px;">Reply from '
            "<strong>tom@dumbroof.ai</strong> (or the DumbRoof Leads tab) — NOT your USARM inbox, so it stays on-brand.</p></div>"
        )
        send_via_resend(
            company_name="DumbRoof Leads",
            to_email=LEAD_ALERT_TO,
            subject=f"[lead] {subject or '(no subject)'} — {from_email}",
            body_html=html,
            reply_to=None,  # deliberate: do not invite a reply from the USARM inbox
        )
    except Exception as e:
        print(f"[LEAD POLLER] alert send failed: {e}", flush=True)


async def _poll_leads_once(service, sb: Client) -> None:
    label_id, first_run = await asyncio.to_thread(_get_or_create_label, service)
    if first_run:
        print("[LEAD POLLER] First run — seeding backlog (logged, NOT email-alerted).", flush=True)
    user_map = await asyncio.to_thread(_load_user_map, sb)

    q = f"in:inbox -label:{LEAD_PROCESSED_LABEL} newer_than:{LEAD_LOOKBACK}"
    resp = await asyncio.to_thread(
        lambda: service.users().messages().list(userId="me", q=q, maxResults=25).execute()
    )
    messages = resp.get("messages", []) or []

    for m in messages:
        mid = m["id"]
        try:
            parsed = await asyncio.to_thread(parse_gmail_message, service, mid)
        except Exception as e:
            print(f"[LEAD POLLER] parse failed {mid}: {e}", flush=True)
            continue
        from_email = parsed.get("from_email") or extract_email_address(parsed.get("from", ""))
        # Label first so the message is never re-examined, even if it's noise.
        if label_id:
            await asyncio.to_thread(_add_label, service, mid, label_id)
        if _looks_like_noise(from_email):
            continue
        subject = parsed.get("subject", "") or ""
        body = parsed.get("text_body") or parsed.get("html_body") or ""
        user = user_map.get(from_email.lower())
        await asyncio.to_thread(_log_lead, sb, from_email, subject, body, mid, user)
        if user:
            await asyncio.to_thread(_opt_out_nurture, sb, user["id"], from_email)
        if not first_run:
            await asyncio.to_thread(_send_alert, from_email, subject, body, bool(user))
        print(f"[LEAD POLLER] lead{' (seeded)' if first_run else ''}: {from_email} — {subject!r}", flush=True)


async def poll_lead_inbox(sb: Client) -> None:
    """Background poller for tom@dumbroof.ai prospect inbound. See module docstring."""
    if not os.environ.get("GMAIL_SERVICE_ACCOUNT_JSON"):
        print("[LEAD POLLER] GMAIL_SERVICE_ACCOUNT_JSON not set — lead polling disabled", flush=True)
        return
    print(
        f"[LEAD POLLER] Starting — polling {LEAD_INBOX_USER} every {LEAD_POLL_INTERVAL_SECONDS}s",
        flush=True,
    )
    while True:
        try:
            service = await asyncio.to_thread(lambda: get_gmail_service(LEAD_INBOX_USER))
            await _poll_leads_once(service, sb)
        except Exception as e:
            print(f"[LEAD POLLER] Error: {e}", flush=True)
        await asyncio.sleep(LEAD_POLL_INTERVAL_SECONDS)
