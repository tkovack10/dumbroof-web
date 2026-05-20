import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import type Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/reconcile-period
 *
 * Defense-in-depth daily cron (17:00 UTC). Catches any active subscription
 * whose stored `current_period_end` is in the past — meaning the renewal
 * `customer.subscription.updated` webhook didn't reset our counters even
 * though Stripe rolled the cycle.
 *
 * Without this, a single missed webhook compounds: every post-renewal claim
 * gets billed as overage at $75 and the customer is overcharged. USARM hit
 * exactly this on 2026-05-02 → 46 bogus overage events / $3,450 before we
 * caught it manually.
 *
 * For every stale subscription, we fetch the live Stripe period and, if it
 * advanced, recount the actual claims in the new window and patch the row.
 */

function authorize(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  }
  return req.headers.get("authorization") === `Bearer ${cronSecret}`;
}

function getSubscriptionPeriod(
  sub: Stripe.Subscription
): { start: Date; end: Date } | null {
  const item = sub.items?.data?.[0] as
    | (Stripe.SubscriptionItem & {
        current_period_start?: number;
        current_period_end?: number;
      })
    | undefined;
  const legacy = sub as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };
  const start = item?.current_period_start ?? legacy.current_period_start;
  const end = item?.current_period_end ?? legacy.current_period_end;
  if (typeof start !== "number" || typeof end !== "number") return null;
  return { start: new Date(start * 1000), end: new Date(end * 1000) };
}

async function countClaimsForCompany(
  companyId: string | null,
  ownerUserId: string,
  sinceIso: string
): Promise<number> {
  // Prefer company-scoped count when available — matches how the team-pooled
  // subscription resolves usage. Fall back to user-scoped for solo subs.
  if (companyId) {
    const { count } = await supabaseAdmin
      .from("claims")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .gte("created_at", sinceIso);
    if (typeof count === "number") return count;
  }
  const { count } = await supabaseAdmin
    .from("claims")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ownerUserId)
    .gte("created_at", sinceIso);
  return count ?? 0;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowIso = new Date().toISOString();

  const { data: stale, error } = await supabaseAdmin
    .from("subscriptions")
    .select(
      "id, user_id, company_id, plan_id, status, claims_used_this_period, overage_this_period, current_period_start, current_period_end, stripe_customer_id, stripe_subscription_id"
    )
    .eq("status", "active")
    .not("stripe_subscription_id", "is", null)
    .lt("current_period_end", nowIso)
    .limit(100);

  if (error) {
    console.error("[reconcile-period] fetch failed:", error);
    return NextResponse.json({ error: "fetch failed" }, { status: 500 });
  }

  const stripe = getStripe();
  const results: Array<Record<string, unknown>> = [];

  for (const row of stale ?? []) {
    if (!row.stripe_subscription_id) continue;

    let sub: Stripe.Subscription;
    try {
      sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    } catch (e) {
      console.error(
        "[reconcile-period] stripe retrieve failed",
        row.stripe_subscription_id,
        e
      );
      results.push({
        subscription_id: row.id,
        outcome: "stripe_retrieve_failed",
      });
      continue;
    }

    const period = getSubscriptionPeriod(sub);
    if (!period) {
      results.push({ subscription_id: row.id, outcome: "no_period_on_stripe" });
      continue;
    }

    const storedMs = row.current_period_start
      ? new Date(row.current_period_start).getTime()
      : 0;
    const stripeMs = period.start.getTime();

    if (stripeMs <= storedMs) {
      // Stripe hasn't actually advanced — just our stored end is past now()
      // because the cycle is closing imminently. Skip; the webhook should
      // handle it shortly.
      results.push({
        subscription_id: row.id,
        outcome: "stripe_period_not_advanced",
      });
      continue;
    }

    // Period advanced. Count claims in the new window so we don't blow away
    // legitimate post-renewal usage.
    const sinceIso = period.start.toISOString();
    const realClaimCount = await countClaimsForCompany(
      row.company_id,
      row.user_id,
      sinceIso
    );

    const { error: updateErr } = await supabaseAdmin
      .from("subscriptions")
      .update({
        current_period_start: sinceIso,
        current_period_end: period.end.toISOString(),
        claims_used_this_period: realClaimCount,
        overage_this_period: 0,
        overage_acknowledged_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (updateErr) {
      console.error("[reconcile-period] update failed", row.id, updateErr);
      results.push({ subscription_id: row.id, outcome: "update_failed" });
      continue;
    }

    console.log("[reconcile-period] reconciled", {
      subscription_id: row.id,
      stripe_customer_id: row.stripe_customer_id,
      old_period_start: row.current_period_start,
      new_period_start: sinceIso,
      old_used: row.claims_used_this_period,
      new_used: realClaimCount,
      cleared_overage: row.overage_this_period,
    });

    results.push({
      subscription_id: row.id,
      stripe_customer_id: row.stripe_customer_id,
      outcome: "reconciled",
      old_used: row.claims_used_this_period,
      new_used: realClaimCount,
      cleared_overage: row.overage_this_period,
    });
  }

  return NextResponse.json({
    examined: stale?.length ?? 0,
    results,
  });
}

import { withHeartbeat } from "@/lib/cron-heartbeat";

export async function GET(req: NextRequest) {
  return withHeartbeat("reconcile-period", 1440, req, handle);
}

export async function POST(req: NextRequest) {
  return withHeartbeat("reconcile-period", 1440, req, handle);
}
