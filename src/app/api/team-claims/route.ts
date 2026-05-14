import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getTeamUserIds } from "@/lib/team-lookup";

/**
 * Domain sharing: returns all claims where the claim owner belongs to the
 * same company as the requesting user.
 *
 * Team membership is resolved via getTeamUserIds() which queries
 * company_profiles (company_id first, then email-domain fallback).
 *
 * Visibility gate (added 2026-05-13):
 *   companies.claims_visibility_mode controls whether reps see all team
 *   claims ('team', default) or only their own ('own'). Admins/owners
 *   always see team-wide regardless of mode — they need the rollup.
 *
 * Falls back to user_id filter for solo users (no team).
 */
export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { userIds: teamUserIds, isTeam } = await getTeamUserIds(user);

  if (!isTeam) {
    const { data: claims } = await supabaseAdmin
      .from("claims")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    return NextResponse.json({ claims: claims || [], team: false });
  }

  // Resolve the company's visibility mode + caller's admin status. Both
  // come from the caller's own company_profiles row (fast, single query).
  const { data: profile } = await supabaseAdmin
    .from("company_profiles")
    .select("company_id, is_admin, role")
    .eq("user_id", user.id)
    .maybeSingle();

  const isAdmin = !!profile?.is_admin || profile?.role === "owner" || profile?.role === "admin";
  let mode: "team" | "own" = "team";
  if (profile?.company_id) {
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("claims_visibility_mode")
      .eq("id", profile.company_id)
      .maybeSingle();
    if (company?.claims_visibility_mode === "own") mode = "own";
  }

  // Non-admin rep on a company with mode='own' → only their own claims.
  if (mode === "own" && !isAdmin) {
    const { data: claims } = await supabaseAdmin
      .from("claims")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    return NextResponse.json({
      claims: claims || [],
      team: true,
      team_size: teamUserIds.length,
      visibility_mode: mode,
      restricted: true,
    });
  }

  const { data: claims } = await supabaseAdmin
    .from("claims")
    .select("*")
    .in("user_id", teamUserIds)
    .order("created_at", { ascending: false });

  return NextResponse.json({
    claims: claims || [],
    team: true,
    team_size: teamUserIds.length,
    visibility_mode: mode,
  });
}
