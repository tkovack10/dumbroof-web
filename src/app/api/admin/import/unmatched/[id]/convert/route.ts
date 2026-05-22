import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/admin/import/unmatched/[id]/convert
 * Body: { action: 'dismiss' | 'attach_existing' | 'create_claim' | 'create_retail' }
 *
 * Triage actions:
 *   - dismiss          : mark the unmatched row dismissed (no further action)
 *   - attach_existing  : { existing_claim_id } user picked a claim manually;
 *                        we re-write the payment/install to that claim
 *   - create_claim     : minimal claim is created from the row's address +
 *                        homeowner + carrier; payment/install row attached
 *   - create_retail    : same as create_claim but writes a retail_jobs row
 *
 * For v1, 'create_claim' and 'create_retail' return guidance to use the
 * existing /dashboard/new-claim and /dashboard/retail flows respectively
 * (prefilled via the existing URL params). Those flows already handle the
 * full happy path including duplicate detection. We expose 'dismiss' and
 * 'attach_existing' as fully-automated server-side actions.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: unmatchedId } = await params;
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

  const body = await req.json().catch(() => ({}));
  const action: string = body.action;
  if (!["dismiss", "attach_existing", "create_claim", "create_retail"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  // Load the unmatched row + verify ownership.
  const { data: row } = await supabaseAdmin
    .from("import_unmatched_rows")
    .select("*")
    .eq("id", unmatchedId)
    .maybeSingle();
  if (!row || row.company_id !== companyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (row.status !== "pending") {
    return NextResponse.json(
      { error: `Already ${row.status}` },
      { status: 409 }
    );
  }

  const nowIso = new Date().toISOString();

  if (action === "dismiss") {
    await supabaseAdmin
      .from("import_unmatched_rows")
      .update({
        status: "dismissed",
        resolved_at: nowIso,
        resolved_by: user.id,
      })
      .eq("id", unmatchedId);
    return NextResponse.json({ ok: true, status: "dismissed" });
  }

  if (action === "attach_existing") {
    const claimId: string | undefined = body.claim_id;
    if (!claimId) {
      return NextResponse.json({ error: "claim_id required" }, { status: 400 });
    }
    // Verify the claim belongs to this company
    const { data: claim } = await supabaseAdmin
      .from("claims")
      .select("id, company_id")
      .eq("id", claimId)
      .maybeSingle();
    if (!claim || claim.company_id !== companyId) {
      return NextResponse.json({ error: "Claim not found" }, { status: 404 });
    }

    // If this is a payment row, write the check_upload now.
    if (row.kind === "payments" && row.payment_amount_cents && row.payment_date) {
      const externalRef = `triage:${unmatchedId}`;
      // Idempotency: if the user clicks attach_existing twice, the
      // partial unique index on (claim_id, amount_cents, received_at,
      // external_ref) WHERE external_ref IS NOT NULL would normally guard
      // duplicates, but PostgREST on_conflict needs a NON-partial constraint
      // (raises 42P10). So we check for an existing triage row first.
      const { data: existing } = await supabaseAdmin
        .from("check_uploads")
        .select("id")
        .eq("external_ref", externalRef)
        .limit(1)
        .maybeSingle();
      if (!existing) {
        // Try to recover the original source classification from the raw row
        // (set by the parser when it extracted the check details). Fall back
        // to 'insurance' since most carrier-paid claims land here.
        const rawChecks =
          (row.raw && typeof row.raw === "object" && "checks" in row.raw
            ? ((row.raw as { checks?: Array<{ source?: string; payor?: string }> }).checks ?? [])
            : []);
        const firstCheck = rawChecks[0] || {};
        const validSources = new Set(["insurance", "homeowner", "stripe_invoice", "other"]);
        const recoveredSource =
          firstCheck.source && validSources.has(firstCheck.source)
            ? firstCheck.source
            : "insurance";
        const { error: insErr } = await supabaseAdmin
          .from("check_uploads")
          .insert({
            claim_id: claimId,
            company_id: companyId,
            uploader_user_id: user.id,
            photo_path: null,
            amount_cents: row.payment_amount_cents,
            received_at: row.payment_date,
            source: recoveredSource,
            payor: firstCheck.payor ?? null,
            external_ref: externalRef,
            notes: `Attached via unmatched triage (import_run ${row.import_run_id})`,
            import_run_id: row.import_run_id,
          });
        if (insErr) {
          return NextResponse.json({ error: insErr.message }, { status: 500 });
        }
      }
    }
    // (install kind not yet implemented — will land with AccuLynx live sync.)

    await supabaseAdmin
      .from("import_unmatched_rows")
      .update({
        status: "converted_claim",
        resolved_claim_id: claimId,
        resolved_at: nowIso,
        resolved_by: user.id,
      })
      .eq("id", unmatchedId);

    return NextResponse.json({ ok: true, status: "converted_claim", claim_id: claimId });
  }

  if (action === "create_claim") {
    // V1: send the user to the new-claim flow with prefilled URL params.
    // After the user creates the claim, they re-open the unmatched row and
    // pick attach_existing with the new claim_id. This avoids us silently
    // creating partial-claim rows from limited CSV data.
    const params = new URLSearchParams({
      address: row.address || "",
      homeowner_name: row.homeowner_name || "",
      carrier: row.carrier || "",
      claim_number: row.claim_number || "",
      from_unmatched: unmatchedId,
    });
    return NextResponse.json({
      ok: true,
      redirect_to: `/dashboard/new-claim?${params.toString()}`,
    });
  }

  if (action === "create_retail") {
    const params = new URLSearchParams({
      customer_name: row.homeowner_name || "",
      address: row.address || "",
      from_unmatched: unmatchedId,
    });
    return NextResponse.json({
      ok: true,
      redirect_to: `/dashboard/retail?${params.toString()}`,
    });
  }

  return NextResponse.json({ error: "Unhandled action" }, { status: 400 });
}
