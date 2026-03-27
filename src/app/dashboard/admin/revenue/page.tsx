"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface AgingBucket {
  count: number;
  total: number;
}

interface MonthlyRow {
  month: string;
  revenue: number;
  collected: number;
  claims_won: number;
  total_claims: number;
}

interface OutstandingInvoice {
  id: string;
  invoice_number: string;
  claim_id: string;
  address: string;
  carrier: string | null;
  amount_due: number;
  days_outstanding: number;
  status: string;
  sent_at: string | null;
  created_at: string;
  due_date: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
}

interface RevenueData {
  invoices: OutstandingInvoice[];
  aging: {
    current: AgingBucket;
    days_30: AgingBucket;
    days_60: AgingBucket;
    days_90: AgingBucket;
  };
  monthly: MonthlyRow[];
  totals: {
    total_invoiced: number;
    total_collected: number;
    total_outstanding: number;
    collection_rate: number;
  };
}

function fmtMoney(val: number): string {
  if (val === 0) return "$0";
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function fmtMoneyFull(val: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);
}

function fmtMonth(month: string): string {
  const [year, m] = month.split("-");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[parseInt(m, 10) - 1]} ${year}`;
}

export default function RevenuePage() {
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);
  const router = useRouter();

  const fetchRevenue = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/revenue");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRevenue();
    const interval = setInterval(fetchRevenue, 60000);
    return () => clearInterval(interval);
  }, [fetchRevenue]);

  async function handleMarkPaid(invoiceId: string) {
    setMarkingPaid(invoiceId);
    try {
      const res = await fetch("/api/invoices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: invoiceId, status: "paid" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to update");
      }
      // Refresh data
      await fetchRevenue();
    } catch (err) {
      console.error("Failed to mark paid:", err);
    } finally {
      setMarkingPaid(null);
    }
  }

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8 pl-10 lg:pl-0">
            <div className="h-8 w-48 bg-white/[0.06] rounded-lg animate-shimmer" />
            <div className="h-4 w-72 bg-white/[0.04] rounded mt-2 animate-shimmer" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass-card p-6 animate-shimmer">
                <div className="h-8 w-24 bg-white/[0.06] rounded mb-2" />
                <div className="h-3 w-20 bg-white/[0.04] rounded" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass-card p-5 animate-shimmer">
                <div className="h-6 w-16 bg-white/[0.06] rounded mb-2" />
                <div className="h-3 w-24 bg-white/[0.04] rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="glass-card p-8 text-center">
            <p className="text-[var(--red-accent)] text-lg font-semibold mb-2">Failed to load revenue data</p>
            <p className="text-[var(--gray-dim)] text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { aging, monthly, totals, invoices } = data;

  const agingBuckets: {
    key: keyof typeof aging;
    label: string;
    sublabel: string;
    color: string;
    bgColor: string;
  }[] = [
    { key: "current", label: "Current", sublabel: "0-30 days", color: "var(--green)", bgColor: "rgba(0, 242, 125, 0.12)" },
    { key: "days_30", label: "31-60 Days", sublabel: "Aging", color: "var(--amber)", bgColor: "rgba(255, 194, 51, 0.12)" },
    { key: "days_60", label: "61-90 Days", sublabel: "Overdue", color: "#f97316", bgColor: "rgba(249, 115, 22, 0.12)" },
    { key: "days_90", label: "90+ Days", sublabel: "Critical", color: "var(--red-accent)", bgColor: "rgba(255, 90, 106, 0.12)" },
  ];

  return (
    <div className="p-6 lg:p-8 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 pl-10 lg:pl-0">
          <h1 className="text-2xl font-bold gradient-text">Revenue &amp; A/R</h1>
          <p className="text-[var(--gray-muted)] mt-1 text-sm">
            Invoicing, accounts receivable, and revenue tracking.
          </p>
        </div>

        {/* Top Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="glass-card p-6 text-center">
            <p className="text-3xl font-bold gradient-text font-mono">
              {fmtMoney(totals.total_invoiced)}
            </p>
            <p className="text-xs text-[var(--gray-muted)] mt-2">Total Invoiced</p>
          </div>
          <div className="glass-card p-6 text-center">
            <p className="text-3xl font-bold text-[var(--green)] font-mono">
              {fmtMoney(totals.total_collected)}
            </p>
            <p className="text-xs text-[var(--gray-muted)] mt-2">Total Collected</p>
          </div>
          <div className="glass-card p-6 text-center">
            <p className="text-3xl font-bold text-[var(--amber)] font-mono">
              {fmtMoney(totals.total_outstanding)}
            </p>
            <p className="text-xs text-[var(--gray-muted)] mt-2">Outstanding</p>
          </div>
          <div className="glass-card p-6 text-center">
            <p className="text-3xl font-bold text-[var(--cyan)] font-mono">
              {totals.collection_rate}%
            </p>
            <p className="text-xs text-[var(--gray-muted)] mt-2">Collection Rate</p>
          </div>
        </div>

        {/* A/R Aging Section */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-[var(--white)] mb-4">A/R Aging</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {agingBuckets.map((bucket) => {
              const bucketData = aging[bucket.key];
              return (
                <div
                  key={bucket.key}
                  className="rounded-xl p-5 border transition-colors"
                  style={{
                    background: bucket.bgColor,
                    borderColor: `color-mix(in srgb, ${bucket.color} 30%, transparent)`,
                  }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold" style={{ color: bucket.color }}>
                      {bucket.label}
                    </span>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{
                        background: `color-mix(in srgb, ${bucket.color} 20%, transparent)`,
                        color: bucket.color,
                      }}
                    >
                      {bucketData.count}
                    </span>
                  </div>
                  <p className="text-2xl font-bold font-mono text-[var(--white)]">
                    {fmtMoneyFull(bucketData.total)}
                  </p>
                  <p className="text-xs mt-1" style={{ color: bucket.color, opacity: 0.7 }}>
                    {bucket.sublabel}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Monthly Revenue Table */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-[var(--white)] mb-4">Monthly Revenue</h2>
          <div className="glass-card overflow-hidden">
            {monthly.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--border-glass)]">
                      <th className="text-left px-5 py-3.5 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider">
                        Month
                      </th>
                      <th className="text-right px-5 py-3.5 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider">
                        Claims
                      </th>
                      <th className="text-right px-5 py-3.5 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider">
                        Won
                      </th>
                      <th className="text-right px-5 py-3.5 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider">
                        Revenue (RCV)
                      </th>
                      <th className="text-right px-5 py-3.5 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider">
                        Collected
                      </th>
                      <th className="text-right px-5 py-3.5 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider">
                        Outstanding
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthly.map((row, i) => {
                      const outstanding = Math.max(0, row.revenue - row.collected);
                      return (
                        <tr
                          key={row.month}
                          className={`border-b border-[var(--border-glass)] transition-colors hover:bg-white/[0.03] ${
                            i === 0 ? "bg-white/[0.02]" : ""
                          }`}
                        >
                          <td className="px-5 py-3.5 text-sm font-medium text-[var(--white)]">
                            {fmtMonth(row.month)}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-right text-[var(--gray)] font-mono">
                            {row.total_claims}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-right font-mono">
                            <span className={row.claims_won > 0 ? "text-[var(--green)]" : "text-[var(--gray-dim)]"}>
                              {row.claims_won}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-sm text-right font-mono text-[var(--white)]">
                            {fmtMoneyFull(row.revenue)}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-right font-mono text-[var(--green)]">
                            {fmtMoneyFull(row.collected)}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-right font-mono">
                            <span className={outstanding > 0 ? "text-[var(--amber)]" : "text-[var(--gray-dim)]"}>
                              {fmtMoneyFull(outstanding)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center">
                <p className="text-[var(--gray-dim)] text-sm">No monthly data yet.</p>
              </div>
            )}
          </div>
        </div>

        {/* Outstanding Invoices */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[var(--white)]">Outstanding Invoices</h2>
            {invoices.length > 0 && (
              <span className="text-sm text-[var(--gray-muted)] font-mono">
                {invoices.length} unpaid
              </span>
            )}
          </div>
          <div className="glass-card overflow-hidden">
            {invoices.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--border-glass)]">
                      <th className="text-left px-5 py-3.5 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider">
                        Invoice #
                      </th>
                      <th className="text-left px-5 py-3.5 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider">
                        Address
                      </th>
                      <th className="text-left px-5 py-3.5 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider">
                        Carrier
                      </th>
                      <th className="text-right px-5 py-3.5 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider">
                        Amount Due
                      </th>
                      <th className="text-right px-5 py-3.5 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider">
                        Days Out
                      </th>
                      <th className="text-center px-5 py-3.5 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider">
                        Status
                      </th>
                      <th className="text-center px-5 py-3.5 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => {
                      const isOverdue = inv.days_outstanding > 30;
                      const isCritical = inv.days_outstanding > 90;

                      return (
                        <tr
                          key={inv.id}
                          className="border-b border-[var(--border-glass)] transition-colors hover:bg-white/[0.03]"
                        >
                          <td className="px-5 py-3.5">
                            <span className="text-sm font-mono text-[var(--cyan)]">
                              {inv.invoice_number}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <button
                              onClick={() => router.push(`/dashboard/claim/${inv.claim_id}`)}
                              className="text-sm text-[var(--white)] hover:text-[var(--cyan)] transition-colors text-left truncate max-w-[200px] block"
                            >
                              {inv.address}
                            </button>
                          </td>
                          <td className="px-5 py-3.5 text-sm text-[var(--gray-muted)] truncate max-w-[140px]">
                            {inv.carrier || "--"}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-right font-mono font-semibold text-[var(--white)]">
                            {fmtMoneyFull(inv.amount_due)}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-right font-mono">
                            <span
                              className={
                                isCritical
                                  ? "text-[var(--red-accent)]"
                                  : isOverdue
                                    ? "text-[var(--amber)]"
                                    : "text-[var(--gray)]"
                              }
                            >
                              {inv.days_outstanding}d
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-center">
                            <span
                              className="text-xs px-2.5 py-1 rounded-full font-medium inline-block"
                              style={{
                                background: isCritical
                                  ? "rgba(255, 90, 106, 0.15)"
                                  : isOverdue
                                    ? "rgba(255, 194, 51, 0.15)"
                                    : "rgba(0, 242, 125, 0.15)",
                                color: isCritical
                                  ? "var(--red-accent)"
                                  : isOverdue
                                    ? "var(--amber)"
                                    : "var(--green)",
                              }}
                            >
                              {inv.status}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-center">
                            <button
                              onClick={() => handleMarkPaid(inv.id)}
                              disabled={markingPaid === inv.id}
                              className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all disabled:opacity-50"
                              style={{
                                background: "rgba(0, 242, 125, 0.12)",
                                color: "var(--green)",
                                border: "1px solid rgba(0, 242, 125, 0.2)",
                              }}
                            >
                              {markingPaid === inv.id ? (
                                <span className="flex items-center gap-1.5">
                                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                  Updating
                                </span>
                              ) : (
                                "Mark Paid"
                              )}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center">
                <svg
                  className="w-10 h-10 text-[var(--green)] mx-auto mb-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-[var(--green)] text-sm font-medium">All invoices paid</p>
                <p className="text-[var(--gray-dim)] text-xs mt-1">
                  No outstanding invoices right now.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
