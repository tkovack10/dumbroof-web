"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { firePixelSignup } from "@/lib/meta-pixel-signup";

interface InviteContext {
  token: string;
  companyName: string;
  inviterName: string;
  inviteEmail: string;
  role: string;
}

interface ReferralContext {
  code: string;
  referrerName: string;
  companyName: string;
}

export function SignupClient({
  inviteContext,
  referralContext,
  prefillEmail,
  nextPath,
}: {
  inviteContext: InviteContext | null;
  referralContext: ReferralContext | null;
  prefillEmail: string;
  nextPath: string;
}) {
  const supabase = createClient();
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [domainMatch, setDomainMatch] = useState<{
    companyName: string | null;
    memberCount: number;
    ownerEmail: string | null;
  } | null>(null);

  useEffect(() => {
    if (prefillEmail && !email) setEmail(prefillEmail);
  }, [prefillEmail, email]);

  // Check if the typed email's domain matches an existing company. Debounced
  // 600ms after last keystroke. Only runs when there's no invite context
  // (invite flow already knows the company). Results power a non-blocking
  // notice that suggests asking the team owner for an invite.
  useEffect(() => {
    if (inviteContext) return;
    if (!email || !email.includes("@") || email.split("@")[1].length < 3) {
      setDomainMatch(null);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await fetch("/api/signup/check-domain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (!res.ok) return;
        const data = await res.json();
        setDomainMatch(data.matched || null);
      } catch {
        // non-fatal — just don't show the notice
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [email, inviteContext]);

  const trackSignupPixels = (signupEmail: string): { eventId: string } => {
    // CompleteRegistration uses firePixelSignup so it carries advanced
    // matching (em) AND a dedup eventID matched server-side via CAPI in
    // /api/notify-signup. StartTrial / TikTok stay as plain pixel fires —
    // we don't run CAPI for those, so no dedup needed.
    const { eventId } = firePixelSignup({ email: signupEmail, source: "signup_page" });
    try {
      window.fbq?.("track", "StartTrial");
      window.ttq?.track("CompleteRegistration", {
        contents: [{ content_id: "signup", content_type: "product", content_name: "dumbroof.ai Account" }],
      });
    } catch { /* ignore */ }
    return { eventId };
  };

  const handleGoogleSignup = async () => {
    const callbackUrl = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl },
    });
  };

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setError(
        "An account with this email already exists. Sign in on the login page — if you came from an invite, sign in and we'll link you automatically."
      );
      setLoading(false);
      return;
    }

    const { eventId } = trackSignupPixels(email);

    // Best-effort: notify team + welcome email. /auth/callback also runs this
    // on OAuth/confirm, but for the email-confirm path the user might take a
    // while to click the link — fire once now so the team sees it immediately.
    // `eventId` matches the browser pixel's CompleteRegistration so Meta
    // dedupes the two fires into one canonical conversion.
    fetch("/api/notify-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        eventId,
        source: inviteContext ? "invite" : referralContext ? "referral" : "signup_page",
      }),
    }).catch(() => {});

    if (data.session) {
      // Auto-confirmed — go straight to next path. /auth/callback isn't hit
      // on this path, so fire acceptance inline.
      if (inviteContext) {
        try {
          await fetch("/api/team/accept", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: inviteContext.token }),
          });
        } catch { /* non-fatal */ }
      }
      if (referralContext) {
        try {
          await fetch("/api/referrals/link", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: referralContext.code }),
          });
        } catch { /* non-fatal */ }
      }
      window.location.href = nextPath;
    } else {
      setMessage(
        `Check ${email} for a confirmation link. Click it and you'll land back here — ${
          inviteContext ? `joining ${inviteContext.companyName}` : "ready to go"
        }.`
      );
    }
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-[var(--bg-deep)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-6">
          <Link href="/" className="inline-flex items-center gap-3">
            <span className="text-3xl font-extrabold tracking-tight gradient-text">
              dumbroof<span className="font-normal opacity-70">.ai</span>
            </span>
          </Link>
        </div>

        {/* Context banner — invite or referral */}
        {inviteContext && (
          <div className="mb-4 p-4 rounded-xl border border-purple-500/30 bg-gradient-to-r from-purple-500/10 to-pink-500/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-purple-300 mb-1">
              You&apos;ve been invited
            </p>
            <p className="text-sm text-[var(--white)]">
              <strong>{inviteContext.inviterName}</strong> invited you to join{" "}
              <strong>{inviteContext.companyName}</strong> as a <strong>{inviteContext.role}</strong>.
              Create your account and we&apos;ll link you up automatically.
            </p>
          </div>
        )}
        {!inviteContext && referralContext && (
          <div className="mb-4 p-4 rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 to-blue-500/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300 mb-1">
              You&apos;ve been referred
            </p>
            <p className="text-sm text-[var(--white)]">
              <strong>{referralContext.referrerName}</strong> at{" "}
              <strong>{referralContext.companyName}</strong> sent you. They already use dumbroof.ai
              to run their claims.
            </p>
          </div>
        )}

        {/* Card */}
        <div className="glass-card p-7">
          <h1 className="text-2xl font-bold text-[var(--white)] mb-1">
            {inviteContext ? `Join ${inviteContext.companyName}` : "Get 3 free claims"}
          </h1>
          <p className="text-[var(--gray-muted)] text-sm mb-5">
            {inviteContext
              ? "Create your password below. Takes 10 seconds."
              : "No credit card. No onboarding calls. Upload photos, get a supplement."}
          </p>

          {/* Value props (only on generic signup — invite mode is cleaner without) */}
          {!inviteContext && (
            <ul className="space-y-2 mb-5 text-sm text-[var(--gray)]">
              <li className="flex items-start gap-2">
                <svg className="w-4 h-4 mt-0.5 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>3 free claims — no card required to start</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-4 h-4 mt-0.5 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>Forensic report + estimate + supplement in ~2 minutes</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-4 h-4 mt-0.5 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>Works with your photos, EagleView, and insurance scope</span>
              </li>
            </ul>
          )}

          {/* Google OAuth */}
          <button
            type="button"
            onClick={handleGoogleSignup}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-gray-800 py-3 rounded-lg font-medium text-sm transition-colors border border-gray-200 mb-3"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </button>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[var(--border-glass)]" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[rgb(15,18,35)] px-3 text-[var(--gray-dim)]">or use email</span>
            </div>
          </div>

          <form onSubmit={handleEmailSignup} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-[var(--gray)] mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={!!inviteContext}
                className={`w-full px-4 py-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-glass)] text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:border-[var(--red)] focus:ring-1 focus:ring-[var(--red)] outline-none transition-colors text-sm ${
                  inviteContext ? "opacity-70" : ""
                }`}
                placeholder="you@company.com"
                autoFocus={!inviteContext}
              />
              {inviteContext && (
                <p className="text-xs text-[var(--gray-dim)] mt-1">
                  Invite sent to this email — can&apos;t change it here.
                </p>
              )}
              {!inviteContext && domainMatch && (
                <div className="mt-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs">
                  <p className="text-amber-200 font-semibold mb-1">
                    {domainMatch.memberCount} {domainMatch.memberCount === 1 ? "person" : "people"} from{" "}
                    {domainMatch.companyName || "your company"} already use{domainMatch.memberCount === 1 ? "s" : ""} dumbroof.ai
                  </p>
                  <p className="text-amber-100/80">
                    To share their plan and team workspace, ask{" "}
                    {domainMatch.ownerEmail ? (
                      <a
                        href={`mailto:${domainMatch.ownerEmail}?subject=${encodeURIComponent(
                          "Please invite me to our DumbRoof team"
                        )}&body=${encodeURIComponent(
                          `Hey — I'm setting up my DumbRoof account at ${email}. Could you send me a team invite from your dashboard so we share the same plan?`
                        )}`}
                        className="underline hover:text-amber-50"
                      >
                        {domainMatch.ownerEmail}
                      </a>
                    ) : (
                      "your team admin"
                    )}{" "}
                    to send you an invite from their dashboard. Or continue below to create a separate account.
                  </p>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--gray)] mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-glass)] text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:border-[var(--red)] focus:ring-1 focus:ring-[var(--red)] outline-none transition-colors text-sm"
                placeholder="Create a password (6+ characters)"
                minLength={6}
                autoFocus={!!inviteContext}
              />
            </div>

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
              {loading ? "..." : inviteContext ? `Join ${inviteContext.companyName} →` : "Start free →"}
            </button>

            <p className="text-[var(--gray-dim)] text-xs text-center">
              By creating an account, you agree to our{" "}
              <Link href="/terms" className="text-[var(--gray-muted)] hover:text-white underline">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="text-[var(--gray-muted)] hover:text-white underline">
                Privacy
              </Link>
              .
            </p>
          </form>

          <div className="mt-5 text-center">
            <Link
              href="/login"
              className="text-sm text-[var(--gray-muted)] hover:text-[var(--white)] transition-colors"
            >
              Already have an account? Sign in
            </Link>
          </div>
        </div>

        {/* Social proof footer */}
        <p className="text-xs text-[var(--gray-dim)] text-center mt-5">
          Built by USA Roof Masters. Trusted by roofing companies across NY, NJ, PA and the Midwest.
        </p>
      </div>
    </main>
  );
}
