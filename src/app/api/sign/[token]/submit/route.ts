import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/sign/[token]/submit — public endpoint, no auth.
 *
 * The token IS the auth — anyone with the URL can sign as the customer it
 * was sent to. Single-use is enforced: if signed_at is already set, returns
 * 409 instead of overwriting. We record name, IP, and user-agent for
 * downstream dispute defense; not legally bulletproof, but matches what
 * SaaS e-sign tools record at the MVP tier.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 32) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  let body: { name?: string } = {};
  try {
    body = (await req.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = (body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "Signature name required" }, { status: 400 });
  }

  const { data: est, error: lookupErr } = await supabaseAdmin
    .from("retail_estimates")
    .select("id, signed_at")
    .eq("sign_token", token)
    .maybeSingle();
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  if (!est) return NextResponse.json({ error: "Sign link not found or revoked" }, { status: 404 });
  if (est.signed_at) {
    return NextResponse.json({ error: "Already signed" }, { status: 409 });
  }

  // Vercel forwards client IP via x-forwarded-for (first hop is the client).
  const xff = req.headers.get("x-forwarded-for") || "";
  const ip = xff.split(",")[0].trim() || req.headers.get("x-real-ip") || null;
  const ua = req.headers.get("user-agent") || null;

  const now = new Date().toISOString();
  const { error: updErr } = await supabaseAdmin
    .from("retail_estimates")
    .update({
      signed_at: now,
      signed_by_name: name,
      signed_by_ip: ip,
      signed_by_user_agent: ua,
      status: "signed",
      updated_at: now,
    })
    .eq("id", est.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, signed_at: now });
}
