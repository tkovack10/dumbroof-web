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
  base_amount: number;
  addons_amount: number;
  subtotal_amount: number;
  markup_pct?: number;
  markup_amount?: number;
  total_amount: number;
  status?: string;
  notes?: string;
}

const ALLOWED_STATUSES = new Set([
  "draft",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
  "signed",
  "paid",
]);

function clampMarkup(n: unknown): number {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return 0;
  return Math.max(-50, Math.min(50, v));
}

/**
 * POST /api/retail-estimates — save a new estimate (or update via ?id=).
 *
 * Phase 2 added persistence; Phase 4 layered on markup_pct/markup_amount +
 * user-driven status transitions. Status writes pass through an allow-list
 * so we don't accept arbitrary strings from the client. 'sent' is normally
 * set by the email send endpoint, but the user can manually override it on
 * the builder dropdown for replies they processed by hand.
 */
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

  const markupPct = clampMarkup(body.markup_pct);
  const markupAmount = Number(body.markup_amount ?? 0);
  const status =
    body.status && ALLOWED_STATUSES.has(body.status) ? body.status : undefined;

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
        base_amount: body.base_amount,
        addons_amount: body.addons_amount,
        subtotal_amount: body.subtotal_amount,
        markup_pct: markupPct,
        markup_amount: markupAmount,
        total_amount: body.total_amount,
        notes: body.notes ?? null,
        ...(status ? { status } : {}),
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
      base_amount: body.base_amount,
      addons_amount: body.addons_amount,
      subtotal_amount: body.subtotal_amount,
      markup_pct: markupPct,
      markup_amount: markupAmount,
      total_amount: body.total_amount,
      notes: body.notes ?? null,
      status: status || "draft",
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ estimate: data });
}

/** GET /api/retail-estimates — paginated list of user's estimates. */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
  const statusFilter = url.searchParams.get("status");

  let query = supabaseAdmin
    .from("retail_estimates")
    .select(
      "id, template_id, customer_name, customer_email, total_amount, markup_pct, status, created_at, sent_at",
      { count: "exact" },
    )
    .eq("user_id", auth.user.id);
  if (statusFilter && ALLOWED_STATUSES.has(statusFilter)) {
    query = query.eq("status", statusFilter);
  }
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    estimates: data || [],
    total: count ?? 0,
    has_more: offset + (data?.length || 0) < (count ?? 0),
  });
}
