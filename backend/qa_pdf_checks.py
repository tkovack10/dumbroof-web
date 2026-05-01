"""QA PDF + brand checks — deterministic verification before customer delivery.

Runs alongside the LLM prose audit in `qa_auditor.audit_claim()`. Three checks:

1. brand_match  — config.company vs company_profiles ground truth (CRITICAL)
2. pdf_brand_text — download PDF, verify owner brand appears AND no other-tenant
                    brand name leaks into the cover page (CRITICAL)
3. dol_noaa     — NOAA cross-check: if forensic prose claims hail/wind, verify
                  NOAA has corroborating events near property in the DOL window
                  (MEDIUM — false-positive risk too high to block delivery)

Each function returns a list[dict] of flags with shape:
    {"issue": "...", "severity": "critical|medium|low", "detail": "...", ...}

The `run_pdf_checks()` aggregator returns a dict that merges into
`qa_audit_flags.{critical, medium, low}` arrays.

Driven by 2026-05-01 brand-leak incident (E196): six claims shipped with
JA Squared / M. Green / Bob's Roofing logos burned into PDFs whose actual
owner was a different gmail.com admin. The LLM prose audit didn't catch
it because the prose was internally consistent — only the LOGO was wrong.
"""

from __future__ import annotations

import io
import json
import os
import re
from typing import Optional

# PyMuPDF is already in backend/requirements.txt
import fitz  # type: ignore


# Sentinel returned by _supabase_get when the REQUEST itself failed (network /
# auth error). Lets callers distinguish "no rows" (legitimate empty) from
# "couldn't reach Supabase" (degraded — emit a low-severity flag).
SUPABASE_FETCH_FAILED = object()


def _supabase_get(path: str):
    """Slim Supabase REST helper using service role.

    Returns:
        list — successful query (may be empty list for no-results)
        SUPABASE_FETCH_FAILED — request failed (network/auth/timeout)
    """
    import urllib.request
    url = os.environ.get("SUPABASE_URL", "").rstrip("/") + path
    sk = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not sk:
        return SUPABASE_FETCH_FAILED
    req = urllib.request.Request(
        url,
        headers={"apikey": sk, "Authorization": f"Bearer {sk}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode())
            return data if isinstance(data, list) else SUPABASE_FETCH_FAILED
    except Exception:
        return SUPABASE_FETCH_FAILED


# Pattern for stripping common punctuation/symbols during brand normalization.
# Periods (M. Green vs M Green), apostrophes (Bob's vs Bobs), hyphens, &, commas.
_PUNCT_RE = re.compile(r"[.,'`’\-_/\\&]")


def _norm(s: Optional[str]) -> str:
    """Lowercase + collapse whitespace + drop punctuation for tolerant comparison.

    Handles real-world PDF text extraction quirks:
      - PyMuPDF often drops periods → "M. Green" renders as "M Green"
      - Brand names with apostrophes ("Bob's Roofing") render as "Bobs Roofing"
      - Ampersand sometimes becomes " and " in carrier letters
      - Line wraps in cover blocks → company name spans 2 lines
    """
    if not s:
        return ""
    s = s.lower()
    # Normalize "&" to " and " before stripping punctuation so "Smith & Sons"
    # matches "Smith and Sons"
    s = s.replace("&", " and ")
    s = _PUNCT_RE.sub(" ", s)
    return " ".join(s.split())


def _word_boundary_match(needle: str, haystack: str) -> bool:
    """Whole-phrase match anchored on word boundaries.

    Prevents false-positives like "Apex Roofing" matching inside an address
    "123 Apex Lane" or a carrier letter quoting "apex of the roof". Both
    args should already be `_norm`-ed.
    """
    if not needle or not haystack:
        return False
    pattern = rf"\b{re.escape(needle)}\b"
    return re.search(pattern, haystack) is not None


def check_brand_match(claim: dict, config: dict) -> list[dict]:
    """Verify config.company matches the claim owner's company_profiles row.

    This is the structural check — same data the PDF generator embeds in
    headers/footers/contact blocks. If config.company drifts from the
    profile, every PDF will be branded wrong before we ever read text from
    them.
    """
    flags: list[dict] = []
    user_id = claim.get("user_id")
    if not user_id:
        return flags

    profile_rows = _supabase_get(
        f"/rest/v1/company_profiles?user_id=eq.{user_id}"
        "&select=company_name,contact_name,email,phone,office_phone,is_usarm,role"
    )
    if profile_rows is SUPABASE_FETCH_FAILED:
        return [{
            "issue": "QA_CHECK_DEGRADED",
            "severity": "low",
            "check": "check_brand_match",
            "detail": "Could not fetch company_profiles — Supabase request failed. Brand match check did not run.",
        }]
    if not profile_rows:
        return flags  # No profile row exists — nothing to compare against.
    profile = profile_rows[0]

    company = config.get("company", {}) or {}

    # Pairs of (profile_field, config_field, severity, label)
    field_pairs = [
        ("company_name", "name", "critical", "company name"),
        ("contact_name", "ceo_name", "critical", "owner / CEO name"),
        ("email", "email", "critical", "company email"),
        # phone we accept either cell or office on the config side
    ]

    for prof_key, cfg_key, sev, label in field_pairs:
        expected = (profile.get(prof_key) or "").strip()
        actual = (company.get(cfg_key) or "").strip()
        if expected and actual and _norm(expected) != _norm(actual):
            flags.append({
                "issue": "BRAND_MISMATCH",
                "severity": sev,
                "field": label,
                "expected": expected,
                "found": actual,
                "detail": f"PDF {label} '{actual}' does not match owner profile '{expected}'",
            })

    # Phone: profile.phone OR profile.office_phone may match config.cell_phone OR config.office_phone
    profile_phones = {_norm(profile.get("phone") or ""), _norm(profile.get("office_phone") or "")}
    profile_phones.discard("")
    config_phones = {_norm(company.get("cell_phone") or ""), _norm(company.get("office_phone") or "")}
    config_phones.discard("")
    if profile_phones and config_phones and not (profile_phones & config_phones):
        flags.append({
            "issue": "BRAND_MISMATCH",
            "severity": "critical",
            "field": "phone",
            "expected": sorted(profile_phones),
            "found": sorted(config_phones),
            "detail": "PDF phone numbers do not overlap with owner profile phone numbers",
        })

    return flags


def _build_forbidden_brands(claim: dict, owner_company_name: str) -> list[str]:
    """Pull every other tenant's company name to grep against the PDF cover.

    Excludes:
      - the claim's own company (don't false-flag self)
      - super-short or generic names (would false-positive on common words)
      - USARM (the platform default — its leak is caught by separate is_usarm gate)
    """
    user_id = claim.get("user_id")
    if not user_id:
        return []
    rows = _supabase_get(
        "/rest/v1/company_profiles?select=user_id,company_name,is_usarm"
        "&company_name=not.is.null&limit=1000"
    )
    if rows is SUPABASE_FETCH_FAILED or not rows:
        return []

    own_norm = _norm(owner_company_name)
    forbidden: list[str] = []
    seen = set()
    for r in rows:
        if r.get("user_id") == user_id:
            continue
        if r.get("is_usarm"):
            continue  # USARM-leak handled by brand_isolation.is_usarm gate
        name = (r.get("company_name") or "").strip()
        if not name or len(name) < 5:
            continue  # Too short — false-positive risk
        if name.lower() in {"test", "demo", "n/a", "none", "tbd", "abc", "xyz"}:
            continue
        n = _norm(name)
        if n == own_norm or n in seen:
            continue
        seen.add(n)
        forbidden.append(name)
    return forbidden


def check_pdf_brand_text(claim: dict, config: dict) -> list[dict]:
    """Open the rendered forensic PDF; verify only the owner's brand name appears.

    This is the LAST line of defense — catches the case where:
      - config.company looks correct (passes check_brand_match)
      - BUT the PDF generator embedded a different logo OR a stale company
        block from a cached template
    The 2026-05-01 brand-leak incident slipped through because the prose was
    correct AND config.company was correct — only the LOGO IMAGE was wrong.
    Looking at the rendered output is the only way to catch that class of bug.
    """
    flags: list[dict] = []
    user_id = claim.get("user_id")
    file_path_root = claim.get("file_path") or ""
    output_files = claim.get("output_files") or []
    if not user_id or not file_path_root or not output_files:
        return flags

    forensic_pdf = next((f for f in output_files if "FORENSIC" in f.upper()), None)
    if not forensic_pdf:
        return flags  # No forensic = forensic-only mode skipped or failed earlier

    pdf_storage_path = f"{file_path_root}/output/{forensic_pdf}"
    sb_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    sk = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not sb_url or not sk:
        return [{"issue": "PDF_CHECK_SKIPPED", "severity": "low",
                 "detail": "SUPABASE_URL or SUPABASE_SERVICE_KEY missing"}]

    import urllib.request
    download_url = f"{sb_url}/storage/v1/object/claim-documents/{pdf_storage_path}"
    req = urllib.request.Request(
        download_url,
        headers={"apikey": sk, "Authorization": f"Bearer {sk}"},
    )
    try:
        # 20s timeout: forensic PDFs are typically 1-25MB; longer than 20s
        # almost always means Supabase Storage is degraded (we've hit the 522
        # storm pattern twice — see memory/feedback_supabase_recurring_522.md).
        # Fail fast with a degraded flag so admins know the audit didn't run,
        # rather than wedging the whole reprocess pipeline.
        with urllib.request.urlopen(req, timeout=20) as resp:
            pdf_bytes = resp.read()
    except Exception as e:
        return [{"issue": "PDF_DOWNLOAD_FAILED", "severity": "low",
                 "detail": f"Could not fetch {pdf_storage_path} (timeout 20s): {str(e)[:150]}"}]

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        # Cover page (page 0) + page 1 — covers nearly all branding surfaces
        # (logo, title block, contact footer). Going beyond risks false-positives
        # from carrier names / homeowner names that legitimately match an admin
        # surname on later pages.
        text_pages = []
        for p in range(min(2, len(doc))):
            text_pages.append(doc.load_page(p).get_text("text") or "")
        cover_text = "\n".join(text_pages)
        doc.close()
    except Exception as e:
        return [{"issue": "PDF_PARSE_FAILED", "severity": "low",
                 "detail": f"Could not parse PDF: {str(e)[:150]}"}]

    # Owner's expected brand
    owner_rows = _supabase_get(
        f"/rest/v1/company_profiles?user_id=eq.{user_id}&select=company_name"
    )
    if owner_rows is SUPABASE_FETCH_FAILED:
        return [{
            "issue": "QA_CHECK_DEGRADED",
            "severity": "low",
            "check": "check_pdf_brand_text",
            "detail": "Could not fetch owner profile — Supabase request failed. PDF brand check did not run.",
        }]
    expected_name = ""
    if owner_rows:
        expected_name = (owner_rows[0].get("company_name") or "").strip()

    # Normalize the cover text the same way we normalize brand names so a
    # company name that line-wraps in the PDF ("Affordable Roofing Siding\n
    # and Gutters") still matches the profile's flat "Affordable Roofing
    # Siding and Gutters". Plain `.lower()` preserves newlines + punctuation
    # and would false-fail; `_norm` strips both.
    cover_norm = _norm(cover_text)

    # 1. Verify expected brand appears (catches truly empty or default-USARM PDFs)
    expected_norm = _norm(expected_name)
    if expected_norm and not _word_boundary_match(expected_norm, cover_norm):
        flags.append({
            "issue": "PDF_MISSING_OWNER_BRAND",
            "severity": "critical",
            "expected": expected_name,
            "detail": f"Cover page does not contain owner company name '{expected_name}'",
            "cover_excerpt": cover_text[:300],
        })

    # 2. Verify NO other-tenant brand name leaks into the cover.
    # Build a "safe zone" of normalized strings that contain words from
    # legitimate other parties on this claim (homeowner name, carrier name,
    # adjuster name, property address). If a forbidden brand match falls
    # inside one of those strings, it's a name collision NOT a leak.
    # Example saves: carrier "Liberty Mutual" should not flag admin
    # "Liberty Roofing"; homeowner "Mark Greene" should not flag admin
    # "M. Green Construction".
    safe_terms_raw = [
        (config.get("insured", {}) or {}).get("name", ""),
        (claim.get("homeowner_name") or ""),
        (config.get("carrier", {}) or {}).get("name", ""),
        (claim.get("carrier") or ""),
        (config.get("carrier", {}) or {}).get("adjuster_name", ""),
        (claim.get("adjuster_name") or ""),
        (config.get("property", {}) or {}).get("address", ""),
        (claim.get("address") or ""),
    ]
    safe_norms = [_norm(t) for t in safe_terms_raw if t and len(t.strip()) >= 4]

    def _matches_outside_safe_zone(needle_norm: str) -> bool:
        """True iff needle appears anywhere in cover that is NOT inside a safe term."""
        if not _word_boundary_match(needle_norm, cover_norm):
            return False
        # Word-boundary match found — but is every match inside a safe term?
        for safe in safe_norms:
            if needle_norm in safe:
                # The brand name is a substring of a legit safe term (homeowner/
                # carrier/etc) — assume the match is on that legit usage and skip.
                return False
        return True

    forbidden = _build_forbidden_brands(claim, expected_name)
    leaked = []
    for name in forbidden:
        if _matches_outside_safe_zone(_norm(name)):
            leaked.append(name)
    if leaked:
        flags.append({
            "issue": "PDF_BRAND_LEAK",
            "severity": "critical",
            "expected": expected_name,
            "found": leaked,
            "detail": f"Cover page contains other-tenant company name(s): {leaked}",
            "cover_excerpt": cover_text[:300],
        })

    return flags


def check_dol_noaa(claim: dict, config: dict) -> list[dict]:
    """NOAA cross-check on date of loss vs forensic claim of hail/wind.

    Soft signal — homeowners frequently misremember dates by 1-2 days, and
    spotter reports are sparse outside major outbreaks. Flagged as MEDIUM
    so it surfaces in admin review without blocking customer delivery.

    The actual NOAA enrichment runs upstream in processor.py:9a; this check
    fires only if the upstream enrichment found 0 events but the synthesis
    still wrote hail/wind language into the prose.
    """
    flags: list[dict] = []

    # Pull what NOAA actually returned during processing
    weather = config.get("weather", {}) or {}
    noaa = weather.get("noaa", {}) or {}
    event_count = noaa.get("event_count", 0) or 0
    max_hail = float(noaa.get("max_hail_inches") or 0)
    max_wind = float(noaa.get("max_wind_mph") or 0)

    # Look at what the forensic prose actually claims. Use a positive-mention
    # check that ignores negated phrases ("no hail", "without hail damage",
    # "non-hail"), since those don't constitute a NOAA cross-reference need.
    findings = config.get("forensic_findings", {}) or {}
    prose_blob = json.dumps({
        "exec": findings.get("executive_summary", []),
        "concl": findings.get("conclusion_paragraphs", []),
        "args": findings.get("key_arguments", []),
        "summary": findings.get("damage_summary", ""),
    }).lower()

    def _affirmative_mention(term: str, blob: str) -> bool:
        """True iff `term` appears at least once NOT in a negated context."""
        # Find every occurrence and reject those preceded by negation phrases.
        for m in re.finditer(rf"\b{re.escape(term)}\b", blob):
            start = m.start()
            # Look at the 24 chars before for negation cues
            window = blob[max(0, start - 24):start]
            if re.search(r"\b(no|not|without|non[\- ]|absent|zero|0)\s*(observed\s+)?$", window):
                continue
            return True
        return False

    mentions_hail = _affirmative_mention("hail", prose_blob)
    mentions_wind = _affirmative_mention("wind", prose_blob)

    if mentions_hail and max_hail == 0:
        flags.append({
            "issue": "NOAA_NO_HAIL_CORROBORATION",
            "severity": "medium",
            "detail": (
                f"Forensic prose mentions hail but NOAA returned no hail events near "
                f"property within the DOL window (event_count={event_count}). Consider "
                f"verifying date_of_loss with homeowner or expanding storm window."
            ),
            "noaa_event_count": event_count,
        })

    if mentions_wind and max_wind == 0:
        flags.append({
            "issue": "NOAA_NO_WIND_CORROBORATION",
            "severity": "low",
            "detail": (
                f"Forensic prose mentions wind but NOAA returned no wind events. "
                f"Wind reports are often sparse — Storm Events DB lags ~60 days and "
                f"NEXRAD radar fallback only catches hail."
            ),
            "noaa_event_count": event_count,
        })

    return flags


def run_pdf_checks(claim: dict, config: dict) -> dict:
    """Run all deterministic checks. Each check is wrapped so a single failure
    can't crash the audit. Returns a dict with critical/medium/low arrays.
    """
    all_flags: list[dict] = []
    for fn in (check_brand_match, check_pdf_brand_text, check_dol_noaa):
        try:
            all_flags.extend(fn(claim, config))
        except Exception as e:
            all_flags.append({
                "issue": "QA_CHECK_EXCEPTION",
                "severity": "low",
                "check": fn.__name__,
                "detail": f"{type(e).__name__}: {str(e)[:200]}",
            })

    return {
        "critical": [f for f in all_flags if f.get("severity") == "critical"],
        "medium": [f for f in all_flags if f.get("severity") == "medium"],
        "low": [f for f in all_flags if f.get("severity") == "low"],
    }
