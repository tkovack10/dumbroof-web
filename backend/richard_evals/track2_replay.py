"""Track 2 — stochastic LLM replay (governance v2 Day 8-9).

Run: `python3 -m backend.richard_evals.track2_replay --all --runs=3`

Replays each fixture against the actual claim_brain_chat handler with
mocked tool execution. Real Opus 4.7 calls — runs nightly via cron.
Per-fixture pass-rate ≥ 2/3 to tolerate LLM noise.

This is SCAFFOLDING for the MVP — full implementation requires:
1. A test-mode flag on claim_brain_chat that injects mocked tool results
   (rather than calling real Supabase / sending real emails)
2. Fixture loader that translates the JSON `asserts` into runtime checks
3. A nightly cron route at /api/cron/richard-evals that runs this and
   posts regressions back to agent_recommendations

For now, this script:
- Loads fixtures
- Validates fixture shape
- Prints what it would run

Wiring it to a real test-mode is a follow-up — getting the harness
+ fixtures + Track 1 in place is the load-bearing MVP deliverable.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

_THIS = os.path.dirname(os.path.abspath(__file__))
_FIXTURES = os.path.join(_THIS, "fixtures")


def load_fixture(name: str) -> dict:
    path = os.path.join(_FIXTURES, name if name.endswith(".json") else f"{name}.json")
    with open(path) as f:
        return json.load(f)


def list_fixtures(track: str | None = None) -> list[dict]:
    out: list[dict] = []
    for fn in sorted(os.listdir(_FIXTURES)):
        if not fn.endswith(".json"):
            continue
        fx = load_fixture(fn)
        if track and track not in (fx.get("track") or []):
            continue
        out.append({**fx, "_filename": fn})
    return out


def validate_fixture(fx: dict) -> list[str]:
    """Return list of validation errors, empty list if OK."""
    errors: list[str] = []
    for required in ("name", "track", "scope", "user_messages", "asserts"):
        if required not in fx:
            errors.append(f"missing required field: {required}")
    if "track" in fx and not isinstance(fx["track"], list):
        errors.append("`track` must be an array (e.g. ['track1', 'track2'])")
    if "scope" in fx and fx["scope"] not in ("claim", "user", "company"):
        errors.append(f"`scope` must be one of claim|user|company, got {fx['scope']!r}")
    return errors


def main():
    ap = argparse.ArgumentParser(description="Track 2 stochastic LLM replay")
    ap.add_argument("--fixture", help="Run a single fixture by name")
    ap.add_argument("--all", action="store_true", help="Run all track2 fixtures")
    ap.add_argument("--validate-only", action="store_true", help="Just validate fixture shapes")
    ap.add_argument("--runs", type=int, default=3, help="Replays per fixture (pass = 2/3+)")
    args = ap.parse_args()

    if args.fixture:
        fixtures = [load_fixture(args.fixture)]
    else:
        fixtures = list_fixtures(track="track2" if not args.validate_only else None)

    if not fixtures:
        print("No fixtures matched.", file=sys.stderr)
        sys.exit(1)

    # Always validate
    invalid = []
    for fx in fixtures:
        errors = validate_fixture(fx)
        if errors:
            invalid.append((fx.get("_filename") or fx.get("name"), errors))
    if invalid:
        print("FIXTURE VALIDATION FAILURES:")
        for name, errs in invalid:
            print(f"  {name}:")
            for e in errs:
                print(f"    - {e}")
        sys.exit(2)
    print(f"✅ {len(fixtures)} fixtures validated cleanly")

    if args.validate_only:
        return

    # Replay scaffolding — actual LLM execution path is a follow-up.
    print(f"\n[scaffold] Would replay {len(fixtures)} fixture(s) {args.runs}x each.")
    print("[scaffold] Test-mode hook on claim_brain_chat is a follow-up.")
    for fx in fixtures:
        print(f"  - {fx['name']:40s} scope={fx['scope']:8s} asserts={len(fx['asserts'])}")


if __name__ == "__main__":
    main()
