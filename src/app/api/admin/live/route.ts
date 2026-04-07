import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/** Safe wrapper for Supabase calls that may fail */
async function safe<T>(fn: () => PromiseLike<{ data: T | null }>, fallback: T): Promise<T> {
  try {
    const { data } = await fn();
    return data ?? fallback;
  } catch {
    return fallback;
  }
}

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  // Verify admin
  const { data: profile } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin")
    .eq("user_id", auth.user.id)
    .limit(1);

  if (!profile?.[0]?.is_admin) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const dayAgo = new Date(Date.now() - 86400000).toISOString();

  // Run all queries in parallel
  const [
    totalUsers,
    signupsToday,
    signups7d,
    claimsTodayRes,
    claims7dRes,
    claimsAllRes,
    activeUsers24hRes,
    recentSignups,
    recentClaimsRes,
    subscriptionsRes,
    aobTodayRes,
  ] = await Promise.all([
    safe(() => supabaseAdmin.rpc("get_user_count"), 0),
    safe(() => supabaseAdmin.rpc("exec_sql_ro", {
      query: "SELECT count(*)::int as c FROM auth.users WHERE created_at >= date_trunc('day', now())"
    }), [{ c: 0 }] as { c: number }[]),
    safe(() => supabaseAdmin.rpc("exec_sql_ro", {
      query: "SELECT count(*)::int as c FROM auth.users WHERE created_at >= now() - interval '7 days'"
    }), [{ c: 0 }] as { c: number }[]),
    supabaseAdmin.from("claims").select("*", { count: "exact", head: true }).gte("created_at", todayStart),
    supabaseAdmin.from("claims").select("*", { count: "exact", head: true }).gte("created_at", weekAgo),
    supabaseAdmin.from("claims").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("claims").select("user_id", { count: "exact", head: true }).gte("created_at", dayAgo),
    safe(() => supabaseAdmin.rpc("exec_sql_ro", {
      query: `SELECT email, created_at AT TIME ZONE 'America/New_York' as ts FROM auth.users ORDER BY created_at DESC LIMIT 2000`
    }), [] as { email: string; ts: string }[]),
    supabaseAdmin.from("claims").select("id, address, user_id, status, created_at")
      .order("created_at", { ascending: false }).limit(10),
    supabaseAdmin.from("subscriptions").select("plan_id, status"),
    supabaseAdmin.from("aob_signatures").select("*", { count: "exact", head: true }).gte("created_at", todayStart),
  ]);

  // Count plans — users without a subscription row are on starter (free)
  const planCounts: Record<string, number> = {};
  let paidCount = 0;
  for (const s of (subscriptionsRes.data || []) as { plan_id: string; status: string }[]) {
    if (s.status === "active") {
      planCounts[s.plan_id] = (planCounts[s.plan_id] || 0) + 1;
      paidCount++;
    }
  }
  // Everyone without a subscription row is on starter
  const total = totalUsers as number;
  planCounts["starter"] = Math.max(0, total - paidCount);

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    users: {
      total: totalUsers as number,
      today: (signupsToday as { c: number }[])?.[0]?.c ?? 0,
      last7d: (signups7d as { c: number }[])?.[0]?.c ?? 0,
      recent: recentSignups as { email: string; ts: string }[],
    },
    claims: {
      total: claimsAllRes.count ?? 0,
      today: claimsTodayRes.count ?? 0,
      last7d: claims7dRes.count ?? 0,
      activeUsers24h: activeUsers24hRes.count ?? 0,
      recent: recentClaimsRes.data ?? [],
    },
    billing: {
      planCounts,
      totalSubscriptions: (subscriptionsRes.data || []).length,
    },
    aob: {
      today: aobTodayRes.count ?? 0,
    },
  });
}
