import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
// Vision over 1-4 elevation photos takes ~10-25s on Railway; allow headroom.
export const maxDuration = 60;

/**
 * POST /api/retail-measurements/estimate-siding — Next.js proxy.
 *
 * Forwards elevation photos + roof measurements to the Railway backend's SHARED
 * wall-area estimator (retail_router.py → wall_area_estimator.py — the same
 * function the claim siding path uses). Auth is enforced here so unauthenticated
 * requests can't burn Claude/Vision tokens.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  const incoming = await req.formData();
  const outbound = new FormData();

  // Forward every elevation photo + the measurements JSON string verbatim.
  let photoCount = 0;
  for (const p of incoming.getAll("photos")) {
    if (p instanceof Blob) {
      outbound.append("photos", p, (p as File).name || `elevation-${photoCount}.jpg`);
      photoCount++;
    }
  }
  const measurements = incoming.get("measurements");
  outbound.append("measurements", typeof measurements === "string" ? measurements : "{}");

  const backendUrl =
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "https://dumbroof-backend-production.up.railway.app";
  const target = `${backendUrl.replace(/\/$/, "")}/api/retail-measurements/estimate-siding`;

  let upstream: Response;
  try {
    upstream = await fetch(target, { method: "POST", body: outbound });
  } catch (err) {
    return NextResponse.json(
      { error: `Upstream estimator unreachable: ${String(err)}` },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  try {
    return NextResponse.json(JSON.parse(text), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { error: "Upstream returned non-JSON", upstream_status: upstream.status, body_preview: text.slice(0, 300) },
      { status: 502 },
    );
  }
}
