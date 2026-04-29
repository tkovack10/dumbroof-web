import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PLANS, type PlanId, getNextTier } from "@/lib/stripe-config";

interface QuotaResult {
  allowed: boolean;
  mode: "normal" | "overage" | "blocked";
  plan_id: string;
  status: string;
  period_used: number;
  lifetime_used: number;
  remaining: number;
  limit: number | null;
  reason: string | null;
  subscription_user_id: string | null;
  company_shared: boolean;
  overage_unit_price_cents: number;
  overage_this_period: number;
  ack_required: boolean;
  next_tier: string | null;
  next_tier_price_cents: number | null;
  next_tier_monthly_cap: number | null;
  current_period_end: string | null;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin.rpc("assert_quota_allowed", {
    p_user_id: user.id,
  });

  if (error) {
    console.error("[check-quota] assert_quota_allowed RPC failed", error);
    return NextResponse.json({ error: "Quota check failed" }, { status: 500 });
  }

  const q = data as QuotaResult;
  const planId = (q.plan_id as PlanId) || "starter";
  const plan = PLANS[planId];
  const nextTierPlan = getNextTier(planId);

  return NextResponse.json({
    planId,
    planName: plan.name,
    allowed: q.allowed,
    mode: q.mode,
    remaining: q.remaining,
    periodUsed: q.period_used,
    lifetimeUsed: q.lifetime_used,
    limit: q.limit,
    status: q.status,
    reason: q.reason,
    companyShared: q.company_shared,
    overageThisPeriod: q.overage_this_period,
    overageUnitPriceCents: q.overage_unit_price_cents,
    ackRequired: q.ack_required,
    nextTier: q.next_tier,
    nextTierName: nextTierPlan?.name ?? null,
    nextTierPriceCents: q.next_tier_price_cents,
    nextTierMonthlyCap: q.next_tier_monthly_cap,
    currentPeriodEnd: q.current_period_end,
  });
}

// DEPRECATED: counter increment is now atomic with the quota gate inside
// backend/processor.py (single source of truth). Keeping this handler as a
// no-op so any in-flight client (cached page) doesn't 404. Remove after a
// release cycle once we're sure no clients hit it.
export async function POST() {
  return NextResponse.json({ ok: true, deprecated: true, note: "increment moved to processor.py" });
}
