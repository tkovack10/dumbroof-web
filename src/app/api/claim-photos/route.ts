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
    .select("annotation_key, annotation_text, damage_type, material, trade, severity, file_path, filename, slope_id")
    .eq("claim_id", claimId)
    .order("annotation_key", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get claim file_path + photo_files for robust filename resolution
  const { data: claim } = await supabaseAdmin
    .from("claims")
    .select("file_path, photo_files")
    .eq("id", claimId)
    .single();

  const claimFilePath = claim?.file_path || "";
  const photoFiles: string[] = (claim?.photo_files as string[]) || [];

  // Generate signed URLs for photo thumbnails (server-side, bypasses RLS).
  // Filename resolution order:
  //   1. photos.filename column (set by processor.write_photos — real EagleView/uploaded name)
  //   2. claim.photo_files[N-1] by index from annotation_key (e.g. photo_03 → index 2)
  //   3. photos.file_path if it looks like a real storage path
  // Never use {annotation_key}.jpg — those files don't exist in storage.
  const photosWithUrls = await Promise.all(
    (photos || []).slice(0, 100).map(async (photo) => {
      let signedUrl = "";

      let fname: string | null = photo.filename || null;
      if (!fname && photo.annotation_key) {
        const num = parseInt(photo.annotation_key.replace("photo_", ""), 10);
        if (!isNaN(num) && num >= 1 && num <= photoFiles.length) {
          fname = photoFiles[num - 1];
        }
      }

      let storagePath = "";
      if (fname && claimFilePath) {
        storagePath = `${claimFilePath}/photos/${fname}`;
      } else if (photo.file_path && photo.file_path.includes("/")) {
        // Only trust file_path when it actually looks like a path, not a fallback key
        storagePath = photo.file_path;
      }

      if (storagePath) {
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
