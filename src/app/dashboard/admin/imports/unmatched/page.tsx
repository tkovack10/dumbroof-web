"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";

type UnmatchedRow = {
  id: string;
  import_run_id: string;
  kind: "installs" | "payments";
  address: string | null;
  homeowner_name: string | null;
  carrier: string | null;
  job_number: string | null;
  claim_number: string | null;
  payment_amount_cents: number | null;
  payment_date: string | null;
  install_date: string | null;
  status: string;
  created_at: string;
};

type Candidate = { id: string; address: string };

function fmtCents(c: number | null): string {
  if (c == null) return "—";
  return `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function UnmatchedImportsPage() {
  const [rows, setRows] = useState<UnmatchedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<"all" | "installs" | "payments">("all");
  const [statusFilter, setStatusFilter] = useState<"pending" | "dismissed" | "all">("pending");
  const [acting, setActing] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Record<string, Candidate[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ kind: kindFilter, status: statusFilter });
      const res = await fetch(`/api/admin/import/unmatched?${params}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const body = await res.json();
      setRows(body.rows || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [kindFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  // Debounce per-row so typing "92 Helen St" fires 1 request, not 11.
  // Also stamps each request with a token so a late response can't overwrite
  // a newer query's result.
  const searchTokensRef = useRef<Record<string, number>>({});
  const searchTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function searchClaims(rowId: string, query: string) {
    const existing = searchTimersRef.current[rowId];
    if (existing) clearTimeout(existing);
    if (!query.trim()) {
      setCandidates(c => ({ ...c, [rowId]: [] }));
      return;
    }
    searchTimersRef.current[rowId] = setTimeout(async () => {
      const token = (searchTokensRef.current[rowId] ?? 0) + 1;
      searchTokensRef.current[rowId] = token;
      const res = await fetch(`/api/claims/search?q=${encodeURIComponent(query)}&limit=10`);
      // Drop the response if a newer search has already kicked off.
      if (searchTokensRef.current[rowId] !== token) return;
      if (res.ok) {
        const body = await res.json();
        setCandidates(c => ({
          ...c,
          [rowId]: (body.claims || []).map((claim: { id: string; address: string }) => ({
            id: claim.id,
            address: claim.address,
          })),
        }));
      }
    }, 250);
  }

  async function callConvert(rowId: string, action: string, claimId?: string) {
    setActing(rowId);
    try {
      const res = await fetch(`/api/admin/import/unmatched/${rowId}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, claim_id: claimId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (body.redirect_to) {
        window.location.href = body.redirect_to;
        return;
      }
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(null);
      setAttaching(null);
    }
  }

  return (
    <div className="p-6 lg:p-8 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="mb-4 pl-10 lg:pl-0">
          <Link
            href="/dashboard/admin"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--gray-muted)] hover:text-white mb-3 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Admin
          </Link>
          <h1 className="text-2xl font-bold gradient-text">Import triage</h1>
          <p className="text-[var(--gray-muted)] mt-1 text-sm">
            Rows from CSV/AccuLynx imports that couldn&apos;t be matched to an existing claim.
            Promote them to a claim or retail estimate, or dismiss.
          </p>
        </div>

        <div className="flex gap-2 mb-4 text-xs">
          <select
            value={kindFilter}
            onChange={e => setKindFilter(e.target.value as "all" | "installs" | "payments")}
            className="bg-[var(--bg-panel)] border border-[var(--border)] rounded px-2 py-1 text-white"
          >
            <option value="all">All kinds</option>
            <option value="payments">Payments only</option>
            <option value="installs">Installs only</option>
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as "pending" | "dismissed" | "all")}
            className="bg-[var(--bg-panel)] border border-[var(--border)] rounded px-2 py-1 text-white"
          >
            <option value="pending">Pending</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All statuses</option>
          </select>
          <span className="ml-auto text-[var(--gray-muted)] self-center">
            {rows.length} row{rows.length === 1 ? "" : "s"}
          </span>
        </div>

        {loading && <div className="glass-card p-8 text-center text-sm text-[var(--gray-muted)]">Loading…</div>}
        {error && <div className="glass-card p-8 text-center text-sm text-[var(--red-accent)]">{error}</div>}

        {!loading && !error && rows.length === 0 && (
          <div className="glass-card p-8 text-center text-sm text-[var(--gray-muted)]">
            No {statusFilter !== "all" ? statusFilter + " " : ""}unmatched rows. Nice.
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="glass-card p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-[var(--gray-muted)] border-b border-[var(--border)]">
                  <tr>
                    <th className="text-left py-2 px-2">Kind</th>
                    <th className="text-left py-2 px-2">Address</th>
                    <th className="text-left py-2 px-2">Customer</th>
                    <th className="text-left py-2 px-2">Job#</th>
                    <th className="text-right py-2 px-2">Date</th>
                    <th className="text-right py-2 px-2">Amount</th>
                    <th className="text-right py-2 px-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-b border-[var(--border)]/40 hover:bg-white/[0.02]">
                      <td className="py-2 px-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${r.kind === "payments" ? "bg-[var(--green)]/15 text-[var(--green)]" : "bg-[var(--cyan)]/15 text-[var(--cyan)]"}`}>
                          {r.kind}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-white">{r.address || "—"}</td>
                      <td className="py-2 px-2 text-[var(--gray-muted)]">{r.homeowner_name || "—"}</td>
                      <td className="py-2 px-2 text-[var(--gray-muted)] text-xs">{r.job_number || "—"}</td>
                      <td className="py-2 px-2 text-right text-xs text-[var(--gray-muted)]">
                        {r.kind === "payments" ? (r.payment_date || "—") : (r.install_date || "—")}
                      </td>
                      <td className="py-2 px-2 text-right text-[var(--green)]">{fmtCents(r.payment_amount_cents)}</td>
                      <td className="py-2 px-2 text-right">
                        {r.status === "pending" ? (
                          <div className="flex flex-col gap-1 items-end">
                            {attaching === r.id ? (
                              <AttachClaimPicker
                                rowId={r.id}
                                candidates={candidates[r.id] || []}
                                onSearch={q => searchClaims(r.id, q)}
                                onPick={cid => callConvert(r.id, "attach_existing", cid)}
                                onCancel={() => setAttaching(null)}
                                disabled={acting === r.id}
                              />
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="text-xs text-[var(--cyan)] hover:text-white px-2 py-0.5 disabled:opacity-50"
                                  disabled={acting === r.id}
                                  onClick={() => setAttaching(r.id)}
                                >
                                  Attach to claim…
                                </button>
                                <button
                                  type="button"
                                  className="text-xs text-[var(--cyan)] hover:text-white px-2 py-0.5 disabled:opacity-50"
                                  disabled={acting === r.id}
                                  onClick={() => callConvert(r.id, "create_claim")}
                                >
                                  Create claim →
                                </button>
                                <button
                                  type="button"
                                  className="text-xs text-[var(--cyan)] hover:text-white px-2 py-0.5 disabled:opacity-50"
                                  disabled={acting === r.id}
                                  onClick={() => callConvert(r.id, "create_retail")}
                                >
                                  Create retail →
                                </button>
                                <button
                                  type="button"
                                  className="text-xs text-[var(--gray-muted)] hover:text-[var(--red-accent)] px-2 py-0.5 disabled:opacity-50"
                                  disabled={acting === r.id}
                                  onClick={() => callConvert(r.id, "dismiss")}
                                >
                                  Dismiss
                                </button>
                              </>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--gray-muted)]">{r.status}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface AttachProps {
  rowId: string;
  candidates: Candidate[];
  onSearch: (q: string) => void;
  onPick: (claimId: string) => void;
  onCancel: () => void;
  disabled: boolean;
}

function AttachClaimPicker({ candidates, onSearch, onPick, onCancel, disabled }: AttachProps) {
  const [q, setQ] = useState("");
  return (
    <div className="flex flex-col gap-1 items-end w-64">
      <input
        type="text"
        autoFocus
        placeholder="Search claim address…"
        value={q}
        onChange={e => {
          setQ(e.target.value);
          onSearch(e.target.value);
        }}
        disabled={disabled}
        className="bg-[var(--bg-panel)] border border-[var(--border)] rounded px-2 py-1 text-xs text-white w-full"
      />
      {candidates.length > 0 && (
        <div className="w-full max-h-32 overflow-y-auto bg-[var(--bg-panel)] border border-[var(--border)] rounded">
          {candidates.map(c => (
            <button
              key={c.id}
              type="button"
              className="block w-full text-left text-xs px-2 py-1 hover:bg-white/5 text-white"
              onClick={() => onPick(c.id)}
              disabled={disabled}
            >
              {c.address}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="text-xs text-[var(--gray-muted)] hover:text-white"
        onClick={onCancel}
        disabled={disabled}
      >
        Cancel
      </button>
    </div>
  );
}
