import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Read gate — any signed-in user with a company_profile (reps see templates too). */
async function readGate() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, company_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.company_id) {
    return { error: NextResponse.json({ error: "No company profile" }, { status: 403 }) };
  }
  return { user, companyId: profile.company_id, isAdmin: !!profile.is_admin };
}

/** Write gate — must be admin of the company. */
async function writeGate() {
  const g = await readGate();
  if ("error" in g) return g;
  if (!g.isAdmin) return { error: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  return g;
}

/**
 * GET /api/admin/email-templates
 * Returns templates visible to this company:
 *   - all rows where company_id IS NULL (global) — read-only
 *   - all rows where company_id = caller.company_id (overrides) — editable
 * Marks `is_global` so the UI can distinguish.
 */
export async function GET() {
  const g = await readGate();
  if ("error" in g) return g.error;

  const { data, error } = await supabaseAdmin
    .from("email_templates")
    .select("*")
    .or(`company_id.is.null,company_id.eq.${g.companyId}`)
    .order("trigger_offset_days", { ascending: true, nullsFirst: false })
    .order("slug", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data || []).map(r => ({ ...r, is_global: r.company_id === null }));
  return NextResponse.json({ templates: rows, caller_is_admin: g.isAdmin });
}

/**
 * POST /api/admin/email-templates
 * Body: { slug, subject, body_text, body_html?, trigger_type?, trigger_offset_days?,
 *         trigger_event?, default_attachments?, active?, clone_from? }
 *
 * If `clone_from` is a template id (typically a global), seeds the new row from
 * that template's content. Otherwise uses the provided fields directly.
 * Always creates with company_id = caller's company.
 */
export async function POST(request: Request) {
  const g = await writeGate();
  if ("error" in g) return g.error;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  let seed: Record<string, unknown> = {};
  if (body.clone_from) {
    const { data: src } = await supabaseAdmin
      .from("email_templates")
      .select("slug, subject, body_html, body_text, default_attachments, trigger_type, trigger_offset_days, trigger_event")
      .eq("id", body.clone_from as string)
      .maybeSingle();
    if (!src) return NextResponse.json({ error: "clone_from template not found" }, { status: 404 });
    seed = src;
  }

  const row: Record<string, unknown> = {
    company_id: g.companyId,
    slug: body.slug ?? seed.slug,
    subject: body.subject ?? seed.subject ?? "",
    body_text: body.body_text ?? seed.body_text ?? "",
    body_html: body.body_html ?? seed.body_html ?? null,
    trigger_type: body.trigger_type ?? seed.trigger_type ?? "time",
    trigger_offset_days: body.trigger_offset_days ?? seed.trigger_offset_days ?? null,
    trigger_event: body.trigger_event ?? seed.trigger_event ?? null,
    default_attachments: body.default_attachments ?? seed.default_attachments ?? [],
    active: body.active ?? true,
  };

  if (!row.slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("email_templates")
    .insert(row)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: { ...data, is_global: false } });
}
