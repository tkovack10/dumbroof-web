import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend, EMAIL_FROM, EMAIL_REPLY_TO } from "@/lib/resend";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB

interface NotifyRepairRequest {
  repair_id: string;
}

export async function POST(request: Request) {
  try {
    const body: NotifyRepairRequest = await request.json();

    if (!body.repair_id) {
      return NextResponse.json({ error: "Missing repair_id" }, { status: 400 });
    }

    // 1. Look up repair
    const { data: repair, error: repairError } = await supabaseAdmin
      .from("repairs")
      .select("id, user_id, address, output_files, file_path, homeowner_email, homeowner_name, email_sent_at")
      .eq("id", body.repair_id)
      .single();

    if (repairError || !repair) {
      return NextResponse.json(
        { error: `Repair not found: ${repairError?.message}` },
        { status: 404 }
      );
    }

    // Duplicate protection
    if (repair.email_sent_at) {
      console.log(`[REPAIR-NOTIFY] Already sent for ${body.repair_id} at ${repair.email_sent_at} — skipping`);
      return NextResponse.json({ success: true, skipped: true, reason: "already_sent" });
    }

    // 2. Get user email
    const { data: userData, error: userError } =
      await supabaseAdmin.auth.admin.getUserById(repair.user_id);

    if (userError || !userData?.user?.email) {
      return NextResponse.json(
        { error: `User not found: ${userError?.message}` },
        { status: 404 }
      );
    }

    const userEmail = userData.user.email;

    // 3. Get company name for branding
    let companyName = "Your company";
    const { data: profile } = await supabaseAdmin
      .from("company_profiles")
      .select("company_name")
      .eq("user_id", repair.user_id)
      .single();

    if (profile?.company_name) {
      companyName = profile.company_name;
    }

    // 4. Download PDFs from Supabase Storage (parallel)
    const outputFiles: string[] = repair.output_files || [];
    const downloadResults = await Promise.allSettled(
      outputFiles.map(async (filename) => {
        const storagePath = `${repair.file_path}/output/${filename}`;
        const { data, error } = await supabaseAdmin.storage
          .from("claim-documents")
          .download(storagePath);
        if (error || !data) throw new Error(`Failed: ${storagePath}`);
        return {
          filename,
          content: Buffer.from(await data.arrayBuffer()),
        };
      })
    );

    const allAttachments: { filename: string; content: Buffer }[] = [];
    for (const r of downloadResults) {
      if (r.status === "fulfilled") allAttachments.push(r.value);
    }

    let totalSize = 0;
    let oversized = false;
    const attachments: typeof allAttachments = [];
    for (const att of allAttachments) {
      totalSize += att.content.length;
      if (totalSize > MAX_ATTACHMENT_BYTES) {
        oversized = true;
        break;
      }
      attachments.push(att);
    }

    const resend = getResend();
    const address = repair.address || "your property";
    const dashboardUrl = "https://dumbroof.ai/dashboard";

    // 5. Email 1: User gets ALL PDFs
    const userFileList = outputFiles
      .map((f) => `<li style="margin-bottom:4px;color:#374151;">${f.replace(/_/g, " ").replace(".pdf", "")}</li>`)
      .join("");

    const userHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
        <tr>
          <td style="background:#0d2137;padding:24px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;">Dumb Roof</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">Repair diagnosis ready</h2>
            <p style="color:#6b7280;font-size:14px;margin:0 0 24px;">Hi ${companyName},</p>
            <p style="color:#374151;font-size:15px;">Your repair documents for <strong>${address}</strong> are attached.</p>
            <ul style="padding-left:20px;margin:16px 0 24px;">${userFileList}</ul>
            <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
              <tr>
                <td style="background:#dc2626;border-radius:6px;">
                  <a href="${dashboardUrl}" target="_blank"
                     style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">
                    View on Dashboard
                  </a>
                </td>
              </tr>
            </table>
            <p style="color:#6b7280;font-size:13px;margin:24px 0 0;">
              Questions? Reply to this email or contact us at
              <a href="mailto:hello@dumbroof.ai" style="color:#2563eb;">hello@dumbroof.ai</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#9ca3af;font-size:12px;">Dumb Roof Technologies &mdash; AI-powered roof repair</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

    const { error: userSendError } = await resend.emails.send({
      from: EMAIL_FROM,
      to: [userEmail],
      cc: ["TKovack@USARoofMasters.com"],
      replyTo: EMAIL_REPLY_TO,
      subject: `Repair Diagnosis Ready \u2014 ${address}`,
      html: userHtml,
      attachments: oversized ? undefined : attachments.map((att) => ({
        filename: att.filename,
        content: att.content,
      })),
    });

    if (userSendError) {
      console.error("[REPAIR-NOTIFY] Resend error:", userSendError);
      return NextResponse.json({ error: userSendError.message }, { status: 500 });
    }

    console.log(`[REPAIR-NOTIFY] User email sent to ${userEmail} via Resend`);

    // 6. Email 2: Homeowner gets TICKET PDF only (if homeowner_email provided)
    let homeownerSent = false;
    if (repair.homeowner_email) {
      const ticketFile = allAttachments.find((a) => a.filename.includes("TICKET"));

      const homeownerHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
        <tr>
          <td style="background:#0d2137;padding:24px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;">${companyName}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">Roof Repair Diagnosis</h2>
            <p style="color:#6b7280;font-size:14px;margin:0 0 24px;">Hi ${repair.homeowner_name || "there"},</p>
            <p style="color:#374151;font-size:15px;">
              We&rsquo;ve completed our inspection at <strong>${address}</strong>.
              Your repair diagnosis and quote are attached.
            </p>
            <p style="color:#374151;font-size:15px;margin:16px 0;">
              Please review the attached document. If you have any questions or would like to proceed with the repair,
              contact us directly.
            </p>
            <p style="color:#6b7280;font-size:13px;margin:24px 0 0;">
              &mdash; ${companyName}
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#9ca3af;font-size:12px;">Powered by Dumb Roof Technologies</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

      const { error: hoSendError } = await resend.emails.send({
        from: `${companyName} <hello@dumbroof.ai>`,
        to: [repair.homeowner_email],
        replyTo: EMAIL_REPLY_TO,
        subject: `Roof Repair Diagnosis \u2014 ${address}`,
        html: homeownerHtml,
        attachments: ticketFile ? [{
          filename: ticketFile.filename,
          content: ticketFile.content,
        }] : undefined,
      });

      if (!hoSendError) {
        homeownerSent = true;
        console.log(`[REPAIR-NOTIFY] Homeowner email sent to ${repair.homeowner_email} via Resend`);
      }
    }

    // 7. Mark email_sent_at
    await supabaseAdmin
      .from("repairs")
      .update({ email_sent_at: new Date().toISOString() })
      .eq("id", body.repair_id);

    return NextResponse.json({
      success: true,
      user_email: userEmail,
      homeowner_email_sent: homeownerSent,
      attachments: oversized ? 0 : attachments.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send notification";
    console.error("[REPAIR-NOTIFY] Error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
