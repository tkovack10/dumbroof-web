import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_{2,}/g, "_");
}

/**
 * POST /api/admin/marketing-assets/sign-upload
 * Body: { fileName, fileSize? }
 *
 * Returns a Supabase signed upload URL to the marketing-assets bucket.
 * Client uploads directly to the URL → avoids the 4.5MB Vercel body limit.
 * Path: {company_id}/{timestamp}_{safe_filename}
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: profile } = await supabaseAdmin
    .from("company_profiles").select("is_admin, company_id").eq("user_id", user.id).maybeSingle();
  if (!profile?.is_admin || !profile.company_id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: { fileName?: string; fileSize?: number };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.fileName) return NextResponse.json({ error: "fileName required" }, { status: 400 });

  const safe = sanitizeFileName(body.fileName);
  const fullPath = `${profile.company_id}/${Date.now()}_${safe}`;

  const { data, error } = await supabaseAdmin.storage
    .from("marketing-assets")
    .createSignedUploadUrl(fullPath, { upsert: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    signedUrl: data.signedUrl,
    token: data.token,
    path: fullPath,
    safeName: safe,
  });
}
