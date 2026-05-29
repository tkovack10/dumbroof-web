import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { commissionCentsForCheck } from "@/lib/commissions";

/**
 * POST /api/claim/[id]/upload-check
 * Body: { photo_path, amount_cents?, source, payor?, notes?, request_commission? }
 *
 * Photo is uploaded client-side via createSignedUploadUrl (bypasses Vercel 4.5MB
 * body limit) — this endpoint only records the metadata after the upload succeeds.
 * Same pattern as logo upload in dashboard/admin/company/page.tsx.
 *
 * When request_commission is true AND an amount is present, the rep's 10%
 * commission request is filed in the same step (linked to the check) so they
 * don't have to submit it separately.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: claimId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { photo_path, amount_cents, source, payor, notes, request_commission } =
    body;

  if (!photo_path || typeof photo_path !== "string") {
    return NextResponse.json(
      { error: "photo_path is required" },
      { status: 400 }
    );
  }

  const validSources = ["insurance", "homeowner", "stripe_invoice", "other"];
  const finalSource = validSources.includes(source) ? source : "insurance";

  // Verify the caller can access this claim (RLS handles team scoping).
  const { data: claim, error: claimErr } = await supabase
    .from("claims")
    .select("id, company_id")
    .eq("id", claimId)
    .maybeSingle();

  if (claimErr || !claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  const amountInt =
    typeof amount_cents === "number" && Number.isFinite(amount_cents)
      ? Math.round(amount_cents)
      : null;

  const { data: inserted, error: insertErr } = await supabase
    .from("check_uploads")
    .insert({
      claim_id: claimId,
      company_id: claim.company_id,
      uploader_user_id: user.id,
      photo_path,
      amount_cents: amountInt,
      source: finalSource,
      payor: payor || null,
      notes: notes || null,
    })
    .select()
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message || "Failed to record check" },
      { status: 500 }
    );
  }

  // Emit claim_event using service role so RLS doesn't block the write —
  // the event is for the entire team's timeline, not just the uploader.
  await supabaseAdmin
    .from("claim_events")
    .insert({
      claim_id: claimId,
      event_type: "check_received",
      event_category: "milestone",
      title: amountInt
        ? `Check received — $${(amountInt / 100).toFixed(2)}`
        : "Check received",
      metadata: {
        check_upload_id: inserted.id,
        source: finalSource,
        payor: payor || null,
        amount_cents: amountInt,
      },
      occurred_at: new Date().toISOString(),
      created_by: user.id,
      source: "user",
    })
    .then(({ error }) => {
      if (error) {
        console.warn("[upload-check] claim_event insert failed:", error.message);
      }
    });

  // One-step: file the rep's 10% commission alongside the check upload so they
  // don't have to submit it separately. Requires a known amount to compute 10%.
  let commission = null;
  if (request_commission && amountInt && amountInt > 0) {
    const commissionCents = commissionCentsForCheck(amountInt);
    const { data: comm, error: commErr } = await supabase
      .from("commission_requests")
      .insert({
        claim_id: claimId,
        company_id: claim.company_id,
        rep_user_id: user.id,
        type: "check_10pct",
        amount_cents: commissionCents,
        photo_path,
        related_check_upload_id: inserted.id,
        notes: notes || null,
      })
      .select()
      .single();

    if (commErr) {
      // The check is already recorded — don't fail the whole request. Surface
      // a warning so the client can tell the rep to file the commission manually.
      console.warn(
        "[upload-check] commission auto-create failed:",
        commErr.message
      );
    } else {
      commission = comm;
      await supabaseAdmin.from("claim_events").insert({
        claim_id: claimId,
        event_type: "commission_requested",
        event_category: "action",
        title: `Commission requested — $${(commissionCents / 100).toFixed(2)} (check_10pct)`,
        metadata: {
          commission_request_id: comm.id,
          type: "check_10pct",
          amount_cents: commissionCents,
          related_check_upload_id: inserted.id,
          rep_user_id: user.id,
        },
        occurred_at: new Date().toISOString(),
        created_by: user.id,
        source: "user",
      });
    }
  }

  return NextResponse.json({
    check: inserted,
    commission,
    commission_requested: !!commission,
  });
}
