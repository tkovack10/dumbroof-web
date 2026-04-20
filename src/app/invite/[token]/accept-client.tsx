"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function InviteAcceptClient({
  token,
  inviterName,
  companyName,
  role,
  email,
}: {
  token: string;
  inviterName: string;
  companyName: string;
  role: string;
  email: string;
}) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    setError(null);
    setAccepting(true);
    try {
      const res = await fetch("/api/team/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to accept invite");
        setAccepting(false);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setAccepting(false);
    }
  };

  return (
    <>
      <h1 className="text-2xl font-bold mb-2">
        Join <span className="text-transparent bg-clip-text bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)]">{companyName}</span>
      </h1>
      <p className="text-[var(--gray-muted)] text-sm mb-6">
        <strong className="text-[var(--white)]">{inviterName}</strong> invited{" "}
        <strong className="text-[var(--white)]">{email}</strong> to join as a{" "}
        <strong className="text-[var(--white)]">{role}</strong>. You&apos;ll see all their claims and be able to collaborate on them.
      </p>

      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">
          {error}
        </div>
      )}

      <button
        onClick={handleAccept}
        disabled={accepting}
        className="w-full px-5 py-3 rounded-lg text-sm font-semibold bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white transition-colors disabled:opacity-50"
      >
        {accepting ? "Joining..." : `Accept & join ${companyName}`}
      </button>

      <p className="text-xs text-[var(--gray-dim)] mt-4 text-center">
        By accepting you&apos;ll be added to the team. Your personal claims (if any) will remain accessible.
      </p>
    </>
  );
}
