import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getPlanByPriceId } from "@/lib/stripe-config";
import { supabaseAdmin } from "@/lib/supabase/admin";
import Stripe from "stripe";

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

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id;
      const customerId = session.customer as string;
      const subscriptionId = session.subscription as string;

      if (!userId) break;

      const sub = await getStripe().subscriptions.retrieve(subscriptionId);
      const item = sub.items.data[0];
      // Iterate all items to find the plan (sales_rep has 2 items: base + metered)
      const plan = sub.items.data
        .map(si => getPlanByPriceId(si.price.id))
        .find(p => p !== undefined) || null;

      if (!plan) {
        console.error("Checkout completed with unknown price IDs:", sub.items.data.map(si => si.price.id));
      }

      await supabaseAdmin.from("subscriptions").upsert(
        {
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          plan_id: plan?.id || "starter", // Fall back to starter (safe), not pro
          status: "active",
          current_period_start: item ? new Date(item.current_period_start * 1000).toISOString() : new Date().toISOString(),
          current_period_end: item ? new Date(item.current_period_end * 1000).toISOString() : new Date().toISOString(),
          claims_used_this_period: 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;
      const subItem = sub.items.data[0];
      const plan = sub.items.data
        .map(si => getPlanByPriceId(si.price.id))
        .find(p => p !== undefined) || null;

      const updates: Record<string, unknown> = {
        status: sub.status === "active" ? "active" : sub.status === "past_due" ? "past_due" : "canceled",
        current_period_start: subItem ? new Date(subItem.current_period_start * 1000).toISOString() : new Date().toISOString(),
        current_period_end: subItem ? new Date(subItem.current_period_end * 1000).toISOString() : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (plan) {
        updates.plan_id = plan.id;
      }

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
        updates.claims_used_this_period = 0;
      }

      await supabaseAdmin
        .from("subscriptions")
        .update(updates)
        .eq("stripe_customer_id", customerId);
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;

      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "canceled",
          plan_id: "starter",
          stripe_subscription_id: null,
          claims_used_this_period: 0,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_customer_id", customerId);
      break;
    }

    case "invoice.payment_failed": {
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
      break;
    }
  }

  return NextResponse.json({ received: true });
}
