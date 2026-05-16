import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * POST /api/claim/[id]/commission-request
 * Body: { type: 'check_10pct' | 'aob_100' | 'other', amount_cents, photo_path?,
 *         related_check_upload_id?, notes? }
 *
 * Sales rep submits a commission request against a claim. Default amounts:
 *   - check_10pct: 10% of the related check (caller computes — we just store)
 *   - aob_100:     $100 flat (caller can override for company-specific rules)
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

  const { data: claim } = await supabase
    .from("claims")
    .select("id, company_id")
    .eq("id", claimId)
    .maybeSingle();

  if (!claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("commission_requests")
    .insert({
      claim_id: claimId,
      company_id: claim.company_id,
      rep_user_id: user.id,
      type,
      amount_cents: Math.round(amount_cents),
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
      title: `Commission requested — $${(amount_cents / 100).toFixed(2)} (${type})`,
      metadata: {
        commission_request_id: inserted.id,
        type,
        amount_cents: Math.round(amount_cents),
        rep_user_id: user.id,
      },
      occurred_at: new Date().toISOString(),
      created_by: user.id,
      source: "user",
    });

  return NextResponse.json({ commission_request: inserted });
}
