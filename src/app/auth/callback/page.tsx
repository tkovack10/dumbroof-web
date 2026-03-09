"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const [status, setStatus] = useState("Processing...");
  const supabase = createClient();

  useEffect(() => {
    const handleAuth = async () => {
      // Check for PKCE code flow (query param)
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          window.location.href = `/login?error=${encodeURIComponent(error.message)}`;
          return;
        }
      }

      // Check for hash fragment (implicit flow — used by recovery emails)
      const hash = window.location.hash;
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

          // Password recovery — go to settings to set new password
          if (type === "recovery") {
            window.location.href = "/dashboard/settings?reset=true";
            return;
          }
        }
      }

      // Default: go to dashboard
      window.location.href = "/dashboard";
    };

    handleAuth();
  }, [supabase]);

  return (
    <main className="min-h-screen bg-[var(--navy)] flex items-center justify-center">
      <p className="text-white text-lg">{status}</p>
    </main>
  );
}
