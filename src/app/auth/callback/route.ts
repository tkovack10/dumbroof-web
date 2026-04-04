import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const type = searchParams.get("type");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Recovery / invite — redirect to password reset page
      if (type === "recovery" || type === "invite") {
        return NextResponse.redirect(`${origin}/dashboard/settings?reset=true`);
      }
      // Normal sign-in (Google OAuth, email confirm) — go to dashboard
      return NextResponse.redirect(`${origin}/dashboard`);
    }

    console.error("Auth callback error:", error.message);
  }

  // No code or exchange failed — redirect to login
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Sign in failed. Please try again.")}`
  );
}
