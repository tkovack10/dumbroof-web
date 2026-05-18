"use client";

import Link from "next/link";

export interface CompanyPhaseCounts {
  open: number; // active, no carrier scope yet
  awaiting_carrier: number; // forensic out, scope not back yet
  ready_to_pay: number; // supplement approved / install scheduled / awaiting check
}

const PHASES: {
  key: keyof CompanyPhaseCounts;
  label: string;
  color: string;
  filter: string; // claims-grid filter to navigate to on click
}[] = [
  { key: "open",             label: "Open claims",      color: "var(--cyan)",  filter: "needs_forensic" },
  { key: "awaiting_carrier", label: "Awaiting carrier", color: "var(--amber)", filter: "needs_supplement" },
  { key: "ready_to_pay",     label: "Ready to pay",     color: "var(--green)", filter: "needs_check" },
];

/**
 * Phase 6 Slice 3 — Company-level 3-phase progress bar.
 *
 * Same dopamine primitive as the per-claim lifecycle bar, rolled up to
 * the company. Three colored segments sized by claim count, each clickable
 * to drill into the matching claims-grid filter. Used by Command Center,
 * Pipeline, and Reps to set "where the company is" before the row list.
 */
export function CompanyPhaseProgress({
  counts,
  loading,
}: {
  counts: CompanyPhaseCounts | null;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="glass-card p-4 mb-5 animate-shimmer h-20" />
    );
  }
  if (!counts) return null;
  const total = counts.open + counts.awaiting_carrier + counts.ready_to_pay;

  return (
    <div className="glass-card p-4 mb-5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-wider text-[var(--gray-muted)] font-bold">
          Pipeline
        </p>
        <p className="text-[10px] uppercase tracking-wider text-[var(--gray-dim)] font-mono">
          {total} active
        </p>
      </div>

      {total === 0 ? (
        <div className="rounded-lg bg-white/[0.02] h-10 flex items-center justify-center text-xs text-[var(--gray-dim)]">
          No active claims yet
        </div>
      ) : (
        <>
          <div className="flex h-10 rounded-lg overflow-hidden bg-white/[0.04] mb-3">
            {PHASES.map((p) => {
              const n = counts[p.key];
              if (n === 0) return null;
              const pct = (n / total) * 100;
              return (
                <Link
                  key={p.key}
                  href={`/dashboard/admin?filter=${p.filter}`}
                  className="group relative flex items-center justify-center transition-all hover:brightness-110"
                  style={{
                    width: `${pct}%`,
                    minWidth: 36,
                    background: p.color,
                  }}
                  title={`${p.label}: ${n}`}
                >
                  {pct > 10 && (
                    <span className="text-xs font-bold text-black">{n}</span>
                  )}
                </Link>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {PHASES.map((p) => {
              const n = counts[p.key];
              return (
                <Link
                  key={p.key}
                  href={`/dashboard/admin?filter=${p.filter}`}
                  className="inline-flex items-center gap-2 text-xs hover:opacity-100 opacity-90 transition-opacity"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ background: p.color, opacity: n > 0 ? 1 : 0.3 }}
                  />
                  <span className={n > 0 ? "text-white" : "text-[var(--gray-dim)]"}>
                    {p.label}
                  </span>
                  <span className="font-mono text-[var(--gray-muted)]">{n}</span>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
