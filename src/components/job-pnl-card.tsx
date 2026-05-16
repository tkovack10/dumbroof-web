"use client";

import { useEffect, useState, useCallback } from "react";
import { ExpenseUploadModal } from "@/components/expense-upload-modal";

interface Expense {
  id: string;
  type: string;
  amount_cents: number;
  vendor: string | null;
  description: string | null;
  receipt_path: string | null;
  receipt_url: string | null;
  occurred_at: string;
  notes: string | null;
}

const TYPE_COLORS: Record<string, string> = {
  material: "var(--cyan)",
  labor: "var(--pink)",
  dumpster: "var(--amber)",
  subcontractor: "var(--purple)",
  permit: "var(--blue)",
  rental: "var(--green)",
  misc: "var(--gray)",
};

const TYPE_LABEL: Record<string, string> = {
  material: "Material",
  labor: "Labor",
  dumpster: "Dumpster",
  subcontractor: "Subcontractor",
  permit: "Permit",
  rental: "Rental",
  misc: "Misc",
};

function fmtMoneyCents(c: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(c / 100);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Per-claim P&L: revenue (from RCV or recorded checks) minus expenses,
 * broken down by type. Embedded in claim detail via ClaimExpenseActions,
 * also usable standalone in admin pages.
 */
export function JobPnlCard({
  claimId,
  revenueCents,
}: {
  claimId: string;
  revenueCents: number | null;
}) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/claim/${claimId}/expense`);
      if (res.ok) {
        const json = await res.json();
        setExpenses((json.expenses as Expense[]) || []);
      }
    } finally {
      setLoading(false);
    }
  }, [claimId]);

  useEffect(() => {
    load();
  }, [load]);

  const totalExpensesCents = expenses.reduce((s, e) => s + e.amount_cents, 0);
  const byType = expenses.reduce(
    (acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + e.amount_cents;
      return acc;
    },
    {} as Record<string, number>
  );

  const netCents = (revenueCents ?? 0) - totalExpensesCents;
  const marginPct = revenueCents && revenueCents > 0
    ? Math.round((netCents / revenueCents) * 100)
    : null;

  const sortedTypes = Object.entries(byType).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div className="glass-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Job P&amp;L</h3>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="text-xs text-[var(--cyan)] hover:text-white font-semibold transition-colors"
          >
            + Add expense
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Metric
            label="Revenue"
            cents={revenueCents}
            color="var(--cyan)"
          />
          <Metric
            label="Expenses"
            cents={totalExpensesCents > 0 ? totalExpensesCents : null}
            color="var(--amber)"
            placeholderDim
          />
          <Metric
            label={marginPct !== null ? `Net (${marginPct}%)` : "Net"}
            cents={revenueCents !== null ? netCents : null}
            color={netCents >= 0 ? "var(--green)" : "var(--red-accent)"}
          />
        </div>

        {sortedTypes.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide text-[var(--gray-muted)] font-bold">
              Expense breakdown
            </p>
            {sortedTypes.map(([t, cents]) => (
              <div key={t} className="flex items-center gap-2 text-xs">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: TYPE_COLORS[t] }}
                />
                <span className="text-[var(--gray)] flex-1">
                  {TYPE_LABEL[t] ?? t}
                </span>
                <span className="font-mono text-white">
                  {fmtMoneyCents(cents)}
                </span>
                <span className="text-[var(--gray-dim)] w-12 text-right">
                  {totalExpensesCents > 0
                    ? `${Math.round((cents / totalExpensesCents) * 100)}%`
                    : "—"}
                </span>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-7 bg-white/[0.03] rounded animate-shimmer" />
            ))}
          </div>
        ) : expenses.length === 0 ? (
          <div className="text-center py-4 text-xs text-[var(--gray-muted)]">
            No expenses recorded yet.
          </div>
        ) : (
          <details className="group">
            <summary className="cursor-pointer list-none text-xs text-[var(--gray-muted)] hover:text-white py-2 select-none">
              <span className="group-open:hidden">▸ Show {expenses.length} expense{expenses.length === 1 ? "" : "s"}</span>
              <span className="hidden group-open:inline">▾ Hide</span>
            </summary>
            <ul className="space-y-1 mt-1 max-h-64 overflow-y-auto">
              {expenses.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-2 text-xs p-2 rounded-lg bg-white/[0.02] border border-[var(--border-glass)]"
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: TYPE_COLORS[e.type] }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-white truncate">
                      {e.vendor || TYPE_LABEL[e.type] || e.type}
                    </p>
                    {e.description && (
                      <p className="text-[var(--gray-dim)] truncate">
                        {e.description}
                      </p>
                    )}
                  </div>
                  <span className="text-[var(--gray-dim)] text-[10px]">
                    {fmtDate(e.occurred_at)}
                  </span>
                  {e.receipt_url && (
                    <a
                      href={e.receipt_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--cyan)] hover:text-white"
                      title="View receipt"
                    >
                      📎
                    </a>
                  )}
                  <span className="font-mono text-white font-semibold">
                    {fmtMoneyCents(e.amount_cents)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <ExpenseUploadModal
        claimId={claimId}
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSaved={load}
      />
    </>
  );
}

function Metric({
  label,
  cents,
  color,
  placeholderDim,
}: {
  label: string;
  cents: number | null;
  color: string;
  placeholderDim?: boolean;
}) {
  return (
    <div className="text-center">
      <p
        className="font-mono text-lg font-bold"
        style={{
          color: cents === null && placeholderDim ? "var(--gray-dim)" : color,
        }}
      >
        {cents === null ? "—" : fmtMoneyCents(cents)}
      </p>
      <p className="text-[10px] text-[var(--gray-muted)] mt-0.5">{label}</p>
    </div>
  );
}
