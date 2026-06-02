import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/admin/production/unlinked-installs/{id}/link
 * Body: { claim_id }
 *
 * Manually link an unmatched AccuLynx calendar event to a claim: sets
 * matched_claim_id (match_method='manual') and, if the event has a date,
 * creates the production_schedules row so it lands on the calendar.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: profile } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, company_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.is_admin || !profile.company_id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const companyId = profile.company_id as string;

  const body = await request.json().catch(() => ({}));
  const claimId = body.claim_id as string | undefined;
  if (!claimId) return NextResponse.json({ error: "claim_id is required" }, { status: 400 });

  // Event must belong to this company.
  const { data: ev } = await supabaseAdmin
    .from("acculynx_calendar_events")
    .select("id, acculynx_event_id, starts_at, ends_at, title, job_name")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  // Claim must belong to this company.
  const { data: claim } = await supabaseAdmin
    .from("claims")
    .select("id, company_id")
    .eq("id", claimId)
    .maybeSingle();
  if (!claim || claim.company_id !== companyId) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  // Create the schedule if the event has a date and one doesn't already exist.
  let scheduleId: string | null = null;
  if (ev.starts_at) {
    const { data: existing } = await supabaseAdmin
      .from("production_schedules")
      .select("id")
      .eq("company_id", companyId)
      .eq("acculynx_event_id", ev.acculynx_event_id)
      .maybeSingle();
    if (existing) {
      scheduleId = existing.id;
    } else {
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("production_schedules")
        .insert({
          claim_id: claimId,
          company_id: companyId,
          scheduled_at: ev.starts_at,
          end_at: ev.ends_at ?? null,
          origin: "acculynx",
          acculynx_event_id: ev.acculynx_event_id,
          notify_homeowner: false,
          notes: ev.title || ev.job_name || null,
          created_by: user.id,
        })
        .select("id")
        .maybeSingle();
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
      scheduleId = inserted?.id ?? null;
    }
  }

  const { error: updErr } = await supabaseAdmin
    .from("acculynx_calendar_events")
    .update({
      matched_claim_id: claimId,
      match_method: "manual",
      production_schedule_id: scheduleId,
    })
    .eq("id", id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, schedule_id: scheduleId });
}
