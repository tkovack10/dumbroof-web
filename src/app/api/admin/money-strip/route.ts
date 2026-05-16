import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * GET /api/admin/money-strip
 * Returns the rolled-up numbers the sidebar/banner Money Strip displays:
 *   - today's check count + total $
 *   - pending commission count + total $
 *   - 5 most recent checks (for hover/click drawer in a later iteration)
 *
 * Auth: admin (is_admin = true) on the caller's company_profiles row.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, company_id")
    .eq("user_id", user.id)
    .limit(1);

  if (!profileRows?.[0]?.is_admin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const companyId = profileRows[0].company_id;
  if (!companyId) {
    return NextResponse.json({
      todayCount: 0,
      todayCents: 0,
      pendingCommissionCount: 0,
      pendingCommissionCents: 0,
      recent: [],
    });
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startIso = startOfToday.toISOString();

  const [todayChecksRes, pendingCommRes, recentRes] = await Promise.all([
    supabaseAdmin
      .from("check_uploads")
      .select("amount_cents")
      .eq("company_id", companyId)
      .gte("received_at", startIso),
    supabaseAdmin
      .from("commission_requests")
      .select("amount_cents")
      .eq("company_id", companyId)
      .eq("status", "pending"),
    supabaseAdmin
      .from("check_uploads")
      .select("id, amount_cents, payor, source, received_at, claim_id")
      .eq("company_id", companyId)
      .order("received_at", { ascending: false })
      .limit(5),
  ]);

  const todayCount = todayChecksRes.data?.length ?? 0;
  const todayCents = (todayChecksRes.data ?? []).reduce(
    (sum, r) => sum + (r.amount_cents ?? 0),
    0
  );
  const pendingCommissionCount = pendingCommRes.data?.length ?? 0;
  const pendingCommissionCents = (pendingCommRes.data ?? []).reduce(
    (sum, r) => sum + (r.amount_cents ?? 0),
    0
  );

  return NextResponse.json({
    todayCount,
    todayCents,
    pendingCommissionCount,
    pendingCommissionCents,
    recent: recentRes.data ?? [],
  });
}
