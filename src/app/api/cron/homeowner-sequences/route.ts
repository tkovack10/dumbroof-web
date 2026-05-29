import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend, EMAIL_FROM_CLAIMS, EMAIL_REPLY_TO, teamBccFor } from "@/lib/resend";
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
  const secret = process.env.CRON_SECRET?.trim();
  const vercelCronHeader = req.headers.get("x-vercel-cron");
  if (vercelCronHeader) return true;
  if (!secret) {
    // No secret configured — fall back to Vercel's cron user-agent.
    return req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  }
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

      // Belt-and-suspenders idempotency: skip if this exact step already sent.
      const { data: priorSends } = await supabaseAdmin
        .from("homeowner_sends")
        .select("id")
        .eq("claim_id", seq.claim_id)
        .eq("template_slug", dueStep.slug)
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

      // BCC the platform team (+ USARM mailbox when the recipient is USARM).
      const bcc = teamBccFor({ recipientEmail: claim.homeowner_email });

      const { data: sent, error: sendErr } = await resend.emails.send({
        from: EMAIL_FROM_CLAIMS,
        to: [claim.homeowner_email],
        bcc: bcc.length > 0 ? bcc : undefined,
        replyTo: EMAIL_REPLY_TO,
        subject,
        html,
        attachments: attachments.length > 0 ? attachments : undefined,
        tags: [
          { name: "type", value: "homeowner_sequence" },
          { name: "step", value: dueStep.slug },
        ],
      });

      if (sendErr) {
        // Record the failure on the send log; do NOT advance the cursor so the
        // step retries next run.
        await supabaseAdmin.from("homeowner_sends").insert({
          claim_id: seq.claim_id,
          template_slug: dueStep.slug,
          to_email: claim.homeowner_email,
          subject,
          body_preview: (tmpl.body_text || "").slice(0, 500),
          attachments: assetSlugs,
          sent_by: null, // cron
          resend_email_id: null,
          error_message: sendErr.message,
          metadata: { offset_days: dueOffset, source: "cron" },
        });
        results.errors++;
        continue;
      }

      const resendId = sent?.id || null;

      // Log the send.
      await supabaseAdmin.from("homeowner_sends").insert({
        claim_id: seq.claim_id,
        template_slug: dueStep.slug,
        to_email: claim.homeowner_email,
        subject,
        body_preview: (tmpl.body_text || "").slice(0, 500),
        attachments: assetSlugs,
        sent_by: null, // cron
        resend_email_id: resendId,
        metadata: { offset_days: dueOffset, source: "cron" },
      });

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
