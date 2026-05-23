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

async function ownsTemplate(id: string, companyId: string) {
  const { data } = await supabaseAdmin
    .from("email_templates").select("id, company_id").eq("id", id).maybeSingle();
  if (!data) return { error: NextResponse.json({ error: "Template not found" }, { status: 404 }) };
  if (data.company_id === null) {
    return { error: NextResponse.json({ error: "Cannot modify global template — clone it first" }, { status: 403 }) };
  }
  if (data.company_id !== companyId) {
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  return { ok: true };
}

/** PATCH partial update — only fields provided are touched. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate();
  if ("error" in g) return g.error;
  const { id } = await params;

  const own = await ownsTemplate(id, g.companyId);
  if ("error" in own) return own.error;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const allowed = [
    "subject", "body_text", "body_html", "trigger_type", "trigger_offset_days",
    "trigger_event", "default_attachments", "active", "slug",
  ];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) patch[k] = body[k];
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No mutable fields provided" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("email_templates").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: { ...data, is_global: false } });
}

/** DELETE — only company-owned templates. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate();
  if ("error" in g) return g.error;
  const { id } = await params;
  const own = await ownsTemplate(id, g.companyId);
  if ("error" in own) return own.error;

  const { error } = await supabaseAdmin.from("email_templates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
