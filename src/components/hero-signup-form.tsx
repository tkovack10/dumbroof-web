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
