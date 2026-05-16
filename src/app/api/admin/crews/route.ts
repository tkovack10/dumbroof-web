import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * GET /api/admin/crews
 * POST /api/admin/crews — body: { name, color?, members?, lead_user_id?, notes? }
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, company_id")
    .eq("user_id", user.id)
    .limit(1);
  if (!profileRows?.[0]?.is_admin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const companyId = profileRows[0].company_id;
  if (!companyId) return NextResponse.json({ crews: [] });

  const { data: crews } = await supabaseAdmin
    .from("crews")
    .select("*")
    .eq("company_id", companyId)
    .order("active", { ascending: false })
    .order("name");

  return NextResponse.json({ crews: crews || [] });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, company_id")
    .eq("user_id", user.id)
    .limit(1);
  if (!profileRows?.[0]?.is_admin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const companyId = profileRows[0].company_id;
  if (!companyId) {
    return NextResponse.json({ error: "No company on profile" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const name = (body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const color = typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color)
    ? body.color
    : "#22D8FF";

  const members = Array.isArray(body.members)
    ? body.members.filter((m: unknown) => typeof m === "string")
    : [];

  const { data: crew, error } = await supabaseAdmin
    .from("crews")
    .insert({
      company_id: companyId,
      name,
      color,
      lead_user_id: body.lead_user_id || null,
      members,
      notes: body.notes || null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error || !crew) {
    return NextResponse.json(
      { error: error?.message || "Create failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ crew });
}
