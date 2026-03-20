"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface CarrierWinRate {
  carrier: string;
  total_claims: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  avg_win_movement_pct: number;
  avg_win_movement_dollars: number;
  avg_usarm_rcv: number;
}

interface PricingComparison {
  description: string;
  unit: string;
  region: string;
  avg_usarm_price: number;
  avg_carrier_price: number;
  price_gap: number;
  usarm_count: number;
  carrier_count: number;
}

interface PhotoDamage {
  damage_type: string;
  material: string;
  trade: string;
  photo_count: number;
  avg_fraud_score: number;
}

interface EffectiveArgument {
  carrier: string;
  tactic_type: string;
  counter_argument: string;
  times_used: number;
  times_effective: number;
  effectiveness_pct: number;
  avg_dollar_impact: number;
}

interface ClaimOutcome {
  id: string;
  claim_id: string | null;
  carrier: string;
  usarm_rcv: number;
  original_carrier_rcv: number;
  current_carrier_rcv: number;
  movement_amount: number;
  movement_pct: number;
  win: boolean;
  slug: string;
}

function fmtMoney(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

function winRateColor(rate: number): string {
  if (rate >= 50) return "#16a34a";
  if (rate >= 25) return "#d97706";
  return "#dc2626";
}

function winRateBadge(rate: number): string {
  if (rate >= 50) return "bg-green-100 text-green-700";
  if (rate >= 25) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

export function AnalyticsContent({ user }: { user: User }) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [carriers, setCarriers] = useState<CarrierWinRate[]>([]);
  const [pricing, setPricing] = useState<PricingComparison[]>([]);
  const [photos, setPhotos] = useState<PhotoDamage[]>([]);
  const [arguments_, setArguments] = useState<EffectiveArgument[]>([]);
  const [outcomes, setOutcomes] = useState<ClaimOutcome[]>([]);

  useEffect(() => {
    async function fetchAll() {
      try {
        const [carrierRes, pricingRes, photoRes, argsRes, outcomesRes] =
          await Promise.all([
            supabase.from("carrier_win_rates").select("*"),
            supabase
              .from("pricing_comparison")
              .select("*")
              .order("price_gap", { ascending: false })
              .limit(25),
            supabase.from("photo_damage_distribution").select("*"),
            supabase
              .from("effective_arguments")
              .select("*")
              .order("avg_dollar_impact", { ascending: false })
              .limit(15),
            supabase.from("claim_outcomes").select("*").not("claim_id", "is", null),
          ]);

        if (carrierRes.error) throw carrierRes.error;
        if (pricingRes.error) throw pricingRes.error;
        if (photoRes.error) throw photoRes.error;
        if (argsRes.error) throw argsRes.error;
        if (outcomesRes.error) throw outcomesRes.error;

        setCarriers(carrierRes.data || []);
        setPricing(pricingRes.data || []);
        setPhotos(photoRes.data || []);
        setArguments(argsRes.data || []);
        setOutcomes(outcomesRes.data || []);
      } catch (err) {
        setError("Failed to load analytics data");
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, [supabase]);

  // KPIs from claim_outcomes
  const totalClaims = outcomes.length;
  const wins = outcomes.filter((o) => o.win).length;
  const winRate = totalClaims > 0 ? ((wins / totalClaims) * 100).toFixed(1) : "0";
  const totalMovement = outcomes
    .filter((o) => o.win)
    .reduce((sum, o) => sum + (o.movement_amount || 0), 0);
  const totalUsarmRcv = outcomes.reduce((sum, o) => sum + (o.usarm_rcv || 0), 0);
  const avgClaimSize = totalClaims > 0 ? totalUsarmRcv / totalClaims : 0;

  // Photo aggregations
  const damageByType = Object.entries(
    photos.reduce<Record<string, number>>((acc, p) => {
      const key = p.damage_type || "Unknown";
      acc[key] = (acc[key] || 0) + p.photo_count;
      return acc;
    }, {})
  )
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const damageByMaterial = Object.entries(
    photos.reduce<Record<string, number>>((acc, p) => {
      const key = p.material || "Unknown";
      acc[key] = (acc[key] || 0) + p.photo_count;
      return acc;
    }, {})
  )
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Chart data for carrier win rates
  const chartData = carriers
    .map((c) => ({
      name: c.carrier,
      winRate: c.win_rate_pct ?? 0,
    }))
    .sort((a, b) => b.winRate - a.winRate);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  return (
    <main className="min-h-screen bg-white/[0.04]">
      {/* Top Bar */}
      <nav className="bg-[var(--navy)] border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white">
              DR
            </div>
            <span className="text-white font-bold text-lg tracking-tight">
              dumb roof<sup className="text-[9px] font-medium align-super ml-0.5">™</sup>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/dashboard" className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors hidden sm:block">
              Claims
            </a>
            <a href="/dashboard/repairs" className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors hidden sm:block">
              Repairs
            </a>
            <span className="text-white text-sm font-medium hidden sm:block">
              Analytics
            </span>
            <a href="/dashboard/settings" className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors hidden sm:block">
              Settings
            </a>
            <span className="text-[var(--gray-dim)] text-sm hidden sm:block">
              {user.email}
            </span>
            <button
              onClick={handleSignOut}
              className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--navy)]">Analytics</h1>
          <p className="text-[var(--gray-muted)] mt-1">
            Carrier win rates, pricing intelligence, and argument effectiveness.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-2xl border border-[var(--border-glass)] text-center py-16">
            <p className="text-[var(--gray-dim)] text-sm">Loading analytics...</p>
          </div>
        ) : outcomes.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[var(--border-glass)] text-center py-16 px-8">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border-2 border-dashed border-[var(--border-glass)] flex items-center justify-center mx-auto mb-5">
              <svg className="w-8 h-8 text-[var(--gray-dim)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-[var(--navy)] mb-2">No analytics data yet</h3>
            <p className="text-[var(--gray-muted)] text-sm mb-6 max-w-md mx-auto">
              Submit your first claim to start building carrier intelligence and pricing analytics.
            </p>
            <a href="/dashboard/new-claim" className="inline-block bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-8 py-3 rounded-xl font-semibold transition-colors text-sm">
              Submit First Claim
            </a>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Section 1: Portfolio KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-white rounded-xl border border-[var(--border-glass)] p-5 text-center">
                <p className="text-xs text-[var(--gray-dim)] font-medium uppercase">Total Claims</p>
                <p className="text-2xl font-bold text-[var(--navy)] mt-1">{totalClaims}</p>
              </div>
              <div className="bg-white rounded-xl border border-[var(--border-glass)] p-5 text-center">
                <p className="text-xs text-[var(--gray-dim)] font-medium uppercase">Win Rate</p>
                <p className="text-2xl font-bold text-green-600 mt-1">{winRate}%</p>
              </div>
              <div className="bg-white rounded-xl border border-[var(--border-glass)] p-5 text-center">
                <p className="text-xs text-[var(--gray-dim)] font-medium uppercase">Carrier Movement</p>
                <p className="text-2xl font-bold text-[var(--navy)] mt-1">{fmtMoney(totalMovement)}</p>
              </div>
              <div className="bg-white rounded-xl border border-[var(--border-glass)] p-5 text-center">
                <p className="text-xs text-[var(--gray-dim)] font-medium uppercase">Avg Claim Size</p>
                <p className="text-2xl font-bold text-[var(--navy)] mt-1">{fmtMoney(avgClaimSize)}</p>
              </div>
              <div className="bg-white rounded-xl border border-[var(--border-glass)] p-5 text-center col-span-2 md:col-span-1">
                <p className="text-xs text-[var(--gray-dim)] font-medium uppercase">Total USARM RCV</p>
                <p className="text-2xl font-bold text-[var(--navy)] mt-1">{fmtMoney(totalUsarmRcv)}</p>
              </div>
            </div>

            {/* Section 2: Carrier Scoreboard */}
            <div className="bg-white rounded-2xl border border-[var(--border-glass)] overflow-hidden">
              <div className="px-6 py-4 border-b border-white/[0.04]">
                <h2 className="text-sm font-semibold text-[var(--navy)]">Carrier Scoreboard</h2>
              </div>
              {carriers.length === 0 ? (
                <p className="text-[var(--gray-dim)] text-sm text-center py-8">No data available</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/[0.04] text-left">
                        <th className="px-6 py-3 text-xs font-medium text-[var(--gray-muted)] uppercase">Carrier</th>
                        <th className="px-4 py-3 text-xs font-medium text-[var(--gray-muted)] uppercase text-right">Claims</th>
                        <th className="px-4 py-3 text-xs font-medium text-[var(--gray-muted)] uppercase text-right">Wins</th>
                        <th className="px-4 py-3 text-xs font-medium text-[var(--gray-muted)] uppercase text-center">Win Rate</th>
                        <th className="px-4 py-3 text-xs font-medium text-[var(--gray-muted)] uppercase text-right">Avg Movement</th>
                        <th className="px-6 py-3 text-xs font-medium text-[var(--gray-muted)] uppercase text-right">Avg USARM RCV</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {carriers.map((c) => (
                        <tr key={c.carrier} className="hover:bg-white/[0.04]">
                          <td className="px-6 py-3 font-medium text-[var(--navy)]">{c.carrier}</td>
                          <td className="px-4 py-3 text-right text-[var(--gray)]">{c.total_claims}</td>
                          <td className="px-4 py-3 text-right text-[var(--gray)]">{c.wins}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${winRateBadge(c.win_rate_pct ?? 0)}`}>
                              {(c.win_rate_pct ?? 0).toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--gray)]">{fmtMoney(c.avg_win_movement_dollars ?? 0)}</td>
                          <td className="px-6 py-3 text-right text-[var(--gray)]">{fmtMoney(c.avg_usarm_rcv ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Section 3: Win Rate Chart */}
            {chartData.length > 0 && (
              <div className="bg-white rounded-2xl border border-[var(--border-glass)] overflow-hidden">
                <div className="px-6 py-4 border-b border-white/[0.04]">
                  <h2 className="text-sm font-semibold text-[var(--navy)]">Win Rate by Carrier</h2>
                </div>
                <div className="p-6">
                  <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 48)}>
                    <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 30 }}>
                      <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} fontSize={12} />
                      <YAxis type="category" dataKey="name" width={120} fontSize={12} />
                      <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, "Win Rate"]} />
                      <Bar dataKey="winRate" radius={[0, 4, 4, 0]} barSize={24}>
                        {chartData.map((entry, idx) => (
                          <Cell key={idx} fill={winRateColor(entry.winRate)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Section 4: Photo Intelligence */}
            {(damageByType.length > 0 || damageByMaterial.length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white rounded-2xl border border-[var(--border-glass)] overflow-hidden">
                  <div className="px-6 py-4 border-b border-white/[0.04]">
                    <h2 className="text-sm font-semibold text-[var(--navy)]">Damage Types</h2>
                  </div>
                  {damageByType.length === 0 ? (
                    <p className="text-[var(--gray-dim)] text-sm text-center py-8">No data available</p>
                  ) : (
                    <div className="p-6">
                      <ResponsiveContainer width="100%" height={Math.max(200, damageByType.length * 36)}>
                        <BarChart data={damageByType} layout="vertical" margin={{ left: 10, right: 20 }}>
                          <XAxis type="number" fontSize={12} />
                          <YAxis type="category" dataKey="name" width={130} fontSize={11} />
                          <Tooltip formatter={(value) => [Number(value), "Photos"]} />
                          <Bar dataKey="count" fill="#0d2137" radius={[0, 4, 4, 0]} barSize={20} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-2xl border border-[var(--border-glass)] overflow-hidden">
                  <div className="px-6 py-4 border-b border-white/[0.04]">
                    <h2 className="text-sm font-semibold text-[var(--navy)]">Material Breakdown</h2>
                  </div>
                  {damageByMaterial.length === 0 ? (
                    <p className="text-[var(--gray-dim)] text-sm text-center py-8">No data available</p>
                  ) : (
                    <div className="p-6">
                      <ResponsiveContainer width="100%" height={Math.max(200, damageByMaterial.length * 36)}>
                        <BarChart data={damageByMaterial} layout="vertical" margin={{ left: 10, right: 20 }}>
                          <XAxis type="number" fontSize={12} />
                          <YAxis type="category" dataKey="name" width={130} fontSize={11} />
                          <Tooltip formatter={(value) => [Number(value), "Photos"]} />
                          <Bar dataKey="count" fill="#c8102e" radius={[0, 4, 4, 0]} barSize={20} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Section 5: Pricing Intelligence */}
            <div className="bg-white rounded-2xl border border-[var(--border-glass)] overflow-hidden">
              <div className="px-6 py-4 border-b border-white/[0.04]">
                <h2 className="text-sm font-semibold text-[var(--navy)]">Pricing Intelligence — Top Gaps</h2>
              </div>
              {pricing.length === 0 ? (
                <p className="text-[var(--gray-dim)] text-sm text-center py-8">No data available</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/[0.04] text-left">
                        <th className="px-6 py-3 text-xs font-medium text-[var(--gray-muted)] uppercase">Line Item</th>
                        <th className="px-4 py-3 text-xs font-medium text-[var(--gray-muted)] uppercase text-center">Unit</th>
                        <th className="px-4 py-3 text-xs font-medium text-[var(--gray-muted)] uppercase text-right">USARM Avg</th>
                        <th className="px-4 py-3 text-xs font-medium text-[var(--gray-muted)] uppercase text-right">Carrier Avg</th>
                        <th className="px-4 py-3 text-xs font-medium text-[var(--gray-muted)] uppercase text-right">Gap</th>
                        <th className="px-6 py-3 text-xs font-medium text-[var(--gray-muted)] uppercase text-right">Samples</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {pricing.map((p, i) => (
                        <tr key={i} className="hover:bg-white/[0.04]">
                          <td className="px-6 py-3 text-[var(--navy)] font-medium max-w-[280px] truncate">{p.description}</td>
                          <td className="px-4 py-3 text-center text-[var(--gray-muted)]">{p.unit}</td>
                          <td className="px-4 py-3 text-right text-[var(--gray)]">${(p.avg_usarm_price ?? 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-right text-[var(--gray)]">${(p.avg_carrier_price ?? 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-right font-medium text-green-600">+${(p.price_gap ?? 0).toFixed(2)}</td>
                          <td className="px-6 py-3 text-right text-[var(--gray-muted)]">{p.usarm_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Section 6: Top Arguments */}
            <div className="bg-white rounded-2xl border border-[var(--border-glass)] overflow-hidden">
              <div className="px-6 py-4 border-b border-white/[0.04]">
                <h2 className="text-sm font-semibold text-[var(--navy)]">Top Arguments by Impact</h2>
              </div>
              {arguments_.length === 0 ? (
                <p className="text-[var(--gray-dim)] text-sm text-center py-8">No data available</p>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {arguments_.map((arg, i) => (
                    <div key={i} className="px-6 py-4">
                      <div className="flex items-start gap-3">
                        <div className="flex items-center gap-2 shrink-0 mt-0.5">
                          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                            {arg.carrier}
                          </span>
                          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-white/[0.06] text-[var(--gray)]">
                            {arg.tactic_type}
                          </span>
                        </div>
                        <p className="text-sm text-[var(--gray)] leading-relaxed">{arg.counter_argument}</p>
                      </div>
                      <div className="flex items-center gap-4 mt-2 ml-0 md:ml-[calc(theme(spacing.2.5)*2+theme(spacing.2)+120px)]">
                        <span className="text-xs text-[var(--gray-dim)]">
                          Used {arg.times_used}x
                        </span>
                        <span className="text-xs text-[var(--gray-dim)]">
                          {(arg.effectiveness_pct ?? 0).toFixed(0)}% effective
                        </span>
                        <span className="text-xs font-medium text-green-600">
                          Avg impact {fmtMoney(arg.avg_dollar_impact ?? 0)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
