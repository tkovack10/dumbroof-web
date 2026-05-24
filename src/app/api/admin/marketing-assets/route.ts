import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Read gate — any signed-in user with a company_profile (reps see assets too). */
async function readGate() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabaseAdmin
    .from("company_profiles").select("is_admin, company_id").eq("user_id", user.id).maybeSingle();
  if (!profile?.company_id) {
    return { error: NextResponse.json({ error: "No company profile" }, { status: 403 }) };
  }
  return { user, companyId: profile.company_id, isAdmin: !!profile.is_admin };
}

/** Write gate — must be admin. */
async function writeGate() {
  const g = await readGate();
  if ("error" in g) return g;
  if (!g.isAdmin) return { error: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  return g;
}

/**
 * GET /api/admin/marketing-assets — list visible assets.
 * Returns: global rows (company_id IS NULL, manufacturer-seeded sample books)
 * + this company's private rows. Other companies' private assets are NOT
 * visible. Marks `is_global` so the UI can render mutation controls only on
 * company-owned rows.
 */
export async function GET() {
  const g = await readGate();
  if ("error" in g) return g.error;

  const { data, error } = await supabaseAdmin
    .from("marketing_assets")
    .select("*")
    .or(`company_id.is.null,company_id.eq.${g.companyId}`)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = await Promise.all((data || []).map(async (r) => {
    let preview_url: string | null = null;
    if (r.file_path) {
      const { data: signed } = await supabaseAdmin.storage
        .from("marketing-assets")
        .createSignedUrl(r.file_path, 300);
      preview_url = signed?.signedUrl ?? null;
    }
    return { ...r, preview_url, is_global: r.company_id === null };
  }));
  return NextResponse.json({ assets: rows, caller_is_admin: g.isAdmin });
}

/**
 * POST /api/admin/marketing-assets — register a new asset after the file was
 * uploaded via signed URL to the marketing-assets bucket.
 * Body: { slug, title, description?, category?, manufacturer?, file_path,
 *         file_size_bytes?, mime_type?, sort_order?, active? }
 */
export async function POST(request: Request) {
  const g = await writeGate();
  if ("error" in g) return g.error;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.slug || !body.title || !body.file_path) {
    return NextResponse.json({ error: "slug, title, file_path required" }, { status: 400 });
  }

  // The sign-upload route writes files under `{company_id}/...`. Reject any
  // POST whose file_path doesn't match — prevents an admin from registering
  // an asset row that claims to point at another company's storage path.
  const filePath = String(body.file_path);
  if (!filePath.startsWith(`${g.companyId}/`)) {
    return NextResponse.json({ error: "file_path must be inside this company's folder" }, { status: 400 });
  }

  const row = {
    company_id: g.companyId,
    slug: body.slug,
    title: body.title,
    description: body.description ?? null,
    category: body.category ?? null,
    manufacturer: body.manufacturer ?? null,
    file_path: filePath,
    file_size_bytes: body.file_size_bytes ?? null,
    mime_type: body.mime_type ?? null,
    sort_order: body.sort_order ?? null,
    active: body.active ?? true,
  };
  const { data, error } = await supabaseAdmin
    .from("marketing_assets").insert(row).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ asset: { ...data, is_global: false } });
}
