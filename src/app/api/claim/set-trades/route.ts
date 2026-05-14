import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";

export const maxDuration = 30;

/**
 * POST /api/claim/set-trades
 *
 * Body: { claim_id, trades: string[] }
 *   trades: subset of ["roofing","siding","gutters"]
 *
 * Updates claims.estimate_request to reflect the requested trade mix,
 * preserving any existing material/type info for the trades that stay,
 * then kicks a reprocess. Pairs with processor.py's trades = derive-from-
 * estimate_request logic (hotfix A, 2026-05-14).
 */
const ALLOWED_TRADES = new Set(["roofing", "siding", "gutters"]);

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  let body: { claim_id?: string; trades?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { claim_id } = body;
  if (!claim_id) {
    return NextResponse.json({ error: "claim_id required" }, { status: 400 });
  }
  if (!Array.isArray(body.trades)) {
    return NextResponse.json({ error: "trades must be an array" }, { status: 400 });
  }
  const wanted = new Set<string>();
  for (const t of body.trades) {
    if (typeof t !== "string") continue;
    const lower = t.toLowerCase().trim();
    if (ALLOWED_TRADES.has(lower)) wanted.add(lower);
  }
  if (wanted.size === 0) {
    return NextResponse.json({ error: "Pick at least one trade" }, { status: 400 });
  }
  if (!(await canAccessClaim(userId, claim_id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Read existing estimate_request so we preserve material/type info for
  // trades that stay in scope. Dropping a trade clears its keys; adding a
  // trade re-seeds a sensible default the processor will accept.
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from("claims")
    .select("estimate_request, claim_config, manual_scope_locked")
    .eq("id", claim_id)
    .single();
  if (claimErr || !claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  // manual_scope_locked bypasses the rebuild — toggling trades would be a no-op
  // until the user unlocks. Refuse loudly instead of silently doing nothing.
  const cfg = (claim.claim_config as Record<string, unknown> | null) || {};
  if (cfg.manual_scope_locked === true) {
    return NextResponse.json(
      { error: "Scope is locked by uploaded estimate. Re-upload or unlock to change trades." },
      { status: 409 }
    );
  }

  const prior = (claim.estimate_request as Record<string, unknown> | null) || {};
  const next: Record<string, unknown> = {};

  // Preserve any keys that aren't trade-scope keys (e.g. damage_type) so we
  // don't accidentally wipe metadata the funnel set.
  for (const [k, v] of Object.entries(prior)) {
    if (!["roof_material", "roof_type", "siding", "siding_type", "gutters", "gutter_type"].includes(k)) {
      next[k] = v;
    }
  }

  if (wanted.has("roofing")) {
    next.roof_material = prior.roof_material || prior.roof_type || "Laminate Comp Shingle";
    if (prior.roof_type) next.roof_type = prior.roof_type;
  }
  if (wanted.has("siding")) {
    next.siding = prior.siding || prior.siding_type || "Aluminum";
    if (prior.siding_type) next.siding_type = prior.siding_type;
  }
  if (wanted.has("gutters")) {
    next.gutters = prior.gutters ?? true;
    if (prior.gutter_type) next.gutter_type = prior.gutter_type;
  }

  const { error: writeErr } = await supabaseAdmin
    .from("claims")
    .update({ estimate_request: next })
    .eq("id", claim_id);
  if (writeErr) {
    return NextResponse.json({ error: writeErr.message }, { status: 500 });
  }

  // Kick a reprocess so the line_items + PDFs reflect the new scope.
  try {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
    await fetch(`${backendUrl}/api/reprocess/${claim_id}`, { method: "POST" });
  } catch (e) {
    console.warn("[set-trades] reprocess kick failed (non-fatal):", e);
  }

  return NextResponse.json({
    ok: true,
    trades: [...wanted],
    estimate_request: next,
  });
}
