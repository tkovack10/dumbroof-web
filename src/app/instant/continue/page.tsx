import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// Post-auth handoff for the /instant-* funnel.
//
// User flow: /instant-forensic or /instant-supplement → upload → "Unlock" →
// /signup?next=/instant/continue → email confirm or OAuth → land HERE.
//
// We call /api/instant-intake/claim (auth-required) which:
//   - reads dr_instant_token + dr_instant_funnel + dr_instant_dol + dr_instant_damage_type cookies
//   - lists files at anon-instant-intake/{token}/
//   - creates a real claim row owned by the now-authenticated user
//   - moves the staged files into {user_id}/{slug}/{folder}/
//   - clears the cookies
//
// If anything goes wrong we route the user to /dashboard with a non-fatal
// banner rather than block them — they're already authenticated, they should
// land somewhere useful.

export const dynamic = "force-dynamic";

export default async function InstantContinuePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Should never happen — middleware-protected route group would normally
    // bounce, but we redirect explicitly to be safe.
    redirect("/signup?next=" + encodeURIComponent("/instant/continue"));
  }

  // Forward the incoming cookies + a host header so the internal API call
  // sees the same session + funnel cookies the user has in the browser.
  const hdrs = await headers();
  const cookieHeader = hdrs.get("cookie") || "";
  const host = hdrs.get("host") || "www.dumbroof.ai";
  const proto = hdrs.get("x-forwarded-proto") || "https";
  const origin = `${proto}://${host}`;

  let claimId: string | null = null;
  try {
    const res = await fetch(`${origin}/api/instant-intake/claim`, {
      method: "POST",
      headers: { cookie: cookieHeader, "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (res.ok) {
      const body = (await res.json()) as { claim_id?: string; slug?: string };
      // Route by the claim UUID — the claim page resolves by id, not slug, so
      // routing by slug 404s at the moment of first activation. Fall back to
      // slug only if the API somehow omits the id (the slug fallback in
      // /api/team-claims/claim then resolves it).
      claimId = body.claim_id || body.slug || null;
    } else {
      console.error("[instant/continue] claim failed", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("[instant/continue] claim threw", err);
  }

  if (claimId) {
    redirect(`/dashboard/claim/${claimId}?source=instant_funnel`);
  }
  // Fallback: dashboard with a banner. They're authenticated; a missing or
  // expired anon token shouldn't strand them.
  redirect("/dashboard?source=instant_funnel&recover=1");
}
