import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Public API: returns approved, anonymized claim photos filtered by
 * damage_type and/or material.  Used by /learn/* content pages so real
 * claim photos appear in articles and are indexable by search engines.
 *
 * Query params:
 *   damage_type  – e.g. "hail", "wind", "impact"
 *   material     – e.g. "slate", "tpo", "epdm", "asphalt_shingle"
 *   limit        – max photos to return (default 8, max 20)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const damageType = searchParams.get("damage_type");
  const material = searchParams.get("material");
  const limit = Math.min(parseInt(searchParams.get("limit") || "8"), 20);

  if (!damageType && !material) {
    return NextResponse.json(
      { error: "At least one of damage_type or material is required" },
      { status: 400 }
    );
  }

  // Only return photos that have been approved via the annotation feedback system
  let query = supabaseAdmin
    .from("photos")
    .select(
      "id, annotation_key, annotation_text, damage_type, material, trade, elevation, severity, filename, claim_id"
    )
    .not("annotation_text", "is", null);

  if (damageType) query = query.ilike("damage_type", `%${damageType}%`);
  if (material) query = query.ilike("material", `%${material}%`);

  query = query.order("created_at", { ascending: false }).limit(limit);

  const { data: photos, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!photos || photos.length === 0) {
    return NextResponse.json({ photos: [] });
  }

  // Get claim file_paths for URL signing
  const claimIds = [...new Set(photos.map((p) => p.claim_id).filter(Boolean))];
  const { data: claims } = await supabaseAdmin
    .from("claims")
    .select("id, file_path, photo_files")
    .in("id", claimIds);

  const claimMap = new Map((claims || []).map((c) => [c.id, c]));

  // Build signed URLs (1-hour expiry, cached by CDN in production)
  const result = await Promise.all(
    photos.map(async (photo) => {
      const claim = claimMap.get(photo.claim_id);
      if (!claim?.file_path) return null;

      // Resolve filename
      let fname = photo.filename;
      if (!fname) {
        const photoFiles: string[] = claim.photo_files || [];
        const photoNum = parseInt(photo.annotation_key?.replace("photo_", "") || "", 10);
        if (!isNaN(photoNum) && photoNum >= 1 && photoNum <= photoFiles.length) {
          fname = photoFiles[photoNum - 1];
        } else {
          fname = photo.annotation_key || "unknown";
        }
      }

      const storagePath = `${claim.file_path}/photos/${fname}`;
      const { data } = await supabaseAdmin.storage
        .from("claim-documents")
        .createSignedUrl(storagePath, 3600);

      if (!data?.signedUrl) return null;

      return {
        id: photo.id,
        url: data.signedUrl,
        alt: photo.annotation_text || `${photo.damage_type || "storm"} damage to ${photo.material || "roof"}`,
        damage_type: photo.damage_type,
        material: photo.material,
        severity: photo.severity,
        elevation: photo.elevation,
        caption: photo.annotation_text,
      };
    })
  );

  return NextResponse.json({
    photos: result.filter(Boolean),
  });
}
