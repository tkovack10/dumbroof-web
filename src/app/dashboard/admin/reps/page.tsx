"use client";

import { useEffect, useState, useMemo } from "react";

interface RepMetrics {
  user_id: string;
  email: string;
  claims_submitted: number;
  claims_this_month: number;
  wins: number;
  win_rate: number;
  total_rcv: number;
  avg_rcv: number;
  avg_damage_score: number | null;
  last_activity: string | null;
  needs_improvement_count: number;
}

interface Alert {
  email: string;
  type: "inactive" | "low_quality";
  message: string;
}

interface RepsData {
  reps: RepMetrics[];
  alerts: Alert[];
}

type SortKey =
  | "email"
  | "claims_submitted"
  | "claims_this_month"
  | "wins"
  | "win_rate"
  | "avg_rcv"
  | "avg_damage_score"
  | "last_activity";

function fmtMoney(val: number): string {
  if (val === 0) return "--";
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

function fmtMoneyFull(val: number): string {
  if (val === 0) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);
}

function timeAgo(timestamp: string | null): string {
  if (!timestamp) return "Never";
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function repName(email: string): string {
  const local = email.split("@")[0];
  // Capitalize first letter of each part (e.g., "mharker" -> "Mharker", "tom.kovack" -> "Tom Kovack")
  return local
    .split(/[._-]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

const medalColors = [
  { bg: "rgba(255, 215, 0, 0.15)", border: "#FFD700", text: "#FFD700", label: "1st" },
  { bg: "rgba(192, 192, 192, 0.15)", border: "#C0C0C0", text: "#C0C0C0", label: "2nd" },
  { bg: "rgba(205, 127, 50, 0.15)", border: "#CD7F32", text: "#CD7F32", label: "3rd" },
];

export default function RepsPage() {
  const [data, setData] = useState<RepsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("claims_submitted");
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    async function fetchReps() {
      try {
        const res = await fetch("/api/admin/reps");
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
    }

    fetchReps();
    const interval = setInterval(fetchReps, 30000);
    return () => clearInterval(interval);
  }, []);

  const sortedReps = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.reps];
    sorted.sort((a, b) => {
      let aVal: number | string = 0;
      let bVal: number | string = 0;

      switch (sortKey) {
        case "email":
          aVal = a.email.toLowerCase();
          bVal = b.email.toLowerCase();
          break;
        case "claims_submitted":
          aVal = a.claims_submitted;
          bVal = b.claims_submitted;
          break;
        case "claims_this_month":
          aVal = a.claims_this_month;
          bVal = b.claims_this_month;
          break;
        case "wins":
          aVal = a.wins;
          bVal = b.wins;
          break;
        case "win_rate":
          aVal = a.win_rate;
          bVal = b.win_rate;
          break;
        case "avg_rcv":
          aVal = a.avg_rcv;
          bVal = b.avg_rcv;
          break;
        case "avg_damage_score":
          aVal = a.avg_damage_score ?? -1;
          bVal = b.avg_damage_score ?? -1;
          break;
        case "last_activity":
          aVal = a.last_activity ? new Date(a.last_activity).getTime() : 0;
          bVal = b.last_activity ? new Date(b.last_activity).getTime() : 0;
          break;
      }

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortAsc ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return sorted;
  }, [data, sortKey, sortAsc]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  function SortHeader({ label, colKey, align }: { label: string; colKey: SortKey; align?: string }) {
    const isActive = sortKey === colKey;
    return (
      <th
        className={`px-5 py-3.5 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider cursor-pointer select-none hover:text-[var(--white)] transition-colors ${
          align === "right" ? "text-right" : "text-left"
        }`}
        onClick={() => handleSort(colKey)}
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
                d={sortAsc ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"}
              />
            </svg>
          )}
        </span>
      </th>
    );
  }

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8 pl-10 lg:pl-0">
            <div className="h-8 w-56 bg-white/[0.06] rounded-lg animate-shimmer" />
            <div className="h-4 w-80 bg-white/[0.04] rounded mt-2 animate-shimmer" />
          </div>
          {/* Leaderboard skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass-card p-6 animate-shimmer">
                <div className="h-6 w-32 bg-white/[0.06] rounded mb-3" />
                <div className="h-8 w-24 bg-white/[0.06] rounded mb-2" />
                <div className="h-3 w-40 bg-white/[0.04] rounded" />
              </div>
            ))}
          </div>
          {/* Stats skeleton */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass-card p-5 animate-shimmer">
                <div className="h-8 w-16 bg-white/[0.06] rounded mb-2" />
                <div className="h-3 w-24 bg-white/[0.04] rounded" />
              </div>
            ))}
          </div>
          {/* Table skeleton */}
          <div className="glass-card p-4 animate-shimmer">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 bg-white/[0.03] rounded mb-2" />
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
            <p className="text-[var(--red-accent)] text-lg font-semibold mb-2">
              Failed to load rep data
            </p>
            <p className="text-[var(--gray-dim)] text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { reps, alerts } = data;

  // Top 3 reps by total_rcv (original sort from API)
  const top3 = reps.slice(0, 3);

  // Team summary stats
  const totalActiveReps = reps.filter(
    (r) => r.claims_submitted > 0
  ).length;
  const totalClaimsThisMonth = reps.reduce(
    (sum, r) => sum + r.claims_this_month,
    0
  );
  const avgWinRate =
    reps.length > 0
      ? Math.round(reps.reduce((sum, r) => sum + r.win_rate, 0) / reps.length)
      : 0;

  // Identify reps with alerts for row highlighting
  const alertEmails = new Set(alerts.map((a) => a.email));

  return (
    <div className="p-6 lg:p-8 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 pl-10 lg:pl-0">
          <h1 className="text-2xl font-bold gradient-text">Rep Scorecard</h1>
          <p className="text-[var(--gray-muted)] mt-1 text-sm">
            Track performance, leaderboard rankings, and coaching opportunities.
          </p>
        </div>

        {/* Leaderboard - Top 3 */}
        {top3.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-[var(--white)] mb-4">Leaderboard</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {top3.map((rep, i) => {
                const medal = medalColors[i];
                return (
                  <div
                    key={rep.user_id}
                    className="rounded-xl p-6 border transition-colors"
                    style={{
                      background: medal.bg,
                      borderColor: `color-mix(in srgb, ${medal.border} 40%, transparent)`,
                    }}
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                        style={{
                          background: `color-mix(in srgb, ${medal.border} 25%, transparent)`,
                          color: medal.text,
                          border: `2px solid ${medal.border}`,
                        }}
                      >
                        {medal.label}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[var(--white)] truncate">
                          {repName(rep.email)}
                        </p>
                        <p className="text-xs text-[var(--gray-dim)] truncate">{rep.email}</p>
                      </div>
                    </div>
                    <p
                      className="text-2xl font-bold font-mono mb-3"
                      style={{ color: medal.text }}
                    >
                      {fmtMoneyFull(rep.total_rcv)}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-[var(--gray-muted)]">
                      <span>
                        <span className="text-[var(--white)] font-semibold">{rep.claims_submitted}</span>{" "}
                        claims
                      </span>
                      <span>
                        <span className="text-[var(--green)] font-semibold">{rep.wins}</span> wins
                      </span>
                      <span>
                        <span className="text-[var(--cyan)] font-semibold">{rep.win_rate}%</span> rate
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Team Summary Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="glass-card p-5 text-center">
            <p className="text-3xl font-bold text-[var(--cyan)]">{totalActiveReps}</p>
            <p className="text-xs text-[var(--gray-muted)] mt-1.5">Active Reps</p>
          </div>
          <div className="glass-card p-5 text-center">
            <p className="text-3xl font-bold gradient-text font-mono">{totalClaimsThisMonth}</p>
            <p className="text-xs text-[var(--gray-muted)] mt-1.5">Claims This Month</p>
          </div>
          <div className="glass-card p-5 text-center">
            <p className="text-3xl font-bold text-[var(--green)]">{avgWinRate}%</p>
            <p className="text-xs text-[var(--gray-muted)] mt-1.5">Avg Win Rate</p>
          </div>
        </div>

        {/* Coaching Alerts */}
        {alerts.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-[var(--white)] mb-4">Coaching Alerts</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {alerts.map((alert, i) => {
                const isRed = alert.type === "low_quality";
                const borderColor = isRed ? "var(--red-accent)" : "var(--amber)";
                const bgColor = isRed
                  ? "rgba(255, 90, 106, 0.08)"
                  : "rgba(255, 194, 51, 0.08)";

                return (
                  <div
                    key={i}
                    className="p-4 rounded-xl border"
                    style={{ borderColor, backgroundColor: bgColor }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{
                          background: `color-mix(in srgb, ${borderColor} 20%, transparent)`,
                        }}
                      >
                        {isRed ? (
                          <svg
                            className="w-4 h-4"
                            style={{ color: borderColor }}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                            />
                          </svg>
                        ) : (
                          <svg
                            className="w-4 h-4"
                            style={{ color: borderColor }}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[var(--white)]">
                          {repName(alert.email)}
                        </p>
                        <p className="text-xs" style={{ color: borderColor }}>
                          {alert.message}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Full Rep Table */}
        <div>
          <h2 className="text-lg font-semibold text-[var(--white)] mb-4">All Reps</h2>
          <div className="glass-card overflow-hidden">
            {sortedReps.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--border-glass)]">
                      <SortHeader label="Rep" colKey="email" />
                      <SortHeader label="Claims" colKey="claims_submitted" align="right" />
                      <SortHeader label="This Month" colKey="claims_this_month" align="right" />
                      <SortHeader label="Wins" colKey="wins" align="right" />
                      <SortHeader label="Win Rate" colKey="win_rate" align="right" />
                      <SortHeader label="Avg RCV" colKey="avg_rcv" align="right" />
                      <SortHeader label="Avg DS" colKey="avg_damage_score" align="right" />
                      <SortHeader label="Last Active" colKey="last_activity" align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedReps.map((rep) => {
                      const hasAlert = alertEmails.has(rep.email);
                      return (
                        <tr
                          key={rep.user_id}
                          className={`border-b border-[var(--border-glass)] transition-colors hover:bg-white/[0.03] ${
                            hasAlert ? "border-l-2 border-l-[var(--amber)]" : ""
                          }`}
                        >
                          <td className="px-5 py-3.5">
                            <div>
                              <p className="text-sm font-medium text-[var(--white)]">
                                {repName(rep.email)}
                              </p>
                              <p className="text-xs text-[var(--gray-dim)]">{rep.email}</p>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-sm text-right font-mono text-[var(--white)]">
                            {rep.claims_submitted}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-right font-mono">
                            <span
                              className={
                                rep.claims_this_month > 0
                                  ? "text-[var(--cyan)]"
                                  : "text-[var(--gray-dim)]"
                              }
                            >
                              {rep.claims_this_month}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-sm text-right font-mono">
                            <span
                              className={
                                rep.wins > 0 ? "text-[var(--green)]" : "text-[var(--gray-dim)]"
                              }
                            >
                              {rep.wins}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-sm text-right font-mono">
                            <span
                              className={
                                rep.win_rate >= 50
                                  ? "text-[var(--green)]"
                                  : rep.win_rate >= 25
                                    ? "text-[var(--amber)]"
                                    : rep.win_rate > 0
                                      ? "text-[var(--red-accent)]"
                                      : "text-[var(--gray-dim)]"
                              }
                            >
                              {rep.win_rate}%
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-sm text-right font-mono text-[var(--white)]">
                            {fmtMoney(rep.avg_rcv)}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-right font-mono">
                            {rep.avg_damage_score !== null ? (
                              <span
                                className={
                                  rep.avg_damage_score >= 70
                                    ? "text-[var(--green)]"
                                    : rep.avg_damage_score >= 50
                                      ? "text-[var(--amber)]"
                                      : "text-[var(--red-accent)]"
                                }
                              >
                                {rep.avg_damage_score}
                              </span>
                            ) : (
                              <span className="text-[var(--gray-dim)]">--</span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-right text-[var(--gray-muted)]">
                            {timeAgo(rep.last_activity)}
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
                  className="w-12 h-12 text-[var(--gray-dim)] mx-auto mb-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
                  />
                </svg>
                <p className="text-lg font-semibold text-[var(--white)] mb-1">No reps found</p>
                <p className="text-sm text-[var(--gray-dim)]">
                  Team members will appear here once they submit claims.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
