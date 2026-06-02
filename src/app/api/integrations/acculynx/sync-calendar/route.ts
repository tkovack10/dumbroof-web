/**
 * POST /api/integrations/acculynx/sync-calendar
 *
 * Admin-triggered, company-scoped AccuLynx calendar sync (the "Sync now" button
 * on the Production page). Pulls the caller's company's AccuLynx company-calendar
 * install events into DumbRoof. Same engine as the daily cron.
 *
 * company_id + the AccuLynx key are resolved server-side from the caller's
 * profile — never trusted from the request body.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { syncCompanyCalendar } from "@/lib/acculynx/calendar-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { user } = auth;

  const { data: profile } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, company_id, acculynx_api_key")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile?.is_admin || !profile.company_id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (!profile.acculynx_api_key) {
    return NextResponse.json(
      { error: "AccuLynx is not connected for this company." },
      { status: 400 }
    );
  }

  try {
    const result = await syncCompanyCalendar(
      supabaseAdmin,
      profile.company_id as string,
      profile.acculynx_api_key as string
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
