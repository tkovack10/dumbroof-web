import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";

/**
 * Recalculate contractor_rcv including tax + O&P (matches processor.py compute_financials).
 * Fixes the discrepancy where dashboard showed total with tax+O&P but scope review showed line total only.
 */
async function recalculateContractorRcv(claimId: string): Promise<number> {
  const { data: claim } = await supabaseAdmin
    .from("claims")
    .select("excluded_line_items, o_and_p_enabled, tax_rate")
    .eq("id", claimId)
    .single();

  const excludedIds = new Set<string>((claim?.excluded_line_items as string[]) || []);
  const oAndPEnabled = claim?.o_and_p_enabled ?? false;
  const taxRate = claim?.tax_rate ?? 0.08;

  const { data: allItems } = await supabaseAdmin
    .from("line_items")
    .select("id, qty, unit_price")
    .eq("claim_id", claimId)
    .in("source", ["usarm", "user_added"]);

  const lineTotal = (allItems || [])
    .filter((i) => !excludedIds.has(i.id))
    .reduce((sum, i) => sum + i.qty * i.unit_price, 0);

  const tax = lineTotal * taxRate;
  const rcv = lineTotal + tax;
  // O&P: 10% overhead + 11% profit = 21% (matches processor.py compute_financials)
  const oAndP = oAndPEnabled ? lineTotal * 0.10 + lineTotal * 0.11 : 0;
  const total = Math.round((rcv + oAndP) * 100) / 100;

  await supabaseAdmin.from("claims").update({ contractor_rcv: total }).eq("id", claimId);
  return total;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const { searchParams } = new URL(req.url);
  const claimId = searchParams.get("claim_id");

  if (!claimId) {
    return NextResponse.json({ error: "claim_id required" }, { status: 400 });
  }

  // Verify ownership or admin
  const authorized = await canAccessClaim(userId, claimId);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized for this claim" }, { status: 403 });
  }

  // Get USARM line items (not carrier items)
  const { data: items, error: itemsErr } = await supabaseAdmin
    .from("line_items")
    .select("id, claim_id, category, description, qty, unit, unit_price, xactimate_code, trade, source")
    .eq("claim_id", claimId)
    .in("source", ["usarm", "user_added"])
    .order("category", { ascending: true })
    .order("description", { ascending: true });

  if (itemsErr) {
    return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  }

  // Get existing feedback
  const itemIds = (items || []).map((i) => i.id);
  let feedbackMap = new Map<string, string>();
  if (itemIds.length > 0) {
    const { data: feedback } = await supabaseAdmin
      .from("line_item_feedback")
      .select("line_item_id, status")
      .in("line_item_id", itemIds);
    feedbackMap = new Map((feedback || []).map((f) => [f.line_item_id, f.status]));
  }

  // Get claim for contractor_rcv + excluded_line_items
  const { data: claim } = await supabaseAdmin
    .from("claims")
    .select("contractor_rcv, excluded_line_items")
    .eq("id", claimId)
    .single();

  const excludedSet = new Set<string>((claim?.excluded_line_items as string[]) || []);

  const enrichedItems = (items || []).map((item) => ({
    ...item,
    total: Math.round(item.qty * item.unit_price * 100) / 100,
    feedback_status: excludedSet.has(item.id) ? "removed" as const : (feedbackMap.get(item.id) as "approved" | "corrected" | null) || null,
  }));

  const categories = [...new Set(enrichedItems.map((i) => i.category))];
  const reviewedCount = enrichedItems.filter((i) => i.feedback_status !== null).length;

  return NextResponse.json({
    items: enrichedItems,
    contractor_rcv: claim?.contractor_rcv || 0,
    total_items: enrichedItems.length,
    reviewed_count: reviewedCount,
    categories,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const body = await req.json();
  const { line_item_id, status, corrected_description, corrected_qty, corrected_unit_price, corrected_unit, notes } = body;

  if (!line_item_id || !status) {
    return NextResponse.json({ error: "line_item_id and status required" }, { status: 400 });
  }

  // Fetch line item — derive claim_id from it (never trust client)
  const { data: lineItem, error: liErr } = await supabaseAdmin
    .from("line_items")
    .select("id, claim_id, description, qty, unit_price, unit")
    .eq("id", line_item_id)
    .single();

  if (liErr || !lineItem) {
    return NextResponse.json({ error: "Line item not found" }, { status: 404 });
  }

  const claimId = lineItem.claim_id;

  // Verify ownership or admin
  const authorized = await canAccessClaim(userId, claimId);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized for this claim" }, { status: 403 });
  }

  // Upsert feedback — store originals for training data
  const { error: fbErr } = await supabaseAdmin.from("line_item_feedback").upsert(
    {
      line_item_id,
      claim_id: claimId,
      status,
      original_description: lineItem.description,
      original_qty: lineItem.qty,
      original_unit_price: lineItem.unit_price,
      original_unit: lineItem.unit,
      corrected_description: corrected_description || null,
      corrected_qty: corrected_qty ?? null,
      corrected_unit_price: corrected_unit_price ?? null,
      corrected_unit: corrected_unit || null,
      notes: notes || null,
    },
    { onConflict: "line_item_id" }
  );

  if (fbErr) {
    return NextResponse.json({ error: fbErr.message }, { status: 500 });
  }

  // If corrected: update actual line_items row with corrected values
  if (status === "corrected") {
    const updates: Record<string, unknown> = {};
    if (corrected_description) updates.description = corrected_description;
    if (corrected_qty != null) updates.qty = corrected_qty;
    if (corrected_unit_price != null) updates.unit_price = corrected_unit_price;
    if (corrected_unit) updates.unit = corrected_unit;

    if (Object.keys(updates).length > 0) {
      await supabaseAdmin.from("line_items").update(updates).eq("id", line_item_id);
    }
  }

  // Handle excluded_line_items
  if (status === "removed") {
    // Add to excluded list
    const { error: rpcErr } = await supabaseAdmin.rpc("append_excluded_line_item", {
      claim_id_param: claimId,
      item_id: line_item_id,
    });
    if (rpcErr?.message?.includes("does not exist")) {
      // Fallback if RPC not created yet
      const { data: claim } = await supabaseAdmin.from("claims").select("excluded_line_items").eq("id", claimId).single();
      const excluded: string[] = (claim?.excluded_line_items as string[]) || [];
      if (!excluded.includes(line_item_id)) {
        excluded.push(line_item_id);
        await supabaseAdmin.from("claims").update({ excluded_line_items: excluded }).eq("id", claimId);
      }
    }
  } else {
    // If changing FROM removed, restore the item
    const { error: rpcErr } = await supabaseAdmin.rpc("remove_excluded_line_item", {
      claim_id_param: claimId,
      item_id: line_item_id,
    });
    if (rpcErr?.message?.includes("does not exist")) {
      const { data: claim } = await supabaseAdmin.from("claims").select("excluded_line_items").eq("id", claimId).single();
      const excluded: string[] = (claim?.excluded_line_items as string[]) || [];
      const idx = excluded.indexOf(line_item_id);
      if (idx !== -1) {
        excluded.splice(idx, 1);
        await supabaseAdmin.from("claims").update({ excluded_line_items: excluded }).eq("id", claimId);
      }
    }
  }

  // Recalculate contractor_rcv (includes tax + O&P)
  const newRcv = await recalculateContractorRcv(claimId);

  return NextResponse.json({ ok: true, new_contractor_rcv: newRcv });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const body = await req.json();
  const { claim_id, category, description, qty, unit, unit_price } = body;

  if (!claim_id || !description || qty == null || unit_price == null) {
    return NextResponse.json({ error: "claim_id, description, qty, and unit_price required" }, { status: 400 });
  }

  // Verify ownership or admin
  const authorized = await canAccessClaim(userId, claim_id);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized for this claim" }, { status: 403 });
  }

  // Insert new line item with source = 'user_added'
  const { data: newItem, error: insertErr } = await supabaseAdmin
    .from("line_items")
    .insert({
      claim_id,
      category: category || "GENERAL",
      description,
      qty,
      unit: unit || "EA",
      unit_price,
      source: "user_added",
    })
    .select("id, claim_id, category, description, qty, unit, unit_price, xactimate_code, trade, source")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // Auto-create approved feedback
  await supabaseAdmin.from("line_item_feedback").insert({
    line_item_id: newItem.id,
    claim_id,
    status: "approved",
    original_description: description,
    original_qty: qty,
    original_unit_price: unit_price,
    original_unit: unit || "EA",
  });

  // Recalculate contractor_rcv (includes tax + O&P)
  const newRcv = await recalculateContractorRcv(claim_id);

  return NextResponse.json({
    ok: true,
    item: { ...newItem, total: Math.round(qty * unit_price * 100) / 100, feedback_status: "approved" },
    new_contractor_rcv: newRcv,
  });
}

/**
 * PATCH: Toggle O&P on/off for a claim. Recalculates contractor_rcv.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const body = await req.json();
  const { claimId, o_and_p_enabled } = body;

  if (!claimId || typeof o_and_p_enabled !== "boolean") {
    return NextResponse.json({ error: "claimId and o_and_p_enabled (boolean) required" }, { status: 400 });
  }

  const authorized = await canAccessClaim(userId, claimId);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized for this claim" }, { status: 403 });
  }

  // Update O&P flag
  await supabaseAdmin.from("claims").update({ o_and_p_enabled }).eq("id", claimId);

  // Recalculate with new O&P state
  const newRcv = await recalculateContractorRcv(claimId);

  return NextResponse.json({ ok: true, new_contractor_rcv: newRcv, o_and_p_enabled });
}
