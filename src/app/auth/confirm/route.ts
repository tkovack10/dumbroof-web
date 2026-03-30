import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { type EmailOtpType } from "@supabase/supabase-js";

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
        to: "tkovack@usaroofmasters.com",
        subject: `New User Signup: ${email}`,
        html: `<h2>New User Registered</h2><p><strong>${email}</strong> just confirmed their email on dumbroof.ai.</p><p><a href="https://www.dumbroof.ai/admin">View Admin Dashboard</a></p>`,
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
    if (type === "signup" || type === "email") {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        notifyNewSignup(user.email);
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
