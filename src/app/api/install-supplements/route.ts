import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const { searchParams } = new URL(req.url);
  const claimId = searchParams.get("claim_id");

  if (!claimId) {
    return NextResponse.json({ error: "claim_id required" }, { status: 400 });
  }

  const authorized = await canAccessClaim(userId, claimId);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from("install_supplements")
    .select("*")
    .eq("claim_id", claimId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sum total
  const total = (data || []).reduce((sum, item) => sum + item.qty * item.unit_price, 0);

  return NextResponse.json({ items: data || [], total: Math.round(total * 100) / 100 });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const body = await req.json();
  const { claim_id, description, xactimate_code, category, qty, unit, unit_price, reason, building_code } = body;

  if (!claim_id || !description) {
    return NextResponse.json({ error: "claim_id and description required" }, { status: 400 });
  }

  const authorized = await canAccessClaim(userId, claim_id);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from("install_supplements")
    .insert({
      claim_id,
      user_id: userId,
      description,
      xactimate_code: xactimate_code || null,
      category: category || "ROOFING",
      qty: qty ?? 1,
      unit: unit || "EA",
      unit_price: unit_price ?? 0,
      reason: reason || null,
      building_code: building_code || null,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update lifecycle_phase if first install supplement
  await supabaseAdmin
    .from("claims")
    .update({ lifecycle_phase: "installation" })
    .eq("id", claim_id)
    .in("lifecycle_phase", ["claim", null as unknown as string]);

  return NextResponse.json({ ok: true, item: data });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const body = await req.json();
  const { id, qty, unit_price, reason, photo_paths, status: newStatus } = body;

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // Get the supplement to verify ownership
  const { data: existing } = await supabaseAdmin
    .from("install_supplements")
    .select("claim_id, status")
    .eq("id", id)
    .limit(1)
    .then(r => ({ ...r, data: r.data?.[0] || null }));

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only allow editing drafts (unless transitioning status)
  if (existing.status !== "draft" && !newStatus) {
    return NextResponse.json({ error: "Cannot edit submitted supplement" }, { status: 400 });
  }

  const authorized = await canAccessClaim(userId, existing.claim_id);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const updates: Record<string, unknown> = {};
  if (qty != null) updates.qty = qty;
  if (unit_price != null) updates.unit_price = unit_price;
  if (reason !== undefined) updates.reason = reason;
  if (photo_paths !== undefined) updates.photo_paths = photo_paths;
  if (newStatus === "submitted") {
    updates.status = "submitted";
    updates.submitted_at = new Date().toISOString();
  }

  const { data, error } = await supabaseAdmin
    .from("install_supplements")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, item: data });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { data: existing } = await supabaseAdmin
    .from("install_supplements")
    .select("claim_id, status")
    .eq("id", id)
    .limit(1)
    .then(r => ({ ...r, data: r.data?.[0] || null }));

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (existing.status !== "draft") {
    return NextResponse.json({ error: "Cannot delete submitted supplement" }, { status: 400 });
  }

  const authorized = await canAccessClaim(userId, existing.claim_id);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { error } = await supabaseAdmin
    .from("install_supplements")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
