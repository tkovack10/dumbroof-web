import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";

/**
 * GET /api/claims/{id}/events — read the timeline for a claim.
 *
 * Query params:
 *   - limit (default 100, max 500)
 *   - category: milestone | communication | document | action | system
 *
 * Returns rows from `claim_events` ordered occurred_at DESC.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { user } = auth;

  const { id: claimId } = await params;

  // Permission check — team lookup in api-auth handles shared domains.
  const allowed = await canAccessClaim(user.id, claimId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") || "100", 10)));
  const category = searchParams.get("category");

  let q = supabaseAdmin
    .from("claim_events")
    .select("id, event_type, event_category, title, description, metadata, occurred_at, source, created_by")
    .eq("claim_id", claimId)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (category) q = q.eq("event_category", category);

  const { data, error } = await q;
  if (error) {
    console.error("[claim-events] query failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ events: data || [], count: (data || []).length });
}
