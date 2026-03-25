import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://www.dumbroof.ai";

/** GET — list signature requests for a claim */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const { searchParams } = new URL(req.url);
  const claimId = searchParams.get("claim_id");

  if (!claimId) {
    return NextResponse.json({ error: "claim_id required" }, { status: 400 });
  }

  const authorized = await canAccessClaim(userId, claimId);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from("aob_signatures")
    .select("*")
    .eq("claim_id", claimId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ signatures: data || [] });
}

/** POST — create a new signature request and send to homeowner */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const body = await req.json();
  const { claim_id, document_type, homeowner_name, homeowner_email } = body;

  if (!claim_id || !homeowner_name || !homeowner_email) {
    return NextResponse.json({ error: "claim_id, homeowner_name, and homeowner_email required" }, { status: 400 });
  }

  const authorized = await canAccessClaim(userId, claim_id);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Get claim data
  const { data: claimRows } = await supabaseAdmin
    .from("claims")
    .select("address, carrier, claim_number, file_path")
    .eq("id", claim_id)
    .limit(1);

  const claim = claimRows?.[0];
  if (!claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  // Get company profile
  const { data: cpRows } = await supabaseAdmin
    .from("company_profiles")
    .select("company_name, email, phone, address, city_state_zip, contact_name, license_number")
    .eq("user_id", userId)
    .limit(1);

  const company = cpRows?.[0] || null;
  const companyName = company?.company_name || "Your Contractor";

  // Generate unsigned AOB/contingency PDF via Railway backend
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
      // Fallback: create a placeholder path (backend may not have the endpoint yet)
      pdfPath = `${claim.file_path || claim_id}/aob/unsigned_${document_type || "aob"}_${Date.now()}.pdf`;
    }

    // Create signature record
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
        claim_address: claim.address,
        status: "pending",
      })
      .select("id")
      .single();

    if (sigError) {
      return NextResponse.json({ error: sigError.message }, { status: 500 });
    }

    const signLink = `${SITE_URL}/sign/${sig.id}`;

    // Send email to homeowner with signing link
    const docLabel = document_type === "contingency" ? "Contingency Agreement" : "Assignment of Benefits";

    const emailBody = `
      <p>Dear ${homeowner_name},</p>
      <p>${companyName} has sent you a <strong>${docLabel}</strong> to review and sign for the property at <strong>${claim.address}</strong>.</p>
      <p>Please click the link below to review the document and provide your electronic signature:</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${signLink}" style="background-color:#2563eb;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
          Review &amp; Sign Document
        </a>
      </p>
      <p style="font-size:12px;color:#6b7280;">If the button doesn't work, copy and paste this URL: ${signLink}</p>
      <p>Respectfully,<br/>${companyName}<br/>${company?.phone || ""}</p>
    `;

    // Send via backend
    await fetch(`${BACKEND_URL}/api/supplement-email/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claim_id,
        user_id: userId,
        to_email: homeowner_email,
        subject: `${docLabel} — ${claim.address}`,
        body_html: emailBody,
      }),
    });

    return NextResponse.json({
      ok: true,
      signature_id: sig.id,
      sign_link: signLink,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create signing request";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
