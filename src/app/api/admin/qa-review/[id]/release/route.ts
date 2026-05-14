import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  // Admin auth gate
  const userSb = await createClient();
  const { data: { user } } = await userSb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: admin } = await userSb
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .limit(1);
  if (!admin || admin.length === 0) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: claim, error: fetchErr } = await supabaseAdmin
    .from("claims")
    .select("id, status, qa_audit_flags")
    .eq("id", id)
    .limit(1);

  if (fetchErr || !claim || claim.length === 0) {
    return NextResponse.json({ error: "claim not found" }, { status: 404 });
  }
  // The queue now shows claims with critical flags regardless of status
  // (reprocess-in-flight, post-crash, etc.) — release should work on any of
  // them as a "dismiss the QA flags" action. The status transition to
  // 'ready' only fires when the claim is actually in qa_review_pending;
  // for processing/ready/error we only mark the flags as released.
  const currentStatus = claim[0].status;
  const flipToReady = currentStatus === "qa_review_pending";

  const existingFlags = (claim[0].qa_audit_flags || {}) as Record<string, unknown>;
  const overriddenFlags = {
    ...existingFlags,
    released_by: user.email || user.id,
    released_at: new Date().toISOString(),
    override_reason: `admin manual override via /admin/qa-review (status was: ${currentStatus})`,
  };

  const update: Record<string, unknown> = { qa_audit_flags: overriddenFlags };
  if (flipToReady) update.status = "ready";

  const { error: updateErr } = await supabaseAdmin
    .from("claims")
    .update(update)
    .eq("id", id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Trigger the customer completion email ONLY when we actually transitioned
  // to ready (i.e. we just published a previously-blocked claim). For
  // processing/error/already-ready cases the notification either already
  // fired or shouldn't fire at all.
  if (flipToReady) {
    try {
      await fetch("https://www.dumbroof.ai/api/notify-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim_id: id }),
      });
    } catch (e) {
      console.error("[qa-release] notify-complete failed (non-fatal):", e);
    }
  }

  return NextResponse.json({
    success: true,
    flipped_to_ready: flipToReady,
    prior_status: currentStatus,
  });
}
