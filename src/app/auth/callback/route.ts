import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
          // New user — notify team (fire and forget)
          notifyNewSignup(user.email || "unknown");
          return NextResponse.redirect(`${origin}/dashboard/new-claim`);
        }
      }
      return NextResponse.redirect(`${origin}/dashboard`);
    }

    console.error("Auth callback error:", error.message);
  }

  // No code or exchange failed — redirect to login
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Sign in failed. Please try again.")}`
  );
}
