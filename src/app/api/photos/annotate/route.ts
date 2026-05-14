import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";

export const maxDuration = 30;

/**
 * Photo markup save endpoint.
 *
 * Body: { claim_id, annotation_key, image_base64 } — image_base64 is a
 * data-URL or raw base64 PNG of the canvas (photo + user overlay flattened).
 *
 * Behavior: uploads the marked-up PNG to {claim.file_path}/photos/{key}.marked.png
 * (one slot per annotation_key, overwrites previous markup on resave), then
 * updates photos.annotated_path so the Damage Assessment list and PDFs can
 * prefer the marked-up version. Original photo is never touched.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  let body: { claim_id?: string; annotation_key?: string; image_base64?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { claim_id, annotation_key, image_base64 } = body;
  if (!claim_id || !annotation_key || !image_base64) {
    return NextResponse.json(
      { error: "claim_id, annotation_key, image_base64 required" },
      { status: 400 }
    );
  }

  if (!(await canAccessClaim(userId, claim_id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Strip data-URL prefix if present, then decode.
  const b64 = image_base64.includes(",")
    ? image_base64.split(",", 2)[1]
    : image_base64;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(b64, "base64");
  } catch {
    return NextResponse.json({ error: "Bad base64 payload" }, { status: 400 });
  }
  // Sanity cap so a runaway client can't push a 50 MB file.
  if (bytes.length > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "Image too large (8 MB max)" }, { status: 413 });
  }

  const { data: claim } = await supabaseAdmin
    .from("claims")
    .select("file_path")
    .eq("id", claim_id)
    .single();
  if (!claim?.file_path) {
    return NextResponse.json({ error: "Claim file_path missing" }, { status: 400 });
  }

  const safeKey = String(annotation_key).replace(/[^a-zA-Z0-9._-]/g, "_");
  // JPEG (q=0.85) instead of PNG — overlay strokes stay sharp, payload is
  // 5-10× smaller than lossless PNG. Photos are inherently lossy so PNG
  // never made sense here.
  const storagePath = `${claim.file_path}/photos/${safeKey}.marked.jpg`;

  const { error: uploadErr } = await supabaseAdmin.storage
    .from("claim-documents")
    .upload(storagePath, bytes, {
      contentType: "image/jpeg",
      upsert: true,
    });
  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { error: updateErr } = await supabaseAdmin
    .from("photos")
    .update({ annotated_path: storagePath })
    .eq("claim_id", claim_id)
    .eq("annotation_key", annotation_key);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, annotated_path: storagePath });
}

/**
 * Clear a previously-saved markup (revert to original).
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const { searchParams } = new URL(req.url);
  const claimId = searchParams.get("claim_id");
  const annotationKey = searchParams.get("annotation_key");
  if (!claimId || !annotationKey) {
    return NextResponse.json(
      { error: "claim_id and annotation_key required" },
      { status: 400 }
    );
  }
  if (!(await canAccessClaim(userId, claimId))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: row } = await supabaseAdmin
    .from("photos")
    .select("annotated_path")
    .eq("claim_id", claimId)
    .eq("annotation_key", annotationKey)
    .maybeSingle();

  if (row?.annotated_path) {
    await supabaseAdmin.storage
      .from("claim-documents")
      .remove([row.annotated_path]);
  }
  await supabaseAdmin
    .from("photos")
    .update({ annotated_path: null })
    .eq("claim_id", claimId)
    .eq("annotation_key", annotationKey);

  return NextResponse.json({ ok: true });
}
