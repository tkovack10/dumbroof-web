import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

/** GET — fetch existing COC record for a claim */
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
    .from("certificates_of_completion")
    .select("*")
    .eq("claim_id", claimId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ coc: data?.[0] || null });
}

/** POST — generate a COC PDF via Railway backend */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const body = await req.json();
  const { claim_id, completion_date, work_summary, warranty_terms } = body;

  if (!claim_id) {
    return NextResponse.json({ error: "claim_id required" }, { status: 400 });
  }

  const authorized = await canAccessClaim(userId, claim_id);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Call Railway backend to generate PDF
  try {
    const res = await fetch(`${BACKEND_URL}/api/coc/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claim_id,
        user_id: userId,
        completion_date,
        work_description: work_summary,
        warranty_terms,
      }),
    });

    const result = await res.json();

    if (result.status === "error") {
      return NextResponse.json({ error: result.message }, { status: 500 });
    }

    // Upsert COC record in Supabase
    const { data: existingCoc } = await supabaseAdmin
      .from("certificates_of_completion")
      .select("id")
      .eq("claim_id", claim_id)
      .limit(1);

    if (existingCoc && existingCoc.length > 0) {
      await supabaseAdmin
        .from("certificates_of_completion")
        .update({
          completion_date: completion_date || new Date().toISOString().split("T")[0],
          work_summary: work_summary || null,
          warranty_terms: warranty_terms || "10-year manufacturer warranty. 5-year workmanship.",
          pdf_path: result.pdf_path,
        })
        .eq("id", existingCoc[0].id);
    } else {
      await supabaseAdmin
        .from("certificates_of_completion")
        .insert({
          claim_id,
          user_id: userId,
          completion_date: completion_date || new Date().toISOString().split("T")[0],
          work_summary: work_summary || null,
          warranty_terms: warranty_terms || "10-year manufacturer warranty. 5-year workmanship.",
          pdf_path: result.pdf_path,
        });
    }

    return NextResponse.json({
      ok: true,
      pdf_path: result.pdf_path,
      download_url: result.download_url,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate COC";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PUT — send COC email via Railway backend */
export async function PUT(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const body = await req.json();
  const { claim_id, pdf_path, to_email, cc, recipient_type, completion_photo_paths, claim_number } = body;

  if (!claim_id || !pdf_path || !to_email) {
    return NextResponse.json({ error: "claim_id, pdf_path, and to_email required" }, { status: 400 });
  }

  // Carrier emails MUST contain the claim number in the subject (carriers auto-reject otherwise).
  // Look it up from the claims table if the caller didn't pass one through.
  let resolvedClaimNumber = (claim_number || "").trim();
  if (!resolvedClaimNumber) {
    const { data: claimRow } = await supabaseAdmin
      .from("claims")
      .select("claim_number")
      .eq("id", claim_id)
      .limit(1);
    resolvedClaimNumber = (claimRow?.[0]?.claim_number || "").trim();
  }
  if (recipient_type === "carrier" && !resolvedClaimNumber) {
    return NextResponse.json(
      { error: "Claim number is required before sending to carrier. Carriers auto-reject emails without a claim number in the subject." },
      { status: 400 }
    );
  }

  const authorized = await canAccessClaim(userId, claim_id);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    // Collect all attachment paths: COC PDF + completion photos
    const allAttachments = [pdf_path];
    if (completion_photo_paths && Array.isArray(completion_photo_paths)) {
      allAttachments.push(...completion_photo_paths);
    }

    // Subject = claim number ONLY (carrier rule). Homeowner falls back to a readable label.
    const subject = resolvedClaimNumber || "Certificate of Substantial Completion";

    const res = await fetch(`${BACKEND_URL}/api/supplement-email/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claim_id,
        user_id: userId,
        to_email,
        subject,
        body_html: `<p>Please find attached the Certificate of Substantial Completion for the referenced property.</p><p>All work has been completed in accordance with the approved scope and applicable building codes.</p>${(completion_photo_paths?.length || 0) > 0 ? `<p>${completion_photo_paths.length} completion photo${completion_photo_paths.length !== 1 ? "s" : ""} attached.</p>` : ""}<p>Please process final payment at your earliest convenience.</p>`,
        cc: cc || null,
        attachment_paths: allAttachments,
        email_type: "coc",
      }),
    });

    const result = await res.json();

    if (result.status === "error") {
      return NextResponse.json({ error: result.message }, { status: 500 });
    }

    // Upsert COC record (handles "Upload Your Own" mode where no record exists yet)
    const updateField = recipient_type === "homeowner" ? "sent_to_homeowner" : "sent_to_carrier";
    const { data: existingCoc } = await supabaseAdmin
      .from("certificates_of_completion")
      .select("id")
      .eq("claim_id", claim_id)
      .limit(1);

    if (existingCoc && existingCoc.length > 0) {
      await supabaseAdmin
        .from("certificates_of_completion")
        .update({ [updateField]: true, sent_at: new Date().toISOString(), pdf_path })
        .eq("id", existingCoc[0].id);
    } else {
      await supabaseAdmin
        .from("certificates_of_completion")
        .insert({
          claim_id,
          user_id: userId,
          pdf_path,
          [updateField]: true,
          sent_at: new Date().toISOString(),
        });
    }

    // Update lifecycle phase
    await supabaseAdmin
      .from("claims")
      .update({ lifecycle_phase: "completed" })
      .eq("id", claim_id);

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send COC";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
