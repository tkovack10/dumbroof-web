import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";

export const maxDuration = 30;

/**
 * POST /api/claim/upload-estimate
 *
 * Body: { claim_id, line_items }
 *   line_items: Array<{
 *     description: string,
 *     qty: number,
 *     unit: string,
 *     unit_price: number,
 *     category?: string,
 *     trade?: string,
 *     xactimate_code?: string,
 *   }>
 *
 * Behavior:
 *   1. Validate the array shape
 *   2. Read existing claim.claim_config
 *   3. Replace claim_config.line_items with the user-provided array
 *   4. Set claim_config.manual_scope_locked = true
 *      (processor.py:build_claim_config honors this — skips rebuild AND
 *      skips the Xactimate registry price-overlay, so user prices stay
 *      exactly as supplied across every future reprocess)
 *   5. Write claim_config back to claims.claim_config
 *   6. Kick a reprocess so the PDFs regenerate with the user's items
 *
 * This is the UI surface for Tom's manual_scope_locked flag (commit
 * ffb22bc) — before this route, the flag could only be set via SQL.
 * Xactimate-licensed contractors like Ebben Aley now have a self-serve
 * path to drop in their exact estimate.
 */
interface LineItemInput {
  description?: string;
  qty?: number;
  unit?: string;
  unit_price?: number;
  category?: string;
  trade?: string;
  xactimate_code?: string;
}

function sanitizeLineItems(input: unknown): { ok: true; items: object[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) {
    return { ok: false, error: "line_items must be an array" };
  }
  if (input.length === 0) {
    return { ok: false, error: "line_items cannot be empty" };
  }
  if (input.length > 500) {
    return { ok: false, error: "line_items too large (500 max)" };
  }
  const cleaned: object[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as LineItemInput | null;
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: `line_items[${i}] must be an object` };
    }
    const description = typeof raw.description === "string" ? raw.description.trim() : "";
    if (!description) {
      return { ok: false, error: `line_items[${i}].description is required` };
    }
    const qty = typeof raw.qty === "number" && isFinite(raw.qty) ? raw.qty : NaN;
    if (!isFinite(qty) || qty <= 0) {
      return { ok: false, error: `line_items[${i}].qty must be a positive number` };
    }
    const unit_price = typeof raw.unit_price === "number" && isFinite(raw.unit_price) ? raw.unit_price : NaN;
    if (!isFinite(unit_price) || unit_price < 0) {
      return { ok: false, error: `line_items[${i}].unit_price must be a non-negative number` };
    }
    cleaned.push({
      description,
      qty,
      unit: typeof raw.unit === "string" ? raw.unit.trim() || "EA" : "EA",
      unit_price,
      category: typeof raw.category === "string" ? raw.category.trim().toUpperCase() : "GENERAL",
      trade: typeof raw.trade === "string" ? raw.trade.trim().toLowerCase() : "general",
      xactimate_code: typeof raw.xactimate_code === "string" ? raw.xactimate_code.trim() : "",
      source: "user_uploaded",
    });
  }
  return { ok: true, items: cleaned };
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  let body: { claim_id?: string; line_items?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { claim_id } = body;
  if (!claim_id) {
    return NextResponse.json({ error: "claim_id required" }, { status: 400 });
  }
  if (!(await canAccessClaim(userId, claim_id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const cleaned = sanitizeLineItems(body.line_items);
  if (!cleaned.ok) {
    return NextResponse.json({ error: cleaned.error }, { status: 400 });
  }

  // Load existing config, merge line_items + lock flag, write back.
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from("claims")
    .select("claim_config")
    .eq("id", claim_id)
    .single();
  if (claimErr || !claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  const prior = (claim.claim_config as Record<string, unknown> | null) || {};
  const nextConfig = {
    ...prior,
    line_items: cleaned.items,
    manual_scope_locked: true,
  };

  const { error: writeErr } = await supabaseAdmin
    .from("claims")
    .update({ claim_config: nextConfig })
    .eq("id", claim_id);
  if (writeErr) {
    return NextResponse.json({ error: writeErr.message }, { status: 500 });
  }

  // Trigger reprocess so PDFs regenerate with the user's items.
  // refresh_prices=false because the whole point of manual_scope_locked is
  // to preserve unit_price exactly as supplied — refresh would no-op anyway
  // (the lock skips registry overlay) but explicit is better.
  try {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
    await fetch(`${backendUrl}/api/reprocess/${claim_id}?refresh_prices=false`, {
      method: "POST",
    });
  } catch (e) {
    // Don't fail the whole request — write succeeded, reprocess can be
    // triggered manually if needed.
    console.warn("[upload-estimate] reprocess kick failed (non-fatal):", e);
  }

  return NextResponse.json({
    ok: true,
    line_items_count: cleaned.items.length,
    manual_scope_locked: true,
  });
}
