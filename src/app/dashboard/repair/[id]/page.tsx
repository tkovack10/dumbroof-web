"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import type { Repair } from "@/types/repair";
import { REPAIR_TYPE_LABELS, REPAIR_SEVERITY_COLORS } from "@/lib/claim-constants";

const SEVERITY_CONFIG: Record<string, { color: string; label: string }> = {
  minor: { color: "bg-green-100 text-green-700", label: "Minor" },
  moderate: { color: "bg-amber-100 text-amber-700", label: "Moderate" },
  major: { color: "bg-orange-100 text-orange-700", label: "Major" },
  critical: { color: "bg-red-100 text-red-700", label: "Critical" },
  emergency: { color: "bg-red-200 text-red-800", label: "Emergency" },
};

export default function RepairDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const repairId = params.id as string;

  const [repair, setRepair] = useState<Repair | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  const fetchRepair = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    const { data } = await supabase
      .from("repairs")
      .select("*")
      .eq("id", repairId)
      .eq("user_id", user.id)
      .single();

    setRepair(data);
    setLoading(false);
  }, [repairId, router, supabase]);

  useEffect(() => {
    fetchRepair();
  }, [fetchRepair]);

  // Poll for status changes when processing
  useEffect(() => {
    if (!repair || (repair.status !== "uploaded" && repair.status !== "processing")) return;
    const interval = setInterval(fetchRepair, 5000);
    return () => clearInterval(interval);
  }, [repair?.status, fetchRepair]);

  const handleDownload = async (filename: string) => {
    if (!repair) return;
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

  const statusConfig: Record<string, { color: string; label: string; bg: string }> = {
    uploaded: { color: "text-blue-700", label: "Queued", bg: "bg-blue-100" },
    processing: { color: "text-amber-700", label: "Diagnosing", bg: "bg-amber-100" },
    ready: { color: "text-green-700", label: "Ready", bg: "bg-green-100" },
    error: { color: "text-red-700", label: "Error", bg: "bg-red-100" },
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  if (!repair) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-4">Repair not found</p>
          <a href="/dashboard" className="text-[var(--red)] font-medium">
            Back to Dashboard
          </a>
        </div>
      </main>
    );
  }

  const sc = statusConfig[repair.status] || statusConfig.uploaded;
  const isReady = repair.status === "ready" && repair.output_files?.length;
  const isProcessing = repair.status === "processing" || repair.status === "uploaded";
  const severity = repair.severity ? SEVERITY_CONFIG[repair.severity] : null;

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Top Bar */}
      <nav className="bg-[var(--navy)] border-b border-white/10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white">
              DR
            </div>
            <span className="text-white font-bold text-lg tracking-tight">
              dumb roof<sup className="text-[9px] font-medium align-super ml-0.5">™</sup>
            </span>
          </div>
          <a
            href="/dashboard"
            className="text-gray-400 hover:text-white text-sm transition-colors"
          >
            Back to Dashboard
          </a>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        {/* Repair Header */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                  REPAIR
                </span>
                {severity && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${severity.color}`}>
                    {severity.label}
                  </span>
                )}
              </div>
              <h1 className="text-xl font-bold text-[var(--navy)]">
                {repair.address}
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                {repair.homeowner_name} &middot;{" "}
                {repair.repair_type ? REPAIR_TYPE_LABELS[repair.repair_type] || repair.repair_type : "Pending diagnosis"} &middot;{" "}
                {new Date(repair.created_at).toLocaleDateString()}
              </p>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}
            >
              {isProcessing && (
                <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {sc.label}
            </span>
          </div>

          {/* Repair Details */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {repair.total_price ? (
              <div className="bg-[var(--navy)] rounded-lg px-4 py-3 text-center">
                <p className="text-xs text-gray-400">Price</p>
                <p className="text-lg font-bold text-white">
                  ${repair.total_price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </p>
              </div>
            ) : null}
            <div className="bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-400">Skill Level</p>
              <p className="text-sm font-semibold text-[var(--navy)] capitalize">
                {repair.skill_level || "Journeyman"}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-400">Language</p>
              <p className="text-sm font-semibold text-[var(--navy)]">
                {repair.preferred_language === "es" ? "Spanish" : "English"}
              </p>
            </div>
            {repair.roofer_name && (
              <div className="bg-gray-50 rounded-lg px-4 py-3">
                <p className="text-xs text-gray-400">Roofer</p>
                <p className="text-sm font-semibold text-[var(--navy)]">
                  {repair.roofer_name}
                </p>
              </div>
            )}
          </div>

          {repair.leak_description && (
            <div className="mt-4 bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-xs font-semibold text-gray-400 uppercase mb-1">
                Leak Description
              </p>
              <p className="text-sm text-gray-700">{repair.leak_description}</p>
            </div>
          )}
        </div>

        {/* Processing indicator */}
        {isProcessing && (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <svg className="animate-spin w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-amber-800">
                  AI is analyzing your photos and diagnosing the leak...
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  Generating repair instructions + homeowner ticket. This typically takes 1-2 minutes.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Output Files */}
        {isReady && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-[var(--navy)] mb-4">
              Repair Documents Ready
            </h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {repair.output_files!.map((file) => {
                const isInstructions = file.includes("INSTRUCTIONS");
                const isTicket = file.includes("TICKET");
                const isReceipt = file.includes("RECEIPT");

                let description = "Download";
                if (isInstructions) description = "For the roofer — bilingual, skill-calibrated";
                else if (isTicket) description = "For the homeowner — diagnosis, price, approval";
                else if (isReceipt) description = "Completion receipt with warranty";

                return (
                  <button
                    key={file}
                    onClick={() => handleDownload(file)}
                    disabled={downloading === file}
                    className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-left hover:bg-green-100 transition-colors disabled:opacity-50"
                  >
                    <svg className="w-5 h-5 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <div>
                      <p className="text-sm text-gray-700 font-medium">
                        {file.replace(/_/g, " ").replace(".pdf", "")}
                      </p>
                      <p className="text-xs text-gray-500">{description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Error state */}
        {repair.status === "error" && (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-5">
            <p className="text-sm font-medium text-red-800 mb-1">
              Diagnosis failed
            </p>
            {repair.error_message ? (
              <p className="text-sm text-red-600 font-mono bg-red-100/50 rounded px-3 py-2 mt-2">
                {repair.error_message}
              </p>
            ) : (
              <p className="text-sm text-red-600">
                Something went wrong. Please try submitting again with clearer photos.
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
