"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function HeroSignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"email" | "password" | "done">("email");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const supabase = createClient();

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) {
      setError("Enter a valid email");
      return;
    }
    setError("");
    setStep("password");
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    setError("");

    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (signupError) {
      setError(signupError.message);
      setLoading(false);
      return;
    }

    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setError("Account exists — try signing in");
      setLoading(false);
      return;
    }

    // Fire conversion pixels
    window.fbq?.("track", "CompleteRegistration");
    window.fbq?.("track", "StartTrial");
    window.ttq?.track("CompleteRegistration", {
      contents: [{ content_id: "signup", content_type: "product", content_name: "dumbroof.ai Account" }],
    });

    // Notify team
    fetch("/api/notify-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => {});

    if (data.session) {
      // Auto-confirmed — go straight to upload
      window.location.href = "/dashboard/new-claim";
    } else {
      // Email confirmation needed
      setStep("done");
      setLoading(false);
    }
  };

  if (step === "done") {
    return (
      <div className="max-w-md mx-auto">
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-6 py-4 text-center">
          <p className="text-green-400 font-semibold mb-1">Check your email</p>
          <p className="text-sm text-[var(--gray-muted)]">
            We sent a confirmation link to <strong className="text-white">{email}</strong>. Click it and you&apos;re in.
          </p>
        </div>
      </div>
    );
  }

  const handleGoogleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  return (
    <div className="max-w-md mx-auto">
      {step === "email" ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-gray-800 py-4 rounded-xl font-semibold text-base transition-colors shadow-lg"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/20"></div></div>
            <div className="relative flex justify-center text-xs"><span className="bg-[var(--navy)] px-3 text-white/40">or</span></div>
          </div>
          <form onSubmit={handleEmailSubmit} className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your work email"
              className="flex-1 px-5 py-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 text-base focus:outline-none focus:border-white/50 focus:bg-white/[0.15] transition-colors"
              autoComplete="email"
              required
            />
            <button
              type="submit"
              className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-6 py-4 rounded-xl font-semibold transition-all shadow-lg shadow-red-900/30 whitespace-nowrap"
            >
              Get Started Free
            </button>
          </form>
        </div>
      ) : (
        <form onSubmit={handleSignup} className="flex gap-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Create a password (6+ chars)"
            className="flex-1 px-5 py-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 text-base focus:outline-none focus:border-white/50 focus:bg-white/[0.15] transition-colors"
            autoComplete="new-password"
            autoFocus
            required
            minLength={6}
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-6 py-4 rounded-xl font-semibold transition-all shadow-lg shadow-red-900/30 whitespace-nowrap disabled:opacity-50"
          >
            {loading ? "Creating..." : "Go →"}
          </button>
        </form>
      )}
      {error && (
        <p className="text-red-400 text-sm mt-2 text-center">
          {error}
          {error.includes("exists") && (
            <> <a href="/login" className="underline text-[var(--cyan)]">Sign in instead</a></>
          )}
        </p>
      )}
      <p className="text-xs text-[var(--gray-muted)] mt-3 text-center">
        {step === "email" ? (
          <>No credit card. No onboarding. Upload photos and go. <a href="/login" className="text-[var(--cyan)] hover:text-white">Already have an account?</a></>
        ) : (
          `Signing up as ${email}`
        )}
      </p>
    </div>
  );
}
