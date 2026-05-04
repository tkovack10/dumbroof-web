"""Richard eval harness (governance v2 Day 8-9).

Two tracks:

- **Track 1 — Deterministic unit tests** (`track1_unit.py`): pure-function
  asserts against the pre-flight middleware, auto-chain engine, working
  memory rules, and tool preconditions. Runs in <1s. Gates every PR via
  the `/api/admin/agent-recommendations/[id]/approve` route.

- **Track 2 — Stochastic LLM replay** (`track2_replay.py`): real Opus 4.7
  call against full pipeline. 3× per fixture; pass-rate >= 2/3. Catches
  prose drift but tolerates LLM noise. Runs nightly via cron.

Fixtures live under `fixtures/` as JSON. Track 1 tests reference them by
name; Track 2 replays them through the chat handler.
"""
