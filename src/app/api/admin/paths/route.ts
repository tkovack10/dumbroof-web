import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getVisitorPaths } from "@/lib/analytics/ga4-paths";

// GET /api/admin/paths — live funnel monitor data: GA4 visitor paths (realtime +
// 7d) fused with the DB activation funnel (signups → activated → paid) and the
// conversion at each leak. Admin only. Read-only.
export const dynamic = "force-dynamic";

export async function GET() {
  // Admin gate.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data: me } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin")
    .eq("user_id", user.id)
    .single();
  if (!me?.is_admin) return NextResponse.json({ error: "admin only" }, { status: 403 });

  const SEVEN_DAYS = Date.now() - 7 * 86400_000;

  const [ga, profilesRes, claimsRes, subsRes] = await Promise.all([
    getVisitorPaths(),
    supabaseAdmin.from("company_profiles").select("user_id,is_usarm,created_at"),
    supabaseAdmin.from("claims").select("user_id"),
    supabaseAdmin.from("subscriptions").select("plan_id,status"),
  ]);

  // Real external signups (exclude USARM internal).
  const profiles = (profilesRes.data || []).filter((p) => !p.is_usarm);
  const realIds = new Set(profiles.map((p) => p.user_id));
  const signupsAll = profiles.length;
  const signups7d = profiles.filter((p) => p.created_at && new Date(p.created_at).getTime() > SEVEN_DAYS).length;

  // Activated = real signups with >=1 claim (all-time; 7d cohort is too small to be stable).
  const activatedAll = new Set(
    (claimsRes.data || []).map((c) => c.user_id).filter((u) => u && realIds.has(u))
  ).size;

  const paidAll = (subsRes.data || []).filter(
    (s) => s.status === "active" && !["starter", "free", null, ""].includes(s.plan_id)
  ).length;

  const adClicks7d = ga.fbWhoopsUsers7d;
  const pct = (a: number, b: number) => (b > 0 ? a / b : null);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    gaConnected: ga.ok,
    activeNow: ga.activeNow,
    realtime: ga.realtime,
    topPaths: ga.topPaths,
    landingPages: ga.landingPages,
    funnel: {
      adClicks7d, // GA4: users on /fb/* ad landing, last 7d
      signups7d,
      signupsAll,
      activatedAll,
      paidAll,
      convAdToSignup: pct(signups7d, adClicks7d), // 7d vs 7d
      convSignupToActivated: pct(activatedAll, signupsAll), // all-time
      convActivatedToPaid: pct(paidAll, activatedAll), // all-time
    },
  });
}
