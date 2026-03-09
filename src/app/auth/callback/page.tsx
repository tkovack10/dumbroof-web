"use client";

import { useEffect, useRef, useState } from "react";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export default function AuthCallbackPage() {
  const processed = useRef(false);
  const [mode, setMode] = useState<"loading" | "recovery" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [success, setSuccess] = useState(false);

  // Use vanilla Supabase client — NOT createBrowserClient (singleton that auto-consumes hash)
  const supabaseRef = useRef(
    createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { detectSessionInUrl: false, persistSession: true, autoRefreshToken: true } }
    )
  );

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const hash = window.location.hash;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const supabase = supabaseRef.current;

    const handleAuth = async () => {
      // Implicit flow — hash fragment from recovery/invite emails
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
            setErrorMsg(error.message);
            setMode("error");
            return;
          }

          if (type === "recovery") {
            setMode("recovery");
            return;
          }

          window.location.href = "/dashboard";
          return;
        }
      }

      // PKCE code flow
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setErrorMsg(error.message);
          setMode("error");
          return;
        }

        const type = params.get("type");
        if (type === "recovery") {
          setMode("recovery");
          return;
        }

        window.location.href = "/dashboard";
        return;
      }

      setErrorMsg("Invalid or expired link. Please try again.");
      setMode("error");
    };

    handleAuth();
  }, []);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");

    if (newPassword.length < 6) {
      setPasswordError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    setSaving(true);
    const { error } = await supabaseRef.current.auth.updateUser({ password: newPassword });
    if (error) {
      setPasswordError(error.message);
      setSaving(false);
      return;
    }
    setSuccess(true);
    setSaving(false);
    setTimeout(() => {
      window.location.href = "/dashboard";
    }, 2000);
  };

  if (mode === "loading") {
    return (
      <main className="min-h-screen bg-[var(--navy)] flex items-center justify-center">
        <p className="text-white text-lg">Processing...</p>
      </main>
    );
  }

  if (mode === "error") {
    return (
      <main className="min-h-screen bg-[var(--navy)] flex items-center justify-center px-6">
        <div className="w-full max-w-sm bg-white rounded-2xl p-8 shadow-xl text-center">
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-6">
            {errorMsg}
          </div>
          <a
            href="/login"
            className="text-sm text-gray-500 hover:text-[var(--navy)] transition-colors"
          >
            Back to sign in
          </a>
        </div>
      </main>
    );
  }

  // Recovery mode — show password form right here
  return (
    <main className="min-h-screen bg-[var(--navy)] flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <a href="/" className="inline-flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-[var(--red)] flex items-center justify-center font-bold text-white text-xl">
              DR
            </div>
            <span className="text-white font-bold text-2xl tracking-tight">
              dumb roof<sup className="text-[10px] font-medium align-super ml-0.5">&trade;</sup>
            </span>
          </a>
        </div>

        <div className="bg-white rounded-2xl p-8 shadow-xl">
          <h2 className="text-xl font-bold text-[var(--navy)] mb-1">Set your password</h2>
          <p className="text-gray-500 text-sm mb-6">
            Choose a password to finish setting up your account.
          </p>

          {success ? (
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">
              Password set successfully! Redirecting to dashboard...
            </div>
          ) : (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  minLength={6}
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  minLength={6}
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
                />
              </div>

              {passwordError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                  {passwordError}
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full bg-[var(--red)] hover:bg-[var(--red-dark)] disabled:opacity-50 text-white py-3 rounded-lg font-semibold transition-colors text-sm"
              >
                {saving ? "Setting password..." : "Set Password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
