import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";
import { getResend, EMAIL_FROM_CLAIMS, EMAIL_REPLY_TO } from "@/lib/resend";
import { companyOwnerEmails, mergeBcc } from "@/lib/team-bcc";

interface SendEmailRequest {
  draft_id: string;
  claim_id: string; // required — the claim whose files are being emailed
  to: string;
  cc?: string;
  subject: string;
  body_html: string;
  photo_paths?: string[]; // Supabase Storage paths (must live under the claim's file_path)
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

    // Tenancy gate — this endpoint downloads caller-supplied photo_paths via the
    // RLS-bypassing service-role client, so it MUST verify the caller owns (or
    // shares the company of) the claim those files belong to, and that every
    // requested path actually lives under that claim's storage prefix. Without
    // this, any signed-in user could exfiltrate another tenant's files by POSTing
    // their storage paths. Mirrors the COC route's ownership check.
    if (!body.claim_id) {
      return NextResponse.json({ error: "claim_id required" }, { status: 400 });
    }

    const authorized = await canAccessClaim(user.id, body.claim_id);
    if (!authorized) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Resolve the claim's storage prefix so we can confine attachments to it.
    const { data: claimRows } = await supabaseAdmin
      .from("claims")
      .select("file_path")
      .eq("id", body.claim_id)
      .limit(1);
    const filePath = (claimRows?.[0]?.file_path || "").trim().replace(/\/+$/, "");
    if (!filePath) {
      return NextResponse.json({ error: "Claim has no storage path" }, { status: 400 });
    }

    // Every photo_path must live under the claim's file_path prefix. Require the
    // trailing-slash boundary (prefix + "/") so a sibling like "user/1234/..."
    // can't satisfy a "user/123" prefix. Reject the whole request (rather than
    // silently skipping) if any path escapes it.
    const allowedPrefix = `${filePath}/`;
    if (body.photo_paths && body.photo_paths.length > 0) {
      const invalid = body.photo_paths.find((p) => !p || !p.startsWith(allowedPrefix));
      if (invalid !== undefined) {
        return NextResponse.json(
          { error: "One or more photo_paths do not belong to this claim" },
          { status: 403 }
        );
      }
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
