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

/**
 * POST /api/claims/preflight
 *
 * Quota check called BEFORE the upload starts. Returns the full RPC payload
 * so the UI can decide between three states:
 * - mode='normal'   → render the form, allow submission
 * - mode='overage'  → render the consent modal (paid plan over cap), allow on ack
 * - mode='blocked'  → return 402 → render hard-block upgrade prompt (starter
 *                     at lifetime cap, or paid sub past_due/canceled)
 *
 * The RPC also runs server-side at processor.py entry as defense in depth and
 * to catch non-UI upload paths (AccuLynx, CompanyCam, email ingest).
 */
export async function POST() {
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
    console.error("[preflight] assert_quota_allowed RPC failed", error);
    return NextResponse.json({ error: "Quota check failed" }, { status: 500 });
  }

  const q = data as QuotaResult;
  const planId = (q.plan_id as PlanId) || "starter";
  const plan = PLANS[planId];
  const nextTierPlan = getNextTier(planId);

  const payload = {
    allowed: q.allowed,
    mode: q.mode,
    planId,
    planName: plan.name,
    remaining: q.remaining,
    limit: q.limit,
    periodUsed: q.period_used,
    lifetimeUsed: q.lifetime_used,
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
  };

  // Hard-block path: log to telemetry + 402 so the UI swaps to upgrade prompt.
  // Overage mode is NOT a block — it returns 200 and the UI renders consent.
  if (q.mode === "blocked") {
    await supabaseAdmin.from("quota_block_events").insert({
      user_id: user.id,
      plan_id: planId,
      reason: q.reason,
      source: "preflight",
      metadata: {
        period_used: q.period_used,
        lifetime_used: q.lifetime_used,
        company_shared: q.company_shared,
      },
    });

    return NextResponse.json(
      { ...payload, upgradeUrl: "/pricing" },
      { status: 402 }
    );
  }

  return NextResponse.json(payload);
}
