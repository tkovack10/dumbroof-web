"use client";

import { useEffect, useState, useCallback } from "react";

type DatePreset = "today" | "yesterday" | "last_7d" | "last_28d" | "last_30d" | "lifetime";

type Campaign = {
  id: string;
  name: string;
  objective: string;
  status: string;
  effective_status?: string;
  daily_budget_cents: number | null;
  spend_cents: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc_cents: number;
  cpm_cents: number;
  conversions: number;
  cost_per_conversion_cents: number | null;
};

type AccountSummary = {
  spend_cents: number;
  impressions: number;
  clicks: number;
  conversions: number;
};

const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const fmtNum = (n: number) => n.toLocaleString();
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "text-green-400 bg-green-500/15 border-green-500/30",
  PAUSED: "text-yellow-400 bg-yellow-500/15 border-yellow-500/30",
  ARCHIVED: "text-gray-400 bg-gray-500/15 border-gray-500/30",
  DELETED: "text-red-400 bg-red-500/15 border-red-500/30",
};

export default function MetaAdsAdminPage() {
  const [datePreset, setDatePreset] = useState<DatePreset>("last_7d");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [campRes, sumRes] = await Promise.all([
        fetch(`/api/admin/meta/campaigns?datePreset=${datePreset}`),
        fetch(`/api/admin/meta/insights?datePreset=${datePreset}`),
      ]);
      if (!campRes.ok) {
        const body = await campRes.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load campaigns (${campRes.status})`);
      }
      const campData = await campRes.json();
      setCampaigns(campData.campaigns || []);

      if (sumRes.ok) {
        const sumData = await sumRes.json();
        setSummary(sumData.summary || null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [datePreset]);

  useEffect(() => {
    load();
  }, [load]);

  const updateCampaign = async (id: string, updates: { status?: string; daily_budget_cents?: number }) => {
    setActionInProgress(id);
    try {
      const res = await fetch(`/api/admin/meta/campaigns/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Update failed (${res.status})`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setActionInProgress(null);
    }
  };

  const togglePause = async (campaign: Campaign) => {
    const newStatus = campaign.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    if (
      !confirm(
        `${newStatus === "PAUSED" ? "Pause" : "Resume"} "${campaign.name}"?\n\nThis takes effect immediately on Meta Ads.`
      )
    ) {
      return;
    }
    await updateCampaign(campaign.id, { status: newStatus });
  };

  const editBudget = async (campaign: Campaign) => {
    const currentDollars = (campaign.daily_budget_cents || 0) / 100;
    const input = prompt(
      `New daily budget for "${campaign.name}" (in dollars):\n\nCurrent: $${currentDollars}\n\nEnter just the number, e.g. 50 for $50/day.`,
      String(currentDollars || 10)
    );
    if (!input) return;
    const dollars = Number(input);
    if (!Number.isFinite(dollars) || dollars < 1) {
      setError("Budget must be a number ≥ $1");
      return;
    }
    await updateCampaign(campaign.id, { daily_budget_cents: Math.round(dollars * 100) });
  };

  return (
    <main className="min-h-screen bg-[var(--navy)] text-white">
      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Meta Ads</h1>
            <p className="text-sm text-[var(--gray-muted)] mt-1">
              One-click control over Facebook + Instagram campaigns. No more clicking through Business Manager.
            </p>
          </div>
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            className="bg-white/[0.08] border border-white/[0.1] text-white px-4 py-2 rounded-lg text-sm"
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last_7d">Last 7 days</option>
            <option value="last_28d">Last 28 days</option>
            <option value="last_30d">Last 30 days</option>
            <option value="lifetime">Lifetime</option>
          </select>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-4 text-sm text-red-300">
            <strong>Error:</strong> {error}
            <button
              onClick={() => setError(null)}
              className="ml-3 text-red-400 hover:text-white text-xs underline"
            >
              dismiss
            </button>
          </div>
        )}

        {/* Account summary */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-5">
              <div className="text-xs text-[var(--gray-muted)] uppercase tracking-wider mb-1">Spend</div>
              <div className="text-2xl font-bold">{fmtMoney(summary.spend_cents)}</div>
            </div>
            <div className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-5">
              <div className="text-xs text-[var(--gray-muted)] uppercase tracking-wider mb-1">Impressions</div>
              <div className="text-2xl font-bold">{fmtNum(summary.impressions)}</div>
            </div>
            <div className="bg-white/[0.04] border border-white/[0.1] rounded-xl p-5">
              <div className="text-xs text-[var(--gray-muted)] uppercase tracking-wider mb-1">Clicks</div>
              <div className="text-2xl font-bold">{fmtNum(summary.clicks)}</div>
            </div>
            <div className="bg-gradient-to-br from-[var(--pink)]/15 to-[var(--blue)]/15 border border-[var(--pink)]/30 rounded-xl p-5">
              <div className="text-xs text-[var(--pink)] uppercase tracking-wider mb-1">Conversions</div>
              <div className="text-2xl font-bold">{fmtNum(summary.conversions)}</div>
              {summary.conversions > 0 && (
                <div className="text-xs text-[var(--gray-muted)] mt-1">
                  {fmtMoney(Math.round(summary.spend_cents / summary.conversions))} / conv
                </div>
              )}
            </div>
          </div>
        )}

        {/* Campaigns table */}
        <div className="bg-white/[0.04] border border-white/[0.1] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.1] flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--gray-muted)]">Campaigns</h2>
            <button
              onClick={load}
              disabled={loading}
              className="text-xs text-[var(--cyan)] hover:text-white disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh →"}
            </button>
          </div>

          {loading && campaigns.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-[var(--gray-muted)]">Loading campaigns...</div>
          ) : campaigns.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-[var(--gray-muted)]">No campaigns found.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-[var(--gray-muted)] uppercase tracking-wider border-b border-white/[0.05]">
                  <th className="text-left px-5 py-3 font-semibold">Campaign</th>
                  <th className="text-left px-2 py-3 font-semibold">Status</th>
                  <th className="text-right px-2 py-3 font-semibold">Daily Budget</th>
                  <th className="text-right px-2 py-3 font-semibold">Spend</th>
                  <th className="text-right px-2 py-3 font-semibold">Clicks</th>
                  <th className="text-right px-2 py-3 font-semibold">CTR</th>
                  <th className="text-right px-2 py-3 font-semibold">Conv</th>
                  <th className="text-right px-2 py-3 font-semibold">CPA</th>
                  <th className="text-right px-5 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const isWasted = c.spend_cents >= 5000 && c.conversions === 0;
                  const busy = actionInProgress === c.id;
                  return (
                    <tr
                      key={c.id}
                      className={`border-b border-white/[0.03] hover:bg-white/[0.02] ${
                        isWasted ? "bg-red-500/5" : ""
                      }`}
                    >
                      <td className="px-5 py-3">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-[10px] text-[var(--gray-muted)]">
                          {c.objective} · {c.id}
                        </div>
                      </td>
                      <td className="px-2 py-3">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded border font-semibold uppercase ${
                            STATUS_COLOR[c.status] || STATUS_COLOR.ARCHIVED
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-right">
                        {c.daily_budget_cents ? (
                          <button
                            onClick={() => editBudget(c)}
                            disabled={busy}
                            className="text-[var(--cyan)] hover:text-white"
                          >
                            {fmtMoney(c.daily_budget_cents)}
                          </button>
                        ) : (
                          <span className="text-[var(--gray-muted)]">ad set</span>
                        )}
                      </td>
                      <td className="px-2 py-3 text-right font-mono">{fmtMoney(c.spend_cents)}</td>
                      <td className="px-2 py-3 text-right font-mono">{fmtNum(c.clicks)}</td>
                      <td className="px-2 py-3 text-right font-mono">{fmtPct(c.ctr / 100)}</td>
                      <td className="px-2 py-3 text-right font-mono">
                        <span className={c.conversions > 0 ? "text-green-400" : "text-[var(--gray-muted)]"}>
                          {c.conversions}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-right font-mono">
                        {c.cost_per_conversion_cents != null ? (
                          <span
                            className={
                              c.cost_per_conversion_cents > 5000
                                ? "text-yellow-400"
                                : c.cost_per_conversion_cents < 2500
                                ? "text-green-400"
                                : "text-white"
                            }
                          >
                            {fmtMoney(c.cost_per_conversion_cents)}
                          </span>
                        ) : (
                          <span className="text-[var(--gray-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => togglePause(c)}
                          disabled={busy}
                          className={`text-xs px-3 py-1 rounded font-semibold ${
                            c.status === "ACTIVE"
                              ? "bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300"
                              : "bg-green-500/20 hover:bg-green-500/30 text-green-300"
                          } disabled:opacity-50`}
                        >
                          {busy ? "..." : c.status === "ACTIVE" ? "Pause" : "Resume"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-xs text-[var(--gray-muted)] mt-6 text-center">
          All actions hit Meta Marketing API live. The funnel monitor reads the same data twice daily and emails you a digest.
        </p>
      </div>
    </main>
  );
}
