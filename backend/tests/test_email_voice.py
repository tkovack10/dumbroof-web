#!/usr/bin/env python3
"""email_voice — human voice + AI-tell linter guardrails.

Locks the contract that keeps carrier-facing email from reading as AI-written:

  1. The deterministic picker is stable per claim and actually spreads across
     the whole pool (so we genuinely use "many different versions").
  2. EVERY variant in EVERY shipped pool — supplement / completion / AOB / COC
     (email_voice) and the bulk supplement / forensic pools (bulk_campaigns) —
     passes the linter clean. If you add copy that trips a tell, this fails.
  3. The linter scrubs the high-confidence boilerplate and flags the rest, and
     leaves genuine human copy untouched.

Runs with pytest if available, else as a plain script:
    python3 backend/tests/test_email_voice.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import email_voice as ev  # noqa: E402

_CLAIM = {
    "id": "claim-123",
    "company_id": "co-1",
    "address": "12 Oak St, Springfield",
    "homeowner_name": "Jane Doe",
    "adjuster_name": "Mr. Robert Smith",
}
_PROFILE = {"company_name": "Acme Roofing", "contact_name": "Tom K"}


def _all_email_voice_bodies():
    """Yield (label, html) for every variant of every email_voice pool by
    sweeping enough distinct claim seeds to hit each index."""
    for i in range(60):
        c = dict(_CLAIM, id=f"claim-{i}")
        yield f"supplement-{i}", ev.supplement_body(c, _PROFILE)
        yield f"supplement-items-{i}", ev.supplement_body(
            c, _PROFILE, items=[{"description": "Decking replacement", "amount": 1450.0}])
        yield f"completion-{i}", ev.supplement_body(
            c, _PROFILE, completion=True, contractor_rcv=18234.5, coc_attached=True)
        yield f"aob-{i}", ev.aob_carrier_body(c, _PROFILE)
        yield f"coc-{i}", ev.coc_body(c, _PROFILE)


def _all_bulk_bodies():
    """Bulk pools live in bulk_campaigns; import lazily so a missing optional
    dep there doesn't fail the whole email_voice suite."""
    try:
        import bulk_campaigns as bc
    except Exception as e:  # pragma: no cover
        print(f"[skip] bulk_campaigns import failed: {type(e).__name__}: {e}")
        return
    for i in range(80):
        cid = f"claim-{i}"
        yield f"bulk-supp-{i}", bc._supplement_body_html(
            cid, adj_name="Robert", addr="12 Oak St", claim_number="ABC123",
            phrases=["ice & water shield", "drip edge"], n_gaps=5, n_missing=3,
            n_under=2, rep_name="Tom K", company_name="Acme Roofing")
        yield f"bulk-forensic-{i}", bc._forensic_body_html(
            cid, adj_name="there", address="12 Oak St", claim_number="ABC123",
            carrier="State Farm", ho_line=" The homeowner is looped in.",
            rep_name="", company_name="Acme Roofing")


def test_all_shipped_variants_pass_linter_clean():
    """No shipped template may contain an AI tell or get mutated by the scrub."""
    dirty = []
    for label, html in list(_all_email_voice_bodies()) + list(_all_bulk_bodies()):
        flags = ev.scan_for_tells(html)
        cleaned, removed = ev.scrub_tells(html)
        if flags or removed or cleaned != html:
            dirty.append((label, flags, removed))
    assert not dirty, f"{len(dirty)} variant(s) tripped the linter: {dirty[:5]}"


def test_picker_is_deterministic_and_spreads():
    # deterministic
    a = ev.variant_index("claim-x", "co-1", n=8, salt="supplement")
    b = ev.variant_index("claim-x", "co-1", n=8, salt="supplement")
    assert a == b
    # different salt → can differ; at least it never explodes the range
    assert 0 <= ev.variant_index("claim-x", "co-1", n=8, salt="coc") < 8
    # spreads across the whole pool over many claims
    for n in (6, 8, 10):
        buckets = {ev.variant_index(f"claim-{i}", "co-1", n=n, salt="supplement")
                   for i in range(300)}
        assert buckets == set(range(n)), f"n={n} only hit {sorted(buckets)}"
    # n<=1 is always 0
    assert ev.variant_index("x", n=1) == 0
    assert ev.variant_index("x", n=0) == 0


def test_scan_and_scrub_catch_seeded_tells():
    sample = ("I hope this email finds you well. I wanted to reach out regarding your "
              "claim. Please don't hesitate to contact us. Furthermore, we leverage a "
              "robust, seamless process.")
    flags = ev.scan_for_tells(sample)
    assert flags, "expected the linter to flag obvious AI tells"
    cleaned, removed = ev.scrub_tells(sample)
    # high-confidence boilerplate is gone
    assert "hope this email finds you well" not in cleaned.lower()
    assert "hesitate to contact" not in cleaned.lower()
    assert "I wanted to reach out" not in cleaned
    # softer tells are surfaced, not silently dropped
    assert any("flag:" in r for r in removed)
    assert removed, "scrub should report what it changed/flagged"


def test_scrub_leaves_clean_human_copy_untouched():
    human = ("<p>Hi Robert,</p><p>Quick one on 12 Oak St — we found a couple items the "
             "first scope missed. I've attached the supplement so you can see each one. "
             "Let me know if you need anything.</p><p>Thanks,<br/>Tom K<br/>Acme Roofing</p>")
    cleaned, removed = ev.scrub_tells(human)
    assert cleaned == human
    assert removed == []
    assert ev.scan_for_tells(human) == []


def test_greeting_and_adjuster_name():
    assert ev.greeting(ev.adjuster_first_name({})) == "Hi there,"
    assert ev.greeting(ev.adjuster_first_name(_CLAIM)) == "Hi Robert,"  # honorific stripped
    # falls back through previous_carrier_data
    c = {"previous_carrier_data": {"adjuster_name": "Dana Lee"}}
    assert ev.adjuster_first_name(c) == "Dana"


def test_carrier_email_types_membership():
    assert "supplement" in ev.CARRIER_EMAIL_TYPES
    assert "send_to_carrier" in ev.CARRIER_EMAIL_TYPES
    assert "custom" in ev.CARRIER_EMAIL_TYPES
    # homeowner-facing types are intentionally excluded (scope: adjuster mail)
    assert "invoice" not in ev.CARRIER_EMAIL_TYPES
    assert "aob_signature" not in ev.CARRIER_EMAIL_TYPES


def _run_as_script():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(_run_as_script())
