import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";

/** GET — list templates (user's own + system templates) */
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  const { data, error } = await supabaseAdmin
    .from("document_templates")
    .select("id, name, document_type, description, page_count, fields, is_system, is_active, created_at")
    .or(`user_id.eq.${auth.user.id},is_system.eq.true`)
    .eq("is_active", true)
    .order("is_system", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ templates: data || [] });
}

/** POST — create a new template */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  const body = await req.json();
  const { name, document_type, description, pdf_storage_path, page_count, fields } = body;

  if (!name || !pdf_storage_path) {
    return NextResponse.json({ error: "name and pdf_storage_path required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("document_templates")
    .insert({
      user_id: auth.user.id,
      name,
      document_type: document_type || "aob",
      description: description || null,
      pdf_storage_path,
      page_count: page_count || 1,
      fields: fields || [],
      is_system: false,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, template_id: data.id });
}
