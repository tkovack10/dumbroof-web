import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// POST /api/track — persist a client funnel event to public.funnel_events so
// drop-off is answerable in SQL (mirrors what track.ts also sends to GA4/Vercel).
// Fire-and-forget from the browser (sendBeacon/keepalive); ALWAYS returns 204 and
// never throws so it can never block or break the UI. Most funnel events are
// pre-signup, so auth is best-effort, not required.
const MAX_EVENT = 80;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const event = typeof body?.event === "string" ? body.event.trim().slice(0, MAX_EVENT) : "";
    if (!event) return new NextResponse(null, { status: 204 });

    let userId: string | null = null;
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id ?? null;
    } catch {
      /* anonymous visitor — expected for most top-of-funnel events */
    }

    await supabaseAdmin.from("funnel_events").insert({
      event,
      properties:
        body?.properties && typeof body.properties === "object" && !Array.isArray(body.properties)
          ? body.properties
          : null,
      user_id: userId,
      session_id: typeof body?.session_id === "string" ? body.session_id.slice(0, 64) : null,
      path: typeof body?.path === "string" ? body.path.slice(0, 300) : null,
      referer: request.headers.get("referer")?.slice(0, 300) ?? null,
      user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    });
  } catch {
    /* never block the funnel — swallow everything */
  }
  return new NextResponse(null, { status: 204 });
}
