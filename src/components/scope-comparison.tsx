"use client";

import { useEffect, useState } from "react";
import type {
  ScopeComparisonRow,
  ScopeComparisonResponse,
  ScopeComparisonFinancials,
  ScopeComparisonSummary,
} from "@/types/scope-comparison";

interface Props {
  claimId: string;
  carrierName: string;
  refreshKey?: string | null;
}

const STATUS_STYLES: Record<string, { chip: string; row: string; label: string }> = {
  missing: { chip: "bg-red-600 text-white", row: "bg-red-500/10", label: "MISSING" },
  under: { chip: "bg-orange-500/100 text-white", row: "bg-amber-500/10", label: "UNDER" },
  match: { chip: "bg-green-600 text-white", row: "bg-green-500/10", label: "MATCH" },
  over: { chip: "bg-blue-600 text-white", row: "bg-blue-500/10", label: "OVER" },
  carrier_only: { chip: "bg-purple-600 text-white", row: "bg-blue-500/10", label: "CARRIER" },
};

type Tab = "roofing" | "siding" | "missing" | "financial";

export function ScopeComparison({ claimId, carrierName, refreshKey }: Props) {
  const [data, setData] = useState<ScopeComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("roofing");
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/scope-comparison?claim_id=${claimId}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError(""); // No data yet — not an error
            return;
          }
          throw new Error("Failed to load scope comparison");
        }
        setData(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Load failed");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [claimId, refreshKey]);

  if (loading) return null;
  if (error || !data) return null;

  const { comparison_rows: rows, financials: fin, summary } = data;

  const roofingRows = rows.filter((r) => (r.trade || "").toLowerCase() === "roofing" || (r.category || "").toUpperCase() === "ROOFING");
  const sidingRows = rows.filter((r) => {
    const t = (r.trade || "").toLowerCase();
    const c = (r.category || "").toUpperCase();
    return t === "siding" || c === "SIDING" || t === "gutters" || c === "GUTTERS" || c === "INTERIOR" || c === "GENERAL";
  });
  const missingRows = rows.filter((r) => r.status === "missing");

  const fmt = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const fmt2 = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="glass-card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/[0.04] transition-colors"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-[var(--white)]">Scope Comparison</h2>
          <span className="text-xs text-[var(--gray-dim)]">{carrierName}</span>
          {summary.missing_count > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400">
              {summary.missing_count} Missing
            </span>
          )}
          {summary.under_count > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-500/10 text-orange-400">
              {summary.under_count} Under
            </span>
          )}
          {summary.tricks_detected.length > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400">
              {summary.tricks_detected.length} Trick{summary.tricks_detected.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <svg className={`w-5 h-5 text-[var(--gray-dim)] transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div>
          {/* Summary Cards */}
          <SummaryCards financials={fin} summary={summary} />

          {/* Tabs */}
          <div className="flex border-b border-[var(--border-glass)] px-6 gap-0">
            {([
              ["roofing", `Roofing (${roofingRows.length})`],
              ["siding", `Exterior (${sidingRows.length})`],
              ["missing", `Missing (${missingRows.length})`],
              ["financial", "Financial Summary"],
            ] as [Tab, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
                  activeTab === key
                    ? "text-blue-600 border-blue-600"
                    : "text-[var(--gray-muted)] border-transparent hover:text-[var(--gray)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="overflow-x-auto">
            {activeTab === "roofing" && <ComparisonTable rows={roofingRows} />}
            {activeTab === "siding" && <ComparisonTable rows={sidingRows} />}
            {activeTab === "missing" && <MissingItems rows={missingRows} />}
            {activeTab === "financial" && <FinancialSummary rows={rows} financials={fin} />}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCards({ financials: fin, summary }: { financials: ScopeComparisonFinancials; summary: ScopeComparisonSummary }) {
  const fmt = (v: number) => `$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const variance = fin.contractor_rcv - fin.carrier_rcv;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 px-6 py-4">
      <div className="bg-blue-500/10 rounded-lg p-3">
        <p className="text-[10px] uppercase text-blue-600 font-semibold tracking-wide">Carrier RCV</p>
        <p className="text-lg font-bold text-blue-400">{fmt(fin.carrier_rcv)}</p>
      </div>
      <div className="bg-white/[0.04] rounded-lg p-3">
        <p className="text-[10px] uppercase text-[var(--gray-muted)] font-semibold tracking-wide">USARM RCV</p>
        <p className="text-lg font-bold text-[var(--white)]">{fmt(fin.contractor_rcv)}</p>
      </div>
      <div className={`rounded-lg p-3 ${variance > 0 ? "bg-green-500/10" : "bg-red-500/10"}`}>
        <p className="text-[10px] uppercase text-[var(--gray-muted)] font-semibold tracking-wide">Variance</p>
        <p className={`text-lg font-bold ${variance > 0 ? "text-green-400" : "text-red-400"}`}>
          {variance > 0 ? "+" : "-"}{fmt(variance)}
        </p>
      </div>
      <div className="bg-red-500/10 rounded-lg p-3">
        <p className="text-[10px] uppercase text-red-600 font-semibold tracking-wide">Supplement Opportunity</p>
        <p className="text-lg font-bold text-red-400">{fmt(fin.supplement_opportunity)}+</p>
      </div>
      <div className="bg-white/[0.04] rounded-lg p-3">
        <p className="text-[10px] uppercase text-[var(--gray-muted)] font-semibold tracking-wide">Items</p>
        <p className="text-lg font-bold text-[var(--white)]">{summary.total_items}</p>
        <p className="text-[10px] text-[var(--gray-dim)]">{summary.match_count} match, {summary.missing_count} missing, {summary.under_count} under</p>
      </div>
    </div>
  );
}

function ComparisonTable({ rows }: { rows: ScopeComparisonRow[] }) {
  if (rows.length === 0) {
    return <div className="p-8 text-center text-sm text-[var(--gray-dim)]">No items in this category</div>;
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="bg-white/[0.04] text-left">
          <th className="px-3 py-2 text-[10px] font-semibold text-[var(--gray-dim)] uppercase">Line Item</th>
          <th className="px-3 py-2 text-[10px] font-semibold text-[var(--gray-dim)] uppercase text-center">Status</th>
          <th className="px-3 py-2 text-[10px] font-semibold text-[var(--gray-dim)] uppercase text-right">Carrier Qty</th>
          <th className="px-3 py-2 text-[10px] font-semibold text-[var(--gray-dim)] uppercase text-right">USARM Qty</th>
          <th className="px-3 py-2 text-[10px] font-semibold text-[var(--gray-dim)] uppercase">Unit</th>
          <th className="px-3 py-2 text-[10px] font-semibold text-[var(--gray-dim)] uppercase text-right">Carrier $</th>
          <th className="px-3 py-2 text-[10px] font-semibold text-[var(--gray-dim)] uppercase text-right">USARM $</th>
          <th className="px-3 py-2 text-[10px] font-semibold text-[var(--gray-dim)] uppercase text-right">Variance</th>
          <th className="px-3 py-2 text-[10px] font-semibold text-[var(--gray-dim)] uppercase">Notes</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const st = STATUS_STYLES[row.status] || STATUS_STYLES.match;
          const carrierAmt = row.carrier_amount || 0;
          const usarmAmt = row.usarm_amount || 0;
          const variance = usarmAmt - carrierAmt;
          const desc = row.checklist_desc || row.usarm_desc || row.carrier_desc || "";

          return (
            <tr key={i} className={`${st.row} hover:brightness-95 transition-colors`}>
              <td className="px-3 py-2 max-w-[200px]">
                <p className="font-medium text-[var(--white)] truncate">{desc}</p>
                {row.irc_code && (
                  <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-green-500/10 text-green-400">
                    {row.irc_code}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-center">
                <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold ${st.chip}`}>
                  {st.label}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono text-[var(--gray)]">
                {row.carrier_qty ? row.carrier_qty.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "\u2014"}
              </td>
              <td className="px-3 py-2 text-right font-mono text-[var(--gray)]">
                {row.ev_qty ? row.ev_qty.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "\u2014"}
              </td>
              <td className="px-3 py-2 text-[var(--gray-muted)]">{row.ev_unit || row.carrier_unit || ""}</td>
              <td className="px-3 py-2 text-right font-mono text-[var(--gray)]">
                {carrierAmt > 0 ? `$${carrierAmt.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "\u2014"}
              </td>
              <td className="px-3 py-2 text-right font-mono text-[var(--gray)]">
                {usarmAmt > 0 ? `$${usarmAmt.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "\u2014"}
              </td>
              <td className={`px-3 py-2 text-right font-mono font-medium ${variance > 0 ? "text-red-600" : variance < 0 ? "text-green-600" : "text-[var(--gray-dim)]"}`}>
                {row.status === "missing" ? `+$${usarmAmt.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` :
                  variance !== 0 ? `${variance > 0 ? "+" : ""}$${variance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "\u2014"}
              </td>
              <td className="px-3 py-2 max-w-[250px]">
                {row.trick_flag && (
                  <p className="text-[10px] font-bold text-amber-400 mb-0.5">
                    TRICK: {row.trick_flag}
                  </p>
                )}
                {row.unit_mismatch && (
                  <p className="text-[10px] font-bold text-orange-600 mb-0.5">
                    {row.unit_mismatch}
                  </p>
                )}
                <p className="text-[10px] text-[var(--gray-muted)] leading-tight truncate">{row.note || ""}</p>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MissingItems({ rows }: { rows: ScopeComparisonRow[] }) {
  if (rows.length === 0) {
    return <div className="p-8 text-center text-sm text-[var(--gray-dim)]">No missing items detected</div>;
  }

  return (
    <div className="p-6 space-y-3">
      {rows.map((row, i) => {
        const amt = row.usarm_amount || row.ev_qty * (row.xact_unit_price || 0);
        const citation = row.code_citation;
        return (
          <div key={i} className="border-l-4 border-red-500 bg-red-500/10 rounded-r-lg px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-bold text-[var(--white)]">
                  {i + 1}. {row.checklist_desc || row.usarm_desc}
                  {row.irc_code && (
                    <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-500/10 text-green-400">
                      {row.irc_code}
                    </span>
                  )}
                </p>
                <p className="text-xs text-[var(--gray)] mt-1">
                  {row.ev_qty > 0 && <span>{row.ev_qty} {row.ev_unit}</span>}
                  {row.ev_formula && <span className="text-[var(--gray-dim)] ml-2">({row.ev_formula})</span>}
                </p>
                {row.note && <p className="text-xs text-[var(--gray-muted)] mt-1">{row.note}</p>}
                {citation && (
                  <div className="mt-2 space-y-1">
                    <p className="text-[10px] text-[var(--gray)]">
                      <span className="font-bold text-blue-400">{citation.code_tag}:</span> {citation.title}
                    </p>
                    {citation.supplement_argument && (
                      <p className="text-[10px] text-green-400 bg-green-500/10 px-2 py-1 rounded leading-tight">
                        {citation.supplement_argument}
                      </p>
                    )}
                    {citation.has_warranty_void && (
                      <p className="text-[10px] font-bold text-red-600">Manufacturer warranty VOID without this item</p>
                    )}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-lg font-bold text-red-400">${amt.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                <p className="text-[10px] text-[var(--gray-dim)]">Not in carrier scope</p>
              </div>
            </div>
          </div>
        );
      })}
      <div className="bg-red-500/10 rounded-lg px-4 py-3 flex items-center justify-between mt-4">
        <p className="text-sm font-bold text-red-400">Total Missing Items</p>
        <p className="text-lg font-bold text-red-400">
          ${rows.reduce((s, r) => s + (r.usarm_amount || r.ev_qty * (r.xact_unit_price || 0)), 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </p>
      </div>
    </div>
  );
}

function FinancialSummary({ rows, financials: fin }: { rows: ScopeComparisonRow[]; financials: ScopeComparisonFinancials }) {
  // Group by trade for subtotals
  const byTrade: Record<string, { carrier: number; usarm: number }> = {};
  for (const row of rows) {
    const trade = (row.trade || row.category || "other").toLowerCase();
    if (!byTrade[trade]) byTrade[trade] = { carrier: 0, usarm: 0 };
    byTrade[trade].carrier += row.carrier_amount || 0;
    byTrade[trade].usarm += row.usarm_amount || 0;
  }
  const trades = Object.entries(byTrade).sort(([a], [b]) => a.localeCompare(b));
  const totalCarrier = trades.reduce((s, [, v]) => s + v.carrier, 0);
  const totalUsarm = trades.reduce((s, [, v]) => s + v.usarm, 0);

  const fmt = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Supplement breakdown
  const supplementRows = rows
    .filter((r) => r.status === "missing" || r.status === "under")
    .map((r) => {
      const usarm = r.usarm_amount || r.ev_qty * (r.xact_unit_price || 0);
      const carrier = r.carrier_amount || 0;
      return { desc: r.checklist_desc || r.usarm_desc, status: r.status, value: r.status === "missing" ? usarm : usarm - carrier };
    })
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const supplementTotal = supplementRows.reduce((s, r) => s + r.value, 0);
  const supplementTax = supplementTotal * fin.tax_rate;

  return (
    <div className="p-6 space-y-6">
      {/* Trade Comparison */}
      <div>
        <h3 className="text-sm font-semibold text-[var(--white)] mb-3">Cost by Trade</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-white/[0.04]">
              <th className="px-3 py-2 text-left text-[10px] font-semibold text-[var(--gray-dim)] uppercase">Trade</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold text-[var(--gray-dim)] uppercase">Carrier</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold text-[var(--gray-dim)] uppercase">USARM</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold text-[var(--gray-dim)] uppercase">Variance</th>
            </tr>
          </thead>
          <tbody>
            {trades.map(([trade, vals]) => (
              <tr key={trade} className="border-b border-white/[0.04]">
                <td className="px-3 py-2 capitalize font-medium">{trade}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(vals.carrier)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(vals.usarm)}</td>
                <td className={`px-3 py-2 text-right font-mono font-medium ${vals.usarm - vals.carrier > 0 ? "text-red-600" : "text-green-600"}`}>
                  {vals.usarm - vals.carrier > 0 ? "+" : ""}{fmt(vals.usarm - vals.carrier)}
                </td>
              </tr>
            ))}
            <tr className="bg-white/[0.06] font-bold">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right font-mono">{fmt(totalCarrier)}</td>
              <td className="px-3 py-2 text-right font-mono">{fmt(totalUsarm)}</td>
              <td className={`px-3 py-2 text-right font-mono ${totalUsarm - totalCarrier > 0 ? "text-red-600" : "text-green-600"}`}>
                {totalUsarm - totalCarrier > 0 ? "+" : ""}{fmt(totalUsarm - totalCarrier)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Supplement Breakdown */}
      {supplementRows.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-[var(--white)] mb-3">Supplement Value — Missing &amp; Under-Scoped Items</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-white/[0.04]">
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-[var(--gray-dim)] uppercase">Item</th>
                <th className="px-3 py-2 text-center text-[10px] font-semibold text-[var(--gray-dim)] uppercase">Issue</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold text-[var(--gray-dim)] uppercase">Supplement Value</th>
              </tr>
            </thead>
            <tbody>
              {supplementRows.map((r, i) => (
                <tr key={i} className={`border-b border-white/[0.04] ${r.status === "missing" ? "bg-red-500/10" : "bg-amber-500/10"}`}>
                  <td className="px-3 py-2 font-medium">{r.desc}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold ${r.status === "missing" ? "bg-red-600 text-white" : "bg-orange-500/100 text-white"}`}>
                      {r.status === "missing" ? "MISSING" : "UNDER"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-red-400">${r.value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-red-500/10 font-bold">
                <td colSpan={2} className="px-3 py-2">Total Supplement Value</td>
                <td className="px-3 py-2 text-right font-mono text-red-400">${supplementTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
              </tr>
              <tr className="bg-blue-500/10">
                <td colSpan={2} className="px-3 py-2 text-[var(--gray)]">+ Tax ({(fin.tax_rate * 100).toFixed(0)}%)</td>
                <td className="px-3 py-2 text-right font-mono">${supplementTax.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
              </tr>
              <tr className="bg-red-600 text-white font-bold text-sm">
                <td colSpan={2} className="px-3 py-3">TOTAL SUPPLEMENT WITH TAX</td>
                <td className="px-3 py-3 text-right font-mono">${(supplementTotal + supplementTax).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
