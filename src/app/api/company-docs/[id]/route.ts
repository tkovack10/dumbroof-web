import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getCallerCompanyId } from "@/lib/company-scope";

export const dynamic = "force-dynamic";

const BUCKET = "company-documents";
const ALLOWED_CATEGORIES = new Set([
  "general",
  "sample_book",
  "brochure",
  "spec_sheet",
  "warranty",
  "license_insurance",
  "marketing",
  "testimonial",
  "process",
]);
const ALLOWED_SEND_TO = new Set(["customer", "lead", "insurance", "homeowner"]);

/** GET /api/company-docs/[id] — single doc + signed view URL (company-scoped). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { id } = await params;

  const companyId = await getCallerCompanyId(auth.user.id);
  if (!companyId) {
    return NextResponse.json({ error: "No company profile" }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from("company_documents")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: signed } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(data.storage_path, 60 * 60);

  return NextResponse.json({ doc: data, signed_url: signed?.signedUrl || null });
}

/** PATCH /api/company-docs/[id] — any teammate in the company can edit metadata. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { id } = await params;

  const companyId = await getCallerCompanyId(auth.user.id);
  if (!companyId) {
    return NextResponse.json({ error: "No company profile" }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.slice(0, 240);
  if (typeof body.description === "string") patch.description = body.description.slice(0, 1000);
  if (typeof body.category === "string" && ALLOWED_CATEGORIES.has(body.category))
    patch.category = body.category;
  if (Array.isArray(body.send_to))
    patch.send_to = body.send_to.filter(
      (s): s is string => typeof s === "string" && ALLOWED_SEND_TO.has(s),
    );
  if (typeof body.homeowner_sequence_eligible === "boolean")
    patch.homeowner_sequence_eligible = body.homeowner_sequence_eligible;
  if (typeof body.display_order === "number") patch.display_order = body.display_order;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No allowed fields in body" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("company_documents")
    .update(patch)
    .eq("id", id)
    .eq("company_id", companyId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ doc: data });
}

/** DELETE /api/company-docs/[id] — any teammate in the company can delete. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { id } = await params;

  const companyId = await getCallerCompanyId(auth.user.id);
  if (!companyId) {
    return NextResponse.json({ error: "No company profile" }, { status: 403 });
  }

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from("company_documents")
    .select("storage_path")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (existing.storage_path) {
    try {
      await supabaseAdmin.storage.from(BUCKET).remove([existing.storage_path]);
    } catch {
      // ignore — proceed with DB delete
    }
  }

  const { error: delErr } = await supabaseAdmin
    .from("company_documents")
    .delete()
    .eq("id", id)
    .eq("company_id", companyId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
