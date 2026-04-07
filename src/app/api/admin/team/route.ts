import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getTeamUserIds } from "@/lib/team-lookup";

/**
 * GET /api/admin/team
 * Returns all users that share the admin's company,
 * with claims_count.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Admin check
  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin")
    .eq("user_id", user.id)
    .limit(1);

  if (!profileRows?.[0]?.is_admin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    const { userIds: teamUserIds, members: teamMembers } = await getTeamUserIds(user);

    // Get claims count per user
    const { data: claims } = await supabaseAdmin
      .from("claims")
      .select("user_id")
      .in("user_id", teamUserIds);

    const claimCounts: Record<string, number> = {};
    for (const c of claims || []) {
      claimCounts[c.user_id] = (claimCounts[c.user_id] || 0) + 1;
    }

    const members = teamMembers.map((m) => ({
      id: m.id,
      email: m.email || "",
      last_sign_in: null as string | null,
      claims_count: claimCounts[m.id] || 0,
    }));

    // Sort: most claims first
    members.sort((a, b) => b.claims_count - a.claims_count);

    return NextResponse.json({ members });
  } catch (err) {
    console.error("[api/admin/team] failed", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
