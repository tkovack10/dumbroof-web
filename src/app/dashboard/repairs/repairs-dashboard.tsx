"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Repair } from "@/types/repair";
import { REPAIR_TYPE_LABELS, REPAIR_SEVERITY_COLORS, REPAIR_STATUS_CONFIG } from "@/lib/claim-constants";

export function RepairsDashboard({ user }: { user: User }) {
  const supabase = createClient();
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  const fetchRepairs = useCallback(async () => {
    const { data } = await supabase
      .from("repairs")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setRepairs(data || []);
    setLoading(false);
  }, [user.id, supabase]);

  useEffect(() => {
    fetchRepairs();
    const interval = setInterval(fetchRepairs, 5000);
    return () => clearInterval(interval);
  }, [fetchRepairs]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const handleDownload = async (repair: Repair, filename: string) => {
    setDownloading(filename);
    try {
      const path = `${repair.file_path}/output/${filename}`;
      const { data, error } = await supabase.storage
        .from("claim-documents")
        .download(path);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    }
    setDownloading(null);
  };

  const handleDownloadAll = async (repair: Repair) => {
    if (!repair.output_files) return;
    for (const file of repair.output_files) {
      await handleDownload(repair, file);
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  const statusConfig = REPAIR_STATUS_CONFIG;

  // Stats
  const totalRepairs = repairs.length;
  const readyCount = repairs.filter((r) => r.status === "ready").length;
  const totalRevenue = repairs
    .filter((r) => r.status === "ready" && r.total_price)
    .reduce((sum, r) => sum + (r.total_price || 0), 0);

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
            <a href="/dashboard/analytics" className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors hidden sm:block">
              Analytics
            </a>
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

      {/* Dashboard */}
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[var(--navy)]">Repairs Dashboard</h1>
            <p className="text-[var(--gray-muted)] mt-1">
              Diagnose leaks, generate repair instructions and homeowner tickets.
            </p>
          </div>
          <a
            href="/dashboard/new-repair"
            className="bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-6 py-3 rounded-xl font-semibold transition-colors text-sm"
          >
            + New Repair
          </a>
        </div>

        {/* Stats */}
        {totalRepairs > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-xl border border-[var(--border-glass)] px-5 py-4">
              <p className="text-xs text-[var(--gray-dim)] font-medium uppercase">Total Repairs</p>
              <p className="text-2xl font-bold text-[var(--navy)] mt-1">{totalRepairs}</p>
            </div>
            <div className="bg-white rounded-xl border border-[var(--border-glass)] px-5 py-4">
              <p className="text-xs text-[var(--gray-dim)] font-medium uppercase">Completed</p>
              <p className="text-2xl font-bold text-green-600 mt-1">{readyCount}</p>
            </div>
            <div className="bg-white rounded-xl border border-[var(--border-glass)] px-5 py-4">
              <p className="text-xs text-[var(--gray-dim)] font-medium uppercase">Total Revenue</p>
              <p className="text-2xl font-bold text-[var(--navy)] mt-1">
                ${totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </p>
            </div>
          </div>
        )}

        {/* Repairs List */}
        {loading ? (
          <div className="bg-white rounded-2xl border border-[var(--border-glass)] text-center py-16">
            <p className="text-[var(--gray-dim)] text-sm">Loading repairs...</p>
          </div>
        ) : repairs.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[var(--border-glass)] text-center py-16 px-8">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 border-2 border-dashed border-blue-200 flex items-center justify-center mx-auto mb-5">
              <svg className="w-8 h-8 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.66-5.66a8 8 0 1111.31 0l-5.65 5.66zm0 0L12 21" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-[var(--navy)] mb-2">No repairs yet</h3>
            <p className="text-[var(--gray-muted)] text-sm mb-6 max-w-md mx-auto">
              Upload photos of a roof leak and AI will diagnose it, generate repair instructions for your crew, and a professional repair ticket for the homeowner.
            </p>
            <a href="/dashboard/new-repair" className="inline-block bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-8 py-3 rounded-xl font-semibold transition-colors text-sm">
              Submit First Repair
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            {repairs.map((repair) => {
              const sc = statusConfig[repair.status] || statusConfig.uploaded;
              const isReady = repair.status === "ready" && repair.output_files?.length;
              const isProcessing = repair.status === "processing" || repair.status === "uploaded";
              const severityColor = repair.severity ? REPAIR_SEVERITY_COLORS[repair.severity] : null;

              return (
                <div key={repair.id} className="bg-white rounded-2xl border border-[var(--border-glass)] overflow-hidden">
                  {/* Repair Header */}
                  <div className="px-6 py-4 flex items-center justify-between">
                    <a href={`/dashboard/repair/${repair.id}`} className="flex items-center gap-4 hover:opacity-80 transition-opacity">
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <h3 className="text-sm font-semibold text-[var(--navy)]">
                            {repair.address}
                          </h3>
                          {repair.total_price ? (
                            <span className="text-xs font-bold text-[var(--navy)] bg-white/[0.06] px-2 py-0.5 rounded">
                              ${repair.total_price.toLocaleString("en-US", { minimumFractionDigits: 0 })}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-[var(--gray-dim)] mt-0.5">
                          {repair.homeowner_name}
                          {repair.repair_type && (
                            <> &middot; {REPAIR_TYPE_LABELS[repair.repair_type] || repair.repair_type}</>
                          )}
                          {' '}&middot; {new Date(repair.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </a>
                    <div className="flex items-center gap-2">
                      {severityColor && (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${severityColor} capitalize`}>
                          {repair.severity}
                        </span>
                      )}
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${sc.color}`}>
                        {isProcessing && (
                          <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        )}
                        {sc.label}
                      </span>
                      {isReady && (
                        <button
                          onClick={() => handleDownloadAll(repair)}
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
                        <p className="text-xs font-semibold text-green-800 mb-3">
                          Repair documents ready
                        </p>
                        <div className="grid sm:grid-cols-2 gap-2">
                          {repair.output_files!.map((file) => {
                            const isInstructions = file.includes("INSTRUCTIONS");
                            const label = isInstructions ? "Roofer Instructions" : file.replace(/_/g, " ").replace(".pdf", "");

                            return (
                              <button
                                key={file}
                                onClick={() => handleDownload(repair, file)}
                                disabled={downloading === file}
                                className="flex items-center gap-2 bg-white border border-green-200 rounded-lg px-3 py-2 text-left hover:bg-green-50 transition-colors disabled:opacity-50"
                              >
                                <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                <span className="text-xs text-[var(--gray)] truncate">
                                  {label}
                                </span>
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
                          <svg className="animate-spin w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <div>
                            <p className="text-sm font-medium text-amber-800">
                              AI is diagnosing the leak and generating repair documents...
                            </p>
                            <p className="text-xs text-amber-600 mt-0.5">
                              This typically takes 1-2 minutes
                            </p>
                          </div>
                        </div>
                      </div>
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
        )}
      </div>
    </main>
  );
}
