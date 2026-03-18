import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const { searchParams } = new URL(req.url);
  const claimId = searchParams.get("claim_id");

  if (!claimId) {
    return NextResponse.json({ error: "claim_id required" }, { status: 400 });
  }

  const authorized = await canAccessClaim(userId, claimId);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: photos, error } = await supabaseAdmin
    .from("photos")
    .select("annotation_key, annotation_text, damage_type, material, trade, severity, file_path")
    .eq("claim_id", claimId)
    .order("annotation_key", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get claim file_path for photo URLs
  const { data: claim } = await supabaseAdmin
    .from("claims")
    .select("file_path")
    .eq("id", claimId)
    .single();

  return NextResponse.json({
    photos: photos || [],
    claim_file_path: claim?.file_path || "",
  });
}
