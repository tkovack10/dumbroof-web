"use client";

import { useEffect, useRef } from "react";
import { createBrowserClient } from "@supabase/ssr";

export default function AuthCallbackPage() {
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const handleAuth = async () => {
      // 1. Capture hash BEFORE Supabase client can consume it
      const hash = window.location.hash;
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      // 2. Create client with detectSessionInUrl OFF to prevent race condition
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { detectSessionInUrl: false } }
      );

      // 3. Handle implicit flow (hash fragment from recovery/invite emails)
      if (hash) {
        const hashParams = new URLSearchParams(hash.substring(1));
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        const type = hashParams.get("type");

        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error) {
            window.location.href = `/login?error=${encodeURIComponent(error.message)}`;
            return;
          }

          if (type === "recovery") {
            window.location.href = "/dashboard/settings?reset=true";
            return;
          }

          window.location.href = "/dashboard";
          return;
        }
      }

      // 4. Handle PKCE code flow (query param from OAuth/invite)
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          window.location.href = `/login?error=${encodeURIComponent(error.message)}`;
          return;
        }

        const type = params.get("type");
        if (type === "recovery") {
          window.location.href = "/dashboard/settings?reset=true";
          return;
        }

        window.location.href = "/dashboard";
        return;
      }

      // 5. No hash, no code — invalid callback
      window.location.href = `/login?error=${encodeURIComponent("Invalid or expired link. Please try again.")}`;
    };

    handleAuth();
  }, []);

  return (
    <main className="min-h-screen bg-[var(--navy)] flex items-center justify-center">
      <p className="text-white text-lg">Processing...</p>
    </main>
  );
}
