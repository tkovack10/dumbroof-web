"use client";

import type { Repair } from "@/types/repair";
import { REPAIR_TYPE_LABELS, REPAIR_SEVERITY_COLORS, REPAIR_STATUS_CONFIG, getRepairDisplayState } from "@/lib/claim-constants";

interface RepairTabContentProps {
  repairs: Repair[];
  loading: boolean;
  downloading: string | null;
  onDownload: (repair: Repair, filename: string) => void;
  onDownloadAll: (repair: Repair) => void;
}

function fmtMoney(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

export function RepairTabContent({
  repairs,
  loading,
  downloading,
  onDownload,
  onDownloadAll,
}: RepairTabContentProps) {
  const totalRepairs = repairs.length;
  const readyCount = repairs.filter((r) => r.status === "ready").length;
  const totalRevenue = repairs
    .filter((r) => r.status === "ready" && r.total_price)
    .reduce((sum, r) => sum + (r.total_price || 0), 0);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 text-center py-16">
        <p className="text-gray-400 text-sm">Loading repairs...</p>
      </div>
    );
  }

  if (repairs.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 text-center py-16 px-8">
        <div className="w-16 h-16 rounded-2xl bg-blue-50 border-2 border-dashed border-blue-200 flex items-center justify-center mx-auto mb-5">
          <svg className="w-8 h-8 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.66-5.66a8 8 0 1111.31 0l-5.65 5.66zm0 0L12 21" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-[var(--navy)] mb-2">No repairs yet</h3>
        <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
          Upload photos of a roof leak and AI will diagnose it, generate repair instructions for your crew, and a professional repair ticket for the homeowner.
        </p>
        <a href="/dashboard/new-repair" className="inline-block bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-8 py-3 rounded-xl font-semibold transition-colors text-sm">
          Submit First Repair
        </a>
      </div>
    );
  }

  return (
    <>
      {/* Repair KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 text-center">
          <p className="text-2xl font-bold text-[var(--navy)]">{totalRepairs}</p>
          <p className="text-xs text-gray-500 mt-1">Total Repairs</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 text-center">
          <p className="text-2xl font-bold text-green-600">{readyCount}</p>
          <p className="text-xs text-gray-500 mt-1">Completed</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 text-center">
          <p className="text-2xl font-bold text-[var(--navy)]">{fmtMoney(totalRevenue)}</p>
          <p className="text-xs text-gray-500 mt-1">Total Revenue</p>
        </div>
      </div>

      {/* Repair Cards */}
      <div className="space-y-4">
        {repairs.map((repair) => {
          const displayState = getRepairDisplayState(repair);
          const sc = REPAIR_STATUS_CONFIG[repair.status] || REPAIR_STATUS_CONFIG.uploaded;
          const isReady = repair.status === "ready" && repair.output_files?.length;
          const isProcessing = repair.status === "processing" || repair.status === "uploaded";
          const isActive = repair.status === "active";
          const severityColor = repair.severity ? REPAIR_SEVERITY_COLORS[repair.severity] : null;
          const hasCheckpoints = (repair.checkpoint_count ?? 0) > 0;

          return (
            <div key={repair.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              {/* Repair Header */}
              <div className="px-6 py-4 flex items-center justify-between">
                <a href={`/dashboard/repair/${repair.id}`} className="flex items-center gap-4 hover:opacity-80 transition-opacity min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="text-sm font-semibold text-[var(--navy)] truncate">
                        {repair.address}
                      </h3>
                      {repair.total_price ? (
                        <span className="text-xs font-bold text-[var(--navy)] bg-gray-100 px-2 py-0.5 rounded shrink-0">
                          ${repair.total_price.toLocaleString("en-US", { minimumFractionDigits: 0 })}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      {repair.homeowner_name}
                      {repair.repair_type && (
                        <> &middot; {REPAIR_TYPE_LABELS[repair.repair_type] || repair.repair_type}</>
                      )}
                      {" "}&middot; {new Date(repair.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </a>
                <div className="flex items-center gap-2 shrink-0">
                  {severityColor && (
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${severityColor} capitalize`}>
                      {repair.severity}
                    </span>
                  )}
                  {hasCheckpoints && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700">
                      CP {repair.checkpoint_count}
                      {(repair.pivot_count ?? 0) > 0 && ` · ${repair.pivot_count} pivot${repair.pivot_count! > 1 ? "s" : ""}`}
                    </span>
                  )}
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${displayState.color}`}>
                    {(isProcessing || displayState.polling) && (
                      <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    )}
                    {displayState.label}
                  </span>
                  {isReady && (
                    <button
                      onClick={() => onDownloadAll(repair)}
                      className="bg-[var(--navy)] hover:bg-[var(--navy-light)] text-white px-4 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    >
                      Download All
                    </button>
                  )}
                </div>
              </div>

              {/* Output Files */}
              {isReady && (
                <div className="px-6 pb-4">
                  <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                    <p className="text-xs font-semibold text-green-800 mb-3">Repair documents ready</p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {repair.output_files!.map((file) => {
                        const isInstructions = file.includes("INSTRUCTIONS");
                        const label = isInstructions ? "Roofer Instructions" : file.replace(/_/g, " ").replace(".pdf", "");
                        return (
                          <button
                            key={file}
                            onClick={() => onDownload(repair, file)}
                            disabled={downloading === file}
                            className="flex items-center gap-2 bg-white border border-green-200 rounded-lg px-3 py-2 text-left hover:bg-green-50 transition-colors disabled:opacity-50"
                          >
                            <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="text-xs text-gray-700 truncate">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Processing */}
              {isProcessing && (
                <div className="px-6 pb-4">
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                    <div className="flex items-center gap-3">
                      <svg className="animate-spin w-5 h-5 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <div>
                        <p className="text-sm font-medium text-amber-800">AI is diagnosing the leak...</p>
                        <p className="text-xs text-amber-600 mt-0.5">Typically 1-2 minutes</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Active — checkpoint in progress */}
              {isActive && (
                <div className="px-6 pb-4">
                  <a href={`/dashboard/repair/${repair.id}`} className="block">
                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 hover:bg-blue-100 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          AI
                        </div>
                        <div>
                          <p className="text-sm font-medium text-blue-800">
                            {displayState.label === "Awaiting Photos" ? "Checkpoint awaiting your photos" : displayState.label === "AI Reviewing" ? "AI is reviewing checkpoint photos..." : "Repair in progress"}
                          </p>
                          <p className="text-xs text-blue-600 mt-0.5">
                            Tap to view timeline and upload photos
                          </p>
                        </div>
                      </div>
                    </div>
                  </a>
                </div>
              )}

              {/* Error */}
              {repair.status === "error" && (
                <div className="px-6 pb-4">
                  <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                    <p className="text-sm text-red-700">
                      {repair.error_message || "Diagnosis failed. Try submitting with clearer photos."}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
