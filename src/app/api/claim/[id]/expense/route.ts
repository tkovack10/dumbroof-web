import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logClaimEvent } from "@/lib/claim-events";

const VALID_TYPES = [
  "material",
  "labor",
  "dumpster",
  "permit",
  "rental",
  "subcontractor",
  "misc",
] as const;
type ExpenseType = (typeof VALID_TYPES)[number];

/**
 * GET /api/claim/[id]/expense
 * Returns all expenses for one claim, ordered most-recent-first.
 *
 * POST /api/claim/[id]/expense
 * Body: { type, amount_cents, vendor?, description?, receipt_path?,
 *         occurred_at?, line_items?, notes? }
 *
 * The receipt photo is uploaded client-side via createSignedUploadUrl
 * (same pattern as Phase 1 check uploads); this endpoint records the
 * metadata after a successful upload.
 */
export async function GET(
  _req: Request,
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

  // RLS scopes the query to the caller's company. Use the user client
  // so a homeowner with claim-share access correctly gets denied.
  const { data: expenses, error } = await supabase
    .from("job_expenses")
    .select("*")
    .eq("claim_id", claimId)
    .order("occurred_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sign receipt URLs (1h) — uses the user client so storage RLS applies.
  const out = await Promise.all(
    (expenses || []).map(async (e) => {
      let receiptUrl: string | null = null;
      if (e.receipt_path) {
        const { data: signed } = await supabase.storage
          .from("claim-documents")
          .createSignedUrl(e.receipt_path, 3600);
        receiptUrl = signed?.signedUrl ?? null;
      }
      return { ...e, receipt_url: receiptUrl };
    })
  );

  return NextResponse.json({ expenses: out });
}

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
  const {
    type,
    amount_cents,
    vendor,
    description,
    receipt_path,
    occurred_at,
    line_items,
    notes,
  } = body;

  if (!VALID_TYPES.includes(type as ExpenseType)) {
    return NextResponse.json(
      { error: `type must be one of ${VALID_TYPES.join(", ")}` },
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

  // Verify the claim is visible to this caller (RLS-gated SELECT).
  const { data: claim } = await supabase
    .from("claims")
    .select("id, company_id")
    .eq("id", claimId)
    .maybeSingle();
  if (!claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  const { data: inserted, error: insErr } = await supabase
    .from("job_expenses")
    .insert({
      claim_id: claimId,
      company_id: claim.company_id,
      uploader_user_id: user.id,
      type,
      amount_cents: Math.round(amount_cents),
      vendor: vendor || null,
      description: description || null,
      receipt_path: receipt_path || null,
      occurred_at: occurred_at || new Date().toISOString(),
      line_items: line_items ?? null,
      notes: notes || null,
    })
    .select()
    .single();

  if (insErr || !inserted) {
    return NextResponse.json(
      { error: insErr?.message || "Failed to record expense" },
      { status: 500 }
    );
  }

  await logClaimEvent(claimId, "expense_recorded", {
    source: "user",
    createdBy: user.id,
    title: `Expense recorded — $${(amount_cents / 100).toFixed(2)} ${type}`,
    metadata: {
      expense_id: inserted.id,
      type,
      amount_cents: Math.round(amount_cents),
      vendor: vendor || null,
    },
  });

  return NextResponse.json({ expense: inserted });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: claimId } = await params;
  const url = new URL(req.url);
  const expenseId = url.searchParams.get("expense_id");
  if (!expenseId) {
    return NextResponse.json({ error: "expense_id required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, company_id")
    .eq("user_id", user.id)
    .limit(1);
  if (!profileRows?.[0]?.is_admin) {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  const companyId = profileRows[0].company_id;

  const { data: existing } = await supabaseAdmin
    .from("job_expenses")
    .select("id, claim_id, company_id")
    .eq("id", expenseId)
    .eq("claim_id", claimId)
    .maybeSingle();
  if (!existing || existing.company_id !== companyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await supabaseAdmin.from("job_expenses").delete().eq("id", expenseId);
  return NextResponse.json({ ok: true });
}
