import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

interface ExpenseRow {
  claim_id: string;
  type: string;
  amount_cents: number;
}

interface CheckRow {
  claim_id: string;
  amount_cents: number | null;
  source: string;
}

/**
 * GET /api/admin/job-pnl
 * Rollup of revenue minus expenses per claim for the admin's company.
 * Used by /dashboard/admin/expenses to surface the per-job net margin.
 *
 * Revenue accounting (in order of preference):
 *   1. Sum of confirmed check_uploads.amount_cents for the claim
 *   2. Falls back to claims.financials.total (USARM-computed RCV) when
 *      no checks are on file
 * Expenses are summed by type for the breakdown.
 */
export async function GET() {
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
  if (!companyId) {
    return NextResponse.json({ jobs: [], totals: emptyTotals() });
  }

  const [expRes, claimsRes, checkRes] = await Promise.all([
    supabaseAdmin
      .from("job_expenses")
      .select("claim_id, type, amount_cents")
      .eq("company_id", companyId),
    supabaseAdmin
      .from("claims")
      // claims.carrier (not carrier_name); no `financials` jsonb — use
      // contractor_rcv (numeric). Alias to keep response shape stable.
      .select("id, address, homeowner_name, carrier_name:carrier, status, contractor_rcv, last_touched_at")
      .eq("company_id", companyId)
      .order("last_touched_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("check_uploads")
      .select("claim_id, amount_cents, source")
      .eq("company_id", companyId),
  ]);

  const expenses = (expRes.data || []) as ExpenseRow[];
  const claims = claimsRes.data || [];
  const checks = (checkRes.data || []) as CheckRow[];

  // Aggregate per-claim expenses by type
  const expByClaim = new Map<
    string,
    { total: number; byType: Record<string, number> }
  >();
  for (const e of expenses) {
    const bucket = expByClaim.get(e.claim_id) ?? {
      total: 0,
      byType: {},
    };
    bucket.total += e.amount_cents ?? 0;
    bucket.byType[e.type] = (bucket.byType[e.type] ?? 0) + (e.amount_cents ?? 0);
    expByClaim.set(e.claim_id, bucket);
  }

  // Aggregate per-claim checks
  const checksByClaim = new Map<string, number>();
  for (const c of checks) {
    checksByClaim.set(
      c.claim_id,
      (checksByClaim.get(c.claim_id) ?? 0) + (c.amount_cents ?? 0)
    );
  }

  const jobs = claims.map((c) => {
    const checksTotalCents = checksByClaim.get(c.id) ?? 0;
    const financialsTotalCents = Math.round(
      Number((c as { contractor_rcv?: number | null }).contractor_rcv ?? 0) * 100
    );
    const revenueCents = checksTotalCents > 0 ? checksTotalCents : financialsTotalCents;
    const expSlot = expByClaim.get(c.id) ?? { total: 0, byType: {} };
    const expensesCents = expSlot.total;
    const netCents = revenueCents - expensesCents;
    const marginPct =
      revenueCents > 0 ? Math.round((netCents / revenueCents) * 100) : null;

    return {
      claim_id: c.id,
      address: c.address ?? null,
      homeowner_name: c.homeowner_name ?? null,
      carrier_name: c.carrier_name ?? null,
      status: c.status ?? null,
      last_touched_at: c.last_touched_at ?? null,
      revenue_source: checksTotalCents > 0 ? "checks" : "estimate",
      revenue_cents: revenueCents,
      expenses_cents: expensesCents,
      expenses_by_type: expSlot.byType,
      net_cents: netCents,
      margin_pct: marginPct,
    };
  });

  // Company-wide totals: revenue from claims with any activity, expenses
  // from all expenses (some may be on unrelated claims — captured above)
  let totalRevenueCents = 0;
  let totalExpensesCents = 0;
  for (const j of jobs) {
    if (j.expenses_cents > 0 || j.revenue_cents > 0) {
      totalRevenueCents += j.revenue_cents;
      totalExpensesCents += j.expenses_cents;
    }
  }
  const netTotal = totalRevenueCents - totalExpensesCents;
  const marginPctTotal =
    totalRevenueCents > 0
      ? Math.round((netTotal / totalRevenueCents) * 100)
      : null;

  return NextResponse.json({
    jobs,
    totals: {
      revenue_cents: totalRevenueCents,
      expenses_cents: totalExpensesCents,
      net_cents: netTotal,
      margin_pct: marginPctTotal,
      jobs_with_expenses: jobs.filter((j) => j.expenses_cents > 0).length,
      jobs_with_revenue: jobs.filter((j) => j.revenue_cents > 0).length,
    },
  });
}

function emptyTotals() {
  return {
    revenue_cents: 0,
    expenses_cents: 0,
    net_cents: 0,
    margin_pct: null,
    jobs_with_expenses: 0,
    jobs_with_revenue: 0,
  };
}
