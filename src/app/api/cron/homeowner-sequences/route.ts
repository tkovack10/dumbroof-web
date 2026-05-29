import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend, EMAIL_FROM_CLAIMS, EMAIL_REPLY_TO } from "@/lib/resend";
import { companyOwnerEmails, mergeBcc } from "@/lib/team-bcc";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { logClaimEvent } from "@/lib/claim-events";
import { resolveCompanyAttachments } from "@/lib/homeowner/attachments";
import { renderHomeownerEmail } from "@/lib/homeowner/render";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Homeowner engagement sequence DRIVER.
 *
 * The sequence is started by POST /api/homeowner/sequence (action=start),
 * which upserts a homeowner_sequences row (status=active, started_at=now,
 * next_send_at=now+10min). Until this cron existed there was nothing to
 * actually FIRE the day-grained steps — this route is that driver.
 *
 * Each run:
 *   1. Selects active homeowner_sequences where next_send_at <= now().
 *   2. For each, finds the NEXT due email_templates time-step:
 *        - smallest trigger_offset_days strictly greater than the row's
 *          last_sent_offset_days cursor, AND
 *        - whose scheduled time (started_at + offset days) is <= now().
 *   3. Renders placeholders from the claim, resolves COMPANY-SCOPED
 *      attachments (never leaks one company's private asset to another),
 *      sends via Resend, logs homeowner_sends + claim_events.
 *   4. Advances the cursor (last_sent_offset_days) and recomputes
 *      next_send_at = started_at + (next remaining offset) days, or marks
 *      the sequence complete when no steps remain.
 *
 * Idempotency: progress is a monotonic integer cursor
 * (last_sent_offset_days). We only ever send offsets strictly greater than
 * the cursor and advance it in the same update, so a double-run never
 * re-sends a step. We also skip if a homeowner_sends row for this
 * (claim_id, template_slug) already exists (belt-and-suspenders).
 */

const CRON_NAME = "homeowner-sequences";
const EXPECTED_INTERVAL_MINUTES = 1440; // daily

interface SequenceRow {
  claim_id: string;
  status: string;
  started_at: string | null;
  next_send_at: string | null;
  last_sent_offset_days: number | null;
}

interface TemplateRow {
  slug: string;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  default_attachments: string[] | null;
  trigger_offset_days: number | null;
  company_id: string | null;
}

interface ClaimRow {
  id: string;
  homeowner_name: string | null;
  homeowner_email: string | null;
  address: string | null;
  claim_number: string | null;
  carrier: string | null;
  company_id: string | null;
  user_id: string | null;
  homeowner_comms_count: number | null;
}

function authorize(req: NextRequest): boolean {
  // Fail closed: this route SENDS email to homeowners, so it must never run
  // unauthenticated. We require CRON_SECRET to be configured AND presented as
  // a Bearer token. We deliberately do NOT trust the `vercel-cron` user-agent
  // or the x-vercel-cron header when the secret is unset — both are spoofable
  // by any caller, and an unset secret must mean "deny", not "allow anyone".
  // Vercel Cron is configured to send `Authorization: Bearer ${CRON_SECRET}`.
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Load every GLOBAL time-step template once, sorted ascending by offset.
 * These are the canonical sequence steps (company_id IS NULL). We read the
 * table rather than hardcoding the 9 offsets so the cron tracks whatever
 * is actually active.
 */
async function loadTimeSteps(): Promise<TemplateRow[]> {
  const { data, error } = await supabaseAdmin
    .from("email_templates")
    .select("slug, subject, body_html, body_text, default_attachments, trigger_offset_days, company_id")
    .eq("trigger_type", "time")
    .eq("active", true)
    .is("company_id", null)
    .not("trigger_offset_days", "is", null)
    .order("trigger_offset_days", { ascending: true });
  if (error) {
    console.error("[homeowner-sequences] template load failed:", error.message);
    return [];
  }
  return (data || []) as TemplateRow[];
}

/**
 * For a given slug, prefer the company override template if one exists,
 * else the global. Returns the company-specific row's subject/body so a
 * company can customize copy without us re-sending steps.
 */
async function resolveTemplateForCompany(
  global: TemplateRow,
  companyId: string | null,
): Promise<TemplateRow> {
  if (!companyId) return global;
  const { data } = await supabaseAdmin
    .from("email_templates")
    .select("slug, subject, body_html, body_text, default_attachments, trigger_offset_days, company_id")
    .eq("slug", global.slug)
    .eq("company_id", companyId)
    .eq("active", true)
    .limit(1);
  const override = (data?.[0] as TemplateRow | undefined) ?? undefined;
  if (!override) return global;
  // Keep the canonical offset from the global step (the schedule axis), but
  // use the company's copy + its own default_attachments.
  return { ...override, trigger_offset_days: global.trigger_offset_days };
}

function daysSince(startedAtIso: string, now: number): number {
  const started = Date.parse(startedAtIso);
  if (!Number.isFinite(started)) return 0;
  return (now - started) / 86_400_000;
}

/** ISO timestamp for started_at + offsetDays days. */
function scheduledAt(startedAtIso: string, offsetDays: number): string {
  return new Date(Date.parse(startedAtIso) + offsetDays * 86_400_000).toISOString();
}

interface CompanySender {
  /** Resend `from` — company display name on the verified dumbroof.ai address. */
  from: string;
  /** Resend `replyTo` — the company's own sending address so replies route to them. */
  replyTo: string;
}

/**
 * Resolve the per-tenant sender identity for a claim's homeowner email.
 *
 * Resend only sends from VERIFIED domains (dumbroof.ai), so we cannot send
 * `from` a company's own domain. Instead we put the company's DISPLAY NAME on
 * the verified claims@dumbroof.ai address and route replies to the company's
 * own sending address. The homeowner sees their contractor's name; replies go
 * to the contractor.
 *
 * Mapping: company_profiles is keyed by user_id (one row per user), and the
 * backend resolves a claim's sending profile via claim.user_id
 * (claim_brain_email.py send_claim_email -> company_profiles.eq(user_id)). We
 * mirror that: the claim's OWNING user's profile carries company_name +
 * sending_email. claims.company_id is the team-grouping key, not a
 * company_profiles primary key, so we key off user_id like the rest of the code.
 *
 * Falls back to the platform "Dumb Roof Claims" identity when no company_name
 * resolves (e.g. claim has no user_id, or profile row missing).
 */
async function resolveCompanySender(claim: ClaimRow): Promise<CompanySender> {
  const fallback: CompanySender = { from: EMAIL_FROM_CLAIMS, replyTo: EMAIL_REPLY_TO };
  if (!claim.user_id) return fallback;
  try {
    const { data } = await supabaseAdmin
      .from("company_profiles")
      .select("company_name, sending_email, email")
      .eq("user_id", claim.user_id)
      .limit(1);
    const profile = data?.[0] as
      | { company_name: string | null; sending_email: string | null; email: string | null }
      | undefined;
    const companyName = (profile?.company_name || "").trim();
    if (!companyName) return fallback;
    const replyTo = (profile?.sending_email || profile?.email || "").trim() || EMAIL_REPLY_TO;
    return { from: `${companyName} <claims@dumbroof.ai>`, replyTo };
  } catch (e) {
    console.warn(`[homeowner-sequences] sender resolution failed for claim ${claim.id}:`, e);
    return fallback;
  }
}

/**
 * True when a Supabase/PostgREST error is a unique-constraint violation
 * (Postgres 23505). Used to swallow the homeowner_sends idempotency index
 * collision as "already sent" rather than treating it as a hard failure.
 */
function isUniqueViolation(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  if (err.code === "23505") return true;
  return (err.message || "").toLowerCase().includes("duplicate key value");
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAtMs = Date.now();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const results = { processed: 0, sent: 0, completed: 0, skipped: 0, errors: 0 };

  // ---- Pull due active sequences -------------------------------------------
  const { data: dueRows, error: dueErr } = await supabaseAdmin
    .from("homeowner_sequences")
    .select("claim_id, status, started_at, next_send_at, last_sent_offset_days")
    .eq("status", "active")
    .lte("next_send_at", nowIso)
    .limit(100);

  if (dueErr) {
    await recordHeartbeat(CRON_NAME, EXPECTED_INTERVAL_MINUTES, "error", `due query: ${dueErr.message}`, Date.now() - startedAtMs);
    return NextResponse.json({ error: dueErr.message }, { status: 500 });
  }

  const sequences = (dueRows || []) as SequenceRow[];
  if (sequences.length === 0) {
    await recordHeartbeat(CRON_NAME, EXPECTED_INTERVAL_MINUTES, "ok", "no sequences due", Date.now() - startedAtMs);
    return NextResponse.json({ ok: true, ...results });
  }

  const steps = await loadTimeSteps();
  if (steps.length === 0) {
    await recordHeartbeat(CRON_NAME, EXPECTED_INTERVAL_MINUTES, "error", "no active time-step templates", Date.now() - startedAtMs);
    return NextResponse.json({ error: "No active time-step templates" }, { status: 500 });
  }

  const resend = getResend();

  for (const seq of sequences) {
    results.processed++;
    try {
      if (!seq.started_at) {
        // Malformed row — can't compute schedule. Park it (clear next_send_at).
        await supabaseAdmin
          .from("homeowner_sequences")
          .update({ next_send_at: null })
          .eq("claim_id", seq.claim_id);
        results.skipped++;
        continue;
      }

      const cursor = seq.last_sent_offset_days; // null = nothing sent yet
      const elapsedDays = daysSince(seq.started_at, now);

      // Candidate steps: offset strictly greater than cursor (or all, if null).
      const remaining = steps.filter((s) => {
        const off = s.trigger_offset_days ?? 0;
        return cursor == null ? true : off > cursor;
      });

      if (remaining.length === 0) {
        // Nothing left — complete the sequence.
        await supabaseAdmin
          .from("homeowner_sequences")
          .update({ status: "complete", completed_at: nowIso, next_send_at: null })
          .eq("claim_id", seq.claim_id);
        await logClaimEvent(seq.claim_id, "sequence_completed", {
          source: "cron",
          metadata: { reason: "all_steps_sent" },
        });
        results.completed++;
        continue;
      }

      // Next due step = smallest remaining offset whose scheduled time has passed.
      const dueStep = remaining.find((s) => (s.trigger_offset_days ?? 0) <= elapsedDays);

      if (!dueStep) {
        // Earliest remaining step isn't due yet — reschedule next_send_at to it.
        const next = remaining[0];
        await supabaseAdmin
          .from("homeowner_sequences")
          .update({ next_send_at: scheduledAt(seq.started_at, next.trigger_offset_days ?? 0) })
          .eq("claim_id", seq.claim_id);
        results.skipped++;
        continue;
      }

      const dueOffset = dueStep.trigger_offset_days ?? 0;

      // Load the claim for personalization + recipient + company scope.
      const { data: claimRows } = await supabaseAdmin
        .from("claims")
        .select("id, homeowner_name, homeowner_email, address, claim_number, carrier, company_id, user_id, homeowner_comms_count")
        .eq("id", seq.claim_id)
        .limit(1);
      const claim = claimRows?.[0] as ClaimRow | undefined;

      if (!claim) {
        // Claim vanished — complete the orphan sequence so we stop selecting it.
        await supabaseAdmin
          .from("homeowner_sequences")
          .update({ status: "complete", completed_at: nowIso, next_send_at: null, pause_reason: "claim_not_found" })
          .eq("claim_id", seq.claim_id);
        results.skipped++;
        continue;
      }

      if (!claim.homeowner_email) {
        // No recipient — pause rather than churn every run. A rep adding the
        // email + resuming will pick the sequence back up.
        await supabaseAdmin
          .from("homeowner_sequences")
          .update({ status: "paused", pause_reason: "missing_homeowner_email", next_send_at: null })
          .eq("claim_id", seq.claim_id);
        await logClaimEvent(seq.claim_id, "sequence_paused", {
          source: "cron",
          metadata: { reason: "missing_homeowner_email" },
        });
        results.skipped++;
        continue;
      }

      // Authoritative idempotency check: skip if this exact step was already
      // sent SUCCESSFULLY. Scope to error_message IS NULL so a prior FAILED send
      // (error_message set, slot freed under the partial unique index) does NOT
      // block a retry — only a clean prior send advances the cursor here.
      const { data: priorSends } = await supabaseAdmin
        .from("homeowner_sends")
        .select("id")
        .eq("claim_id", seq.claim_id)
        .eq("template_slug", dueStep.slug)
        .is("error_message", null)
        .limit(1);
      if (priorSends && priorSends.length > 0) {
        // Already sent (cursor must have lagged). Advance cursor + reschedule.
        await advanceCursor(seq, dueOffset, steps);
        results.skipped++;
        continue;
      }

      // Resolve company override copy (if any) + render placeholders.
      const tmpl = await resolveTemplateForCompany(dueStep, claim.company_id);
      const { subject, html } = renderHomeownerEmail(tmpl, claim);

      // Company-scoped attachments (never leak cross-company).
      const { attachments, assetSlugs } = await resolveCompanyAttachments(
        tmpl.slug,
        (tmpl.default_attachments as string[] | null) || [],
        claim.company_id,
      );

      // ---- Reserve the send slot BEFORE calling Resend (idempotency) --------
      // Insert the homeowner_sends row first. The partial unique index
      // homeowner_sends_claim_template_uniq (claim_id, template_slug) WHERE
      // error_message IS NULL makes a duplicate clean send physically
      // impossible. If two cron runs race past the SELECT-then-act check above,
      // the loser hits the constraint here and we treat it as "already sent":
      // advance the cursor and move on, never double-sending.
      const { data: reserved, error: reserveErr } = await supabaseAdmin
        .from("homeowner_sends")
        .insert({
          claim_id: seq.claim_id,
          template_slug: dueStep.slug,
          to_email: claim.homeowner_email,
          subject,
          body_preview: (tmpl.body_text || "").slice(0, 500),
          attachments: assetSlugs,
          sent_by: null, // cron
          resend_email_id: null,
          metadata: { offset_days: dueOffset, source: "cron" },
        })
        .select("id")
        .limit(1);

      if (reserveErr) {
        if (isUniqueViolation(reserveErr)) {
          // Another run already sent this step. Advance + reschedule, don't resend.
          await advanceCursor(seq, dueOffset, steps);
          results.skipped++;
          continue;
        }
        console.error(
          `[homeowner-sequences] reserve insert failed for claim ${seq.claim_id} step ${dueStep.slug}:`,
          reserveErr.message,
        );
        results.errors++;
        continue;
      }

      const sendRowId = (reserved?.[0]?.id as string | undefined) ?? null;

      // Per-tenant sender identity: company display name on the verified
      // dumbroof.ai address; replies route to the company's own address.
      const sender = await resolveCompanySender(claim);

      // BCC the SENDING company's owner (founding owner of the claim's company),
      // keyed off the claim's owning user — never off the recipient's email
      // domain. Owner is BCC only (never leak internal addresses to the
      // homeowner). Mirrors send-now. No DumbRoof team BCC (send-now omits it).
      const ownerBcc = await companyOwnerEmails(claim.user_id ?? "");
      const bcc = mergeBcc(undefined, ownerBcc, claim.homeowner_email);

      const { data: sent, error: sendErr } = await resend.emails.send({
        from: sender.from,
        to: [claim.homeowner_email],
        bcc: bcc.length > 0 ? bcc : undefined,
        replyTo: sender.replyTo,
        subject,
        html,
        attachments: attachments.length > 0 ? attachments : undefined,
        tags: [
          { name: "type", value: "homeowner_sequence" },
          { name: "step", value: dueStep.slug },
        ],
      });

      if (sendErr) {
        // Send failed. Mark the reserved row with an error so it no longer holds
        // the unique slot (the index is WHERE error_message IS NULL), letting the
        // step retry next run. Do NOT advance the cursor.
        if (sendRowId) {
          await supabaseAdmin
            .from("homeowner_sends")
            .update({ error_message: sendErr.message })
            .eq("id", sendRowId);
        }
        results.errors++;
        continue;
      }

      const resendId = sent?.id || null;

      // Send succeeded — attach the Resend id to the reserved row.
      if (sendRowId) {
        await supabaseAdmin
          .from("homeowner_sends")
          .update({ resend_email_id: resendId })
          .eq("id", sendRowId);
      }

      // Bump the per-claim comms counter.
      await supabaseAdmin
        .from("claims")
        .update({ homeowner_comms_count: (claim.homeowner_comms_count || 0) + 1 })
        .eq("id", seq.claim_id);

      // Timeline event.
      await logClaimEvent(seq.claim_id, "homeowner_email_sent", {
        source: "cron",
        title: `Sent "${subject}" to homeowner`,
        metadata: {
          template_slug: dueStep.slug,
          to: claim.homeowner_email,
          resend_id: resendId,
          attachment_count: assetSlugs.length,
          offset_days: dueOffset,
          via: "sequence_cron",
        },
      });

      // Advance the cursor + schedule the next step (or complete).
      await advanceCursor(seq, dueOffset, steps, { slug: dueStep.slug });

      results.sent++;
    } catch (e) {
      console.error(`[homeowner-sequences] exception on claim ${seq.claim_id}:`, e);
      results.errors++;
    }
  }

  const elapsedMs = Date.now() - startedAtMs;
  await recordHeartbeat(
    CRON_NAME,
    EXPECTED_INTERVAL_MINUTES,
    results.errors > 0 && results.sent === 0 ? "error" : "ok",
    `processed=${results.processed} sent=${results.sent} completed=${results.completed} skipped=${results.skipped} errors=${results.errors}`,
    elapsedMs,
  );

  return NextResponse.json({ ok: true, elapsed_ms: elapsedMs, ...results });
}

export async function POST(req: NextRequest) {
  return GET(req);
}

/**
 * Move the progress cursor to `sentOffset` and set next_send_at to the next
 * remaining step's scheduled time, or complete the sequence when none remain.
 * Updating the cursor in the same write that records the send guarantees a
 * double-run cannot re-send the step.
 */
async function advanceCursor(
  seq: SequenceRow,
  sentOffset: number,
  steps: TemplateRow[],
  display?: { slug: string },
): Promise<void> {
  const startedAt = seq.started_at!;
  const next = steps.find((s) => (s.trigger_offset_days ?? 0) > sentOffset);

  const patch: Record<string, unknown> = {
    last_sent_offset_days: sentOffset,
  };
  if (display) {
    patch.last_template_slug = display.slug;
    patch.last_sent_at = new Date().toISOString();
  }

  if (next) {
    patch.next_send_at = scheduledAt(startedAt, next.trigger_offset_days ?? 0);
  } else {
    patch.status = "complete";
    patch.completed_at = new Date().toISOString();
    patch.next_send_at = null;
  }

  await supabaseAdmin.from("homeowner_sequences").update(patch).eq("claim_id", seq.claim_id);

  if (!next) {
    await logClaimEvent(seq.claim_id, "sequence_completed", {
      source: "cron",
      metadata: { reason: "final_step_sent" },
    });
  }
}
