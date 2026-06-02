import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * GET /api/admin/production/unlinked-installs
 *
 * AccuLynx company-calendar install events that did NOT match a DumbRoof claim
 * (matched_claim_id is null). These render in the "Unlinked installs" panel on
 * /dashboard/production so an admin can link each to a claim in one click.
 */
export async function GET() {
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

  const { data, error } = await supabaseAdmin
    .from("acculynx_calendar_events")
    .select("id, acculynx_event_id, title, location, calendar_name, job_name, starts_at, ends_at, all_day")
    .eq("company_id", profile.company_id)
    .eq("is_production", true)
    .is("matched_claim_id", null)
    .order("starts_at", { ascending: true })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ events: data || [] });
}
