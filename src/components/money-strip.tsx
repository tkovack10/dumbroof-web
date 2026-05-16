"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface RecentCheck {
  id: string;
  amount_cents: number | null;
  payor: string | null;
  source: string;
  received_at: string;
  claim_id: string;
}

interface MoneyStripData {
  todayCount: number;
  todayCents: number;
  pendingCommissionCount: number;
  pendingCommissionCents: number;
  recent: RecentCheck[];
}

const PULSE_MS = 2200;

function fmtMoney(cents: number): string {
  const v = cents / 100;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function MoneyStrip({ variant }: { variant: "sidebar" | "banner" }) {
  const [data, setData] = useState<MoneyStripData | null>(null);
  const [pulse, setPulse] = useState(false);
  const mountedAt = useRef<number>(Date.now());
  const supabase = createClient();

  // Initial fetch + slow poll fallback (in case Realtime is dropped)
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/admin/money-strip");
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        // swallow — strip is non-critical
      }
    }
    load();
    const i = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, []);

  // Realtime: pulse only when a NEW event arrives after mount for THIS company.
  // We fetch the caller's company_id from /api/admin/money-strip first, then
  // subscribe with a server-side row filter — without the filter, Supabase
  // Realtime broadcasts every tenant's INSERT to every subscriber (RLS is
  // SELECT-time, not Realtime-time).
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function subscribe() {
      const res = await fetch("/api/admin/money-strip-meta");
      if (!res.ok) return;
      const { companyId } = await res.json();
      if (cancelled || !companyId) return;

      channel = supabase
        .channel(`money-strip-${companyId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "check_uploads",
            filter: `company_id=eq.${companyId}`,
          },
          (payload) => {
            const arrivedAt = new Date(
              (payload.new as { received_at?: string })?.received_at ?? Date.now()
            ).getTime();
            if (arrivedAt < mountedAt.current) return;
            setPulse(true);
            setTimeout(() => setPulse(false), PULSE_MS);
            fetch("/api/admin/money-strip")
              .then((r) => r.json())
              .then((json) => setData(json))
              .catch(() => {});
          }
        )
        .subscribe();
    }

    subscribe();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [supabase]);

  if (!data) {
    return variant === "sidebar" ? (
      <div className="px-3 py-3 rounded-xl bg-white/[0.02] border border-[var(--border-glass)]">
        <div className="h-3 w-20 bg-white/[0.06] rounded animate-shimmer" />
      </div>
    ) : null;
  }

  const hasMoney = data.todayCount > 0;
  const dollarColor = hasMoney ? "var(--green)" : "var(--gray-dim)";

  if (variant === "sidebar") {
    return (
      <Link
        href="/dashboard/admin/revenue"
        className={`block px-3 py-3 rounded-xl border transition-all ${
          pulse
            ? "border-[var(--green)] bg-[var(--green)]/10 shadow-[0_0_24px_var(--green)]"
            : "border-[var(--border-glass)] bg-white/[0.02] hover:bg-white/[0.04]"
        }`}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wide text-[var(--gray-muted)] font-bold">
            Money today
          </span>
          <span
            className={`text-lg font-bold transition-colors ${pulse ? "animate-pulse" : ""}`}
            style={{ color: dollarColor }}
          >
            $
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-lg font-bold text-white">
            {fmtMoney(data.todayCents)}
          </span>
          <span className="text-xs text-[var(--gray-muted)]">
            {data.todayCount} {data.todayCount === 1 ? "check" : "checks"}
          </span>
        </div>
        {data.pendingCommissionCount > 0 && (
          <div className="mt-2 pt-2 border-t border-[var(--border-glass)] flex items-center justify-between">
            <span className="text-xs text-[var(--amber)]">
              {data.pendingCommissionCount} commission
              {data.pendingCommissionCount === 1 ? "" : "s"} pending
            </span>
            <span className="font-mono text-xs text-[var(--amber)]">
              {fmtMoney(data.pendingCommissionCents)}
            </span>
          </div>
        )}
      </Link>
    );
  }

  // banner variant (Command Center top strip)
  return (
    <div
      className={`glass-card p-4 mb-6 flex items-center gap-6 transition-all ${
        pulse
          ? "border-[var(--green)] shadow-[0_0_32px_var(--green)]/40"
          : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center text-xl font-bold ${
            pulse ? "animate-pulse" : ""
          }`}
          style={{
            background: `color-mix(in srgb, ${dollarColor} 20%, transparent)`,
            color: dollarColor,
          }}
        >
          $
        </div>
        <div>
          <p className="text-xs text-[var(--gray-muted)] uppercase tracking-wide font-bold">
            Money today
          </p>
          <p className="font-mono text-xl font-bold text-white">
            {fmtMoney(data.todayCents)}{" "}
            <span className="text-sm text-[var(--gray-muted)] font-normal">
              · {data.todayCount} {data.todayCount === 1 ? "check" : "checks"}
            </span>
          </p>
        </div>
      </div>

      {data.pendingCommissionCount > 0 && (
        <Link
          href="/dashboard/admin/commissions"
          className="ml-auto flex items-center gap-3 px-4 py-2 rounded-xl border border-[var(--amber)]/40 bg-[var(--amber)]/10 hover:bg-[var(--amber)]/15 transition-colors"
        >
          <span className="text-sm text-[var(--amber)] font-semibold">
            {data.pendingCommissionCount} commission
            {data.pendingCommissionCount === 1 ? "" : "s"} need approval
          </span>
          <span className="font-mono text-sm text-[var(--amber)] font-bold">
            {fmtMoney(data.pendingCommissionCents)}
          </span>
          <svg
            className="w-4 h-4 text-[var(--amber)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.25 4.5l7.5 7.5-7.5 7.5"
            />
          </svg>
        </Link>
      )}
    </div>
  );
}
