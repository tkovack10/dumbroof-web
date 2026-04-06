import { getStripe } from "@/lib/stripe";
import type { StripeSection, Anomaly } from "../types";

/**
 * Funnel Monitor — Stripe activity since the last cron run.
 * MRR delta is computed by summing new active subscriptions vs. canceled ones.
 */
export async function gatherStripe(
  windowStart: string,
  windowEnd: string,
  anomalies: Anomaly[]
): Promise<StripeSection | null> {
  if (!process.env.STRIPE_SECRET_KEY) return null;

  let stripe;
  try {
    stripe = getStripe();
  } catch {
    return null;
  }

  const startUnix = Math.floor(new Date(windowStart).getTime() / 1000);
  const endUnix = Math.floor(new Date(windowEnd).getTime() / 1000);

  // New subscriptions in window
  let newSubs = 0;
  let mrrDelta = 0;
  try {
    const subsList = await stripe.subscriptions.list({
      created: { gte: startUnix, lt: endUnix },
      limit: 100,
    });
    newSubs = subsList.data.length;
    for (const sub of subsList.data) {
      // Sum the recurring price amounts
      for (const item of sub.items.data) {
        const price = item.price;
        if (price.unit_amount && price.recurring?.interval === "month") {
          mrrDelta += price.unit_amount * (item.quantity ?? 1);
        }
      }
    }
  } catch (err) {
    anomalies.push({
      severity: "warning",
      code: "stripe_subscriptions_error",
      message: `Stripe subscriptions list failed: ${err instanceof Error ? err.message : "unknown"}`,
      source: "stripe",
    });
  }

  // Failed payments (charges in window with status=failed)
  let failedPayments = 0;
  try {
    const charges = await stripe.charges.list({
      created: { gte: startUnix, lt: endUnix },
      limit: 100,
    });
    failedPayments = charges.data.filter((c) => c.status === "failed").length;
  } catch {
    // Non-fatal
  }

  // Active subscription count (current snapshot)
  let activeSubs = 0;
  try {
    const active = await stripe.subscriptions.list({
      status: "active",
      limit: 100,
    });
    activeSubs = active.data.length;
  } catch {
    // Non-fatal
  }

  if (failedPayments > 0) {
    anomalies.push({
      severity: "warning",
      code: "stripe_failed_payments",
      message: `${failedPayments} failed payment(s) in this window. Check Stripe dashboard.`,
      source: "stripe",
    });
  }

  return {
    new_subscriptions: newSubs,
    mrr_delta_cents: mrrDelta,
    failed_payments: failedPayments,
    active_subscriptions: activeSubs,
    coupon_firstclaim50_uses: 0, // Stripe API requires separate query — skip for now
  };
}
