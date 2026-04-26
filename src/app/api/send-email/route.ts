import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getResend, EMAIL_FROM_CLAIMS, EMAIL_REPLY_TO } from "@/lib/resend";
import { companyOwnerEmails, mergeBcc } from "@/lib/team-bcc";

interface SendEmailRequest {
  draft_id: string;
  to: string;
  cc?: string;
  subject: string;
  body_html: string;
  photo_paths?: string[]; // Supabase Storage paths
}

export async function POST(request: Request) {
  // Auth gate — this route was previously open. Anyone could POST and send
  // mail through dumbroof.ai's verified Resend domain. Now requires a signed-in
  // user so we know who's sending and can BCC their team owner.
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { user } = auth;

  try {
    const body: SendEmailRequest = await request.json();

    if (!body.to || !body.subject || !body.body_html) {
      return NextResponse.json({ error: "Missing required fields: to, subject, body_html" }, { status: 400 });
    }

    // Download photo attachments from Supabase Storage
    const attachments: Array<{ filename: string; content: Buffer }> = [];

    if (body.photo_paths && body.photo_paths.length > 0) {
      for (const path of body.photo_paths) {
        try {
          const { data, error } = await supabaseAdmin.storage
            .from("claim-documents")
            .download(path);

          if (error || !data) {
            console.error(`Failed to download attachment ${path}:`, error?.message);
            continue;
          }

          const buffer = Buffer.from(await data.arrayBuffer());
          const filename = path.split("/").pop() || "attachment.jpg";

          attachments.push({ filename, content: buffer });
        } catch (err) {
          console.error(`Error downloading ${path}:`, err);
        }
      }
    }

    // Team-owner BCC — every claim email a team member sends gets the
    // company owner copied (BCC, never CC — don't leak internal hierarchy
    // to the recipient).
    const ownerBcc = await companyOwnerEmails(user.id);
    const bcc = mergeBcc(undefined, ownerBcc, body.to);

    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM_CLAIMS,
      to: [body.to],
      cc: body.cc ? [body.cc] : undefined,
      bcc: bcc.length > 0 ? bcc : undefined,
      replyTo: EMAIL_REPLY_TO,
      subject: body.subject,
      html: body.body_html,
      attachments: attachments.map((att) => ({
        filename: att.filename,
        content: att.content,
      })),
    });

    if (error) {
      console.error("Resend error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Update draft status in backend
    if (body.draft_id) {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
      try {
        await fetch(`${backendUrl}/api/drafts/${body.draft_id}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        console.error("Failed to update draft status:", err);
      }
    }

    return NextResponse.json({
      success: true,
      messageId: data?.id,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send email";
    console.error("Send email error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
