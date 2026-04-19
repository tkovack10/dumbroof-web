# DS/TAS Calibration Report — 2026-04-19

**Corpus:** 234 claims with both `damage_score` + `approval_score` + `claim_outcomes.movement_amount`.
**Wins:** 14 (movement_amount > 0).
**Scoring version:** v1 (original heuristic weights; see `backend/damage_scoring/weights` in `damage_scorer.py`).

---

## Headline

**Current DS/TAS aggregate scores are NOT predictive of claim outcomes.** The heuristic weights we shipped in v1 are uncorrelated (DS) or barely correlated (TAS) with settlement movement. This is the expected finding at this sample size — 14 wins is too few for per-component calibration — but the aggregate-level null result is itself actionable: it tells us we should NOT trust the current scores as a win-predictor yet, and it motivates the component-subscore persistence work we shipped today (so a richer calibration becomes possible as we accumulate data).

---

## Correlations

| Signal pair | Pearson r | Interpretation |
|---|---|---|
| `damage_score` × `movement_amount` | **−0.06** | No relationship |
| `damage_score` × `movement_pct` | **−0.14** | Slightly inverse (noise) |
| `damage_score` × `won (binary)` | **+0.01** | No relationship |
| `approval_score` × `movement_amount` | +0.02 | No relationship |
| `approval_score` × `movement_pct` | 0.00 | No relationship |
| `approval_score` × `won (binary)` | **+0.13** | Weak positive |

Mean scores:
- Winners: DS=71.86, TAS=49.14
- Non-winners: DS=71.52, TAS=44.91
- DS gap between winners and non-winners: **0.34 points** — effectively zero.
- TAS gap: **4.23 points** — modest but small-sample.

## Win rate by DS band

| DS band | n | wins | win rate |
|---|---|---|---|
| A+ (85+) | 3 | 0 | 0% |
| A (75-84) | 85 | 6 | 7.1% |
| B (65-74) | 112 | 7 | 6.3% |
| C (50-64) | 30 | 0 | 0% |
| D/F (<50) | 4 | 1 | 25% (tiny-sample) |

Directionally (setting aside the two tiny-sample cells), A and B bands win at ~6-7%, and C wins at 0%. That's a faint monotone signal but the magnitudes are too small and small-sample to calibrate weights on.

## What the biggest wins looked like

The 5 largest dollar wins:

| Carrier | DS | TAS | Movement $ | Movement % |
|---|---|---|---|---|
| J.S. Held | 79 | 42 | $60,023 | 54.5% |
| (unknown) | **45** | 34 | $51,257 | **234%** |
| State Farm | 73 | 51 | $32,443 | 112.7% |
| State Farm | 78 | 53 | $30,628 | 77.4% |
| State Farm | 66 | 45 | $25,085 | 196.8% |

**Key pattern:** The biggest *percentage* movements come from claims where the carrier's initial scope was dramatically low (100%+ movement = carrier scope was less than half the true value). The DS on those claims is mid-range. This suggests that **movement size is driven more by "how wrong was the first scope" than "how well we documented the damage."**

## Why this isn't surprising (yet)

Three confounders make the aggregate correlation weak:

1. **DS is computed on initial submission data.** It reflects photo documentation quality *before* the carrier scope is available. It can't predict a future win that depends on how aggressively the carrier under-scoped.

2. **TAS has a `scope` component (10 pts) that is always 0 on pre-scope claims** — no carrier scope exists yet to compare against. Pre-scope claims have a structural TAS ceiling of 90.

3. **Movement is dominated by carrier behavior, not our evidence quality.** If State Farm initially authorizes $10K and the real cost is $40K, we move $30K regardless of whether our photos are 65-grade or 85-grade. Our documentation determines whether we *win the supplement* (binary), not the dollar size.

## Recommended next steps (in priority order)

1. **Do NOT adjust v1 weights based on this.** The sample size is too small and the confounders above dominate. Keep shipping; let component-subscore data accumulate for 30-60 days.
2. **Track Won/Lost binary separately.** TAS shows a +0.13 correlation with binary wins — meaningful if our hit rate on component subscore data pushes to +0.30+ with calibrated weights. Re-run this analysis monthly once 30+ new claims have component subscores populated.
3. **Add a new outcome variable: `supplement_won_rate`.** Fraction of supplement line items the carrier accepted. This is the metric DS should actually predict — it measures "does our documentation win the per-item argument" rather than "did the claim move."
4. **Investigate the DS=45 / $51K / 234% outlier.** This claim had poor documentation but won huge. Either our DS under-measured it, or the carrier's initial scope was so egregious that documentation didn't matter. Worth a case study for the playbook.
5. **Re-pull this analysis after the first 20 claims process with the new `reroof_justification` + `ds_per_slope` data.** Per-slope scoring (component E) may capture signal that A-D components missed.

## Decision

Keep `score_version='v1'` on all new claims. Defer weight recalibration until:
- Component subscores populated on ≥30 new claims (60+ days at current volume), OR
- 20+ new wins captured (gives us ~34 wins total for stable correlation)

At that point, re-run with component-level features + random forest feature importance to recommend v2 weights.
