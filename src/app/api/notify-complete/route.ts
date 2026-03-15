import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getResend, EMAIL_FROM, EMAIL_REPLY_TO } from "@/lib/resend";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB

interface NotifyRequest {
  claim_id: string;
}

export async function POST(request: Request) {
  try {
    const body: NotifyRequest = await request.json();

    if (!body.claim_id) {
      return NextResponse.json({ error: "Missing claim_id" }, { status: 400 });
    }

    // 1. Look up claim
    const { data: claim, error: claimError } = await supabaseAdmin
      .from("claims")
      .select("id, user_id, address, output_files, file_path, phase")
      .eq("id", body.claim_id)
      .single();

    if (claimError || !claim) {
      return NextResponse.json(
        { error: `Claim not found: ${claimError?.message}` },
        { status: 404 }
      );
    }

    // 2. Get user email
    const { data: userData, error: userError } =
      await supabaseAdmin.auth.admin.getUserById(claim.user_id);

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
      .eq("user_id", claim.user_id)
      .single();

    if (profile?.company_name) {
      companyName = profile.company_name;
    }

    // 4. Download PDFs from Supabase Storage
    const outputFiles: string[] = claim.output_files || [];
    const attachments: Array<{
      filename: string;
      content: Buffer;
    }> = [];
    let totalSize = 0;
    let oversized = false;

    for (const filename of outputFiles) {
      const storagePath = `${claim.file_path}/output/${filename}`;
      try {
        const { data, error } = await supabaseAdmin.storage
          .from("claim-documents")
          .download(storagePath);

        if (error || !data) {
          console.error(`[NOTIFY] Failed to download ${storagePath}:`, error?.message);
          continue;
        }

        const buffer = Buffer.from(await data.arrayBuffer());
        totalSize += buffer.length;

        if (totalSize > MAX_ATTACHMENT_BYTES) {
          oversized = true;
          break;
        }

        attachments.push({ filename, content: buffer });
      } catch (err) {
        console.error(`[NOTIFY] Error downloading ${storagePath}:`, err);
      }
    }

    // 5. Build email HTML
    const address = claim.address || "your property";
    const dashboardUrl = "https://dumbroof.ai/dashboard";
    const docCount = oversized ? outputFiles.length : attachments.length;

    const fileList = outputFiles
      .map((f) => `<li style="margin-bottom:4px;color:#374151;">${f}</li>`)
      .join("");

    const attachmentNote = oversized
      ? `<p style="color:#374151;font-size:15px;">Your documents are too large to attach. Please download them from your dashboard:</p>`
      : `<p style="color:#374151;font-size:15px;">${docCount} document${docCount !== 1 ? "s" : ""} attached for <strong>${address}</strong>.</p>`;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="background:#0d2137;padding:24px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;">Dumb Roof</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">Your claim documents are ready</h2>
            <p style="color:#6b7280;font-size:14px;margin:0 0 24px;">Hi ${companyName},</p>

            ${attachmentNote}

            <ul style="padding-left:20px;margin:16px 0 24px;">
              ${fileList}
            </ul>

            <!-- CTA Button -->
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
        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#9ca3af;font-size:12px;">
              Dumb Roof Technologies &mdash; AI-powered claims processing
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

    // 6. Send email via Resend
    const resend = getResend();
    const { error: sendError } = await resend.emails.send({
      from: EMAIL_FROM,
      to: [userEmail],
      cc: ["TKovack@USARoofMasters.com"],
      replyTo: EMAIL_REPLY_TO,
      subject: `Your claim documents are ready — ${address}`,
      html,
      attachments: oversized ? undefined : attachments.map((att) => ({
        filename: att.filename,
        content: att.content,
      })),
    });

    if (sendError) {
      console.error("[NOTIFY] Resend error:", sendError);
      return NextResponse.json({ error: sendError.message }, { status: 500 });
    }

    console.log(`[NOTIFY] Completion email sent to ${userEmail} via Resend`);

    return NextResponse.json({
      success: true,
      email: userEmail,
      attachments: oversized ? 0 : attachments.length,
      oversized,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send notification";
    console.error("[NOTIFY] Error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
