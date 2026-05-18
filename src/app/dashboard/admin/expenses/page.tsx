"use client";

import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { JobPnlCard } from "@/components/job-pnl-card";

interface Job {
  claim_id: string;
  address: string | null;
  homeowner_name: string | null;
  carrier_name: string | null;
  status: string | null;
  last_touched_at: string | null;
  revenue_source: "checks" | "estimate";
  revenue_cents: number;
  expenses_cents: number;
  expenses_by_type: Record<string, number>;
  net_cents: number;
  margin_pct: number | null;
}

interface Totals {
  revenue_cents: number;
  expenses_cents: number;
  net_cents: number;
  margin_pct: number | null;
  jobs_with_expenses: number;
  jobs_with_revenue: number;
}

type Filter = "all" | "with_expenses" | "negative_margin";
type SortKey = "address" | "revenue" | "expenses" | "net" | "margin";

function fmtMoneyCents(c: number, abbreviate = false): string {
  if (abbreviate) {
    const v = c / 100;
    if (Math.abs(v) >= 1_000_000) return `${v < 0 ? "-" : ""}$${(Math.abs(v) / 1_000_000).toFixed(1)}M`;
    if (Math.abs(v) >= 1_000) return `${v < 0 ? "-" : ""}$${(Math.abs(v) / 1_000).toFixed(0)}K`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(c / 100);
}

export default function ExpensesPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("with_expenses");
  const [sortKey, setSortKey] = useState<SortKey>("net");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/job-pnl");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setJobs((json.jobs as Job[]) || []);
      setTotals(json.totals as Totals);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visibleJobs = useMemo(() => {
    let list = jobs;
    if (filter === "with_expenses") list = list.filter((j) => j.expenses_cents > 0);
    if (filter === "negative_margin") list = list.filter((j) => j.net_cents < 0);

    list = [...list].sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      switch (sortKey) {
        case "address":
          av = (a.address || "").toLowerCase();
          bv = (b.address || "").toLowerCase();
          break;
        case "revenue":
          av = a.revenue_cents;
          bv = b.revenue_cents;
          break;
        case "expenses":
          av = a.expenses_cents;
          bv = b.expenses_cents;
          break;
        case "net":
          av = a.net_cents;
          bv = b.net_cents;
          break;
        case "margin":
          av = a.margin_pct ?? -999;
          bv = b.margin_pct ?? -999;
          break;
      }
      if (typeof av === "string" && typeof bv === "string") {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return list;
  }, [jobs, filter, sortKey, sortAsc]);

  const handleSort = useCallback(
    (k: SortKey) => {
      if (k === sortKey) {
        setSortAsc((v) => !v);
      } else {
        setSortKey(k);
        setSortAsc(false);
      }
    },
    [sortKey]
  );

  return (
    <div className="p-6 lg:p-8 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 pl-10 lg:pl-0 flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold gradient-text">Job P&amp;L</h1>
            <p className="text-[var(--gray-muted)] mt-1 text-sm">
              Receipts in, RCV out, net by job. Negative margins flagged red.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              // Open Richard with a prompt — reuses the receipt-OCR tool path
              window.dispatchEvent(
                new CustomEvent("richard-launcher:open", {
                  detail: {
                    prompt: "I want to record an expense receipt for ",
                  },
                })
              );
            }}
            className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-5 py-2 rounded-xl text-sm font-bold transition-all"
          >
            + Record an expense
          </button>
        </div>

        {/* Company totals */}
        {totals && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <SummaryCard
              label="Revenue"
              value={fmtMoneyCents(totals.revenue_cents, true)}
              color="var(--cyan)"
              sub={`${totals.jobs_with_revenue} jobs`}
            />
            <SummaryCard
              label="Expenses"
              value={fmtMoneyCents(totals.expenses_cents, true)}
              color="var(--amber)"
              sub={`${totals.jobs_with_expenses} jobs`}
            />
            <SummaryCard
              label="Net"
              value={fmtMoneyCents(totals.net_cents, true)}
              color={totals.net_cents >= 0 ? "var(--green)" : "var(--red-accent)"}
              sub={
                totals.margin_pct !== null
                  ? `${totals.margin_pct}% margin`
                  : "—"
              }
            />
            <SummaryCard
              label="Avg margin"
              value={
                totals.margin_pct !== null ? `${totals.margin_pct}%` : "—"
              }
              color={
                (totals.margin_pct ?? 0) >= 30
                  ? "var(--green)"
                  : (totals.margin_pct ?? 0) >= 10
                    ? "var(--amber)"
                    : "var(--red-accent)"
              }
            />
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <FilterChip
            active={filter === "all"}
            label="All jobs"
            onClick={() => setFilter("all")}
            count={jobs.length}
          />
          <FilterChip
            active={filter === "with_expenses"}
            label="With expenses"
            onClick={() => setFilter("with_expenses")}
            count={jobs.filter((j) => j.expenses_cents > 0).length}
          />
          <FilterChip
            active={filter === "negative_margin"}
            label="Negative margin"
            onClick={() => setFilter("negative_margin")}
            count={jobs.filter((j) => j.net_cents < 0).length}
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 mb-4">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="glass-card overflow-hidden">
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 bg-white/[0.03] rounded animate-shimmer" />
              ))}
            </div>
          ) : visibleJobs.length === 0 ? (
            <div className="p-12 text-center text-sm text-[var(--gray-muted)]">
              No jobs match this filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border-glass)]">
                    <Sort label="Job" k="address" onClick={handleSort} active={sortKey} asc={sortAsc} />
                    <Sort label="Revenue" k="revenue" align="right" onClick={handleSort} active={sortKey} asc={sortAsc} />
                    <Sort label="Expenses" k="expenses" align="right" onClick={handleSort} active={sortKey} asc={sortAsc} />
                    <Sort label="Net" k="net" align="right" onClick={handleSort} active={sortKey} asc={sortAsc} />
                    <Sort label="Margin" k="margin" align="right" onClick={handleSort} active={sortKey} asc={sortAsc} />
                  </tr>
                </thead>
                <tbody>
                  {visibleJobs.map((j) => {
                    const expanded = expandedClaimId === j.claim_id;
                    return (
                      <Fragment key={j.claim_id}>
                        <tr
                          onClick={() =>
                            setExpandedClaimId(expanded ? null : j.claim_id)
                          }
                          className={`border-b border-[var(--border-glass)] hover:bg-white/[0.03] transition-colors cursor-pointer ${
                            j.net_cents < 0 ? "border-l-2 border-l-[var(--red-accent)]" : ""
                          } ${expanded ? "bg-white/[0.03]" : ""}`}
                        >
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <svg
                                className={`w-3 h-3 text-[var(--gray-muted)] flex-shrink-0 transition-transform ${
                                  expanded ? "rotate-90" : ""
                                }`}
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
                              <Link
                                href={`/dashboard/claim/${j.claim_id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-sm text-white hover:text-[var(--cyan)] transition-colors"
                              >
                                {j.address ?? j.claim_id.slice(0, 8)}
                              </Link>
                            </div>
                            <p className="text-xs text-[var(--gray-dim)] ml-5">
                              {[j.homeowner_name, j.carrier_name]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </td>
                          <td className="px-5 py-3 text-sm text-right font-mono text-[var(--cyan)]">
                            {fmtMoneyCents(j.revenue_cents)}
                            <p className="text-[10px] text-[var(--gray-dim)]">
                              via {j.revenue_source}
                            </p>
                          </td>
                          <td className="px-5 py-3 text-sm text-right font-mono text-[var(--amber)]">
                            {j.expenses_cents > 0
                              ? fmtMoneyCents(j.expenses_cents)
                              : "--"}
                          </td>
                          <td
                            className="px-5 py-3 text-sm text-right font-mono font-semibold"
                            style={{
                              color:
                                j.net_cents >= 0 ? "var(--green)" : "var(--red-accent)",
                            }}
                          >
                            {fmtMoneyCents(j.net_cents)}
                          </td>
                          <td className="px-5 py-3 text-sm text-right font-mono">
                            {j.margin_pct !== null ? (
                              <span
                                style={{
                                  color:
                                    j.margin_pct >= 30
                                      ? "var(--green)"
                                      : j.margin_pct >= 10
                                        ? "var(--amber)"
                                        : "var(--red-accent)",
                                }}
                              >
                                {j.margin_pct}%
                              </span>
                            ) : (
                              <span className="text-[var(--gray-dim)]">—</span>
                            )}
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="bg-white/[0.015] border-b border-[var(--border-glass)]">
                            <td colSpan={5} className="px-5 py-4">
                              <JobPnlCard
                                claimId={j.claim_id}
                                revenueCents={j.revenue_cents}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: string;
  color: string;
  sub?: string;
}) {
  return (
    <div className="glass-card p-4 text-center">
      <p className="font-mono text-2xl font-bold" style={{ color }}>
        {value}
      </p>
      <p className="text-xs text-[var(--gray-muted)] mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-[var(--gray-dim)] mt-0.5">{sub}</p>}
    </div>
  );
}

function FilterChip({
  active,
  label,
  onClick,
  count,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
        active
          ? "border-[var(--cyan)] bg-[var(--cyan)]/[0.08] text-white"
          : "border-[var(--border-glass)] bg-white/[0.02] text-[var(--gray)] hover:bg-white/[0.04]"
      }`}
    >
      {label}{" "}
      <span className="text-[var(--gray-muted)] font-mono">{count}</span>
    </button>
  );
}

function Sort({
  label,
  k,
  align,
  onClick,
  active,
  asc,
}: {
  label: string;
  k: SortKey;
  align?: "right";
  onClick: (k: SortKey) => void;
  active: SortKey;
  asc: boolean;
}) {
  const isActive = active === k;
  return (
    <th
      onClick={() => onClick(k)}
      className={`px-5 py-3 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider cursor-pointer select-none hover:text-white transition-colors ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive && (
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d={asc ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"}
            />
          </svg>
        )}
      </span>
    </th>
  );
}
