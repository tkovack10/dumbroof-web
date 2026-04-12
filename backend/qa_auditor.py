"""QA Auditor — last line of defense before generated PDFs reach customers.

Runs after PDFs are generated and uploaded, before `status=ready`. Reviews the
LLM-generated forensic prose (executive summary + conclusion) against the
ground-truth claim fields and flags any hallucinated address, date, carrier
name, homeowner name, UPPA violation, or AI artifact.

See plan: ~/.claude/plans/proud-wiggling-hearth.md
See subagent definition: ~/.claude/agents/qa-auditor.md
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    import anthropic  # noqa: F401


SEVERITY_CRITICAL = "critical"
SEVERITY_MEDIUM = "medium"
SEVERITY_LOW = "low"


def _format_date_for_audit(date_str: str) -> str:
    if not date_str:
        return ""
    s = date_str.strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%B %d, %Y")
        except ValueError:
            continue
    return s


def _build_ground_truth(config: dict, claim: dict) -> dict:
    """Extract the authoritative facts the prose must match."""
    prop = config.get("property", {}) or {}
    dates = config.get("dates", {}) or {}
    carrier = config.get("carrier", {}) or {}
    insured = config.get("insured", {}) or {}
    company = config.get("company", {}) or {}
    compliance = config.get("compliance", {}) or {}
    weather = config.get("weather", {}) or {}

    canonical_address = (
        claim.get("address")
        or prop.get("address")
        or ""
    )
    canonical_dol = _format_date_for_audit(
        dates.get("date_of_loss", "") or weather.get("storm_date", "")
    )
    canonical_carrier = carrier.get("name", "") or claim.get("carrier", "")
    canonical_homeowner = insured.get("name", "") or claim.get("contact_name", "")
    user_role = compliance.get("user_role", "contractor")

    photo_count = 0
    try:
        photo_count = int(config.get("photo_count", 0) or 0)
    except (TypeError, ValueError):
        photo_count = 0

    trades: list[str] = []
    seen = set()
    for li in (config.get("line_items") or []):
        t = (li.get("trade") or "").strip().lower()
        if t and t not in seen:
            seen.add(t)
            trades.append(t)

    return {
        "canonical_address": canonical_address,
        "canonical_date_of_loss": canonical_dol,
        "canonical_carrier": canonical_carrier,
        "canonical_homeowner": canonical_homeowner,
        "canonical_company_name": company.get("name", ""),
        "canonical_ceo_name": company.get("ceo_name", ""),
        "user_role": user_role,
        "photo_count": photo_count,
        "trades": trades,
        "inspection_date": _format_date_for_audit(dates.get("inspection_date", "")),
        "report_date": _format_date_for_audit(dates.get("report_date", "")),
    }


def _build_prose_bundle(config: dict) -> dict:
    ff = config.get("forensic_findings", {}) or {}
    exec_summary = ff.get("executive_summary") or []
    conclusion = ff.get("conclusion_paragraphs") or []
    if isinstance(exec_summary, str):
        exec_summary = [exec_summary]
    if isinstance(conclusion, str):
        conclusion = [conclusion]
    return {
        "executive_summary": [p for p in exec_summary if isinstance(p, str)],
        "conclusion_paragraphs": [p for p in conclusion if isinstance(p, str)],
    }


def _build_audit_prompt(ground_truth: dict, prose: dict) -> str:
    gt_json = json.dumps(ground_truth, indent=2)
    prose_json = json.dumps(prose, indent=2)
    return f"""You are the DumbRoof QA Auditor. You are the last line of defense before a forensic causation report reaches an insurance carrier and a homeowner. Your single job is to find factual contradictions between the LLM-generated prose and the ground-truth claim data.

GROUND TRUTH (authoritative facts about this claim):
```json
{gt_json}
```

LLM-GENERATED PROSE (executive summary + conclusion paragraphs):
```json
{prose_json}
```

For EVERY paragraph, extract every verifiable fact and compare it to ground truth. Flag issues by severity.

CRITICAL issues (block delivery — customer cannot see this report):
1. ADDRESS MISMATCH — any street number, street name, city, state, or ZIP in the prose that does NOT match `canonical_address`. Example: prose says "10 Franklin St" but ground truth is "8 Franklin St".
2. DATE-OF-LOSS MISMATCH — any date referenced as the date of loss, storm date, or loss event date that does NOT match `canonical_date_of_loss`. Confusing date of loss with inspection date is CRITICAL.
3. CARRIER NAME MISMATCH — any insurance carrier name in the prose that differs from `canonical_carrier`.
4. HOMEOWNER NAME MISMATCH — any homeowner/insured name in the prose that differs from `canonical_homeowner`.
5. UPPA VIOLATION (ONLY when `user_role == "contractor"`) — use of "on behalf of," "demand," "appeal," "we represent," citations to "11 NYCRR", "§ 2601", or other advocacy/regulatory language. Contractors document and recommend — they do not advocate. PAs and attorneys are exempt.
6. MULTIPLE-PROPERTIES LANGUAGE — the prose treats one claim as "two properties" or "multiple properties" when in fact the claim is a SINGLE property (multi-structure is fine — main dwelling + garage = ONE property).
7. FABRICATED WEATHER EVENT — invented storm event, hail size, or wind speed that is not supported by ground truth.

MEDIUM issues (log but do not block):
- AI ARTIFACTS — phrases like "As an AI", "I'd be happy to", "I cannot provide", "I'll do my best".
- FABRICATED INSPECTOR NAMES — any inspector name that is not `canonical_ceo_name` or a recognizable company employee. If no inspector name is mentioned, this is fine.
- PHOTO COUNT DRIFT — prose references a photo count that differs from `photo_count` (within ±5 is fine).
- WEASEL ADVOCACY — borderline advocacy language for contractor reports ("the carrier should consider", "we recommend the carrier").

LOW issues (cosmetic):
- Awkward phrasing, date format inconsistencies, repeated sentences, missing oxford commas.

RULES:
- A partial address match is still a match (e.g., "8 Franklin St" in prose matches canonical "8 Franklin St, Greene, NY 13778" — this is fine).
- Case-insensitive comparisons.
- If the canonical field is empty string, do NOT flag the prose for mentioning or not mentioning that field.
- Do NOT invent issues. Only flag facts that are demonstrably wrong.
- When in doubt, do NOT flag — Tom would rather let a stylistic issue through than false-positive block a good report.

Return ONLY valid JSON matching this exact schema:
```json
{{
  "passed": true | false,
  "critical": [
    {{"issue": "ADDRESS_MISMATCH", "location": "conclusion_paragraph_1", "found": "10 Franklin St", "expected": "8 Franklin St, Greene, NY", "quote": "... the property at 10 Franklin St ..."}}
  ],
  "medium": [
    {{"issue": "AI_ARTIFACT", "location": "executive_summary_paragraph_2", "quote": "As an AI, I ..."}}
  ],
  "low": [
    {{"issue": "DATE_FORMAT", "location": "conclusion_paragraph_3", "quote": "On April 2025"}}
  ],
  "recommendation": "ship" | "hold" | "reprocess",
  "summary": "one-sentence plain-english summary of what's wrong, or 'All checks passed.'"
}}
```

`passed` is true iff `critical` is empty. `recommendation` is "ship" if passed, "hold" if critical has 1-2 issues, "reprocess" if critical has 3+ issues."""


def _parse_audit_response(raw: str) -> dict:
    """Best-effort JSON extraction from Claude's response."""
    if not raw:
        return _fail_safe_result("empty response")
    text = raw.strip()
    if "```" in text:
        parts = text.split("```")
        for part in parts:
            clean = part.strip()
            if clean.startswith("json"):
                clean = clean[4:].strip()
            if clean.startswith("{"):
                text = clean
                break
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < 0 or end < start:
        return _fail_safe_result("no json object found")
    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError as e:
        return _fail_safe_result(f"json decode error: {e}")
    if not isinstance(parsed, dict):
        return _fail_safe_result("response was not an object")
    parsed.setdefault("passed", False)
    parsed.setdefault("critical", [])
    parsed.setdefault("medium", [])
    parsed.setdefault("low", [])
    parsed.setdefault("recommendation", "hold")
    parsed.setdefault("summary", "Audit result malformed.")
    return parsed


def _fail_safe_result(reason: str) -> dict:
    """Return a result that fails open (passes) but records the reason.

    The audit is a best-effort guard. If the auditor itself breaks, we do NOT
    want to block all claim deliveries — we log it and ship. The regex
    scrubber and hard prompt anchors still catch the specific hallucination
    patterns we know about.
    """
    return {
        "passed": True,
        "critical": [],
        "medium": [],
        "low": [],
        "recommendation": "ship",
        "summary": f"QA auditor unavailable ({reason}) — passed through.",
        "audit_error": reason,
    }


def audit_forensic_prose(
    config: dict,
    claim: dict,
    claude: "anthropic.Anthropic",
    call_claude_fn=None,
) -> dict:
    """Review generated forensic prose against claim ground truth.

    Args:
        config: The claim config dict (must have forensic_findings populated).
        claim: The Supabase claim row dict.
        claude: Anthropic client (already instantiated in process_claim scope).
        call_claude_fn: Optional wrapper (e.g. `_call_claude_with_retry`) from
            processor.py for telemetry. Falls back to direct call if not given.

    Returns:
        Audit result dict with keys: passed, critical, medium, low,
        recommendation, summary, and metadata (ground_truth, audit_error if any).
    """
    prose = _build_prose_bundle(config)
    if not prose["executive_summary"] and not prose["conclusion_paragraphs"]:
        # Nothing to audit — forensic-only claim with no synthesis, or synthesis failed.
        return _fail_safe_result("no prose to audit")

    ground_truth = _build_ground_truth(config, claim)
    prompt = _build_audit_prompt(ground_truth, prose)

    try:
        if call_claude_fn is not None:
            response = call_claude_fn(
                claude,
                _step_name="qa_auditor",
                model="claude-opus-4-6",
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )
        else:
            response = claude.messages.create(
                model="claude-opus-4-6",
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )
        raw = response.content[0].text
    except Exception as e:
        return _fail_safe_result(f"api error: {str(e)[:200]}")

    result = _parse_audit_response(raw)
    result["ground_truth"] = ground_truth
    result["audited_at"] = datetime.utcnow().isoformat() + "Z"
    return result


def format_audit_for_email(claim: dict, audit: dict) -> str:
    """Plain-text summary for the Tom alert email."""
    lines = [
        f"QA AUDIT FAILED — {claim.get('address', 'unknown claim')}",
        f"Claim ID: {claim.get('id', 'unknown')}",
        f"Recommendation: {audit.get('recommendation', 'hold').upper()}",
        "",
        audit.get("summary", ""),
        "",
    ]
    crits = audit.get("critical", []) or []
    if crits:
        lines.append(f"CRITICAL ({len(crits)}):")
        for c in crits:
            lines.append(f"  - [{c.get('issue', '?')}] {c.get('location', '?')}")
            if c.get("found") and c.get("expected"):
                lines.append(f"    found:    {c['found']}")
                lines.append(f"    expected: {c['expected']}")
            if c.get("quote"):
                lines.append(f"    quote:    {c['quote'][:200]}")
            lines.append("")
    meds = audit.get("medium", []) or []
    if meds:
        lines.append(f"MEDIUM ({len(meds)}):")
        for m in meds:
            lines.append(f"  - [{m.get('issue', '?')}] {m.get('location', '?')}")
            if m.get("quote"):
                lines.append(f"    quote:    {m['quote'][:200]}")
    return "\n".join(lines)
