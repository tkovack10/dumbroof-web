import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getCallerCompanyId } from "@/lib/company-scope";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const BUCKET = "company-documents";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * POST /api/company-docs/upload-url — issue a signed Supabase Storage upload URL.
 *
 * Storage path namespace: company-documents/{company_id}/{random}.{ext}
 * Folder prefix is company_id (not user_id) so every teammate can read
 * docs uploaded by any other teammate. Storage RLS gates on
 * {company_id}/ matching the caller's company_profile.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  const companyId = await getCallerCompanyId(auth.user.id);
  if (!companyId) {
    return NextResponse.json(
      { error: "No company profile — finish onboarding to use Company Docs" },
      { status: 403 },
    );
  }

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

  const safeName = body.filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  const ext = (safeName.match(/\.[A-Za-z0-9]+$/)?.[0] || "").toLowerCase();
  const random = crypto.randomBytes(8).toString("hex");
  const storage_path = `${companyId}/${random}${ext}`;

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
