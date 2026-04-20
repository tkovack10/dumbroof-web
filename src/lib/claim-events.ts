/**
 * Claim Events — event-sourced timeline helper (TypeScript twin of
 * backend/claim_events.py). Used from Next.js API routes.
 *
 * Writes to the `claim_events` table. Every meaningful claim state
 * transition or activity should log a row here so the timeline rail
 * and Richard stay in sync.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";

export type ClaimEventCategory =
  | "milestone"
  | "communication"
  | "document"
  | "action"
  | "system";

export type ClaimEventSource =
  | "user"
  | "system"
  | "homeowner_reply"
  | "carrier_email"
  | "processor"
  | "cron"
  | "backfill";

export interface ClaimEventMeta {
  category: ClaimEventCategory;
  title: string;
  icon: string;
}

/**
 * Event type registry — MUST stay in sync with backend/claim_events.py
 * CLAIM_EVENT_TYPES. When adding an event type, update both files.
 */
export const CLAIM_EVENT_TYPES: Record<string, ClaimEventMeta> = {
  // Milestones
  claim_opened:                { category: "milestone",     title: "Claim opened",                     icon: "home" },
  aob_signed:                  { category: "milestone",     title: "AOB signed",                       icon: "pen" },
  forensic_generated:          { category: "milestone",     title: "Forensic report generated",        icon: "file-search" },
  scope_received:              { category: "milestone",     title: "Carrier scope received",           icon: "inbox" },
  adjuster_meeting_scheduled:  { category: "milestone",     title: "Adjuster meeting scheduled",       icon: "calendar" },
  adjuster_meeting_completed:  { category: "milestone",     title: "Adjuster meeting completed",       icon: "check-circle" },
  supplement_sent:             { category: "milestone",     title: "Supplement sent",                  icon: "send" },
  supplement_approved:         { category: "milestone",     title: "Supplement approved",              icon: "award" },
  production_ready:            { category: "milestone",     title: "Ready to build",                   icon: "tool" },
  production_sent:             { category: "milestone",     title: "Sent to production",               icon: "truck" },
  install_scheduled:           { category: "milestone",     title: "Install scheduled",                icon: "calendar" },
  install_complete:            { category: "milestone",     title: "Install complete",                 icon: "check-square" },
  install_supplement_sent:     { category: "milestone",     title: "Install supplement sent",          icon: "send" },
  coc_sent:                    { category: "milestone",     title: "Certificate of completion sent",   icon: "award" },
  payment_received:            { category: "milestone",     title: "Payment received",                 icon: "dollar-sign" },
  closed:                      { category: "milestone",     title: "Claim closed",                     icon: "archive" },
  win_detected:                { category: "milestone",     title: "Win detected",                     icon: "trending-up" },

  // Communications
  homeowner_email_sent:        { category: "communication", title: "Email sent to homeowner",          icon: "mail" },
  homeowner_email_opened:      { category: "communication", title: "Homeowner opened email",           icon: "eye" },
  homeowner_email_replied:     { category: "communication", title: "Homeowner replied",                icon: "reply" },
  homeowner_email_bounced:     { category: "communication", title: "Homeowner email bounced",          icon: "alert-triangle" },
  carrier_email_received:      { category: "communication", title: "Carrier email received",           icon: "inbox" },
  carrier_email_sent:          { category: "communication", title: "Email sent to carrier",            icon: "send" },
  sms_sent:                    { category: "communication", title: "SMS sent",                         icon: "message-square" },

  // Documents
  forensic_pdf_generated:      { category: "document",      title: "Forensic PDF generated",           icon: "file-text" },
  estimate_pdf_generated:      { category: "document",      title: "Estimate PDF generated",           icon: "file-text" },
  supplement_pdf_generated:    { category: "document",      title: "Supplement PDF generated",         icon: "file-text" },
  production_pdf_generated:    { category: "document",      title: "Production packet generated",      icon: "file-text" },
  scope_uploaded:              { category: "document",      title: "Scope uploaded",                   icon: "upload" },
  photo_uploaded:              { category: "document",      title: "Photo uploaded",                   icon: "image" },
  photos_batch_uploaded:       { category: "document",      title: "Photos uploaded",                  icon: "images" },

  // Actions
  rep_assigned:                { category: "action",        title: "Rep assigned",                     icon: "user" },
  colors_selected:             { category: "action",        title: "Colors selected",                  icon: "palette" },
  note_added:                  { category: "action",        title: "Note added",                       icon: "edit" },
  override_applied:            { category: "action",        title: "Validation override applied",      icon: "alert-octagon" },
  teammate_invited:            { category: "action",        title: "Teammate invited",                 icon: "user-plus" },
  teammate_joined:             { category: "action",        title: "Teammate joined",                  icon: "users" },
  crm_pushed:                  { category: "action",        title: "Pushed to CRM",                    icon: "share" },
  contact_updated:             { category: "action",        title: "Contact info updated",             icon: "edit-3" },
  sequence_started:            { category: "action",        title: "Homeowner comms started",          icon: "play" },
  sequence_paused:             { category: "action",        title: "Homeowner comms paused",           icon: "pause" },
  sequence_resumed:            { category: "action",        title: "Homeowner comms resumed",          icon: "play" },
  sequence_completed:          { category: "action",        title: "Homeowner comms completed",        icon: "check" },

  // System
  ai_analysis_complete:        { category: "system",        title: "AI analysis complete",             icon: "cpu" },
  gmail_poll_match:            { category: "system",        title: "Gmail poll matched",               icon: "mail" },
  stripe_event:                { category: "system",        title: "Stripe event",                     icon: "credit-card" },
  referral_rewarded:           { category: "system",        title: "Referral reward applied",          icon: "gift" },
};

function getEventMeta(eventType: string): ClaimEventMeta {
  return (
    CLAIM_EVENT_TYPES[eventType] ?? {
      category: "action",
      title: eventType.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
      icon: "activity",
    }
  );
}

export interface LogClaimEventOptions {
  source?: ClaimEventSource;
  title?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date | string;
  createdBy?: string;
}

/**
 * Insert one event into `claim_events`. Idempotent via the unique
 * constraint on (claim_id, event_type, occurred_at) — duplicate
 * inserts silently no-op.
 *
 * Returns the inserted row's id, or null on conflict/error.
 */
export async function logClaimEvent(
  claimId: string,
  eventType: string,
  opts: LogClaimEventOptions = {}
): Promise<string | null> {
  if (!claimId || !eventType) return null;

  const meta = getEventMeta(eventType);
  const occurredAt =
    opts.occurredAt instanceof Date
      ? opts.occurredAt.toISOString()
      : opts.occurredAt ?? new Date().toISOString();

  const row: Record<string, unknown> = {
    claim_id: claimId,
    event_type: eventType,
    event_category: meta.category,
    title: opts.title ?? meta.title,
    description: opts.description ?? null,
    metadata: opts.metadata ?? {},
    occurred_at: occurredAt,
    source: opts.source ?? "system",
  };
  if (opts.createdBy) row.created_by = opts.createdBy;

  const { data, error } = await supabaseAdmin
    .from("claim_events")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (error) {
    const msg = error.message?.toLowerCase() ?? "";
    if (msg.includes("duplicate key") || msg.includes("unique constraint")) {
      // Idempotent conflict — not an error.
      return null;
    }
    console.warn("[logClaimEvent] failed", { claimId, eventType, error });
    return null;
  }
  return (data?.id as string) ?? null;
}

/**
 * Read the timeline for a claim (reverse chronological).
 */
export async function getClaimTimeline(
  claimId: string,
  opts: { limit?: number; categoryFilter?: ClaimEventCategory } = {}
) {
  const { limit = 50, categoryFilter } = opts;
  let q = supabaseAdmin
    .from("claim_events")
    .select(
      "id,event_type,event_category,title,description,metadata,occurred_at,source,created_by"
    )
    .eq("claim_id", claimId)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (categoryFilter) q = q.eq("event_category", categoryFilter);

  const { data, error } = await q;
  if (error) {
    console.warn("[getClaimTimeline] failed", { claimId, error });
    return [];
  }
  return data ?? [];
}
