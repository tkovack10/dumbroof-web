import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const type = searchParams.get("type");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      // Code exchange failed — send to login with error context
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(error.message)}`
      );
    }

    // Password recovery flow — send to password reset page
    if (type === "recovery") {
      return NextResponse.redirect(`${origin}/dashboard/settings?reset=true`);
    }
  } else {
    // No code provided — invalid callback
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Invalid or expired link. Please try again.")}`
    );
  }

  return NextResponse.redirect(`${origin}/dashboard`);
}
