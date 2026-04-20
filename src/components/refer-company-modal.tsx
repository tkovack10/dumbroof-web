"use client";

import { useEffect, useState } from "react";

export function ReferCompanyModal({
  open,
  onClose,
  referralCode,
}: {
  open: boolean;
  onClose: () => void;
  referralCode: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSent(false);
      setError(null);
      setCopied(false);
    }
  }, [open]);

  if (!open) return null;

  const link = referralCode
    ? `https://dumbroof.ai/r/${referralCode}`
    : "Loading...";

  const copy = async () => {
    if (!referralCode) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API blocked — fall through silently
    }
  };

  const handleSendEmail = async () => {
    setError(null);
    if (!email.trim() || !email.includes("@")) {
      setError("Enter a valid email address");
      return;
    }
    if (!referralCode) {
      setError("Referral code not ready yet — try again in a moment");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/referrals/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to_email: email.trim(),
          personal_note: message.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send");
        setSending(false);
        return;
      }
      setSent(true);
      setTimeout(() => {
        setEmail("");
        setMessage("");
        setSent(false);
      }, 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[rgb(15,18,35)] border border-[var(--border-glass)] rounded-2xl max-w-lg w-full p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-xl font-bold text-[var(--white)]">
              Refer a company — get a month free
            </h2>
            <p className="text-xs text-[var(--gray-muted)] mt-1">
              When they sign up for Pro ($499/mo) through your link, we&apos;ll credit your next invoice 100% off.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--gray-dim)] hover:text-[var(--white)] transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-5">
          <label className="block text-xs font-medium text-[var(--gray-muted)] mb-1.5">
            Your referral link
          </label>
          <div className="flex items-stretch gap-2">
            <div className="flex-1 px-3 py-2.5 rounded-lg bg-white/[0.04] border border-[var(--border-glass)] text-[var(--white)] text-sm font-mono overflow-x-auto whitespace-nowrap">
              {link}
            </div>
            <button
              onClick={copy}
              disabled={!referralCode}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-[var(--cyan)]/15 hover:bg-[var(--cyan)]/25 border border-[var(--cyan)]/40 text-[var(--cyan)] transition-colors disabled:opacity-50"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-[var(--gray-dim)] mt-2">
            Share on Facebook groups, text a friend, drop in Slack. Your call.
          </p>
        </div>

        <div className="mt-5 pt-5 border-t border-[var(--border-glass)]">
          <p className="text-xs font-medium text-[var(--gray-muted)] mb-3">
            Or send them an email right now
          </p>

          {sent ? (
            <div className="py-4 text-center">
              <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-[var(--white)] text-sm font-semibold">Email sent!</p>
            </div>
          ) : (
            <div className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="friend@theircompany.com"
                className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-[var(--border-glass)] text-[var(--white)] text-sm focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors"
              />
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Optional: write a quick note they'll see in the email."
                rows={3}
                className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-[var(--border-glass)] text-[var(--white)] text-sm focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors resize-none"
              />
              {error && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
              <button
                onClick={handleSendEmail}
                disabled={sending || !email.trim() || !referralCode}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white transition-colors disabled:opacity-50"
              >
                {sending ? "Sending..." : "Send invite email"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
