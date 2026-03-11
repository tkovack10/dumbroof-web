"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Claim } from "@/types/claim";

interface Props {
  claim: Claim;
  userInfo?: { company_name: string | null; contact_email: string | null };
}

const FILE_CATEGORIES = [
  { key: "measurement_files" as const, label: "Measurements", folder: "measurements", color: "bg-blue-50 text-blue-700 border-blue-200" },
  { key: "photo_files" as const, label: "Photos", folder: "photos", color: "bg-purple-50 text-purple-700 border-purple-200" },
  { key: "scope_files" as const, label: "Scope", folder: "scope", color: "bg-amber-50 text-amber-700 border-amber-200" },
  { key: "weather_files" as const, label: "Weather", folder: "weather", color: "bg-teal-50 text-teal-700 border-teal-200" },
  { key: "other_files" as const, label: "Other", folder: "other", color: "bg-gray-100 text-gray-600 border-gray-200" },
];

export function AdminClaimDetail({ claim, userInfo }: Props) {
  const supabase = createClient();
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleDownloadOutput = async (filename: string) => {
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

  const handleDownloadSource = async (folder: string, filename: string) => {
    const key = `${folder}/${filename}`;
    setDownloading(key);
    try {
      const path = `${claim.file_path}/${folder}/${filename}`;
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
    uploaded: { color: "text-blue-700", label: "Uploaded", bg: "bg-blue-100" },
    processing: { color: "text-amber-700", label: "Processing", bg: "bg-amber-100" },
    ready: { color: "text-green-700", label: "Ready", bg: "bg-green-100" },
    needs_improvement: { color: "text-orange-700", label: "Needs Improvement", bg: "bg-orange-100" },
    error: { color: "text-red-700", label: "Error", bg: "bg-red-100" },
  };

  const sc = statusConfig[claim.status] || statusConfig.uploaded;
  const isReady = claim.status === "ready" && claim.output_files?.length;
  const isProcessing = claim.status === "processing";
  const isUploaded = claim.status === "uploaded";
  const isReprocessingState = isProcessing || isUploaded;
  const integrity = claim.photo_integrity;

  const totalSourceFiles = FILE_CATEGORIES.reduce(
    (sum, cat) => sum + ((claim[cat.key] as string[] | null)?.length ?? 0),
    0
  );

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
              dumb roof<sup className="text-[9px] font-medium align-super ml-0.5">&trade;</sup>
            </span>
            <span className="bg-amber-500/20 text-amber-400 text-xs font-semibold px-2 py-0.5 rounded-full ml-2">
              ADMIN VIEW
            </span>
          </div>
          <a
            href="/admin"
            className="text-gray-400 hover:text-white text-sm transition-colors"
          >
            Back to Admin
          </a>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        {/* Claim Header */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold text-[var(--navy)]">
                {claim.address}
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                {claim.carrier} &middot;{" "}
                {claim.phase === "pre-scope" ? "Pre-Scope" : "Supplement"} &middot;{" "}
                {new Date(claim.created_at).toLocaleDateString()}
              </p>
              {/* User info */}
              {userInfo && (
                <p className="text-xs text-gray-400 mt-1">
                  User: {userInfo.company_name || userInfo.contact_email || claim.user_id.slice(0, 8)}
                  {userInfo.contact_email && userInfo.company_name && (
                    <span> ({userInfo.contact_email})</span>
                  )}
                </p>
              )}
              {claim.homeowner_name && (
                <p className="text-xs text-gray-400 mt-0.5">
                  Homeowner: {claim.homeowner_name}
                  {claim.date_of_loss && <span> &middot; Loss: {claim.date_of_loss}</span>}
                </p>
              )}
            </div>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}
            >
              {isReprocessingState && (
                <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {isUploaded ? "Queued for Processing" : sc.label}
            </span>
          </div>

          {/* Financial summary */}
          {(claim.contractor_rcv || claim.original_carrier_rcv) && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-400">Contractor RCV</p>
                <p className="text-sm font-bold text-[var(--navy)]">
                  {claim.contractor_rcv ? `$${claim.contractor_rcv.toLocaleString()}` : "—"}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-400">Carrier RCV</p>
                <p className="text-sm font-bold text-[var(--navy)]">
                  {claim.original_carrier_rcv ? `$${claim.original_carrier_rcv.toLocaleString()}` : "—"}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-400">Variance</p>
                {(() => {
                  const v = (claim.contractor_rcv ?? 0) - (claim.original_carrier_rcv ?? 0);
                  return (
                    <p className={`text-sm font-bold ${v > 0 ? "text-green-700" : v < 0 ? "text-red-600" : "text-gray-500"}`}>
                      {v > 0 ? "+" : ""}${v.toLocaleString()}
                    </p>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Damage Scores */}
          {claim.damage_score != null && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                { label: "Damage Score", value: claim.damage_score, max: 100, unit: "/100", grade: claim.damage_grade },
                { label: "Approval Score", value: claim.approval_score ?? 0, max: 100, unit: "%", grade: claim.approval_grade },
              ].map(({ label, value, unit, grade }) => {
                const gradeColors: Record<string, string> = {
                  A: "bg-green-100 text-green-800 border-green-300",
                  B: "bg-blue-100 text-blue-800 border-blue-300",
                  "C+": "bg-amber-100 text-amber-800 border-amber-300",
                  C: "bg-amber-100 text-amber-800 border-amber-300",
                  "C-": "bg-orange-100 text-orange-800 border-orange-300",
                  D: "bg-orange-100 text-orange-800 border-orange-300",
                  "D-": "bg-red-100 text-red-700 border-red-300",
                  F: "bg-red-100 text-red-700 border-red-300",
                };
                const ringColors: Record<string, string> = {
                  A: "text-green-500", B: "text-blue-500", "C+": "text-amber-500",
                  C: "text-amber-500", "C-": "text-orange-500", D: "text-orange-500",
                  "D-": "text-red-500", F: "text-red-500",
                };
                const pct = Math.round((value / 100) * 100);
                const g = grade || "F";
                return (
                  <div key={label} className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
                    <div className="relative w-11 h-11 shrink-0">
                      <svg className="w-11 h-11 -rotate-90" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-gray-200" strokeWidth="3" />
                        <circle cx="18" cy="18" r="15.5" fill="none" className={`${ringColors[g] || "text-gray-400"} stroke-current`} strokeWidth="3" strokeDasharray={`${pct} ${100 - pct}`} strokeLinecap="round" />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-[var(--navy)]">{value}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">{label}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-sm font-bold text-[var(--navy)]">{value}{unit}</span>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${gradeColors[g] || "bg-gray-100 text-gray-600 border-gray-300"}`}>
                          {g}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Photo Integrity Badge */}
          {integrity && (
            <div className="mt-4 inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2">
              <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-emerald-800">
                  Photo Integrity Verified &mdash; {integrity.score}
                </p>
                <p className="text-xs text-emerald-600">
                  {integrity.total} photos analyzed &middot; {integrity.flagged} flagged for manipulation
                </p>
              </div>
            </div>
          )}

          {/* Measurement Warning Banner */}
          {claim.processing_warnings?.some(w =>
            w === "MEASUREMENT_EXTRACTION_FAILED" ||
            w === "PROPERTY_OWNER_REPORT_NO_MEASUREMENTS" ||
            w === "MEASUREMENTS_FROM_CARRIER_FALLBACK"
          ) && (
            <div className="mt-4 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-amber-800">
                    {claim.processing_warnings!.includes("PROPERTY_OWNER_REPORT_NO_MEASUREMENTS")
                      ? "Property Owner Report Detected — No Measurements"
                      : claim.processing_warnings!.includes("MEASUREMENTS_FROM_CARRIER_FALLBACK")
                      ? "Measurements Estimated from Carrier Scope"
                      : "Measurement Extraction Failed"}
                  </p>
                  <p className="text-xs text-amber-700 mt-1">
                    {claim.processing_warnings!.includes("PROPERTY_OWNER_REPORT_NO_MEASUREMENTS")
                      ? "The uploaded EagleView file is a Property Owner Report (images only)."
                      : claim.processing_warnings!.includes("MEASUREMENTS_FROM_CARRIER_FALLBACK")
                      ? "Measurements were estimated from the carrier scope."
                      : "Could not extract roof measurements from the uploaded documents."}
                  </p>
                </div>
              </div>
            </div>
          )}

          {claim.user_notes && (
            <div className="mt-4 bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-xs font-semibold text-gray-400 uppercase mb-1">
                User Notes
              </p>
              <p className="text-sm text-gray-700">{claim.user_notes}</p>
            </div>
          )}
        </div>

        {/* Processing indicator */}
        {isReprocessingState && (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <svg className="animate-spin w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-amber-800">
                  {isUploaded
                    ? "Claim queued — waiting for processing to begin..."
                    : "Analyzing documents and generating claim package..."}
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  {isUploaded
                    ? "The system will pick this up shortly"
                    : "This typically takes 2-5 minutes"}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Needs Improvement — Coaching Card */}
        {claim.status === "needs_improvement" && claim.improvement_guidance && (
          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-bold text-orange-900">
                  Quality Gate — More Documentation Needed
                </h2>
                <p className="text-sm text-orange-800 mt-1">
                  {claim.improvement_guidance.summary}
                </p>
              </div>
            </div>
            <div className="grid gap-3">
              {claim.improvement_guidance.tips.map((tip, i) => (
                <div key={i} className="bg-white border border-orange-100 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-700 border border-orange-200">
                      {tip.category}
                    </span>
                    <span className="text-sm font-semibold text-[var(--navy)]">{tip.title}</span>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">{tip.detail}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Output Files */}
        {isReady && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-[var(--navy)] mb-4">
              Generated Documents
            </h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {claim.output_files!.map((file) => (
                <button
                  key={file}
                  onClick={() => handleDownloadOutput(file)}
                  disabled={downloading === file}
                  className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-left hover:bg-green-100 transition-colors disabled:opacity-50"
                >
                  <svg className="w-5 h-5 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm text-gray-700 font-medium">
                    {file.replace(/_/g, " ").replace(".pdf", "")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error state */}
        {claim.status === "error" && (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-5">
            <p className="text-sm font-medium text-red-800 mb-1">Processing failed</p>
            {claim.error_message ? (
              <p className="text-sm text-red-600 font-mono bg-red-100/50 rounded px-3 py-2 mt-2">
                {claim.error_message}
              </p>
            ) : (
              <p className="text-sm text-red-600">
                No error message recorded.
              </p>
            )}
          </div>
        )}

        {/* Uploaded Source Documents */}
        {totalSourceFiles > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-[var(--navy)] mb-4">
              Uploaded Documents
              <span className="text-xs text-gray-400 font-normal ml-2">
                {totalSourceFiles} file{totalSourceFiles !== 1 ? "s" : ""}
              </span>
            </h2>
            <div className="space-y-4">
              {FILE_CATEGORIES.map(({ key, label, folder, color }) => {
                const files = (claim[key] as string[] | null) ?? [];
                if (files.length === 0) return null;
                return (
                  <div key={key}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${color}`}>
                        {label}
                      </span>
                      <span className="text-xs text-gray-400">{files.length} file{files.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {files.map((filename) => (
                        <button
                          key={filename}
                          onClick={() => handleDownloadSource(folder, filename)}
                          disabled={downloading === `${folder}/${filename}`}
                          className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-left hover:bg-gray-100 transition-colors disabled:opacity-50 group"
                        >
                          <svg className="w-4 h-4 text-gray-400 group-hover:text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M6 20h12a2 2 0 002-2V8l-6-6H6a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <span className="text-xs text-gray-600 truncate">
                            {downloading === `${folder}/${filename}` ? "Downloading..." : filename}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
