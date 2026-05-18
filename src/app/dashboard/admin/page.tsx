"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { MoneyStrip } from "@/components/money-strip";
import { WhatsNextHero } from "@/components/whats-next-hero";
import {
  CompanyPhaseProgress,
  type CompanyPhaseCounts,
} from "@/components/company-phase-progress";
import { createClient } from "@/lib/supabase/client";
import {
  ClaimFilterChips,
  type ClaimGridFilter,
  type ClaimGridCounts,
} from "@/components/claim-filter-chips";
import {
  ClaimRowAction,
  type ClaimGridRow,
} from "@/components/claim-row-action";

interface Alert {
  type: string;
  count: number;
  message: string;
}

interface GridResponse {
  claims: ClaimGridRow[];
  counts: ClaimGridCounts;
  phase_counts?: CompanyPhaseCounts;
}

export default function CommandCenterPage() {
  const [filter, setFilter] = useState<ClaimGridFilter>("all");
  const [grid, setGrid] = useState<GridResponse | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string | undefined>(undefined);

  // Pull the caller's first name once for the hero greeting
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user?.email) return;
      const local = user.email.split("@")[0];
      const first = local.split(/[._-]/)[0];
      if (first) setFirstName(first.charAt(0).toUpperCase() + first.slice(1));
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [gridRes, overviewRes] = await Promise.all([
        fetch(`/api/admin/claims-grid?filter=${filter}&scope=active`, {
          cache: "no-store",
        }),
        fetch(`/api/admin/overview`, { cache: "no-store" }),
      ]);
      if (!gridRes.ok) {
        const body = await gridRes.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${gridRes.status}`);
      }
      const gridJson = (await gridRes.json()) as GridResponse;
      setGrid(gridJson);
      if (overviewRes.ok) {
        const ov = await overviewRes.json();
        setAlerts((ov.alerts as Alert[]) || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-5 pl-10 lg:pl-0">
          <h1 className="text-2xl font-bold gradient-text">Command Center</h1>
          <p className="text-[var(--gray-muted)] mt-1 text-sm">
            Every active claim, what&apos;s next, money in motion.
          </p>
        </div>

        {/* WHAT'S NEXT hero — Phase 6 Slice 2 morning briefing */}
        <WhatsNextHero firstName={firstName} />

        {/* Money strip */}
        <MoneyStrip variant="banner" />

        {/* Company phase progress — Phase 6 Slice 3 */}
        <CompanyPhaseProgress
          counts={grid?.phase_counts ?? null}
          loading={loading && !grid}
        />

        {/* Alerts row (only render if non-empty) */}
        {alerts.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
            {alerts.map((alert, i) => {
              const isRed =
                alert.type === "error_claims" ||
                alert.type === "overdue_invoice";
              const borderColor = isRed
                ? "var(--red-accent)"
                : "var(--amber)";
              const bgColor = isRed
                ? "rgba(255, 90, 106, 0.08)"
                : "rgba(255, 194, 51, 0.08)";
              const href =
                alert.type === "overdue_invoice"
                  ? "/dashboard/admin/revenue"
                  : "/dashboard/admin/pipeline";
              return (
                <Link key={i} href={href}>
                  <div
                    className="p-3 rounded-xl border transition-colors hover:brightness-110 cursor-pointer flex items-center gap-3"
                    style={{ borderColor, backgroundColor: bgColor }}
                  >
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{
                        background: `color-mix(in srgb, ${borderColor} 20%, transparent)`,
                      }}
                    >
                      <span
                        className="text-base font-bold"
                        style={{ color: borderColor }}
                      >
                        {alert.count}
                      </span>
                    </div>
                    <p className="text-sm text-white">{alert.message}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Filter chips */}
        <div className="mb-5">
          <ClaimFilterChips
            active={filter}
            counts={grid?.counts ?? null}
            onChange={setFilter}
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-16 bg-white/[0.03] rounded-xl animate-shimmer" />
            ))}
          </div>
        ) : !grid || grid.claims.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <p className="text-sm text-[var(--gray-muted)] mb-2">
              No active claims match this filter.
            </p>
            <Link
              href="/dashboard/new-claim"
              className="text-xs text-[var(--cyan)] hover:underline"
            >
              + Create a new claim
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {grid.claims.map((c) => (
              <ClaimRowAction key={c.id} claim={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
