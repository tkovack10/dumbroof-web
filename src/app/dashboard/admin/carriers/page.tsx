"use client";

import { useEffect, useState, useMemo } from "react";

interface CarrierMetrics {
  carrier_name: string;
  total_claims: number;
  wins: number;
  win_rate: number;
  avg_carrier_rcv: number;
  avg_contractor_rcv: number;
  avg_variance: number;
  total_movement: number;
  supplement_count: number;
}

interface CarriersData {
  carriers: CarrierMetrics[];
}

type SortKey =
  | "carrier_name"
  | "total_claims"
  | "wins"
  | "win_rate"
  | "avg_carrier_rcv"
  | "avg_contractor_rcv"
  | "avg_variance"
  | "total_movement";

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

export default function CarriersPage() {
  const [data, setData] = useState<CarriersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("total_claims");
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    async function fetchCarriers() {
      try {
        const res = await fetch("/api/admin/carriers");
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

    fetchCarriers();
    const interval = setInterval(fetchCarriers, 60000);
    return () => clearInterval(interval);
  }, []);

  const sortedCarriers = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.carriers];
    sorted.sort((a, b) => {
      let aVal: number | string = 0;
      let bVal: number | string = 0;

      switch (sortKey) {
        case "carrier_name":
          aVal = a.carrier_name.toLowerCase();
          bVal = b.carrier_name.toLowerCase();
          break;
        case "total_claims":
          aVal = a.total_claims;
          bVal = b.total_claims;
          break;
        case "wins":
          aVal = a.wins;
          bVal = b.wins;
          break;
        case "win_rate":
          aVal = a.win_rate;
          bVal = b.win_rate;
          break;
        case "avg_carrier_rcv":
          aVal = a.avg_carrier_rcv;
          bVal = b.avg_carrier_rcv;
          break;
        case "avg_contractor_rcv":
          aVal = a.avg_contractor_rcv;
          bVal = b.avg_contractor_rcv;
          break;
        case "avg_variance":
          aVal = a.avg_variance;
          bVal = b.avg_variance;
          break;
        case "total_movement":
          aVal = a.total_movement;
          bVal = b.total_movement;
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

  function SortHeader({
    label,
    colKey,
    align,
  }: {
    label: string;
    colKey: SortKey;
    align?: string;
  }) {
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass-card p-6 animate-shimmer">
                <div className="h-8 w-24 bg-white/[0.06] rounded mb-2" />
                <div className="h-3 w-20 bg-white/[0.04] rounded" />
              </div>
            ))}
          </div>
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
              Failed to load carrier data
            </p>
            <p className="text-[var(--gray-dim)] text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { carriers } = data;

  // Top stats
  const totalCarriers = carriers.length;
  const totalMovement = carriers.reduce((sum, c) => sum + c.total_movement, 0);

  // Best carrier by win rate (minimum 3 claims)
  const carriersWithVolume = carriers.filter((c) => c.total_claims >= 3);
  const bestCarrier = carriersWithVolume.length > 0
    ? carriersWithVolume.reduce((best, c) => (c.win_rate > best.win_rate ? c : best))
    : null;
  const worstCarrier = carriersWithVolume.length > 0
    ? carriersWithVolume.reduce((worst, c) => (c.win_rate < worst.win_rate ? c : worst))
    : null;

  // For the comparison bar chart: top 5 carriers by claim count
  const top5 = carriers.slice(0, 5);
  const maxRcv = Math.max(
    ...top5.flatMap((c) => [c.avg_carrier_rcv, c.avg_contractor_rcv]),
    1
  );

  return (
    <div className="p-6 lg:p-8 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 pl-10 lg:pl-0">
          <h1 className="text-2xl font-bold gradient-text">Carrier Intelligence</h1>
          <p className="text-[var(--gray-muted)] mt-1 text-sm">
            Win rates, variance analysis, and performance by insurance carrier.
          </p>
        </div>

        {/* Top Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="glass-card p-6 text-center">
            <p className="text-3xl font-bold gradient-text">{totalCarriers}</p>
            <p className="text-xs text-[var(--gray-muted)] mt-2">Carriers Tracked</p>
          </div>
          <div className="glass-card p-6 text-center">
            {bestCarrier ? (
              <>
                <p className="text-xl font-bold text-[var(--green)] truncate px-2">
                  {bestCarrier.carrier_name}
                </p>
                <p className="text-xs text-[var(--green)] font-mono mt-1">
                  {bestCarrier.win_rate}% win rate
                </p>
              </>
            ) : (
              <p className="text-xl font-bold text-[var(--gray-dim)]">--</p>
            )}
            <p className="text-xs text-[var(--gray-muted)] mt-2">Best Carrier</p>
          </div>
          <div className="glass-card p-6 text-center">
            {worstCarrier ? (
              <>
                <p className="text-xl font-bold text-[var(--red-accent)] truncate px-2">
                  {worstCarrier.carrier_name}
                </p>
                <p className="text-xs text-[var(--red-accent)] font-mono mt-1">
                  {worstCarrier.win_rate}% win rate
                </p>
              </>
            ) : (
              <p className="text-xl font-bold text-[var(--gray-dim)]">--</p>
            )}
            <p className="text-xs text-[var(--gray-muted)] mt-2">Toughest Carrier</p>
          </div>
          <div className="glass-card p-6 text-center">
            <p className="text-3xl font-bold text-[var(--green)] font-mono">
              {totalMovement > 0 ? `+${fmtMoney(totalMovement)}` : "--"}
            </p>
            <p className="text-xs text-[var(--gray-muted)] mt-2">Total Movement</p>
          </div>
        </div>

        {/* Carrier Comparison Bar Chart */}
        {top5.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-[var(--white)] mb-4">
              RCV Comparison — Top 5 Carriers
            </h2>
            <div className="glass-card p-6">
              <div className="space-y-5">
                {top5.map((carrier) => {
                  const carrierPct = maxRcv > 0 ? (carrier.avg_carrier_rcv / maxRcv) * 100 : 0;
                  const contractorPct =
                    maxRcv > 0 ? (carrier.avg_contractor_rcv / maxRcv) * 100 : 0;

                  return (
                    <div key={carrier.carrier_name}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-[var(--white)] truncate max-w-[200px]">
                          {carrier.carrier_name}
                        </span>
                        <span className="text-xs text-[var(--gray-muted)] font-mono">
                          {carrier.total_claims} claims
                        </span>
                      </div>
                      {/* Carrier RCV bar */}
                      <div className="flex items-center gap-3 mb-1.5">
                        <span className="text-xs text-[var(--gray-dim)] w-20 text-right flex-shrink-0">
                          Carrier
                        </span>
                        <div className="flex-1 h-5 rounded-md overflow-hidden bg-white/[0.04]">
                          <div
                            className="h-full rounded-md flex items-center px-2 transition-all duration-500"
                            style={{
                              width: `${Math.max(carrierPct, 2)}%`,
                              background: "rgba(255, 90, 106, 0.5)",
                            }}
                          >
                            {carrierPct > 15 && (
                              <span className="text-[10px] font-mono text-[var(--white)]">
                                {fmtMoney(carrier.avg_carrier_rcv)}
                              </span>
                            )}
                          </div>
                        </div>
                        {carrierPct <= 15 && (
                          <span className="text-[10px] font-mono text-[var(--gray-muted)] flex-shrink-0">
                            {fmtMoney(carrier.avg_carrier_rcv)}
                          </span>
                        )}
                      </div>
                      {/* Contractor RCV bar */}
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-[var(--gray-dim)] w-20 text-right flex-shrink-0">
                          Ours
                        </span>
                        <div className="flex-1 h-5 rounded-md overflow-hidden bg-white/[0.04]">
                          <div
                            className="h-full rounded-md flex items-center px-2 transition-all duration-500"
                            style={{
                              width: `${Math.max(contractorPct, 2)}%`,
                              background: "rgba(34, 216, 255, 0.5)",
                            }}
                          >
                            {contractorPct > 15 && (
                              <span className="text-[10px] font-mono text-[var(--white)]">
                                {fmtMoney(carrier.avg_contractor_rcv)}
                              </span>
                            )}
                          </div>
                        </div>
                        {contractorPct <= 15 && (
                          <span className="text-[10px] font-mono text-[var(--gray-muted)] flex-shrink-0">
                            {fmtMoney(carrier.avg_contractor_rcv)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Legend */}
              <div className="flex items-center gap-6 mt-5 pt-4 border-t border-[var(--border-glass)]">
                <div className="flex items-center gap-2 text-xs text-[var(--gray-muted)]">
                  <span
                    className="w-3 h-3 rounded"
                    style={{ background: "rgba(255, 90, 106, 0.5)" }}
                  />
                  Carrier Avg RCV
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--gray-muted)]">
                  <span
                    className="w-3 h-3 rounded"
                    style={{ background: "rgba(34, 216, 255, 0.5)" }}
                  />
                  Our Avg RCV
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Carrier Table */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[var(--white)]">All Carriers</h2>
            {carriers.length > 0 && (
              <span className="text-sm text-[var(--gray-muted)] font-mono">
                {carriers.length} carriers
              </span>
            )}
          </div>
          <div className="glass-card overflow-hidden">
            {sortedCarriers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--border-glass)]">
                      <SortHeader label="Carrier" colKey="carrier_name" />
                      <SortHeader label="Claims" colKey="total_claims" align="right" />
                      <SortHeader label="Wins" colKey="wins" align="right" />
                      <SortHeader label="Win Rate" colKey="win_rate" align="right" />
                      <SortHeader label="Carrier RCV" colKey="avg_carrier_rcv" align="right" />
                      <SortHeader label="Our RCV" colKey="avg_contractor_rcv" align="right" />
                      <SortHeader label="Variance" colKey="avg_variance" align="right" />
                      <SortHeader label="Movement" colKey="total_movement" align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCarriers.map((carrier) => (
                      <tr
                        key={carrier.carrier_name}
                        className="border-b border-[var(--border-glass)] transition-colors hover:bg-white/[0.03]"
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[var(--white)]">
                              {carrier.carrier_name}
                            </span>
                            {carrier.supplement_count > 0 && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                                style={{
                                  background: "rgba(34, 216, 255, 0.12)",
                                  color: "var(--cyan)",
                                }}
                                title={`${carrier.supplement_count} supplemented`}
                              >
                                {carrier.supplement_count}S
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-right font-mono text-[var(--white)]">
                          {carrier.total_claims}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-right font-mono">
                          <span
                            className={
                              carrier.wins > 0
                                ? "text-[var(--green)]"
                                : "text-[var(--gray-dim)]"
                            }
                          >
                            {carrier.wins}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-right">
                          <span
                            className="px-2.5 py-1 rounded-full text-xs font-semibold font-mono"
                            style={{
                              background:
                                carrier.win_rate >= 50
                                  ? "rgba(0, 242, 125, 0.12)"
                                  : carrier.win_rate >= 25
                                    ? "rgba(255, 194, 51, 0.12)"
                                    : carrier.win_rate > 0
                                      ? "rgba(255, 90, 106, 0.12)"
                                      : "rgba(255, 255, 255, 0.04)",
                              color:
                                carrier.win_rate >= 50
                                  ? "var(--green)"
                                  : carrier.win_rate >= 25
                                    ? "var(--amber)"
                                    : carrier.win_rate > 0
                                      ? "var(--red-accent)"
                                      : "var(--gray-dim)",
                            }}
                          >
                            {carrier.win_rate}%
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-right font-mono text-[var(--gray-muted)]">
                          {fmtMoneyFull(carrier.avg_carrier_rcv)}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-right font-mono text-[var(--white)]">
                          {fmtMoneyFull(carrier.avg_contractor_rcv)}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-right font-mono">
                          <span
                            className={
                              carrier.avg_variance > 0
                                ? "text-[var(--cyan)]"
                                : carrier.avg_variance < 0
                                  ? "text-[var(--red-accent)]"
                                  : "text-[var(--gray-dim)]"
                            }
                          >
                            {carrier.avg_variance > 0 ? "+" : ""}
                            {fmtMoneyFull(carrier.avg_variance)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-right font-mono">
                          <span
                            className={
                              carrier.total_movement > 0
                                ? "text-[var(--green)]"
                                : "text-[var(--gray-dim)]"
                            }
                          >
                            {carrier.total_movement > 0
                              ? `+${fmtMoneyFull(carrier.total_movement)}`
                              : "--"}
                          </span>
                        </td>
                      </tr>
                    ))}
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
                    d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
                  />
                </svg>
                <p className="text-lg font-semibold text-[var(--white)] mb-1">
                  No carrier data yet
                </p>
                <p className="text-sm text-[var(--gray-dim)]">
                  Carrier analytics will appear once claims are processed with carrier information.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
