import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend } from "@/lib/resend";

// POST /api/admin/leads/reply — reply to a captured lead. Admin only.
//
// Branding (feedback_dumbroof_external_comms_branding): every external comm goes
// out as tom@dumbroof.ai / DumbRoof — NEVER usaroofmasters.com. Replying through
// here (vs hitting Reply in the forwarded USARM inbox) is what keeps that rule.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data: me } = await supabaseAdmin
    .from("company_profiles")
    .select("is_admin")
    .eq("user_id", user.id)
    .single();
  if (!me?.is_admin) return NextResponse.json({ error: "admin only" }, { status: 403 });

  let body: { to?: string; subject?: string; message?: string; leadId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const to = (body.to || "").trim();
  const message = (body.message || "").trim();
  if (!to || !to.includes("@") || !message) {
    return NextResponse.json({ error: "to + message are required" }, { status: 400 });
  }
  const subject = (body.subject || "").trim() || "Re: your DumbRoof message";
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#1a1a2e;line-height:1.55;white-space:pre-wrap;">${message.replace(/</g, "&lt;")}</div>`;

  try {
    await getResend().emails.send({
      from: "Tom Kovack <tom@dumbroof.ai>",
      to: [to],
      replyTo: "tom@dumbroof.ai",
      subject,
      html,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 500 });
  }

  // Record the outbound reply on the lead so the thread shows it (best-effort).
  if (body.leadId) {
    try {
      const { data: row } = await supabaseAdmin
        .from("nurture_replies")
        .select("raw_payload")
        .eq("id", body.leadId)
        .single();
      const rp = ((row?.raw_payload as Record<string, unknown>) || {});
      const replies = Array.isArray(rp.admin_replies) ? (rp.admin_replies as unknown[]) : [];
      replies.push({ at: new Date().toISOString(), by: user.email, subject, message });
      await supabaseAdmin
        .from("nurture_replies")
        .update({ raw_payload: { ...rp, admin_replies: replies } })
        .eq("id", body.leadId);
    } catch {
      // non-fatal — the email already sent
    }
  }

  return NextResponse.json({ ok: true });
}
