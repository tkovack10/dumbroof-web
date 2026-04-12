import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getSb() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  // Admin auth gate
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

  const sb = getSb();

  const { data: claim, error: fetchErr } = await sb
    .from("claims")
    .select("id, status, qa_audit_flags")
    .eq("id", id)
    .limit(1);

  if (fetchErr || !claim || claim.length === 0) {
    return NextResponse.json({ error: "claim not found" }, { status: 404 });
  }
  if (claim[0].status !== "qa_review_pending") {
    return NextResponse.json({ error: `claim is not in qa_review_pending state (current: ${claim[0].status})` }, { status: 400 });
  }

  // Mark the existing flags as manually overridden (preserves audit history).
  const existingFlags = (claim[0].qa_audit_flags || {}) as Record<string, unknown>;
  const overriddenFlags = {
    ...existingFlags,
    released_by: user.email || user.id,
    released_at: new Date().toISOString(),
    override_reason: "admin manual override via /admin/qa-review",
  };

  const { error: updateErr } = await sb
    .from("claims")
    .update({
      status: "ready",
      qa_audit_flags: overriddenFlags,
    })
    .eq("id", id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Trigger the customer completion email (same path processor.py uses on normal ready)
  try {
    await fetch("https://www.dumbroof.ai/api/notify-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim_id: id }),
    });
  } catch (e) {
    console.error("[qa-release] notify-complete failed (non-fatal):", e);
  }

  return NextResponse.json({ success: true });
}
