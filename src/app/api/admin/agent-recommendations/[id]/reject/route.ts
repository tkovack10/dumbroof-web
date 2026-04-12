import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const recId = parseInt(id, 10);
  if (isNaN(recId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const userSb = await createClient();
  const { data: { user } } = await userSb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: admin } = await userSb.from("admins").select("user_id").eq("user_id", user.id).limit(1);
  if (!admin?.length) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { reason?: string };

  const { error } = await supabaseAdmin
    .from("agent_recommendations")
    .update({
      status: "rejected",
      reviewed_by: user.email || user.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: body.reason || null,
    })
    .eq("id", recId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
