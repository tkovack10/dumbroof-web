"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface EstimateRow {
  id: string;
  template_id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_address: string | null;
  total_amount: number;
  markup_pct: number | null;
  status: string;
  created_at: string;
  sent_at: string | null;
}

const PAGE_SIZE = 50;

type StatusFilter =
  | "all"
  | "draft"
  | "sent"
  | "accepted"
  | "declined"
  | "expired"
  | "signed"
  | "paid";

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "signed", label: "Signed" },
  { value: "paid", label: "Paid" },
];

interface StatusStyle {
  text: string;
  bg: string;
  border: string;
  label: string;
}

function statusStyle(s: string): StatusStyle {
  switch (s) {
    case "sent":
      return {
        text: "text-[var(--cyan)]",
        bg: "bg-[var(--cyan)]/[0.10]",
        border: "border-[var(--cyan)]/30",
        label: "Sent",
      };
    case "accepted":
      return {
        text: "text-green-300",
        bg: "bg-green-500/[0.10]",
        border: "border-green-500/30",
        label: "Accepted",
      };
    case "declined":
      return {
        text: "text-red-300",
        bg: "bg-red-500/[0.10]",
        border: "border-red-500/30",
        label: "Declined",
      };
    case "expired":
      return {
        text: "text-[var(--gray-muted)]",
        bg: "bg-white/[0.04]",
        border: "border-white/10",
        label: "Expired",
      };
    case "signed":
      return {
        text: "text-purple-300",
        bg: "bg-purple-500/[0.10]",
        border: "border-purple-500/30",
        label: "Signed",
      };
    case "paid":
      return {
        text: "text-emerald-300",
        bg: "bg-emerald-500/[0.10]",
        border: "border-emerald-500/30",
        label: "Paid",
      };
    default:
      return {
        text: "text-amber-400",
        bg: "bg-amber-500/[0.10]",
        border: "border-amber-500/30",
        label: "Draft",
      };
  }
}

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
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
  return id
    .replace(/^retail-/, "")
    .split("-")
    .map((w) =>
      w === "oc" ? "OC" : w === "gaf" ? "GAF" : w === "ct" ? "CertainTeed" : w === "hdz" ? "HDZ" : w[0]?.toUpperCase() + w.slice(1),
    )
    .join(" ");
}

export function RetailEstimatesList() {
  const router = useRouter();
  const [rows, setRows] = useState<EstimateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const load = useCallback(async (offset = 0, append = false, filter: StatusFilter = "all") => {
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
  }, []);

  useEffect(() => {
    setLoading(true);
    load(0, false, statusFilter);
  }, [load, statusFilter]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (!search.trim()) return true;
      const s = search.toLowerCase();
      return (
        (r.customer_name || "").toLowerCase().includes(s) ||
        (r.customer_email || "").toLowerCase().includes(s) ||
        (r.customer_address || "").toLowerCase().includes(s) ||
        r.template_id.toLowerCase().includes(s)
      );
    });
  }, [rows, search]);

  const stats = useMemo(() => {
    const totalCount = rows.length;
    const draft = rows.filter((r) => r.status === "draft").length;
    const sent = rows.filter((r) => r.status === "sent").length;
    const accepted = rows.filter((r) => r.status === "accepted").length;
    const closed = rows.filter((r) => r.status === "signed" || r.status === "paid").length;
    const totalValue = rows.reduce((acc, r) => acc + Number(r.total_amount || 0), 0);
    return { total: totalCount, draft, sent, accepted, closed, totalValue };
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

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
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
          <p className="text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">Accepted</p>
          <p className="text-3xl font-bold text-green-300">{stats.accepted}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">Total Value</p>
          <p className="text-3xl font-bold text-[var(--white)] font-mono">{fmtUsd(stats.totalValue)}</p>
        </div>
      </div>

      <div className="glass-card p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                statusFilter === f.value
                  ? "bg-[var(--cyan)]/[0.15] border-[var(--cyan)] text-[var(--cyan)]"
                  : "bg-white/[0.03] border-white/10 text-[var(--gray)] hover:text-[var(--white)] hover:border-white/30"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by address / customer / email / product…"
          className="w-full max-w-sm px-3 py-2 text-sm rounded-lg bg-white/[0.03] border border-white/10 text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:outline-none focus:border-[var(--cyan)]"
        />
      </div>

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
                <th className="px-4 py-3 font-semibold">Property / Customer</th>
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
                    <p className="text-[var(--white)] font-medium truncate" title={r.customer_address || ""}>
                      {r.customer_address || "(no address)"}
                    </p>
                    <p className="text-[11px] text-[var(--gray)] truncate">
                      {r.customer_name || "(no name)"}
                    </p>
                    {r.customer_email && (
                      <p className="text-[10px] text-[var(--gray-dim)] truncate">{r.customer_email}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--gray)]">{templateLabel(r.template_id)}</td>
                  <td className="px-4 py-3">
                    {(() => {
                      const st = statusStyle(r.status);
                      return (
                        <span
                          className={`px-2 py-0.5 rounded-full ${st.bg} ${st.text} border ${st.border} text-[10px]`}
                        >
                          {st.label}
                          {r.status === "sent" && r.sent_at ? ` · ${timeAgo(r.sent_at)}` : ""}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--white)] font-mono">
                    {fmtUsd(Number(r.total_amount))}
                  </td>
                  <td className="px-4 py-3 text-[var(--gray-dim)] whitespace-nowrap">{timeAgo(r.created_at)}</td>
                  <td className="px-4 py-3 text-right">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!loading && !error && rows.length > 0 && hasMore && (
          <div className="border-t border-white/[0.04] p-4 text-center">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => load(rows.length, true, statusFilter)}
              className="text-xs px-4 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-[var(--gray)] hover:bg-white/[0.10] disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : `Load more (${total - rows.length} remaining)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
