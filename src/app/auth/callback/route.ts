import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendCapiEvent, CapiEventName, extractMetaTracking } from "@/lib/meta-conversions-api";

/**
 * Notify team + send welcome email via the unified /api/notify-signup endpoint.
 * That endpoint handles both team notification AND welcome email with PDF attachment
 * server-side, so neither can be killed by browser navigation or function termination.
 */
async function notifyNewSignup(email: string) {
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL || "https://www.dumbroof.ai";
    await fetch(`${origin}/api/notify-signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, source: "google_oauth" }),
    });
  } catch {
    // Non-fatal
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const type = searchParams.get("type");
  // `next` param honored for magic-link / save-spot deep links
  // (e.g. /auth/callback?next=/dashboard/new-claim from mobile-magic-hero)
  const next = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Recovery / invite — redirect to password reset page
      if (type === "recovery" || type === "invite") {
        return NextResponse.redirect(`${origin}/dashboard/settings?reset=true`);
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Check if new user (no claims) — send to new-claim + notify team
        const { count } = await supabase
          .from("claims")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id);

        if (count === 0) {
          // New user — notify team + send welcome email (both handled by notifyNewSignup)
          notifyNewSignup(user.email || "unknown");

          // Fire Meta CAPI Lead event server-side. iOS 14+ blocks the
          // browser pixel for ~25-40% of users. Without this, Meta's
          // algorithm can't optimize against actual signup conversions.
          // Fire-and-forget; never blocks the redirect.
          const tracking = extractMetaTracking(request);
          sendCapiEvent({
            eventName: CapiEventName.Lead,
            email: user.email || undefined,
            eventSourceUrl: `${origin}/`,
            clientIpAddress: request.headers.get("x-forwarded-for") || undefined,
            clientUserAgent: request.headers.get("user-agent") || undefined,
            fbc: tracking.fbc,
            fbp: tracking.fbp,
            customData: {
              content_name: "auth_callback_signup",
              content_category: type || "oauth_or_email_confirm",
            },
          }).catch(() => {});

          // Honor `next` if present, otherwise default to new-claim form
          return NextResponse.redirect(`${origin}${next || "/dashboard/new-claim"}`);
        }
      }
      // Existing user — honor `next` if present, otherwise dashboard
      return NextResponse.redirect(`${origin}${next || "/dashboard"}`);
    }

    console.error("Auth callback error:", error.message);
  }

  // No code or exchange failed — likely expired/used magic link
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("This sign-in link has expired or was already used. Enter your email below to get a new one.")}`
  );
}
