import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";
import type { RoofSectionsData } from "@/types/roof-sections";

/**
 * GET /api/roof-sections?claim_id={id}
 * Returns the roof_sections data for a claim.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  const { searchParams } = new URL(req.url);
  const claimId = searchParams.get("claim_id");
  if (!claimId) {
    return NextResponse.json({ error: "claim_id required" }, { status: 400 });
  }

  const authorized = await canAccessClaim(auth.user.id, claimId);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from("claims")
    .select("roof_sections")
    .eq("id", claimId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ roof_sections: data?.roof_sections || null });
}

/**
 * PUT /api/roof-sections
 * Updates a single section's user_material_override.
 * Also writes to estimate_request.structures[i].roof_material for backend compatibility.
 *
 * Body: { claim_id, section_index, material }
 * material = null to clear override
 */
export async function PUT(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  const body = await req.json();
  const { claim_id, section_index, material } = body;

  if (!claim_id || section_index === undefined) {
    return NextResponse.json({ error: "claim_id and section_index required" }, { status: 400 });
  }

  const authorized = await canAccessClaim(auth.user.id, claim_id);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Get current roof_sections and estimate_request
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from("claims")
    .select("roof_sections, estimate_request")
    .eq("id", claim_id)
    .single();

  if (claimErr || !claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  const roofSections = claim.roof_sections as RoofSectionsData | null;
  if (!roofSections?.sections || section_index >= roofSections.sections.length) {
    return NextResponse.json({ error: "Invalid section index" }, { status: 400 });
  }

  // Update the specific section's override
  roofSections.sections[section_index].user_material_override = material || null;

  // Also update estimate_request.structures[i].roof_material for backend compatibility
  const estimateRequest = (claim.estimate_request as Record<string, unknown>) || {};
  const section = roofSections.sections[section_index];
  const structIndex = section.structure_index;

  // Ensure structures array exists and is large enough
  const structures = (estimateRequest.structures as Record<string, unknown>[]) || [];
  while (structures.length <= structIndex) {
    structures.push({});
  }
  if (material) {
    structures[structIndex].roof_material = material;
  } else {
    delete structures[structIndex].roof_material;
  }
  estimateRequest.structures = structures;

  // Save both
  const { error: updateErr } = await supabaseAdmin
    .from("claims")
    .update({
      roof_sections: roofSections,
      estimate_request: estimateRequest,
    })
    .eq("id", claim_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, roof_sections: roofSections });
}
