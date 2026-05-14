import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";

export const maxDuration = 30;

/**
 * Photo markup save — two-step protocol so we never push image bytes
 * through a Vercel serverless function (4.5 MB body limit fires on
 * 12 MP iPhone JPEGs even after JPEG-encoding).
 *
 * Step 1 (mint):   POST { claim_id, annotation_key, byte_length }
 *                  → returns { upload_url, storage_path }
 *                  Client PUTs the JPEG directly to Supabase via the URL.
 *
 * Step 2 (finalize): POST { claim_id, annotation_key, finalize_storage_path }
 *                  → records photos.annotated_path so Damage Assessment list
 *                    + PDFs prefer the marked-up copy on next read.
 *
 * Two POSTs to the same path. The mint vs finalize branch is determined by
 * which field is set in the body. Idempotent (PUT can be retried; finalize
 * is just an UPDATE).
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  let body: {
    claim_id?: string;
    annotation_key?: string;
    byte_length?: number;
    finalize_storage_path?: string;
    // Legacy field — kept for back-compat with any client that still
    // sends the whole image inline. New clients use the two-step flow.
    image_base64?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { claim_id, annotation_key, byte_length, finalize_storage_path, image_base64 } = body;
  if (!claim_id || !annotation_key) {
    return NextResponse.json(
      { error: "claim_id and annotation_key required" },
      { status: 400 }
    );
  }
  if (!(await canAccessClaim(userId, claim_id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
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
  const storagePath = `${claim.file_path}/photos/${safeKey}.marked.jpg`;

  // ─── Finalize step ───
  // Just record the path; the byte upload already happened directly to Supabase.
  if (finalize_storage_path) {
    if (finalize_storage_path !== storagePath) {
      return NextResponse.json(
        { error: "Finalize path mismatch" },
        { status: 400 }
      );
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

  // ─── Legacy inline-bytes path (kept for back-compat) ───
  if (image_base64) {
    const b64 = image_base64.includes(",")
      ? image_base64.split(",", 2)[1]
      : image_base64;
    let bytes: Buffer;
    try {
      bytes = Buffer.from(b64, "base64");
    } catch {
      return NextResponse.json({ error: "Bad base64 payload" }, { status: 400 });
    }
    if (bytes.length > 8 * 1024 * 1024) {
      return NextResponse.json({ error: "Image too large (8 MB max)" }, { status: 413 });
    }
    const { error: uploadErr } = await supabaseAdmin.storage
      .from("claim-documents")
      .upload(storagePath, bytes, { contentType: "image/jpeg", upsert: true });
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

  // ─── Mint step (default) ───
  // Pre-flight size check — 16 MB ceiling on the actual upload, well above
  // the client's downscale+JPEG output (~500KB-1MB) but generous enough to
  // accept full-res markups when somebody runs this from a desktop browser.
  if (byte_length && byte_length > 16 * 1024 * 1024) {
    return NextResponse.json(
      { error: `Image too large (${(byte_length / 1024 / 1024).toFixed(1)} MB; 16 MB max)` },
      { status: 413 }
    );
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from("claim-documents")
    .createSignedUploadUrl(storagePath, { upsert: true });
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { error: signErr?.message || "Could not create upload URL" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    upload_url: signed.signedUrl,
    storage_path: storagePath,
  });
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
