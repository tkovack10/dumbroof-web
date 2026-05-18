"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface PriorityClaim {
  id: string;
  address: string | null;
  carrier_name: string | null;
  rep_email: string | null;
  reason: string; // "Needs forensic" / "Carrier silent 14d" / etc
  reason_chip_color: string;
  money_at_stake_dollars: number;
  action_label: string;
  action_url: string;
}

interface WhatsNextSummary {
  headline: string; // "3 claims need forensic — $42K at stake"
  sub: string; // "Two of them are USAA, where Mike is fast — strike today."
  total_money_at_stake_dollars: number;
  total_actions: number;
  priority_claims: PriorityClaim[];
}

// Local-time greeting tier
function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Late night";
}

function fmtMoney(d: number): string {
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000) return `$${(d / 1_000).toFixed(0)}K`;
  return `$${d.toFixed(0)}`;
}

/**
 * Phase 6 Slice 2 — Command Center hero.
 *
 * Lands at the top of /dashboard/admin every page-load. Same emotional
 * shape as the per-claim page's "WHAT'S NEXT" card, but rolled up to
 * the company:
 *
 *   ☀ Good morning, Tom — 3 actions worth $42K
 *   The fastest money is the Smith claim, $14K forensic ready to send.
 *
 *   [Smith — send forensic →] [Jones — supplement →] [Yang — chase carrier →]
 *
 * The card is the daily dopamine trigger. Roofers should open dumbroof
 * for this card alone.
 */
export function WhatsNextHero({ firstName }: { firstName?: string }) {
  const [data, setData] = useState<WhatsNextSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/whats-next")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        if (json) setData(json as WhatsNextSummary);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="glass-card p-6 mb-6 animate-shimmer h-40" />
    );
  }
  if (!data || data.priority_claims.length === 0) {
    return (
      <div className="glass-card p-6 mb-6 border border-[var(--green)]/30">
        <p className="text-xs uppercase tracking-wide text-[var(--green)] font-bold mb-1">
          ✓ All clear
        </p>
        <h2 className="text-xl font-bold text-white">
          {greeting()}, {firstName ?? "team"} — no actions waiting
        </h2>
        <p className="text-sm text-[var(--gray-muted)] mt-1">
          Every active claim has moved in the last 72h. Take a breath.
        </p>
      </div>
    );
  }

  return (
    <div className="relative glass-card p-6 mb-6 overflow-hidden border border-[var(--cyan)]/30">
      {/* subtle gradient backdrop to set this card apart from the rows below */}
      <div
        className="absolute inset-0 opacity-40 pointer-events-none"
        style={{
          background:
            "radial-gradient(120% 80% at 0% 0%, color-mix(in srgb, var(--cyan) 12%, transparent), transparent 60%)",
        }}
      />
      <div className="relative">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--cyan)] font-bold mb-1">
              WHAT&apos;S NEXT
            </p>
            <h2 className="text-xl sm:text-2xl font-bold text-white">
              {greeting()}, {firstName ?? "team"} —{" "}
              <span className="text-[var(--cyan)]">{data.total_actions} actions</span>{" "}
              worth{" "}
              <span className="font-mono text-[var(--green)]">
                {fmtMoney(data.total_money_at_stake_dollars)}
              </span>
            </h2>
            {data.sub && (
              <p className="text-sm text-[var(--gray)] mt-1.5 max-w-2xl">
                {data.sub}
              </p>
            )}
          </div>
          <Link
            href="/dashboard/admin?filter=needs_forensic"
            className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
          >
            Open today&apos;s queue →
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          {data.priority_claims.slice(0, 3).map((c) => (
            <Link
              key={c.id}
              href={c.action_url}
              className="group block p-3 rounded-xl border border-[var(--border-glass)] bg-white/[0.02] hover:bg-white/[0.05] hover:border-[var(--cyan)]/40 transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <span
                  className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
                  style={{
                    color: c.reason_chip_color,
                    background: `color-mix(in srgb, ${c.reason_chip_color} 14%, transparent)`,
                  }}
                >
                  {c.reason}
                </span>
                {c.money_at_stake_dollars > 0 && (
                  <span className="text-xs font-mono font-bold text-[var(--green)]">
                    {fmtMoney(c.money_at_stake_dollars)}
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-white truncate">
                {c.address ?? "—"}
              </p>
              <p className="text-xs text-[var(--gray-muted)] truncate">
                {[c.carrier_name, c.rep_email?.split("@")[0]]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="text-xs text-[var(--cyan)] mt-2 group-hover:text-white transition-colors">
                {c.action_label} →
              </p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
