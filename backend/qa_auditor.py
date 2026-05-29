"""QA Auditor — last line of defense before generated PDFs reach customers.

Runs after PDFs are generated and uploaded, before `status=ready`. Reviews the
LLM-generated forensic prose (executive summary + conclusion) against the
ground-truth claim fields and flags any hallucinated address, date, carrier
name, homeowner name, UPPA violation, or AI artifact.

See plan: ~/.claude/plans/proud-wiggling-hearth.md
See subagent definition: ~/.claude/agents/qa-auditor.md
"""

from __future__ import annotations

from model_config import MODEL  # unified model knob (see model_config.py)

import json
import re
from datetime import datetime
from typing import Optional

import anthropic

from date_utils import format_date_human as _format_date_human


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
    canonical_dol = _format_date_human(
        dates.get("date_of_loss", "") or weather.get("storm_date", "")
    )
    canonical_carrier = carrier.get("name", "") or claim.get("carrier", "")
    canonical_homeowner = insured.get("name", "") or claim.get("contact_name", "")
    user_role = compliance.get("user_role", "contractor")

    photo_count = 0
    try:
        # photo_count lives in config["forensic"]["total_photos"] (set by build_claim_config),
        # NOT config["photo_count"] which doesn't exist. Fallback to photo_annotations length.
        forensic = config.get("forensic", {}) or {}
        photo_count = int(forensic.get("total_photos", 0) or 0)
        if not photo_count:
            photo_count = len(config.get("photo_annotations", {}) or {})
    except (TypeError, ValueError):
        photo_count = 0

    trades: list[str] = []
    seen = set()
    for li in (config.get("line_items") or []):
        t = (li.get("trade") or "").strip().lower()
        if t and t not in seen:
            seen.add(t)
            trades.append(t)

    # NOAA weather ground truth — without this the FABRICATED WEATHER check fires
    # on EVERY hail/wind statement, because the prose claims hail but the ground
    # truth it's handed has no weather facts. Read the SAME source the
    # deterministic check uses (config["weather"]["noaa"], populated in
    # processor.py during NOAA enrichment), falling back to the persisted rich
    # blob on the claim row (claims.weather_data: max_hail_inches / max_wind_mph
    # / events / event_count). Detection-superset principle: the prose auditor
    # must see the weather evidence the report generator saw.
    noaa = (weather.get("noaa") or {})
    if not noaa:
        noaa = (claim.get("weather_data") or {}) if isinstance(claim, dict) else {}
    try:
        noaa_max_hail = float(noaa.get("max_hail_inches") or 0)
    except (TypeError, ValueError):
        noaa_max_hail = 0.0
    try:
        noaa_max_wind = float(noaa.get("max_wind_mph") or 0)
    except (TypeError, ValueError):
        noaa_max_wind = 0.0
    try:
        noaa_event_count = int(noaa.get("event_count") or 0)
    except (TypeError, ValueError):
        noaa_event_count = 0

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
        "inspection_date": _format_date_human(dates.get("inspection_date", "")),
        "report_date": _format_date_human(dates.get("report_date", "")),
        "storm_date": _format_date_human(weather.get("storm_date", "")),
        "noaa_event_count": noaa_event_count,
        "noaa_max_hail_inches": noaa_max_hail,
        "noaa_max_wind_mph": noaa_max_wind,
        "noaa_confirmed_hail": noaa_max_hail > 0,
        "noaa_confirmed_wind": noaa_max_wind > 0,
    }


# ==========================================================================
# WS-0 — Forensic prevalence flags (FLAG-ONLY, MEDIUM-only detection layer)
# ==========================================================================
#
# These are MEDIUM-only flags merged into qa_audit_flags. They are detection
# scaffolding for the forensic overhaul: they surface latent data-quality and
# narrative defects WITHOUT ever blocking delivery (they CANNOT be critical and
# CANNOT change qa_blocked). Live-defect prevalence baseline at ship time (over
# 192 prose claims): ZERO_SF_ROOF_WITH_MEASUREMENT=50, WRONG_STATE_CODE_LEAK=0,
# THRESHOLD_HAIL_EXCEEDS_EVENTS=0, WIND_GE_150=0.
#
# Detection-superset principle ([[detection-superset-principle]]): the state-code
# leak scan reads a SUPERSET of the prose surfaces the renderer emits, so a leak
# in any narrative section is caught, not just the executive summary.


def _collect_strings(*vals) -> str:
    """Flatten nested str/list/dict values into one newline-joined text blob.

    forensic_findings sections are heterogeneous: lists of strings
    (executive_summary, conclusion_paragraphs, key_arguments) AND lists of
    dicts ({code, requirement, status} / {title, content}). We harvest every
    string value at any depth so the scan sees all rendered prose.
    """
    parts: list[str] = []

    def rec(v):
        if v is None:
            return
        if isinstance(v, str):
            parts.append(v)
        elif isinstance(v, dict):
            for x in v.values():
                rec(x)
        elif isinstance(v, (list, tuple)):
            for x in v:
                rec(x)
        else:
            parts.append(str(v))

    for v in vals:
        rec(v)
    return "\n".join(parts)


def _forensic_superset_text(config: dict) -> str:
    """The SUPERSET of narrative surfaces scanned for the state-code leak.

    Covers executive_summary + conclusion + forensic_findings.key_arguments +
    code_violations + critical_observations + conclusion_findings, read from
    BOTH the canonical forensic_findings container and any top-level mirror.
    """
    ff = config.get("forensic_findings", {})
    if not isinstance(ff, dict):
        ff = {}
    keys = (
        "executive_summary",
        "conclusion",
        "conclusion_paragraphs",
        "conclusion_findings",
        "key_arguments",
        "code_violations",
        "critical_observations",
    )
    collected = []
    for k in keys:
        collected.append(ff.get(k))
        collected.append(config.get(k))
    return _collect_strings(*collected)


def _to_float(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


_RE_WIND_MPH = re.compile(r"(\d+(?:\.\d+)?)\s*mph", re.IGNORECASE)


def compute_forensic_prevalence_flags(config: dict, claim: dict) -> list[dict]:
    """Return MEDIUM-only prevalence flags for a claim's forensic config.

    Every dict has severity='medium'. This function NEVER returns a critical —
    it is a detection/telemetry layer, not a gate. Callers merge the result
    into qa_audit_flags MEDIUM only.

    Flags:
      WRONG_STATE_CODE_LEAK         — a DIFFERENT state's code-prefix token
                                      appears in the narrative superset while the
                                      property is in another state.
      ZERO_SF_ROOF_WITH_MEASUREMENT — structures[0].roof_area_sf is 0/None yet a
                                      measurement signal is present.
      THRESHOLD_HAIL_EXCEEDS_EVENTS — confirmed weather.noaa.max_hail_inches >
                                      the max per-event hail magnitude (events
                                      with magnitude_type == 'hail_inches').
      WIND_GE_150                   — a rendered/NOAA wind speed >= 150 mph
                                      (regex scoped to 'mph' ONLY).
    """
    flags: list[dict] = []
    if not isinstance(config, dict):
        return flags
    claim = claim if isinstance(claim, dict) else {}

    prop = config.get("property", {})
    if not isinstance(prop, dict):
        prop = {}
    state = (prop.get("state") or "").strip().upper()
    text = _forensic_superset_text(config)

    # (1) WRONG_STATE_CODE_LEAK — import lazily + locally so we never create a
    # processor import cycle (use building_codes.lookup, NOT processor).
    if len(state) == 2:
        try:
            from building_codes import lookup as _codes

            own_prefix = _codes.get_prefix(state)
            for other in _codes.all_states():
                if other == state:
                    continue
                other_prefix = _codes.get_prefix(other)
                if not other_prefix or other_prefix == own_prefix:
                    continue
                # Token-boundary match so 'RCO' doesn't match inside a word and
                # generic shared substrings (e.g. '-IRC') don't false-positive:
                # we match the FULL other-state prefix as a standalone token.
                if re.search(
                    r"(?<![A-Za-z0-9])" + re.escape(other_prefix) + r"(?![A-Za-z0-9])",
                    text,
                ):
                    flags.append({
                        "issue": "WRONG_STATE_CODE_LEAK",
                        "severity": "medium",
                        "check": "forensic_prevalence",
                        "found": other_prefix,
                        "expected": own_prefix,
                        "detail": (
                            f"Narrative cites code prefix '{other_prefix}' "
                            f"({other}) but the property is in {state} "
                            f"(prefix '{own_prefix}')."
                        ),
                    })
                    break  # one flag per claim is enough signal
        except Exception as e:  # noqa: BLE001 — detection must never raise into the gate
            print(f"[QA] WRONG_STATE_CODE_LEAK scan skipped: {e}")

    # (2) ZERO_SF_ROOF_WITH_MEASUREMENT
    structures = config.get("structures", [])
    if not isinstance(structures, list):
        structures = []
    s0 = structures[0] if structures else {}
    if isinstance(s0, dict):
        roof_sf = s0.get("roof_area_sf")
        sf_val = _to_float(roof_sf)
        roof_zero = (sf_val is None) or (sf_val == 0)
        measurement_signal = bool(
            config.get("roof_facets")
            or config.get("measurement_files")
            or (claim.get("roof_facets") if isinstance(claim, dict) else None)
            or (claim.get("measurement_files") if isinstance(claim, dict) else None)
            or s0.get("eave_lf")
            or s0.get("roof_area_sq")
            or s0.get("facets")
            or (len(structures) > 1 and any(
                isinstance(st, dict) and _to_float(st.get("roof_area_sf")) for st in structures[1:]
            ))
        )
        if roof_zero and measurement_signal:
            flags.append({
                "issue": "ZERO_SF_ROOF_WITH_MEASUREMENT",
                "severity": "medium",
                "check": "forensic_prevalence",
                "found": repr(roof_sf),
                "detail": (
                    "structures[0].roof_area_sf is 0/None but a measurement "
                    "signal (facets / measurement files / linear feet / sibling "
                    "structure area) is present — the roof area likely did not "
                    "reach the structure record."
                ),
            })

    # (3) THRESHOLD_HAIL_EXCEEDS_EVENTS
    weather = config.get("weather", {})
    if not isinstance(weather, dict):
        weather = {}
    noaa = weather.get("noaa", {})
    if not isinstance(noaa, dict):
        noaa = {}
    max_hail = _to_float(noaa.get("max_hail_inches"))
    if max_hail and max_hail > 0:
        per_event = []
        for e in (noaa.get("events") or []):
            if not isinstance(e, dict):
                continue
            # Per-event hail magnitude is e['magnitude'] gated on
            # magnitude_type == 'hail_inches'. (events[].hail_size does NOT exist.)
            if e.get("magnitude_type") == "hail_inches":
                v = _to_float(e.get("magnitude"))
                if v is not None:
                    per_event.append(v)
        if per_event and max_hail > max(per_event):
            flags.append({
                "issue": "THRESHOLD_HAIL_EXCEEDS_EVENTS",
                "severity": "medium",
                "check": "forensic_prevalence",
                "found": max_hail,
                "expected": max(per_event),
                "detail": (
                    f"Confirmed max_hail_inches={max_hail} exceeds the largest "
                    f"per-event hail magnitude ({max(per_event)}) across NOAA "
                    f"events — the headline threshold is not corroborated by any "
                    f"single event."
                ),
            })

    # (4) WIND_GE_150 — NOAA value + any 'N mph' token in the narrative
    # (regex scoped to 'mph' ONLY so it never matches 'N miles').
    winds = []
    nw = _to_float(noaa.get("max_wind_mph"))
    if nw is not None:
        winds.append(nw)
    for m in _RE_WIND_MPH.finditer(text):
        v = _to_float(m.group(1))
        if v is not None:
            winds.append(v)
    if winds and max(winds) >= 150:
        flags.append({
            "issue": "WIND_GE_150",
            "severity": "medium",
            "check": "forensic_prevalence",
            "found": max(winds),
            "detail": (
                f"A wind speed of {max(winds)} mph (>= 150) appears in the NOAA "
                f"data or narrative — verify it is not a transcription/units error."
            ),
        })

    return flags


def compute_ws5_nodata_flags(config: dict, claim: dict) -> list[dict]:
    """Return MEDIUM-only WS-5 no-data / placeholder flags.

    Same posture as compute_forensic_prevalence_flags (WS-0): every dict is
    severity='medium', NEVER critical, NEVER blocking — pure detection/telemetry.
    Catches the WS-5 symptom class: a report that ASSERTS measurements or weather
    it does not have, or renders a placeholder owner / blank identity rows.

    Flags:
      WS5_NO_MEASUREMENTS_ASSERTED — no usable measurements, yet the narrative
                                     superset still cites EagleView measurements.
      WS5_WEATHER_UNVERIFIED_CONFIRMED — not weather-verified (prod shape), yet
                                     the narrative still says "confirmed ... storm".
      WS5_PLACEHOLDER_OWNER         — insured.name is the 'Property Owner'
                                     placeholder (untargeted package).
    """
    flags: list[dict] = []
    if not isinstance(config, dict):
        return flags
    claim = claim if isinstance(claim, dict) else {}

    # Reuse the hardened, prod-shape helpers as the single source of truth so
    # this detector reads the SAME signals the render guards gate on
    # (detection-superset principle). Defensive fallback keeps QA crash-free.
    try:
        from compliance_report import has_measurements as _hm
        from compliance_report import weather_verified as _wv
        meas_ok = bool(_hm(config))
        wx_ok = bool(_wv(config))
    except Exception as e:  # noqa: BLE001 — detection must never raise into the gate
        print(f"[QA] WS-5 signal import skipped: {e}")
        return flags

    text = _forensic_superset_text(config)
    text_l = text.lower()

    # (1) WS5_NO_MEASUREMENTS_ASSERTED
    if not meas_ok and "eagleview" in text_l:
        flags.append({
            "issue": "WS5_NO_MEASUREMENTS_ASSERTED",
            "severity": "medium",
            "check": "ws5_nodata",
            "detail": (
                "Claim has no usable measurements (has_measurements is False) "
                "but the narrative cites EagleView measurements — verify the "
                "measurement file was attached before delivery."
            ),
        })

    # (2) WS5_WEATHER_UNVERIFIED_CONFIRMED
    if not wx_ok and re.search(r"confirmed[^.]{0,40}(storm|severe weather|hail)", text_l):
        flags.append({
            "issue": "WS5_WEATHER_UNVERIFIED_CONFIRMED",
            "severity": "medium",
            "check": "ws5_nodata",
            "detail": (
                "Claim is not weather-verified (no hail_size/storm_date/"
                "storm_description and no NOAA event_count) but the narrative "
                "asserts a 'confirmed' storm — soften to 'reported' or attach "
                "storm verification."
            ),
        })

    # (3) WS5_PLACEHOLDER_OWNER
    ins = config.get("insured", {})
    if isinstance(ins, dict):
        owner = (ins.get("name") or "").strip().lower()
        if owner in ("property owner", ""):
            flags.append({
                "issue": "WS5_PLACEHOLDER_OWNER",
                "severity": "medium",
                "check": "ws5_nodata",
                "detail": (
                    "insured.name is the 'Property Owner' placeholder — set the "
                    "real homeowner_name so the appeal package is targeted."
                ),
            })

    return flags


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
7. FABRICATED WEATHER EVENT — a storm peril (hail/wind/tornado) magnitude asserted in the prose that DIRECTLY CONTRADICTS confirmed NOAA ground truth. This is the ONLY weather case that blocks. Fire it ONLY when the prose states a SPECIFIC magnitude that materially exceeds the NOAA maximum — e.g. prose says "3-inch hail" but `noaa_max_hail_inches` is 1.0, or "120 mph winds" but `noaa_max_wind_mph` is 60. The NOAA fields are authoritative: a hail claim IS supported when `noaa_confirmed_hail` is true (or `noaa_max_hail_inches` > 0); a wind claim IS supported when `noaa_confirmed_wind` is true (or `noaa_max_wind_mph` > 0); `noaa_event_count` is how many corroborating events NOAA found. Do NOT flag hail language when `noaa_confirmed_hail` is true, nor wind language when `noaa_confirmed_wind` is true — that is corroborated. Qualitative descriptions consistent with confirmed events ("broad-field hail event", "hail strike signatures", "high-wind storm") are NOT fabrications.
   ABSENCE IS NOT CONTRADICTION: when NOAA returned no/low corroborating events (`noaa_confirmed_* ` false, low `noaa_event_count`), do NOT flag this as a critical fabrication — NOAA has real coverage gaps (wind is under-reported; NCEI has publication lag). Uncorroborated-but-uncontradicted weather language is handled by the deterministic `NOAA_NO_HAIL/WIND_CORROBORATION` MEDIUM, not here. When in doubt, do NOT flag.
   NOT A WEATHER EVENT: material systems, trades, and components mentioned in the prose — siding, fascia, soffit, gutters, roofing, windows, drip edge, etc. — are NEVER weather events. A trade or material named in the prose but absent from the estimate scope (`trades`) is NOT a fabrication and must NEVER be flagged as FABRICATED WEATHER EVENT (the forensic report legitimately describes all material systems inspected and all observed damage, independent of which trades the estimate scopes). Counts of "findings", "observations", or "documented items" are likewise never weather events. None of these are critical.

MEDIUM issues (log but do not block):
- AI ARTIFACTS — phrases like "As an AI", "I'd be happy to", "I cannot provide", "I'll do my best".
- FABRICATED INSPECTOR NAMES — any inspector name that is not `canonical_ceo_name` or a recognizable company employee. If no inspector name is mentioned, this is fine.
- PHOTO COUNT DRIFT — prose explicitly claims "X photographs" / "X photos" where X differs from `photo_count` by more than 5. Smaller deltas are fine.
- WEASEL ADVOCACY — borderline advocacy language for contractor reports ("the carrier should consider", "we recommend the carrier").

LOW issues (cosmetic):
- Awkward phrasing, date format inconsistencies, repeated sentences, missing oxford commas.

RULES:
- A partial address match is still a match (e.g., "8 Franklin St" in prose matches canonical "8 Franklin St, Greene, NY 13778" — this is fine).
- Case-insensitive comparisons.
- If the canonical field is empty string, do NOT flag the prose for mentioning or not mentioning that field.
- Do NOT invent issues. Only flag facts that are demonstrably wrong.
- When in doubt, do NOT flag — Tom would rather let a stylistic issue through than false-positive block a good report.

CRITICAL LIST IS CLOSED. Only the seven numbered items above (ADDRESS / DATE-OF-LOSS / CARRIER / HOMEOWNER / UPPA / MULTIPLE-PROPERTIES / FABRICATED WEATHER) are ever critical. Do NOT invent new critical categories (e.g. PHOTO_COUNT_MISMATCH_AS_FINDINGS, CONSISTENCY_DRIFT, etc.). If an issue doesn't fit the seven, it is medium or low.

"FINDINGS" IS NOT "PHOTOS". Counts of "findings", "observations", "documented items", "damage points", "defects", or "deficiencies" are NOT photo counts — one photo can contain several findings, and some findings span multiple photos. Never flag a findings-count sentence as a photo-count drift. Only flag PHOTO COUNT DRIFT when the prose literally says "N photographs" / "N photos" / "N images".

PHOTO COUNT DRIFT IS ALWAYS MEDIUM. Even if the photo count is wildly off, it is medium — never critical. A wrong photo count does not block delivery.

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


_WORD_NUM = {
    "one": 1.0, "two": 2.0, "three": 3.0, "four": 4.0, "five": 5.0, "six": 6.0,
    "seven": 7.0, "eight": 8.0, "nine": 9.0, "ten": 11.0,
}


def _max_hail_inches_in_text(text: str):
    """Largest hail size (inches) mentioned in free text, or None."""
    t = (text or "").lower()
    sizes: list[float] = []
    for m in re.finditer(r'(\d+(?:\.\d+)?)\s*[-]?\s*(?:inch|inches|in\b|")', t):
        try:
            sizes.append(float(m.group(1)))
        except ValueError:
            pass
    for word, val in _WORD_NUM.items():
        if re.search(rf'\b{word}[\s-]+inch', t):
            sizes.append(val)
    return max(sizes) if sizes else None


def _max_wind_mph_in_text(text: str):
    """Largest wind speed (mph) mentioned in free text, or None."""
    t = (text or "").lower()
    speeds: list[float] = []
    for m in re.finditer(r'(\d+(?:\.\d+)?)\s*[-]?\s*(?:mph|mile)', t):
        try:
            speeds.append(float(m.group(1)))
        except ValueError:
            pass
    return max(speeds) if speeds else None


def _gate_fabricated_weather_severity(result: dict, ground_truth: dict) -> dict:
    """Deterministically enforce Tom's posture for FABRICATED_WEATHER_EVENT.

    The LLM cannot reliably make the numeric call (it flagged a report's 1.75"
    hail against a 2.0" NOAA max as fabrication, and treats mere ABSENCE of NOAA
    data as contradiction). Per the 2026-05-27 decision: a weather flag stays
    CRITICAL only when the prose asserts a peril magnitude that EXCEEDS confirmed
    NOAA data. Confirmed-but-within-max, absence-of-corroboration, and
    non-magnitude (trade/material/findings) mentions are downgraded to a MEDIUM
    for human review — never a release block. Absence is covered separately by
    the deterministic NOAA_NO_HAIL/WIND_CORROBORATION medium.
    """
    confirmed_hail = bool(ground_truth.get("noaa_confirmed_hail"))
    confirmed_wind = bool(ground_truth.get("noaa_confirmed_wind"))
    try:
        noaa_hail = float(ground_truth.get("noaa_max_hail_inches") or 0)
    except (TypeError, ValueError):
        noaa_hail = 0.0
    try:
        noaa_wind = float(ground_truth.get("noaa_max_wind_mph") or 0)
    except (TypeError, ValueError):
        noaa_wind = 0.0
    HAIL_MARGIN = 0.5   # inches the prose must exceed the NOAA max by
    WIND_RATIO = 1.25   # prose wind must exceed NOAA max by 25%

    kept: list[dict] = []
    downgraded: list[dict] = []
    for c in (result.get("critical") or []):
        if c.get("issue") != "FABRICATED_WEATHER_EVENT":
            kept.append(c)
            continue
        blob = " ".join(str(c.get(k, "")) for k in ("found", "expected", "quote"))
        prose_hail = _max_hail_inches_in_text(blob)
        prose_wind = _max_wind_mph_in_text(blob)
        is_contradiction = (
            (confirmed_hail and prose_hail is not None and prose_hail > noaa_hail + HAIL_MARGIN)
            or (confirmed_wind and prose_wind is not None and prose_wind > noaa_wind * WIND_RATIO)
        )
        if is_contradiction:
            kept.append(c)
        else:
            d = dict(c)
            d["issue"] = "WEATHER_CLAIM_UNCORROBORATED"
            d["severity"] = "medium"
            d["detail"] = (
                "Downgraded from critical: weather language is not a magnitude "
                "contradiction of confirmed NOAA data (absence of corroboration or a "
                "magnitude within the NOAA maximum is not fabrication). Human review only."
            )
            downgraded.append(d)

    if downgraded:
        result["critical"] = kept
        result["medium"] = (result.get("medium") or []) + downgraded
        result["passed"] = len(kept) == 0
        result["recommendation"] = (
            "ship" if not kept else ("hold" if len(kept) <= 2 else "reprocess")
        )
    return result


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
    claude: anthropic.Anthropic,
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
                model=MODEL,
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )
        else:
            response = claude.messages.create(
                model=MODEL,
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )
        raw = response.content[0].text
    except Exception as e:
        return _fail_safe_result(f"api error: {str(e)[:200]}")

    result = _parse_audit_response(raw)
    result = _gate_fabricated_weather_severity(result, ground_truth)
    result["ground_truth"] = ground_truth
    result["audited_at"] = datetime.utcnow().isoformat() + "Z"
    return result


def audit_claim(
    config: dict,
    claim: dict,
    claude: anthropic.Anthropic,
    call_claude_fn=None,
) -> dict:
    """Combined audit — deterministic PDF/brand/NOAA checks + LLM prose audit.

    Runs the deterministic checks FIRST (fast, no API cost) and merges their
    flags into the final result. The LLM prose audit is still the workhorse
    for content hallucinations; the deterministic checks catch the things
    the LLM can't see (logo image, PDF text contents, NOAA cross-reference).

    Driven by 2026-05-01 brand-leak incident: six claims shipped with the
    wrong logo because the LLM prose was internally consistent — only the
    embedded LOGO IMAGE was wrong, and prose audit can't see logos.

    Returns the same `qa_audit_flags` schema the rest of the pipeline expects.
    """
    from qa_pdf_checks import run_pdf_checks

    # Wrap deterministic checks so a bug here can't disable the whole audit
    # (processor.py's outer try/except would otherwise fail open with
    # qa_audit_result=None, also disabling the prose audit). Preserve prose
    # audit availability even on PDF check crash.
    try:
        pdf_result = run_pdf_checks(claim, config)
    except Exception as e:
        print(f"[QA] run_pdf_checks crashed (continuing with prose-only): {e}")
        pdf_result = {
            "critical": [],
            "medium": [],
            "low": [{
                "issue": "QA_CHECK_EXCEPTION",
                "severity": "low",
                "check": "run_pdf_checks",
                "detail": f"{type(e).__name__}: {str(e)[:200]}",
            }],
        }

    pdf_crit_count = len(pdf_result.get("critical", []))
    prose_skipped = pdf_crit_count > 0

    # Short-circuit: if the deterministic PDF/brand check found a CRITICAL
    # (wrong logo, missing owner brand, other-tenant leak), skip the LLM
    # prose audit entirely. The claim will be blocked + reprocessed regardless
    # of what prose audit finds, so spending an Anthropic call to grade the
    # prose of a doc that's about to be regenerated is wasted spend. Returns
    # a stub prose_result so the merge logic below stays uniform.
    if prose_skipped:
        prose_result = {
            "critical": [],
            "medium": [],
            "low": [],
            "summary": "Prose audit skipped — deterministic PDF/brand critical takes precedence.",
            "ground_truth": None,
            "audited_at": None,
        }
        print(f"[QA] Short-circuiting prose audit — {pdf_crit_count} PDF/brand critical found")
    else:
        prose_result = audit_forensic_prose(config, claim, claude, call_claude_fn=call_claude_fn)

    # WS-0 forensic prevalence flags — MEDIUM-only detection layer. Computed
    # unconditionally (cheap, no API cost, no DB read) and merged into MEDIUM
    # ONLY. By construction these can never be critical, so they cannot affect
    # `passed`, `recommendation`, or qa_blocked — pure telemetry/early-warning.
    try:
        prevalence_flags = compute_forensic_prevalence_flags(config, claim)
    except Exception as e:  # noqa: BLE001 — detection must never break the audit
        print(f"[QA] compute_forensic_prevalence_flags crashed (ignored): {e}")
        prevalence_flags = []

    # WS-5 no-data / placeholder flags — MEDIUM-only, same posture as WS-0.
    # Asserting measurements/weather the claim doesn't have, or a placeholder
    # owner. Never critical, never blocking — pure early-warning telemetry.
    try:
        ws5_flags = compute_ws5_nodata_flags(config, claim)
    except Exception as e:  # noqa: BLE001 — detection must never break the audit
        print(f"[QA] compute_ws5_nodata_flags crashed (ignored): {e}")
        ws5_flags = []

    # Merge flag arrays. Order: prose flags first (carries the LLM's narrative
    # summary), then deterministic — keeps the human-readable audit summary
    # focused on prose issues with brand/NOAA flags appended below.
    merged_critical = list(prose_result.get("critical") or []) + pdf_result.get("critical", [])
    merged_medium = (
        list(prose_result.get("medium") or [])
        + pdf_result.get("medium", [])
        + prevalence_flags
        + ws5_flags
    )
    merged_low = list(prose_result.get("low") or []) + pdf_result.get("low", [])

    passed = len(merged_critical) == 0
    summary = prose_result.get("summary", "") or ""
    if pdf_crit_count:
        # Make the PDF-side critical front and center in the summary so
        # admins see it without having to expand the flags list.
        kinds = sorted({f.get("issue", "?") for f in pdf_result["critical"]})
        summary = f"BLOCKED ({pdf_crit_count} PDF/brand critical: {', '.join(kinds)}). " + summary

    if passed:
        recommendation = "ship"
    elif pdf_crit_count >= 1:
        # ANY PDF/brand critical means the document needs regeneration — the
        # logo or company info is wrong, no admin override of "hold" makes sense.
        recommendation = "reprocess"
    elif len(merged_critical) >= 3:
        recommendation = "reprocess"
    else:
        recommendation = "hold"

    return {
        "passed": passed,
        "critical": merged_critical,
        "medium": merged_medium,
        "low": merged_low,
        "recommendation": recommendation,
        "summary": summary,
        "ground_truth": prose_result.get("ground_truth"),
        "audited_at": prose_result.get("audited_at") or datetime.utcnow().isoformat() + "Z",
        # Telemetry: which checks ran, how many flags each contributed.
        # When the prose audit was short-circuited, prose_* counts are null
        # rather than 0 so dashboards can distinguish "ran clean" from
        # "never ran".
        "audit_layers": {
            "prose_skipped": prose_skipped,
            "prose_critical": None if prose_skipped else len(prose_result.get("critical") or []),
            "prose_medium": None if prose_skipped else len(prose_result.get("medium") or []),
            "prose_low": None if prose_skipped else len(prose_result.get("low") or []),
            "pdf_critical": pdf_crit_count,
            "pdf_medium": len(pdf_result.get("medium", [])),
            "pdf_low": len(pdf_result.get("low", [])),
            # WS-0 forensic prevalence flags (always MEDIUM, never blocking).
            "forensic_prevalence_medium": len(prevalence_flags),
        },
    }


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
