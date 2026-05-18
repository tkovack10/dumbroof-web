"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface RailData {
  top_rep: {
    user_id: string;
    email: string | null;
    check_count: number;
    total_cents: number;
  } | null;
  recent_check: {
    claim_id: string;
    amount_cents: number | null;
    payor: string | null;
    received_at: string;
  } | null;
  biggest_win: {
    claim_id: string;
    address: string | null;
    contractor_rcv: number;
    rep_email: string | null;
  } | null;
  oldest_stalled: {
    claim_id: string;
    address: string | null;
    carrier: string | null;
    last_touched_at: string | null;
    days_stale: number | null;
    rep_email: string | null;
  } | null;
}

function fmtMoneyCents(c: number): string {
  if (c >= 100_000_000) return `$${(c / 100_000_000).toFixed(1)}M`;
  if (c >= 100_000) return `$${(c / 100_000).toFixed(0)}K`;
  return `$${(c / 100).toFixed(0)}`;
}
function fmtMoneyDollars(d: number): string {
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000) return `$${(d / 1_000).toFixed(0)}K`;
  return `$${d.toFixed(0)}`;
}
function repName(email: string | null | undefined): string {
  if (!email) return "—";
  return email
    .split("@")[0]
    .split(/[._-]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86_400_000);
  if (d === 0) return "today";
  if (d === 1) return "1d ago";
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

/**
 * Phase 6 Slice 5 — persistent right rail for admin pages.
 *
 * 4 always-visible context cards: top rep this week, biggest recent win,
 * most recent check, oldest stalled claim. Same "what matters now" shape
 * as the per-claim right rail (damage score / contacts / timeline), rolled
 * up to the company. Renders as a vertical column sized to the page width
 * — host pages layout with `lg:grid lg:grid-cols-[1fr,280px]`.
 */
export function AdminRightRail() {
  const [data, setData] = useState<RailData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/right-rail")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        if (json) setData(json as RailData);
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
      <aside className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-card p-4 animate-shimmer h-24" />
        ))}
      </aside>
    );
  }

  if (!data) return null;

  return (
    <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
      {/* Top rep this week */}
      <RailCard
        accent="var(--green)"
        eyebrow="Top rep this week"
        title={data.top_rep ? repName(data.top_rep.email) : "—"}
        sub={
          data.top_rep
            ? `${data.top_rep.check_count} check${data.top_rep.check_count === 1 ? "" : "s"} · ${fmtMoneyCents(data.top_rep.total_cents)}`
            : "No checks collected this week"
        }
      />

      {/* Biggest recent win */}
      <RailCard
        accent="var(--cyan)"
        eyebrow="Biggest recent win"
        title={
          data.biggest_win
            ? fmtMoneyDollars(data.biggest_win.contractor_rcv)
            : "—"
        }
        sub={
          data.biggest_win
            ? `${data.biggest_win.address ?? "—"} · ${repName(data.biggest_win.rep_email)}`
            : "No wins yet"
        }
        href={
          data.biggest_win
            ? `/dashboard/claim/${data.biggest_win.claim_id}`
            : undefined
        }
      />

      {/* Most recent check */}
      <RailCard
        accent="#22C55E"
        eyebrow="Most recent check"
        title={
          data.recent_check && data.recent_check.amount_cents != null
            ? fmtMoneyCents(data.recent_check.amount_cents)
            : data.recent_check
              ? "Check received"
              : "—"
        }
        sub={
          data.recent_check
            ? `${data.recent_check.payor ?? "Carrier"} · ${timeAgo(data.recent_check.received_at)}`
            : "No checks yet"
        }
        href={
          data.recent_check
            ? `/dashboard/claim/${data.recent_check.claim_id}`
            : undefined
        }
      />

      {/* Oldest stalled claim */}
      <RailCard
        accent="var(--red-accent)"
        eyebrow="Oldest stalled"
        title={
          data.oldest_stalled?.days_stale
            ? `${data.oldest_stalled.days_stale}d untouched`
            : data.oldest_stalled
              ? "Never touched"
              : "—"
        }
        sub={
          data.oldest_stalled
            ? `${data.oldest_stalled.address ?? "—"} · ${data.oldest_stalled.carrier ?? "—"}`
            : "All claims are fresh"
        }
        href={
          data.oldest_stalled
            ? `/dashboard/claim/${data.oldest_stalled.claim_id}`
            : undefined
        }
      />
    </aside>
  );
}

function RailCard({
  accent,
  eyebrow,
  title,
  sub,
  href,
}: {
  accent: string;
  eyebrow: string;
  title: string;
  sub: string;
  href?: string;
}) {
  const body = (
    <div
      className="glass-card p-3.5 border-l-2 transition-colors hover:bg-white/[0.04]"
      style={{ borderLeftColor: accent }}
    >
      <p
        className="text-[10px] uppercase tracking-wider font-bold mb-1"
        style={{ color: accent }}
      >
        {eyebrow}
      </p>
      <p className="text-sm font-bold text-white truncate">{title}</p>
      <p className="text-xs text-[var(--gray-muted)] truncate mt-0.5">{sub}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
