import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PUBLIC_DOMAINS } from "@/lib/public-domains";

/**
 * Get a single claim by ID — allows access if the requesting user
 * shares the same email domain as the claim owner (domain sharing).
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const claimId = searchParams.get("id");

  if (!claimId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // Get the claim
  const { data: claim } = await supabaseAdmin
    .from("claims")
    .select("*")
    .eq("id", claimId)
    .single();

  if (!claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  // Own claim — always allowed.
  if (claim.user_id === user.id) {
    return NextResponse.json({ claim });
  }

  // Cross-rep access: gated by company membership AND the company's
  // claims_visibility_mode. Admins/owners always see team-wide.
  const { data: callerProfile } = await supabaseAdmin
    .from("company_profiles")
    .select("company_id, is_admin, role")
    .eq("user_id", user.id)
    .maybeSingle();
  const callerIsAdmin =
    !!callerProfile?.is_admin || callerProfile?.role === "owner" || callerProfile?.role === "admin";

  if (callerProfile?.company_id && claim.company_id === callerProfile.company_id) {
    if (callerIsAdmin) return NextResponse.json({ claim });
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("claims_visibility_mode")
      .eq("id", callerProfile.company_id)
      .maybeSingle();
    if (company?.claims_visibility_mode !== "own") {
      return NextResponse.json({ claim });
    }
    return NextResponse.json({ error: "Restricted by company visibility setting" }, { status: 403 });
  }

  // Legacy fallback: email-domain sharing for claims/users that don't have
  // a company_id wired yet (e.g. a solo user whose teammate hasn't been
  // invited via the company_invites flow). Kept for back-compat.
  //
  // Intentionally EXCLUDES public mailbox domains (gmail.com, outlook.com, …) —
  // otherwise any two unrelated users on the same consumer provider would
  // cross-access each other's claims. Mirrors the assign-rep route guard.
  const { data: owner } = await supabaseAdmin.auth.admin.getUserById(claim.user_id);
  if (owner?.user?.email) {
    const ownerDomain = owner.user.email.split("@")[1]?.toLowerCase();
    const userDomain = user.email!.split("@")[1]?.toLowerCase();
    if (
      ownerDomain &&
      userDomain &&
      ownerDomain === userDomain &&
      !PUBLIC_DOMAINS.has(ownerDomain)
    ) {
      return NextResponse.json({ claim });
    }
  }

  return NextResponse.json({ error: "Not authorized" }, { status: 403 });
}
