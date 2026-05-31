"""
Bulk Carrier-Comms Campaigns — Company-Scoped Richard Tools
============================================================
Two agentic, admin/owner-gated, approval-gated bulk-send flows that ANY DumbRoof
company can run from the company-scope Richard (scope="company"):

  - bulk_supplement_campaign : supplement -> carrier across all eligible paid,
    post-scope claims in the caller's company.
  - bulk_forensic_campaign   : forensic causation report -> carrier across all
    eligible claims in the caller's company.

These are the productized, multi-tenant translations of the proven one-off USARM
scripts (/tmp/supplement_batch.py, /tmp/forensic_batch.py). NOTHING is hardcoded
to USARM — company name, reps, sender, and the carrier-intake fallback map are all
resolved from the data / company_profiles, or from a small SHARED, extensible
seed map (CARRIER_INTAKE_MAP).

MULTI-TENANCY (this app has a known cross-tenant IDOR history):
  * The caller's company_id is resolved SERVER-SIDE from the authenticated
    user_id via _company_user_ids() — NEVER trusted from tool input.
  * EVERY claims query is filtered `.eq("company_id", company_id)`.
  * EVERY claim_events lookup is constrained to the company's own claim ids.
  * If company_id can't be resolved, the tools refuse (no cross-company fan-out).

APPROVAL FLOW (server-gated — the model CANNOT send):
  * The model ONLY ever runs a PREVIEW. The handler returns action="preview": the
    eligible-claim list, counts, ONE rendered sample email, the per-claim attachment
    plan, and a per-row `target_type` (named_adjuster vs carrier_intake). Sends
    NOTHING. The resolved batch is persisted server-side as a pending action keyed
    by an approval_id (mirrors the single-claim supplement/COC/AOB approve flow).
  * EXECUTE happens ONLY when a human clicks Approve, which calls the
    approve_admin_action HTTP endpoint with that approval_id. That endpoint pops the
    saved batch, RE-VERIFIES company + role + each claim's company_id, then calls
    _bulk_execute. There is NO model-callable execute path — a model tool_use can
    never reach _bulk_execute. Each send goes out via send_claim_email() from the
    claim's assigned rep, then the email side-effect recorder fires the
    supplement_sent / forensic_sent_* events and schedules the 3/7/15 cadence.

IDEMPOTENT: claims already carrying supplement_sent / forensic_sent_to_carrier are
skipped at BOTH build time and immediately before each send (the live event set is
re-queried at execute start to shrink the concurrent double-send window). Carrier
subject = bare claim number (carrier auto-routing rule).
"""

from __future__ import annotations

import re
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional, Any

from supabase import Client

import email_voice  # shared human voice picker + AI-tell linter


# ═══════════════════════════════════════════════════════════════════════
# SHARED carrier-intake fallback map (extensible; NOT USARM-specific)
# ═══════════════════════════════════════════════════════════════════════
# Used only when a claim has no adjuster_email on file. Seeded with the three
# carriers the proven scripts shipped against; add entries here and every
# campaign picks them up. Keys are matched as case-insensitive SUBSTRINGS of
# the claim's carrier name so brand variants ("State Farm Fire & Casualty")
# still route.
CARRIER_INTAKE_MAP: list[tuple[tuple[str, ...], str]] = [
    (("state farm",),            "statefarmfireclaims@statefarm.com"),
    (("allstate",),              "claims@claims.allstate.com"),
    (("guard", "berkshire"),     "claims@guard.com"),
]


def carrier_intake_email(carrier: Optional[str]) -> Optional[str]:
    """Best-effort carrier claims-intake address for a carrier with no adjuster
    email on file. Returns None when the carrier isn't in the seed map (the claim
    is then skipped — we never blast to a guessed address)."""
    c = (carrier or "").strip().lower()
    if not c:
        return None
    for needles, addr in CARRIER_INTAKE_MAP:
        if any(n in c for n in needles):
            return addr
    return None


# ═══════════════════════════════════════════════════════════════════════
# Small helpers (translated from the proven scripts; provider-agnostic)
# ═══════════════════════════════════════════════════════════════════════

def _junk_email(e: Optional[str]) -> bool:
    """True for empty / placeholder / obviously-invalid addresses."""
    if not e:
        return True
    e = e.strip().lower()
    if "@" not in e or e in ("na", "n/a", "none", "-", ".", "no", "tbd"):
        return True
    domain = e.split("@")[-1]
    return "placeholder" in domain or domain in ("example.com", "test.com", "noemail.com")


def _first_name(full: Optional[str], fallback: str = "there") -> str:
    if not full:
        return fallback
    full = full.strip()
    if "," in full:                          # "Mayton, Anna M" -> "Anna M"
        full = full.split(",")[-1].strip()
    tokens = full.split()
    return tokens[0].capitalize() if tokens else fallback


def _short_addr(a: Optional[str]) -> str:
    return re.split(r",", a or "")[0].strip()


def _norm_addr(a: Optional[str]) -> str:
    a = (a or "").lower()
    a = re.sub(r",?\s*usa\s*$", "", a)
    a = re.sub(r"\b\d{5}(-\d+)?\b", "", a)
    return re.sub(r"[^a-z0-9 ]", "", a).strip()


def _variant_index(claim_id: str, n: int, salt: str = "") -> int:
    """Deterministic, stable-per-claim variant pick. Delegates to the shared
    email_voice picker so bulk + single-send + cadence all rotate identically
    (was a separate md5 implementation)."""
    return email_voice.variant_index(claim_id, n=n, salt=salt)


def _valid_claim_number(cn: Optional[str]) -> str:
    """A claim number usable as a carrier subject + cron cadence subject:
    non-empty, no whitespace, <= 40 chars (matches the cron guard)."""
    cn = (cn or "").strip()
    return cn if (cn and " " not in cn and len(cn) <= 40) else ""


def _output_doc_path(claim: dict, *tokens: str) -> Optional[str]:
    """Resolve the storage path of an output PDF whose filename contains ANY of
    the given upper-case tokens. Mirrors the scripts: {file_path}/output/{file}."""
    files = claim.get("output_files") or []
    if not isinstance(files, list):
        return None
    file_path = (claim.get("file_path") or "").rstrip("/")
    if not file_path:
        return None
    for f in files:
        up = (f or "").upper()
        if any(t in up for t in tokens):
            return f"{file_path}/output/{f}"
    return None


# ── scope_comparison gap extraction + humanization ──────────────────────
# Production scope_comparison rows carry BOTH the script shape (item, irc_code,
# status) AND the codebase shape (checklist_desc, code_citation, status). We read
# either so the campaign works regardless of which generator produced the row.

def _gap_rows(claim: dict) -> list[dict]:
    sc = claim.get("scope_comparison") or []
    if not isinstance(sc, list):
        return []
    return [i for i in sc if isinstance(i, dict) and i.get("status") in ("missing", "under")]


def _gap_code(it: dict) -> str:
    """Code citation for a gap, from either row shape."""
    code = (it.get("irc_code") or "").strip()
    if code:
        return code
    cc = it.get("code_citation")
    if isinstance(cc, dict):
        return (cc.get("code_tag") or cc.get("section") or "").strip()
    return ""


def _humanize_gap(it: dict) -> Optional[str]:
    """Turn a scope_comparison gap row into a short, carrier-readable, code-cited
    phrase (e.g. 'ice & water barrier (per RCO R905.1.1)'). Returns None for
    truly opaque items so we never emit 'scope item'. Faithful to the proven
    supplement_batch.humanize()."""
    s = (it.get("item") or it.get("checklist_desc") or it.get("usarm_desc") or "").lower()
    code = _gap_code(it)
    suffix = f" (per {code})" if code else ""
    pairs = [
        ("steep", "steep-roof charge for the pitch"), ("step flashing", "step flashing"),
        ("ice & water", "ice & water barrier"), ("ice and water", "ice & water barrier"),
        ("starter", "starter course"), ("drip edge", "drip edge"), ("ridge vent", "ridge vent"),
        ("hip / ridge", "ridge cap"), ("ridge", "ridge cap"), ("underlayment", "underlayment"),
        ("felt", "underlayment"), ("metal roofing", "metal roofing"), ("siding", "damaged siding"),
        ("gutter", "gutters / downspouts"), ("downspout", "downspouts"),
        ("counterflash", "counter-flashing"), ("counter flash", "counter-flashing"),
        ("flashing", "flashing"), ("tear out", "full tear-off"), ("tear off", "full tear-off"),
        ("r&r ", "replacement of "), ("house wrap", "house wrap"), ("fascia", "fascia"),
        ("soffit", "soffit"), ("window", "window wrap"), ("shutter", "shutters"),
        ("pipe jack", "pipe jack / boot"), ("vent", "roof vents"), ("chimney", "chimney flashing"),
        ("valley", "valley metal"), ("o&p", "overhead & profit"), ("dumpster", "debris/dumpster"),
        ("permit", "permit"), ("detach", "detach & reset"), ("paint", "paint"),
        ("insulation", "insulation"),
    ]
    for k, v in pairs:
        if k in s:
            return v + suffix
    # clean fallback: strip action prefixes / qty noise; short Title phrase.
    base = re.sub(r"^(r&r|remove|replace|additional charge for)\s+", "", s)
    base = base.split(" - ")[0].split(",")[0].strip()
    base = re.sub(r"[^a-z0-9 /&]", "", base).strip()
    if not base or len(base) < 3:
        return None
    return base[:36] + suffix


def _top_coded_phrases(gaps: list[dict], limit: int = 4) -> list[str]:
    """Top N humanized gap phrases, preferring coded-missing, then coded-under,
    then anything. Deduped, order-stable."""
    coded = [i for i in gaps if _gap_code(i)]
    miss = [i for i in coded if i.get("status") == "missing"]
    under = [i for i in coded if i.get("status") == "under"]
    ordered = miss + under + gaps
    seen: set[str] = set()
    out: list[str] = []
    for i in ordered:
        p = _humanize_gap(i)
        if not p or p in seen:
            continue
        seen.add(p)
        out.append(p)
        if len(out) >= limit:
            break
    return out


# ═══════════════════════════════════════════════════════════════════════
# Rep / sender resolution (multi-tenant — from company_profiles)
# ═══════════════════════════════════════════════════════════════════════

def _build_rep_directory(sb: Client, company_id: str) -> dict[str, dict]:
    """Map every team member's user_id -> {name, email} from company_profiles,
    SCOPED to this company only. Used to sign emails with the assigned rep's name
    and to build a defensible CC list. NEVER reaches outside company_id."""
    directory: dict[str, dict] = {}
    try:
        res = (
            sb.table("company_profiles")
            .select("user_id, contact_name, company_name, email, sending_email")
            .eq("company_id", company_id)
            .execute()
        )
        for row in (res.data or []):
            uid = row.get("user_id")
            if not uid:
                continue
            directory[uid] = {
                "name": (row.get("contact_name") or "").strip(),
                "email": (row.get("sending_email") or row.get("email") or "").strip(),
            }
    except Exception as e:
        print(f"[BULK] rep directory load failed for company {company_id}: {type(e).__name__}: {e}", flush=True)
    return directory


def _company_display_name(sb: Client, company_id: str, owner_user_id: str) -> str:
    """The company's display name (for sign-offs). Prefers the owner's profile,
    falls back to any profile in the company. Scoped to company_id."""
    try:
        res = (
            sb.table("company_profiles")
            .select("company_name, role, user_id")
            .eq("company_id", company_id)
            .execute()
        )
        rows = res.data or []
        for r in rows:
            if r.get("user_id") == owner_user_id and (r.get("company_name") or "").strip():
                return r["company_name"].strip()
        for r in rows:
            if (r.get("company_name") or "").strip():
                return r["company_name"].strip()
    except Exception:
        pass
    return "our office"


# ═══════════════════════════════════════════════════════════════════════
# Eligibility — supplement campaign
# ═══════════════════════════════════════════════════════════════════════

# Columns we pull for the campaigns (one select, company-scoped).
_CLAIM_SELECT = (
    "id, address, phase, claim_number, carrier, adjuster_email, adjuster_name, "
    "homeowner_email, homeowner_name, assigned_user_id, user_id, contractor_rcv, "
    "current_carrier_rcv, original_carrier_rcv, scope_comparison, output_files, file_path"
)


def _company_claims(sb: Client, company_id: str, limit: int = 5000) -> list[dict]:
    """ALL of the company's claims (company-scoped). The ONLY claims query the
    campaigns run — every downstream filter operates on this list."""
    res = (
        sb.table("claims")
        .select(_CLAIM_SELECT)
        .eq("company_id", company_id)          # <<< strict multi-tenant filter
        .limit(limit)
        .execute()
    )
    return res.data or []


def _claim_event_ids(sb: Client, claim_ids: list[str], event_types: list[str]) -> set[str]:
    """Set of claim_ids (from the supplied, already company-scoped list) that have
    ANY of the given event_types. Constrained to `claim_ids` so it can never leak
    another company's events."""
    found: set[str] = set()
    if not claim_ids:
        return found
    for i in range(0, len(claim_ids), 80):
        chunk = claim_ids[i:i + 80]
        try:
            res = (
                sb.table("claim_events")
                .select("claim_id")
                .in_("claim_id", chunk)          # <<< only this company's claims
                .in_("event_type", event_types)
                .execute()
            )
            for r in (res.data or []):
                if r.get("claim_id"):
                    found.add(r["claim_id"])
        except Exception as e:
            print(f"[BULK] claim_events lookup failed: {type(e).__name__}: {e}", flush=True)
    return found


def build_supplement_batch(
    sb: Client,
    company_id: str,
    owner_user_id: str,
    *,
    min_gap_items: int = 2,
    max_claims: Optional[int] = None,
    exclude_claim_ids: Optional[list[str]] = None,
    include_carrier_intake: bool = True,
) -> tuple[list[dict], dict]:
    """Resolve all eligible supplement-campaign claims for `company_id`.

    Eligibility (faithful to supplement_batch.py, company-scoped):
      paid (payment_received OR check_received) AND post-scope phase AND
      current_carrier_rcv > 0 AND contractor_rcv - current_carrier_rcv > 0 AND
      >= min_gap_items code-cited/normal gaps from scope_comparison AND Doc03
      (scope comparison) present AND an adjuster OR carrier-intake target AND NOT
      already supplement_sent AND not explicitly excluded.

    When `include_carrier_intake` is False, claims with NO named adjuster email are
    skipped (no_target) instead of falling back to the shared CARRIER_INTAKE_MAP —
    the approving human opts in to the shared-intake sends explicitly.

    Returns (batch, skip_counts). Each batch item is a fully-prepared send plan and
    carries `target_type` ("named_adjuster" | "carrier_intake") so the preview can
    show exactly which sends route to a shared carrier-intake address.
    """
    exclude = set(exclude_claim_ids or [])
    claims = _company_claims(sb, company_id)
    ids = [c["id"] for c in claims if c.get("id")]

    paid = _claim_event_ids(sb, ids, ["payment_received", "check_received"])
    already = _claim_event_ids(sb, ids, ["supplement_sent"])

    rep_dir = _build_rep_directory(sb, company_id)
    company_name = _company_display_name(sb, company_id, owner_user_id)

    skip = {"not_paid": 0, "already_sent": 0, "not_post_scope": 0, "no_carrier_rcv": 0,
            "no_supplement": 0, "too_few_gaps": 0, "no_doc03": 0, "no_target": 0, "excluded": 0}
    batch: list[dict] = []

    for c in claims:
        cid = c["id"]
        if cid in exclude:
            skip["excluded"] += 1
            continue
        if cid not in paid:
            skip["not_paid"] += 1
            continue
        if cid in already:
            skip["already_sent"] += 1
            continue
        if "post" not in (c.get("phase") or "").lower():
            skip["not_post_scope"] += 1
            continue
        carrier_rcv = float(c.get("current_carrier_rcv") or 0)
        if carrier_rcv <= 0:
            skip["no_carrier_rcv"] += 1
            continue
        supp = float(c.get("contractor_rcv") or 0) - carrier_rcv
        if supp <= 0:
            skip["no_supplement"] += 1
            continue
        gaps = _gap_rows(c)
        if len(gaps) < max(1, int(min_gap_items)):
            skip["too_few_gaps"] += 1
            continue
        doc03 = _output_doc_path(c, "SCOPE_COMPARISON", "03_")
        if not doc03:
            skip["no_doc03"] += 1
            continue
        adjuster = (c.get("adjuster_email") or "").strip()
        intake = carrier_intake_email(c.get("carrier")) if include_carrier_intake else None
        to_email = adjuster or intake
        if not to_email:
            skip["no_target"] += 1
            continue
        target_type = "named_adjuster" if adjuster else "carrier_intake"

        attachments = [p for p in [
            doc03,
            _output_doc_path(c, "CODE_COMPLIANCE", "06_"),
            _output_doc_path(c, "XACTIMATE", "02_"),
        ] if p]

        rep = rep_dir.get(c.get("assigned_user_id")) or rep_dir.get(c.get("user_id")) or {}
        rep_name = rep.get("name") or ""
        rep_email = rep.get("email") or ""
        send_user_id = c.get("assigned_user_id") or c.get("user_id")

        phrases = _top_coded_phrases(gaps, limit=4)
        n_missing = sum(1 for i in gaps if i.get("status") == "missing")
        n_under = len(gaps) - n_missing
        adj_name = _first_name(c.get("adjuster_name"))
        addr = _short_addr(c.get("address"))
        claim_number = c.get("claim_number") or ""

        body_html = _supplement_body_html(
            cid, adj_name=adj_name, addr=addr, claim_number=claim_number,
            phrases=phrases, n_gaps=len(gaps), n_missing=n_missing, n_under=n_under,
            rep_name=rep_name, company_name=company_name,
        )

        # CC: homeowner (if not junk) + assigned rep + company owner-as-resolved.
        # send_claim_email ALSO BCCs the company owner/admin + platform team, so
        # we only need the carrier-relevant CCs here. Carrier-intake fallback CC
        # when we routed to the adjuster directly (mirrors the script).
        cc_list: list[str] = []
        seen_cc = {to_email.lower()}
        for x in [
            c.get("homeowner_email") if not _junk_email(c.get("homeowner_email")) else None,
            rep_email or None,
        ]:
            if x and x.lower() not in seen_cc:
                cc_list.append(x)
                seen_cc.add(x.lower())
        if adjuster and intake and intake.lower() not in seen_cc:
            cc_list.append(intake)

        # Subject = bare claim number (carrier routing). Fall back to a descriptive
        # subject only when no claim number is on file (cadence is then skipped by
        # the side-effect recorder's guard).
        subject = _valid_claim_number(claim_number) or (f"Supplement — {addr}" if addr else "Supplement")

        batch.append({
            "claim_id": cid,
            "send_user_id": send_user_id,
            "to_email": to_email,
            "target_type": target_type,
            "cc": ", ".join(cc_list) if cc_list else None,
            "subject": subject,
            "body_html": body_html,
            "attachment_paths": attachments,
            "email_type": "supplement",
            # display-only metadata for the preview card
            "address": c.get("address"),
            "claim_number": claim_number,
            "carrier": c.get("carrier"),
            "adjuster": c.get("adjuster_name") or adj_name,
            "supplement_value": round(supp, 2),
            "n_gaps": len(gaps),
            "top_gaps": phrases,
            "attachment_filenames": [a.rsplit("/", 1)[-1] for a in attachments],
            "rep_name": rep_name or None,
        })

    batch.sort(key=lambda b: -float(b.get("supplement_value") or 0))
    if max_claims:
        batch = batch[: int(max_claims)]
    return batch, skip


def _supplement_body_html(
    claim_id: str, *, adj_name: str, addr: str, claim_number: str,
    phrases: list[str], n_gaps: int, n_missing: int, n_under: int,
    rep_name: str, company_name: str,
) -> str:
    """4 rotating HUMAN supplement variants, hash-seeded per claim. NO dollar
    figure in the body (softened — totals live in the attachments). Contractor
    mode: factual + warm, no public-adjuster advocacy. Faithful to the proven
    supplement_batch variants but company-name driven."""
    greeting = f"Hi {adj_name}," if adj_name and adj_name != "there" else "Hi there,"
    glist = "; ".join(phrases) if phrases else "several code-required items"
    claim_ref = f" (claim {claim_number})" if claim_number else ""
    who = (rep_name or "").strip() or company_name
    sign = f"{who}<br/>{company_name}" if (rep_name or "").strip() else company_name

    variants = [
        (
            f"{greeting}<br><br>I went back through your scope on {addr}{claim_ref} against the work the "
            f"property actually needs, and there's a meaningful gap — {n_gaps} items either missing or "
            f"underpaid. The notable ones: {glist}. A lot of it is storm-damaged exterior the original scope "
            f"didn't pick up.<br><br>I've attached the full line-by-line comparison and our code-compliance "
            f"report — it details every item, with quantities and the totals, tied to the measurements and "
            f"code. Could you take a look and revise the scope? Happy to hop on a call.<br><br>Thanks,<br>{sign}"
        ),
        (
            f"{greeting}<br><br>Following up on {addr}{claim_ref} — comparing your estimate to the actual scope "
            f"of repair, we're showing {n_missing} items missing and {n_under} underpaid. The notable ones: "
            f"{glist}.<br><br>It's all documented in the attached scope comparison + code report, line by line "
            f"with the totals and code citations. Wanted to get it to you so we can get the homeowner made "
            f"whole. Let me know what you need from us.<br><br>Appreciate it,<br>{sign}"
        ),
        (
            f"{greeting}<br><br>On {addr}{claim_ref}: after our inspection the scope is coming up short across "
            f"{n_gaps} items — {glist} among them. Most of it is storm-damaged exterior the carrier estimate "
            f"didn't include.<br><br>Attached is the itemized comparison and the code-compliance backup so it's "
            f"all transparent — quantities and totals are in there. Can we get the scope updated to cover it? "
            f"Glad to walk through anything.<br><br>Thank you,<br>{sign}"
        ),
        (
            f"{greeting}<br><br>Quick one on {addr}{claim_ref}. Our scope and yours differ on {n_gaps} line items "
            f"that are missing or short, including {glist}. These are damage- and code-driven, not "
            f"upgrades.<br><br>The attached scope comparison lays out each one against the measurement + code, "
            f"with the totals; the code report backs the required items. Could you review and revise? Thanks "
            f"for working this with us.<br><br>{sign}"
        ),
        (
            f"{greeting}<br><br>Wanted to get a supplement to you on {addr}{claim_ref}. Once the crew was up "
            f"there, {n_gaps} items turned up that the original scope didn't cover — {glist} among them. These "
            f"are storm- and code-driven, not upgrades.<br><br>The attached comparison and code report lay out "
            f"each one with quantities and totals. Could you take a look and get the scope revised? Glad to hop "
            f"on a call.<br><br>Thanks,<br>{sign}"
        ),
        (
            f"{greeting}<br><br>On {addr}{claim_ref}: comparing our scope to yours, we're short {n_gaps} line "
            f"items the repair actually needs, including {glist}. Most of it is exterior storm damage the first "
            f"estimate didn't pick up.<br><br>It's all in the attached scope comparison and code-compliance "
            f"report — line by line, tied to the measurements. Let me know what you need to get it added.<br><br>"
            f"Appreciate it,<br>{sign}"
        ),
        (
            f"{greeting}<br><br>Quick note on {addr}{claim_ref}. We're showing {n_missing} items missing and "
            f"{n_under} underpaid versus the actual scope of repair — {glist} are the notable ones. Nothing out "
            f"of the ordinary, just making the scope match the work.<br><br>Attached is the full comparison plus "
            f"the code backup with all the totals. Could you review and revise when you get a chance? Happy to "
            f"walk through it.<br><br>Thank you,<br>{sign}"
        ),
        (
            f"{greeting}<br><br>Following up on {addr}{claim_ref}. After we walked the roof, the scope is coming "
            f"up short on {n_gaps} items — {glist} included. I've attached the line-by-line comparison and our "
            f"code report so it's all transparent, quantities and totals in there.<br><br>Wanted to get this to "
            f"you so we can keep the homeowner moving. Let me know what you need from us.<br><br>Thanks again,<br>"
            f"{sign}"
        ),
    ]
    return "<p>" + variants[_variant_index(claim_id, len(variants), salt="supplement")] + "</p>"


# ═══════════════════════════════════════════════════════════════════════
# Eligibility — forensic campaign
# ═══════════════════════════════════════════════════════════════════════

def build_forensic_batch(
    sb: Client,
    company_id: str,
    owner_user_id: str,
    *,
    max_claims: Optional[int] = None,
    exclude_claim_ids: Optional[list[str]] = None,
    include_carrier_intake: bool = True,
) -> tuple[list[dict], dict]:
    """Resolve all eligible forensic-campaign claims for `company_id`.

    Eligibility (faithful to forensic_batch.py, company-scoped):
      forensic causation PDF present in output_files AND NOT already
      forensic_sent_to_carrier AND an adjuster OR carrier-intake target AND not a
      duplicate property (dedup by normalized address) AND not explicitly excluded.

    When `include_carrier_intake` is False, claims with NO named adjuster email are
    skipped (no_target) rather than routed to the shared CARRIER_INTAKE_MAP. Each
    batch item carries `target_type` ("named_adjuster" | "carrier_intake").

    Returns (batch, skip_counts).
    """
    exclude = set(exclude_claim_ids or [])
    claims = _company_claims(sb, company_id)
    ids = [c["id"] for c in claims if c.get("id")]

    already = _claim_event_ids(sb, ids, ["forensic_sent_to_carrier"])
    rep_dir = _build_rep_directory(sb, company_id)
    company_name = _company_display_name(sb, company_id, owner_user_id)

    skip = {"already_sent": 0, "no_forensic": 0, "no_target": 0, "dup_property": 0, "excluded": 0}
    batch: list[dict] = []
    seen_addr: set[str] = set()

    for c in claims:
        cid = c["id"]
        if cid in exclude:
            skip["excluded"] += 1
            continue
        forensic = _output_doc_path(c, "FORENSIC")
        if not forensic:
            skip["no_forensic"] += 1
            continue
        if cid in already:
            skip["already_sent"] += 1
            continue
        adjuster = (c.get("adjuster_email") or "").strip()
        intake = carrier_intake_email(c.get("carrier")) if include_carrier_intake else None
        to_email = adjuster or intake
        if not to_email:
            skip["no_target"] += 1
            continue
        target_type = "named_adjuster" if adjuster else "carrier_intake"
        na = _norm_addr(c.get("address"))
        if na and na in seen_addr:
            skip["dup_property"] += 1
            continue
        if na:
            seen_addr.add(na)

        rep = rep_dir.get(c.get("assigned_user_id")) or rep_dir.get(c.get("user_id")) or {}
        rep_name = rep.get("name") or ""
        rep_email = rep.get("email") or ""
        send_user_id = c.get("assigned_user_id") or c.get("user_id")

        adj_name = _first_name(c.get("adjuster_name"))
        carrier = (c.get("carrier") or "").strip()
        claim_number = c.get("claim_number") or ""
        ho_name = c.get("homeowner_name")
        ho_email = c.get("homeowner_email")
        ho_ok = not _junk_email(ho_email)
        ho_line = (
            f" I've copied {_first_name(ho_name, 'the homeowner')} so they're in the loop."
            if ho_ok else ""
        )

        body_html = _forensic_body_html(
            cid, adj_name=adj_name, address=c.get("address"), claim_number=claim_number,
            carrier=carrier, ho_line=ho_line, rep_name=rep_name, company_name=company_name,
        )

        cc_list: list[str] = []
        seen_cc = {to_email.lower()}
        for x in [ho_email if ho_ok else None, rep_email or None]:
            if x and x.lower() not in seen_cc:
                cc_list.append(x)
                seen_cc.add(x.lower())
        if adjuster and intake and intake.lower() not in seen_cc:
            cc_list.append(intake)

        # Subject = bare claim number (carrier routing) when valid, else descriptive.
        subject = _valid_claim_number(claim_number) or _forensic_subject_fallback(cid, c.get("address"))

        batch.append({
            "claim_id": cid,
            "send_user_id": send_user_id,
            "to_email": to_email,
            "target_type": target_type,
            "cc": ", ".join(cc_list) if cc_list else None,
            "subject": subject,
            "body_html": body_html,
            "attachment_paths": [forensic],
            "email_type": "custom",  # forensic send -> carrier_email_sent + forensic_* via side-effects
            # display-only metadata
            "address": c.get("address"),
            "claim_number": claim_number,
            "carrier": carrier,
            "adjuster": c.get("adjuster_name") or adj_name,
            "attachment_filenames": [forensic.rsplit("/", 1)[-1]],
            "rep_name": rep_name or None,
            "cc_homeowner": ho_ok,
        })

    if max_claims:
        batch = batch[: int(max_claims)]
    return batch, skip


def _forensic_subject_fallback(claim_id: str, address: Optional[str]) -> str:
    sa = _short_addr(address)
    if not sa:
        # No claim number AND no address — emit a clean, address-less subject
        # rather than a dangling "Forensic Causation Report — ".
        return "Forensic Causation Report — roof inspection findings"
    opts = [
        f"Forensic Causation Report — {sa}",
        f"{sa} — causation report",
        f"Roof inspection / causation report — {sa}",
        f"{sa} — our inspection findings",
    ]
    return opts[_variant_index(claim_id, len(opts), salt="forensic_subj")]


def _forensic_body_html(
    claim_id: str, *, adj_name: str, address: Optional[str], claim_number: str,
    carrier: str, ho_line: str, rep_name: str, company_name: str,
) -> str:
    """6 rotating HUMAN forensic variants, hash-seeded per claim. Contractor mode:
    factual + warm, no advocacy. Company-name driven. Faithful to forensic_batch.V."""
    greeting = f"Hi {adj_name}," if adj_name and adj_name != "there" else "Hi there,"
    addr = address or "the property"
    cl = f" (claim {claim_number})" if claim_number else ""
    clc = f" ({claim_number}, {carrier})" if claim_number and carrier else (f" ({claim_number})" if claim_number else "")
    who = (rep_name or "").strip() or company_name
    sign = f"{who}<br/>{company_name}" if (rep_name or "").strip() else company_name

    variants = [
        (
            f"{greeting}<br><br>We just wrapped our inspection at {addr} and I put together a causation report "
            f"for the {carrier or 'roof'} claim{cl}. It's attached — walks through the storm damage we found "
            f"with dated photos and where the water's getting in. Wanted you to have it before the estimate's "
            f"finalized.{ho_line}<br><br>Give me a shout if anything needs clarifying — thanks for working this "
            f"one with us.<br><br>{sign}"
        ),
        (
            f"{greeting}<br><br>Attaching our forensic report for {addr}{cl}. We went over the roof in detail — "
            f"the photos show the storm-related damage and the cause behind it. Figured it'd help as you put "
            f"the estimate together.{ho_line}<br><br>Let me know if you want to talk through any of it. "
            f"Appreciate it.<br><br>{sign}"
        ),
        (
            f"{greeting}<br><br>Following our inspection at {addr}, here's the causation report for the claim"
            f"{cl}. It documents what we found up top, with dated photos throughout.{ho_line} Happy to walk you "
            f"through anything.<br><br>Thanks,<br>{sign}"
        ),
        (
            f"{greeting}<br><br>Hope you're doing well. We finished up at {addr} and I've attached our causation "
            f"report{clc}. It lays out the storm damage with photos so we're on the same page before the "
            f"estimate goes through.{ho_line}<br><br>Reach out anytime.<br><br>Best,<br>{sign}"
        ),
        (
            f"{greeting}<br><br>Quick one — attached is our forensic/causation report for {addr}{clc}. The "
            f"findings and photos from our roof inspection are all in there; wanted to get it over to you "
            f"early.{ho_line}<br><br>Call or email if anything comes up. Thanks,<br>{sign}"
        ),
        (
            f"{greeting}<br><br>Sending over the causation report for {addr}{cl}. We documented the storm damage "
            f"and its source with dated photos during our inspection — should be useful for the file.{ho_line}"
            f"<br><br>Glad to clarify anything. Thank you,<br>{sign}"
        ),
        (
            f"{greeting}<br><br>We were out at {addr} this week and put together a causation report for the claim"
            f"{cl}. It's attached — dated photos of the storm damage and where it's coming from, so it's all "
            f"documented before the estimate's set.{ho_line}<br><br>Happy to talk through any of it.<br><br>"
            f"Thanks,<br>{sign}"
        ),
        (
            f"{greeting}<br><br>Attached is our causation report for {addr}{clc}. We went over the roof and the "
            f"photos lay out the storm damage and its cause. Wanted to get it to you early so we're working from "
            f"the same findings.{ho_line}<br><br>Let me know if anything needs clarifying.<br><br>Appreciate it,"
            f"<br>{sign}"
        ),
        (
            f"{greeting}<br><br>Following our inspection at {addr}, I've attached the causation report{cl}. It "
            f"documents what we found up top with dated photos throughout, so the cause is clear for the "
            f"file.{ho_line}<br><br>Glad to walk you through it whenever works.<br><br>Thank you,<br>{sign}"
        ),
        (
            f"{greeting}<br><br>Quick one — here's our forensic causation report for {addr}{cl}. The storm damage "
            f"and its source are documented with photos from our roof inspection. Figured it'd help as the "
            f"estimate comes together.{ho_line}<br><br>Reach out anytime with questions.<br><br>Thanks again,<br>"
            f"{sign}"
        ),
    ]
    return "<p>" + variants[_variant_index(claim_id, len(variants), salt="forensic")] + "</p>"
