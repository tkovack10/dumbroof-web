import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";

/**
 * GET /api/pending-changes?claim_id={id}
 *
 * Computes pending changes by comparing feedback timestamps against
 * the claim's last_processed_at. Returns counts by type.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  const { searchParams } = new URL(req.url);
  const claimId = searchParams.get("claim_id");
  if (!claimId) {
    return NextResponse.json({ error: "claim_id required" }, { status: 400 });
  }

  // Verify access
  const authorized = await canAccessClaim(auth.user.id, claimId);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Get claim's last_processed_at and roof_sections
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from("claims")
    .select("last_processed_at, roof_sections")
    .eq("id", claimId)
    .single();

  if (claimErr || !claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  const lastProcessed = claim.last_processed_at;

  // Count photo changes since last processing
  let photoChanges = 0;
  if (lastProcessed) {
    const { count, error: photoErr } = await supabaseAdmin
      .from("annotation_feedback")
      .select("id", { count: "exact", head: true })
      .eq("claim_id", claimId)
      .gt("created_at", lastProcessed);
    if (!photoErr) photoChanges = count || 0;
  } else {
    // No processing timestamp — count all feedback
    const { count } = await supabaseAdmin
      .from("annotation_feedback")
      .select("id", { count: "exact", head: true })
      .eq("claim_id", claimId);
    photoChanges = count || 0;
  }

  // Count scope changes since last processing
  let scopeChanges = 0;
  if (lastProcessed) {
    const { count, error: scopeErr } = await supabaseAdmin
      .from("line_item_feedback")
      .select("id", { count: "exact", head: true })
      .eq("claim_id", claimId)
      .gt("created_at", lastProcessed);
    if (!scopeErr) scopeChanges = count || 0;
  } else {
    const { count } = await supabaseAdmin
      .from("line_item_feedback")
      .select("id", { count: "exact", head: true })
      .eq("claim_id", claimId);
    scopeChanges = count || 0;
  }

  // Count material overrides in roof_sections
  let measurementChanges = 0;
  const roofSections = claim.roof_sections as { sections?: { user_material_override: string | null }[] } | null;
  if (roofSections?.sections) {
    measurementChanges = roofSections.sections.filter((s) => s.user_material_override !== null).length;
  }

  const total = photoChanges + scopeChanges + measurementChanges;

  return NextResponse.json({
    photo_changes: photoChanges,
    scope_changes: scopeChanges,
    measurement_changes: measurementChanges,
    total,
    last_processed_at: lastProcessed,
  });
}
