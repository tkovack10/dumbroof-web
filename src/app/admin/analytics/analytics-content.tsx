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

interface InsightsData {
  funnel_30d: {
    signups: number;
    with_profile: number;
    profile_complete: number;
    with_claim: number;
    paid: number;
  } | null;
  attribution_30d: Array<{
    utm_content: string;
    utm_campaign: string;
    signups: number;
    with_claim: number;
    paid: number;
  }>;
  quality_breakdown: Array<{
    email_quality: string;
    industry_match: string;
    profiles: number;
    with_claim: number;
  }>;
  cohort_retention: Array<{
    week_start: string;
    signups: number;
    returned_wk1: number;
    returned_wk2: number;
    returned_wk3plus: number;
  }>;
  whoops_funnel_30d: {
    whoops_attributed_signups: number;
    with_claim: number;
    paid: number;
  } | null;
  daily_signups_30d: Array<{ day: string; signups: number }>;
  quality_timeline_30d: Array<{
    day: string;
    gold: number;
    biz_other: number;
    consumer_roofer: number;
    consumer_other: number;
  }>;
  nurture_replies: Array<{
    id: string;
    from_email: string;
    subject: string | null;
    matched_touch: string | null;
    opted_out: boolean;
    body_excerpt: string;
    created_et: string;
    user_matched: boolean;
  }>;
  cron_health: Array<{
    cron_name: string;
    last_ran_et: string;
    last_status: string;
    last_duration_ms: number | null;
    last_summary: string | null;
    expected_interval_minutes: number;
    consecutive_failures: number;
    minutes_since_last_run: number;
    health: "healthy" | "stale" | "failing" | "last_errored" | "skipped";
  }>;
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
  const [insights, setInsights] = useState<InsightsData | null>(null);
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

  const fetchInsights = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/analytics/insights");
      if (!res.ok) return;
      setInsights(await res.json());
    } catch {
      // non-fatal — insights are supplementary
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchInsights();
    const liveInterval = setInterval(fetchData, 30000);
    const insightsInterval = setInterval(fetchInsights, 5 * 60 * 1000);
    return () => {
      clearInterval(liveInterval);
      clearInterval(insightsInterval);
    };
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

      {/* 30-day Funnel */}
      {insights?.funnel_30d && (
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-[var(--white)]">30-Day Acquisition Funnel</h2>
            <span className="text-[10px] text-[var(--gray-dim)]">From auth.users + company_profiles + claims + subscriptions</span>
          </div>
          {(() => {
            const f = insights.funnel_30d;
            const stages = [
              { label: "Signups", value: f.signups, prev: f.signups },
              { label: "Built profile", value: f.with_profile, prev: f.signups },
              { label: "Completed profile", value: f.profile_complete, prev: f.with_profile },
              { label: "Created a claim", value: f.with_claim, prev: f.profile_complete },
              { label: "Active subscription", value: f.paid, prev: f.with_claim },
            ];
            return (
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {stages.map((s, i) => {
                  const pct = s.prev > 0 ? Math.round((s.value / s.prev) * 100) : 0;
                  const dropPct = s.prev > 0 ? Math.round(((s.prev - s.value) / s.prev) * 100) : 0;
                  const overall = f.signups > 0 ? Math.round((s.value / f.signups) * 100) : 0;
                  return (
                    <div key={s.label} className="rounded-xl bg-white/[0.03] border border-white/10 p-4">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--gray-muted)] mb-1">Step {i + 1}</p>
                      <p className="text-3xl font-bold text-[var(--white)]">{s.value}</p>
                      <p className="text-xs text-[var(--gray-muted)] mt-1">{s.label}</p>
                      {i > 0 && (
                        <p className="text-[10px] text-[var(--gray-dim)] mt-2">
                          {pct}% of prev · <span className={dropPct > 50 ? "text-red-400" : "text-amber-400"}>−{dropPct}% drop</span>
                        </p>
                      )}
                      <p className="text-[10px] text-[var(--cyan)] mt-1">{overall}% of signups</p>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Ad attribution + Whoops-specific funnel side-by-side */}
      {(insights?.attribution_30d?.length || insights?.whoops_funnel_30d) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-[var(--white)]">Ad Attribution (30d)</h2>
              <span className="text-[10px] text-[var(--gray-dim)]">By utm_content · Supabase-attributed only</span>
            </div>
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">
                    <th className="px-2 py-2 font-semibold">Ad / Content</th>
                    <th className="px-2 py-2 font-semibold text-right">Signups</th>
                    <th className="px-2 py-2 font-semibold text-right">With Claim</th>
                    <th className="px-2 py-2 font-semibold text-right">Paid</th>
                    <th className="px-2 py-2 font-semibold text-right">Sign→Claim</th>
                  </tr>
                </thead>
                <tbody>
                  {(insights.attribution_30d ?? []).map((row, i) => {
                    const sToC = row.signups > 0 ? Math.round((row.with_claim / row.signups) * 100) : 0;
                    return (
                      <tr key={i} className="border-t border-white/[0.04]">
                        <td className="px-2 py-2 text-[var(--white)] truncate max-w-[280px]" title={row.utm_content}>
                          {row.utm_content}
                          <span className="block text-[10px] text-[var(--gray-dim)] truncate">{row.utm_campaign}</span>
                        </td>
                        <td className="px-2 py-2 text-right text-[var(--white)] font-mono">{row.signups}</td>
                        <td className="px-2 py-2 text-right text-[var(--white)] font-mono">{row.with_claim}</td>
                        <td className="px-2 py-2 text-right text-[var(--white)] font-mono">{row.paid}</td>
                        <td className={`px-2 py-2 text-right font-mono ${sToC >= 30 ? "text-green-400" : sToC >= 10 ? "text-amber-400" : "text-red-400"}`}>
                          {sToC}%
                        </td>
                      </tr>
                    );
                  })}
                  {(insights.attribution_30d ?? []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-6 text-center text-[var(--gray-dim)] text-[11px]">
                        No UTM-attributed signups yet in this window. (UTM capture went live 2026-05-15.)
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {insights?.whoops_funnel_30d && (
            <div className="glass-card p-6">
              <h2 className="text-sm font-bold text-[var(--white)] mb-3">Whoops Ad Funnel (30d)</h2>
              <p className="text-[10px] text-[var(--gray-dim)] mb-4">Where the $900/day is going</p>
              <div className="space-y-3">
                {[
                  { label: "Attributed signups", value: insights.whoops_funnel_30d.whoops_attributed_signups, base: insights.whoops_funnel_30d.whoops_attributed_signups },
                  { label: "Created claim", value: insights.whoops_funnel_30d.with_claim, base: insights.whoops_funnel_30d.whoops_attributed_signups },
                  { label: "Paid subscription", value: insights.whoops_funnel_30d.paid, base: insights.whoops_funnel_30d.whoops_attributed_signups },
                ].map((s) => {
                  const pct = s.base > 0 ? Math.round((s.value / s.base) * 100) : 0;
                  return (
                    <div key={s.label}>
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs text-[var(--gray)]">{s.label}</span>
                        <span className="text-sm font-bold text-[var(--white)]">{s.value} <span className="text-[10px] text-[var(--gray-dim)]">({pct}%)</span></span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-[var(--cyan)] to-[var(--purple)]" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quality breakdown + Cohort retention side-by-side */}
      {(insights?.quality_breakdown?.length || insights?.cohort_retention?.length) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {insights?.quality_breakdown?.length ? (
            <div className="glass-card p-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-[var(--white)]">Signup Quality (60d)</h2>
                <span className="text-[10px] text-[var(--gray-dim)]">Email type × industry match</span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">
                    <th className="px-2 py-2 font-semibold">Email</th>
                    <th className="px-2 py-2 font-semibold">Industry</th>
                    <th className="px-2 py-2 font-semibold text-right">Profiles</th>
                    <th className="px-2 py-2 font-semibold text-right">With Claim</th>
                    <th className="px-2 py-2 font-semibold text-right">Activation</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.quality_breakdown.map((row, i) => {
                    const isGold = row.email_quality === "business" && row.industry_match === "roofing_storm";
                    const activation = row.profiles > 0 ? Math.round((row.with_claim / row.profiles) * 100) : 0;
                    return (
                      <tr key={i} className={`border-t border-white/[0.04] ${isGold ? "bg-amber-500/[0.05]" : ""}`}>
                        <td className="px-2 py-2 text-[var(--white)]">{row.email_quality === "business" ? "🏢 Business" : row.email_quality === "consumer" ? "📧 Consumer" : row.email_quality}</td>
                        <td className="px-2 py-2 text-[var(--white)]">{row.industry_match === "roofing_storm" ? "🎯 Roofer" : row.industry_match}</td>
                        <td className="px-2 py-2 text-right text-[var(--white)] font-mono">{row.profiles}</td>
                        <td className="px-2 py-2 text-right text-[var(--white)] font-mono">{row.with_claim}</td>
                        <td className={`px-2 py-2 text-right font-mono ${activation >= 30 ? "text-green-400" : activation >= 10 ? "text-amber-400" : "text-red-400"}`}>{activation}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {insights?.cohort_retention?.length ? (
            <div className="glass-card p-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-[var(--white)]">Cohort Retention (8wk)</h2>
                <span className="text-[10px] text-[var(--gray-dim)]">% returned = created claim in window</span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">
                    <th className="px-2 py-2 font-semibold">Signup Week</th>
                    <th className="px-2 py-2 font-semibold text-right">Cohort</th>
                    <th className="px-2 py-2 font-semibold text-right">Wk1</th>
                    <th className="px-2 py-2 font-semibold text-right">Wk2</th>
                    <th className="px-2 py-2 font-semibold text-right">Wk3+</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.cohort_retention.map((row, i) => {
                    const pct = (n: number) => row.signups > 0 ? Math.round((n / row.signups) * 100) : 0;
                    return (
                      <tr key={i} className="border-t border-white/[0.04]">
                        <td className="px-2 py-2 text-[var(--white)] font-mono">{row.week_start.slice(5)}</td>
                        <td className="px-2 py-2 text-right text-[var(--white)] font-mono">{row.signups}</td>
                        <td className="px-2 py-2 text-right font-mono text-[var(--cyan)]">{pct(row.returned_wk1)}%</td>
                        <td className="px-2 py-2 text-right font-mono text-[var(--purple)]">{pct(row.returned_wk2)}%</td>
                        <td className="px-2 py-2 text-right font-mono text-[var(--pink)]">{pct(row.returned_wk3plus)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}

      {/* Nurture replies + Cron health side-by-side */}
      {(insights?.nurture_replies?.length || insights?.cron_health?.length) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Nurture replies feed — high-intent inbound */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-[var(--white)]">Recent Nurture Replies</h2>
              <span className="text-[10px] text-[var(--gray-dim)]">High-intent inbound · auto opt-out</span>
            </div>
            {insights?.nurture_replies?.length ? (
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-2 -mr-2">
                {insights.nurture_replies.map((r) => (
                  <div key={r.id} className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[var(--white)] font-medium truncate" title={r.from_email}>
                        {r.from_email}
                      </span>
                      <span className="text-[10px] text-[var(--gray-dim)] whitespace-nowrap ml-2">{r.created_et}</span>
                    </div>
                    {r.subject && (
                      <p className="text-[var(--gray)] truncate mb-1" title={r.subject}>{r.subject}</p>
                    )}
                    {r.body_excerpt && (
                      <p className="text-[10px] text-[var(--gray-muted)] line-clamp-2">{r.body_excerpt}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 text-[10px]">
                      {r.matched_touch && (
                        <span className="px-2 py-0.5 rounded-full bg-[var(--purple)]/10 text-[var(--purple)] border border-[var(--purple)]/20">
                          {r.matched_touch}
                        </span>
                      )}
                      {r.opted_out ? (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">opted out</span>
                      ) : !r.user_matched ? (
                        <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">no user match</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-xs text-[var(--gray-dim)]">No replies yet.</p>
                <p className="text-[10px] text-[var(--gray-muted)] mt-2">Wire NURTURE_INBOUND_SECRET + forwarder<br/>(see /api/webhooks/nurture-reply header docs)</p>
              </div>
            )}
          </div>

          {/* Cron health */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-[var(--white)]">Cron Health</h2>
              <span className="text-[10px] text-[var(--gray-dim)]">Self-reported heartbeats</span>
            </div>
            {insights?.cron_health?.length ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">
                    <th className="px-2 py-2 font-semibold">Cron</th>
                    <th className="px-2 py-2 font-semibold">Last Run</th>
                    <th className="px-2 py-2 font-semibold">Stale</th>
                    <th className="px-2 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.cron_health.map((c) => {
                    const color =
                      c.health === "healthy" ? "text-green-400" :
                      c.health === "skipped" ? "text-[var(--gray-muted)]" :
                      c.health === "last_errored" ? "text-amber-400" :
                      "text-red-400";
                    const dot =
                      c.health === "healthy" ? "bg-green-400" :
                      c.health === "skipped" ? "bg-gray-400" :
                      c.health === "last_errored" ? "bg-amber-400" :
                      "bg-red-400";
                    const staleLabel = c.minutes_since_last_run < 60
                      ? `${c.minutes_since_last_run}m`
                      : c.minutes_since_last_run < 1440
                      ? `${Math.round(c.minutes_since_last_run / 60)}h`
                      : `${Math.round(c.minutes_since_last_run / 1440)}d`;
                    return (
                      <tr key={c.cron_name} className="border-t border-white/[0.04]" title={c.last_summary || ""}>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            <span className={`inline-block w-2 h-2 rounded-full ${dot}`}></span>
                            <span className="text-[var(--white)] font-mono text-[11px]">{c.cron_name}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-[10px] text-[var(--gray-dim)] font-mono whitespace-nowrap">{c.last_ran_et}</td>
                        <td className={`px-2 py-2 font-mono text-[11px] ${color}`}>{staleLabel}</td>
                        <td className={`px-2 py-2 text-[11px] ${color}`}>
                          {c.health}
                          {c.consecutive_failures > 0 && <span className="text-[10px] text-red-400 ml-1">×{c.consecutive_failures}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-8">
                <p className="text-xs text-[var(--gray-dim)]">No heartbeats recorded yet.</p>
                <p className="text-[10px] text-[var(--gray-muted)] mt-2">Crons report on each run. Wait for the next scheduled fire.</p>
              </div>
            )}
          </div>
        </div>
      )}

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
