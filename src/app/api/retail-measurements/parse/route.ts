import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
// Allow up to 60s for the Railway parse round-trip (Claude PDF inference
// takes ~10-20s on a normal EagleView; rare bigger reports can push 40s).
export const maxDuration = 60;

/**
 * POST /api/retail-measurements/parse — Next.js proxy.
 *
 * Forwards the user's PDF upload to the Railway backend's retail-specific
 * parser endpoint. Deliberately does NOT call any claims-flow code path:
 * the Railway side runs retail_router.py → retail_measurements.py only.
 * Auth is enforced here so unauthenticated requests can't burn Claude tokens.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  const incoming = await req.formData();
  const file = incoming.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const outbound = new FormData();
  outbound.append("file", file, (file as File).name || "upload.pdf");

  const backendUrl =
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "https://dumbroof-backend-production.up.railway.app";

  const target = `${backendUrl.replace(/\/$/, "")}/api/retail-measurements/parse`;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: "POST",
      body: outbound,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Upstream parser unreachable: ${String(err)}` },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  try {
    const data = JSON.parse(text);
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { error: "Upstream returned non-JSON", upstream_status: upstream.status, body_preview: text.slice(0, 300) },
      { status: 502 },
    );
  }
}
