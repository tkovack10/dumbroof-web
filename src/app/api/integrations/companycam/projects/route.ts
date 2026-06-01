import { NextRequest } from "next/server";
import { proxyIntegrationGET } from "@/lib/integration-proxy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/integrations/companycam/projects?query=&page=
// Same-origin proxy → Railway, JWT attached server-side. See integration-proxy.ts.
export async function GET(req: NextRequest) {
  return proxyIntegrationGET(req, "/api/integrations/companycam/projects");
}
