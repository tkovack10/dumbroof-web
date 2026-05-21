import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = ["draft", "sent", "viewed", "signed", "won", "lost", "archived", "invoiced", "paid"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { id } = await params;

  let body: { status?: string };
  try {
    body = (await req.json()) as { status?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const status = (body.status || "").trim();
  if (!ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json({ error: `Invalid status (allowed: ${ALLOWED_STATUSES.join(", ")})` }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("retail_estimates")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .select("id, status")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ estimate: data });
}
