"""Richard Pre-flight Middleware (governance v2 Day 2-3).

Runs BEFORE the LLM sees a request. Three responsibilities:

1. Detect the user's language so the response language directive is
   deterministic — not subject to LLM drift on mixed-language inputs.
2. Build a `GroundTruth` snapshot of facts the user can see in the UI
   right now (counts, last-uploaded-at, claim status). Injected at the
   top of the system prompt so Richard literally cannot deny that 27
   photos exist when 27 photos exist.
3. Catch scope violations (e.g. setup Richard being asked a per-claim
   question) and short-circuit to a redirect message before burning an
   LLM call.

This is the deterministic backstop for trainer recommendations #1, #5,
and #6. The LLM-judgment versions of the same rules ship in PR #1 (Day 0);
once both layers are live, the middleware is the load-bearing fix and
the prompt rules become defense-in-depth.

Usage from main.py:

    from richard_middleware import prepare_brain_request

    req = await prepare_brain_request(
        sb=sb,
        user_id=user_id,
        claim_id=claim_id,
        scope="claim",  # or "user" / "company" for admin/setup chats
        user_message=body.message,
    )
    if not req.can_proceed:
        # Yield redirect_message as a single SSE chunk and stop.
        yield f"data: {json.dumps({'text': req.redirect_message})}\n\n"
        return

    # Inject ground truth + language directive at the top of the system prompt.
    system_prompt = req.system_prompt_prefix + base_system_prompt
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Literal

# ---------------------------------------------------------------------------
# Language detection
# ---------------------------------------------------------------------------

# Minimal pattern-based detector. We don't need to identify 90 languages —
# just whether the user is writing Spanish vs English (the only failure mode
# observed so far: Richard responding in Spanish to English users). If the
# detector returns "es" with high confidence, we inject the Spanish directive;
# otherwise default to English. Adding `langdetect` as a dep was considered
# and rejected for MVP — a regex over high-signal Spanish tokens is faster,
# zero-dep, and unambiguous on the threshold we care about.

_SPANISH_HIGH_SIGNAL = re.compile(
    # Function words and inflection endings that virtually never appear in
    # English roofing/claims jargon. Any 2 of these = Spanish.
    r"\b(?:hola|gracias|por\s+favor|tengo|quiero|necesito|puede|tiene|"
    r"agregar|agrega|añadir|mostrar|nuestro|nuestra|este|esta|"
    r"foto[s]?|tejado|techo|carpeta|reclamación|aseguradora|"
    r"con|sin|para|el|la|los|las|un|una|que|qué|porque|"
    r"está|estamos|son|fue|sido|hay)\b",
    re.IGNORECASE,
)

# Spanish-specific characters. A single ñ or accented vowel in claims context
# is a strong Spanish signal (English claims docs almost never have these).
_SPANISH_DIACRITIC = re.compile(r"[ñáéíóúü¿¡]", re.IGNORECASE)


def detect_language(message: str) -> Literal["en", "es"]:
    """Return 'es' if the message reads as Spanish, else 'en'.

    Conservative threshold — needs 2+ Spanish function words OR any Spanish
    diacritic to flip to 'es'. False negatives (Spanish read as English) are
    fine: the LLM still has the Day 0 prompt rule as backup. False positives
    (English read as Spanish) would be worse — they'd force a Spanish
    response on an English user.
    """
    if not message or len(message.strip()) < 3:
        return "en"

    # Single diacritic = strong signal
    if _SPANISH_DIACRITIC.search(message):
        return "es"

    # Otherwise need 2+ Spanish function words
    spanish_hits = len(_SPANISH_HIGH_SIGNAL.findall(message))
    if spanish_hits >= 2:
        return "es"

    return "en"


def language_directive(lang: str) -> str:
    """System-prompt prefix that pins response language."""
    if lang == "es":
        return (
            "## RESPONSE LANGUAGE\n"
            "The user wrote in Spanish. Respond in Spanish. "
            "Use industry-appropriate Spanish for roofing/insurance terminology.\n\n"
        )
    # Default: English — no directive needed (matches existing behavior)
    return ""


# ---------------------------------------------------------------------------
# Ground Truth snapshot
# ---------------------------------------------------------------------------


@dataclass
class GroundTruth:
    """Facts the user can see in the UI right now.

    Injected at the top of the system prompt so Richard cannot deny the
    existence of data that's plainly visible to the user. Mirrors what the
    claim detail page renders in its tabs (Photos, Communications, Line
    Items, etc).
    """

    photo_count: int = 0
    communication_count: int = 0
    line_item_count: int = 0
    total_rcv: Optional[float] = None
    address: str = ""
    claim_status: str = ""
    last_uploaded_at: Optional[datetime] = None
    last_outbound_email_at: Optional[datetime] = None
    last_inbound_email_at: Optional[datetime] = None

    def to_prompt_block(self) -> str:
        """Format as a system-prompt section."""
        if not (self.photo_count or self.communication_count or self.line_item_count):
            return ""

        lines = ["## GROUND TRUTH — what the user sees in the UI right now"]
        lines.append(f"- **Photos uploaded:** {self.photo_count}")
        lines.append(f"- **Communications (emails) on this claim:** {self.communication_count}")
        lines.append(f"- **Line items on the estimate:** {self.line_item_count}")
        if self.total_rcv is not None:
            lines.append(f"- **Current contractor RCV:** ${self.total_rcv:,.2f}")
        if self.last_uploaded_at:
            lines.append(f"- **Last photo uploaded:** {self.last_uploaded_at.strftime('%Y-%m-%d %H:%M UTC')}")
        if self.last_outbound_email_at:
            lines.append(f"- **Last outbound email:** {self.last_outbound_email_at.strftime('%Y-%m-%d %H:%M UTC')}")
        if self.last_inbound_email_at:
            lines.append(f"- **Last inbound email:** {self.last_inbound_email_at.strftime('%Y-%m-%d %H:%M UTC')}")

        lines.append("")
        lines.append(
            "**These numbers are authoritative.** If the user references "
            "data that conflicts with what your tools return, the user is "
            "looking at this UI — TRUST THEM. Your tools may have caching, "
            "filtering, or pagination issues. Never deny the existence of "
            "items reflected in this snapshot."
        )
        return "\n".join(lines) + "\n\n"


# ---------------------------------------------------------------------------
# Scope validation
# ---------------------------------------------------------------------------

# Per-claim trigger phrases. If a setup-scope chat matches one of these,
# redirect to "open the claim from your dashboard" rather than letting
# the setup Richard try to answer (and inevitably fail).
_PER_CLAIM_TRIGGERS = re.compile(
    r"\b("
    r"this\s+claim|the\s+claim|my\s+claim|"
    r"this\s+estimate|the\s+estimate|"
    r"line\s+item|line\s+items|"
    r"the\s+report|the\s+forensic|"
    r"the\s+supplement|"
    r"the\s+carrier|the\s+adjuster|"
    r"reprocess|"
    r"add\s+photo|edit\s+photo|exclude\s+photo|"
    r"send.*email"
    r")\b",
    re.IGNORECASE,
)


def is_per_claim_question(message: str) -> bool:
    """Heuristic: does this message look like it's about a specific claim?"""
    return bool(_PER_CLAIM_TRIGGERS.search(message))


_SETUP_REDIRECT = (
    "I'm the Setup Assistant — I help you connect tools and onboard your "
    "company. For questions about a specific claim (line items, photos, "
    "supplements, carrier scope, etc.), open the claim from your dashboard "
    "and ask the Richard inside it. He has the photos, scope, code data, "
    "and emails for that job loaded.\n\n"
    "Want help with onboarding instead? Try: \"What integrations do I have "
    "connected?\" or \"How do I connect Gmail?\""
)


# ---------------------------------------------------------------------------
# BrainRequest — the orchestrator output
# ---------------------------------------------------------------------------


@dataclass
class BrainRequest:
    """Output of `prepare_brain_request()` — everything the chat handler
    needs to either short-circuit or call the LLM.
    """

    user_message: str
    detected_language: str = "en"
    ground_truth: GroundTruth = field(default_factory=GroundTruth)
    can_proceed: bool = True
    redirect_message: Optional[str] = None
    scope_violations: list[str] = field(default_factory=list)

    @property
    def system_prompt_prefix(self) -> str:
        """The prefix to prepend to the existing _build_claim_brain_prompt
        output. Order matters: language directive first (so Richard reads
        it before anything else), then ground truth.
        """
        return language_directive(self.detected_language) + self.ground_truth.to_prompt_block()


# ---------------------------------------------------------------------------
# Ground truth builder (Supabase queries)
# ---------------------------------------------------------------------------


def _safe_iso(value) -> Optional[datetime]:
    """Parse Supabase timestamptz string → datetime, swallow errors."""
    if not value:
        return None
    try:
        s = str(value).replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except Exception:
        return None


async def build_ground_truth(sb, claim_id: str) -> GroundTruth:
    """Query Supabase for the live counts that drive Richard's UI awareness.

    Best-effort: any query that fails returns the field as default (0 / None).
    Never raises — Richard's chat must work even if one count query bonks.
    """
    gt = GroundTruth()

    # Claim row — for address, status, RCV
    try:
        res = sb.table("claims").select(
            "address,status,contractor_rcv,current_carrier_rcv"
        ).eq("id", claim_id).limit(1).execute()
        if res.data:
            row = res.data[0]
            gt.address = row.get("address") or ""
            gt.claim_status = row.get("status") or ""
            gt.total_rcv = row.get("contractor_rcv")
    except Exception as e:
        print(f"[GROUND_TRUTH] claims query failed for {claim_id}: {type(e).__name__}: {e}", flush=True)

    # Photo count + last upload
    try:
        # Use head=true / count=exact pattern for cheap COUNT(*)
        res = sb.table("photos").select("created_at", count="exact").eq("claim_id", claim_id).order(
            "created_at", desc=True
        ).limit(1).execute()
        gt.photo_count = res.count or 0
        if res.data:
            gt.last_uploaded_at = _safe_iso(res.data[0].get("created_at"))
    except Exception as e:
        print(f"[GROUND_TRUTH] photos query failed for {claim_id}: {type(e).__name__}: {e}", flush=True)

    # Line item count
    try:
        res = sb.table("line_items").select("id", count="exact").eq("claim_id", claim_id).limit(1).execute()
        gt.line_item_count = res.count or 0
    except Exception as e:
        print(f"[GROUND_TRUTH] line_items query failed for {claim_id}: {type(e).__name__}: {e}", flush=True)

    # Communications — most recent inbound + outbound
    try:
        res = sb.table("claim_emails").select(
            "direction,sent_at,received_at", count="exact"
        ).eq("claim_id", claim_id).order("created_at", desc=True).limit(50).execute()
        gt.communication_count = res.count or 0
        # Walk newest-first; capture first inbound + first outbound seen
        for r in (res.data or []):
            direction = (r.get("direction") or "").lower()
            ts = _safe_iso(r.get("sent_at") or r.get("received_at"))
            if direction in ("outbound", "sent") and gt.last_outbound_email_at is None:
                gt.last_outbound_email_at = ts
            elif direction in ("inbound", "received") and gt.last_inbound_email_at is None:
                gt.last_inbound_email_at = ts
            if gt.last_outbound_email_at and gt.last_inbound_email_at:
                break
    except Exception as e:
        print(f"[GROUND_TRUTH] claim_emails query failed for {claim_id}: {type(e).__name__}: {e}", flush=True)

    return gt


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


async def prepare_brain_request(
    sb,
    user_id: Optional[str],
    claim_id: Optional[str],
    scope: Literal["claim", "user", "company"],
    user_message: str,
) -> BrainRequest:
    """Run all pre-flight checks and return a BrainRequest.

    - For scope="claim": builds GroundTruth from Supabase, detects language.
    - For scope="user" (Setup Richard): detects per-claim question and
      redirects if so.
    - For scope="company" (Portfolio Richard): just language detection;
      no per-claim ground truth.
    """
    req = BrainRequest(
        user_message=user_message,
        detected_language=detect_language(user_message),
    )

    if scope == "user":
        # Setup Richard scope — redirect per-claim questions before burning
        # an LLM call. Also see ADMIN_SETUP_TOOL_NAMES allow-list in main.py.
        if is_per_claim_question(user_message):
            req.can_proceed = False
            req.scope_violations.append("setup_scope_received_per_claim_question")
            # Honor language: Spanish redirect if user wrote Spanish
            if req.detected_language == "es":
                req.redirect_message = (
                    "Soy el Asistente de Configuración — te ayudo a conectar "
                    "herramientas y configurar tu empresa. Para preguntas sobre "
                    "una reclamación específica (line items, fotos, suplementos, "
                    "etc.), abre la reclamación desde tu panel y pregúntale al "
                    "Richard que está dentro de ella."
                )
            else:
                req.redirect_message = _SETUP_REDIRECT
        return req

    if scope == "claim" and claim_id:
        req.ground_truth = await build_ground_truth(sb, claim_id)

    # scope="company" → no ground truth, no redirect, just language. Ship it.
    return req
