"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

interface Claim {
  id: string;
  address: string;
  carrier: string;
  phase: string;
  status: string;
  file_path: string;
  output_files: string[] | null;
  created_at: string;
}

export function DashboardContent({ user }: { user: User }) {
  const supabase = createClient();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

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
    // Poll every 5 seconds for status updates
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
      // Small delay between downloads
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  const statusConfig: Record<string, { color: string; label: string; icon: string }> = {
    uploaded: { color: "bg-blue-100 text-blue-700", label: "Uploaded", icon: "cloud" },
    processing: { color: "bg-amber-100 text-amber-700", label: "Processing", icon: "spinner" },
    ready: { color: "bg-green-100 text-green-700", label: "Ready", icon: "check" },
    error: { color: "bg-red-100 text-red-700", label: "Error", icon: "x" },
  };

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Top Bar */}
      <nav className="bg-[var(--navy)] border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white">
              DR
            </div>
            <span className="text-white font-bold text-lg tracking-tight">
              dumb roof
            </span>
          </div>
          <div className="flex items-center gap-4">
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
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[var(--navy)]">Dashboard</h1>
            <p className="text-gray-500 mt-1">
              Upload documents and generate claim packages.
            </p>
          </div>
          <a
            href="/dashboard/new-claim"
            className="bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-6 py-3 rounded-xl font-semibold transition-colors text-sm"
          >
            + New Claim
          </a>
        </div>

        {/* Claims List */}
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
          <div className="space-y-4">
            {claims.map((claim) => {
              const sc = statusConfig[claim.status] || statusConfig.uploaded;
              const isReady = claim.status === "ready" && claim.output_files?.length;
              const isProcessing = claim.status === "processing";

              return (
                <div key={claim.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                  {/* Claim Header */}
                  <div className="px-6 py-4 flex items-center justify-between">
                    <a href={`/dashboard/claim/${claim.id}`} className="flex items-center gap-4 hover:opacity-80 transition-opacity">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--navy)]">
                          {claim.address}
                        </h3>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {claim.carrier} &middot; {claim.phase === "pre-scope" ? "Pre-Scope" : "Supplement"} &middot; {new Date(claim.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </a>
                    <div className="flex items-center gap-3">
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
                          onClick={() => handleDownloadAll(claim)}
                          className="bg-[var(--navy)] hover:bg-[var(--navy-light)] text-white px-4 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        >
                          Download All
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Output Files (when ready) */}
                  {isReady && (
                    <div className="px-6 pb-4">
                      <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                        <p className="text-xs font-semibold text-green-800 mb-3">
                          Your claim package is ready
                        </p>
                        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {claim.output_files!.map((file) => (
                            <button
                              key={file}
                              onClick={() => handleDownload(claim, file)}
                              disabled={downloading === file}
                              className="flex items-center gap-2 bg-white border border-green-200 rounded-lg px-3 py-2 text-left hover:bg-green-50 transition-colors disabled:opacity-50"
                            >
                              <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              <span className="text-xs text-gray-700 truncate">
                                {file.replace(/_/g, " ").replace(".pdf", "")}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Processing indicator */}
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
                              Analyzing documents and generating your claim package...
                            </p>
                            <p className="text-xs text-amber-600 mt-0.5">
                              This typically takes 2-5 minutes
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Error state */}
                  {claim.status === "error" && (
                    <div className="px-6 pb-4">
                      <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                        <p className="text-sm text-red-700">
                          Processing failed. Our team has been notified and will look into it.
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
