#!/usr/bin/env python3
"""WS-0 — Golden-corpus regression GATE for the forensic causation report.

This is commit #1 of the forensic overhaul. Its ONLY job is to make the
forensic renderer's output byte-stable so every subsequent forensic change is
proven to be either (a) intentional (snapshots regenerated on purpose) or
(b) a no-op (snapshots unchanged). It changes ZERO reports — it only renders
the committed fixtures and compares the normalized HTML to committed snapshots.

How it works
------------
* Fixtures live in ``tests/golden_corpus/<claim_id>.json`` and are STATIC
  committed snapshots of real production claims:
      {"config": <claim_config JSONB>, "claim": {address, carrier, contact_name, weather_data}}
  The gate NEVER touches the live database — it runs entirely off these files.
* For each fixture we ``build_forensic_report`` against EMPTY tmp photo/output
  dirs (the renderer degrades to '' when photo/logo files are absent), read the
  emitted HTML, NORMALIZE it (see ``normalize_forensic_html``), and compare it
  byte-for-byte to ``tests/golden_corpus/snapshots/<id>.forensic.txt``.

Normalization (the KEYSTONE — neutralize ALL nondeterminism)
------------------------------------------------------------
1. Strip every ``src="data:...;base64,..."`` payload  -> ``src="data:IMG"``.
2. Neutralize every now()-derived token. The renderer's ONLY clock read is
   ``_estimate_roof_age`` (usarm_pdf_generator.py: ``datetime.datetime.now().year``),
   which renders an estimated age + an "installed circa YYYY" install year in
   ~3 phrasings. We do this TWO ways, belt-and-suspenders:
     (a) FREEZE the clock at render time (patch ``datetime.datetime`` to a fixed
         instant) so the year math is deterministic at the source; and
     (b) regex-scrub the rendered age/circa tokens to a fixed placeholder so the
         snapshot encodes NO year at all and survives even a future change to
         the age-dating base years.
   We also neutralize the per-fixture ``report_date`` / inspection-date display
   strings to a fixed placeholder (these come from config today, but the gate
   must not encode a now()-derived date if one ever lands there).
3. Collapse whitespace.

Running
-------
Self-contained — NO pytest (not installed). Plain asserts + ``__main__``.

    # (re)write snapshots:
    REGEN_GOLDEN=1 python3 backend/tests/test_golden_forensic_corpus.py
    # assert byte-identical (the gate):
    python3 backend/tests/test_golden_forensic_corpus.py
"""

from __future__ import annotations

import copy
import datetime as _dtmod
import glob
import json
import os
import re
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.join(_HERE, "..")
sys.path.insert(0, _BACKEND)

CORPUS_DIR = os.path.join(_HERE, "golden_corpus")
SNAPSHOT_DIR = os.path.join(CORPUS_DIR, "snapshots")

# A fixed instant used to freeze the renderer's clock so any now()-derived
# value (today: only _estimate_roof_age's current_year) is deterministic.
_FROZEN = _dtmod.datetime(2020, 1, 1, 0, 0, 0)

_PLACEHOLDER_DATE = "<DATE>"
_PLACEHOLDER_YEARS = "<N>"


class _FrozenDateTime(_dtmod.datetime):
    """datetime.datetime subclass whose now/utcnow/today are pinned to _FROZEN."""

    @classmethod
    def now(cls, tz=None):
        return _FROZEN if tz is None else _FROZEN.replace(tzinfo=tz)

    @classmethod
    def utcnow(cls):
        return _FROZEN

    @classmethod
    def today(cls):
        return _FROZEN


# --------------------------------------------------------------------------
# Normalization
# --------------------------------------------------------------------------

# 1) base64 image payloads -> stable token. Matches both jpeg/png/etc.
_RE_DATA_IMG = re.compile(r'src="data:[^"]*;base64,[^"]*"')

# 2a) "installed circa YYYY"
_RE_CIRCA = re.compile(r"installed circa \d{4}", re.IGNORECASE)
# 2b) "Approximately N years" / "approximately N years"
_RE_APPROX_YEARS = re.compile(r"pproximately \d+ years", re.IGNORECASE)
# 2c) "N years old"
_RE_YEARS_OLD = re.compile(r"\b\d+ years old\b", re.IGNORECASE)
# 2d) "N years of service"
_RE_YEARS_SERVICE = re.compile(r"\b\d+ years of service\b", re.IGNORECASE)

# 3) whitespace collapse
_RE_WS = re.compile(r"\s+")


def _date_display_variants(value: str) -> list[str]:
    """Return the rendered display variants of a stored date string.

    ``_format_date_human`` (used by the prose/ground-truth path) and the
    forensic renderer interpolate the raw stored ``dates.*`` values directly,
    so the stored value IS the rendered value. We just scrub that literal.
    """
    if not value or not isinstance(value, str):
        return []
    out = {value.strip()}
    return [v for v in out if v]


def normalize_forensic_html(html: str, config: dict) -> str:
    """Normalize rendered forensic HTML into a deterministic snapshot string.

    Order matters: scrub data URIs and now()-derived tokens BEFORE the
    whitespace collapse so the regexes see the original formatting.
    """
    text = html or ""

    # (1) base64 payloads
    text = _RE_DATA_IMG.sub('src="data:IMG"', text)

    # (2) now()-derived roof-age tokens (clock was already frozen at render;
    # this makes the snapshot encode no year at all).
    text = _RE_CIRCA.sub("installed circa " + _PLACEHOLDER_DATE, text)
    text = _RE_APPROX_YEARS.sub("pproximately " + _PLACEHOLDER_YEARS + " years", text)
    text = _RE_YEARS_OLD.sub(_PLACEHOLDER_YEARS + " years old", text)
    text = _RE_YEARS_SERVICE.sub(_PLACEHOLDER_YEARS + " years of service", text)

    # (2 cont.) per-fixture report_date / inspection-date display strings.
    dates = (config.get("dates") or {}) if isinstance(config, dict) else {}
    date_literals: set[str] = set()
    for key in ("report_date", "usarm_inspection_date", "inspection_date",
                "carrier_inspection_date"):
        for v in _date_display_variants(dates.get(key, "")):
            date_literals.add(v)
    for v in (dates.get("usarm_inspection_dates") or []):
        if isinstance(v, dict):
            for d in _date_display_variants(v.get("date", "")):
                date_literals.add(d)
    # Replace longest first so a substring date doesn't partially mask another.
    for lit in sorted(date_literals, key=len, reverse=True):
        text = text.replace(lit, _PLACEHOLDER_DATE)

    # (3) collapse whitespace
    text = _RE_WS.sub(" ", text).strip()
    return text


# --------------------------------------------------------------------------
# Render harness
# --------------------------------------------------------------------------

def render_forensic_text(fixture: dict) -> str:
    """Render a fixture's forensic report and return its normalized snapshot text.

    Deep-copies the config, injects empty tmp photo/output dirs (renderer
    degrades to '' for missing photos/logos), freezes the clock for the render,
    reads the emitted HTML, and normalizes it.
    """
    import usarm_pdf_generator as G  # imported here so sys.path is set first

    config = copy.deepcopy(fixture["config"])
    tmp_photos = tempfile.mkdtemp(prefix="ws0_photos_")
    tmp_output = tempfile.mkdtemp(prefix="ws0_out_")
    config["_paths"] = {
        "claim_dir": tmp_output,
        "photos": tmp_photos,
        "output": tmp_output,
        "source_docs": tmp_output,
    }

    orig_datetime = _dtmod.datetime
    try:
        _dtmod.datetime = _FrozenDateTime  # freeze clock for the render only
        path = G.build_forensic_report(config)
        with open(path, "r", encoding="utf-8") as f:
            html = f.read()
    finally:
        _dtmod.datetime = orig_datetime

    return normalize_forensic_html(html, config)


def _load_fixtures() -> list[tuple[str, dict]]:
    out = []
    for fp in sorted(glob.glob(os.path.join(CORPUS_DIR, "*.json"))):
        fid = os.path.splitext(os.path.basename(fp))[0]
        with open(fp, "r", encoding="utf-8") as f:
            out.append((fid, json.load(f)))
    return out


def _snapshot_path(fid: str) -> str:
    return os.path.join(SNAPSHOT_DIR, f"{fid}.forensic.txt")


def run(regen: bool) -> int:
    fixtures = _load_fixtures()
    if not fixtures:
        print("FAIL: no fixtures found in", CORPUS_DIR)
        return 1
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)

    failures = 0
    for fid, fixture in fixtures:
        try:
            actual = render_forensic_text(fixture)
        except Exception as e:  # noqa: BLE001 — surface any render crash as a failure
            failures += 1
            print(f"FAIL {fid}: render raised {type(e).__name__}: {str(e)[:200]}")
            continue

        snap = _snapshot_path(fid)
        if regen:
            with open(snap, "w", encoding="utf-8") as f:
                f.write(actual)
            print(f"WROTE {fid} ({len(actual)} bytes)")
            continue

        if not os.path.exists(snap):
            failures += 1
            print(f"FAIL {fid}: no golden snapshot — run with REGEN_GOLDEN=1")
            continue
        with open(snap, "r", encoding="utf-8") as f:
            expected = f.read()
        if actual == expected:
            print(f"PASS {fid}")
        else:
            failures += 1
            print(f"FAIL {fid}: normalized forensic HTML differs from golden snapshot")
            # First-divergence diagnostics (chars), so a real regression is debuggable.
            n = min(len(actual), len(expected))
            i = next((k for k in range(n) if actual[k] != expected[k]), n)
            lo = max(0, i - 60)
            print(f"      first diff at char {i} (len exp={len(expected)} act={len(actual)})")
            print(f"      expected: ...{expected[lo:i+60]!r}")
            print(f"      actual:   ...{actual[lo:i+60]!r}")

    total = len(fixtures)
    if regen:
        print(f"\nREGEN complete: {total} snapshots written.")
        return 0
    print(f"\n{total - failures}/{total} fixtures byte-identical to golden snapshots.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(run(regen=bool(os.environ.get("REGEN_GOLDEN"))))
