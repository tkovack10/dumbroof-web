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
# Periods (M. Green vs M Green), apostrophes (Bob's vs Bobs, Bob’s vs Bobs),
# hyphens including en-dash/em-dash (frequent in copy-pasted carrier names),
# slashes, ampersand (handled separately above).
_PUNCT_RE = re.compile(r"[.,'`’\-–—_/\\&]")


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


def _download_pdf_text(sb_url: str, sk: str, storage_path: str,
                        first_n_pages: int = 2) -> tuple[str, Optional[str]]:
    """Fetch PDF from Supabase Storage and return (text, error). Empty error on success."""
    import urllib.request
    download_url = f"{sb_url}/storage/v1/object/claim-documents/{storage_path}"
    req = urllib.request.Request(
        download_url,
        headers={"apikey": sk, "Authorization": f"Bearer {sk}"},
    )
    try:
        # 20s timeout: forensic PDFs are typically 1-25MB; longer than 20s
        # almost always means Supabase Storage is degraded (522 storm pattern).
        with urllib.request.urlopen(req, timeout=20) as resp:
            pdf_bytes = resp.read()
    except Exception as e:
        return "", f"download failed: {str(e)[:120]}"
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        # Branding surfaces are concentrated on cover + page 2 (TOC + first
        # title block). Pages beyond risk false-positives from carrier letter
        # text that legitimately quotes a name overlapping with another admin.
        text_pages = []
        for p in range(min(first_n_pages, len(doc))):
            text_pages.append(doc.load_page(p).get_text("text") or "")
        doc.close()
        return "\n".join(text_pages), None
    except Exception as e:
        return "", f"parse failed: {str(e)[:120]}"


def check_pdf_brand_text(claim: dict, config: dict,
                          *, owner_company_name: Optional[str] = None) -> list[dict]:
    """Open EVERY rendered PDF; verify only the owner's brand name appears.

    This is the LAST line of defense — catches the case where:
      - config.company looks correct (passes check_brand_match)
      - BUT the PDF generator embedded a different logo OR a stale company
        block from a cached template
    The 2026-05-01 brand-leak incident slipped through because the prose was
    correct AND config.company was correct — only the LOGO IMAGE was wrong.
    Looking at the rendered output is the only way to catch that class of bug.

    Scans every PDF in output_files (forensic, estimate, scope comparison,
    clarification letter) — a generator bug that swaps the
    logo on only one document type would otherwise slip through.

    `owner_company_name` can be passed in by the aggregator to avoid a
    redundant company_profiles fetch (already pulled by check_brand_match).
    """
    flags: list[dict] = []
    user_id = claim.get("user_id")
    file_path_root = claim.get("file_path") or ""
    output_files = claim.get("output_files") or []
    if not user_id or not file_path_root or not output_files:
        return flags

    sb_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    sk = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not sb_url or not sk:
        return [{"issue": "PDF_CHECK_SKIPPED", "severity": "low",
                 "detail": "SUPABASE_URL or SUPABASE_SERVICE_KEY missing"}]

    # Hoist owner profile fetch into the aggregator if provided
    if owner_company_name is None:
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
        owner_company_name = ""
        if owner_rows:
            owner_company_name = (owner_rows[0].get("company_name") or "").strip()
    expected_name = owner_company_name or ""

    expected_norm = _norm(expected_name)
    forbidden = _build_forbidden_brands(claim, expected_name)

    # Build "safe zone" of normalized strings from legitimate other parties on
    # this claim (homeowner, carrier, adjuster, property address). If a
    # forbidden brand match falls inside one of those strings AND the safe
    # term itself contains that brand as a whole-phrase, it's a name collision,
    # not a leak. Example: carrier "Liberty Mutual" suppresses admin "Liberty
    # Roofing"; homeowner "Mark Greene" suppresses admin "M Green Construction".
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

    def _matches_outside_safe_zone(needle_norm: str, hay_norm: str) -> bool:
        """True iff needle appears in hay AND no safe-zone match covers it."""
        if not _word_boundary_match(needle_norm, hay_norm):
            return False
        # Word-boundary hit — suppress only if the brand also matches as a
        # whole-phrase inside a safe term (i.e. needle's words are a contiguous
        # subsequence of a legitimate party's name). Word-boundary on safe term
        # closes the C5 hole where bare substring suppressed legitimate leaks.
        for safe in safe_norms:
            if _word_boundary_match(needle_norm, safe):
                return False
        return True

    # Scan EVERY rendered PDF for FORBIDDEN brand leaks (the actual safety
    # net — a generator bug that swaps the logo on any single doc would
    # otherwise slip through).
    #
    # Only require the EXPECTED owner brand to appear on the FORENSIC PDF.
    # Other doc types (Xactimate estimate, scope comparison, cover letter)
    # legitimately render the company name only as a logo image OR only in a
    # later-page footer, so requiring page-1-2 text presence on those would
    # be a sea of false positives. The forensic cover is our canonical
    # branded surface — missing brand there is genuinely anomalous.
    for pdf_filename in output_files:
        is_forensic = "FORENSIC" in pdf_filename.upper()
        storage_path = f"{file_path_root}/output/{pdf_filename}"
        text, err = _download_pdf_text(sb_url, sk, storage_path, first_n_pages=2)
        if err:
            flags.append({
                "issue": "PDF_DOWNLOAD_OR_PARSE_FAILED",
                "severity": "low",
                "check": "check_pdf_brand_text",
                "detail": f"{pdf_filename}: {err}",
                "file": pdf_filename,
            })
            continue
        text_norm = _norm(text)

        # 1. Forensic-only: verify expected brand appears
        if is_forensic and expected_norm and not _word_boundary_match(expected_norm, text_norm):
            flags.append({
                "issue": "PDF_MISSING_OWNER_BRAND",
                "severity": "critical",
                "file": pdf_filename,
                "expected": expected_name,
                "detail": f"{pdf_filename} cover does not contain owner company name '{expected_name}'",
                "cover_excerpt": text[:300],
            })

        # 2. All PDFs: verify NO other-tenant brand name leaks
        leaked = []
        for name in forbidden:
            if _matches_outside_safe_zone(_norm(name), text_norm):
                leaked.append(name)
        if leaked:
            flags.append({
                "issue": "PDF_BRAND_LEAK",
                "severity": "critical",
                "file": pdf_filename,
                "expected": expected_name,
                "found": leaked,
                "detail": f"{pdf_filename} contains other-tenant company name(s): {leaked}",
                "cover_excerpt": text[:300],
            })

    return flags


def check_logo_present(claim: dict, config: dict) -> list[dict]:
    """Verify the forensic causation PDF cover page contains an actual
    embedded image. Catches:
      - Empty <img src=""> rendered as broken alt-text (E203, Team Builders 2026-05-05).
      - Non-raster logo uploads (.ai, .pdf, .svg, .eps) that download but won't render.
      - Corrupt or 0-byte logo files that pass file-exists but render as broken.

    Implementation: PyMuPDF page.get_images(full=True) returns embedded image
    XObjects. Zero images on the cover page of the forensic PDF is the
    canonical broken state. Other PDFs can legitimately have logo-as-text-only
    in headers, so we scan only the forensic causation cover.
    """
    flags: list[dict] = []
    user_id = claim.get("user_id")
    file_path_root = claim.get("file_path") or ""
    output_files = claim.get("output_files") or []
    if not user_id or not file_path_root or not output_files:
        return flags

    sb_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    sk = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not sb_url or not sk:
        return [{"issue": "QA_CHECK_SKIPPED", "severity": "low",
                 "check": "check_logo_present",
                 "detail": "SUPABASE_URL or SUPABASE_SERVICE_KEY missing"}]

    forensic_files = [f for f in output_files if "FORENSIC" in f.upper()]
    if not forensic_files:
        return flags

    import urllib.request
    for pdf_filename in forensic_files:
        storage_path = f"{file_path_root}/output/{pdf_filename}"
        download_url = f"{sb_url}/storage/v1/object/claim-documents/{storage_path}"
        req = urllib.request.Request(
            download_url,
            headers={"apikey": sk, "Authorization": f"Bearer {sk}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                pdf_bytes = resp.read()
        except Exception as e:
            flags.append({
                "issue": "QA_CHECK_DEGRADED",
                "severity": "low",
                "check": "check_logo_present",
                "detail": f"{pdf_filename}: download failed: {str(e)[:120]}",
            })
            continue
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            if len(doc) == 0:
                doc.close()
                flags.append({
                    "issue": "PDF_LOGO_MISSING",
                    "severity": "critical",
                    "check": "check_logo_present",
                    "file": pdf_filename,
                    "detail": f"{pdf_filename} has no pages — generation likely failed",
                })
                continue
            cover_images = doc.load_page(0).get_images(full=True)
            doc.close()
        except Exception as e:
            flags.append({
                "issue": "QA_CHECK_DEGRADED",
                "severity": "low",
                "check": "check_logo_present",
                "detail": f"{pdf_filename}: parse failed: {str(e)[:120]}",
            })
            continue

        if not cover_images:
            flags.append({
                "issue": "PDF_LOGO_MISSING",
                "severity": "critical",
                "check": "check_logo_present",
                "file": pdf_filename,
                "detail": (f"{pdf_filename} cover page has zero embedded images. "
                           "Logo failed to render — likely non-raster upload "
                           "(.ai/.pdf/.svg/.eps), corrupt file, or missing logo_path."),
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

    Hoists the owner-profile lookup so check_brand_match and
    check_pdf_brand_text don't both fetch the same row.

    USARM SHORT-CIRCUIT: If the owner is a USARM internal user (is_usarm=true),
    skip the brand checks entirely. USARM claims rotate among team members
    (Devon Allen, BR Scittarelli, KS Collon, etc.) — each has their own
    company_profiles row but the canonical PDF brand is "USA Roof Masters".
    The per-assignee mismatch is by design, not a brand leak. The is_usarm
    forbidden-list exclusion in _build_forbidden_brands already protects
    EXTERNAL claims from picking up USARM branding; we don't need a per-claim
    brand audit on USARM's own internal pipeline.
    """
    all_flags: list[dict] = []

    # Pre-fetch owner profile once; pass into individual checks
    user_id = claim.get("user_id")
    owner_company_name: Optional[str] = None
    is_usarm_owner = False
    if user_id:
        prof_rows = _supabase_get(
            f"/rest/v1/company_profiles?user_id=eq.{user_id}"
            "&select=company_name,contact_name,email,phone,office_phone,is_usarm,role"
        )
        if prof_rows is SUPABASE_FETCH_FAILED:
            all_flags.append({
                "issue": "QA_CHECK_DEGRADED",
                "severity": "low",
                "check": "owner_profile_prefetch",
                "detail": "Could not pre-fetch company_profiles — Supabase request failed.",
            })
            owner_profile = None
        else:
            owner_profile = prof_rows[0] if prof_rows else None
            if owner_profile:
                owner_company_name = (owner_profile.get("company_name") or "").strip()
                is_usarm_owner = bool(owner_profile.get("is_usarm"))
    else:
        owner_profile = None

    # Skip brand + PDF text checks for USARM internal claims (see docstring).
    # NOAA cross-check still runs because it's storm-evidence about the
    # claim address, not brand-isolation about the owner.
    if is_usarm_owner:
        try:
            all_flags.extend(check_dol_noaa(claim, config))
        except Exception as e:
            all_flags.append({
                "issue": "QA_CHECK_EXCEPTION", "severity": "low",
                "check": "check_dol_noaa",
                "detail": f"{type(e).__name__}: {str(e)[:200]}",
            })
        return {
            "critical": [f for f in all_flags if f.get("severity") == "critical"],
            "medium": [f for f in all_flags if f.get("severity") == "medium"],
            "low": [f for f in all_flags if f.get("severity") == "low"],
        }

    # Run brand_match using the pre-fetched profile
    try:
        all_flags.extend(_check_brand_match_with_profile(claim, config, owner_profile))
    except Exception as e:
        all_flags.append({
            "issue": "QA_CHECK_EXCEPTION", "severity": "low",
            "check": "check_brand_match",
            "detail": f"{type(e).__name__}: {str(e)[:200]}",
        })

    # Run pdf_brand_text passing the company name to skip its own profile fetch
    try:
        all_flags.extend(check_pdf_brand_text(
            claim, config, owner_company_name=owner_company_name
        ))
    except Exception as e:
        all_flags.append({
            "issue": "QA_CHECK_EXCEPTION", "severity": "low",
            "check": "check_pdf_brand_text",
            "detail": f"{type(e).__name__}: {str(e)[:200]}",
        })

    # Logo-present positive check — catches the empty-img-src failure mode
    # that check_pdf_brand_text can't see (text content is "correct" but the
    # logo image is missing or non-raster). E203 / Team Builders 2026-05-05.
    try:
        all_flags.extend(check_logo_present(claim, config))
    except Exception as e:
        all_flags.append({
            "issue": "QA_CHECK_EXCEPTION", "severity": "low",
            "check": "check_logo_present",
            "detail": f"{type(e).__name__}: {str(e)[:200]}",
        })

    # NOAA cross-check — independent
    try:
        all_flags.extend(check_dol_noaa(claim, config))
    except Exception as e:
        all_flags.append({
            "issue": "QA_CHECK_EXCEPTION", "severity": "low",
            "check": "check_dol_noaa",
            "detail": f"{type(e).__name__}: {str(e)[:200]}",
        })

    return {
        "critical": [f for f in all_flags if f.get("severity") == "critical"],
        "medium": [f for f in all_flags if f.get("severity") == "medium"],
        "low": [f for f in all_flags if f.get("severity") == "low"],
    }


def _check_brand_match_with_profile(claim: dict, config: dict,
                                      profile: Optional[dict]) -> list[dict]:
    """Internal — same as check_brand_match but takes a pre-fetched profile."""
    flags: list[dict] = []
    if not profile:
        return flags
    company = config.get("company", {}) or {}
    field_pairs = [
        ("company_name", "name", "critical", "company name"),
        ("contact_name", "ceo_name", "critical", "owner / CEO name"),
        ("email", "email", "critical", "company email"),
    ]
    for prof_key, cfg_key, sev, label in field_pairs:
        expected = (profile.get(prof_key) or "").strip()
        actual = (company.get(cfg_key) or "").strip()
        if expected and actual and _norm(expected) != _norm(actual):
            flags.append({
                "issue": "BRAND_MISMATCH", "severity": sev, "field": label,
                "expected": expected, "found": actual,
                "detail": f"PDF {label} '{actual}' does not match owner profile '{expected}'",
            })
    profile_phones = {_norm(profile.get("phone") or ""), _norm(profile.get("office_phone") or "")}
    profile_phones.discard("")
    config_phones = {_norm(company.get("cell_phone") or ""), _norm(company.get("office_phone") or "")}
    config_phones.discard("")
    if profile_phones and config_phones and not (profile_phones & config_phones):
        flags.append({
            "issue": "BRAND_MISMATCH", "severity": "critical", "field": "phone",
            "expected": sorted(profile_phones), "found": sorted(config_phones),
            "detail": "PDF phone numbers do not overlap with owner profile phone numbers",
        })
    return flags
