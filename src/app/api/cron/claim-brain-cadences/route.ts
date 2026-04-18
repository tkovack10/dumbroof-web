import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend } from "@/lib/resend";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FROM = "DumbRoof <claims@dumbroof.ai>";
const BCC = "claims@dumbroof.ai";

// Richard's scheduled follow-ups live in claim_brain_cadence_sends. This cron fires
// every pending row whose scheduled_at has passed. Each send records via Resend and
// flips the row to status=sent (or failed).
export async function GET(req: NextRequest) {
  // Vercel Cron includes its secret header; reject anything else.
  const auth = req.headers.get("authorization");
  const vercelCronHeader = req.headers.get("x-vercel-cron");
  if (!vercelCronHeader && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowIso = new Date().toISOString();

  const { data: due, error } = await supabaseAdmin
    .from("claim_brain_cadence_sends")
    .select("id, claim_id, user_id, cadence_type, followup_number, to_email, cc, subject, body_html, attachment_paths")
    .eq("status", "pending")
    .lte("scheduled_at", nowIso)
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = due || [];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const resend = getResend();
  const results = { sent: 0, failed: 0 };

  for (const row of rows) {
    try {
      // Download any attachments from Supabase storage
      const attachments: Array<{ filename: string; content: Buffer }> = [];
      for (const path of (row.attachment_paths || []) as string[]) {
        try {
          const { data: file } = await supabaseAdmin.storage.from("claim-documents").download(path);
          if (file) {
            const buf = Buffer.from(await file.arrayBuffer());
            attachments.push({ filename: path.split("/").pop() || "attachment", content: buf });
          }
        } catch (e) {
          console.warn(`[cadence] attachment download failed ${path}:`, e);
        }
      }

      const cc: string[] = [];
      if (row.cc) {
        for (const c of String(row.cc).split(",").map((s) => s.trim()).filter(Boolean)) cc.push(c);
      }

      const { data: sent, error: sendErr } = await resend.emails.send({
        from: FROM,
        to: [row.to_email],
        cc: cc.length > 0 ? cc : undefined,
        bcc: [BCC],
        subject: row.subject,
        html: row.body_html,
        attachments: attachments.length > 0
          ? attachments.map((a) => ({ filename: a.filename, content: a.content }))
          : undefined,
        tags: [
          { name: "type", value: "claim_brain_cadence" },
          { name: "cadence_type", value: row.cadence_type || "unknown" },
          { name: "followup", value: String(row.followup_number || 0) },
        ],
      });

      if (sendErr) {
        await supabaseAdmin
          .from("claim_brain_cadence_sends")
          .update({ status: "failed", error: sendErr.message })
          .eq("id", row.id);
        results.failed++;
        continue;
      }

      await supabaseAdmin
        .from("claim_brain_cadence_sends")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", row.id);

      // Also log to claim_emails so the communication log shows the follow-up.
      try {
        await supabaseAdmin.from("claim_emails").insert({
          claim_id: row.claim_id,
          user_id: row.user_id || null,
          email_type: "cadence_followup",
          to_email: row.to_email,
          cc_email: cc.join(", ") || null,
          subject: row.subject,
          body_html: row.body_html,
          send_method: "resend",
          status: "sent",
          sent_at: new Date().toISOString(),
          metadata: { cadence_send_id: row.id, followup_number: row.followup_number, resend_id: sent?.id },
        });
      } catch (e) {
        console.warn(`[cadence] claim_emails insert failed:`, e);
      }

      results.sent++;
    } catch (e) {
      console.error(`[cadence] exception on row ${row.id}:`, e);
      await supabaseAdmin
        .from("claim_brain_cadence_sends")
        .update({ status: "failed", error: e instanceof Error ? e.message : String(e) })
        .eq("id", row.id);
      results.failed++;
    }
  }

  return NextResponse.json({ ok: true, processed: rows.length, ...results });
}
