import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  // Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const claimId = searchParams.get("claim_id");
  const offset = parseInt(searchParams.get("offset") || "0");
  const limit = parseInt(searchParams.get("limit") || "50");

  // Build query for photos with optional claim filter
  let query = supabaseAdmin
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
  const { data: claims } = await supabaseAdmin
    .from("claims")
    .select("id, address, file_path, photo_files")
    .in("id", claimIds);
  const claimMap = new Map((claims || []).map((c) => [c.id, c]));

  // Get existing feedback
  const photoIds = photos.map((p) => p.id);
  const { data: feedback } = await supabaseAdmin
    .from("annotation_feedback")
    .select("photo_id, status")
    .in("photo_id", photoIds);
  const feedbackMap = new Map((feedback || []).map((f) => [f.photo_id, f.status]));

  // Count total reviewed
  let reviewedQuery = supabaseAdmin.from("annotation_feedback").select("id", { count: "exact", head: true });
  if (claimId) {
    reviewedQuery = reviewedQuery.eq("claim_id", claimId);
  }
  const { count: reviewedCount } = await reviewedQuery;

  // Batch sign URLs — group photos by claim for efficient signing
  const pathsToSign: string[] = [];
  const photoPathMap: Map<string, number> = new Map();

  photos.forEach((photo, idx) => {
    const claim = claimMap.get(photo.claim_id);
    if (!claim) return;
    const storagePath = `${claim.file_path}/photos/${photo.filename || photo.annotation_key}`;
    pathsToSign.push(storagePath);
    photoPathMap.set(storagePath, idx);
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
          signedUrlMap.set(i, item.signedUrl);
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
    reviewed: reviewedCount || 0,
  });
}

export async function POST(req: NextRequest) {
  // Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  const { photo_id, claim_id, status, corrected_annotation, corrected_tags, notes } = body;

  if (!photo_id || !status) {
    return NextResponse.json({ error: "photo_id and status required" }, { status: 400 });
  }

  // Get original photo data
  const { data: photo } = await supabaseAdmin.from("photos").select("annotation_text, damage_type, material, trade, elevation, severity, annotation_key, claim_id").eq("id", photo_id).single();

  // Upsert feedback
  const { error } = await supabaseAdmin.from("annotation_feedback").upsert(
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

  // If rejected and claim_id, add to excluded_photos atomically
  if (status === "rejected" && (claim_id || photo?.claim_id)) {
    const targetClaimId = claim_id || photo?.claim_id;
    const { data: claim } = await supabaseAdmin.from("claims").select("excluded_photos").eq("id", targetClaimId).single();
    const excluded: string[] = (claim?.excluded_photos as string[]) || [];
    const key = photo?.annotation_key;
    if (key && !excluded.includes(key)) {
      excluded.push(key);
      await supabaseAdmin.from("claims").update({ excluded_photos: excluded }).eq("id", targetClaimId);
    }
  }

  return NextResponse.json({ ok: true });
}
