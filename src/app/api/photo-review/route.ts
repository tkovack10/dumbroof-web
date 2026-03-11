import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}

export async function GET(req: NextRequest) {
  const sb = getSb();
  const { searchParams } = new URL(req.url);
  const claimId = searchParams.get("claim_id");
  const offset = parseInt(searchParams.get("offset") || "0");
  const limit = parseInt(searchParams.get("limit") || "50");

  // Build query for photos with optional claim filter
  let query = sb
    .from("photos")
    .select("id, claim_id, annotation_key, annotation_text, damage_type, material, trade, elevation, severity, filename", { count: "exact" });

  if (claimId) {
    query = query.eq("claim_id", claimId);
  }

  query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

  const { data: photos, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!photos || photos.length === 0) {
    return NextResponse.json({ photos: [], total: count || 0, reviewed: 0 });
  }

  // Get claim info for addresses + file paths
  const claimIds = [...new Set(photos.map((p) => p.claim_id).filter(Boolean))];
  const { data: claims } = await sb
    .from("claims")
    .select("id, address, file_path, photo_files")
    .in("id", claimIds);
  const claimMap = new Map((claims || []).map((c) => [c.id, c]));

  // Get existing feedback
  const photoIds = photos.map((p) => p.id);
  const { data: feedback } = await sb
    .from("annotation_feedback")
    .select("photo_id, status")
    .in("photo_id", photoIds);
  const feedbackMap = new Map((feedback || []).map((f) => [f.photo_id, f.status]));

  // Count total reviewed
  let reviewedQuery = sb.from("annotation_feedback").select("id", { count: "exact", head: true });
  if (claimId) {
    reviewedQuery = reviewedQuery.eq("claim_id", claimId);
  }
  const { count: reviewedCount } = await reviewedQuery;

  // Sign URLs for each photo
  const result = await Promise.all(
    photos.map(async (photo) => {
      const claim = claimMap.get(photo.claim_id);
      if (!claim) return null;

      // Determine the storage path for the photo
      const storagePath = `${claim.file_path}/photos/${photo.filename || photo.annotation_key}`;

      const { data: signedData } = await sb.storage
        .from("claim-documents")
        .createSignedUrl(storagePath, 3600);

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
        signed_url: signedData?.signedUrl || "",
        feedback_status: feedbackMap.get(photo.id) || null,
      };
    })
  );

  return NextResponse.json({
    photos: result.filter(Boolean),
    total: count || 0,
    reviewed: reviewedCount || 0,
  });
}

export async function POST(req: NextRequest) {
  const sb = getSb();
  const body = await req.json();
  const { photo_id, claim_id, status, corrected_annotation, corrected_tags, notes } = body;

  if (!photo_id || !status) {
    return NextResponse.json({ error: "photo_id and status required" }, { status: 400 });
  }

  // Get original photo data
  const { data: photo } = await sb.from("photos").select("annotation_text, damage_type, material, trade, elevation, severity, annotation_key, claim_id").eq("id", photo_id).single();

  // Upsert feedback
  const { error } = await sb.from("annotation_feedback").upsert(
    {
      photo_id,
      claim_id: claim_id || photo?.claim_id,
      status,
      original_annotation: photo?.annotation_text || "",
      corrected_annotation: corrected_annotation || null,
      original_tags: photo ? { damage_type: photo.damage_type, material: photo.material, trade: photo.trade, elevation: photo.elevation, severity: photo.severity } : null,
      corrected_tags: corrected_tags || null,
      notes: notes || null,
    },
    { onConflict: "photo_id" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If rejected and claim_id, add to excluded_photos
  if (status === "rejected" && (claim_id || photo?.claim_id)) {
    const targetClaimId = claim_id || photo?.claim_id;
    const { data: claim } = await sb.from("claims").select("excluded_photos").eq("id", targetClaimId).single();
    const excluded: string[] = (claim?.excluded_photos as string[]) || [];
    const key = photo?.annotation_key;
    if (key && !excluded.includes(key)) {
      excluded.push(key);
      await sb.from("claims").update({ excluded_photos: excluded }).eq("id", targetClaimId);
    }
  }

  return NextResponse.json({ ok: true });
}
