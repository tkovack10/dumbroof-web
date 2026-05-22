"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ImportModal } from "@/components/import-modal";

type ImportRun = {
  id: string;
  kind: "installs" | "payments" | "expenses";
  source: string;
  source_filename: string | null;
  row_count: number | null;
  matched_count: number | null;
  dedup_count: number | null;
  unmatched_count: number | null;
  error_count: number | null;
  status: "preview" | "applied" | "rolled_back" | "failed";
  applied_at: string | null;
  rolled_back_at: string | null;
  created_at: string;
};

const STATUS_COLORS: Record<ImportRun["status"], string> = {
  applied: "var(--green)",
  preview: "var(--gray-muted)",
  rolled_back: "var(--amber)",
  failed: "var(--red-accent)",
};

const KIND_COLORS: Record<ImportRun["kind"], string> = {
  installs: "var(--cyan)",
  payments: "var(--green)",
  expenses: "var(--purple)",
};

export default function ImportsPage() {
  const [runs, setRuns] = useState<ImportRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [unmatchedCount, setUnmatchedCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/import/runs?status=all");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const body = await res.json();
      setRuns(body.runs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUnmatchedCount = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/import/unmatched?status=pending");
      if (res.ok) {
        const body = await res.json();
        setUnmatchedCount((body.rows || []).length);
      }
    } catch {
      // Silent — the badge is informational.
    }
  }, []);

  useEffect(() => {
    load();
    loadUnmatchedCount();
  }, [load, loadUnmatchedCount]);

  const rollback = useCallback(
    async (runId: string) => {
      if (!confirm(
        "Roll back this import? All check_uploads / production_schedules / job_expenses rows " +
        "tagged with this import run will be deleted. Unmatched triage rows are also removed."
      )) return;
      setRollingBack(runId);
      try {
        const res = await fetch(`/api/admin/import/rollback/${runId}`, { method: "POST" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        await load();
        loadUnmatchedCount();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Rollback failed");
      } finally {
        setRollingBack(null);
      }
    },
    [load, loadUnmatchedCount]
  );

  function fmtTime(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleString();
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
        </div>

        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold gradient-text">Imports</h1>
            <p className="text-[var(--gray-muted)] mt-1 text-sm">
              Bulk-import payments / installs / expenses from CSV or XLSX. Every run is
              recorded, dedup-safe, and rollback-safe.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/admin/imports/unmatched"
              className="text-sm text-[var(--cyan)] hover:text-white px-3 py-2 rounded-lg border border-[var(--border)] hover:bg-white/[0.03] transition-colors"
            >
              Triage queue{unmatchedCount != null ? ` (${unmatchedCount})` : ""} →
            </Link>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
            >
              + New import
            </button>
          </div>
        </div>

        {loading && (
          <div className="glass-card p-8 text-center text-sm text-[var(--gray-muted)]">
            Loading…
          </div>
        )}
        {error && (
          <div className="glass-card p-8 text-center text-sm text-[var(--red-accent)]">
            {error}
          </div>
        )}

        {!loading && !error && runs.length === 0 && (
          <div className="glass-card p-8 text-center">
            <p className="text-base font-semibold text-white mb-2">No imports yet</p>
            <p className="text-sm text-[var(--gray-muted)] max-w-md mx-auto">
              Click <em>+ New import</em> to upload a payments spreadsheet. The first preview
              step shows every row + match status before anything writes to the DB.
            </p>
          </div>
        )}

        {!loading && runs.length > 0 && (
          <div className="glass-card p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-[var(--gray-muted)] border-b border-[var(--border)]">
                  <tr>
                    <th className="text-left py-2 px-2">When</th>
                    <th className="text-left py-2 px-2">Kind</th>
                    <th className="text-left py-2 px-2">Source</th>
                    <th className="text-left py-2 px-2">File</th>
                    <th className="text-right py-2 px-2">Rows</th>
                    <th className="text-right py-2 px-2">Matched</th>
                    <th className="text-right py-2 px-2">Unmatched</th>
                    <th className="text-right py-2 px-2">Dedup</th>
                    <th className="text-left py-2 px-2">Status</th>
                    <th className="text-right py-2 px-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-[var(--border)]/40 hover:bg-white/[0.02]"
                    >
                      <td className="py-2 px-2 text-xs text-[var(--gray-muted)] whitespace-nowrap">
                        {fmtTime(r.applied_at ?? r.created_at)}
                      </td>
                      <td className="py-2 px-2">
                        <span
                          className="text-xs px-2 py-0.5 rounded"
                          style={{
                            backgroundColor: `${KIND_COLORS[r.kind]}25`,
                            color: KIND_COLORS[r.kind],
                          }}
                        >
                          {r.kind}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-xs text-[var(--gray-muted)]">
                        {r.source}
                      </td>
                      <td className="py-2 px-2 text-xs text-white max-w-xs truncate" title={r.source_filename ?? ""}>
                        {r.source_filename || "—"}
                      </td>
                      <td className="py-2 px-2 text-right text-xs">{r.row_count ?? "—"}</td>
                      <td className="py-2 px-2 text-right text-xs text-[var(--green)]">
                        {r.matched_count ?? 0}
                      </td>
                      <td className="py-2 px-2 text-right text-xs text-[var(--amber)]">
                        {r.unmatched_count ?? 0}
                      </td>
                      <td className="py-2 px-2 text-right text-xs text-[var(--gray-muted)]">
                        {r.dedup_count ?? 0}
                      </td>
                      <td className="py-2 px-2">
                        <span
                          className="text-xs font-semibold uppercase tracking-wide"
                          style={{ color: STATUS_COLORS[r.status] }}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right">
                        {r.status === "applied" && (
                          <button
                            type="button"
                            onClick={() => rollback(r.id)}
                            disabled={rollingBack === r.id}
                            className="text-xs text-[var(--red-accent)] hover:text-white px-2 py-1 disabled:opacity-50"
                          >
                            {rollingBack === r.id ? "Rolling back…" : "Roll back"}
                          </button>
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

      <ImportModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onApplied={() => {
          load();
          loadUnmatchedCount();
        }}
      />
    </div>
  );
}
