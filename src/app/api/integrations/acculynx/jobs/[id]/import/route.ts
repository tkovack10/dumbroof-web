import { NextRequest } from "next/server";
import { proxyIntegrationPOST } from "@/lib/integration-proxy";

export const dynamic = "force-dynamic";
// Import pulls job data + photos from AccuLynx synchronously on the backend.
export const maxDuration = 300;

// POST /api/integrations/acculynx/jobs/[id]/import
// Same-origin proxy → Railway, JWT attached server-side. See integration-proxy.ts.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyIntegrationPOST(
    req,
    `/api/integrations/acculynx/jobs/${encodeURIComponent(id)}/import`
  );
}
