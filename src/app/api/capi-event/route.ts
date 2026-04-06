import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { sendCapiEvent, CapiEventName, extractMetaTracking } from "@/lib/meta-conversions-api";

/**
 * POST /api/capi-event
 *
 * Generic server-side Meta Conversions API forwarder. Client components
 * (notably src/app/dashboard/new-claim/page.tsx) POST here whenever they
 * fire a browser-side pixel event. We then mirror that event server-side
 * via CAPI so iOS 14+ can't strip it.
 *
 * Required body: { eventName, eventId? }
 * Optional body: { customData, eventSourceUrl }
 *
 * The user identity (email) comes from the authenticated session — clients
 * never need to send PII. The route extracts it via the Supabase server
 * helper, which means callers must be authenticated. Unauthenticated paths
 * (homepage signups) call sendCapiEvent directly from their server-side
 * route handlers (save-spot, auth/callback, auth/confirm).
 *
 * Pass the SAME `eventId` to both the browser pixel and this endpoint to
 * dedupe — Meta will treat them as a single event.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult.response;

  let body: { eventName?: string; eventId?: string; customData?: Record<string, unknown>; eventSourceUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.eventName) {
    return NextResponse.json({ error: "eventName is required" }, { status: 400 });
  }

  const tracking = extractMetaTracking(req);
  const result = await sendCapiEvent({
    eventName: body.eventName as keyof typeof CapiEventName | string,
    email: authResult.user.email,
    eventId: body.eventId,
    eventSourceUrl: body.eventSourceUrl,
    clientIpAddress: req.headers.get("x-forwarded-for") || undefined,
    clientUserAgent: req.headers.get("user-agent") || undefined,
    fbc: tracking.fbc,
    fbp: tracking.fbp,
    customData: body.customData,
  });

  return NextResponse.json(result);
}
