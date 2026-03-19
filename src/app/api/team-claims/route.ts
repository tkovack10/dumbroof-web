import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Domain sharing: returns all claims where the claim owner's email
 * shares the same domain as the requesting user.
 * e.g., barbera@usaroofmasters.com sees all @usaroofmasters.com claims.
 *
 * Falls back to user_id filter for non-matching domains (external users).
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const domain = user.email.split("@")[1];

  // Get all user_ids that share this email domain
  const { data: domainUsers } = await supabaseAdmin.auth.admin.listUsers({ perPage: 500 });
  const teamUserIds = (domainUsers?.users || [])
    .filter((u) => u.email && u.email.endsWith(`@${domain}`))
    .map((u) => u.id);

  if (teamUserIds.length <= 1) {
    // No team — just return own claims
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
