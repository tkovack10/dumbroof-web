import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const BUCKET = "company-documents";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * POST /api/company-docs/upload-url — issue a Supabase Storage signed upload URL.
 *
 * Client flow:
 *   1. POST /api/company-docs/upload-url with { filename, content_type, size }
 *   2. Receive { upload_url, token, storage_path }
 *   3. PUT the file to upload_url directly from the browser
 *   4. POST /api/company-docs with { name, storage_path, file_size, mime_type }
 *
 * We use signed upload URLs (createSignedUploadUrl) so the file body never
 * passes through our Next.js function — Vercel caps regular API route
 * bodies at 4.5 MB, but the storage upload is direct to Supabase and lifts
 * us to the 50 MB bucket cap.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  let body: { filename?: string; content_type?: string; size?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.filename) {
    return NextResponse.json({ error: "filename required" }, { status: 400 });
  }
  if (body.size && body.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File exceeds ${MAX_FILE_SIZE / (1024 * 1024)} MB limit` },
      { status: 413 },
    );
  }

  // Sanitize filename — keep extension only, randomize stem so colliding
  // uploads don't overwrite each other.
  const safeName = body.filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  const ext = (safeName.match(/\.[A-Za-z0-9]+$/)?.[0] || "").toLowerCase();
  const random = crypto.randomBytes(8).toString("hex");
  const storage_path = `${auth.user.id}/${random}${ext}`;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(storage_path);

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Could not issue upload URL" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    storage_path,
    upload_url: data.signedUrl,
    token: data.token,
    suggested_name: safeName,
  });
}
