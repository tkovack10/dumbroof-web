import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getCallerCompanyId } from "@/lib/company-scope";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { id } = await params;

  const companyId = await getCallerCompanyId(auth.user.id);
  if (!companyId) {
    return NextResponse.json({ error: "No company profile" }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from("retail_estimates")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ estimate: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { id } = await params;

  const companyId = await getCallerCompanyId(auth.user.id);
  if (!companyId) {
    return NextResponse.json({ error: "No company profile" }, { status: 403 });
  }

  const { error } = await supabaseAdmin
    .from("retail_estimates")
    .delete()
    .eq("id", id)
    .eq("company_id", companyId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
