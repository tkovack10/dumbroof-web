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
    // Solo user — just return own claims
    const { data: claims } = await supabaseAdmin
      .from("claims")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    return NextResponse.json({ claims: claims || [], team: false });
  }

  // Return all claims from team members
  const { data: claims } = await supabaseAdmin
    .from("claims")
    .select("*")
    .in("user_id", teamUserIds)
    .order("created_at", { ascending: false });

  return NextResponse.json({ claims: claims || [], team: true, team_size: teamUserIds.length });
}
