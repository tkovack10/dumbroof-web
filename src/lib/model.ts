/**
 * Canonical model selector for ALL dumbroof.ai frontend/edge Claude calls.
 * =======================================================================
 * ONE knob, mirroring backend/model_config.py. Every Next.js route / lib that
 * hits the Anthropic API imports DUMBROOF_MODEL so the whole product runs a
 * single model.
 *
 * Default: claude-opus-4-8 (unified 2026-05-28 — vision, reasoning, text
 * extraction, everything on one Opus 4.8). Set DUMBROOF_MODEL in the Vercel
 * env to bump every edge/cron call at once without a code change.
 */
export const DUMBROOF_MODEL = process.env.DUMBROOF_MODEL ?? "claude-opus-4-8";
