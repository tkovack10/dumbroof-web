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

  const claimFilePath = claim?.file_path || "";

  // Generate signed URLs for photo thumbnails (server-side, bypasses RLS)
  const photosWithUrls = await Promise.all(
    (photos || []).slice(0, 30).map(async (photo) => {
      let signedUrl = "";
      // Try the file_path from photos table first, then construct from annotation_key
      const storagePath = photo.file_path || `${claimFilePath}/photos/${photo.annotation_key}.jpg`;
      if (storagePath && claimFilePath) {
        const { data } = await supabaseAdmin.storage
          .from("claim-documents")
          .createSignedUrl(storagePath, 3600);
        if (data?.signedUrl) signedUrl = data.signedUrl;
      }
      return { ...photo, signed_url: signedUrl };
    })
  );

  return NextResponse.json({
    photos: photosWithUrls,
    claim_file_path: claimFilePath,
  });
}
