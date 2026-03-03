/**
 * Cloudflare Email Worker — claims@dumbroof.ai Inbox
 *
 * Receives emails via Cloudflare Email Routing, parses MIME,
 * detects forwarded messages, extracts carrier sender/body/PDFs,
 * and POSTs structured payload to Supabase Edge Function.
 *
 * On webhook failure, forwards the raw email to Tom's inbox (nothing lost).
 */

import PostalMime from "postal-mime";
import { parseForwardedEmail, extractEmailAddress } from "./forward-parser";

interface Env {
  WEBHOOK_URL: string;
  WEBHOOK_SECRET: string;
  FALLBACK_EMAIL: string;
  ENVIRONMENT: string;
}

interface EmailAttachment {
  filename: string;
  mimeType: string;
  content: string; // base64
  size: number;
}

interface WebhookPayload {
  message_id: string | null;
  from_email: string;
  to_email: string;
  subject: string;
  date: string | null;
  // Forwarded email fields
  is_forwarded: boolean;
  original_from: string | null;
  original_subject: string | null;
  original_date: string | null;
  original_body: string;
  forwarder_note: string;
  // Full content
  text_body: string;
  html_body: string;
  // Headers for thread matching
  in_reply_to: string | null;
  references: string | null;
  // Attachments
  attachments: EmailAttachment[];
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    console.log(`[EMAIL] Received from: ${message.from}, to: ${message.to}, subject: ${message.headers.get("subject")}`);

    try {
      // Read the raw email bytes
      const rawEmail = await streamToArrayBuffer(message.raw);
      const rawEmailUint8 = new Uint8Array(rawEmail);

      // Parse MIME with postal-mime
      const parser = new PostalMime();
      const parsed = await parser.parse(rawEmailUint8);

      // Detect forwarded email
      const textBody = parsed.text || "";
      const htmlBody = parsed.html || "";
      const forwardResult = parseForwardedEmail(textBody);

      // Extract PDF attachments as base64
      const attachments: EmailAttachment[] = [];
      if (parsed.attachments) {
        for (const att of parsed.attachments) {
          // Only keep PDFs and images (skip signatures, calendar invites, etc.)
          const isPdf = att.mimeType === "application/pdf";
          const isImage = att.mimeType?.startsWith("image/");
          if (!isPdf && !isImage) continue;

          const base64 = arrayBufferToBase64(att.content);
          attachments.push({
            filename: att.filename || `attachment_${attachments.length + 1}${isPdf ? ".pdf" : ".jpg"}`,
            mimeType: att.mimeType || "application/octet-stream",
            content: base64,
            size: att.content.byteLength,
          });
        }
      }

      // Build webhook payload
      const payload: WebhookPayload = {
        message_id: parsed.messageId || message.headers.get("message-id"),
        from_email: message.from,
        to_email: message.to,
        subject: parsed.subject || message.headers.get("subject") || "(no subject)",
        date: parsed.date || message.headers.get("date"),
        is_forwarded: forwardResult.isForwarded,
        original_from: forwardResult.originalFrom
          ? extractEmailAddress(forwardResult.originalFrom)
          : null,
        original_subject: forwardResult.originalSubject,
        original_date: forwardResult.originalDate,
        original_body: forwardResult.originalBody,
        forwarder_note: forwardResult.forwarderNote,
        text_body: textBody,
        html_body: htmlBody,
        in_reply_to: parsed.inReplyTo?.[0] || message.headers.get("in-reply-to"),
        references: message.headers.get("references"),
        attachments,
      };

      console.log(`[EMAIL] Parsed: forwarded=${forwardResult.isForwarded}, attachments=${attachments.length}, original_from=${payload.original_from}`);

      // POST to Supabase Edge Function
      const response = await fetch(env.WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.WEBHOOK_SECRET}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[EMAIL] Webhook failed (${response.status}): ${errorText}`);
        throw new Error(`Webhook returned ${response.status}`);
      }

      const result = await response.json() as Record<string, unknown>;
      console.log(`[EMAIL] Webhook success: correspondence_id=${result.id}, matched=${result.matched}`);

    } catch (error) {
      console.error(`[EMAIL] Processing failed:`, error);

      // Fallback: forward raw email to Tom so nothing is lost
      if (env.FALLBACK_EMAIL) {
        try {
          await message.forward(env.FALLBACK_EMAIL, new Headers({
            "X-Forwarded-Reason": "email-worker-error",
            "X-Error": error instanceof Error ? error.message : "Unknown error",
          }));
          console.log(`[EMAIL] Forwarded to fallback: ${env.FALLBACK_EMAIL}`);
        } catch (fwdError) {
          console.error(`[EMAIL] Fallback forward also failed:`, fwdError);
        }
      }
    }
  },
};

/** Convert a ReadableStream to ArrayBuffer */
async function streamToArrayBuffer(stream: ReadableStream): Promise<ArrayBuffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result.buffer;
}

/** Convert ArrayBuffer to base64 string */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
