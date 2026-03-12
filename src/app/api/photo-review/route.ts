import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";

/**
 * Resolve the actual filename for a photo from its annotation_key.
 * Uses photo.filename (populated by write_photos) with fallback to
 * positional mapping from claim.photo_files for old photos.
 */
function resolveFilename(
  photo: { filename?: string; annotation_key?: string },
  claim: { photo_files?: string[] }
): string {
  if (photo.filename) return photo.filename;
  const photoFiles: string[] = claim.photo_files || [];
  const photoNum = parseInt(photo.annotation_key?.replace("photo_", "") || "", 10);
  if (!isNaN(photoNum) && photoNum >= 1 && photoNum <= photoFiles.length) {
    return photoFiles[photoNum - 1];
  }
  return photo.annotation_key || "unknown";
}

/**
 * Fallback for excluded_photos management when RPC functions don't exist.
 * Stores actual filenames (not annotation_keys) so processor can match on basename.
 */
async function fallbackExcludedPhotos(claimId: string, key: string, action: "add" | "remove") {
  const { data: claim } = await supabaseAdmin
    .from("claims")
    .select("excluded_photos")
    .eq("id", claimId)
    .single();
  const excluded: string[] = (claim?.excluded_photos as string[]) || [];
  if (action === "add" && !excluded.includes(key)) {
    excluded.push(key);
  }
  if (action === "remove") {
    const i = excluded.indexOf(key);
    if (i !== -1) excluded.splice(i, 1);
  }
  await supabaseAdmin.from("claims").update({ excluded_photos: excluded }).eq("id", claimId);
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  const { searchParams } = new URL(req.url);
  const claimId = searchParams.get("claim_id");
  const offset = parseInt(searchParams.get("offset") || "0");
  const limit = parseInt(searchParams.get("limit") || "50");

  // Build query for photos with optional claim filter
  let query = supabaseAdmin
    .from("photos")
    .select(
      "id, claim_id, annotation_key, annotation_text, damage_type, material, trade, elevation, severity, filename",
      { count: "exact" }
    );

  if (claimId) {
    query = query.eq("claim_id", claimId);
  }

  query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

  const { data: photos, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!photos || photos.length === 0) {
    return NextResponse.json({ photos: [], total: count || 0, reviewed: 0 });
  }

  // Parallelize claims + feedback queries
  const claimIds = [...new Set(photos.map((p) => p.claim_id).filter(Boolean))];
  const photoIds = photos.map((p) => p.id);

  const [{ data: claims }, { data: feedback, error: fbErr }] = await Promise.all([
    supabaseAdmin.from("claims").select("id, address, file_path, photo_files").in("id", claimIds),
    supabaseAdmin.from("annotation_feedback").select("photo_id, status").in("photo_id", photoIds),
  ]);
  if (fbErr) console.error("[photo-review] feedback query failed:", fbErr.message);

  const claimMap = new Map((claims || []).map((c) => [c.id, c]));
  const feedbackMap = new Map((feedback || []).map((f: { photo_id: string; status: string }) => [f.photo_id, f.status]));

  // Count total reviewed (for the claim or globally)
  let reviewedCount = 0;
  if (claimId) {
    const { count: rc, error: rcErr } = await supabaseAdmin
      .from("annotation_feedback")
      .select("id", { count: "exact", head: true })
      .eq("claim_id", claimId);
    if (rcErr) console.error("[photo-review] reviewed count failed:", rcErr.message);
    reviewedCount = rc || 0;
  } else {
    reviewedCount = feedback?.length || 0;
  }

  // Batch sign URLs — build path-to-index map for reliable mapping
  const pathsToSign: string[] = [];
  const pathToPhotoIdx: Map<number, number> = new Map();

  photos.forEach((photo, idx) => {
    const claim = claimMap.get(photo.claim_id);
    if (!claim) return;
    const fname = resolveFilename(photo, claim);
    const storagePath = `${claim.file_path}/photos/${fname}`;
    pathToPhotoIdx.set(pathsToSign.length, idx);
    pathsToSign.push(storagePath);
  });

  // Batch create signed URLs (single API call instead of N individual calls)
  const signedUrlMap = new Map<number, string>();
  if (pathsToSign.length > 0) {
    const { data: signedData } = await supabaseAdmin.storage
      .from("claim-documents")
      .createSignedUrls(pathsToSign, 3600);

    if (signedData) {
      signedData.forEach((item, i) => {
        if (item.signedUrl) {
          const photoIdx = pathToPhotoIdx.get(i);
          if (photoIdx !== undefined) {
            signedUrlMap.set(photoIdx, item.signedUrl);
          }
        }
      });
    }
  }

  const result = photos.map((photo, idx) => {
    const claim = claimMap.get(photo.claim_id);
    if (!claim) return null;

    return {
      id: photo.id,
      claim_id: photo.claim_id,
      address: claim?.address || "Unknown",
      annotation_key: photo.annotation_key,
      annotation_text: photo.annotation_text || "",
      damage_type: photo.damage_type,
      material: photo.material,
      trade: photo.trade,
      elevation: photo.elevation,
      severity: photo.severity,
      signed_url: signedUrlMap.get(idx) || "",
      feedback_status: feedbackMap.get(photo.id) || null,
    };
  });

  return NextResponse.json({
    photos: result.filter(Boolean),
    total: count || 0,
    reviewed: reviewedCount,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const body = await req.json();
  const { photo_id, status, corrected_annotation, corrected_tags, notes } = body;

  if (!photo_id || !status) {
    return NextResponse.json({ error: "photo_id and status required" }, { status: 400 });
  }

  // Get original photo data + claim's photo_files for filename resolution
  const { data: photo, error: photoErr } = await supabaseAdmin
    .from("photos")
    .select("annotation_text, damage_type, material, trade, elevation, severity, annotation_key, claim_id, filename")
    .eq("id", photo_id)
    .single();

  if (photoErr || !photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const claimId = photo.claim_id;

  // Verify user owns this claim OR is admin
  if (claimId) {
    const authorized = await canAccessClaim(userId, claimId);
    if (!authorized) {
      return NextResponse.json({ error: "Not authorized for this claim" }, { status: 403 });
    }
  }

  // Upsert feedback
  const { error } = await supabaseAdmin.from("annotation_feedback").upsert(
    {
      photo_id,
      claim_id: claimId,
      status,
      original_annotation: photo.annotation_text || "",
      corrected_annotation: corrected_annotation || null,
      original_tags: {
        damage_type: photo.damage_type,
        material: photo.material,
        trade: photo.trade,
        elevation: photo.elevation,
        severity: photo.severity,
      },
      corrected_tags: corrected_tags || null,
      notes: notes || null,
    },
    { onConflict: "photo_id" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Resolve actual filename for excluded_photos (processor matches on basename, not annotation_key)
  if (claimId && photo.annotation_key) {
    // Get claim's photo_files for filename resolution
    const { data: claimData } = await supabaseAdmin
      .from("claims")
      .select("photo_files")
      .eq("id", claimId)
      .single();
    const excludeKey = resolveFilename(photo, claimData || {});

    if (status === "rejected") {
      const { error: rpcErr } = await supabaseAdmin.rpc("append_excluded_photo", {
        claim_id_param: claimId,
        photo_key: excludeKey,
      });
      if (rpcErr?.message?.includes("function") && rpcErr?.message?.includes("does not exist")) {
        await fallbackExcludedPhotos(claimId, excludeKey, "add");
      }
    } else {
      // Un-reject: remove from excluded_photos if previously rejected
      const { error: rpcErr } = await supabaseAdmin.rpc("remove_excluded_photo", {
        claim_id_param: claimId,
        photo_key: excludeKey,
      });
      if (rpcErr?.message?.includes("function") && rpcErr?.message?.includes("does not exist")) {
        await fallbackExcludedPhotos(claimId, excludeKey, "remove");
      }
    }
  }

  return NextResponse.json({ ok: true });
}
