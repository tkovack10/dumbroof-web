import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

async function gate() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabaseAdmin
    .from("company_profiles").select("is_admin, company_id").eq("user_id", user.id).maybeSingle();
  if (!profile?.is_admin || !profile.company_id) {
    return { error: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  }
  return { user, companyId: profile.company_id };
}

/**
 * Ownership check — caller must own the asset's company. Global assets
 * (company_id IS NULL) are NOT mutable through this route; admins must
 * upload their own copy. This is the same clone-on-edit pattern used for
 * email_templates and prevents one company's admin from renaming or
 * archiving a shared manufacturer sample book that other companies depend on.
 */
async function ownsAsset(id: string, companyId: string) {
  const { data } = await supabaseAdmin
    .from("marketing_assets").select("id, company_id").eq("id", id).maybeSingle();
  if (!data) return { error: NextResponse.json({ error: "Asset not found" }, { status: 404 }) };
  if (data.company_id === null) {
    return { error: NextResponse.json({ error: "Cannot modify a global asset — upload your own copy instead" }, { status: 403 }) };
  }
  if (data.company_id !== companyId) {
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  return { ok: true };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate();
  if ("error" in g) return g.error;
  const { id } = await params;

  const own = await ownsAsset(id, g.companyId);
  if ("error" in own) return own.error;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const allowed = ["slug", "title", "description", "category", "manufacturer", "sort_order", "active"];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) patch[k] = body[k];
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No mutable fields provided" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("marketing_assets").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ asset: { ...data, is_global: false } });
}

/**
 * DELETE — soft-delete via active=false (keeps file in storage + preserves any
 * existing references inside email_templates.default_attachments).
 * Hard delete would orphan references; we don't do that.
 */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate();
  if ("error" in g) return g.error;
  const { id } = await params;

  const own = await ownsAsset(id, g.companyId);
  if ("error" in own) return own.error;

  const { error } = await supabaseAdmin
    .from("marketing_assets")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
