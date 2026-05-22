import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getCallerCompanyId } from "@/lib/company-scope";

export const dynamic = "force-dynamic";

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

interface CreateBody {
  name: string;
  storage_path: string;
  file_size?: number;
  mime_type?: string;
  category?: string;
  description?: string;
  send_to?: string[];
  homeowner_sequence_eligible?: boolean;
}

/**
 * GET /api/company-docs — list every doc belonging to the caller's company.
 *
 * Company-scoped: any user in the same company can see docs uploaded by
 * any other user in that company. user_id is kept on the row as
 * "uploaded_by" audit metadata but is not used for access gating.
 */
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  const companyId = await getCallerCompanyId(auth.user.id);
  if (!companyId) {
    return NextResponse.json(
      { error: "No company profile — finish onboarding to use Company Docs" },
      { status: 403 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("company_documents")
    .select(
      "id, name, category, storage_path, file_size, mime_type, description, send_to, homeowner_sequence_eligible, display_order, created_at, updated_at, user_id",
    )
    .eq("company_id", companyId)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ docs: data || [] });
}

/**
 * POST /api/company-docs — register an already-uploaded doc.
 *
 * Companion to /api/company-docs/upload-url which issues a signed upload
 * URL the browser PUTs the file to. This route persists the metadata row
 * pointing at the uploaded storage_path so the doc shows up in everyone's
 * company list.
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

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.name || !body.storage_path) {
    return NextResponse.json({ error: "name and storage_path required" }, { status: 400 });
  }
  // Defense in depth: the storage_path must start with the caller's company_id.
  // Storage RLS already enforces this, but checking here gives a clean error.
  if (!body.storage_path.startsWith(`${companyId}/`)) {
    return NextResponse.json(
      { error: "storage_path doesn't match caller's company scope" },
      { status: 400 },
    );
  }

  const category =
    body.category && ALLOWED_CATEGORIES.has(body.category) ? body.category : "general";
  const sendTo = Array.isArray(body.send_to)
    ? body.send_to.filter((s) => ALLOWED_SEND_TO.has(s))
    : [];

  const { data, error } = await supabaseAdmin
    .from("company_documents")
    .insert({
      user_id: auth.user.id, // uploaded_by audit
      company_id: companyId,
      name: body.name.slice(0, 240),
      category,
      storage_path: body.storage_path,
      file_size: body.file_size ?? null,
      mime_type: body.mime_type ?? null,
      description: body.description?.slice(0, 1000) ?? null,
      send_to: sendTo,
      homeowner_sequence_eligible: !!body.homeowner_sequence_eligible,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ doc: data });
}
