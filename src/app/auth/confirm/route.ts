import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { sendCapiEvent, CapiEventName, extractMetaTracking } from "@/lib/meta-conversions-api";

async function notifyNewSignup(email: string) {
  // Send notification email to Tom when a new user signs up
  try {
    const RESEND_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_KEY) return;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "DumbRoof <noreply@dumbroof.ai>",
        to: ["tkovack@usaroofmasters.com", "hello@dumbroof.ai", "arivera@usaroofmasters.com", "tom@dumbroof.ai", "kristen@dumbroof.ai"],
        subject: `🚨 New User Signup: ${email}`,
        html: `<h2>New User Registered on dumbroof.ai</h2>
          <p><strong>${email}</strong> just confirmed their email.</p>
          <p>Time: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} ET</p>
          <p><a href="https://www.dumbroof.ai/dashboard/admin" style="background-color:#2563eb;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">View Admin Dashboard</a></p>`,
      }),
    });
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
        if (user.email) notifyNewSignup(user.email);

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
