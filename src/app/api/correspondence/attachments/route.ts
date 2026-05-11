import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";

/**
 * Mint signed download URLs for a carrier_correspondence row's attachments.
 * Reuses the photo-review/claim-photos signed-URL pattern. 1-hour TTL.
 *
 * Auth: requires the caller to have access to the underlying claim.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  let body: { correspondence_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const correspondenceId = body.correspondence_id;
  if (!correspondenceId) {
    return NextResponse.json({ error: "correspondence_id required" }, { status: 400 });
  }

  const { data: row, error: rowErr } = await supabaseAdmin
    .from("carrier_correspondence")
    .select("claim_id, attachment_paths")
    .eq("id", correspondenceId)
    .single();

  if (rowErr || !row) {
    return NextResponse.json({ error: "Correspondence not found" }, { status: 404 });
  }
  if (!row.claim_id) {
    return NextResponse.json({ attachments: [] });
  }

  const authorized = await canAccessClaim(userId, row.claim_id);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const paths: string[] = Array.isArray(row.attachment_paths) ? row.attachment_paths : [];
  if (paths.length === 0) {
    return NextResponse.json({ attachments: [] });
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from("claim-documents")
    .createSignedUrls(paths, 3600);
  if (signErr) {
    return NextResponse.json({ error: signErr.message }, { status: 500 });
  }

  const attachments = (signed || []).map((s, i) => ({
    path: paths[i],
    signed_url: s.signedUrl || "",
    filename: (paths[i] || "").split("/").pop() || "attachment",
  }));

  return NextResponse.json({ attachments });
}
