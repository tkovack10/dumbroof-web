"""Render eval results as markdown for the admin dashboard / PR comments.

Used by:
- /api/admin/agent-recommendations/[id]/approve — fail PR if Track 1 regresses
- Nightly cron — posts to agent_recommendations as a system-wide health row

Both consume `EvalReport` and call `to_markdown()` for display.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional


@dataclass
class FixtureResult:
    name: str
    track: str
    passed: bool
    runs: int = 1
    failures: list[str] = field(default_factory=list)


@dataclass
class EvalReport:
    track: str  # "track1" or "track2"
    started_at: str
    duration_ms: int
    total: int
    passed: int
    failed: int
    fixture_results: list[FixtureResult] = field(default_factory=list)

    @property
    def passing(self) -> bool:
        return self.failed == 0

    def to_markdown(self) -> str:
        emoji = "✅" if self.passing else "❌"
        lines = [
            f"# Richard Eval Report — {self.track.upper()} {emoji}",
            "",
            f"- **Started:** {self.started_at}",
            f"- **Duration:** {self.duration_ms}ms",
            f"- **Result:** {self.passed}/{self.total} passing",
            "",
        ]
        if self.failed:
            lines.append("## Failures")
            for fr in self.fixture_results:
                if not fr.passed:
                    lines.append(f"- **{fr.name}**")
                    for f in fr.failures:
                        lines.append(f"  - {f}")
        else:
            lines.append("All fixtures passing — no regressions.")
        return "\n".join(lines)

    def to_dict(self) -> dict:
        return asdict(self)


def run_track1_and_collect() -> EvalReport:
    """Run Track 1 via pytest and parse JSON output into EvalReport.

    Used by the agent-recommendations approve route as a CI gate.
    """
    started = datetime.now(timezone.utc)
    cmd = [
        "python3", "-m", "pytest",
        "backend/richard_evals/track1_unit.py",
        "-v", "--json-report", "--json-report-file=/tmp/track1_report.json",
        "--tb=short",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    duration_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)

    # Parse pytest-json-report output if present
    fixture_results: list[FixtureResult] = []
    total = passed = failed = 0
    try:
        with open("/tmp/track1_report.json") as f:
            data = json.load(f)
        for t in (data.get("tests") or []):
            outcome = t.get("outcome")
            name = t.get("nodeid", "").split("::")[-1]
            failures = []
            if outcome == "failed":
                msg = (t.get("call") or {}).get("longrepr") or "(no message)"
                failures = [str(msg)[:500]]
            fixture_results.append(FixtureResult(
                name=name,
                track="track1",
                passed=(outcome == "passed"),
                failures=failures,
            ))
            total += 1
            if outcome == "passed":
                passed += 1
            elif outcome == "failed":
                failed += 1
    except FileNotFoundError:
        # pytest-json-report not installed — fall back to exit-code-only signal
        total = 1
        if proc.returncode == 0:
            passed = 1
            fixture_results.append(FixtureResult(name="track1_full_suite", track="track1", passed=True))
        else:
            failed = 1
            fixture_results.append(FixtureResult(
                name="track1_full_suite",
                track="track1",
                passed=False,
                failures=[proc.stdout[-2000:] + "\n" + proc.stderr[-2000:]],
            ))

    return EvalReport(
        track="track1",
        started_at=started.isoformat(),
        duration_ms=duration_ms,
        total=total,
        passed=passed,
        failed=failed,
        fixture_results=fixture_results,
    )


if __name__ == "__main__":
    rep = run_track1_and_collect()
    print(rep.to_markdown())
