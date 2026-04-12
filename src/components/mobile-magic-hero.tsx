"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { InAppName } from "@/lib/device-detection";
import { trackBoth, FunnelEvent } from "@/lib/track";

type Props = {
  inAppName: InAppName;
  stats: {
    claimsProcessed: string;
    approvedSupplements: string;
  };
};

const SOURCE_LABEL: Record<NonNullable<InAppName>, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  twitter: "X",
};

/**
 * Mobile hero — instant email+password signup.
 *
 * Same 2-step flow as the desktop hero (hero-signup-form.tsx):
 * Step 1: Enter email
 * Step 2: Create password → account created, session started, redirect
 *
 * No magic links. No OTP codes. No email to check. No leaving the page.
 * Works in every browser including Facebook/Instagram WebView.
 *
 * Email confirmation is OFF in Supabase — signUp returns a session
 * immediately. User lands on /dashboard/new-claim ready to upload.
 */
export function MobileMagicHero({ inAppName, stats }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"email" | "password">("email");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const supabase = createClient();

  const sourceLabel = inAppName ? SOURCE_LABEL[inAppName] : null;

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes("@")) {
      setError("Enter a valid email");
      return;
    }
    setError("");
    trackBoth(FunnelEvent.HERO_CTA_CLICKED, { email_provided: true, device: "mobile" });
    trackBoth(FunnelEvent.SIGNUP_EMAIL_STEP_COMPLETED);
    setStep("password");
    trackBoth(FunnelEvent.SIGNUP_PASSWORD_STEP_STARTED);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    trackBoth(FunnelEvent.SIGNUP_PASSWORD_SUBMITTED);
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    setError("");

    const { data, error: signupError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
        data: {
          signup_source: inAppName ? `mobile_${inAppName}` : "mobile_direct",
        },
      },
    });

    if (signupError) {
      trackBoth(FunnelEvent.SIGNUP_FAILED, { error_message: signupError.message, device: "mobile" });
      if (signupError.message.toLowerCase().includes("already registered")) {
        setError("Account exists — signing you in...");
        // Try sign in with same credentials
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          setError("Account exists. Try signing in.");
          setLoading(false);
          return;
        }
        window.location.href = "/dashboard";
        return;
      }
      setError(signupError.message);
      setLoading(false);
      return;
    }

    if (data.user && data.user.identities && data.user.identities.length === 0) {
      trackBoth(FunnelEvent.SIGNUP_FAILED, { error_message: "account_exists", device: "mobile" });
      setError("Account exists — try signing in");
      setLoading(false);
      return;
    }

    // Fire conversion pixels
    if (typeof window !== "undefined") {
      window.fbq?.("track", "CompleteRegistration");
      window.fbq?.("track", "Lead");
      window.ttq?.track("CompleteRegistration", {
        contents: [{ content_id: "mobile_signup", content_type: "product", content_name: "dumbroof.ai Account" }],
      });
    }
    trackBoth(FunnelEvent.SIGNUP_SUCCEEDED, {
      auth_method: "email_password",
      device: "mobile",
      in_app: inAppName || "none",
      auto_confirmed: !!data.session,
    });

    // Notify team + welcome email (fire and forget)
    fetch("/api/notify-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, source: `mobile_${inAppName || "direct"}` }),
    }).catch(() => {});
    fetch("/api/welcome-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => {});

    if (data.session) {
      window.location.href = "/dashboard/new-claim";
    } else {
      // Fallback: email confirmation required (shouldn't happen — confirm is OFF)
      window.location.href = "/login?message=Check+your+email+to+confirm";
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    trackBoth(FunnelEvent.OAUTH_STARTED, { provider: "google", device: "mobile" });
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  return (
    <div className="min-h-[80vh] flex flex-col justify-center px-6 py-12 bg-gradient-to-b from-[var(--navy)] via-[var(--navy-light)] to-[var(--navy)]">
      <div className="max-w-md mx-auto w-full">
        <div className="text-center mb-3">
          <span className="inline-block px-3 py-1 rounded-full bg-white/[0.06] border border-white/[0.1] text-xs text-[var(--gray-dim)] font-medium">
            {sourceLabel ? `Saw us on ${sourceLabel}? \u2193` : "Start right here on your phone \u2193"}
          </span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold text-white text-center leading-tight mb-3">
          AI builds your storm claim package in 5 minutes.
        </h1>

        <p className="text-base text-[var(--gray-dim)] text-center mb-8">
          Built for roofing sales reps, contractors, and company owners.
        </p>

        <div className="bg-white/[0.04] border border-white/[0.1] rounded-2xl p-6 mb-6">
          {step === "email" ? (
            <>
              <p className="text-sm font-semibold text-white mb-1">
                Start your first claim — photos only
              </p>
              <p className="text-xs text-[var(--gray-muted)] mb-4">
                Create an account in 10 seconds. Upload photos, get your forensic report. No app needed.
              </p>

              {/* Google OAuth */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-gray-800 py-4 rounded-xl font-semibold text-base transition-colors shadow-lg mb-3"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>

              <div className="relative mb-3">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/20"></div></div>
                <div className="relative flex justify-center text-xs"><span className="bg-[rgb(15,18,35)] px-3 text-white/40">or</span></div>
              </div>

              <form onSubmit={handleEmailSubmit} className="space-y-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@yourcompany.com"
                  className="w-full px-4 py-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 text-base focus:outline-none focus:border-white/50 focus:bg-white/[0.15] transition-colors"
                  autoComplete="email"
                  inputMode="email"
                  required
                />
                <button
                  type="submit"
                  className="w-full bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-6 py-4 rounded-xl font-semibold text-base transition-all shadow-lg"
                >
                  Try Free &rarr;
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-white mb-1">
                Create a password
              </p>
              <p className="text-xs text-[var(--gray-muted)] mb-4">
                Signing up as <strong className="text-white">{email}</strong>
              </p>

              <form onSubmit={handleSignup} className="space-y-3">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a password (6+ chars)"
                  className="w-full px-4 py-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 text-base focus:outline-none focus:border-white/50 focus:bg-white/[0.15] transition-colors"
                  autoComplete="new-password"
                  autoFocus
                  required
                  minLength={6}
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-6 py-4 rounded-xl font-semibold text-base transition-all shadow-lg disabled:opacity-50"
                >
                  {loading ? "Creating account..." : "Start Uploading &rarr;"}
                </button>
              </form>

              <button
                type="button"
                onClick={() => { setStep("email"); setPassword(""); setError(""); }}
                className="block mx-auto mt-3 text-xs text-[var(--cyan)] hover:text-white transition-colors"
              >
                &larr; Change email
              </button>
            </>
          )}

          {error && (
            <p className="text-red-400 text-sm mt-3 text-center">
              {error}
              {error.includes("exists") && !error.includes("signing") && (
                <> <a href="/login" className="underline text-[var(--cyan)]">Sign in instead</a></>
              )}
            </p>
          )}

          <p className="text-[11px] text-[var(--gray-muted)] mt-4 text-center">
            No credit card. 3 free claims.
          </p>
        </div>

        {/* Trust signals */}
        <div className="grid grid-cols-3 gap-2 mb-6">
          <div className="text-center bg-white/[0.03] border border-white/[0.08] rounded-xl py-3 px-2">
            <div className="text-base font-bold text-white">{stats.claimsProcessed}</div>
            <div className="text-[10px] text-[var(--gray-muted)] uppercase tracking-wider">Claims</div>
          </div>
          <div className="text-center bg-white/[0.03] border border-white/[0.08] rounded-xl py-3 px-2">
            <div className="text-base font-bold text-white">{stats.approvedSupplements}</div>
            <div className="text-[10px] text-[var(--gray-muted)] uppercase tracking-wider">Recovered</div>
          </div>
          <div className="text-center bg-white/[0.03] border border-white/[0.08] rounded-xl py-3 px-2">
            <div className="text-base font-bold text-white">98%</div>
            <div className="text-[10px] text-[var(--gray-muted)] uppercase tracking-wider">Accurate</div>
          </div>
        </div>

        {/* The 3 tiers */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 mb-6">
          <p className="text-[11px] font-semibold text-[var(--gray-muted)] uppercase tracking-wider text-center mb-3">
            The claim grows with you
          </p>
          <div className="space-y-2.5">
            <div className="flex items-start gap-2.5">
              <div className="shrink-0 w-5 h-5 rounded-full bg-gradient-to-br from-[var(--pink)] to-[var(--purple)] flex items-center justify-center text-[10px] font-bold text-white">1</div>
              <div className="flex-1 text-xs">
                <span className="text-white font-semibold">Photos</span>
                <span className="text-[var(--gray-muted)]"> &rarr; Forensic Causation Report</span>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <div className="shrink-0 w-5 h-5 rounded-full bg-gradient-to-br from-[var(--purple)] to-[var(--blue)] flex items-center justify-center text-[10px] font-bold text-white">2</div>
              <div className="flex-1 text-xs">
                <span className="text-white font-semibold">+ Measurements</span>
                <span className="text-[var(--gray-muted)]"> &rarr; Xactimate estimate + code compliance</span>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <div className="shrink-0 w-5 h-5 rounded-full bg-[var(--blue)] flex items-center justify-center text-[10px] font-bold text-white">3</div>
              <div className="flex-1 text-xs">
                <span className="text-white font-semibold">+ Carrier scope</span>
                <span className="text-[var(--gray-muted)]"> &rarr; scope comparison + supplement package</span>
              </div>
            </div>
          </div>
        </div>

        <a
          href="/sample/dashboard"
          className="block text-center text-sm font-semibold text-[var(--cyan)] hover:text-white transition-colors mb-4"
        >
          See a live demo (no signup) &rarr;
        </a>

        <p className="text-center text-[11px] text-[var(--gray-muted)]">
          Already have an account?{" "}
          <a href="/login" className="text-[var(--cyan)]">Sign in</a>
        </p>
      </div>
    </div>
  );
}
