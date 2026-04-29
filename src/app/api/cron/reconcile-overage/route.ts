import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import {
  OVERAGE_PRICE_ID,
  OVERAGE_METER_EVENT_NAME,
  OVERAGE_UNIT_PRICE_CENTS,
} from "@/lib/stripe-config";
import type Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/reconcile-overage
 *
 * Daily cron (16:30 UTC, runs after upgrade-emails). Picks up overage_events
 * with status in ('pending','failed') and retries the Stripe usage record.
 * If we're more than 7 days past the event creation, mark the event 'failed'
 * permanently — the renewal invoice has already been generated and Stripe
 * won't accept usage records for closed periods.
 *
 * Idempotent: usage records use action='increment' which Stripe sums; we never
 * double-bill if a previous attempt actually went through (Stripe API ack
 * is the only signal we trust).
 */
function authorize(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  }
  return req.headers.get("authorization") === `Bearer ${cronSecret}`;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!OVERAGE_PRICE_ID) {
    return NextResponse.json(
      { error: "STRIPE_OVERAGE_PRICE_ID not configured" },
      { status: 500 }
    );
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Pull pending + failed events. Limit to 200 per run so a backlog doesn't
  // exhaust the function timeout. Skip events that are already reconciled.
  // Don't retry events with `meter_error='abandoned_too_old'` (they've been
  // permanently abandoned past the 7-day window).
  const { data: events, error } = await supabaseAdmin
    .from("overage_events")
    .select("id, user_id, subscription_user_id, claim_id, plan_id, overage_count_after, created_at, meter_error")
    .in("meter_event_status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    console.error("[reconcile-overage] query failed", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const stripe = getStripe();
  const summary = { sent: 0, abandoned: 0, retry_failed: 0, total: events?.length ?? 0 };

  for (const ev of events ?? []) {
    if (ev.meter_error === "abandoned_too_old") {
      // Permanently abandoned — never retry.
      summary.abandoned++;
      continue;
    }
    if (ev.created_at < sevenDaysAgo) {
      // Past the retry window. Stripe won't accept meter events for closed
      // billing periods.
      await supabaseAdmin
        .from("overage_events")
        .update({
          meter_event_status: "failed",
          meter_error: "abandoned_too_old",
        })
        .eq("id", ev.id);
      summary.abandoned++;
      continue;
    }

    // Resolve subscription + customer for this user
    const { data: subRow } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_subscription_id, stripe_overage_item_id, stripe_customer_id")
      .eq("user_id", ev.subscription_user_id)
      .maybeSingle();

    if (!subRow?.stripe_subscription_id || !subRow?.stripe_customer_id) {
      await supabaseAdmin
        .from("overage_events")
        .update({
          meter_event_status: "failed",
          meter_error: "no_stripe_subscription_or_customer",
        })
        .eq("id", ev.id);
      summary.retry_failed++;
      continue;
    }

    let overageItemId = subRow.stripe_overage_item_id;

    try {
      if (!overageItemId) {
        const stripeSub: Stripe.Subscription = await stripe.subscriptions.retrieve(
          subRow.stripe_subscription_id
        );
        const existing = stripeSub.items.data.find(
          (item) => item.price.id === OVERAGE_PRICE_ID
        );
        if (existing) {
          overageItemId = existing.id;
        } else {
          const created = await stripe.subscriptionItems.create({
            subscription: subRow.stripe_subscription_id,
            price: OVERAGE_PRICE_ID,
            proration_behavior: "none",
          });
          overageItemId = created.id;
        }
        await supabaseAdmin
          .from("subscriptions")
          .update({
            stripe_overage_item_id: overageItemId,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", ev.subscription_user_id);
      }

      const meterEvent = await stripe.billing.meterEvents.create({
        event_name: OVERAGE_METER_EVENT_NAME,
        identifier: `claim_${ev.claim_id}_overage_${ev.overage_count_after}`,
        timestamp: Math.floor(new Date(ev.created_at).getTime() / 1000),
        payload: {
          stripe_customer_id: subRow.stripe_customer_id,
          value: "1",
        },
      });

      await supabaseAdmin
        .from("overage_events")
        .update({
          meter_event_status: "sent",
          stripe_usage_record_id: meterEvent.identifier,
          unit_price_cents: OVERAGE_UNIT_PRICE_CENTS,
        })
        .eq("id", ev.id);
      summary.sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[reconcile-overage] retry failed for event ${ev.id}:`, msg);
      await supabaseAdmin
        .from("overage_events")
        .update({ meter_event_status: "failed", meter_error: msg.slice(0, 500) })
        .eq("id", ev.id);
      summary.retry_failed++;
    }
  }

  console.log("[reconcile-overage] run complete:", JSON.stringify(summary));
  return NextResponse.json({ ok: true, ...summary });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
