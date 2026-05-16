import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * POST /api/claim/[id]/upload-check
 * Body: { photo_path, amount_cents?, source, payor?, notes? }
 *
 * Photo is uploaded client-side via createSignedUploadUrl (bypasses Vercel 4.5MB
 * body limit) — this endpoint only records the metadata after the upload succeeds.
 * Same pattern as logo upload in dashboard/admin/company/page.tsx.
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
  const { photo_path, amount_cents, source, payor, notes } = body;

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

  return NextResponse.json({ check: inserted });
}
