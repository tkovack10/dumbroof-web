import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

/** POST — send signed AOB + W9 to carrier and start email cadence */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const body = await req.json();
  const { signature_id, carrier_email, claim_number } = body;

  if (!signature_id || !carrier_email) {
    return NextResponse.json({ error: "signature_id and carrier_email required" }, { status: 400 });
  }

  // Get signature record
  const { data: sigRows } = await supabaseAdmin
    .from("aob_signatures")
    .select("*, claim_id")
    .eq("id", signature_id)
    .limit(1);

  const sig = sigRows?.[0];
  if (!sig) {
    return NextResponse.json({ error: "Signature not found" }, { status: 404 });
  }

  if (sig.status !== "signed") {
    return NextResponse.json({ error: "Document must be signed before notifying carrier" }, { status: 400 });
  }

  const authorized = await canAccessClaim(userId, sig.claim_id);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Get claim + company data
  const { data: claimRows } = await supabaseAdmin
    .from("claims")
    .select("address, carrier, claim_number")
    .eq("id", sig.claim_id)
    .limit(1);

  const claim = claimRows?.[0] || { address: "", carrier: "", claim_number: "" };

  // Carrier emails MUST contain the claim number in the subject — carriers auto-reject otherwise.
  const resolvedClaimNumber = (claim_number || claim.claim_number || "").trim();
  if (!resolvedClaimNumber) {
    return NextResponse.json(
      { error: "Claim number is required before sending to carrier. Carriers auto-reject emails without a claim number in the subject." },
      { status: 400 }
    );
  }

  const { data: cpRows } = await supabaseAdmin
    .from("company_profiles")
    .select("company_name, email, phone, address, city_state_zip, contact_name, w9_path")
    .eq("user_id", userId)
    .limit(1);

  const company = cpRows?.[0] || null;

  // Check W9
  if (!company?.w9_path) {
    return NextResponse.json({
      error: "W9 not uploaded. Please upload your company W9 in Settings before notifying carrier.",
    }, { status: 400 });
  }

  const docLabel = sig.document_type === "contingency"
    ? "Contingency Agreement with Direct Pay Authorization"
    : "Assignment of Benefits";

  const emailBody = `
    <p>Dear ${claim.carrier || "Claims Department"},</p>
    <p>Enclosed please find the legally executed <strong>${docLabel}</strong> for the insured property at <strong>${claim.address}</strong>${claim.claim_number ? ` (Claim #${claim.claim_number})` : ""}.</p>
    <p>In accordance with this agreement, please direct all future claim payments to:</p>
    <p style="padding:12px 16px;background:#f3f4f6;border-radius:8px;">
      <strong>${company?.company_name || "Contractor"}</strong><br/>
      ${company?.address || ""}<br/>
      ${company?.city_state_zip || ""}<br/>
      ${company?.phone || ""}
    </p>
    <p>Our company W-9 is attached for your records.</p>
    <p>Please acknowledge receipt of this assignment and update your records accordingly.</p>
    <p>Respectfully,<br/>${company?.contact_name || company?.company_name || "Contractor"}<br/>${company?.company_name || ""}<br/>${company?.phone || ""}</p>
  `;

  try {
    // Collect attachment paths: signed AOB + W9
    const attachmentPaths: string[] = [];
    if (sig.signed_pdf_path) attachmentPaths.push(sig.signed_pdf_path);
    if (company?.w9_path) attachmentPaths.push(company.w9_path);

    // Send email with AOB + W9 attachments via backend
    await fetch(`${BACKEND_URL}/api/supplement-email/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claim_id: sig.claim_id,
        user_id: userId,
        to_email: carrier_email,
        subject: resolvedClaimNumber,
        body_html: emailBody,
        cc: company?.email || null,
        attachment_paths: attachmentPaths.length > 0 ? attachmentPaths : undefined,
        email_type: "aob",
      }),
    });

    // Schedule follow-up cadence (Day 7, 14, 21, 30)
    const now = new Date();
    const followups = [
      { followup_number: 1, days: 7 },
      { followup_number: 2, days: 14 },
      { followup_number: 3, days: 21 },
      { followup_number: 4, days: 30 },
    ];

    for (const fu of followups) {
      const scheduledAt = new Date(now.getTime() + fu.days * 86400000);
      await supabaseAdmin
        .from("signature_followups")
        .insert({
          signature_id,
          followup_number: fu.followup_number,
          scheduled_at: scheduledAt.toISOString(),
        });
    }

    // Update signature record
    await supabaseAdmin
      .from("aob_signatures")
      .update({
        carrier_cadence_started: true,
        carrier_email,
      })
      .eq("id", signature_id);

    return NextResponse.json({ ok: true, followups_scheduled: 4 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to notify carrier";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
