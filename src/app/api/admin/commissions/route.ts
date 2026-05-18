import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

interface CommissionRow {
  id: string;
  claim_id: string;
  rep_user_id: string;
  type: string;
  amount_cents: number;
  photo_path: string | null;
  status: string;
  submitted_at: string;
  decided_at: string | null;
  paid_at: string | null;
  notes: string | null;
  decision_notes: string | null;
}

/**
 * GET /api/admin/commissions
 * Query params:
 *   status: pending | approved | rejected | paid | all (default: pending)
 * Returns commission requests for the admin's company, joined with rep email,
 * claim address, and a signed-URL for the photo if present.
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Admin check + company resolution
  const { data: profileRows } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin, company_id")
    .eq("user_id", user.id)
    .limit(1);

  if (!profileRows?.[0]?.is_admin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const companyId = profileRows[0].company_id;
  if (!companyId) {
    return NextResponse.json({ requests: [] });
  }

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status") || "pending";

  let query = supabaseAdmin
    .from("commission_requests")
    .select("*")
    .eq("company_id", companyId)
    .order("submitted_at", { ascending: false });

  if (statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  const { data: requests, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (requests || []) as CommissionRow[];
  if (rows.length === 0) {
    return NextResponse.json({ requests: [] });
  }

  // Hydrate rep email and claim address in batch
  const repIds = Array.from(new Set(rows.map((r) => r.rep_user_id)));
  const claimIds = Array.from(new Set(rows.map((r) => r.claim_id)));

  const [{ data: reps }, { data: claims }] = await Promise.all([
    supabaseAdmin
      .from("company_profiles")
      .select("user_id, email")
      .in("user_id", repIds),
    supabaseAdmin
      .from("claims")
      // claims.carrier (not carrier_name); claims has no `financials` jsonb —
      // the canonical money field is contractor_rcv (numeric). Alias both so
      // the client `Claim` type doesn't need to change.
      .select("id, address, homeowner_name, carrier_name:carrier, contractor_rcv")
      .in("id", claimIds),
  ]);

  const repEmailById = new Map<string, string>(
    (reps || [])
      .filter((r) => r.user_id && r.email)
      .map((r) => [r.user_id as string, r.email as string])
  );
  const claimById = new Map<
    string,
    {
      address: string | null;
      homeowner_name: string | null;
      carrier_name: string | null;
      // Preserved as `financials.total` for downstream consumer compat
      // even though it's sourced from claims.contractor_rcv.
      financials: { total: number } | null;
    }
  >(
    (claims || []).map((c) => [
      c.id as string,
      {
        address: (c.address as string | null) ?? null,
        homeowner_name: (c.homeowner_name as string | null) ?? null,
        carrier_name: (c.carrier_name as string | null) ?? null,
        // Preserve the legacy `financials.total` shape downstream consumers expect.
        financials: c.contractor_rcv != null
          ? { total: Number(c.contractor_rcv) }
          : null,
      },
    ])
  );

  // Sign photo URLs (1h)
  const photoUrls = new Map<string, string>();
  await Promise.all(
    rows
      .filter((r) => r.photo_path)
      .map(async (r) => {
        const { data: signed } = await supabase.storage
          .from("claim-documents")
          .createSignedUrl(r.photo_path as string, 3600);
        if (signed?.signedUrl) photoUrls.set(r.id, signed.signedUrl);
      })
  );

  const enriched = rows.map((r) => ({
    ...r,
    rep_email: repEmailById.get(r.rep_user_id) ?? null,
    claim: claimById.get(r.claim_id) ?? null,
    photo_url: photoUrls.get(r.id) ?? null,
  }));

  return NextResponse.json({ requests: enriched });
}

/**
 * POST /api/admin/commissions
 * Body: { id, action: 'approve' | 'reject' | 'mark_paid', decision_notes?,
 *         payment_method?, payment_reference? }
 */
export async function POST(req: Request) {
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
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const companyId = profileRows[0].company_id;
  const body = await req.json().catch(() => ({}));
  const {
    id,
    action,
    decision_notes,
    payment_method,
    payment_reference,
  } = body;

  if (!id || !["approve", "reject", "mark_paid"].includes(action)) {
    return NextResponse.json(
      { error: "id and action (approve|reject|mark_paid) required" },
      { status: 400 }
    );
  }

  // Ensure the request belongs to this admin's company
  const { data: existing } = await supabaseAdmin
    .from("commission_requests")
    .select("id, claim_id, company_id, status, amount_cents, type, rep_user_id")
    .eq("id", id)
    .maybeSingle();

  if (!existing || existing.company_id !== companyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let updatePayload: Record<string, unknown>;
  let eventType: string;
  let eventTitle: string;

  if (action === "approve") {
    if (existing.status !== "pending") {
      return NextResponse.json(
        { error: `Cannot approve a request in status '${existing.status}'` },
        { status: 400 }
      );
    }
    updatePayload = {
      status: "approved",
      decided_at: new Date().toISOString(),
      decided_by: user.id,
      decision_notes: decision_notes || null,
    };
    eventType = "commission_approved";
    eventTitle = `Commission approved — $${(existing.amount_cents / 100).toFixed(2)}`;
  } else if (action === "reject") {
    if (existing.status !== "pending") {
      return NextResponse.json(
        { error: `Cannot reject a request in status '${existing.status}'` },
        { status: 400 }
      );
    }
    updatePayload = {
      status: "rejected",
      decided_at: new Date().toISOString(),
      decided_by: user.id,
      decision_notes: decision_notes || null,
    };
    eventType = "commission_rejected";
    eventTitle = `Commission rejected — $${(existing.amount_cents / 100).toFixed(2)}`;
  } else {
    // mark_paid
    if (existing.status !== "approved") {
      return NextResponse.json(
        { error: `Cannot mark paid a request in status '${existing.status}'` },
        { status: 400 }
      );
    }
    updatePayload = {
      status: "paid",
      paid_at: new Date().toISOString(),
      paid_by: user.id,
      payment_method: payment_method || null,
      payment_reference: payment_reference || null,
    };
    eventType = "commission_paid";
    eventTitle = `Commission paid — $${(existing.amount_cents / 100).toFixed(2)}`;
  }

  const { data: updated, error: updErr } = await supabaseAdmin
    .from("commission_requests")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (updErr || !updated) {
    return NextResponse.json(
      { error: updErr?.message || "Update failed" },
      { status: 500 }
    );
  }

  await supabaseAdmin.from("claim_events").insert({
    claim_id: existing.claim_id,
    event_type: eventType,
    event_category: "action",
    title: eventTitle,
    metadata: {
      commission_request_id: id,
      type: existing.type,
      amount_cents: existing.amount_cents,
      rep_user_id: existing.rep_user_id,
      decided_by: user.id,
    },
    occurred_at: new Date().toISOString(),
    created_by: user.id,
    source: "user",
  });

  return NextResponse.json({ commission_request: updated });
}
