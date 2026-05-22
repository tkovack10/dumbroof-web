import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * GET /api/claims/search?q=<query>&limit=10
 * Lightweight typeahead — returns claims in the caller's company whose address
 * or homeowner_name contains the query. Admin-scoped (used by the unmatched
 * triage UI to attach a row to an existing claim).
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
  if (!profile?.company_id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const companyId = profile.company_id;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(50, parseInt(url.searchParams.get("limit") || "10", 10));

  if (q.length < 2) {
    return NextResponse.json({ claims: [] });
  }

  // OR across address + homeowner_name + claim_number (ilike)
  // PostgREST `or=` syntax: or=(address.ilike.*foo*,homeowner_name.ilike.*foo*)
  const safe = q.replace(/[%_]/g, ""); // strip wildcard chars from user input
  const pattern = `*${safe}*`;
  const { data, error } = await supabaseAdmin
    .from("claims")
    .select("id, address, homeowner_name, claim_number, carrier, status, phase")
    .eq("company_id", companyId)
    .or(`address.ilike.${pattern},homeowner_name.ilike.${pattern},claim_number.ilike.${pattern}`)
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ claims: data || [] });
}
