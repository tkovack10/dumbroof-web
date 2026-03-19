import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

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

  // Check access: own claim OR same email domain
  if (claim.user_id === user.id) {
    return NextResponse.json({ claim });
  }

  // Check domain sharing
  const { data: owner } = await supabaseAdmin.auth.admin.getUserById(claim.user_id);
  if (owner?.user?.email) {
    const ownerDomain = owner.user.email.split("@")[1];
    const userDomain = user.email!.split("@")[1];
    if (ownerDomain === userDomain) {
      return NextResponse.json({ claim });
    }
  }

  return NextResponse.json({ error: "Not authorized" }, { status: 403 });
}
