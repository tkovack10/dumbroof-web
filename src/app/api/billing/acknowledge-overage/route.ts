import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * POST /api/billing/acknowledge-overage
 *
 * Called when a user clicks "Continue at $75/claim" in the overage consent
 * modal. Sets overage_acknowledged_at = now() on the resolved subscription
 * row so subsequent claims in this billing period skip the modal.
 *
 * The ack auto-resets on each renewal because assert_quota_allowed compares
 * overage_acknowledged_at against current_period_start.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Resolve the user's effective subscription (own row or team owner's row).
  const { data: sub, error: rpcErr } = await supabaseAdmin.rpc(
    "resolve_user_subscription",
    { p_user_id: user.id }
  );

  if (rpcErr || !sub?.id) {
    console.error("[acknowledge-overage] resolve_user_subscription failed", rpcErr);
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }

  const { error: updErr } = await supabaseAdmin
    .from("subscriptions")
    .update({
      overage_acknowledged_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sub.id);

  if (updErr) {
    console.error("[acknowledge-overage] update failed", updErr);
    return NextResponse.json({ error: "Acknowledge failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
