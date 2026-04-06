import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SupabaseSection, SignupRow, ClaimRow, Anomaly } from "../types";

/**
 * Funnel Monitor — Supabase data source.
 * Pulls signups, uploads, retention, and active users since the last cron run.
 */
export async function gatherSupabase(
  windowStart: string,
  windowEnd: string,
  anomalies: Anomaly[]
): Promise<SupabaseSection> {
  // New signups in window
  const { data: newUsers } = await supabaseAdmin
    .schema("auth")
    .from("users")
    .select("id, email, created_at, last_sign_in_at, raw_user_meta_data, raw_app_meta_data")
    .gte("created_at", windowStart)
    .lt("created_at", windowEnd)
    .order("created_at", { ascending: false });

  const signups: SignupRow[] = (newUsers || []).map((u: Record<string, unknown>) => {
    const meta = (u.raw_user_meta_data || {}) as Record<string, unknown>;
    const appMeta = (u.raw_app_meta_data || {}) as Record<string, unknown>;
    return {
      email: (u.email as string) || "unknown",
      created_at: u.created_at as string,
      provider: ((appMeta.provider as string) || "email"),
      signup_source: (meta.signup_source as string) || null,
      ip: null,
      user_agent: null,
    };
  });

  // New claims in window — joined with auth.users for the email
  const { data: newClaims } = await supabaseAdmin
    .from("claims")
    .select("slug, user_id, contractor_rcv, status, created_at")
    .gte("created_at", windowStart)
    .lt("created_at", windowEnd)
    .order("created_at", { ascending: false });

  const userIds = Array.from(new Set((newClaims || []).map((c) => c.user_id).filter(Boolean)));
  const userEmailMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .schema("auth")
      .from("users")
      .select("id, email")
      .in("id", userIds);
    for (const u of users || []) {
      userEmailMap.set(u.id as string, (u.email as string) || "unknown");
    }
  }

  const claimRows: ClaimRow[] = (newClaims || []).map((c) => ({
    slug: (c.slug as string) || "—",
    user_email: userEmailMap.get(c.user_id as string) || "unknown",
    contractor_rcv: Number(c.contractor_rcv ?? 0),
    status: (c.status as string) || "unknown",
    created_at: c.created_at as string,
  }));

  // Active sessions in last 24h (via auth.sessions.updated_at)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: active24h } = await supabaseAdmin
    .schema("auth")
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .gte("updated_at", yesterday);

  // Users with 0 claims still on the platform
  const { data: allUsers } = await supabaseAdmin
    .schema("auth")
    .from("users")
    .select("id");
  const allUserIds = new Set((allUsers || []).map((u) => u.id as string));
  const { data: usersWithClaims } = await supabaseAdmin
    .from("claims")
    .select("user_id");
  const claimedUserIds = new Set((usersWithClaims || []).map((c) => c.user_id as string));
  const zeroClaimUsers = Array.from(allUserIds).filter((id) => !claimedUserIds.has(id)).length;

  // Cohort: of users who signed up >7 days ago, what % returned (have a session updated in last 7d)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: olderUsers } = await supabaseAdmin
    .schema("auth")
    .from("users")
    .select("id")
    .lt("created_at", sevenDaysAgo)
    .gte("created_at", fourteenDaysAgo);
  const olderUserIds = new Set((olderUsers || []).map((u) => u.id as string));
  let returned = 0;
  if (olderUserIds.size > 0) {
    const { data: returningSessions } = await supabaseAdmin
      .schema("auth")
      .from("sessions")
      .select("user_id")
      .gte("updated_at", sevenDaysAgo)
      .in("user_id", Array.from(olderUserIds));
    const returningSet = new Set((returningSessions || []).map((s) => s.user_id as string));
    returned = returningSet.size;
  }
  const cohortRetention = olderUserIds.size > 0 ? returned / olderUserIds.size : null;

  const section: SupabaseSection = {
    signups_count: signups.length,
    uploads_count: claimRows.length,
    active_users_24h: active24h ?? 0,
    zero_claim_users: zeroClaimUsers,
    recent_signups: signups,
    recent_claims: claimRows,
    cohort_week1_retention: cohortRetention,
  };

  // Anomalies
  if (signups.length >= 3 && claimRows.length === 0) {
    anomalies.push({
      severity: "critical",
      code: "post_signup_activation_broken",
      message: `${signups.length} new signups since last run but ZERO uploads. The post-signup → upload funnel is broken.`,
      source: "supabase",
    });
  }

  return section;
}
