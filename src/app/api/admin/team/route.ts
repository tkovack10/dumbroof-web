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

  // Authenticated team-member access. Returns only the caller's own team
  // (scoped via getTeamUserIds) so it's safe to expose to non-admins —
  // they can already see their teammates elsewhere. Required by Phase 5
  // Slice B's assignment dropdown which non-admin assignees use.
  //
  // last_sign_in_at is admin-only — peers shouldn't see when teammates
  // last logged in (privacy). Gate that field behind is_admin.

  try {
    // Check caller's admin status to decide whether to include last_sign_in
    const { data: callerProfile } = await supabaseAdmin
      .from("company_profiles")
      .select("is_admin")
      .eq("user_id", user.id)
      .maybeSingle();
    const callerIsAdmin = !!callerProfile?.is_admin;

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

    // Pull last_sign_in_at only when caller is admin. Skip the auth admin
    // listUsers call for non-admins to also save a round trip.
    const lastSignInByUserId = new Map<string, string | null>();
    if (callerIsAdmin) {
      try {
        const { data: authPage } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        const teamSet = new Set(teamUserIds);
        for (const au of authPage?.users ?? []) {
          if (teamSet.has(au.id)) {
            lastSignInByUserId.set(au.id, au.last_sign_in_at || null);
          }
        }
      } catch (e) {
        console.warn("[api/admin/team] listUsers failed (non-fatal):", e);
      }
    }

    const members = teamMembers.map((m) => ({
      id: m.id,
      email: m.email || "",
      // null for non-admin callers — peers don't see each other's login times
      last_sign_in: callerIsAdmin ? (lastSignInByUserId.get(m.id) ?? null) : null,
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
