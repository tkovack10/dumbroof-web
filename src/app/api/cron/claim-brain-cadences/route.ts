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
//
// Safety guard: each row's subject MUST be the claim number (platform rule — carriers
// auto-reject anything else). Any row that fails the guard is marked `failed` without
// being sent. This protects against future paths that might bypass the preview.
function isValidClaimNumberSubject(subject: string | null | undefined): boolean {
  if (!subject) return false;
  const s = subject.trim();
  // Claim numbers are short, no whitespace, and typically alphanumeric with dashes.
  return s.length > 0 && s.length <= 40 && !/\s/.test(s);
}

export async function GET(req: NextRequest) {
  // Vercel Cron includes its secret header; reject anything else.
  // Trim the env var to dodge the well-documented trailing-newline issue.
  const auth = req.headers.get("authorization");
  const vercelCronHeader = req.headers.get("x-vercel-cron");
  const expectedSecret = process.env.CRON_SECRET?.trim();
  if (!vercelCronHeader && auth !== `Bearer ${expectedSecret}`) {
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
      // Subject must be the claim number only. If a row ever lands here with a
      // malformed subject, fail loudly rather than send something carriers reject.
      if (!isValidClaimNumberSubject(row.subject)) {
        await supabaseAdmin
          .from("claim_brain_cadence_sends")
          .update({
            status: "failed",
            error: `Subject failed claim-number format guard: "${row.subject}"`,
          })
          .eq("id", row.id);
        results.failed++;
        continue;
      }

      // Download any attachments from Supabase storage
      const attachments: Array<{ filename: string; content: Buffer }> = [];
      const missingAttachments: string[] = [];
      for (const path of (row.attachment_paths || []) as string[]) {
        try {
          const { data: file } = await supabaseAdmin.storage.from("claim-documents").download(path);
          if (file) {
            const buf = Buffer.from(await file.arrayBuffer());
            attachments.push({ filename: path.split("/").pop() || "attachment", content: buf });
          } else {
            missingAttachments.push(path);
          }
        } catch (e) {
          console.warn(`[cadence] attachment download failed ${path}:`, e);
          missingAttachments.push(path);
        }
      }

      // Refuse to send a follow-up with missing attachments — the first send
      // promised these files would come through on each round. Silently sending
      // without them would mislead the adjuster.
      if (missingAttachments.length > 0) {
        await supabaseAdmin
          .from("claim_brain_cadence_sends")
          .update({
            status: "failed",
            error: `Missing ${missingAttachments.length} attachment(s): ${missingAttachments.join(", ")}`,
          })
          .eq("id", row.id);
        results.failed++;
        continue;
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
