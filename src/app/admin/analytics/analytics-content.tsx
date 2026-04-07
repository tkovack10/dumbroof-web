"use client";

import { useEffect, useState, useCallback } from "react";

interface LiveData {
  timestamp: string;
  users: {
    total: number;
    today: number;
    last7d: number;
    recent: { email: string; ts: string }[];
  };
  claims: {
    total: number;
    today: number;
    last7d: number;
    activeUsers24h: number;
    recent: { id: string; address: string; status: string; created_at: string }[];
  };
  billing: {
    planCounts: Record<string, number>;
    totalSubscriptions: number;
  };
  aob: {
    today: number;
  };
}

const PLAN_LABELS: Record<string, string> = {
  starter: "Starter (Free)",
  sales_rep: "Sales Rep",
  pro: "Company",
  growth: "Growth",
  enterprise: "Max",
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function LiveAnalyticsContent() {
  const [data, setData] = useState<LiveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [prevData, setPrevData] = useState<LiveData | null>(null);
  const [signupSearch, setSignupSearch] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/live");
      if (!res.ok) throw new Error("Failed to load");
      const d = await res.json();
      setPrevData(data);
      setData(d);
      setLastRefresh(new Date());
      setError(null);
    } catch {
      setError("Failed to load analytics");
    }
  }, [data]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = (curr: number, prev: number | undefined) => {
    if (prev === undefined || prev === curr) return null;
    return curr > prev ? "up" : "down";
  };

  if (!data) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-white/5 rounded" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-32 bg-white/5 rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--white)]">Live Analytics</h1>
          <p className="text-xs text-[var(--gray-muted)]">
            Auto-refreshes every 30 seconds
            {lastRefresh && <> &middot; Last updated {lastRefresh.toLocaleTimeString()}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
          </span>
          <span className="text-xs text-green-400 font-semibold">LIVE</span>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">{error}</div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: "Total Users", value: data.users.total, prev: prevData?.users.total, color: "blue" },
          { label: "Signups Today", value: data.users.today, prev: prevData?.users.today, color: "green" },
          { label: "Signups (7d)", value: data.users.last7d, prev: prevData?.users.last7d, color: "cyan" },
          { label: "Claims Today", value: data.claims.today, prev: prevData?.claims.today, color: "pink" },
          { label: "Claims (7d)", value: data.claims.last7d, prev: prevData?.claims.last7d, color: "purple" },
          { label: "AOBs Today", value: data.aob.today, prev: prevData?.aob.today, color: "amber" },
        ].map((kpi) => {
          const delta = changed(kpi.value, kpi.prev);
          return (
            <div key={kpi.label} className="glass-card p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--gray-muted)] mb-1">{kpi.label}</p>
              <div className="flex items-end gap-2">
                <span className={`text-3xl font-bold ${delta === "up" ? "text-green-400" : `text-[var(--${kpi.color})]`}`}>
                  {kpi.value}
                </span>
                {delta === "up" && (
                  <span className="text-green-400 text-xs font-bold mb-1 animate-bounce">+{kpi.value - (kpi.prev ?? 0)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* All Signups */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-[var(--white)]">All Signups</h2>
            <span className="text-[10px] text-[var(--gray-dim)]">
              {(() => {
                const filtered = data.users.recent.filter((u) =>
                  u.email.toLowerCase().includes(signupSearch.toLowerCase())
                );
                return signupSearch
                  ? `${filtered.length} of ${data.users.total}`
                  : `${data.users.recent.length} of ${data.users.total}`;
              })()}
            </span>
          </div>
          <input
            type="text"
            value={signupSearch}
            onChange={(e) => setSignupSearch(e.target.value)}
            placeholder="Search by email…"
            className="w-full mb-3 px-3 py-2 text-sm rounded-lg bg-white/[0.03] border border-white/10 text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:outline-none focus:border-[var(--cyan)]"
          />
          <div className="space-y-1 max-h-[480px] overflow-y-auto pr-2 -mr-2">
            {data.users.recent.length === 0 ? (
              <p className="text-xs text-[var(--gray-dim)]">No signups yet</p>
            ) : (
              data.users.recent
                .filter((u) => u.email.toLowerCase().includes(signupSearch.toLowerCase()))
                .map((u, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[var(--white)] font-medium truncate">{u.email}</p>
                    </div>
                    <span className="text-[10px] text-[var(--gray-dim)] whitespace-nowrap ml-2">{timeAgo(u.ts)}</span>
                  </div>
                ))
            )}
          </div>
        </div>

        {/* Recent Claims */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-[var(--white)]">Recent Claims</h2>
            <span className="text-[10px] text-[var(--gray-dim)]">{data.claims.total} total</span>
          </div>
          <div className="space-y-2">
            {data.claims.recent.length === 0 ? (
              <p className="text-xs text-[var(--gray-dim)]">No claims yet</p>
            ) : (
              data.claims.recent.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                  <div>
                    <p className="text-sm text-[var(--white)] font-medium">{c.address || "No address"}</p>
                    <p className="text-[10px] text-[var(--gray-dim)]">{c.status}</p>
                  </div>
                  <span className="text-[10px] text-[var(--gray-dim)] whitespace-nowrap">{timeAgo(c.created_at)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Subscriptions breakdown */}
      <div className="glass-card p-6">
        <h2 className="text-sm font-bold text-[var(--white)] mb-4">Active Subscriptions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {Object.entries(PLAN_LABELS).map(([planId, label]) => {
            const count = data.billing.planCounts[planId] || 0;
            return (
              <div key={planId} className="rounded-xl bg-white/[0.03] border border-white/10 p-3 text-center">
                <p className="text-2xl font-bold text-[var(--white)]">{count}</p>
                <p className="text-[10px] text-[var(--gray-muted)]">{label}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Social Media Accounts */}
      <div className="glass-card p-6">
        <h2 className="text-sm font-bold text-[var(--white)] mb-4">Social Media</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Facebook", url: "https://www.facebook.com/profile.php?id=61574348498498", color: "blue", icon: "f" },
            { label: "Instagram", url: "https://www.instagram.com/dumbroof.ai/", color: "pink", icon: "ig" },
            { label: "X / Twitter", url: "https://x.com/DumbRoofAI", color: "white", icon: "x" },
            { label: "TikTok", url: "https://www.tiktok.com/@dumbroof.ai", color: "cyan", icon: "tt" },
          ].map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl bg-white/[0.03] border border-white/10 p-4 text-center hover:bg-white/[0.06] transition-colors group"
            >
              <p className={`text-lg font-bold text-[var(--${link.color})] group-hover:scale-110 transition-transform`}>{link.label}</p>
              <p className="text-[10px] text-[var(--gray-dim)] mt-1">@dumbroof.ai &rarr;</p>
            </a>
          ))}
        </div>
      </div>

      {/* External Dashboards */}
      <div className="glass-card p-6">
        <h2 className="text-sm font-bold text-[var(--white)] mb-4">External Dashboards</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "GA4 Realtime", url: "https://analytics.google.com/analytics/web/#/a389826484p531121188/realtime/overview", color: "amber" },
            { label: "Vercel Analytics", url: "https://vercel.com/tkovack10s-projects/dumbroof-web/analytics", color: "white" },
            { label: "Meta Ads Manager", url: "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1290509309613066", color: "blue" },
            { label: "Stripe Dashboard", url: "https://dashboard.stripe.com", color: "purple" },
          ].map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl bg-white/[0.03] border border-white/10 p-4 text-center hover:bg-white/[0.06] transition-colors"
            >
              <p className={`text-sm font-semibold text-[var(--${link.color})]`}>{link.label}</p>
              <p className="text-[10px] text-[var(--gray-dim)] mt-1">Open &rarr;</p>
            </a>
          ))}
        </div>
      </div>

      <p className="text-center text-[10px] text-[var(--gray-dim)]">
        Data from Supabase &middot; GA4 &amp; Meta Pixel tracked client-side &middot; Polls every 30s
      </p>
    </div>
  );
}
