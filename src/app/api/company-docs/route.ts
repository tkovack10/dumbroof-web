import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";

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

/** GET /api/company-docs — list the caller's company docs. */
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  const { data, error } = await supabaseAdmin
    .from("company_documents")
    .select(
      "id, name, category, storage_path, file_size, mime_type, description, send_to, homeowner_sequence_eligible, display_order, created_at, updated_at",
    )
    .eq("user_id", auth.user.id)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ docs: data || [] });
}

/**
 * POST /api/company-docs — register an already-uploaded doc.
 *
 * The actual file upload happens directly to Supabase Storage from the
 * browser via a signed upload URL (POST /api/company-docs/upload-url) so
 * we sidestep Vercel's 4.5 MB body limit on regular API routes. This route
 * just persists the metadata row pointing at the uploaded storage_path.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.name || !body.storage_path) {
    return NextResponse.json({ error: "name and storage_path required" }, { status: 400 });
  }

  // Whitelist + cleanup
  const category =
    body.category && ALLOWED_CATEGORIES.has(body.category) ? body.category : "general";
  const sendTo = Array.isArray(body.send_to)
    ? body.send_to.filter((s) => ALLOWED_SEND_TO.has(s))
    : [];

  const { data: profile } = await supabaseAdmin
    .from("company_profiles")
    .select("company_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  const { data, error } = await supabaseAdmin
    .from("company_documents")
    .insert({
      user_id: auth.user.id,
      company_id: profile?.company_id || null,
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
