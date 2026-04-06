"use client";

import { useState } from "react";
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
 * Mobile in-app browser hero — replaces the desktop hero entirely
 * for users coming from Instagram/Facebook/TikTok WebViews where:
 *   - File pickers don't work reliably
 *   - OAuth cookie persistence breaks on `window.location.href` nav
 *   - Users are mid-scroll and don't have EagleView/photos on their phone
 *
 * Strategy: collect just the email, send a magic link via /api/save-spot,
 * tell them to open it on their desktop. Roofers click from their inbox
 * the next morning and finish the upload from their office.
 */
export function MobileMagicHero({ inAppName, stats }: Props) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  const sourceLabel = inAppName ? SOURCE_LABEL[inAppName] : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) {
      setError("Enter a valid email");
      return;
    }
    setError("");
    setStatus("loading");

    trackBoth(FunnelEvent.MAGIC_LINK_REQUESTED, {
      device: "mobile",
      in_app: inAppName || "none",
    });

    try {
      const res = await fetch("/api/save-spot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          source: inAppName ? `mobile_${inAppName}` : "mobile_inapp",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");

      // Fire conversion pixels (mobile signups still count as Lead/CompleteRegistration)
      // for Meta and TikTok ad attribution. Globals declared in src/lib/track.ts.
      if (typeof window !== "undefined") {
        window.fbq?.("track", "Lead");
        window.fbq?.("track", "CompleteRegistration");
        window.ttq?.track("CompleteRegistration", {
          contents: [{ content_id: "mobile_magic_link", content_type: "product", content_name: "dumbroof.ai Account" }],
        });
      }
      trackBoth(FunnelEvent.SIGNUP_SUCCEEDED, {
        auth_method: "magic_link",
        device: "mobile",
        in_app: inAppName || "none",
      });

      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
      trackBoth(FunnelEvent.SIGNUP_FAILED, {
        error_message: err instanceof Error ? err.message : "unknown",
        auth_method: "magic_link",
      });
    }
  };

  if (status === "sent") {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center px-6 py-12 bg-gradient-to-b from-[var(--navy)] via-[var(--navy-light)] to-[var(--navy)]">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center">
            <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Check your email</h1>
          <p className="text-base text-[var(--gray-dim)] mb-6">
            We sent a one-click link to <strong className="text-white">{email}</strong>.
          </p>
          <div className="bg-white/[0.05] border border-white/[0.1] rounded-xl px-5 py-4 text-left mb-6">
            <p className="text-sm font-semibold text-white mb-2">Important:</p>
            <p className="text-sm text-[var(--gray-dim)]">
              Open the email from your <strong className="text-white">desktop or laptop</strong>. The upload form needs your EagleView and inspection photos, which probably aren&apos;t on your phone.
            </p>
          </div>
          <p className="text-xs text-[var(--gray-muted)]">
            Don&apos;t see it? Check spam, or reply to the email with your phone number and we&apos;ll text you the link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex flex-col justify-center px-6 py-12 bg-gradient-to-b from-[var(--navy)] via-[var(--navy-light)] to-[var(--navy)]">
      <div className="max-w-md mx-auto w-full">
        <div className="text-center mb-3">
          <span className="inline-block px-3 py-1 rounded-full bg-white/[0.06] border border-white/[0.1] text-xs text-[var(--gray-dim)] font-medium">
            {sourceLabel ? `Saw us on ${sourceLabel}? \u2193` : "On your phone? \u2193"}
          </span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold text-white text-center leading-tight mb-3">
          AI builds your storm claim package in 5 minutes.
        </h1>

        <p className="text-base text-[var(--gray-dim)] text-center mb-8">
          Built for roofing sales reps, contractors, and company owners.
        </p>

        <div className="bg-white/[0.04] border border-white/[0.1] rounded-2xl p-6 mb-6">
          <p className="text-sm font-semibold text-white mb-1">
            Email me a link to finish at my desk
          </p>
          <p className="text-xs text-[var(--gray-muted)] mb-4">
            Upload your inspection photos. We&apos;ll do the rest. Add measurements and carrier scope later &mdash; the claim grows with you.
          </p>

          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourcompany.com"
              className="w-full px-4 py-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 text-base focus:outline-none focus:border-white/50 focus:bg-white/[0.15] transition-colors"
              autoComplete="email"
              inputMode="email"
              required
              disabled={status === "loading"}
            />
            <button
              type="submit"
              disabled={status === "loading"}
              className="w-full bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-6 py-4 rounded-xl font-semibold text-base transition-all shadow-lg disabled:opacity-50"
            >
              {status === "loading" ? "Sending..." : "Send Me The Link →"}
            </button>
          </form>

          {error && (
            <p className="text-red-400 text-sm mt-3 text-center">{error}</p>
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

        {/* Sample report — no signup wall */}
        <a
          href="/sample"
          className="block text-center text-sm text-[var(--cyan)] hover:text-white transition-colors mb-4"
        >
          See a sample report (no signup) →
        </a>

        <p className="text-center text-[11px] text-[var(--gray-muted)]">
          Already have an account?{" "}
          <a href="/login" className="text-[var(--cyan)]">Sign in</a>
        </p>
      </div>
    </div>
  );
}
