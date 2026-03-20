"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const urlError = searchParams.get("error");
    if (urlError) {
      setError(urlError);
    }
    const mode = searchParams.get("mode");
    if (mode === "signup") {
      setIsSignUp(true);
    }
  }, [searchParams]);

  const supabase = createClient();

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
    });

    if (error) {
      setError(error.message);
    } else {
      setMessage("Check your email for a password reset link.");
    }
    setLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isForgotPassword) {
      return handleForgotPassword(e);
    }
    setLoading(true);
    setError("");
    setMessage("");

    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) {
        setError(error.message);
      } else if (data.user && data.user.identities && data.user.identities.length === 0) {
        // Supabase returns a fake user with no identities when email already exists
        // This happens when admin already invited this user
        setError("An account with this email already exists. Try signing in instead, or use the link from your invite email.");
      } else if (data.session) {
        // Auto-confirmed (email confirmation disabled) — go straight to dashboard
        window.fbq?.("track", "CompleteRegistration");
        window.location.href = "/dashboard/new-claim";
      } else {
        window.fbq?.("track", "CompleteRegistration");
        setMessage("Account created! Check your email for a confirmation link, then come back and sign in.");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        if (error.message === "Invalid login credentials") {
          setError("Invalid email or password. If you signed up via an invite link, you may need to set your password first — check your invite email or click 'Forgot password' below.");
        } else {
          setError(error.message);
        }
      } else {
        window.location.href = "/dashboard";
      }
    }

    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-[var(--navy)] flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <a href="/" className="inline-flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-[var(--red)] flex items-center justify-center font-bold text-white text-xl">
              DR
            </div>
            <span className="text-white font-bold text-2xl tracking-tight">
              dumb roof<sup className="text-[10px] font-medium align-super ml-0.5">™</sup>
            </span>
          </a>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl p-8 shadow-xl">
          <h2 className="text-xl font-bold text-[var(--navy)] mb-1">
            {isForgotPassword
              ? "Reset your password"
              : isSignUp
                ? "Create your account"
                : "Welcome back"}
          </h2>
          <p className="text-[var(--gray-muted)] text-sm mb-6">
            {isForgotPassword
              ? "Enter your email and we'll send a reset link."
              : isSignUp
                ? "3 free claims. No credit card."
                : "Sign in to your dashboard."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--gray)] mb-1">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
                placeholder="you@company.com"
              />
            </div>

            {!isForgotPassword && (
              <div>
                <label className="block text-sm font-medium text-[var(--gray)] mb-1">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
                  placeholder="••••••••"
                  minLength={6}
                />
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            {message && (
              <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[var(--red)] hover:bg-[var(--red-dark)] disabled:opacity-50 text-white py-3 rounded-lg font-semibold transition-colors text-sm"
            >
              {loading
                ? "..."
                : isForgotPassword
                  ? "Send Reset Link"
                  : isSignUp
                    ? "Create Account"
                    : "Sign In"}
            </button>
          </form>

          <div className="mt-6 text-center space-y-2">
            {!isForgotPassword && !isSignUp && (
              <button
                onClick={() => {
                  setIsForgotPassword(true);
                  setError("");
                  setMessage("");
                }}
                className="block w-full text-sm text-[var(--gray-dim)] hover:text-[var(--red)] transition-colors"
              >
                Forgot your password?
              </button>
            )}
            <button
              onClick={() => {
                if (isForgotPassword) {
                  setIsForgotPassword(false);
                } else {
                  setIsSignUp(!isSignUp);
                }
                setError("");
                setMessage("");
              }}
              className="text-sm text-[var(--gray-muted)] hover:text-[var(--navy)] transition-colors"
            >
              {isForgotPassword
                ? "Back to sign in"
                : isSignUp
                  ? "Already have an account? Sign in"
                  : "Need an account? Sign up"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
