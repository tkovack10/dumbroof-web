import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

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

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return NextResponse.json({ error: "SMTP not configured" }, { status: 500 });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // Download photo attachments from Supabase Storage
    const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];

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

          attachments.push({
            filename,
            content: buffer,
            contentType: data.type || "application/octet-stream",
          });
        } catch (err) {
          console.error(`Error downloading ${path}:`, err);
        }
      }
    }

    // Send email
    const mailOptions: nodemailer.SendMailOptions = {
      from: `"Dumb Roof Claims" <${process.env.SMTP_USER}>`,
      to: body.to,
      subject: body.subject,
      html: body.body_html,
      attachments: attachments.map((att) => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType,
      })),
    };

    if (body.cc) {
      mailOptions.cc = body.cc;
    }

    const info = await transporter.sendMail(mailOptions);

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
      messageId: info.messageId,
      threadId: info.messageId, // Gmail's message ID for thread tracking
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send email";
    console.error("Send email error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
