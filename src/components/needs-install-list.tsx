"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type NeedsInstallClaim = {
  claim_id: string;
  address: string | null;
  homeowner_name: string | null;
  homeowner_email: string | null;
  homeowner_phone: string | null;
  carrier: string | null;
  status: string | null;
  phase: string | null;
  total_paid_cents: number;
  first_payment_at: string;
  check_count: number;
  last_payor: string | null;
};

interface Props {
  /** Called when the user clicks "Schedule install" on a row. Parent opens its
   *  existing <ScheduleClaimModal> with this claim pre-selected. */
  onScheduleClaim: (claim: NeedsInstallClaim) => void;
  /** Bumped to force a refetch (after a new payment / new schedule). */
  refreshKey?: number;
  /** Reports the row count to the parent so the tab strip can show a badge. */
  onCountChange?: (count: number) => void;
}

function fmtCents(c: number): string {
  return `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysSince(iso: string): number {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function NeedsInstallList({ onScheduleClaim, refreshKey, onCountChange }: Props) {
  const [rows, setRows] = useState<NeedsInstallClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/production/needs-install");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const body = await res.json();
      const next: NeedsInstallClaim[] = body.claims || [];
      setRows(next);
      onCountChange?.(next.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (loading) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-sm text-[var(--gray-muted)]">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-sm text-[var(--red-accent)]">{error}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-base font-semibold text-white mb-2">All paid jobs are scheduled ✓</p>
        <p className="text-sm text-[var(--gray-muted)] max-w-lg mx-auto">
          Every claim with a recorded payment already has an install date on the calendar.
          New payments will appear here automatically until they&apos;re scheduled.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card p-4 mb-6">
      <div className="flex items-center justify-between mb-3 px-2">
        <p className="text-xs text-[var(--gray-muted)]">
          Jobs with payment received but no install date. Oldest payment first.
        </p>
        <p className="text-xs text-[var(--gray-muted)]">{rows.length} job{rows.length === 1 ? "" : "s"}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-[var(--gray-muted)] border-b border-[var(--border)]">
            <tr>
              <th className="text-left py-2 px-2">Address</th>
              <th className="text-left py-2 px-2">Homeowner</th>
              <th className="text-left py-2 px-2">Carrier</th>
              <th className="text-right py-2 px-2">Paid</th>
              <th className="text-right py-2 px-2">First payment</th>
              <th className="text-right py-2 px-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const days = daysSince(r.first_payment_at);
              const isStale = days > 30;
              return (
                <tr
                  key={r.claim_id}
                  className="border-b border-[var(--border)]/40 hover:bg-white/[0.02]"
                >
                  <td className="py-2 px-2">
                    <Link
                      href={`/dashboard/claim/${r.claim_id}`}
                      className="text-white hover:text-[var(--cyan)] transition-colors"
                    >
                      {r.address || "—"}
                    </Link>
                  </td>
                  <td className="py-2 px-2 text-[var(--gray-muted)]">
                    {r.homeowner_name || "—"}
                  </td>
                  <td className="py-2 px-2 text-[var(--gray-muted)]">
                    {r.carrier || "—"}
                  </td>
                  <td className="py-2 px-2 text-right font-semibold text-[var(--green)]">
                    {fmtCents(r.total_paid_cents)}
                    {r.check_count > 1 && (
                      <span className="text-[var(--gray-muted)] text-xs ml-1">
                        ({r.check_count} checks)
                      </span>
                    )}
                  </td>
                  <td
                    className={`py-2 px-2 text-right text-xs ${
                      isStale ? "text-[var(--red-accent)]" : "text-[var(--gray-muted)]"
                    }`}
                  >
                    {r.first_payment_at.slice(0, 10)}
                    <div className="text-[10px] opacity-70">{days}d ago</div>
                  </td>
                  <td className="py-2 px-2 text-right">
                    <button
                      type="button"
                      onClick={() => onScheduleClaim(r)}
                      className="text-xs font-semibold text-[var(--cyan)] hover:text-white transition-colors px-3 py-1 rounded-md hover:bg-[var(--cyan)]/10"
                    >
                      Schedule install →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
