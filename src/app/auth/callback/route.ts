import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendCapiEvent, CapiEventName, extractMetaTracking } from "@/lib/meta-conversions-api";

async function sendWelcomeEmail(email: string) {
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL || "https://www.dumbroof.ai";
    await fetch(`${origin}/api/welcome-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch {
    // Non-fatal
  }
}

async function notifyNewSignup(email: string) {
  try {
    const RESEND_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_KEY) return;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "DumbRoof <noreply@dumbroof.ai>",
        to: ["tkovack@usaroofmasters.com", "hello@dumbroof.ai", "arivera@usaroofmasters.com", "tom@dumbroof.ai", "kristen@dumbroof.ai"],
        subject: `New User Signup: ${email}`,
        html: `<h2>New User Registered</h2><p><strong>${email}</strong> just signed up on dumbroof.ai (via Google).</p><p><a href="https://www.dumbroof.ai/admin">View Admin Dashboard</a></p>`,
      }),
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
          // New user — notify team + send welcome email (fire and forget)
          notifyNewSignup(user.email || "unknown");
          sendWelcomeEmail(user.email || "");

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

  // No code or exchange failed — redirect to login
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Sign in failed. Please try again.")}`
  );
}
