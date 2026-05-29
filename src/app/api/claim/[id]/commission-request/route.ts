import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AOB_CLAIM_FIELDS, aobMissing } from "@/lib/aob-eligibility";
import { AOB_COMMISSION_CENTS } from "@/lib/commissions";

/**
 * POST /api/claim/[id]/commission-request
 * Body: { type: 'check_10pct' | 'aob_100' | 'other', amount_cents, photo_path?,
 *         related_check_upload_id?, notes? }
 *
 * Sales rep submits a commission request against a claim. Amounts:
 *   - check_10pct: 10% of the related check (caller computes — we just store)
 *   - aob_100:     flat $100, forced server-side (client amount is ignored)
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
  const { type, amount_cents, photo_path, related_check_upload_id, notes } = body;

  if (!["check_10pct", "aob_100", "other"].includes(type)) {
    return NextResponse.json(
      { error: "type must be check_10pct, aob_100, or other" },
      { status: 400 }
    );
  }

  if (
    typeof amount_cents !== "number" ||
    !Number.isFinite(amount_cents) ||
    amount_cents <= 0
  ) {
    return NextResponse.json(
      { error: "amount_cents must be a positive number" },
      { status: 400 }
    );
  }

  const { data: claim, error: claimErr } = await supabase
    .from("claims")
    .select(["id", "company_id", ...AOB_CLAIM_FIELDS].join(", "))
    .eq("id", claimId)
    .maybeSingle();

  // Surface a real DB error (e.g. a column drift in AOB_CLAIM_FIELDS) instead of
  // masking it as "Claim not found" — otherwise a complete claim looks blocked
  // with zero signal about the actual cause.
  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }
  if (!claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  // Dynamic select string isn't statically inferrable — cast to the known shape.
  const claimRow = claim as unknown as { company_id: string | null } & Parameters<
    typeof aobMissing
  >[0];

  // The $100 signed-AOB commission is gated on a complete, real claim:
  // homeowner name/phone/email, carrier claim #, a deliverable carrier email
  // (adjuster OR carrier claims email), inspection photos, and the signed AOB
  // on file. Enforced here (not just in the UI) so the gate can't be bypassed
  // via the API. Single source of truth lives in @/lib/aob-eligibility.
  if (type === "aob_100") {
    const missing = aobMissing(claimRow);
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error:
            "This claim isn't complete enough for the $100 AOB commission yet.",
          missing,
        },
        { status: 422 }
      );
    }

    // One $100 per signed AOB per claim — block duplicates (a rep re-submitting,
    // or two reps claiming the same AOB). Uses the admin client so it sees the
    // whole claim's requests, not just the caller's own (RLS-scoped) rows.
    const { data: existing } = await supabaseAdmin
      .from("commission_requests")
      .select("id")
      .eq("claim_id", claimId)
      .eq("type", "aob_100")
      .in("status", ["pending", "approved", "paid"])
      .limit(1);
    if (existing && existing.length > 0) {
      return NextResponse.json(
        {
          error:
            "A $100 AOB commission has already been submitted for this claim.",
        },
        { status: 409 }
      );
    }
  }

  // The $100 AOB amount is fixed — never trust a client-supplied amount for it.
  const finalAmountCents =
    type === "aob_100" ? AOB_COMMISSION_CENTS : Math.round(amount_cents);

  const { data: inserted, error: insertErr } = await supabase
    .from("commission_requests")
    .insert({
      claim_id: claimId,
      company_id: claimRow.company_id,
      rep_user_id: user.id,
      type,
      amount_cents: finalAmountCents,
      photo_path: photo_path || null,
      related_check_upload_id: related_check_upload_id || null,
      notes: notes || null,
    })
    .select()
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message || "Failed to submit commission request" },
      { status: 500 }
    );
  }

  // Emit claim_event so admins see it in their inbox + Recent Activity.
  await supabaseAdmin
    .from("claim_events")
    .insert({
      claim_id: claimId,
      event_type: "commission_requested",
      event_category: "action",
      title: `Commission requested — $${(finalAmountCents / 100).toFixed(2)} (${type})`,
      metadata: {
        commission_request_id: inserted.id,
        type,
        amount_cents: finalAmountCents,
        rep_user_id: user.id,
      },
      occurred_at: new Date().toISOString(),
      created_by: user.id,
      source: "user",
    });

  return NextResponse.json({ commission_request: inserted });
}
