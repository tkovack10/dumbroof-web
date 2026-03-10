"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Claim } from "@/types/claim";

type StatusFilter = "all" | "processing" | "ready" | "attention";

function fmtMoney(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

export function DashboardContent({ user }: { user: User }) {
  const supabase = createClient();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const fetchClaims = useCallback(async () => {
    const { data } = await supabase
      .from("claims")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setClaims(data || []);
    setLoading(false);
  }, [user.id, supabase]);

  useEffect(() => {
    fetchClaims();
    const interval = setInterval(fetchClaims, 5000);
    return () => clearInterval(interval);
  }, [fetchClaims]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const handleDownload = async (claim: Claim, filename: string) => {
    setDownloading(filename);
    try {
      const path = `${claim.file_path}/output/${filename}`;
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

  const handleDownloadAll = async (claim: Claim) => {
    if (!claim.output_files) return;
    for (const file of claim.output_files) {
      await handleDownload(claim, file);
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  const statusColors: Record<string, string> = {
    uploaded: "bg-blue-100 text-blue-700",
    processing: "bg-amber-100 text-amber-700",
    ready: "bg-green-100 text-green-700",
    error: "bg-red-100 text-red-700",
  };

  // KPI calculations
  const readyCount = claims.filter(c => c.status === "ready").length;
  const processingCount = claims.filter(c => c.status === "processing" || c.status === "uploaded").length;
  const wonClaims = claims.filter(c => c.claim_outcome === "won");
  const totalMovement = wonClaims.reduce((sum, c) => sum + (c.settlement_amount ?? 0), 0);
  const totalContractorRcv = claims.reduce((s, c) => s + (c.contractor_rcv ?? 0), 0);
  const totalCarrierRcv = claims.reduce((s, c) => s + (c.original_carrier_rcv ?? 0), 0);
  const attentionCount = claims.filter(c => c.status === "error" || (c.pending_edits ?? 0) > 0).length;

  // Filter logic
  const filteredClaims = claims.filter(c => {
    if (statusFilter === "all") return true;
    if (statusFilter === "processing") return c.status === "processing" || c.status === "uploaded";
    if (statusFilter === "ready") return c.status === "ready";
    if (statusFilter === "attention") return c.status === "error" || (c.pending_edits ?? 0) > 0;
    return true;
  });

  const filterTabs: { key: StatusFilter; label: string; count?: number }[] = [
    { key: "all", label: "All", count: claims.length },
    { key: "processing", label: "Processing", count: processingCount },
    { key: "ready", label: "Ready", count: readyCount },
    { key: "attention", label: "Needs Attention", count: attentionCount },
  ];

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Top Bar */}
      <nav className="bg-[var(--navy)] border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white">
              DR
            </div>
            <span className="text-white font-bold text-lg tracking-tight">
              dumb roof<sup className="text-[9px] font-medium align-super ml-0.5">&trade;</sup>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/dashboard/repairs" className="text-gray-400 hover:text-white text-sm transition-colors hidden sm:block">
              Repairs
            </a>
            <a href="/dashboard/correspondence" className="text-gray-400 hover:text-white text-sm transition-colors hidden sm:block relative">
              Correspondence
              {claims.some((c) => (c.pending_drafts || 0) > 0) && (
                <span className="absolute -top-1 -right-3 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              )}
              {claims.some((c) => (c.pending_edits || 0) > 0) && (
                <span className="absolute -top-1 -right-6 w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
              )}
            </a>
            <a href="/dashboard/analytics" className="text-gray-400 hover:text-white text-sm transition-colors hidden sm:block">
              Analytics
            </a>
            <a href="/dashboard/settings" className="text-gray-400 hover:text-white text-sm transition-colors hidden sm:block">
              Settings
            </a>
            <span className="text-gray-400 text-sm hidden sm:block">
              {user.email}
            </span>
            <button
              onClick={handleSignOut}
              className="text-gray-400 hover:text-white text-sm transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      {/* Dashboard */}
      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[var(--navy)]">Claims Dashboard</h1>
            <p className="text-gray-500 mt-1">
              Upload documents and generate claim packages.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/dashboard/new-repair"
              className="bg-[var(--navy)] hover:bg-[var(--navy-light)] text-white px-5 py-3 rounded-xl font-semibold transition-colors text-sm"
            >
              + New Repair
            </a>
            <a
              href="/dashboard/new-claim"
              className="bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-6 py-3 rounded-xl font-semibold transition-colors text-sm"
            >
              + New Claim
            </a>
          </div>
        </div>

        {/* KPI Stats Bar */}
        {!loading && claims.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <p className="text-2xl font-bold text-[var(--navy)]">{claims.length}</p>
              <p className="text-xs text-gray-500 mt-1">Total Claims</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{readyCount}</p>
              <p className="text-xs text-gray-500 mt-1">Ready</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{processingCount}</p>
              <p className="text-xs text-gray-500 mt-1">Processing</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{wonClaims.length}</p>
              <p className="text-xs text-gray-500 mt-1">Wins</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <p className="text-2xl font-bold text-[var(--navy)]">{fmtMoney(totalContractorRcv)}</p>
              <p className="text-xs text-gray-500 mt-1">Contractor RCV</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <p className="text-2xl font-bold text-[var(--navy)]">{fmtMoney(totalCarrierRcv)}</p>
              <p className="text-xs text-gray-500 mt-1">Carrier RCV</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <p className={`text-2xl font-bold ${totalContractorRcv - totalCarrierRcv > 0 ? "text-green-600" : "text-gray-600"}`}>
                {fmtMoney(Math.abs(totalContractorRcv - totalCarrierRcv))}
              </p>
              <p className="text-xs text-gray-500 mt-1">Variance</p>
            </div>
            {totalMovement > 0 && (
              <div className="bg-white rounded-xl border border-green-200 p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{fmtMoney(totalMovement)}</p>
                <p className="text-xs text-green-600 mt-1">Won $</p>
              </div>
            )}
          </div>
        )}

        {/* Win Summary Banner */}
        {!loading && wonClaims.length > 0 && (
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-5 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-green-800">
                  {wonClaims.length} Claim{wonClaims.length > 1 ? "s" : ""} Won
                </p>
                {totalMovement > 0 && (
                  <p className="text-xs text-green-600 mt-0.5">
                    ${totalMovement.toLocaleString()} recovered from carriers
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Filter Tabs */}
        {!loading && claims.length > 0 && (
          <div className="flex gap-2 mb-6">
            {filterTabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors ${
                  statusFilter === tab.key
                    ? "bg-[var(--navy)] text-white"
                    : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                }`}
              >
                {tab.label}
                {tab.count != null && tab.count > 0 && (
                  <span className={`ml-1.5 ${statusFilter === tab.key ? "text-white/70" : "text-gray-400"}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Claims Table */}
        {loading ? (
          <div className="bg-white rounded-2xl border border-gray-200 text-center py-16">
            <p className="text-gray-400 text-sm">Loading claims...</p>
          </div>
        ) : claims.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 text-center py-16 px-8">
            <div className="w-16 h-16 rounded-2xl bg-[var(--gray-50)] border-2 border-dashed border-gray-300 flex items-center justify-center mx-auto mb-5">
              <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-[var(--navy)] mb-2">No claims yet</h3>
            <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
              Upload your measurements, inspection photos, and carrier scope to generate your first claim package.
            </p>
            <a href="/dashboard/new-claim" className="inline-block bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-8 py-3 rounded-xl font-semibold transition-colors text-sm">
              Upload Documents
            </a>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left border-b border-gray-100">
                    <th className="px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase">Property</th>
                    <th className="px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase">Carrier</th>
                    <th className="px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase text-right">Contractor RCV</th>
                    <th className="px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase text-right">Carrier RCV</th>
                    <th className="px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase text-right">Variance</th>
                    <th className="px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase text-center">Phase</th>
                    <th className="px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase text-center">Status</th>
                    <th className="px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredClaims.map((claim) => {
                    const cRcv = claim.contractor_rcv ?? 0;
                    const iRcv = claim.original_carrier_rcv ?? 0;
                    const variance = cRcv - iRcv;
                    const isProcessing = claim.status === "processing";

                    return (
                      <tr
                        key={claim.id}
                        onClick={() => setExpandedRow(expandedRow === claim.id ? null : claim.id)}
                        className={`hover:bg-gray-50 transition-colors cursor-pointer ${claim.claim_outcome === "won" ? "bg-green-50/40" : ""}`}
                      >
                        <td className="px-3 py-2.5">
                          <a href={`/dashboard/claim/${claim.id}`} className="hover:underline" onClick={e => e.stopPropagation()}>
                            <p className="font-medium text-[var(--navy)] truncate max-w-[220px]">{claim.address}</p>
                          </a>
                          <p className="text-[10px] text-gray-400 mt-0.5">{new Date(claim.created_at).toLocaleDateString()}</p>
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 truncate max-w-[140px]">{claim.carrier || "—"}</td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums font-medium text-[var(--navy)]">
                          {cRcv > 0 ? `$${cRcv.toLocaleString()}` : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums text-gray-600">
                          {iRcv > 0 ? `$${iRcv.toLocaleString()}` : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                          {cRcv > 0 && iRcv > 0 ? (
                            <span className={variance > 0 ? "text-green-600 font-medium" : variance < 0 ? "text-red-600" : "text-gray-500"}>
                              {variance > 0 ? "+" : ""}{`$${variance.toLocaleString()}`}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="text-xs text-gray-500">{claim.phase === "pre-scope" ? "Pre" : "Post"}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex flex-col items-center gap-1">
                            {claim.claim_outcome === "won" ? (
                              <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">Won</span>
                            ) : (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[claim.status] || "bg-gray-100 text-gray-600"}`}>
                                {isProcessing && (
                                  <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                  </svg>
                                )}
                                {claim.status.charAt(0).toUpperCase() + claim.status.slice(1)}
                              </span>
                            )}
                            {(claim.pending_edits ?? 0) > 0 && (
                              <span className="text-[10px] text-amber-600 font-medium">{claim.pending_edits} edit{(claim.pending_edits ?? 0) > 1 ? "s" : ""}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs text-gray-400">{new Date(claim.created_at).toLocaleDateString()}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Expanded row detail panels */}
            {filteredClaims.map((claim) => (
              expandedRow === claim.id ? (
                <div key={`exp-${claim.id}`} className="px-6 pb-4 bg-gray-50/50 border-t border-gray-200">
                  {/* Source Files */}
                  <div className="grid grid-cols-5 gap-2 mt-3 mb-3">
                    {[
                      { label: "Measurements", files: claim.measurement_files, color: "bg-blue-50 text-blue-700 border-blue-200" },
                      { label: "Photos", files: claim.photo_files, color: "bg-purple-50 text-purple-700 border-purple-200" },
                      { label: "Scope", files: claim.scope_files, color: "bg-amber-50 text-amber-700 border-amber-200" },
                      { label: "Weather", files: claim.weather_files, color: "bg-teal-50 text-teal-700 border-teal-200" },
                      { label: "Other", files: claim.other_files, color: "bg-gray-100 text-gray-600 border-gray-200" },
                    ].map(({ label, files, color }) => (
                      <div key={label} className={`rounded-lg px-3 py-2 border ${color}`}>
                        <p className="text-xs font-bold">{files?.length ?? 0}</p>
                        <p className="text-[10px] font-medium opacity-70">{label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Output Files */}
                  {claim.output_files && claim.output_files.length > 0 ? (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <p className="text-xs font-semibold text-green-800">Your claim package is ready</p>
                        <button
                          onClick={() => handleDownloadAll(claim)}
                          className="bg-[var(--navy)] hover:bg-[var(--navy-light)] text-white px-3 py-1 rounded-lg text-[10px] font-medium transition-colors"
                        >
                          Download All
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {claim.output_files.map((file) => (
                          <button
                            key={file}
                            onClick={() => handleDownload(claim, file)}
                            disabled={downloading === file}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 hover:bg-green-100 disabled:opacity-50 text-green-700 text-xs font-semibold rounded-lg transition-colors border border-green-200"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M6 20h12a2 2 0 002-2V8l-6-6H6a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            {file.replace(/_/g, " ").replace(".pdf", "")}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : claim.status === "processing" ? (
                    <div className="flex items-center gap-3 py-2">
                      <svg className="animate-spin w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <p className="text-xs text-amber-700">Analyzing documents... typically 2-5 minutes</p>
                    </div>
                  ) : claim.status === "error" ? (
                    <p className="text-xs text-red-600 py-2">Processing failed. Our team has been notified.</p>
                  ) : (
                    <p className="text-xs text-gray-400 py-2">No output files yet.</p>
                  )}
                </div>
              ) : null
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
