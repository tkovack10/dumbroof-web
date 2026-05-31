"""
email_voice.py — Human voice + anti-AI-tell linter for carrier-facing email.
=============================================================================
Single source of truth for the copy that adjusters read. Holds:

  • variant_index()  — one deterministic, stable-per-claim variant picker
  • greeting / sign_off / adjuster_first_name — shared human helpers
  • the EXPANDED carrier-email body pools (supplement / completion / AOB / COC)
  • the AI-tell linter (scan_for_tells / scrub_tells)

Why this module exists: the same email type used to be composed in 4 different
places (claim_brain_tools single-send, bulk_campaigns blast, main.py cadence)
with 4 different pickers and divergent copy. An adjuster who receives several
of our emails should never feel a machine wrote them — so all paths now draw
their voice from here, and every carrier body is run through the tell-linter
before it reaches a human's preview.

This is a LEAF module: it imports nothing from claim_brain_tools / main /
bulk_campaigns / claim_brain_email (those import FROM here). Keep it that way to
avoid import cycles.
"""

from __future__ import annotations

import hashlib
import re
from typing import Optional


# ════════════════════════════════════════════════════════════════════════
# Deterministic variant picker
# ════════════════════════════════════════════════════════════════════════

def variant_index(*seed_parts: object, n: int, salt: str = "") -> int:
    """Pick a variant 0..n-1 deterministically from the seed parts (+ salt).

    Stable across runs for the same claim, varied across claims. The salt lets
    two different email kinds on the same claim land on different indexes, and
    callers pass the company id alongside the claim id so two claims from the
    same contractor are less likely to collide on a single adjuster's desk.
    """
    if n <= 1:
        return 0
    seed = "|".join(str(p) for p in seed_parts if p not in (None, "")) + f"|{salt}"
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return int(digest, 16) % n


def _claim_seed(claim_data: dict) -> tuple:
    """Canonical (claim_id, company_id) seed tuple from a claim dict."""
    cid = claim_data.get("id") or claim_data.get("claim_id") or ""
    company = claim_data.get("company_id") or ""
    return (cid, company)


# ════════════════════════════════════════════════════════════════════════
# Shared human helpers (greeting / sign-off / adjuster name)
# ════════════════════════════════════════════════════════════════════════

_HONORIFICS = {"mr", "mrs", "ms", "dr", "miss"}


def adjuster_first_name(claim_data: dict, fallback: str = "there") -> str:
    """Best-effort adjuster first name for a friendly greeting.

    Reads claim_data.adjuster_name (then previous_carrier_data.adjuster_name),
    strips honorifics, takes the first real token, title-cases it. Falls back
    to `fallback` ("there" for "Hi there,") when no name is on file.
    """
    name = (claim_data.get("adjuster_name") or "").strip()
    if not name:
        prev = claim_data.get("previous_carrier_data") or {}
        if isinstance(prev, dict):
            name = (prev.get("adjuster_name") or "").strip()
    if not name:
        return fallback
    parts = [p for p in name.replace(",", " ").split() if p]
    for p in parts:
        if p.lower().strip(".") in _HONORIFICS:
            continue
        return p[:1].upper() + p[1:]
    return fallback


def greeting(first_name: str) -> str:
    """Natural opening line. 'Hi there,' when we don't have a name."""
    if first_name in ("there", "Claims Team", ""):
        return "Hi there,"
    return f"Hi {first_name},"


# A few more than before so the closer rotates too. All warm + plain — nothing
# stiff ("Sincerely,", "Regards,", "Respectfully,") which reads corporate/AI.
_SIGN_OFFS = ["Thanks,", "Thank you,", "Appreciate it,", "Best,", "Talk soon,", "Thanks again,"]


def sign_off(rep_name: Optional[str], company_name: str, claim_data: dict, salt: str) -> str:
    """Rotating, human sign-off. Uses the rep's name when we have one, else the
    company name. Output matches the legacy _sign_off HTML exactly."""
    who = (rep_name or "").strip() or company_name
    line2 = f"{who}<br/>{company_name}" if (rep_name or "").strip() else company_name
    idx = variant_index(*_claim_seed(claim_data), n=len(_SIGN_OFFS), salt=f"signoff|{salt}")
    return f"<p>{_SIGN_OFFS[idx]}<br/>{line2}</p>"


# ════════════════════════════════════════════════════════════════════════
# Carrier-email body pools  (the copy an adjuster actually reads)
# ════════════════════════════════════════════════════════════════════════
#
# Each pool is a list of (greeting, prop_ref, docs_phrase, rcv_txt) -> str
# builder lambdas. Keeping them as small closures lets every variant decide its
# own structure (one paragraph vs two, with/without the dollar figure, list or
# no list) instead of just swapping a first sentence. "Many different versions"
# means structurally different, not a thesaurus pass on sentence one.


def supplement_body(
    claim_data: dict,
    company_profile: dict,
    *,
    items: Optional[list[dict]] = None,
    contractor_rcv: Optional[float] = None,
    coc_attached: bool = False,
    additional_notes: str = "",
    completion: bool = False,
) -> str:
    """Build a human, varied carrier-facing supplement / completion email body.

    completion=False → "the estimate missed some items, here's the supplement".
    completion=True  → a post-install completion + final-supplement note.
    Driven entirely by the passed-in claim / company variables — no hardcoded
    company. Mirrors the legacy _supplement_email_body, with bigger pools.
    """
    address = claim_data.get("address") or "the property"
    homeowner = (claim_data.get("homeowner_name") or "").strip()
    company_name = company_profile.get("company_name") or "our office"
    rep_name = (company_profile.get("contact_name") or "").strip() or None
    g = greeting(adjuster_first_name(claim_data))

    prop_ref = f"<strong>{address}</strong>"
    if homeowner:
        prop_ref += f" ({homeowner})"

    docs_phrase = (
        "I've attached the supplement along with the supporting documentation"
        if not coc_attached
        else "I've attached the signed completion certificate along with the supplement"
    )

    if completion:
        rcv_txt = f"${contractor_rcv:,.2f}" if contractor_rcv else "the completed scope"
        openers = [
            (f"<p>{g}</p>"
             f"<p>Wrapping up on {prop_ref} — the crew finished the storm-damage work and everything's "
             f"buttoned up. {docs_phrase} for your file. The completed replacement cost came to "
             f"<strong>{rcv_txt}</strong>.</p>"
             f"<p>Whenever you've had a chance to review, we'd appreciate getting the final payment moving. "
             f"Glad to send anything else you need.</p>"),
            (f"<p>{g}</p>"
             f"<p>Quick update on {prop_ref}: the restoration is done and the job passed our final walk. "
             f"{docs_phrase} so you have the full record. Total replacement cost for the completed work is "
             f"<strong>{rcv_txt}</strong>.</p>"
             f"<p>Let me know if anything looks off — otherwise we're all set on our end and would appreciate "
             f"the file moving to final payment.</p>"),
            (f"<p>{g}</p>"
             f"<p>Just letting you know we've completed the work at {prop_ref}. The crew is off the site and "
             f"the homeowner's squared away. {docs_phrase} for your records — the completed replacement cost "
             f"is <strong>{rcv_txt}</strong>.</p>"
             f"<p>Happy to walk through any of it. Whenever you can close this out on final payment, that'd be "
             f"great.</p>"),
            (f"<p>{g}</p>"
             f"<p>Good news on {prop_ref} — all the storm-damage work is finished and signed off. {docs_phrase}, "
             f"and the completed replacement cost landed at <strong>{rcv_txt}</strong>.</p>"
             f"<p>If you need photos, invoices, or anything else to wrap the file, just say the word. Otherwise "
             f"we'd appreciate getting final payment scheduled.</p>"),
            (f"<p>{g}</p>"
             f"<p>We finished up at {prop_ref} this week — the work's complete and the homeowner's happy. "
             f"{docs_phrase} so everything's in one place. Completed replacement cost is "
             f"<strong>{rcv_txt}</strong>.</p>"
             f"<p>Take a look when you get a minute and let me know if you need more. We'd appreciate the final "
             f"payment moving along.</p>"),
            # ── added variants ──
            (f"<p>{g}</p>"
             f"<p>The roof at {prop_ref} is done. Crew's cleaned up, magnet-swept the yard, and the homeowner "
             f"signed off. {docs_phrase} so the file's complete on our side. Completed replacement cost is "
             f"<strong>{rcv_txt}</strong>.</p>"
             f"<p>Let me know if you need anything before final payment goes out.</p>"),
            (f"<p>{g}</p>"
             f"<p>Closing this one out — work at {prop_ref} wrapped up and held up to our final inspection. "
             f"{docs_phrase}, total completed cost <strong>{rcv_txt}</strong>. Everything was done to the "
             f"approved scope.</p>"
             f"<p>Reach out if anything's missing on your end; otherwise we'd appreciate the final payment.</p>"),
            (f"<p>{g}</p>"
             f"<p>Wanted to confirm the work at {prop_ref} is complete and the site's clean. {docs_phrase} for "
             f"your file — the completed replacement cost worked out to <strong>{rcv_txt}</strong>.</p>"
             f"<p>Glad to send over photos or the final invoice if that helps you close it out.</p>"),
        ]
        idx = variant_index(*_claim_seed(claim_data), n=len(openers), salt="completion")
        body = openers[idx]
    else:
        openers = [
            (f"<p>{g}</p>"
             f"<p>We finished going back through the scope on {prop_ref} and there are a few items the original "
             f"estimate didn't pick up. {docs_phrase} so you can see exactly what we found and why it belongs in "
             f"the repair.</p>"
             f"<p>Happy to walk through any line on it — just let me know what works.</p>"),
            (f"<p>{g}</p>"
             f"<p>Following up on {prop_ref}. When we got into the detailed scope, a handful of items came up "
             f"that weren't in the current estimate. {docs_phrase}, with photos and notes on each one.</p>"
             f"<p>Take a look when you can and tell me if anything needs more backup — glad to send it.</p>"),
            (f"<p>{g}</p>"
             f"<p>I wanted to get this over to you on {prop_ref}. After reviewing the full scope against what's "
             f"on site, we put together a short supplement for the pieces that were missed. {docs_phrase}.</p>"
             f"<p>Let me know if you'd like to go through it together, or if you need anything else from me.</p>"),
            (f"<p>{g}</p>"
             f"<p>Quick note on {prop_ref}: comparing the estimate to the actual conditions, we found a few line "
             f"items that should be added. Nothing dramatic — just making sure the scope matches the work. "
             f"{docs_phrase} for your review.</p>"
             f"<p>Reach out with any questions and I'll get you whatever you need.</p>"),
            (f"<p>{g}</p>"
             f"<p>Thanks for your help on {prop_ref}. We've put together a supplement covering the items that "
             f"came up once we walked the full scope. {docs_phrase} — photos and notes are in there for each "
             f"one.</p>"
             f"<p>I'm around if you want to talk through any of it.</p>"),
            (f"<p>{g}</p>"
             f"<p>Circling back on {prop_ref}. A few things weren't captured in the original estimate, so we "
             f"documented them and pulled them into a supplement. {docs_phrase} so it's all in one place.</p>"
             f"<p>Let me know if anything needs clarifying — happy to send more detail.</p>"),
            # ── added variants ──
            (f"<p>{g}</p>"
             f"<p>Got a supplement for you on {prop_ref}. Once the crew was up there, a few storm-damaged items "
             f"turned up that the original scope didn't account for. {docs_phrase} so you can see each one with "
             f"the backup.</p>"
             f"<p>Glad to jump on a quick call if that's easier than reading through it.</p>"),
            (f"<p>{g}</p>"
             f"<p>Wanted to flag a few items on {prop_ref} before the estimate's finalized. They came up when we "
             f"compared the scope line-by-line against the measurements, and they're damage- and code-driven, not "
             f"upgrades. {docs_phrase}.</p>"
             f"<p>Let me know what you need from me to get them added.</p>"),
            (f"<p>{g}</p>"
             f"<p>On {prop_ref}: we put together a supplement for the pieces the first scope missed. {docs_phrase} "
             f"with the measurements and code references behind each line.</p>"
             f"<p>Take a look when you get a minute — I'm happy to clarify anything.</p>"),
            (f"<p>{g}</p>"
             f"<p>Sending over a supplement for {prop_ref}. Nothing out of the ordinary — just a few items the "
             f"original estimate didn't include that the repair actually needs. {docs_phrase}.</p>"
             f"<p>Reach out if you'd like the detail on any of them.</p>"),
        ]
        idx = variant_index(*_claim_seed(claim_data), n=len(openers), salt="supplement")
        body = openers[idx]

    # Itemized supplement scope (install-supplement / discovered items), if any.
    if items:
        rows = "".join(
            f"<li>{(it.get('description') or '').strip()}"
            + (f" — ${it.get('amount'):,.2f}" if it.get("amount") else "")
            + "</li>"
            for it in items
            if (it.get("description") or "").strip()
        )
        if rows:
            body += f"<p>Items in this supplement:</p><ul>{rows}</ul>"

    if additional_notes.strip():
        body += f"<p>{additional_notes.strip()}</p>"

    body += sign_off(rep_name, company_name, claim_data, salt="completion" if completion else "supplement")
    return body


def aob_carrier_body(claim_data: dict, company_profile: dict) -> str:
    """Human, varied AOB-submission note to the carrier. Factual, contractor-
    neutral — homeowner authorized us, please add us to the file."""
    company_name = company_profile.get("company_name", "Your Roofing Company")
    rep_name = (company_profile.get("contact_name") or "").strip() or None
    address = claim_data.get("address", "the property")
    g = greeting(adjuster_first_name(claim_data))
    prop = f"<strong>{address}</strong>"

    variants = [
        (f"<p>{g}</p>"
         f"<p>The homeowner at {prop} has asked us to handle the roof repairs and signed an Assignment of "
         f"Benefits — it's attached. Could you add {company_name} to the file as an authorized contact so we "
         f"can coordinate on this one? Thanks for your help.</p>"),
        (f"<p>{g}</p>"
         f"<p>Quick heads-up on {prop}: the homeowner has retained {company_name} for the storm-damage work and "
         f"signed the attached Assignment of Benefits. Whenever you get a chance, please update your records to "
         f"include us as a point of contact.</p>"),
        (f"<p>{g}</p>"
         f"<p>We're working with the homeowner at {prop} on their roof. The signed Assignment of Benefits is "
         f"attached — if you could add {company_name} to the claim file so we're looped in going forward, that'd "
         f"be great. Happy to provide anything else you need.</p>"),
        # ── added variants ──
        (f"<p>{g}</p>"
         f"<p>The homeowner at {prop} signed us on for the roof repairs — Assignment of Benefits attached. Mind "
         f"adding {company_name} to the file as a contact so we can keep this moving for them? Appreciate it.</p>"),
        (f"<p>{g}</p>"
         f"<p>Just letting you know {company_name} is now working with the homeowner at {prop} on the storm "
         f"damage. Their signed AOB is attached. Please loop us into the file when you can — glad to send "
         f"whatever else helps.</p>"),
        (f"<p>{g}</p>"
         f"<p>Attaching the signed Assignment of Benefits for {prop} — the homeowner has us handling the repairs. "
         f"Could you add {company_name} as an authorized contact on the claim? Thanks for getting us set up.</p>"),
    ]
    idx = variant_index(*_claim_seed(claim_data), n=len(variants), salt="aob")
    return variants[idx] + sign_off(rep_name, company_name, claim_data, salt="aob")


def coc_body(claim_data: dict, company_profile: dict, *, coc_attached: bool = True) -> str:
    """Human, varied completion-certificate note to the carrier."""
    company_name = company_profile.get("company_name", "Your Roofing Company")
    rep_name = (company_profile.get("contact_name") or "").strip() or None
    address = claim_data.get("address", "the property")
    g = greeting(adjuster_first_name(claim_data))
    prop = f"<strong>{address}</strong>"

    variants = [
        (f"<p>{g}</p>"
         f"<p>The storm-damage work at {prop} is complete. I've attached the completion certificate — everything "
         f"was done to the approved scope and to code. Whenever you've had a look, we'd appreciate getting final "
         f"payment moving.</p>"),
        (f"<p>{g}</p>"
         f"<p>Closing the loop on {prop}: the job's finished and signed off, and the completion certificate is "
         f"attached for your file. Let me know if you need anything else before final payment.</p>"),
        (f"<p>{g}</p>"
         f"<p>Good to report the work at {prop} is wrapped up and passed our final walk. The completion "
         f"certificate is attached. Glad to send photos or invoices if that helps close the file — otherwise "
         f"we'd appreciate the final payment scheduled.</p>"),
        # ── added variants ──
        (f"<p>{g}</p>"
         f"<p>Job's done at {prop}. Completion certificate is attached — work matched the approved scope and the "
         f"site's clean. Whenever you can, we'd appreciate the final payment moving.</p>"),
        (f"<p>{g}</p>"
         f"<p>Wanted to confirm the roof at {prop} is finished and signed off by the homeowner. The completion "
         f"certificate is attached for your records. Let me know if anything else is needed to wrap it up.</p>"),
        (f"<p>{g}</p>"
         f"<p>We've completed the work at {prop} and attached the completion certificate. Everything's done to "
         f"code and to the approved scope. Happy to send the final invoice or photos — otherwise we'd appreciate "
         f"getting final payment scheduled.</p>"),
    ]
    idx = variant_index(*_claim_seed(claim_data), n=len(variants), salt="coc")
    return variants[idx] + sign_off(rep_name, company_name, claim_data, salt="coc")


# ════════════════════════════════════════════════════════════════════════
# AI-tell linter  (scan + scrub)
# ════════════════════════════════════════════════════════════════════════
#
# Two tiers:
#   SCRUB  — high-confidence boilerplate we safely rewrite/remove. These are
#            phrases no busy contractor types but every LLM reaches for.
#   FLAG   — softer giveaways we surface to the human reviewer but never
#            auto-mutate (too risky to rewrite blindly).
#
# Calibration rule: every variant in the pools above MUST pass scrub_tells
# clean (no scrub change, no flag). test_email_voice.py enforces that — so if
# you add copy here, keep it free of these patterns.

# (pattern, replacement) — replacement applied; "" deletes the match.
_SCRUB_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\bI hope this (?:e-?mail|message|note|letter) finds you well[.,]?\s*", re.I), ""),
    (re.compile(r"\bI hope (?:this|all) (?:finds you|is) well[.,]?\s*", re.I), ""),
    (re.compile(r"\bTrust(?:ing)? this (?:e-?mail|message|note) finds you well[.,]?\s*", re.I), ""),
    (re.compile(r"\bPlease (?:do not|don'?t) hesitate to (?:contact|reach out to|call)\s+(?:us|me)[^.<]*\.",
                re.I), "Let me know if you need anything."),
    (re.compile(r"\bShould you have any (?:further )?questions[^.<]*\.", re.I),
                "Let me know if you have any questions."),
    (re.compile(r"\bI wanted to reach out\b", re.I), "I wanted to follow up"),
    (re.compile(r"\bWe are writing (?:to you )?(?:regarding|in regard to|in reference to)\b", re.I),
                "I'm writing about"),
]

# (pattern, human-readable label) — surfaced, not mutated.
_FLAG_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"(?:^|[>.\s])(Furthermore|Moreover|Additionally|In conclusion|Firstly|Secondly|Thirdly)\b"),
     'formal connective ("Furthermore"/"Moreover"/…)'),
    (re.compile(r"\brest assured\b", re.I), '"rest assured"'),
    (re.compile(r"\bit is (?:important|worth) (?:to note|noting)\b", re.I), '"it is important to note"'),
    (re.compile(r"\b(?:delve|delving) into\b", re.I), '"delve into"'),
    (re.compile(r"\bnavigat(?:e|ing) the (?:claims? )?process\b", re.I), '"navigate the process"'),
    (re.compile(r"\b(?:leverage|utilize|seamless|robust|holistic|myriad|plethora)\b", re.I),
     'AI-flavored word (leverage/utilize/seamless/robust/…)'),
    (re.compile(r"\bin today'?s (?:fast-paced|ever-?(?:changing|evolving)|modern)\b", re.I),
     '"in today\'s fast-paced…"'),
    (re.compile(r"\bas an AI\b|\bI'?m (?:just )?an AI\b|language model", re.I), "AI self-reference"),
    (re.compile(r"\bDear\s+[A-Z][\w&'.\- ]*?(?:Department|Team|Adjuster|Sir or Madam|Claims)\b"),
     'formal salutation ("Dear … Department") — use "Hi {first}," instead'),
]

# Em-dash overuse is a real tell, but a single spaced em-dash reads human, so we
# only flag genuine density.
_EMDASH_FLAG_THRESHOLD = 5


def scan_for_tells(text: str) -> list[dict]:
    """Read-only: return a list of {kind, label} for every AI tell found.

    kind is 'scrub' (would be auto-fixed) or 'flag' (surfaced for review).
    Does not mutate the text.
    """
    if not text:
        return []
    found: list[dict] = []
    for pat, repl in _SCRUB_RULES:
        if pat.search(text):
            found.append({"kind": "scrub", "label": pat.pattern})
    for pat, label in _FLAG_RULES:
        if pat.search(text):
            found.append({"kind": "flag", "label": label})
    if text.count("—") >= _EMDASH_FLAG_THRESHOLD:
        found.append({"kind": "flag", "label": f"{text.count('—')} em-dashes (overuse)"})
    return found


def scrub_tells(html: str) -> tuple[str, list[str]]:
    """Apply the high-confidence SCRUB rewrites and return (clean_html, removed).

    `removed` is a human-readable list of what was changed plus any FLAG-tier
    tells still present (so the preview card can show the reviewer "we cleaned
    X; heads-up on Y"). Never raises — on any error returns the input unchanged.
    """
    if not html:
        return html, []
    try:
        out = html
        removed: list[str] = []
        for pat, repl in _SCRUB_RULES:
            new = pat.sub(repl, out)
            if new != out:
                removed.append(f"removed boilerplate: /{pat.pattern[:48]}/")
                out = new
        # Collapse any double spaces / orphaned "<p> </p>" left by deletions.
        out = re.sub(r"<p>\s*</p>", "", out)
        out = re.sub(r"[ \t]{2,}", " ", out)
        # Surface (don't mutate) the soft flags that remain.
        for pat, label in _FLAG_RULES:
            if pat.search(out):
                removed.append(f"flag: {label}")
        if out.count("—") >= _EMDASH_FLAG_THRESHOLD:
            removed.append(f"flag: {out.count('—')} em-dashes (overuse)")
        return out, removed
    except Exception as e:  # never break a send over the linter
        print(f"[email_voice] scrub_tells failed (returning input unchanged): {e}", flush=True)
        return html, []


# Carrier-facing email types that should be run through scrub_tells before send.
# Homeowner-facing types (invoice, aob_signature) are intentionally excluded —
# scope is adjuster-facing mail.
CARRIER_EMAIL_TYPES = frozenset({
    "supplement", "completion", "coc", "aob", "forensic",
    "send_to_carrier", "cadence_followup", "custom", "install_supplement",
})
