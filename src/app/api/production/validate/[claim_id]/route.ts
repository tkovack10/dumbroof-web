import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";

type FlagStatus = "ok" | "over_minor" | "over_major" | "partial" | "not_paid";

interface ValidationRow {
  trade: string;
  scope_qty: number;
  eagleview_qty: number | null;
  requested_qty: number;
  unit: string;
  status: FlagStatus;
  message: string;
}

interface ValidationRequest {
  requested: Record<string, { qty: number; unit?: string; full?: boolean }>;
}

/**
 * POST /api/production/validate/{claim_id}
 * Body: { requested: { roof: {qty, unit}, gutters: {qty, unit, full}, ... } }
 *
 * Compares `requested` quantities (what production wants to install) against
 * the approved carrier scope and EagleView measurements. Returns a flag
 * matrix rendered by the Ready to Build card.
 *
 *   requested_qty ≤ scope_qty               → ok (green)
 *   scope_qty < requested_qty ≤ scope*1.10  → over_minor (yellow, rep override)
 *   requested_qty > scope_qty * 1.10        → over_major (red, admin override)
 *   scope_qty < eagleview_qty * 0.80        → partial (blue, informational)
 *   requested_qty > 0 and scope_qty == 0    → not_paid (red)
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ claim_id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { user } = auth;

  const { claim_id: claimId } = await params;
  const allowed = await canAccessClaim(user.id, claimId);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: ValidationRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const requested = body.requested || {};

  // Load scope_comparison + claim_config for approved scope + eagleview quantities
  const { data: claimRows } = await supabaseAdmin
    .from("claims")
    .select("id, scope_comparison, claim_config, roof_facets")
    .eq("id", claimId)
    .limit(1);
  const claim = claimRows?.[0];
  if (!claim) return NextResponse.json({ error: "Claim not found" }, { status: 404 });

  const scopeRows = (claim.scope_comparison as Array<Record<string, unknown>> | null) || [];
  const config = (claim.claim_config as Record<string, unknown> | null) || {};

  // Aggregate approved qty by trade keyword matching
  const tradeScopeQty: Record<string, { qty: number; unit: string }> = {};
  const tradeKeywords: Record<string, RegExp> = {
    roof:      /roof|shingle|laminate|ridge\s*cap|underlayment|drip\s*edge|starter|i&w|ice.*water/i,
    gutters:   /gutter/i,
    downspouts:/downspout/i,
    siding:    /siding|house\s*wrap|cladding/i,
    flashing:  /flashing|step|counter/i,
    skylights: /skylight/i,
  };

  for (const row of scopeRows) {
    const qty = Number(row.carrier_qty || row.usarm_qty || 0) || 0;
    const desc = String(row.carrier_desc || row.usarm_desc || "");
    const unit = String(row.unit || row.carrier_unit || "");
    if (qty <= 0) continue;
    for (const [trade, regex] of Object.entries(tradeKeywords)) {
      if (regex.test(desc)) {
        const current = tradeScopeQty[trade] || { qty: 0, unit };
        tradeScopeQty[trade] = { qty: current.qty + qty, unit: current.unit || unit };
        break;
      }
    }
  }

  // EagleView totals from claim_config.measurements. Some older rows store this
  // as a JSON string instead of a jsonb object; normalize defensively.
  let measurements: Record<string, unknown> = {};
  const rawMeasurements = config.measurements;
  if (typeof rawMeasurements === "string") {
    try { measurements = JSON.parse(rawMeasurements); } catch { /* leave empty */ }
  } else if (rawMeasurements && typeof rawMeasurements === "object") {
    measurements = rawMeasurements as Record<string, unknown>;
  }
  const evQty: Record<string, number> = {
    roof: Number(measurements.total_sq || 0),
    gutters: Number(measurements.eave_lf || 0) * 1.6, // 1.6x eaves = gutter + downspout LF
    downspouts: Number(measurements.downspout_lf || 0),
    siding: Number(measurements.wall_sqft || 0) / 100, // squares
    flashing: 0,
    skylights: Number(measurements.skylight_count || 0),
  };

  // Build validation rows
  const validation: ValidationRow[] = [];
  for (const [trade, req] of Object.entries(requested)) {
    const requestedQty = Number(req.qty) || 0;
    const scope = tradeScopeQty[trade] || { qty: 0, unit: "" };
    const eagleview = evQty[trade] ?? null;
    const unit = req.unit || scope.unit || (trade === "roof" ? "SQ" : "LF");

    let status: FlagStatus = "ok";
    let message = "";

    if (scope.qty === 0 && requestedQty > 0) {
      status = "not_paid";
      message = `Carrier scope did not pay for ${trade}. Open a supplement or remove from production.`;
    } else if (requestedQty > scope.qty * 1.10) {
      status = "over_major";
      message = `Requesting ${requestedQty.toFixed(1)} ${unit} but scope paid for ${scope.qty.toFixed(1)} ${unit} (over by ${((requestedQty / scope.qty - 1) * 100).toFixed(0)}%). Supplement required or admin override.`;
    } else if (requestedQty > scope.qty) {
      status = "over_minor";
      message = `Requesting ${requestedQty.toFixed(1)} ${unit}, scope paid ${scope.qty.toFixed(1)} ${unit}. Minor overage — document reason.`;
    } else if (eagleview && scope.qty > 0 && scope.qty < eagleview * 0.80) {
      status = "partial";
      message = `Scope (${scope.qty.toFixed(1)} ${unit}) is <80% of EagleView (${eagleview.toFixed(1)} ${unit}). Confirm partial is intentional.`;
    } else {
      message = `OK — within approved scope.`;
    }

    validation.push({
      trade,
      scope_qty: scope.qty,
      eagleview_qty: eagleview,
      requested_qty: requestedQty,
      unit,
      status,
      message,
    });
  }

  const hasBlocker = validation.some((v) => v.status === "over_major" || v.status === "not_paid");
  const hasMinor = validation.some((v) => v.status === "over_minor");

  return NextResponse.json({
    validation,
    has_blocker: hasBlocker,
    has_minor: hasMinor,
    summary: hasBlocker
      ? "RED — cannot send to production until blockers are resolved or overridden by admin."
      : hasMinor
      ? "YELLOW — minor overages need rep sign-off with reason."
      : "GREEN — all trades within approved scope.",
  });
}
