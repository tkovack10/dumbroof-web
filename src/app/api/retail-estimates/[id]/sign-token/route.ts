import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getCallerCompanyId } from "@/lib/company-scope";

export const dynamic = "force-dynamic";

/**
 * POST /api/retail-estimates/[id]/sign-token — issue a one-shot sign URL.
 *
 * Generates a 256-bit random token, stores it on the estimate row, and
 * returns the public /sign/{token} URL the user can text/email/copy to the
 * customer. The token is the secret — anyone with the URL can sign as that
 * customer. Single-use is enforced at submit time (signed_at NOT NULL ⇒
 * rejected). To rotate, hit this endpoint again — overwrites the prior token.
 *
 * No heavy crypto — this is functionally a Resend-style signed URL, which is
 * the level of assurance retail jobs need. Hashing at rest is overkill for an
 * MVP and would complicate the submit lookup.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const { id } = await params;

  const companyId = await getCallerCompanyId(auth.user.id);
  if (!companyId) {
    return NextResponse.json({ error: "No company profile" }, { status: 403 });
  }

  const { data: est, error: estErr } = await supabaseAdmin
    .from("retail_estimates")
    .select("id, status, signed_at")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (estErr) return NextResponse.json({ error: estErr.message }, { status: 500 });
  if (!est) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (est.signed_at) {
    return NextResponse.json(
      { error: "Estimate is already signed and cannot be re-issued" },
      { status: 409 },
    );
  }

  const token = crypto.randomBytes(32).toString("hex");

  const { error: updErr } = await supabaseAdmin
    .from("retail_estimates")
    .update({ sign_token: token, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("company_id", companyId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  const origin =
    process.env.NEXT_PUBLIC_APP_URL ||
    req.headers.get("origin") ||
    "https://www.dumbroof.ai";
  // Path is /sign/retail/[token] — namespaced under a static "retail" segment
  // so it doesn't conflict with the pre-existing /sign/[id] AOB route.
  // Both can't share /sign/[*] at the same dynamic depth (Next.js E2353:
  // "different slug names for the same dynamic path 'id' !== 'token'").
  const url = `${origin.replace(/\/$/, "")}/sign/retail/${token}`;

  return NextResponse.json({ url, token });
}
