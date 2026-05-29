import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface CommissionRow {
  id: string;
  claim_id: string;
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
 * GET /api/commissions/mine
 *
 * The rep-facing counterpart to /api/admin/commissions. Returns ONLY the
 * caller's own commission requests (RLS already restricts rep_user_id =
 * auth.uid()), hydrated with the claim address and a signed photo URL, plus
 * summary totals for the dashboard tiles. No admin gate — every team member
 * can see their own pay.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: requests, error } = await supabase
    .from("commission_requests")
    .select(
      "id, claim_id, type, amount_cents, photo_path, status, submitted_at, decided_at, paid_at, notes, decision_notes"
    )
    .eq("rep_user_id", user.id)
    .order("submitted_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (requests || []) as CommissionRow[];

  const summary = {
    pending: { count: 0, cents: 0 },
    approved: { count: 0, cents: 0 },
    paid: { count: 0, cents: 0 },
    rejected: { count: 0, cents: 0 },
  };
  for (const r of rows) {
    const bucket = summary[r.status as keyof typeof summary];
    if (bucket) {
      bucket.count += 1;
      bucket.cents += r.amount_cents;
    }
  }

  if (rows.length === 0) {
    return NextResponse.json({ requests: [], summary });
  }

  // Hydrate claim address (RLS scopes to claims the rep can see — i.e. their
  // own / their company's).
  const claimIds = Array.from(new Set(rows.map((r) => r.claim_id)));
  const { data: claims } = await supabase
    .from("claims")
    .select("id, address, homeowner_name")
    .in("id", claimIds);

  const claimById = new Map(
    (claims || []).map((c) => [
      c.id as string,
      {
        address: (c.address as string | null) ?? null,
        homeowner_name: (c.homeowner_name as string | null) ?? null,
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
    claim: claimById.get(r.claim_id) ?? null,
    photo_url: photoUrls.get(r.id) ?? null,
  }));

  return NextResponse.json({ requests: enriched, summary });
}
