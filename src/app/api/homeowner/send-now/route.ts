import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";
import { getResend, EMAIL_FROM, EMAIL_REPLY_TO } from "@/lib/resend";
import { logClaimEvent } from "@/lib/claim-events";

/**
 * POST /api/homeowner/send-now
 * Body: { claim_id, template_slug }
 *
 * Sends a homeowner engagement email on-demand (no sequence cadence).
 * Pulls template from `email_templates`, resolves attachments from
 * `marketing_assets`, logs to `homeowner_sends` + `claim_events`, increments
 * `claims.homeowner_comms_count`.
 */
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { user } = auth;

  let body: { claim_id?: string; template_slug?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const claimId = (body.claim_id || "").trim();
  const templateSlug = (body.template_slug || "").trim();

  if (!claimId || !templateSlug) {
    return NextResponse.json({ error: "claim_id and template_slug required" }, { status: 400 });
  }

  const allowed = await canAccessClaim(user.id, claimId);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Load claim to get homeowner_email + company context
  const { data: claimRows } = await supabaseAdmin
    .from("claims")
    .select("id, homeowner_name, homeowner_email, address, claim_number, carrier, company_id, user_id, homeowner_comms_count")
    .eq("id", claimId)
    .limit(1);
  const claim = claimRows?.[0];
  if (!claim) return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  if (!claim.homeowner_email) {
    return NextResponse.json(
      { error: "Homeowner email missing — add it in Contact details first." },
      { status: 400 }
    );
  }

  // Load template — prefer company override, fall back to global
  const { data: templateRows } = await supabaseAdmin
    .from("email_templates")
    .select("slug, subject, body_html, body_text, default_attachments")
    .eq("slug", templateSlug)
    .or(`company_id.eq.${claim.company_id},company_id.is.null`)
    .order("company_id", { ascending: false, nullsFirst: false })
    .limit(1);
  const template = templateRows?.[0];
  if (!template) {
    return NextResponse.json({ error: `Template '${templateSlug}' not found` }, { status: 404 });
  }

  // Resolve attachment paths
  const attachmentIds = (template.default_attachments as string[] | null) || [];
  let attachments: Array<{ filename: string; content: Buffer }> = [];
  if (attachmentIds.length > 0) {
    const { data: assetRows } = await supabaseAdmin
      .from("marketing_assets")
      .select("slug, title, file_path, mime_type")
      .in("id", attachmentIds)
      .eq("active", true);
    for (const asset of assetRows || []) {
      if (!asset.file_path) continue;
      try {
        const { data: file } = await supabaseAdmin.storage.from("marketing-assets").download(asset.file_path);
        if (file) {
          const buf = Buffer.from(await file.arrayBuffer());
          const ext = asset.mime_type === "application/pdf" ? ".pdf" : "";
          attachments.push({ filename: `${asset.slug}${ext}`, content: buf });
        }
      } catch (e) {
        console.warn(`[send-now] failed to fetch asset ${asset.slug}:`, e);
      }
    }
  }

  // Personalize: {{homeowner_name}}, {{address}}, {{claim_number}}, {{carrier}}.
  // Escape interpolated values — these come from editable Claim fields and must not
  // break HTML if a homeowner name contains < > & " ' (or is deliberately crafted).
  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  // For HTML contexts: escape each substitution. Template body_html itself is
  // admin-authored and trusted.
  const interpolateHtml = (s: string) =>
    s
      .replace(/\{\{\s*homeowner_name\s*\}\}/g, escape(claim.homeowner_name || "there"))
      .replace(/\{\{\s*address\s*\}\}/g, escape(claim.address || ""))
      .replace(/\{\{\s*claim_number\s*\}\}/g, escape(claim.claim_number || ""))
      .replace(/\{\{\s*carrier\s*\}\}/g, escape(claim.carrier || "your carrier"));

  // For plaintext subject lines: no escaping needed, Resend handles them safely.
  const interpolatePlain = (s: string) =>
    s
      .replace(/\{\{\s*homeowner_name\s*\}\}/g, claim.homeowner_name || "there")
      .replace(/\{\{\s*address\s*\}\}/g, claim.address || "")
      .replace(/\{\{\s*claim_number\s*\}\}/g, claim.claim_number || "")
      .replace(/\{\{\s*carrier\s*\}\}/g, claim.carrier || "your carrier");

  const subject = interpolatePlain(template.subject || "Update on your roof claim");
  const html = template.body_html
    ? interpolateHtml(template.body_html)
    : `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;padding:24px;">${interpolateHtml(
        escape(template.body_text || "")
      ).replace(/\n/g, "<br/>")}</div>`;

  // Send
  let resendId: string | null = null;
  try {
    const resend = getResend();
    const { data } = await resend.emails.send({
      from: EMAIL_FROM,
      to: [claim.homeowner_email],
      replyTo: EMAIL_REPLY_TO,
      subject,
      html,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    resendId = data?.id || null;
  } catch (e) {
    console.error("[send-now] Resend failed", e);
    return NextResponse.json({ error: "Email send failed" }, { status: 500 });
  }

  // Log homeowner_sends + bump counter
  await supabaseAdmin.from("homeowner_sends").insert({
    claim_id: claimId,
    template_slug: templateSlug,
    to_email: claim.homeowner_email,
    subject,
    body_preview: (template.body_text || "").slice(0, 500),
    attachments: attachmentIds,
    sent_by: user.id,
    resend_email_id: resendId,
  });

  await supabaseAdmin
    .from("claims")
    .update({ homeowner_comms_count: (claim.homeowner_comms_count || 0) + 1 })
    .eq("id", claimId);

  await logClaimEvent(claimId, "homeowner_email_sent", {
    source: "user",
    createdBy: user.id,
    title: `Sent "${subject}" to homeowner`,
    metadata: {
      template_slug: templateSlug,
      to: claim.homeowner_email,
      resend_id: resendId,
      attachment_count: attachmentIds.length,
    },
  });

  return NextResponse.json({ ok: true, resend_id: resendId, attachment_count: attachmentIds.length });
}
