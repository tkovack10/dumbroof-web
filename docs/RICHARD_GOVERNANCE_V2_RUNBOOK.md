# Richard Governance v2 — Operations Runbook

**Status as of 2026-05-04:** Days 0-10 shipped as PRs #1, #3, #4-9. Defaults are conservative; rollback is one env-var flip per feature.

## Architecture summary

Richard now runs through three explicit layers:

1. **Pre-flight middleware** (`backend/richard_middleware.py`) — language detection, ground-truth snapshot, setup-scope redirect. Runs BEFORE any LLM call.
2. **Tool dispatch** (`backend/claim_brain_tools.py:execute_tool`) — preconditions check, then per-tool handler. Two-tier approval gating in `main.py:claim_brain_chat`.
3. **Post-flight middleware** (`backend/richard_post.py`) — auto-chain rules, working memory, tool-result reconciler.

Plus the eval harness at `backend/richard_evals/` (Track 1 deterministic, Track 2 stochastic scaffold).

---

## Per-feature rollback (instant, no redeploy)

Set the env var in Vercel/Railway → restart workers (or wait for env propagation, ~30s).

| Symptom | Env var | What it does |
|---------|---------|--------------|
| Opus 4.8 producing weird output | `RICHARD_MODEL=claude-opus-4-7` | Revert just Richard to prior Opus (unified default is 4-8) |
| Tool calls running away | `RICHARD_MAX_TOOL_ROUNDS=10` | Revert Day 1 round cap |
| Tool calls running away | `RICHARD_MAX_TOTAL_TOOL_CALLS=20` | Revert Day 1 total cap |
| Reprocess firing too often | `RICHARD_REPROCESS_RATE_LIMIT_SECONDS=86400` | Effectively block reprocess |
| Auth getting in the way | `RICHARD_ENFORCE_AUTH=false` | Soft-fail JWT (existing flag) |
| Dry-run for safety | Set `company_profiles.richard_dry_run=true` for affected user | Existing per-user flag |

For governance v2 features without dedicated env flags yet (pre-flight middleware, auto-chain, working memory), the kill switch is to revert the relevant PR via `git revert` + redeploy. Per-feature env disable flags can be added if a regression is observed — pattern:

```python
if os.environ.get("RICHARD_DISABLE_PREFLIGHT", "").lower() in ("1", "true", "yes"):
    # skip prepare_brain_request
```

---

## Health canary

`/api/cron/richard-health-canary` runs every 15 min and compares the last 60min error rate against the 7-day baseline. If current error rate exceeds baseline by >5 percentage points (with at least 5 assistant messages in the current window), it:

- Writes an `agent_recommendations` row with `status='urgent'` and `agent='richard_health_canary'`
- Includes a suggested env-flag rollback in the rationale field

It does NOT auto-flip env flags — Tom's call. The row surfaces at the top of `/admin/agent-recommendations` so the response time is fast.

To register the cron, add to `vercel.json`:

```json
{
  "crons": [
    {"path": "/api/cron/richard-health-canary", "schedule": "*/15 * * * *"}
  ]
}
```

---

## Canary rollout playbook

**Day 1 morning** (after merging PRs in order: #1 → #3 → #4 → #5 → #6 → #7 → #8 → #9):

1. Verify via `/api/health` that Railway picked up the new build
2. Tom's account: chat with Richard for 30 min, exercise:
   - Spanish detection (send `Hola, ¿cuántas fotos tengo?`)
   - Auto-chain reprocess (`add a $500 line item and reprocess`)
   - Two-tier approval (`add 3 photos to exclude`) — should NOT pop preview cards
   - Setup-scope redirect (`from /dashboard/settings ask about a claim`) — should redirect
3. If clean for 4h, proceed.

**Day 1 afternoon:**
4. Email Jacob/Supreme — ask him to test the $19,632.14 set_estimate_total flow on his claim
5. Email Jeremy/Nixa — ask him to retry his terse OPERATIONAL probes (should now match terseness)
6. Watch `chat_messages.tool_actions` for any `status: 'error'` patterns

**Day 3:**
7. If the canary hasn't fired any urgent alerts, declare governance v2 fully released
8. Update [STRATEGIC-VISION.md](../memory/STRATEGIC-VISION.md) to reflect "Richard is now agentic by default"

---

## Known issues / follow-ups

- **Track 2 LLM replay** is currently a fixture-validation scaffold. Wiring real Opus 4.7 replay against `claim_brain_chat` requires a test-mode hook on the chat handler — small follow-up.
- **`_build_claim_brain_prompt` not yet rewritten** to consume from `backend/richard_prompts/*.md` — the inline rules from PR #1 still live in main.py. Files exist + loader works + trainer targets them, but actual consumption needs eval harness validation first (chicken-and-egg).
- **Approval card persistence bug** (E190 family) is OUT OF SCOPE for governance v2 — separate ticket. The auto-approve tier in PR #5 sidesteps it for internal-state tools, but outbound comms still depend on the approval flow being reliable.
- **Onboarding crash** (Ronaldo's `'NoneType' object is not iterable` on placeholder claim creation) is OUT OF SCOPE — separate ticket. PR #6's `invite_team_member` precondition fixes the user-visible Richard surface; the underlying processor crash needs its own investigation.

---

## Memory updates

When governance v2 is fully released, update these memory files:

- `MEMORY.md` — add governance v2 entry to Cognitive Infrastructure
- `STRATEGIC-VISION.md` — update agentic Richard section
- `feedback_richard_agentic.md` — mark R1-R6 milestones complete
- `feedback_richard_setup_scope.md` — note that setup-scope redirect is now deterministic (richard_middleware.is_per_claim_question), not just prompt-based

---

## PRs in this release

| # | Day | Branch | Description |
|---|-----|--------|-------------|
| #1 | 0 | `governance-v2/day-0-trainer-fixes` | 6 trainer prompt rules |
| #3 | 1 | `governance-v2/day-1-opus47-and-cap-raise` | Opus 4.7 + tool cap raise |
| #4 | 2-3a | `governance-v2/day-2-3-preflight-middleware` | Pre-flight middleware + ground truth |
| #5 | 2-3b | `governance-v2/day-2-3b-two-tier-approval` | Two-tier approval gating + rate-limited reprocess |
| #6 | 4 | `governance-v2/day-4-preconditions-and-mutation-tools` | Tool preconditions + 5 new tools + op_override |
| #7 | 5 | `governance-v2/day-5-autochain-reconciler-workingmemory` | Auto-chain rules + working memory |
| #8 | 6-7 | `governance-v2/day-6-7-externalize-prompts` | richard_prompts/ scaffolding |
| #9 | 8-9 | `governance-v2/day-8-9-eval-harness` | Track 1 + Track 2 eval harness |
| #10 | 10 | `governance-v2/day-10-canary-and-auto-disable` | Health canary cron + this runbook |
