import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * GET /api/admin/import/unmatched?kind=payments|installs|all&status=pending|all
 *
 * Lists rows the importer couldn't match to a claim. Tom triages these:
 * promote to claim, promote to retail estimate, or dismiss.
 *
 * Defaults: kind=all, status=pending (= the actionable inbox).
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, company_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.is_admin || !profile.company_id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const companyId = profile.company_id;

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") || "all";
  const status = url.searchParams.get("status") || "pending";

  let q = supabaseAdmin
    .from("import_unmatched_rows")
    .select(
      "id, import_run_id, kind, raw, address, homeowner_name, payment_amount_cents, " +
      "payment_date, install_date, carrier, job_number, claim_number, status, " +
      "resolved_claim_id, resolved_at, created_at"
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (kind !== "all") q = q.eq("kind", kind);
  if (status !== "all") q = q.eq("status", status);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rows: data || [] });
}
