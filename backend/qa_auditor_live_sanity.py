#!/usr/bin/env python3
"""Live sanity check for the QA weather-fabrication gate (PR #29 + #30).

Proves the gate (a) STILL fires on real fabrication (magnitude contradicting
confirmed NOAA), and (b) does NOT fire on the false-positive patterns we fixed:
confirmed-qualitative hail, absence-of-NOAA, and trade/material mentions.

Manual runbook — makes ~4 live Anthropic calls (small cost). Run after any change
to the FABRICATED_WEATHER_EVENT prompt or the deterministic severity gate. Not a
pytest test (no test_ prefix) so it never auto-runs in CI. The pure gate logic is
unit-tested in tests/test_qa_auditor_weather.py; this validates end-to-end
LLM-prompt + gate behavior that unit tests can't.

Run from backend/:  python3 qa_auditor_live_sanity.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

# load ANTHROPIC_API_KEY from backend/.env
for line in open(os.path.join(os.path.dirname(__file__), ".env")):
    line = line.strip()
    if line.startswith("ANTHROPIC_API_KEY="):
        os.environ["ANTHROPIC_API_KEY"] = line.split("=", 1)[1].strip().strip('"')

import anthropic
from qa_auditor import audit_forensic_prose

client = anthropic.Anthropic()

BASE = {
    "property": {"address": "1 Test St, Testville, NY 10001"},
    "dates": {"date_of_loss": "2025-07-03", "inspection_date": "2025-07-10", "report_date": "2025-07-12"},
    "carrier": {"name": "Test Mutual"},
    "insured": {"name": "Jane Doe"},
    "company": {"name": "USA ROOF MASTERS", "ceo_name": "Tom Kovack Jr."},
    "compliance": {"user_role": "contractor"},
    "line_items": [{"trade": "roofing"}, {"trade": "gutters"}],
}

def cfg(exec_p, concl_p, noaa):
    c = dict(BASE)
    c["weather"] = {"storm_date": "2025-07-03", "noaa": noaa}
    c["forensic_findings"] = {"executive_summary": [exec_p], "conclusion_paragraphs": [concl_p]}
    return c

CASES = [
    ("CONTRADICTION (must FLAG critical)",
     cfg("On July 3, 2025 a severe hailstorm struck the property at 1 Test St, Testville, NY 10001.",
         "Impact testing confirmed three-inch hail stones drove through the shingle mat across all slopes.",
         {"max_hail_inches": 1.0, "max_wind_mph": 0, "event_count": 40}),
     True),
    ("CONFIRMED qualitative hail (must NOT flag)",
     cfg("On July 3, 2025 a hail-producing storm impacted 1 Test St, Testville, NY 10001.",
         "Marked impact points exhibit granule displacement consistent with a broad-field hail event.",
         {"max_hail_inches": 2.0, "max_wind_mph": 60, "event_count": 248}),
     False),
    ("ABSENCE of NOAA (must NOT flag critical)",
     cfg("On April 27, 2026 a high-wind storm impacted 1 Test St, Testville, NY 10001.",
         "Directional displacement of shingles is consistent with sustained high-wind uplift forces.",
         {"max_hail_inches": 0, "max_wind_mph": 0, "event_count": 0}),
     False),
    ("TRADE/MATERIAL mention (must NOT flag as weather)",
     cfg("The inspection evaluated the laminated composite shingle roof, vinyl siding, aluminum fascia and soffit assemblies, and the gutter system at 1 Test St, Testville, NY 10001.",
         "Based on our forensic analysis of 46 documented findings, wind damage was confirmed across multiple roof slopes.",
         {"max_hail_inches": 0, "max_wind_mph": 0, "event_count": 0}),
     False),
]

print("=" * 70)
fails = 0
for name, config, expect_flag in CASES:
    res = audit_forensic_prose(config, {}, client)
    crits = res.get("critical", []) or []
    fab = [c for c in crits if c.get("issue") == "FABRICATED_WEATHER_EVENT"]
    got = bool(fab)
    ok = (got == expect_flag)
    fails += 0 if ok else 1
    print(f"[{'PASS' if ok else 'FAIL'}] {name}")
    print(f"        expected fabricated-weather-critical={expect_flag}, got={got}; all critical issues={[c.get('issue') for c in crits]}")
print("=" * 70)
print(f"RESULT: {'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
