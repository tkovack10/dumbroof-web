"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface OverviewData {
  kpis: {
    totalClaims: number;
    totalRevenue: number;
    winRate: number;
    winCount: number;
    carrierMovement: number;
    avgClaimValue: number;
    activeReps: number;
  };
  pipeline: Record<string, number>;
  alerts: { type: string; count: number; message: string }[];
  recentActivity: {
    action: string;
    address: string;
    rep: string;
    timestamp: string;
    claimId: string;
    carrier: string | null;
  }[];
}

function fmtBigMoney(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

const pipelineStages = [
  { key: "uploaded", label: "Uploaded", color: "#3b82f6" },
  { key: "processing", label: "Processing", color: "#f59e0b" },
  { key: "ready", label: "Ready", color: "#22d8ff" },
  { key: "won", label: "Won", color: "#22c55e" },
  { key: "installation", label: "Installation", color: "#f97316" },
  { key: "completed", label: "Completed", color: "#a855f7" },
  { key: "invoiced", label: "Invoiced", color: "#14b8a6" },
  { key: "paid", label: "Paid", color: "#16a34a" },
];

const actionIcons: Record<string, { icon: string; color: string }> = {
  claim_submitted: { icon: "arrow-up", color: "var(--cyan)" },
  claim_processing: { icon: "clock", color: "var(--amber)" },
  claim_ready: { icon: "check", color: "var(--cyan)" },
  claim_won: { icon: "trophy", color: "var(--green)" },
  claim_error: { icon: "exclamation", color: "var(--red-accent)" },
};

const actionLabels: Record<string, string> = {
  claim_submitted: "Claim submitted",
  claim_processing: "Processing",
  claim_ready: "Claim ready",
  claim_won: "Claim won",
  claim_error: "Claim error",
};

function ActionIcon({ action }: { action: string }) {
  const config = actionIcons[action] || actionIcons.claim_submitted;
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
      style={{ background: `color-mix(in srgb, ${config.color} 20%, transparent)` }}
    >
      {config.icon === "arrow-up" && (
        <svg className="w-4 h-4" style={{ color: config.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
        </svg>
      )}
      {config.icon === "clock" && (
        <svg className="w-4 h-4" style={{ color: config.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )}
      {config.icon === "check" && (
        <svg className="w-4 h-4" style={{ color: config.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      )}
      {config.icon === "trophy" && (
        <svg className="w-4 h-4" style={{ color: config.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 01-3.77 1.522m0 0a6.003 6.003 0 01-3.77-1.522" />
        </svg>
      )}
      {config.icon === "exclamation" && (
        <svg className="w-4 h-4" style={{ color: config.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      )}
    </div>
  );
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchOverview() {
      try {
        const res = await fetch("/api/admin/overview");
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

    fetchOverview();
    const interval = setInterval(fetchOverview, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8">
            <div className="h-8 w-48 bg-white/[0.06] rounded-lg animate-shimmer" />
            <div className="h-4 w-72 bg-white/[0.04] rounded mt-2 animate-shimmer" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="glass-card p-5 animate-shimmer">
                <div className="h-8 w-20 bg-white/[0.06] rounded mb-2" />
                <div className="h-3 w-16 bg-white/[0.04] rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto">
          <div className="glass-card p-8 text-center">
            <p className="text-[var(--red-accent)] text-lg font-semibold mb-2">Failed to load overview</p>
            <p className="text-[var(--gray-dim)] text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { kpis, pipeline, alerts, recentActivity } = data;

  // Pipeline bar total
  const pipelineTotal = Object.values(pipeline).reduce((a, b) => a + b, 0);

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 pl-10 lg:pl-0">
          <h1 className="text-2xl font-bold gradient-text">Command Center</h1>
          <p className="text-[var(--gray-muted)] mt-1 text-sm">
            Company-wide overview and performance metrics
          </p>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          <div className="glass-card p-5 text-center">
            <p className="text-3xl font-bold gradient-text">{kpis.totalClaims}</p>
            <p className="text-xs text-[var(--gray-muted)] mt-1.5">Total Claims</p>
          </div>
          <div className="glass-card p-5 text-center">
            <p className="text-3xl font-bold gradient-text font-mono">{fmtBigMoney(kpis.totalRevenue)}</p>
            <p className="text-xs text-[var(--gray-muted)] mt-1.5">Total Revenue</p>
          </div>
          <div className="glass-card p-5 text-center">
            <p className="text-3xl font-bold text-[var(--cyan)]">
              {kpis.winRate}%
              <span className="text-base ml-1 text-[var(--green)]">({kpis.winCount})</span>
            </p>
            <p className="text-xs text-[var(--gray-muted)] mt-1.5">Win Rate</p>
          </div>
          <div className="glass-card p-5 text-center">
            <p className="text-3xl font-bold text-[var(--green)] font-mono">{fmtBigMoney(kpis.carrierMovement)}</p>
            <p className="text-xs text-[var(--gray-muted)] mt-1.5">Carrier Movement</p>
          </div>
          <div className="glass-card p-5 text-center">
            <p className="text-3xl font-bold gradient-text font-mono">{fmtBigMoney(kpis.avgClaimValue)}</p>
            <p className="text-xs text-[var(--gray-muted)] mt-1.5">Avg Claim Value</p>
          </div>
          <div className="glass-card p-5 text-center">
            <p className="text-3xl font-bold text-[var(--cyan)]">{kpis.activeReps}</p>
            <p className="text-xs text-[var(--gray-muted)] mt-1.5">Active Reps</p>
          </div>
        </div>

        {/* Pipeline Bar */}
        <div className="glass-card p-6 mb-8">
          <h2 className="text-lg font-semibold text-[var(--white)] mb-4">Pipeline</h2>
          {pipelineTotal > 0 ? (
            <>
              <div className="flex rounded-xl overflow-hidden h-10 bg-white/[0.04]">
                {pipelineStages.map((stage) => {
                  const count = pipeline[stage.key] || 0;
                  if (count === 0) return null;
                  const pct = (count / pipelineTotal) * 100;
                  return (
                    <div
                      key={stage.key}
                      className="flex items-center justify-center text-xs font-semibold text-white transition-all duration-500 relative group"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: stage.color,
                        minWidth: count > 0 ? "32px" : 0,
                      }}
                      title={`${stage.label}: ${count}`}
                    >
                      {pct > 6 && count}
                      {/* Tooltip */}
                      <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-[rgb(15,18,35)] border border-[var(--border-glass)] rounded-lg px-2.5 py-1 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        {stage.label}: {count}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4">
                {pipelineStages.map((stage) => {
                  const count = pipeline[stage.key] || 0;
                  return (
                    <div key={stage.key} className="flex items-center gap-2 text-sm">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: stage.color, opacity: count > 0 ? 1 : 0.3 }}
                      />
                      <span className={count > 0 ? "text-[var(--white)]" : "text-[var(--gray-dim)]"}>
                        {stage.label}
                      </span>
                      <span className="font-mono text-[var(--gray-muted)]">{count}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-[var(--gray-dim)] text-sm">No claims in pipeline yet.</p>
          )}
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Alerts */}
          <div>
            <h2 className="text-lg font-semibold text-[var(--white)] mb-4">Alerts</h2>
            {alerts.length > 0 ? (
              <div className="space-y-3">
                {alerts.map((alert, i) => {
                  const isRed = alert.type === "error_claims" || alert.type === "overdue_invoice";
                  const borderColor = isRed ? "var(--red-accent)" : "var(--amber)";
                  const bgColor = isRed ? "rgba(255, 90, 106, 0.08)" : "rgba(255, 194, 51, 0.08)";
                  const href =
                    alert.type === "overdue_invoice"
                      ? "/dashboard/admin/revenue"
                      : "/dashboard/admin/pipeline";

                  return (
                    <Link key={i} href={href}>
                      <div
                        className="p-4 rounded-xl border transition-colors hover:border-opacity-60 cursor-pointer"
                        style={{
                          borderColor,
                          backgroundColor: bgColor,
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: `color-mix(in srgb, ${borderColor} 20%, transparent)` }}
                          >
                            <span className="text-lg font-bold" style={{ color: borderColor }}>
                              {alert.count}
                            </span>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-[var(--white)]">{alert.message}</p>
                            <p className="text-xs text-[var(--gray-dim)] mt-0.5">Click to view details</p>
                          </div>
                          <svg className="w-4 h-4 text-[var(--gray-dim)] ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                          </svg>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="glass-card p-6 text-center">
                <svg className="w-8 h-8 text-[var(--green)] mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-[var(--green)] text-sm font-medium">All clear</p>
                <p className="text-[var(--gray-dim)] text-xs mt-1">No alerts right now</p>
              </div>
            )}
          </div>

          {/* Recent Activity */}
          <div>
            <h2 className="text-lg font-semibold text-[var(--white)] mb-4">Recent Activity</h2>
            {recentActivity.length > 0 ? (
              <div className="glass-card divide-y divide-[var(--border-glass)] max-h-[400px] overflow-y-auto">
                {recentActivity.map((activity, i) => (
                  <Link
                    key={i}
                    href={`/dashboard/claim/${activity.claimId}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors"
                  >
                    <ActionIcon action={activity.action} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--white)] truncate">
                        {activity.address}
                      </p>
                      <p className="text-xs text-[var(--gray-dim)]">
                        {actionLabels[activity.action] || activity.action}
                        {activity.carrier && (
                          <span className="ml-1.5 text-[var(--gray-muted)]">
                            &middot; {activity.carrier}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-[var(--gray-dim)]">{timeAgo(activity.timestamp)}</p>
                      <p className="text-xs text-[var(--gray-dim)] truncate max-w-[120px]">
                        {activity.rep.split("@")[0]}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="glass-card p-6 text-center">
                <p className="text-[var(--gray-dim)] text-sm">No recent activity</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
