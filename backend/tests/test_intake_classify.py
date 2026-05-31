"""Intake classifier: the fine Vision label must map onto the right intake
FOLDER, and classification must FAIL OPEN (never raise, never block an upload).

Context (Richard activation, backend enabling layer): a single drop box on the
instant / onboarding / dashboard funnel self-sorts files by calling
``classify_intake_file`` (claim_brain_tools.py), which reuses Richard's Vision
classifier prompt+call via the shared ``_run_vision_classification`` seam. This
test stubs that seam — NO network, NO Anthropic key, NO Supabase — so it runs in
a bare shell and in CI alike. It asserts:

  1. label → category mapping:
       PHOTO         -> photos
       EAGLEVIEW     -> measurements
       CARRIER_SCOPE -> scope
       AOB/COC/...   -> scope        (claim docs ride with the scope bucket)
       junk/OTHER    -> other
  2. fail-open: if the Vision seam raises, classify_intake_file still returns
     "other" (or "photos" for an obvious image) and NEVER propagates the error.
  3. the pure mapping helper (_intake_category_for_label) is total — any unknown
     label degrades to "other".

Plain asserts + __main__ runner (matches the repo's non-pytest tests, e.g.
test_tax_resolution.py / test_scope_label.py). Run:  python3 tests/test_intake_classify.py
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
sys.path.insert(0, _BACKEND)

import claim_brain_tools as cbt  # noqa: E402


# A tiny byte blob with a Vision-SUPPORTED extension so classify_intake_file
# routes through the (stubbed) Vision path rather than the filename fallback.
# Content is irrelevant — _vision_doc_block keys off the extension only.
_PDF_BYTES = b"%PDF-1.4 not-a-real-pdf"
_PDF_NAME = "dropped_document.pdf"


def _stub_vision(label, confidence=0.95):
    """Return a drop-in replacement for cbt._run_vision_classification that
    pretends Vision returned `label`."""
    def _fn(*_a, **_k):
        return {
            "classification": label,
            "confidence": confidence,
            "signals": ["stub"],
            "suggested_action": "",
        }
    return _fn


def _with_vision(stub, call):
    """Swap in the stub for the duration of `call`, always restore."""
    original = cbt._run_vision_classification
    cbt._run_vision_classification = stub
    try:
        return call()
    finally:
        cbt._run_vision_classification = original


# ── 1. label → category mapping (the core contract the frontend depends on) ──

def test_photo_maps_to_photos():
    r = _with_vision(
        _stub_vision("PHOTO"),
        lambda: cbt.classify_intake_file(file_bytes=_PDF_BYTES, filename=_PDF_NAME),
    )
    assert r["category"] == "photos", r
    assert r["label"] == "PHOTO", r
    assert 0.0 <= r["confidence"] <= 1.0, r


def test_eagleview_maps_to_measurements():
    r = _with_vision(
        _stub_vision("EAGLEVIEW"),
        lambda: cbt.classify_intake_file(file_bytes=_PDF_BYTES, filename=_PDF_NAME),
    )
    assert r["category"] == "measurements", r
    assert r["label"] == "EAGLEVIEW", r


def test_carrier_scope_maps_to_scope():
    r = _with_vision(
        _stub_vision("CARRIER_SCOPE"),
        lambda: cbt.classify_intake_file(file_bytes=_PDF_BYTES, filename=_PDF_NAME),
    )
    assert r["category"] == "scope", r
    assert r["label"] == "CARRIER_SCOPE", r


def test_claim_docs_map_to_scope():
    """AOB / COC / SUPPLEMENT_RESPONSE / CONTRACT all ride the scope bucket."""
    for label in ("AOB", "COC", "SUPPLEMENT_RESPONSE", "CONTRACT"):
        r = _with_vision(
            _stub_vision(label),
            lambda: cbt.classify_intake_file(file_bytes=_PDF_BYTES, filename=_PDF_NAME),
        )
        assert r["category"] == "scope", (label, r)


def test_junk_label_maps_to_other():
    """A label Vision shouldn't emit (junk) degrades to 'other', not a crash."""
    r = _with_vision(
        _stub_vision("WAT_IS_THIS", confidence=0.95),
        lambda: cbt.classify_intake_file(file_bytes=_PDF_BYTES, filename=_PDF_NAME),
    )
    assert r["category"] == "other", r


def test_explicit_other_maps_to_other():
    r = _with_vision(
        _stub_vision("OTHER"),
        lambda: cbt.classify_intake_file(file_bytes=_PDF_BYTES, filename=_PDF_NAME),
    )
    assert r["category"] == "other", r


# ── 2. fail-open: a raising Vision seam must NOT propagate ────────────────────

def test_vision_exception_fails_open_to_other():
    """If the Vision call raises, classify_intake_file keeps the file ('other')
    and never re-raises — uploads must never be blocked on classification."""
    def _boom(*_a, **_k):
        raise RuntimeError("simulated Vision/network failure")

    r = _with_vision(
        _boom,
        lambda: cbt.classify_intake_file(file_bytes=_PDF_BYTES, filename=_PDF_NAME),
    )
    assert r["category"] == "other", r
    assert r["confidence"] == 0.0, r


def test_vision_exception_keeps_image_as_photo():
    """When the seam raises but the file is obviously an image, keep it as a
    photo (MIME/extension backstop) rather than dumping it in 'other'."""
    def _boom(*_a, **_k):
        raise RuntimeError("simulated failure")

    # .jpg is a Vision-supported type, so it reaches the (raising) seam, then the
    # image backstop catches it.
    r = _with_vision(
        _boom,
        lambda: cbt.classify_intake_file(file_bytes=b"\xff\xd8\xff junk", filename="roof_damage.jpg"),
    )
    assert r["category"] == "photos", r


def test_low_confidence_image_backstop():
    """Vision unsure (OTHER, low confidence) but the file is clearly an image →
    keep it as a photo so we don't lose obvious damage shots to 'other'."""
    r = _with_vision(
        _stub_vision("OTHER", confidence=0.2),
        lambda: cbt.classify_intake_file(file_bytes=b"\xff\xd8\xff junk", filename="closeup.jpg"),
    )
    assert r["category"] == "photos", r


# ── 3. unsupported / no-bytes paths never raise and never block ──────────────

def test_unsupported_type_no_bytes_image_name_kept_as_photo():
    """No bytes + an image filename → photos (the frontend still keeps it)."""
    r = cbt.classify_intake_file(file_bytes=None, filename="phone_pic.heic")
    assert r["category"] == "photos", r


def test_unsupported_type_no_bytes_unknown_name_is_other():
    r = cbt.classify_intake_file(file_bytes=None, filename="mystery.bin")
    assert r["category"] == "other", r


# ── 4. pure mapping helper is total (no label escapes to a crash) ────────────

def test_mapping_helper_is_total():
    expected = {
        "PHOTO": "photos",
        "EAGLEVIEW": "measurements",
        "CARRIER_SCOPE": "scope",
        "AOB": "scope",
        "COC": "scope",
        "SUPPLEMENT_RESPONSE": "scope",
        "CONTRACT": "scope",
        "OTHER": "other",
    }
    for label, cat in expected.items():
        assert cbt._intake_category_for_label(label) == cat, (label, cat)
        # case-insensitive
        assert cbt._intake_category_for_label(label.lower()) == cat, (label, cat)
    # unknowns + None degrade to other, never raise
    assert cbt._intake_category_for_label("???") == "other"
    assert cbt._intake_category_for_label(None) == "other"
    assert cbt._intake_category_for_label("") == "other"


def _run_all():
    tests = [v for k, v in sorted(globals().items())
             if k.startswith("test_") and callable(v)]
    passed = 0
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  FAIL  {t.__name__}: {e}")
            failed += 1
        except Exception as e:  # any other exception = a real bug (e.g. it raised)
            print(f"  ERROR {t.__name__}: {type(e).__name__}: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    return failed


if __name__ == "__main__":
    sys.exit(1 if _run_all() else 0)
