import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

interface SaveBody {
  template_id: string;
  template_snapshot?: Record<string, unknown>;
  customer_name?: string;
  customer_email?: string;
  customer_address?: string;
  measurements: Record<string, number>;
  addon_qtys: Record<string, number>;
  markup_pct: number;
  base_amount: number;
  addons_amount: number;
  subtotal_amount: number;
  markup_amount: number;
  total_amount: number;
  notes?: string;
}

/** POST /api/retail-estimates — save a new estimate (or update existing if ?id=). */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.template_id) {
    return NextResponse.json({ error: "template_id required" }, { status: 400 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const { data, error } = await supabaseAdmin
      .from("retail_estimates")
      .update({
        template_id: body.template_id,
        template_snapshot: body.template_snapshot ?? null,
        customer_name: body.customer_name ?? null,
        customer_email: body.customer_email ?? null,
        customer_address: body.customer_address ?? null,
        measurements: body.measurements,
        addon_qtys: body.addon_qtys,
        markup_pct: body.markup_pct,
        base_amount: body.base_amount,
        addons_amount: body.addons_amount,
        subtotal_amount: body.subtotal_amount,
        markup_amount: body.markup_amount,
        total_amount: body.total_amount,
        notes: body.notes ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ estimate: data });
  }

  const { data, error } = await supabaseAdmin
    .from("retail_estimates")
    .insert({
      user_id: userId,
      template_id: body.template_id,
      template_snapshot: body.template_snapshot ?? null,
      customer_name: body.customer_name ?? null,
      customer_email: body.customer_email ?? null,
      customer_address: body.customer_address ?? null,
      measurements: body.measurements,
      addon_qtys: body.addon_qtys,
      markup_pct: body.markup_pct,
      base_amount: body.base_amount,
      addons_amount: body.addons_amount,
      subtotal_amount: body.subtotal_amount,
      markup_amount: body.markup_amount,
      total_amount: body.total_amount,
      notes: body.notes ?? null,
      status: "draft",
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ estimate: data });
}

/** GET /api/retail-estimates — list user's estimates, newest first. */
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { data, error } = await supabaseAdmin
    .from("retail_estimates")
    .select("id, template_id, customer_name, customer_email, total_amount, status, created_at, sent_at")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ estimates: data || [] });
}
