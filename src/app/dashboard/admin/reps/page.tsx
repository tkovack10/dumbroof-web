"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  ClaimFilterChips,
  type ClaimGridFilter,
  type ClaimGridCounts,
} from "@/components/claim-filter-chips";
import {
  ClaimRowAction,
  type ClaimGridRow,
} from "@/components/claim-row-action";

interface RepRollup {
  user_id: string;
  email: string | null;
  claim_count: number;
  checks_collected: number;
  all_lit: number;
}

interface GridResponse {
  claims: ClaimGridRow[];
  counts: ClaimGridCounts;
  reps: RepRollup[];
}

function repName(email: string | null): string {
  if (!email) return "—";
  return email
    .split("@")[0]
    .split(/[._-]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

export default function RepsPage() {
  const [filter, setFilter] = useState<ClaimGridFilter>("all");
  const [selectedRep, setSelectedRep] = useState<string | null>(null);
  const [data, setData] = useState<GridResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ filter, scope: "active" });
      if (selectedRep) params.set("rep", selectedRep);
      const res = await fetch(`/api/admin/claims-grid?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as GridResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter, selectedRep]);

  useEffect(() => {
    load();
  }, [load]);

  const sortedReps = useMemo(() => {
    if (!data?.reps) return [];
    return [...data.reps].sort((a, b) => b.claim_count - a.claim_count);
  }, [data]);

  return (
    <div className="p-6 lg:p-8 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="mb-5 pl-10 lg:pl-0">
          <h1 className="text-2xl font-bold gradient-text">Team / Reps</h1>
          <p className="text-[var(--gray-muted)] mt-1 text-sm">
            Every claim, every rep, what&apos;s left to do.
          </p>
        </div>

        {/* Rep selector strip */}
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setSelectedRep(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              selectedRep === null
                ? "border-[var(--cyan)] bg-[var(--cyan)]/[0.08] text-white"
                : "border-[var(--border-glass)] bg-white/[0.02] text-[var(--gray)] hover:bg-white/[0.04]"
            }`}
          >
            Everyone
            <span className="ml-1.5 text-[10px] text-[var(--gray-muted)]">
              {data?.counts.all ?? "—"}
            </span>
          </button>
          {sortedReps.map((rep) => {
            const isActive = selectedRep === rep.user_id;
            return (
              <button
                key={rep.user_id}
                type="button"
                onClick={() => setSelectedRep(isActive ? null : rep.user_id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors flex items-center gap-1.5 ${
                  isActive
                    ? "border-[var(--cyan)] bg-[var(--cyan)]/[0.08] text-white"
                    : "border-[var(--border-glass)] bg-white/[0.02] text-[var(--gray)] hover:bg-white/[0.04]"
                }`}
              >
                <span>{repName(rep.email)}</span>
                <span className="text-[10px] text-[var(--gray-muted)] font-mono">
                  {rep.claim_count}
                </span>
                {rep.checks_collected > 0 && (
                  <span
                    className="inline-flex items-center text-[10px] font-mono px-1 rounded"
                    style={{
                      background: "color-mix(in srgb, var(--green) 25%, transparent)",
                      color: "var(--green)",
                    }}
                    title={`${rep.checks_collected} check${rep.checks_collected === 1 ? "" : "s"} collected`}
                  >
                    {rep.checks_collected}$
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Filter chips */}
        <div className="mb-5">
          <ClaimFilterChips
            active={filter}
            counts={data?.counts ?? null}
            onChange={setFilter}
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 mb-4">
            {error}
          </div>
        )}

        {/* Claims list */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 bg-white/[0.03] rounded-xl animate-shimmer" />
            ))}
          </div>
        ) : !data || data.claims.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <p className="text-sm text-[var(--gray-muted)]">
              No claims match this filter.
            </p>
            {selectedRep && (
              <button
                type="button"
                onClick={() => setSelectedRep(null)}
                className="mt-2 text-xs text-[var(--cyan)] hover:underline"
              >
                Clear rep filter
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {data.claims.map((c) => (
              <ClaimRowAction key={c.id} claim={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
