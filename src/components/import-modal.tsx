"use client";

import { useCallback, useRef, useState } from "react";

type Kind = "payments";
type Step = "pick-kind" | "upload" | "preview" | "committing" | "done" | "error";

interface PreviewResponse {
  import_run_id: string;
  counts: {
    total_source_rows: number;
    total_checks_parsed: number;
    matched_checks: number;
    unmatched_rows: number;
    sheets_processed: string[];
    will_insert: number;
    will_dedup: number;
  };
  staged_preview: Array<{
    claim_id: string;
    amount_cents: number;
    received_at: string;
    payor: string | null;
    source: string;
    _source_sheet: string;
    _source_row_index: number;
    _dedup?: boolean;
  }>;
  unmatched_preview: Array<{
    sheet: string;
    row_index: number;
    address: string | null;
    homeowner_name: string | null;
    carrier: string | null;
    payment_amount_cents: number | null;
    payment_date: string | null;
    reason: string;
  }>;
}

interface CommitResponse {
  ok: boolean;
  status: string;
  counts: {
    inserted: number;
    unmatched: number;
    dedup_skipped: number;
    errors: number;
  };
  insert_errors?: Array<{ batch: number; error: string }>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onApplied?: () => void;
}

function fmtCents(c: number | null): string {
  if (c == null) return "—";
  return `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ImportModal({ open, onClose, onApplied }: Props) {
  const [step, setStep] = useState<Step>("pick-kind");
  const [kind, setKind] = useState<Kind>("payments");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStep("pick-kind");
    setKind("payments");
    setFile(null);
    setPreview(null);
    setCommitResult(null);
    setError(null);
    setWorking(false);
  }, []);

  const handleClose = useCallback(() => {
    if (working) return;
    reset();
    onClose();
  }, [working, reset, onClose]);

  const uploadAndPreview = useCallback(async () => {
    if (!file) {
      setError("Pick a file first");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      const res = await fetch("/api/admin/import/preview", {
        method: "POST",
        body: form,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setPreview(body);
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
      setStep("error");
    } finally {
      setWorking(false);
    }
  }, [file, kind]);

  const commit = useCallback(async () => {
    if (!preview) return;
    setWorking(true);
    setError(null);
    setStep("committing");
    try {
      const res = await fetch("/api/admin/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ import_run_id: preview.import_run_id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setCommitResult(body);
      setStep("done");
      onApplied?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Commit failed");
      setStep("error");
    } finally {
      setWorking(false);
    }
  }, [preview, onApplied]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div
        className="glass-card w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-white">Import data</h2>
            <p className="text-xs text-[var(--gray-muted)] mt-1">
              Upload a CSV or XLSX. Preview first, commit only if the matches look right. Every
              import is recorded and can be rolled back later.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={working}
            className="text-[var(--gray-muted)] hover:text-white text-xl px-2 disabled:opacity-50"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {step === "pick-kind" && (
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-[var(--gray-muted)] mb-1">
              What kind of data?
            </label>
            <button
              type="button"
              onClick={() => {
                setKind("payments");
                setStep("upload");
              }}
              className="w-full text-left border border-[var(--border)] rounded-lg p-4 hover:bg-white/[0.03] transition-colors"
            >
              <div className="text-white font-semibold">Payments / Checks</div>
              <div className="text-xs text-[var(--gray-muted)] mt-1">
                Import customer payments from a spreadsheet — Kristen&apos;s NY Payment Ledger,
                QB exports, or a generic CSV with amount + date + address. Each check lands as
                a <code className="text-[var(--cyan)]">check_uploads</code> row tied to the
                matching claim.
              </div>
            </button>
            <div className="border border-dashed border-[var(--border)] rounded-lg p-4 opacity-60">
              <div className="text-white font-semibold">Install dates</div>
              <div className="text-xs text-[var(--gray-muted)] mt-1">
                Coming with AccuLynx live sync. For now, install dates are backfilled via the
                AccuLynx work-schedule pull.
              </div>
            </div>
          </div>
        )}

        {step === "upload" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--gray-muted)] mb-1">
                File ({kind})
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls,.tsv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-white file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-[var(--cyan)]/15 file:text-[var(--cyan)] file:font-semibold hover:file:bg-[var(--cyan)]/25 file:cursor-pointer"
              />
              {file && (
                <p className="mt-1 text-xs text-[var(--gray-muted)]">
                  {file.name} — {(file.size / 1024).toFixed(1)} KB
                </p>
              )}
            </div>
            <div className="rounded-lg border border-[var(--border)] p-3 text-xs text-[var(--gray-muted)] leading-relaxed">
              <strong className="text-white">What the parser looks for:</strong>
              <br />
              An <code>Address</code> column + either a <code>Ledger Check Details</code>{" "}
              column (semicolon-separated <code>$amount date payor; …</code> strings) or per-row
              <code> Amount</code> + <code>Date</code> + <code>Payor</code> columns. Multi-sheet
              workbooks are auto-detected.
            </div>
            {error && <div className="text-sm text-[var(--red-accent)]">{error}</div>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStep("pick-kind")}
                disabled={working}
                className="text-sm text-[var(--gray-muted)] hover:text-white px-3 py-1.5 disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={uploadAndPreview}
                disabled={!file || working}
                className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] text-white px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {working ? "Parsing…" : "Preview matches"}
              </button>
            </div>
          </div>
        )}

        {step === "preview" && preview && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <Stat label="Source rows" value={preview.counts.total_source_rows} />
              <Stat label="Checks parsed" value={preview.counts.total_checks_parsed} />
              <Stat
                label="Will insert"
                value={preview.counts.will_insert}
                color="var(--green)"
              />
              <Stat
                label="Will dedup-skip"
                value={preview.counts.will_dedup}
                color="var(--amber)"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <Stat
                label="Matched checks"
                value={preview.counts.matched_checks}
                color="var(--cyan)"
              />
              <Stat
                label="Unmatched rows"
                value={preview.counts.unmatched_rows}
                color="var(--red-accent)"
              />
            </div>
            <p className="text-xs text-[var(--gray-muted)]">
              Sheets parsed: {preview.counts.sheets_processed.join(", ") || "—"}
            </p>

            {preview.staged_preview.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[var(--gray-muted)] mb-2">
                  Sample of matched rows (first {Math.min(10, preview.staged_preview.length)}):
                </p>
                <div className="max-h-48 overflow-y-auto border border-[var(--border)] rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="text-[var(--gray-muted)] bg-white/[0.02]">
                      <tr>
                        <th className="text-left p-1.5">Date</th>
                        <th className="text-right p-1.5">Amount</th>
                        <th className="text-left p-1.5">Payor</th>
                        <th className="text-left p-1.5">Source</th>
                        <th className="text-left p-1.5">Sheet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.staged_preview.slice(0, 10).map((r, i) => (
                        <tr key={i} className={r._dedup ? "opacity-50" : ""}>
                          <td className="p-1.5 text-white">{r.received_at}</td>
                          <td className="p-1.5 text-right text-[var(--green)]">
                            {fmtCents(r.amount_cents)}
                          </td>
                          <td className="p-1.5 text-[var(--gray-muted)]">{r.payor || "—"}</td>
                          <td className="p-1.5 text-[var(--gray-muted)]">{r.source}</td>
                          <td className="p-1.5 text-[var(--gray-muted)]">
                            {r._source_sheet}
                            {r._dedup && (
                              <span className="ml-1 text-[var(--amber)]">(dedup)</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {preview.unmatched_preview.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[var(--gray-muted)] mb-2">
                  Sample of unmatched rows (first{" "}
                  {Math.min(5, preview.unmatched_preview.length)}) — these go to{" "}
                  <a
                    href="/dashboard/admin/imports/unmatched"
                    className="text-[var(--cyan)] hover:underline"
                  >
                    triage
                  </a>{" "}
                  for manual review:
                </p>
                <div className="max-h-32 overflow-y-auto border border-[var(--border)] rounded-lg">
                  <table className="w-full text-xs">
                    <tbody>
                      {preview.unmatched_preview.slice(0, 5).map((u, i) => (
                        <tr key={i}>
                          <td className="p-1.5 text-white">{u.address || "—"}</td>
                          <td className="p-1.5 text-[var(--gray-muted)]">
                            {u.homeowner_name || "—"}
                          </td>
                          <td className="p-1.5 text-right text-[var(--gray-muted)]">
                            {fmtCents(u.payment_amount_cents)}
                          </td>
                          <td className="p-1.5 text-[var(--red-accent)] text-xs">
                            {u.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep("upload")}
                disabled={working}
                className="text-sm text-[var(--gray-muted)] hover:text-white px-3 py-1.5 disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={commit}
                disabled={working || preview.counts.will_insert === 0}
                className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] text-white px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                Commit {preview.counts.will_insert} row{preview.counts.will_insert === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        )}

        {step === "committing" && (
          <div className="py-8 text-center text-sm text-[var(--gray-muted)]">
            Committing…
          </div>
        )}

        {step === "done" && commitResult && (
          <div className="space-y-4">
            <div className="text-center py-6">
              <div className="text-4xl mb-2">✓</div>
              <div className="text-lg font-semibold text-white">Import applied</div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <Stat
                label="Inserted"
                value={commitResult.counts.inserted}
                color="var(--green)"
              />
              <Stat
                label="Unmatched"
                value={commitResult.counts.unmatched}
                color="var(--amber)"
              />
              <Stat
                label="Dedup skipped"
                value={commitResult.counts.dedup_skipped}
              />
              <Stat
                label="Errors"
                value={commitResult.counts.errors}
                color={commitResult.counts.errors > 0 ? "var(--red-accent)" : undefined}
              />
            </div>
            {commitResult.insert_errors && commitResult.insert_errors.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-[var(--red-accent)]">
                  {commitResult.insert_errors.length} batch error(s)
                </summary>
                <pre className="mt-2 p-2 bg-black/40 rounded overflow-x-auto text-[var(--red-accent)]">
                  {JSON.stringify(commitResult.insert_errors, null, 2)}
                </pre>
              </details>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] text-white px-4 py-1.5 rounded-lg text-sm font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {step === "error" && (
          <div className="space-y-3">
            <p className="text-sm text-[var(--red-accent)]">{error}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStep("upload")}
                className="text-sm text-[var(--cyan)] hover:text-white px-3 py-1.5"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="text-sm text-[var(--gray-muted)] hover:text-white px-3 py-1.5"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--gray-muted)]">{label}</div>
      <div
        className="text-lg font-semibold"
        style={{ color: color ?? "white" }}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}
