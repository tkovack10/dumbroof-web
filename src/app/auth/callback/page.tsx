"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const handled = useRef(false);
  const supabase = createClient();

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    // Listen for auth state changes — Supabase auto-processes hash fragments
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "PASSWORD_RECOVERY") {
          // Recovery flow — send to settings to set password
          window.location.href = "/dashboard/settings?reset=true";
        } else if (event === "SIGNED_IN" && session) {
          window.location.href = "/dashboard";
        }
      }
    );

    // Also handle PKCE code flow (query param from OAuth/invite)
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          window.location.href = `/login?error=${encodeURIComponent(error.message)}`;
        }
        // onAuthStateChange will handle the redirect on success
      });
    }

    // Fallback: if nothing fires within 5 seconds, redirect to dashboard
    const timeout = setTimeout(() => {
      window.location.href = "/dashboard";
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [supabase]);

  return (
    <main className="min-h-screen bg-[var(--navy)] flex items-center justify-center">
      <p className="text-white text-lg">Processing...</p>
    </main>
  );
}
