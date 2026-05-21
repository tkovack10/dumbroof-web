"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface EstimateRow {
  id: string;
  template_id: string;
  customer_name: string | null;
  customer_email: string | null;
  total_amount: number;
  status: "draft" | "sent" | string;
  created_at: string;
  sent_at: string | null;
}

type StatusFilter = "all" | "draft" | "sent";

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function templateLabel(id: string): string {
  // e.g. retail-oc-trudefinition-duration → "OC TruDefinition Duration"
  return id
    .replace(/^retail-/, "")
    .split("-")
    .map((w) => (w === "oc" ? "OC" : w === "gaf" ? "GAF" : w === "ct" ? "CertainTeed" : w === "hdz" ? "HDZ" : w[0]?.toUpperCase() + w.slice(1)))
    .join(" ");
}

export function RetailEstimatesList() {
  const router = useRouter();
  const [rows, setRows] = useState<EstimateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/retail-estimates");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load");
        return;
      }
      setRows(data.estimates || []);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    return rows
      .filter((r) => (filter === "all" ? true : r.status === filter))
      .filter((r) => {
        if (!search.trim()) return true;
        const s = search.toLowerCase();
        return (
          (r.customer_name || "").toLowerCase().includes(s) ||
          (r.customer_email || "").toLowerCase().includes(s) ||
          r.template_id.toLowerCase().includes(s)
        );
      });
  }, [rows, filter, search]);

  const stats = useMemo(() => {
    const total = rows.length;
    const draft = rows.filter((r) => r.status === "draft").length;
    const sent = rows.filter((r) => r.status === "sent").length;
    const totalValue = rows.reduce((acc, r) => acc + Number(r.total_amount || 0), 0);
    const sentValue = rows
      .filter((r) => r.status === "sent")
      .reduce((acc, r) => acc + Number(r.total_amount || 0), 0);
    return { total, draft, sent, totalValue, sentValue };
  }, [rows]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this estimate? This can't be undone.")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/retail-estimates/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRows((r) => r.filter((x) => x.id !== id));
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Delete failed");
      }
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="p-6 sm:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--white)]">Retail Estimates</h1>
          <p className="text-xs text-[var(--gray-muted)] mt-1">
            Saved cash-job estimates. Click any row to reopen the builder.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="text-xs text-[var(--gray-muted)] hover:text-[var(--white)] px-3 py-2"
          >
            ← Dashboard
          </Link>
          <Link
            href="/dashboard/retail-estimate"
            className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-4 py-2 rounded-xl font-semibold transition-colors text-sm whitespace-nowrap"
          >
            + New Retail Estimate
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="glass-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">Total</p>
          <p className="text-3xl font-bold text-[var(--white)]">{stats.total}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">Drafts</p>
          <p className="text-3xl font-bold text-amber-400">{stats.draft}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">Sent</p>
          <p className="text-3xl font-bold text-[var(--cyan)]">{stats.sent}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">Sent Value</p>
          <p className="text-3xl font-bold text-[var(--white)] font-mono">{fmtUsd(stats.sentValue)}</p>
        </div>
      </div>

      {/* Filter + Search */}
      <div className="glass-card p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {(["all", "draft", "sent"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                filter === s
                  ? "bg-[var(--cyan)]/[0.12] border-[var(--cyan)]/40 text-[var(--cyan)]"
                  : "bg-white/[0.03] border-white/10 text-[var(--gray)] hover:bg-white/[0.06]"
              }`}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by customer / email / product…"
          className="flex-1 min-w-[200px] max-w-sm px-3 py-2 text-sm rounded-lg bg-white/[0.03] border border-white/10 text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:outline-none focus:border-[var(--cyan)]"
        />
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--gray-muted)]">Loading…</div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-red-400">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-[var(--gray-muted)]">
              {rows.length === 0 ? "No estimates saved yet." : "No estimates match your filter."}
            </p>
            {rows.length === 0 && (
              <Link
                href="/dashboard/retail-estimate"
                className="inline-block mt-3 text-xs text-[var(--cyan)] hover:text-white underline"
              >
                Create your first estimate →
              </Link>
            )}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--gray-muted)] border-b border-white/[0.06]">
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Product</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Total</th>
                <th className="px-4 py-3 font-semibold">Created</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => router.push(`/dashboard/retail-estimate?id=${r.id}`)}
                  className="border-t border-white/[0.04] hover:bg-white/[0.03] cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <p className="text-[var(--white)] font-medium">{r.customer_name || "(no name)"}</p>
                    {r.customer_email && (
                      <p className="text-[10px] text-[var(--gray-dim)] truncate">{r.customer_email}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--gray)]">{templateLabel(r.template_id)}</td>
                  <td className="px-4 py-3">
                    {r.status === "sent" ? (
                      <span className="px-2 py-0.5 rounded-full bg-[var(--cyan)]/[0.10] text-[var(--cyan)] border border-[var(--cyan)]/30 text-[10px]">
                        Sent {r.sent_at ? `· ${timeAgo(r.sent_at)}` : ""}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/[0.10] text-amber-400 border border-amber-500/30 text-[10px]">
                        Draft
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--white)] font-mono">{fmtUsd(Number(r.total_amount))}</td>
                  <td className="px-4 py-3 text-[var(--gray-dim)] whitespace-nowrap">{timeAgo(r.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/dashboard/retail-estimate/${r.id}/print`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[10px] text-[var(--gray-muted)] hover:text-white px-2"
                      >
                        Print
                      </Link>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(r.id);
                        }}
                        disabled={deleting === r.id}
                        className="text-[10px] text-red-400/70 hover:text-red-400 px-2 disabled:opacity-50"
                      >
                        {deleting === r.id ? "…" : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
