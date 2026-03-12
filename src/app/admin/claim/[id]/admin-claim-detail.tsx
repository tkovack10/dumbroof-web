"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Claim } from "@/types/claim";
import { FileUploadZone } from "@/components/file-upload-zone";
import { PendingChangesBanner } from "@/components/pending-changes-banner";
import { CATEGORY_CONFIG, FILE_CATEGORIES, CLAIM_STATUS_CONFIG, type UploadCategory } from "@/lib/claim-constants";
import { uploadClaimDocuments } from "@/lib/upload-utils";

interface Props {
  claim: Claim;
  userInfo?: { company_name: string | null; contact_email: string | null };
}

export function AdminClaimDetail({ claim: initialClaim, userInfo }: Props) {
  const supabaseRef = useRef(createClient());
  const [claim, setClaim] = useState<Claim>(initialClaim);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<UploadCategory>("photos");
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [reprocessing, setReprocessing] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ folder: string; fileName: string; dbField: string } | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://dumbroof-backend-production.up.railway.app";

  const fetchClaim = useCallback(async () => {
    const { data } = await supabaseRef.current
      .from("claims")
      .select("*")
      .eq("id", claim.id)
      .single();
    if (data) {
      // Avoid no-op re-renders — compare serialized snapshots
      if (JSON.stringify(data) !== JSON.stringify(claim)) {
        setClaim(data);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim.id]);

  // Poll when processing
  useEffect(() => {
    if (claim.status !== "uploaded" && claim.status !== "processing") return;
    const interval = setInterval(fetchClaim, 5000);
    return () => clearInterval(interval);
  }, [claim.status, fetchClaim]);

  const handleDownloadOutput = async (filename: string) => {
    setDownloading(filename);
    try {
      const path = `${claim.file_path}/output/${filename}`;
      const { data, error } = await supabaseRef.current.storage
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
      const { data, error } = await supabaseRef.current.storage
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

  const handleUploadDocuments = async () => {
    if (!claim || newFiles.length === 0) return;
    setUploading(true);
    setUploadError("");
    setUploadSuccess("");

    try {
      const catConfig = CATEGORY_CONFIG[selectedCategory];

      // Use admin endpoints
      const uploadedNames = await uploadClaimDocuments(
        supabaseRef.current,
        newFiles,
        selectedCategory,
        claim,
        "/api/admin/sign-upload"
      );

      const fieldKey = catConfig.dbField as keyof Claim;
      const existingFiles: string[] = (claim[fieldKey] as string[] | null) ?? [];
      const updatedFiles = [...existingFiles, ...uploadedNames];

      const updates: Record<string, unknown> = { [catConfig.dbField]: updatedFiles };
      if (selectedCategory === "scope" && claim.phase === "pre-scope") {
        updates.phase = "post-scope";
      }

      const updateRes = await fetch("/api/admin/claims-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimId: claim.id, updates }),
      });
      if (!updateRes.ok) {
        const errData = await updateRes.json();
        throw new Error(`Failed to update claim: ${errData.error}`);
      }

      setUploadSuccess(`${uploadedNames.length} file${uploadedNames.length > 1 ? "s" : ""} uploaded`);
      setNewFiles([]);
      setShowUpload(false);
      fetchClaim();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    }
    setUploading(false);
  };

  const handleDeleteFile = async (folder: string, fileName: string) => {
    const key = `${folder}/${fileName}`;
    setDeleting(key);
    setDeleteConfirm(null);

    try {
      const res = await fetch("/api/admin/delete-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimId: claim.id, folder, fileName }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Delete failed");
      }
      // Refresh claim data to reflect the deletion
      const { data } = await supabaseRef.current
        .from("claims")
        .select("*")
        .eq("id", claim.id)
        .single();
      if (data) setClaim(data);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Delete failed");
    }
    setDeleting(null);
  };

  const handleReprocess = async () => {
    setReprocessing(true);
    setUploadError("");
    try {
      const res = await fetch(`${BACKEND_URL}/api/reprocess/${claim.id}`, { method: "POST" });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(`Reprocess failed: ${errData.detail || errData.error}`);
      }
      fetchClaim();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Reprocess failed");
    }
    setReprocessing(false);
  };

  const sc = CLAIM_STATUS_CONFIG[claim.status] || CLAIM_STATUS_CONFIG.uploaded;
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
                  {claim.contractor_rcv ? `$${claim.contractor_rcv.toLocaleString()}` : "\u2014"}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-400">Carrier RCV</p>
                <p className="text-sm font-bold text-[var(--navy)]">
                  {claim.original_carrier_rcv ? `$${claim.original_carrier_rcv.toLocaleString()}` : "\u2014"}
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
                { label: "Damage Score", value: claim.damage_score, unit: "/100", grade: claim.damage_grade },
                { label: "Approval Score", value: claim.approval_score ?? 0, unit: "%", grade: claim.approval_grade },
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

          {claim.user_notes && (
            <div className="mt-4 bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-xs font-semibold text-gray-400 uppercase mb-1">User Notes</p>
              <p className="text-sm text-gray-700">{claim.user_notes}</p>
            </div>
          )}
        </div>

        {/* Pending Changes Banner */}
        {!isReprocessingState && <PendingChangesBanner claimId={claim.id} />}

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
                  {isUploaded ? "Claim queued \u2014 waiting for processing..." : "Analyzing documents and generating claim package..."}
                </p>
                <p className="text-xs text-amber-600 mt-0.5">This typically takes 2-5 minutes</p>
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
                <h2 className="text-base font-bold text-orange-900">Quality Gate \u2014 More Documentation Needed</h2>
                <p className="text-sm text-orange-800 mt-1">{claim.improvement_guidance.summary}</p>
              </div>
            </div>
            <div className="grid gap-3">
              {claim.improvement_guidance.tips.map((tip: { category: string; title: string; detail: string }, i: number) => (
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
            <h2 className="text-sm font-semibold text-[var(--navy)] mb-4">Generated Documents</h2>
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
              <p className="text-sm text-red-600">No error message recorded.</p>
            )}
          </div>
        )}

        {/* Admin Actions: Upload + Reprocess + Photo Review */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--navy)]">Admin Actions</h2>
              <p className="text-xs text-gray-500 mt-0.5">Upload documents, review photos, or reprocess this claim</p>
            </div>
            {!showUpload && (
              <button
                onClick={() => {
                  setShowUpload(true);
                  setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
                }}
                className="bg-[var(--navy)] hover:bg-[var(--navy-light)] text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                + Upload Files
              </button>
            )}
          </div>

          {/* Photo Review link */}
          {(claim.photo_files?.length ?? 0) > 0 && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-purple-800">Review photo annotations</p>
                <p className="text-xs text-purple-600 mt-0.5">
                  Approve, correct, or reject AI-generated annotations.
                  {(claim.excluded_photos?.length ?? 0) > 0 && (
                    <span className="ml-1 font-semibold">({claim.excluded_photos!.length} excluded)</span>
                  )}
                </p>
              </div>
              <a
                href={`/dashboard/photo-review?claim=${claim.id}`}
                className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ml-4"
              >
                Review Photos
              </a>
            </div>
          )}

          {/* Scope Review link */}
          {(claim.contractor_rcv ?? 0) > 0 && (
            <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-teal-800">Review AI-generated line items</p>
                <p className="text-xs text-teal-600 mt-0.5">
                  Approve, correct, remove, or add line items. Changes update contractor RCV.
                  {(claim.excluded_line_items?.length ?? 0) > 0 && (
                    <span className="ml-1 font-semibold">({claim.excluded_line_items!.length} excluded)</span>
                  )}
                </p>
              </div>
              <a
                href={`/dashboard/scope-review?claim=${claim.id}`}
                className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ml-4"
              >
                Review Scope
              </a>
            </div>
          )}

          {/* Reprocess button */}
          {(isReady || claim.status === "needs_improvement" || claim.status === "error") && !showUpload && !isReprocessingState && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-blue-800">Reprocess this claim</p>
                <p className="text-xs text-blue-600 mt-0.5">Re-analyze all documents and regenerate the claim package</p>
              </div>
              <button
                onClick={handleReprocess}
                disabled={reprocessing}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ml-4"
              >
                {reprocessing ? "Starting..." : "Reprocess Claim"}
              </button>
            </div>
          )}

          {/* Success/Error messages */}
          {uploadSuccess && (
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 mb-4">
              {uploadSuccess}
            </div>
          )}
          {uploadError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
              {uploadError}
            </div>
          )}

          {/* Upload form */}
          {showUpload && (
            <div ref={formRef} className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {(Object.entries(CATEGORY_CONFIG) as [UploadCategory, (typeof CATEGORY_CONFIG)[UploadCategory]][]).map(
                  ([key, config]) => (
                    <button
                      key={key}
                      onClick={() => {
                        setSelectedCategory(key);
                        setNewFiles([]);
                      }}
                      className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                        selectedCategory === key
                          ? "bg-[var(--navy)] text-white border-[var(--navy)]"
                          : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      {config.label}
                    </button>
                  )
                )}
              </div>

              <FileUploadZone
                label={CATEGORY_CONFIG[selectedCategory].label}
                description={CATEGORY_CONFIG[selectedCategory].description}
                accept={CATEGORY_CONFIG[selectedCategory].accept}
                multiple={CATEGORY_CONFIG[selectedCategory].multiple}
                files={newFiles}
                onFilesChange={setNewFiles}
              />

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowUpload(false);
                    setNewFiles([]);
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUploadDocuments}
                  disabled={uploading || newFiles.length === 0}
                  className="bg-[var(--red)] hover:bg-[var(--red-dark)] disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-semibold transition-colors"
                >
                  {uploading ? "Uploading..." : `Upload ${newFiles.length} File${newFiles.length !== 1 ? "s" : ""}`}
                </button>
              </div>
            </div>
          )}
        </div>

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
                      {files.map((filename) => {
                        const fileKey = `${folder}/${filename}`;
                        const isDeleting = deleting === fileKey;
                        const isConfirming = deleteConfirm?.folder === folder && deleteConfirm?.fileName === filename;

                        return (
                          <div
                            key={filename}
                            className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 group relative"
                          >
                            {/* Download button */}
                            <button
                              onClick={() => handleDownloadSource(folder, filename)}
                              disabled={downloading === fileKey || isDeleting}
                              className="flex items-center gap-2 flex-1 min-w-0 text-left hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
                            >
                              <svg className="w-4 h-4 text-gray-400 group-hover:text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M6 20h12a2 2 0 002-2V8l-6-6H6a2 2 0 00-2 2v14a2 2 0 002 2z" />
                              </svg>
                              <span className="text-xs text-gray-600 truncate">
                                {downloading === fileKey ? "Downloading..." : isDeleting ? "Deleting..." : filename}
                              </span>
                            </button>

                            {/* Delete confirmation inline */}
                            {isConfirming ? (
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="text-xs text-red-600 mr-1">Delete?</span>
                                <button
                                  onClick={() => handleDeleteFile(folder, filename)}
                                  className="text-xs bg-red-600 text-white px-2 py-0.5 rounded hover:bg-red-700 transition-colors"
                                >
                                  Yes
                                </button>
                                <button
                                  onClick={() => setDeleteConfirm(null)}
                                  className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded hover:bg-gray-300 transition-colors"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              /* Trash icon — visible on hover */
                              <button
                                onClick={() => setDeleteConfirm({ folder, fileName: filename, dbField: key })}
                                disabled={isDeleting}
                                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all shrink-0 disabled:opacity-50"
                                title="Delete file"
                              >
                                {isDeleting ? (
                                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                  </svg>
                                ) : (
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                )}
                              </button>
                            )}
                          </div>
                        );
                      })}
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
