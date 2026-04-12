import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const userSb = await createClient();
  const { data: { user } } = await userSb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: admin } = await userSb
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .limit(1);
  if (!admin || admin.length === 0) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [qaRes, recRes] = await Promise.all([
    supabaseAdmin
      .from("claims")
      .select("id", { count: "exact", head: true })
      .eq("status", "qa_review_pending"),
    supabaseAdmin
      .from("agent_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  return NextResponse.json({
    qa_review_pending: qaRes.count ?? 0,
    recommendations_pending: recRes.error ? 0 : recRes.count ?? 0,
  });
}
