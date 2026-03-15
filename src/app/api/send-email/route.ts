import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getResend, EMAIL_FROM_CLAIMS, EMAIL_REPLY_TO } from "@/lib/resend";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

interface SendEmailRequest {
  draft_id: string;
  to: string;
  cc?: string;
  subject: string;
  body_html: string;
  photo_paths?: string[]; // Supabase Storage paths
}

export async function POST(request: Request) {
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
          const { data, error } = await supabase.storage
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

    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM_CLAIMS,
      to: [body.to],
      cc: body.cc ? [body.cc] : undefined,
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
