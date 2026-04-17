import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { sendCapiEvent, CapiEventName, extractMetaTracking } from "@/lib/meta-conversions-api";

/**
 * Notify team + send welcome email via the unified /api/notify-signup endpoint.
 * Handles both team notification AND welcome email with PDF attachment server-side.
 */
async function notifyNewSignup(email: string) {
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL || "https://www.dumbroof.ai";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    await fetch(`${origin}/api/notify-signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, source: "email_confirm" }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    // Non-fatal — don't block auth flow
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") || "/dashboard";

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });

    if (error) {
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(error.message)}`
      );
    }

    // Notify Tom on new signups (type=signup means email confirmation)
    // Also redirect new users (no claims yet) straight to /dashboard/new-claim
    // so they don't land on an empty dashboard and bounce.
    if (type === "signup" || type === "email") {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // MUST await: fire-and-forget gets killed when Vercel terminates the
        // function on redirect. See auth/callback for the 2026-04-06 incident.
        if (user.email) await notifyNewSignup(user.email);

        // Fire Meta CAPI Lead event server-side. Same reasoning as
        // /auth/callback — iOS 14+ blocks browser pixel, server-side is
        // the only reliable feed. Fire-and-forget; never blocks redirect.
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
            content_name: "email_confirm_signup",
            content_category: type,
          },
        }).catch(() => {});

        const { count } = await supabase
          .from("claims")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id);
        if (count === 0) {
          return NextResponse.redirect(`${origin}/dashboard/new-claim`);
        }
      }
    }

    // Password recovery — send to settings to set new password
    if (type === "recovery") {
      return NextResponse.redirect(`${origin}/dashboard/settings?reset=true`);
    }

    return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("This link is invalid or has already been used. If you already confirmed your email, sign in with your password.")}`
  );
}
