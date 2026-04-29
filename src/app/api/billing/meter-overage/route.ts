import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  OVERAGE_PRICE_ID,
  OVERAGE_METER_EVENT_NAME,
  OVERAGE_UNIT_PRICE_CENTS,
} from "@/lib/stripe-config";

// Stripe API calls + signed payload reading need Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MeterRequest {
  user_id: string;            // the user whose claim crossed into overage
  subscription_user_id: string; // owner of the resolved (potentially team-pooled) sub
  claim_id: string;
  plan_id: string;
  overage_count_after: number;
  stripe_subscription_id?: string | null;
  stripe_overage_item_id?: string | null;
}

function authorize(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    // No secret configured = block all calls. Better than open billing endpoint.
    return false;
  }
  return req.headers.get("authorization") === `Bearer ${cronSecret}`;
}

/**
 * POST /api/billing/meter-overage
 *
 * Backend-only. Called by processor.py once per claim that crosses into
 * overage. Lazy-attaches the metered overage price to the customer's
 * subscription if needed, then fires a Stripe usage record (quantity=1).
 *
 * Charges roll into the existing renewal invoice. If anything fails, we still
 * record the overage_event (with status='failed') so the daily reconcile cron
 * can retry; the user's claim still processes — never block work on billing.
 */
export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: MeterRequest;
  try {
    body = (await req.json()) as MeterRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    user_id,
    subscription_user_id,
    claim_id,
    plan_id,
    overage_count_after,
    stripe_subscription_id: subId,
  } = body;
  let { stripe_overage_item_id: overageItemId } = body;

  if (!user_id || !subscription_user_id || !plan_id || typeof overage_count_after !== "number") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // ALWAYS insert the telemetry row first so we have a paper trail. The
  // reconcile cron picks up rows with status='pending' or 'failed', so even
  // if OVERAGE_PRICE_ID is missing on this deploy we keep an audit trail
  // that can be retried after the env var is fixed (within the 7-day window).
  const { data: eventRow, error: insErr } = await supabaseAdmin
    .from("overage_events")
    .insert({
      user_id,
      subscription_user_id,
      claim_id,
      plan_id,
      overage_count_after,
      unit_price_cents: OVERAGE_UNIT_PRICE_CENTS,
      meter_event_status: "pending",
    })
    .select("id")
    .single();

  if (insErr || !eventRow) {
    console.error("[meter-overage] insert overage_event failed", insErr);
    return NextResponse.json({ error: "Telemetry insert failed" }, { status: 500 });
  }

  if (!OVERAGE_PRICE_ID) {
    console.error("[meter-overage] STRIPE_OVERAGE_PRICE_ID not configured");
    await supabaseAdmin
      .from("overage_events")
      .update({ meter_event_status: "failed", meter_error: "no_overage_price_id_configured" })
      .eq("id", eventRow.id);
    return NextResponse.json(
      { ok: false, error: "OVERAGE_PRICE_ID not configured", event_id: eventRow.id },
      { status: 500 }
    );
  }

  // No Stripe subscription = solo dogfood / starter being treated as paid by
  // mistake / bad config. Mark failed but still 200 — processor.py shouldn't
  // retry these forever.
  if (!subId) {
    await supabaseAdmin
      .from("overage_events")
      .update({ meter_event_status: "failed", meter_error: "no_stripe_subscription" })
      .eq("id", eventRow.id);
    return NextResponse.json({ ok: false, reason: "no_stripe_subscription", event_id: eventRow.id });
  }

  try {
    const stripe = getStripe();

    // The metered price MUST be attached as a subscription item before meter
    // events bill — Stripe matches the meter to the customer's active sub
    // line. Lazy-attach once per customer, then cache the item id.
    //
    // Race-safe: two concurrent overage claims can both reach this block
    // before either has cached the id. To avoid a duplicate-price 400 from
    // Stripe, we catch StripeInvalidRequestError (code='resource_already_exists'
    // in some cases) and re-retrieve the subscription to find the now-existing
    // item attached by the winning concurrent caller.
    if (!overageItemId) {
      const stripeSub = await stripe.subscriptions.retrieve(subId);
      const existing = stripeSub.items.data.find(
        (item: { price: { id: string } }) => item.price.id === OVERAGE_PRICE_ID
      );
      if (existing) {
        overageItemId = existing.id;
      } else {
        try {
          const created = await stripe.subscriptionItems.create({
            subscription: subId,
            price: OVERAGE_PRICE_ID,
            // Metered prices have no quantity — meter events carry the count.
            proration_behavior: "none",
          });
          overageItemId = created.id;
        } catch (createErr) {
          const msg = createErr instanceof Error ? createErr.message : String(createErr);
          // Stripe returns 400 with text like "Cannot add multiple subscription
          // items with the same price" when another concurrent request already
          // attached this price. Re-retrieve and use the now-existing item.
          if (/multiple\s+subscription\s+items\s+with\s+the\s+same\s+price|already\s+exists/i.test(msg)) {
            const refreshed = await stripe.subscriptions.retrieve(subId);
            const winner = refreshed.items.data.find(
              (item: { price: { id: string } }) => item.price.id === OVERAGE_PRICE_ID
            );
            if (!winner) throw createErr;
            overageItemId = winner.id;
          } else {
            throw createErr;
          }
        }
      }

      await supabaseAdmin
        .from("subscriptions")
        .update({ stripe_overage_item_id: overageItemId, updated_at: new Date().toISOString() })
        .eq("user_id", subscription_user_id);
    }

    // Resolve the customer's stripe_customer_id — billing.meterEvents.create
    // needs it on the payload (the meter is configured with
    // customer_mapping.event_payload_key="stripe_customer_id").
    const { data: subRow } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", subscription_user_id)
      .maybeSingle();
    const stripeCustomerId = subRow?.stripe_customer_id;
    if (!stripeCustomerId) {
      await supabaseAdmin
        .from("overage_events")
        .update({ meter_event_status: "failed", meter_error: "no_stripe_customer_id" })
        .eq("id", eventRow.id);
      return NextResponse.json({ ok: false, reason: "no_stripe_customer_id", event_id: eventRow.id });
    }

    // Fire the meter event. Stripe billing aggregates events for this
    // customer + meter against the subscription item's billing period.
    // identifier makes events idempotent across retries — same identifier
    // de-dupes within Stripe.
    const meterEvent = await stripe.billing.meterEvents.create({
      event_name: OVERAGE_METER_EVENT_NAME,
      identifier: `claim_${claim_id}_overage_${overage_count_after}`,
      timestamp: Math.floor(Date.now() / 1000),
      payload: {
        stripe_customer_id: stripeCustomerId,
        value: "1",
      },
    });

    await supabaseAdmin
      .from("overage_events")
      .update({
        meter_event_status: "sent",
        stripe_usage_record_id: meterEvent.identifier,
      })
      .eq("id", eventRow.id);

    return NextResponse.json({
      ok: true,
      event_id: eventRow.id,
      stripe_meter_event_identifier: meterEvent.identifier,
      stripe_overage_item_id: overageItemId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[meter-overage] Stripe call failed:", msg);
    await supabaseAdmin
      .from("overage_events")
      .update({ meter_event_status: "failed", meter_error: msg.slice(0, 500) })
      .eq("id", eventRow.id);
    return NextResponse.json({ ok: false, error: msg, event_id: eventRow.id }, { status: 502 });
  }
}
