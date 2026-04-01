import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";
import { fillTemplatePdf } from "@/lib/pdf-template-fill";
import { DEFAULT_BINDINGS } from "@/lib/usarm-aob-template";
import type { TemplateField } from "@/lib/usarm-aob-template";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://www.dumbroof.ai";

/** GET — list signature requests for a claim, or standalone by user */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const { searchParams } = new URL(req.url);
  const claimId = searchParams.get("claim_id");
  const standalone = searchParams.get("standalone");

  if (!claimId && !standalone) {
    return NextResponse.json({ error: "claim_id or standalone=true required" }, { status: 400 });
  }

  if (claimId) {
    const authorized = await canAccessClaim(userId, claimId);
    if (!authorized) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
      .from("aob_signatures")
      .select("*")
      .eq("claim_id", claimId)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ signatures: data || [] });
  }

  // Standalone: list user's standalone documents (no claim_id)
  const { data, error } = await supabaseAdmin
    .from("aob_signatures")
    .select("*")
    .eq("user_id", userId)
    .is("claim_id", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ signatures: data || [] });
}

/** POST — create a new signature request and send to homeowner */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const body = await req.json();
  const {
    claim_id,
    template_id,
    document_type,
    homeowner_name,
    homeowner_email,
    homeowner_phone,
    address,
    trades,
    sender_fields,
    upload_mode,
    signed_pdf_path,
  } = body;

  if (!homeowner_name || !homeowner_email) {
    return NextResponse.json({ error: "homeowner_name and homeowner_email required" }, { status: 400 });
  }

  // For claim-linked requests, verify access
  let claim: { address: string; carrier: string; claim_number: string; file_path: string; date_of_loss?: string; adjuster_name?: string } | null = null;
  if (claim_id) {
    const authorized = await canAccessClaim(userId, claim_id);
    if (!authorized) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const { data: claimRows } = await supabaseAdmin
      .from("claims")
      .select("address, carrier, claim_number, file_path, date_of_loss, adjuster_name")
      .eq("id", claim_id)
      .limit(1);

    claim = claimRows?.[0] || null;
    if (!claim) {
      return NextResponse.json({ error: "Claim not found" }, { status: 404 });
    }
  }

  // Get company profile
  const { data: cpRows } = await supabaseAdmin
    .from("company_profiles")
    .select("company_name, email, phone, address, city_state_zip, contact_name, contact_title, license_number")
    .eq("user_id", userId)
    .limit(1);

  const company = cpRows?.[0] || null;
  const companyName = company?.company_name || "Your Contractor";
  const claimAddress = claim?.address || address || "";

  // ---- Upload mode: pre-signed document ----
  if (upload_mode && signed_pdf_path) {
    const { data: sig, error: sigError } = await supabaseAdmin
      .from("aob_signatures")
      .insert({
        claim_id: claim_id || null,
        user_id: userId,
        homeowner_name,
        homeowner_email,
        document_type: document_type || "aob",
        unsigned_pdf_path: signed_pdf_path,
        signed_pdf_path: signed_pdf_path,
        company_name: companyName,
        claim_address: claimAddress,
        status: "signed",
        signed_at: new Date().toISOString(),
        template_id: template_id || null,
      })
      .select("id")
      .single();

    if (sigError) return NextResponse.json({ error: sigError.message }, { status: 500 });
    return NextResponse.json({ ok: true, signature_id: sig.id, upload_mode: true });
  }

  // ---- Template-based flow ----
  if (template_id) {
    try {
      // Load template
      const { data: tplRows } = await supabaseAdmin
        .from("document_templates")
        .select("id, name, pdf_storage_path, fields, page_count")
        .eq("id", template_id)
        .limit(1);

      const tpl = tplRows?.[0];
      if (!tpl) return NextResponse.json({ error: "Template not found" }, { status: 404 });

      // Download template PDF from storage
      const { data: pdfData } = await supabaseAdmin.storage
        .from("claim-documents")
        .download(tpl.pdf_storage_path);

      if (!pdfData) return NextResponse.json({ error: "Could not load template PDF" }, { status: 500 });
      const templatePdfBytes = new Uint8Array(await pdfData.arrayBuffer());

      // Build auto-fill bindings
      const today = new Date().toLocaleDateString("en-US");
      const bindings: Record<string, string> = {
        ...DEFAULT_BINDINGS,
        homeowner_name: homeowner_name,
        homeowner_email: homeowner_email,
        homeowner_phone: homeowner_phone || "",
        address: claimAddress,
        city_state_zip: claim?.address ? "" : (sender_fields?.city_state_zip || ""),
        carrier: claim?.carrier || sender_fields?.carrier || "",
        claim_number: claim?.claim_number || sender_fields?.claim_number || "",
        adjuster_info: claim?.adjuster_name || sender_fields?.adjuster_info || "",
        date_of_loss: claim?.date_of_loss || sender_fields?.date_of_loss || "",
        rep_name: company?.contact_name || "",
        rep_date: today,
        current_date: today,
        job_number: claim?.claim_number || `JOB-${Date.now().toString(36).toUpperCase()}`,
      };

      // Build sender fields (trade checkboxes + any extra)
      const senderFieldValues: Record<string, string> = { ...(sender_fields || {}) };
      if (trades && Array.isArray(trades)) {
        for (const t of trades) {
          const fieldId = `trade_${t}`;
          senderFieldValues[fieldId] = "checked";
        }
      }

      // Pre-fill the template PDF (auto + sender fields only)
      const fields = tpl.fields as TemplateField[];
      const prefilledPdf = await fillTemplatePdf(templatePdfBytes, fields, {
        bindings,
        senderFields: senderFieldValues,
      }, "prefill");

      // Upload pre-filled unsigned PDF
      const storagePath = claim_id
        ? `${claim?.file_path || claim_id}/aob/unsigned_template_${Date.now()}.pdf`
        : `${userId}/standalone/aob/unsigned_template_${Date.now()}.pdf`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from("claim-documents")
        .upload(storagePath, prefilledPdf, { contentType: "application/pdf", upsert: true });

      if (uploadError) return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });

      // Create signature record
      const { data: sig, error: sigError } = await supabaseAdmin
        .from("aob_signatures")
        .insert({
          claim_id: claim_id || null,
          user_id: userId,
          homeowner_name,
          homeowner_email,
          document_type: document_type || "aob",
          unsigned_pdf_path: storagePath,
          company_name: companyName,
          claim_address: claimAddress,
          status: "pending",
          template_id,
          fields_data: { bindings, senderFields: senderFieldValues },
          trades: trades || null,
        })
        .select("id")
        .single();

      if (sigError) return NextResponse.json({ error: sigError.message }, { status: 500 });

      const signLink = `${SITE_URL}/sign/${sig.id}`;

      // Send email
      const docLabel = document_type === "contingency" ? "Contingency Agreement" : "Assignment of Benefits";
      const emailBody = `
        <p>Dear ${homeowner_name},</p>
        <p>${companyName} has sent you a <strong>${docLabel}</strong> to review and sign for the property at <strong>${claimAddress}</strong>.</p>
        <p>Please click the link below to review the document and provide your electronic signature:</p>
        <p style="text-align:center;margin:24px 0;">
          <a href="${signLink}" style="background-color:#2563eb;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
            Review &amp; Sign Document
          </a>
        </p>
        <p style="font-size:12px;color:#6b7280;">If the button doesn't work, copy and paste this URL: ${signLink}</p>
        <p>Respectfully,<br/>${companyName}<br/>${company?.phone || ""}</p>
      `;

      await fetch(`${BACKEND_URL}/api/supplement-email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim_id: claim_id || null,
          user_id: userId,
          to_email: homeowner_email,
          subject: `${docLabel} — ${claimAddress}`,
          body_html: emailBody,
        }),
      });

      return NextResponse.json({ ok: true, signature_id: sig.id, sign_link: signLink });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create template-based signing request";
      console.error("Template signing error:", err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // ---- Legacy flow: generate AOB from scratch via backend ----
  if (!claim_id) {
    return NextResponse.json({ error: "claim_id required for non-template signing (or provide template_id)" }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/generate-aob`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claim_id,
        user_id: userId,
        document_type: document_type || "aob",
        homeowner_name,
      }),
    });

    let pdfPath = "";
    if (res.ok) {
      const result = await res.json();
      pdfPath = result.pdf_path || "";
    } else {
      pdfPath = `${claim?.file_path || claim_id}/aob/unsigned_${document_type || "aob"}_${Date.now()}.pdf`;
    }

    const { data: sig, error: sigError } = await supabaseAdmin
      .from("aob_signatures")
      .insert({
        claim_id,
        user_id: userId,
        homeowner_name,
        homeowner_email,
        document_type: document_type || "aob",
        unsigned_pdf_path: pdfPath,
        company_name: companyName,
        claim_address: claimAddress,
        status: "pending",
      })
      .select("id")
      .single();

    if (sigError) return NextResponse.json({ error: sigError.message }, { status: 500 });

    const signLink = `${SITE_URL}/sign/${sig.id}`;
    const docLabel = document_type === "contingency" ? "Contingency Agreement" : "Assignment of Benefits";

    const emailBody = `
      <p>Dear ${homeowner_name},</p>
      <p>${companyName} has sent you a <strong>${docLabel}</strong> to review and sign for the property at <strong>${claimAddress}</strong>.</p>
      <p>Please click the link below to review the document and provide your electronic signature:</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${signLink}" style="background-color:#2563eb;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
          Review &amp; Sign Document
        </a>
      </p>
      <p style="font-size:12px;color:#6b7280;">If the button doesn't work, copy and paste this URL: ${signLink}</p>
      <p>Respectfully,<br/>${companyName}<br/>${company?.phone || ""}</p>
    `;

    await fetch(`${BACKEND_URL}/api/supplement-email/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claim_id,
        user_id: userId,
        to_email: homeowner_email,
        subject: `${docLabel} — ${claimAddress}`,
        body_html: emailBody,
      }),
    });

    return NextResponse.json({ ok: true, signature_id: sig.id, sign_link: signLink });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create signing request";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
