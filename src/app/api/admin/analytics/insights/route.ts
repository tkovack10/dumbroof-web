import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Unified analytics endpoint for the admin dashboard.
 *
 * Returns the joins that the existing /api/admin/live route doesn't cover:
 *   - 30-day acquisition funnel by stage (visitors → signups → profiles → claims → paid)
 *   - Ad attribution by utm_content (the post-UTM-fix segmentation)
 *   - Signup quality breakdown (consumer vs business × roofing_storm vs other)
 *   - Cohort retention by signup week (returning = created at least one claim in
 *     the last 7d, or has any session activity if we can detect it)
 *   - Whoops-specific landing funnel (clicks → signups → claims)
 *
 * Cached upstream (Cache-Control: max-age=300) — meant to be hit once per
 * dashboard mount, not in the 30s live-data polling cycle.
 */
async function safeSql<T = Record<string, unknown>>(query: string, fallback: T[] = []): Promise<T[]> {
  try {
    const { data, error } = await supabaseAdmin.rpc("exec_sql_ro", { query });
    if (error) {
      console.warn("[analytics/insights] exec_sql_ro error:", error.message, "query:", query.slice(0, 100));
      return fallback;
    }
    return (data as T[]) ?? fallback;
  } catch (err) {
    console.warn("[analytics/insights] threw:", err);
    return fallback;
  }
}

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  // Verify admin (platform admins via admins table OR is_admin flag)
  const [{ data: adminRow }, { data: profile }] = await Promise.all([
    supabaseAdmin.from("admins").select("user_id").eq("user_id", auth.user.id).limit(1),
    supabaseAdmin.from("company_profiles").select("is_admin").eq("user_id", auth.user.id).limit(1),
  ]);
  const isAdmin = !!adminRow?.[0] || !!profile?.[0]?.is_admin;
  if (!isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const [
    funnel30d,
    attribution30d,
    quality,
    cohortRetention,
    whoopsFunnel,
    dailySignups30d,
    qualityTimeline,
  ] = await Promise.all([
    // 30-day funnel by stage
    safeSql(`
      WITH thirty AS (SELECT NOW() - INTERVAL '30 days' AS t),
      sig AS (
        SELECT u.id, u.created_at,
          cp.user_id IS NOT NULL AS has_profile,
          cp.company_name IS NOT NULL AND cp.address IS NOT NULL AND cp.phone IS NOT NULL AS profile_complete,
          EXISTS (SELECT 1 FROM public.claims c WHERE c.user_id = u.id) AS has_claim,
          EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = u.id AND s.status = 'active') AS is_paid
        FROM auth.users u
        LEFT JOIN public.company_profiles cp ON cp.user_id = u.id, thirty
        WHERE u.created_at >= thirty.t
      )
      SELECT
        COUNT(*)::int AS signups,
        COUNT(*) FILTER (WHERE has_profile)::int AS with_profile,
        COUNT(*) FILTER (WHERE profile_complete)::int AS profile_complete,
        COUNT(*) FILTER (WHERE has_claim)::int AS with_claim,
        COUNT(*) FILTER (WHERE is_paid)::int AS paid
      FROM sig
    `),
    // Ad attribution by utm_content (last 30d, only attributed signups)
    safeSql(`
      WITH thirty AS (SELECT NOW() - INTERVAL '30 days' AS t)
      SELECT
        COALESCE(u.raw_user_meta_data->>'utm_content', '(unknown)') AS utm_content,
        COALESCE(u.raw_user_meta_data->>'utm_campaign', '(unknown)') AS utm_campaign,
        COUNT(*)::int AS signups,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.claims c WHERE c.user_id = u.id))::int AS with_claim,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = u.id AND s.status='active'))::int AS paid
      FROM auth.users u, thirty
      WHERE u.created_at >= thirty.t AND u.raw_user_meta_data ? 'utm_source'
      GROUP BY 1, 2
      ORDER BY signups DESC
    `),
    // Quality breakdown (matches what we just backfilled)
    safeSql(`
      SELECT
        COALESCE(email_quality, '(unknown)') AS email_quality,
        COALESCE(industry_match, '(unknown)') AS industry_match,
        COUNT(*)::int AS profiles,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.claims c WHERE c.user_id = cp.user_id))::int AS with_claim
      FROM public.company_profiles cp
      WHERE cp.created_at >= NOW() - INTERVAL '60 days'
      GROUP BY 1, 2
      ORDER BY profiles DESC
    `),
    // Cohort retention: signups bucketed by week. "Returning" = at least one claim
    // in the 7d following the cohort week.
    safeSql(`
      WITH eight_weeks AS (
        SELECT generate_series(
          date_trunc('week', NOW() - INTERVAL '8 weeks'),
          date_trunc('week', NOW()),
          INTERVAL '1 week'
        ) AS week_start
      ),
      cohorts AS (
        SELECT
          date_trunc('week', u.created_at) AS week_start,
          u.id,
          EXISTS (
            SELECT 1 FROM public.claims c
            WHERE c.user_id = u.id
              AND c.created_at >= date_trunc('week', u.created_at) + INTERVAL '7 days'
              AND c.created_at < date_trunc('week', u.created_at) + INTERVAL '14 days'
          ) AS returned_wk1,
          EXISTS (
            SELECT 1 FROM public.claims c
            WHERE c.user_id = u.id
              AND c.created_at >= date_trunc('week', u.created_at) + INTERVAL '14 days'
              AND c.created_at < date_trunc('week', u.created_at) + INTERVAL '21 days'
          ) AS returned_wk2,
          EXISTS (
            SELECT 1 FROM public.claims c
            WHERE c.user_id = u.id
              AND c.created_at >= date_trunc('week', u.created_at) + INTERVAL '21 days'
          ) AS returned_wk3plus
        FROM auth.users u
        WHERE u.created_at >= NOW() - INTERVAL '8 weeks'
      )
      SELECT
        to_char(week_start, 'YYYY-MM-DD') AS week_start,
        COUNT(*)::int AS signups,
        COUNT(*) FILTER (WHERE returned_wk1)::int AS returned_wk1,
        COUNT(*) FILTER (WHERE returned_wk2)::int AS returned_wk2,
        COUNT(*) FILTER (WHERE returned_wk3plus)::int AS returned_wk3plus
      FROM cohorts
      GROUP BY 1
      ORDER BY 1 DESC
    `),
    // Whoops-specific: how many people signed up after touching the Whoops ad
    safeSql(`
      WITH thirty AS (SELECT NOW() - INTERVAL '30 days' AS t)
      SELECT
        COUNT(*)::int AS whoops_attributed_signups,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.claims c WHERE c.user_id = u.id))::int AS with_claim,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = u.id AND s.status='active'))::int AS paid
      FROM auth.users u, thirty
      WHERE u.created_at >= thirty.t
        AND u.raw_user_meta_data->>'utm_content' ILIKE '%whoops%'
    `),
    // Daily signups for 30-day sparkline
    safeSql(`
      WITH days AS (SELECT generate_series(date_trunc('day', NOW() - INTERVAL '30 days'), date_trunc('day', NOW()), INTERVAL '1 day') AS day)
      SELECT
        to_char(days.day, 'YYYY-MM-DD') AS day,
        COALESCE(COUNT(u.id), 0)::int AS signups
      FROM days
      LEFT JOIN auth.users u
        ON date_trunc('day', u.created_at AT TIME ZONE 'America/New_York') = days.day
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    // Daily quality breakdown for 30-day signup mix sparkline
    safeSql(`
      WITH days AS (SELECT generate_series(date_trunc('day', NOW() - INTERVAL '30 days'), date_trunc('day', NOW()), INTERVAL '1 day') AS day)
      SELECT
        to_char(days.day, 'YYYY-MM-DD') AS day,
        COUNT(*) FILTER (WHERE cp.email_quality = 'business' AND cp.industry_match = 'roofing_storm')::int AS gold,
        COUNT(*) FILTER (WHERE cp.email_quality = 'business' AND (cp.industry_match = 'other' OR cp.industry_match IS NULL))::int AS biz_other,
        COUNT(*) FILTER (WHERE cp.email_quality = 'consumer' AND cp.industry_match = 'roofing_storm')::int AS consumer_roofer,
        COUNT(*) FILTER (WHERE cp.email_quality = 'consumer' AND (cp.industry_match = 'other' OR cp.industry_match IS NULL))::int AS consumer_other
      FROM days
      LEFT JOIN public.company_profiles cp
        ON date_trunc('day', cp.created_at AT TIME ZONE 'America/New_York') = days.day
      GROUP BY 1
      ORDER BY 1 ASC
    `),
  ]);

  return NextResponse.json(
    {
      timestamp: new Date().toISOString(),
      funnel_30d: funnel30d[0] || null,
      attribution_30d: attribution30d,
      quality_breakdown: quality,
      cohort_retention: cohortRetention,
      whoops_funnel_30d: whoopsFunnel[0] || null,
      daily_signups_30d: dailySignups30d,
      quality_timeline_30d: qualityTimeline,
    },
    { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" } }
  );
}
