import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getPlanByPriceId } from "@/lib/stripe-config";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendCapiEvent, CapiEventName } from "@/lib/meta-conversions-api";
import { syncTeamSeats } from "@/lib/billing/sync-team-seats";
import Stripe from "stripe";

// Stripe webhooks need the raw request body for signature verification,
// which only works reliably on the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In Stripe's 2025+ API versions, current_period_start/end moved off the
// Subscription onto subscription items. Read items first, fall back to the
// top-level fields so we survive any further API rollover in either direction.
function getSubscriptionPeriod(
  sub: Stripe.Subscription
): { start: Date; end: Date } | null {
  const item = sub.items?.data?.[0] as
    | (Stripe.SubscriptionItem & { current_period_start?: number; current_period_end?: number })
    | undefined;
  const legacy = sub as unknown as { current_period_start?: number; current_period_end?: number };
  const start = item?.current_period_start ?? legacy.current_period_start;
  const end = item?.current_period_end ?? legacy.current_period_end;
  if (typeof start !== "number" || typeof end !== "number") return null;
  return { start: new Date(start * 1000), end: new Date(end * 1000) };
}

/**
 * Fire Meta CAPI Purchase event so Meta can optimize for revenue.
 * Without this, Meta only sees Lead/StartTrial and optimizes for
 * signups instead of paying customers.
 */
async function fireCapiPurchase(userId: string, value: number, planName: string): Promise<void> {
  try {
    // Look up user email from Supabase auth
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = data?.user?.email;
    if (!email) return;

    await sendCapiEvent({
      eventName: CapiEventName.Purchase,
      email,
      eventSourceUrl: "https://www.dumbroof.ai/pricing",
      customData: {
        value,
        currency: "USD",
        content_name: planName,
        content_category: "subscription",
      },
    });
  } catch (err) {
    // Fire-and-forget — never block the webhook
    console.error("[CAPI] Purchase event failed:", err);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Each handler is wrapped in its own try/catch so a single bad event can't
  // poison the endpoint and trigger Stripe's exponential-backoff retry storm.
  // We always return 200 unless signature verification fails — visibility comes
  // from Vercel logs + the Stripe dashboard event detail page.
  switch (event.type) {
    case "checkout.session.completed": {
      try {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.user_id;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string | null;

        if (!userId) break;

        // One-time payment (e.g., HAAG inspection) — no subscription to process
        if (!subscriptionId) {
          const addOnId = session.metadata?.add_on_id;
          console.log("One-time payment completed:", { userId, customerId, addOnId, amount: session.amount_total });

          if (addOnId === "haag_inspection") {
            await supabaseAdmin.from("inspections").insert({
              user_id: userId,
              payment_status: "paid",
              stripe_session_id: session.id,
              amount_paid: session.amount_total,
              status: "pending_assignment",
              notes: "HAAG inspection purchased via dumbroof.ai — awaiting inspector assignment",
            });
          }
          // Fire CAPI Purchase for one-time payments (e.g. HAAG inspection $500)
          fireCapiPurchase(userId, (session.amount_total || 0) / 100, addOnId || "one_time");
          break;
        }

        // Subscription checkout
        const sub = await getStripe().subscriptions.retrieve(subscriptionId);
        const plan = sub.items.data
          .map((si: { price: { id: string } }) => getPlanByPriceId(si.price.id))
          .find((p: unknown) => p !== undefined) || null;

        if (!plan) {
          console.error("Checkout completed with unknown price IDs:", sub.items.data.map((si: { price: { id: string } }) => si.price.id));
        }

        // Resolve the buyer's company_id so the subscription row is team-scoped
        // from day one (the assert_quota_allowed RPC then shares this plan with
        // every teammate that joins later, instead of leaving them on starter).
        const { data: buyerProfile } = await supabaseAdmin
          .from("company_profiles")
          .select("company_id")
          .eq("user_id", userId)
          .limit(1);

        const period = getSubscriptionPeriod(sub);
        if (!period) {
          console.error(
            "[webhook checkout.completed] missing period on subscription",
            subscriptionId,
            "items:",
            sub.items.data.map((si) => si.id)
          );
          break;
        }

        await supabaseAdmin.from("subscriptions").upsert(
          {
            user_id: userId,
            company_id: buyerProfile?.[0]?.company_id || null,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            plan_id: plan?.id || "starter",
            status: "active",
            current_period_start: period.start.toISOString(),
            current_period_end: period.end.toISOString(),
            claims_used_this_period: 0,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

        // Fire CAPI Purchase — Meta can now optimize for paying customers
        fireCapiPurchase(userId, plan?.price || 0, plan?.name || "subscription");

        // Sync extra-seat charges if the buyer already has team members above
        // their plan's includedUsers count (e.g. invited the team first, paid second).
        const buyerCompanyId = buyerProfile?.[0]?.company_id;
        if (buyerCompanyId) {
          try {
            await syncTeamSeats(buyerCompanyId);
          } catch (e) {
            console.error("[webhook checkout.completed] syncTeamSeats failed", e);
          }
        }
      } catch (e) {
        console.error("[webhook checkout.session.completed] handler failed:", e);
      }
      break;
    }

    case "customer.subscription.updated": {
      try {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const plan = sub.items.data
          .map((si: { price: { id: string } }) => getPlanByPriceId(si.price.id))
          .find((p: unknown) => p !== undefined) || null;

        const updates: Record<string, unknown> = {
          status: sub.status === "active" ? "active" : sub.status === "past_due" ? "past_due" : "canceled",
          updated_at: new Date().toISOString(),
        };

        if (plan) {
          updates.plan_id = plan.id;
        }

        const period = getSubscriptionPeriod(sub);
        if (period) {
          updates.current_period_start = period.start.toISOString();
          updates.current_period_end = period.end.toISOString();

          // Reset claims_used on period change
          const { data: existing } = await supabaseAdmin
            .from("subscriptions")
            .select("current_period_start")
            .eq("stripe_customer_id", customerId)
            .limit(1);

          if (
            existing?.[0] &&
            existing[0].current_period_start !== updates.current_period_start
          ) {
            // New billing cycle — reset both monthly counter AND overage state.
            // overage_acknowledged_at clears so the consent modal pops on the
            // next overage claim of the new cycle.
            updates.claims_used_this_period = 0;
            updates.overage_this_period = 0;
            updates.overage_acknowledged_at = null;
          }
        } else {
          console.error(
            "[webhook customer.subscription.updated] missing period on subscription",
            sub.id
          );
        }

        await supabaseAdmin
          .from("subscriptions")
          .update(updates)
          .eq("stripe_customer_id", customerId);
      } catch (e) {
        console.error("[webhook customer.subscription.updated] handler failed:", e);
      }
      break;
    }

    case "customer.subscription.deleted": {
      try {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        // Clear overage state too — if they re-subscribe later, stale
        // overage_acknowledged_at would suppress the consent modal on their
        // first new-cycle overage. Also clear stripe_overage_item_id since
        // a new subscription will need a fresh lazy-attach.
        await supabaseAdmin
          .from("subscriptions")
          .update({
            status: "canceled",
            plan_id: "starter",
            stripe_subscription_id: null,
            claims_used_this_period: 0,
            overage_this_period: 0,
            overage_acknowledged_at: null,
            stripe_overage_item_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", customerId);
      } catch (e) {
        console.error("[webhook customer.subscription.deleted] handler failed:", e);
      }
      break;
    }

    case "invoice.payment_succeeded": {
      try {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        // Note on overage_events status: do NOT flip pending → sent here.
        // The status is owned by the meter-overage route and reconcile cron
        // (the only places that actually call Stripe). An invoice paying
        // successfully tells us nothing about whether each individual meter
        // event landed — and a fresh-cycle overage row created moments before
        // this webhook fires would be wrongly marked 'sent' for the WRONG
        // billing period.

        // Clear past_due flag on a previously-failed sub that just got paid.
        await supabaseAdmin
          .from("subscriptions")
          .update({
            status: "active",
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", customerId)
          .eq("status", "past_due");
      } catch (e) {
        console.error("[webhook invoice.payment_succeeded] handler failed:", e);
      }
      break;
    }

    case "invoice.payment_failed": {
      try {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        console.error("Payment failed for customer:", customerId, "invoice:", invoice.id);

        await supabaseAdmin
          .from("subscriptions")
          .update({
            status: "past_due",
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", customerId);
      } catch (e) {
        console.error("[webhook invoice.payment_failed] handler failed:", e);
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
