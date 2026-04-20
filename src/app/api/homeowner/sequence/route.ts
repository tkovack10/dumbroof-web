import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";
import { logClaimEvent } from "@/lib/claim-events";

/**
 * Manage a homeowner communication sequence.
 *
 * POST /api/homeowner/sequence
 *   action=start  → create/activate sequence, set next_send_at = now() + X hours
 *   action=pause  → mark status='paused' (cron skips)
 *   action=resume → mark status='active'
 *   action=stop   → mark status='complete'
 */
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { user } = auth;

  let body: { claim_id?: string; action?: string; pause_reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const claimId = (body.claim_id || "").trim();
  const action = (body.action || "").trim();
  if (!claimId || !["start", "pause", "resume", "stop"].includes(action)) {
    return NextResponse.json({ error: "claim_id + valid action required" }, { status: 400 });
  }

  const allowed = await canAccessClaim(user.id, claimId);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const now = new Date();
  const nowIso = now.toISOString();

  if (action === "start") {
    // Verify homeowner_email exists before kicking off
    const { data: claimRows } = await supabaseAdmin
      .from("claims")
      .select("homeowner_email")
      .eq("id", claimId)
      .limit(1);
    if (!claimRows?.[0]?.homeowner_email) {
      return NextResponse.json(
        { error: "Homeowner email required before starting sequence." },
        { status: 400 }
      );
    }

    // Idempotency guard — if there's already an active sequence, don't reset
    // started_at (that would cause Day-0 to fire twice).
    const { data: existing } = await supabaseAdmin
      .from("homeowner_sequences")
      .select("status")
      .eq("claim_id", claimId)
      .maybeSingle();
    if (existing?.status === "active") {
      return NextResponse.json({ ok: true, status: "active", already_running: true });
    }

    // next_send_at = 10 minutes from now (lets cron pick it up on next tick)
    const nextSend = new Date(now.getTime() + 10 * 60_000).toISOString();

    await supabaseAdmin
      .from("homeowner_sequences")
      .upsert(
        {
          claim_id: claimId,
          status: "active",
          started_at: nowIso,
          started_by: user.id,
          next_send_at: nextSend,
          pause_reason: null,
          completed_at: null,
        },
        { onConflict: "claim_id" }
      );

    await logClaimEvent(claimId, "sequence_started", {
      source: "user",
      createdBy: user.id,
      metadata: { started_by: user.id },
    });
    return NextResponse.json({ ok: true, status: "active", next_send_at: nextSend });
  }

  if (action === "pause") {
    await supabaseAdmin
      .from("homeowner_sequences")
      .update({ status: "paused", pause_reason: body.pause_reason || null })
      .eq("claim_id", claimId);
    await logClaimEvent(claimId, "sequence_paused", {
      source: "user",
      createdBy: user.id,
      metadata: { reason: body.pause_reason || null },
    });
    return NextResponse.json({ ok: true, status: "paused" });
  }

  if (action === "resume") {
    // Nudge next_send_at so cron picks it up soon
    const nextSend = new Date(now.getTime() + 10 * 60_000).toISOString();
    await supabaseAdmin
      .from("homeowner_sequences")
      .update({ status: "active", pause_reason: null, next_send_at: nextSend })
      .eq("claim_id", claimId);
    await logClaimEvent(claimId, "sequence_resumed", { source: "user", createdBy: user.id });
    return NextResponse.json({ ok: true, status: "active", next_send_at: nextSend });
  }

  if (action === "stop") {
    await supabaseAdmin
      .from("homeowner_sequences")
      .update({ status: "complete", completed_at: nowIso })
      .eq("claim_id", claimId);
    await logClaimEvent(claimId, "sequence_completed", { source: "user", createdBy: user.id });
    return NextResponse.json({ ok: true, status: "complete" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
