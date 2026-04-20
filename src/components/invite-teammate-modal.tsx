"use client";

import { useState } from "react";

type Role = "admin" | "member" | "rep" | "readonly";

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Full access to all claims, settings, billing, and team.",
  member: "View and edit all claims. Cannot change billing or team.",
  rep: "View and edit claims assigned to them. Cannot see billing.",
  readonly: "View-only access to all claims.",
};

export function InviteTeammateModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSend = async () => {
    setError(null);
    if (!email.trim() || !email.includes("@")) {
      setError("Enter a valid email address");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role, message: message.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send invite");
        setSending(false);
        return;
      }
      setSent(true);
      onSuccess?.();
      setTimeout(() => {
        setEmail("");
        setMessage("");
        setRole("member");
        setSent(false);
        onClose();
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
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-[var(--white)]">Invite a teammate</h2>
            <p className="text-xs text-[var(--gray-muted)] mt-1">
              They&apos;ll get an email with a link to join your company.
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

        {sent ? (
          <div className="py-10 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
              <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-[var(--white)] font-semibold">Invite sent!</p>
            <p className="text-xs text-[var(--gray-muted)] mt-1">{email}</p>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--gray-muted)] mb-1.5">
                  Email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@yourcompany.com"
                  className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-[var(--border-glass)] text-[var(--white)] text-sm focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--gray-muted)] mb-1.5">
                  Role
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-[var(--border-glass)] text-[var(--white)] text-sm focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors"
                >
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="rep">Sales Rep</option>
                  <option value="readonly">View Only</option>
                </select>
                <p className="text-xs text-[var(--gray-dim)] mt-1.5">{ROLE_DESCRIPTIONS[role]}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--gray-muted)] mb-1.5">
                  Personal message <span className="text-[var(--gray-dim)]">(optional)</span>
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Hey, join me on dumbroof.ai — we're using this for all our claims now."
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-[var(--border-glass)] text-[var(--white)] text-sm focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors resize-none"
                />
              </div>

              {error && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                onClick={onClose}
                disabled={sending}
                className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--gray)] hover:text-[var(--white)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending || !email.trim()}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white transition-colors disabled:opacity-50"
              >
                {sending ? "Sending..." : "Send invite"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
