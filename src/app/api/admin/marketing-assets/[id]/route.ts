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
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  return { user, companyId: profile.company_id };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate();
  if ("error" in g) return g.error;
  const { id } = await params;

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
  return NextResponse.json({ asset: data });
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

  const { error } = await supabaseAdmin
    .from("marketing_assets")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
