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

  // QA queue badge — must match the /admin/qa-review page filter
  // (commit fba865d): "has critical flags AND not yet released",
  // independent of status. The strict status='qa_review_pending'
  // filter was misleading — emails fire on critical-flag presence,
  // but status drifts (reprocess in flight, post-crash) before Tom
  // checks. Same JS-side filter for parity.
  const [qaRes, recRes] = await Promise.all([
    supabaseAdmin
      .from("claims")
      .select("id, qa_audit_flags")
      .not("qa_audit_flags", "is", null),
    supabaseAdmin
      .from("agent_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  const qaCount = (qaRes.data || []).filter((c) => {
    const flags = (c.qa_audit_flags || {}) as {
      critical?: unknown[];
      released_at?: string;
    };
    const hasCritical = Array.isArray(flags.critical) && flags.critical.length > 0;
    const wasReleased = !!flags.released_at;
    return hasCritical && !wasReleased;
  }).length;

  return NextResponse.json({
    qa_review_pending: qaCount,
    recommendations_pending: recRes.error ? 0 : recRes.count ?? 0,
  });
}
