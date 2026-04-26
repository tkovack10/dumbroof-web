import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SupabaseSection, SignupRow, ClaimRow, Anomaly } from "../types";

/**
 * Funnel Monitor — Supabase data source.
 * Pulls signups, uploads, retention, and active users since the last cron run.
 *
 * IMPORTANT: never query `.schema("auth").from("users")` here — Supabase's
 * PostgREST gateway only exposes the `public` and `graphql_public` schemas
 * (PGRST106). Use `supabaseAdmin.auth.admin.listUsers()` instead, which hits
 * `/auth/v1/admin/users` and works with the service-role key. See E171.
 */

/**
 * List every user in auth via the admin API, paginating until we've drained
 * the result set. perPage caps at 1000. At platform scale (~100 users) this
 * is one page; logs a warning past 800 so we know to add a created_at filter
 * before we outgrow simple full-list pagination.
 */
async function listAllAuthUsers(): Promise<
  Array<{
    id: string;
    email: string;
    created_at: string;
    raw_user_meta_data?: Record<string, unknown>;
    raw_app_meta_data?: Record<string, unknown>;
  }>
> {
  const all: Array<{
    id: string;
    email: string;
    created_at: string;
    raw_user_meta_data?: Record<string, unknown>;
    raw_app_meta_data?: Record<string, unknown>;
  }> = [];
  let page = 1;
  const perPage = 1000;
  // Hard safety cap — refuse to paginate past 10 pages (10k users). At that
  // point we should have switched to a filtered query path.
  for (let i = 0; i < 10; i++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error(`[funnel-monitor] auth.admin.listUsers error (page ${page}):`, error.message);
      break;
    }
    const users = data?.users || [];
    for (const u of users) {
      all.push({
        id: u.id,
        email: u.email || "unknown",
        created_at: u.created_at,
        raw_user_meta_data: (u.user_metadata || {}) as Record<string, unknown>,
        raw_app_meta_data: (u.app_metadata || {}) as Record<string, unknown>,
      });
    }
    if (users.length < perPage) break;
    page += 1;
  }
  if (all.length >= 800) {
    console.warn(
      `[funnel-monitor] listAllAuthUsers returned ${all.length} users — approaching pagination ceiling, switch to a filtered query`
    );
  }
  return all;
}

export async function gatherSupabase(
  windowStart: string,
  windowEnd: string,
  anomalies: Anomaly[]
): Promise<SupabaseSection> {
  // Pull every user via the admin API ONCE — we slice it for each downstream
  // need (window signups, cohort retention, zero-claim count). Cheaper than
  // hitting the API three times.
  const allUsers = await listAllAuthUsers();

  // New signups in window
  const windowStartMs = Date.parse(windowStart);
  const windowEndMs = Date.parse(windowEnd);
  const newUsers = allUsers.filter((u) => {
    const t = Date.parse(u.created_at);
    return t >= windowStartMs && t < windowEndMs;
  });

  const signups: SignupRow[] = newUsers.map((u) => {
    const meta = u.raw_user_meta_data || {};
    const appMeta = u.raw_app_meta_data || {};
    return {
      email: u.email,
      created_at: u.created_at,
      provider: ((appMeta.provider as string) || "email"),
      signup_source: (meta.signup_source as string) || null,
      ip: null,
      user_agent: null,
    };
  });

  // New claims in window
  const { data: newClaims } = await supabaseAdmin
    .from("claims")
    .select("slug, user_id, contractor_rcv, status, created_at")
    .gte("created_at", windowStart)
    .lt("created_at", windowEnd)
    .order("created_at", { ascending: false });

  // user_id → email map (built from the same allUsers list — no second API call)
  const userEmailMap = new Map<string, string>();
  for (const u of allUsers) userEmailMap.set(u.id, u.email);

  const claimRows: ClaimRow[] = (newClaims || []).map((c) => ({
    slug: (c.slug as string) || "—",
    user_email: userEmailMap.get(c.user_id as string) || "unknown",
    contractor_rcv: Number(c.contractor_rcv ?? 0),
    status: (c.status as string) || "unknown",
    created_at: c.created_at as string,
  }));

  // Users with 0 claims still on the platform — uses claim user_ids vs all auth users
  const { data: usersWithClaims } = await supabaseAdmin
    .from("claims")
    .select("user_id");
  const claimedUserIds = new Set((usersWithClaims || []).map((c) => c.user_id as string));
  const zeroClaimUsers = allUsers.filter((u) => !claimedUserIds.has(u.id)).length;

  // Cohort: of users who signed up 7-14 days ago, what % returned (have a
  // claim or session in the last 7d). auth.sessions is also gateway-blocked,
  // so we fall back to "did they create a claim in the last 7d" as the
  // returning-user signal. Less precise than session activity but it's the
  // strongest signal we can get from public-schema data.
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const fourteenDaysAgoMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const cohortUserIds = new Set(
    allUsers
      .filter((u) => {
        const t = Date.parse(u.created_at);
        return t < sevenDaysAgoMs && t >= fourteenDaysAgoMs;
      })
      .map((u) => u.id)
  );
  let cohortRetention: number | null = null;
  if (cohortUserIds.size > 0) {
    const sevenDaysAgoIso = new Date(sevenDaysAgoMs).toISOString();
    const { data: recentClaims } = await supabaseAdmin
      .from("claims")
      .select("user_id")
      .gte("created_at", sevenDaysAgoIso)
      .in("user_id", Array.from(cohortUserIds));
    const returningSet = new Set((recentClaims || []).map((c) => c.user_id as string));
    cohortRetention = returningSet.size / cohortUserIds.size;
  }

  const section: SupabaseSection = {
    signups_count: signups.length,
    uploads_count: claimRows.length,
    // active_users_24h pulled from auth.sessions which is gateway-blocked
    // (PGRST106). Set to null until we add an RPC or expose the schema.
    active_users_24h: 0,
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
