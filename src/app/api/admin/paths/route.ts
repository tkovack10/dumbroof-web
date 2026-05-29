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
    supabaseAdmin.from("claims").select("user_id,status,output_files"),
    supabaseAdmin.from("subscriptions").select("plan_id,status"),
  ]);

  // Real external signups (exclude USARM internal).
  const profiles = (profilesRes.data || []).filter((p) => !p.is_usarm);
  const realIds = new Set(profiles.map((p) => p.user_id));
  const signupsAll = profiles.length;
  const signups7d = profiles.filter((p) => p.created_at && new Date(p.created_at).getTime() > SEVEN_DAYS).length;

  // Real-signup claim rows only (exclude USARM internal). Reused by both metrics below.
  const realClaims = (claimsRes.data || []).filter((c) => c.user_id && realIds.has(c.user_id));

  // Created = real signups with >=1 claim ROW, regardless of status (all-time;
  // 7d cohort is too small to be stable). A claim stuck in processing/error/
  // quota_blocked still counts here — this is the "they tried" metric.
  const createdAll = new Set(realClaims.map((c) => c.user_id)).size;

  // Reached-ready = real signups with >=1 claim that actually FINISHED:
  // status='ready' AND a non-empty output PDF array. This is the true
  // signup→first-successful-claim activation metric (created can over-count
  // when claims stall before producing deliverables).
  const reachedReadyAll = new Set(
    realClaims
      .filter((c) => c.status === "ready" && Array.isArray(c.output_files) && c.output_files.length > 0)
      .map((c) => c.user_id)
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
      createdAll, // real signups with >=1 claim row, ANY status
      reachedReadyAll, // real signups with >=1 status='ready' claim that has output PDFs
      paidAll,
      convAdToSignup: pct(signups7d, adClicks7d), // 7d vs 7d
      convSignupToCreated: pct(createdAll, signupsAll), // all-time: signup → created any claim
      convCreatedToReachedReady: pct(reachedReadyAll, createdAll), // all-time: created → finished a claim (the activation drop-off)
      convReachedReadyToPaid: pct(paidAll, reachedReadyAll), // all-time
    },
  });
}
