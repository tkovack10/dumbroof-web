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
  status: string;
  created_at: string;
  sent_at: string | null;
  signed_at: string | null;
  stripe_invoice_url: string | null;
  stripe_invoice_status: string | null;
}

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "signed", label: "Signed" },
  { key: "invoiced", label: "Invoiced" },
  { key: "paid", label: "Paid" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "archived", label: "Archived" },
];

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  draft: { bg: "bg-amber-500/[0.10]", text: "text-amber-400", border: "border-amber-500/30" },
  sent: { bg: "bg-[var(--cyan)]/[0.10]", text: "text-[var(--cyan)]", border: "border-[var(--cyan)]/30" },
  signed: { bg: "bg-green-500/[0.10]", text: "text-green-400", border: "border-green-500/30" },
  invoiced: { bg: "bg-[var(--purple)]/[0.10]", text: "text-[var(--purple)]", border: "border-[var(--purple)]/30" },
  paid: { bg: "bg-green-500/[0.15]", text: "text-green-300", border: "border-green-500/40" },
  won: { bg: "bg-green-500/[0.20]", text: "text-green-200", border: "border-green-500/50" },
  lost: { bg: "bg-red-500/[0.10]", text: "text-red-400", border: "border-red-500/30" },
  archived: { bg: "bg-white/[0.05]", text: "text-[var(--gray-muted)]", border: "border-white/10" },
};

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

const PAGE_SIZE = 50;

export function RetailEstimatesList() {
  const router = useRouter();
  const [rows, setRows] = useState<EstimateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (offset = 0, append = false) => {
    if (append) setLoadingMore(true);
    try {
      const url = new URL("/api/retail-estimates", window.location.origin);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("offset", String(offset));
      if (filter !== "all") url.searchParams.set("status", filter);
      const res = await fetch(url.toString());
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load");
        return;
      }
      setRows((prev) => (append ? [...prev, ...(data.estimates || [])] : data.estimates || []));
      setTotal(data.total || 0);
      setHasMore(!!data.has_more);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    load(0, false);
  }, [load]);

  async function handleStatusChange(id: string, newStatus: string) {
    setChangingStatus(id);
    try {
      const res = await fetch(`/api/retail-estimates/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setRows((r) => r.map((x) => (x.id === id ? { ...x, status: newStatus } : x)));
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Status change failed");
      }
    } finally {
      setChangingStatus(null);
    }
  }

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
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setFilter(s.key)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                filter === s.key
                  ? "bg-[var(--cyan)]/[0.12] border-[var(--cyan)]/40 text-[var(--cyan)]"
                  : "bg-white/[0.03] border-white/10 text-[var(--gray)] hover:bg-white/[0.06]"
              }`}
            >
              {s.label}
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
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={r.status}
                      disabled={changingStatus === r.id}
                      onChange={(e) => handleStatusChange(r.id, e.target.value)}
                      className={`text-[10px] px-2 py-1 rounded-full border bg-transparent appearance-none cursor-pointer pr-6 ${
                        (STATUS_COLORS[r.status] || STATUS_COLORS.draft).bg
                      } ${(STATUS_COLORS[r.status] || STATUS_COLORS.draft).text} ${
                        (STATUS_COLORS[r.status] || STATUS_COLORS.draft).border
                      }`}
                      style={{ backgroundImage: "url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='currentColor'%3e%3cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z' clip-rule='evenodd'/%3e%3c/svg%3e\")", backgroundPosition: "right 0.25rem center", backgroundRepeat: "no-repeat", backgroundSize: "1em" }}
                    >
                      {STATUS_FILTERS.filter((s) => s.key !== "all").map((s) => (
                        <option key={s.key} value={s.key} style={{ background: "#0d2137" }}>
                          {s.label}
                        </option>
                      ))}
                    </select>
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

        {/* Load more */}
        {!loading && !error && rows.length > 0 && hasMore && (
          <div className="border-t border-white/[0.04] p-4 text-center">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => load(rows.length, true)}
              className="text-xs px-4 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-[var(--gray)] hover:bg-white/[0.10] disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : `Load more (${total - rows.length} remaining)`}
            </button>
          </div>
        )}
        {!loading && !error && rows.length > 0 && !hasMore && rows.length === total && total > PAGE_SIZE && (
          <div className="border-t border-white/[0.04] p-3 text-center text-[10px] text-[var(--gray-dim)]">
            Showing all {total} estimates
          </div>
        )}
      </div>
    </div>
  );
}
