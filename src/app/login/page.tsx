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
        window.fbq?.("track", "StartTrial");
        window.ttq?.track("CompleteRegistration", {
          contents: [{ content_id: "signup", content_type: "product", content_name: "dumbroof.ai Account" }],
        });
        // Notify team + send welcome email — both handled server-side by notify-signup
        fetch("/api/notify-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        }).catch(() => {});
        window.location.href = "/dashboard/new-claim";
      } else {
        window.fbq?.("track", "CompleteRegistration");
        window.fbq?.("track", "StartTrial");
        window.ttq?.track("CompleteRegistration", {
          contents: [{ content_id: "signup", content_type: "product", content_name: "dumbroof.ai Account" }],
        });
        // Notify team + send welcome email — both handled server-side by notify-signup
        fetch("/api/notify-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        }).catch(() => {});
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
    <main className="min-h-screen bg-[var(--bg-deep)] flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <a href="/" className="inline-flex items-center gap-3">
            <span className="text-3xl font-extrabold tracking-tight gradient-text">dumbroof<span className="font-normal opacity-70">.ai</span></span>
          </a>
        </div>

        {/* Card */}
        <div className="glass-card p-8">
          <h2 className="text-xl font-bold text-[var(--white)] mb-1">
            {isForgotPassword
              ? "Reset your password"
              : isSignUp
                ? "Get started free"
                : "Welcome back"}
          </h2>
          <p className="text-[var(--gray-muted)] text-sm mb-6">
            {isForgotPassword
              ? "Enter your email and we'll send a reset link."
              : isSignUp
                ? "No credit card. No onboarding. Just upload photos."
                : "Sign in to your dashboard."}
          </p>

          {/* Google Sign In */}
          {!isForgotPassword && (
            <>
              <button
                type="button"
                onClick={async () => {
                  await supabase.auth.signInWithOAuth({
                    provider: "google",
                    options: { redirectTo: `${window.location.origin}/auth/callback` },
                  });
                }}
                className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-gray-800 py-3 rounded-lg font-medium text-sm transition-colors border border-gray-200"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[var(--border-glass)]"></div>
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-[rgb(15,18,35)] px-3 text-[var(--gray-dim)]">or continue with email</span>
                </div>
              </div>
            </>
          )}

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
                className="w-full px-4 py-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-glass)] text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:border-[var(--red)] focus:ring-1 focus:ring-[var(--red)] outline-none transition-colors text-sm"
                placeholder="you@company.com"
                autoFocus
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
                  className="w-full px-4 py-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-glass)] text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:border-[var(--red)] focus:ring-1 focus:ring-[var(--red)] outline-none transition-colors text-sm"
                  placeholder={isSignUp ? "Create a password (6+ characters)" : "••••••••"}
                  minLength={6}
                />
              </div>
            )}

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            {message && (
              <div className="bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-lg px-4 py-3">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 text-white py-3 rounded-lg font-semibold transition-colors text-sm"
            >
              {loading
                ? "..."
                : isForgotPassword
                  ? "Send Reset Link"
                  : isSignUp
                    ? "Get Started Free →"
                    : "Sign In"}
            </button>

            {isSignUp && (
              <p className="text-[var(--gray-dim)] text-xs text-center mt-3">
                By creating an account, you agree to our{" "}
                <a href="/terms" className="text-[var(--gray-muted)] hover:text-white underline transition-colors">
                  Terms of Service
                </a>{" "}
                and{" "}
                <a href="/privacy" className="text-[var(--gray-muted)] hover:text-white underline transition-colors">
                  Privacy Policy
                </a>
                .
              </p>
            )}
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
              className="text-sm text-[var(--gray-muted)] hover:text-[var(--white)] transition-colors"
            >
              {isForgotPassword
                ? "Back to sign in"
                : isSignUp
                  ? "Already have an account? Sign in"
                  : "New here? Get started free"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
