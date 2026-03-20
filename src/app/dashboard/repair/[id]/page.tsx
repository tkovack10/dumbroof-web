"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import type { Repair, RepairCheckpoint } from "@/types/repair";
import {
  REPAIR_TYPE_LABELS,
  getRepairDisplayState,
} from "@/lib/claim-constants";
import { FileUploadZone } from "@/components/file-upload-zone";
import { directUpload } from "@/lib/upload-utils";

const SEVERITY_CONFIG: Record<string, { color: string; label: string }> = {
  minor: { color: "bg-green-100 text-green-700", label: "Minor" },
  moderate: { color: "bg-amber-100 text-amber-700", label: "Moderate" },
  major: { color: "bg-orange-100 text-orange-700", label: "Major" },
  critical: { color: "bg-red-100 text-red-700", label: "Critical" },
  emergency: { color: "bg-red-200 text-red-800", label: "Emergency" },
};

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "https://dumbroof-backend-production.up.railway.app";

export default function RepairDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const repairId = params.id as string;

  const [repair, setRepair] = useState<Repair | null>(null);
  const [checkpoints, setCheckpoints] = useState<RepairCheckpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [rooferNotes, setRooferNotes] = useState("");

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

  const fetchCheckpoints = useCallback(async () => {
    const { data } = await supabase
      .from("repair_checkpoints")
      .select("*")
      .eq("repair_id", repairId)
      .order("checkpoint_number");
    setCheckpoints(data || []);
  }, [repairId, supabase]);

  useEffect(() => {
    fetchRepair();
    fetchCheckpoints();
  }, [fetchRepair, fetchCheckpoints]);

  // Adaptive polling based on display state
  useEffect(() => {
    if (!repair) return;
    const activeCheckpoint = checkpoints.find(
      (cp) => cp.id === repair.current_checkpoint_id
    );
    const displayState = getRepairDisplayState(repair, activeCheckpoint);

    if (!displayState.polling) return;

    // Fast polling when AI is analyzing (3s), slow otherwise (10s)
    const interval = setInterval(
      () => {
        fetchRepair();
        fetchCheckpoints();
      },
      activeCheckpoint?.status === "analyzing" ||
        activeCheckpoint?.status === "photos_uploaded"
        ? 3000
        : 10000
    );
    return () => clearInterval(interval);
  }, [
    repair?.status,
    repair?.current_checkpoint_id,
    checkpoints,
    fetchRepair,
    fetchCheckpoints,
  ]);

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

  const handleCheckpointUpload = async (checkpoint: RepairCheckpoint) => {
    if (!repair || uploadFiles.length === 0) return;
    setUploading(true);

    try {
      // Upload each file via signed URL
      const uploadedNames: string[] = [];
      for (const file of uploadFiles) {
        const res = await fetch("/api/repair-checkpoint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            repairPath: repair.file_path,
            checkpointNumber: checkpoint.checkpoint_number,
          }),
        });
        const urlData = await res.json();
        if (!res.ok) throw new Error(urlData.error);

        await directUpload(urlData.signedUrl, file);
        uploadedNames.push(urlData.safeName);
      }

      // Submit checkpoint via backend API
      await fetch(
        `${BACKEND_URL}/api/repair/${repair.id}/checkpoint/${checkpoint.id}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photo_files: uploadedNames,
            roofer_notes: rooferNotes || null,
          }),
        }
      );

      // Reset upload state and refresh
      setUploadFiles([]);
      setRooferNotes("");
      await Promise.all([fetchRepair(), fetchCheckpoints()]);
    } catch (err) {
      console.error("Checkpoint upload failed:", err);
      alert("Upload failed. Please try again.");
    }
    setUploading(false);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-white/[0.04] flex items-center justify-center">
        <p className="text-[var(--gray-dim)]">Loading...</p>
      </main>
    );
  }

  if (!repair) {
    return (
      <main className="min-h-screen bg-white/[0.04] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[var(--gray-muted)] mb-4">Repair not found</p>
          <a href="/dashboard" className="text-[var(--red)] font-medium">
            Back to Dashboard
          </a>
        </div>
      </main>
    );
  }

  const activeCheckpoint = checkpoints.find(
    (cp) => cp.id === repair.current_checkpoint_id
  );
  const displayState = getRepairDisplayState(repair, activeCheckpoint);
  const isReady = repair.status === "ready" && repair.output_files?.length;
  const isProcessing =
    repair.status === "processing" || repair.status === "uploaded";
  const isActive = repair.status === "active";
  const severity = repair.severity ? SEVERITY_CONFIG[repair.severity] : null;
  const hasCheckpoints = checkpoints.length > 0;

  return (
    <main className="min-h-screen bg-white/[0.04]">
      {/* Top Bar */}
      <nav className="bg-[var(--navy)] border-b border-white/10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white">
              DR
            </div>
            <span className="text-white font-bold text-lg tracking-tight">
              dumb roof
              <sup className="text-[9px] font-medium align-super ml-0.5">
                ™
              </sup>
            </span>
          </div>
          <a
            href="/dashboard"
            className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors"
          >
            Back to Dashboard
          </a>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        {/* Repair Header */}
        <div className="bg-white rounded-2xl border border-[var(--border-glass)] p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                  REPAIR
                </span>
                {severity && (
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded ${severity.color}`}
                  >
                    {severity.label}
                  </span>
                )}
                {repair.pivot_count ? (
                  <span className="text-xs font-medium px-2 py-0.5 rounded bg-purple-100 text-purple-700">
                    {repair.pivot_count} pivot
                    {repair.pivot_count > 1 ? "s" : ""}
                  </span>
                ) : null}
              </div>
              <h1 className="text-xl font-bold text-[var(--navy)]">
                {repair.address}
              </h1>
              <p className="text-sm text-[var(--gray-muted)] mt-1">
                {repair.homeowner_name} &middot;{" "}
                {repair.repair_type
                  ? REPAIR_TYPE_LABELS[repair.repair_type] || repair.repair_type
                  : "Pending diagnosis"}{" "}
                &middot; {new Date(repair.created_at).toLocaleDateString()}
              </p>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${displayState.color}`}
            >
              {displayState.polling && (
                <svg
                  className="animate-spin w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              )}
              {displayState.label}
            </span>
          </div>

          {/* Repair Details */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {repair.total_price ? (
              <div className="bg-[var(--navy)] rounded-lg px-4 py-3 text-center">
                <p className="text-xs text-[var(--gray-dim)]">Price</p>
                <p className="text-lg font-bold text-white">
                  $
                  {repair.total_price.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                  })}
                </p>
              </div>
            ) : null}
            <div className="bg-white/[0.04] rounded-lg px-4 py-3">
              <p className="text-xs text-[var(--gray-dim)]">Skill Level</p>
              <p className="text-sm font-semibold text-[var(--navy)] capitalize">
                {repair.skill_level || "Journeyman"}
              </p>
            </div>
            <div className="bg-white/[0.04] rounded-lg px-4 py-3">
              <p className="text-xs text-[var(--gray-dim)]">Language</p>
              <p className="text-sm font-semibold text-[var(--navy)]">
                {repair.preferred_language === "es" ? "Spanish" : "English"}
              </p>
            </div>
            {repair.roofer_name && (
              <div className="bg-white/[0.04] rounded-lg px-4 py-3">
                <p className="text-xs text-[var(--gray-dim)]">Roofer</p>
                <p className="text-sm font-semibold text-[var(--navy)]">
                  {repair.roofer_name}
                </p>
              </div>
            )}
          </div>

          {repair.leak_description && (
            <div className="mt-4 bg-white/[0.04] rounded-lg px-4 py-3">
              <p className="text-xs font-semibold text-[var(--gray-dim)] uppercase mb-1">
                Leak Description
              </p>
              <p className="text-sm text-[var(--gray)]">{repair.leak_description}</p>
            </div>
          )}
        </div>

        {/* Processing indicator (initial diagnosis) */}
        {isProcessing && !hasCheckpoints && (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <svg
                className="animate-spin w-5 h-5 text-amber-600"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-amber-800">
                  AI is analyzing your photos and diagnosing the leak...
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  Generating repair instructions + homeowner ticket. This
                  typically takes 1-2 minutes.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ========== REPAIR TIMELINE ========== */}
        {hasCheckpoints && (
          <div className="bg-white rounded-2xl border border-[var(--border-glass)] p-6">
            <h2 className="text-sm font-semibold text-[var(--navy)] mb-5">
              Repair Timeline
            </h2>

            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-white/[0.04]" />

              <div className="space-y-6">
                {/* Initial Diagnosis */}
                <TimelineItem
                  icon="ai"
                  title="Initial Diagnosis"
                  status="passed"
                >
                  <p className="text-sm text-[var(--gray)]">
                    {repair.repair_type &&
                      (REPAIR_TYPE_LABELS[repair.repair_type] ||
                        repair.repair_type)}
                    {repair.original_diagnosis_code &&
                      repair.original_diagnosis_code !== repair.repair_type && (
                        <span className="text-[var(--gray-dim)] ml-1">
                          (originally{" "}
                          {REPAIR_TYPE_LABELS[repair.original_diagnosis_code] ||
                            repair.original_diagnosis_code}
                          )
                        </span>
                      )}
                  </p>
                </TimelineItem>

                {/* Checkpoints */}
                {checkpoints.map((cp) => {
                  const isCurrent = cp.id === repair.current_checkpoint_id;
                  const isPending = cp.status === "pending";
                  const isAnalyzing =
                    cp.status === "analyzing" ||
                    cp.status === "photos_uploaded";
                  const isPassed =
                    cp.status === "passed" || cp.status === "skipped";
                  const isPivot = cp.ai_decision === "pivot";

                  return (
                    <div key={cp.id}>
                      <TimelineItem
                        icon={isPassed ? "check" : isAnalyzing ? "spin" : "dot"}
                        title={`Checkpoint ${cp.checkpoint_number} — ${formatCheckpointType(cp.checkpoint_type)}`}
                        status={
                          isPassed
                            ? "passed"
                            : isAnalyzing
                              ? "analyzing"
                              : "pending"
                        }
                      >
                        {/* Instructions */}
                        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-2">
                          <p className="text-sm text-blue-800">
                            {cp.instructions_en}
                          </p>
                          {cp.what_to_photograph && (
                            <p className="text-xs text-blue-600 mt-1">
                              Photograph: {cp.what_to_photograph}
                            </p>
                          )}
                        </div>

                        {/* AI Analysis Result */}
                        {cp.ai_analysis && (
                          <div
                            className={`rounded-lg p-3 mb-2 ${
                              isPivot
                                ? "bg-purple-50 border border-purple-100"
                                : "bg-green-50 border border-green-100"
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-semibold text-[var(--gray-muted)]">
                                AI Analysis
                              </span>
                              {cp.ai_confidence != null && (
                                <span className="text-xs text-[var(--gray-dim)]">
                                  {Math.round(cp.ai_confidence * 100)}%
                                  confidence
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-[var(--gray)]">
                              {cp.ai_analysis}
                            </p>
                          </div>
                        )}

                        {/* Message to roofer */}
                        {cp.message_to_roofer_en && isPassed && (
                          <div className="bg-white/[0.04] rounded-lg p-3 mb-2">
                            <p className="text-sm text-[var(--gray)] italic">
                              &ldquo;{cp.message_to_roofer_en}&rdquo;
                            </p>
                          </div>
                        )}

                        {/* Pivot Alert */}
                        {isPivot && cp.pivot_reason && (
                          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-2">
                            <p className="text-xs font-semibold text-purple-700 mb-1">
                              DIAGNOSIS CHANGED
                            </p>
                            <p className="text-sm text-purple-800">
                              {cp.pivot_reason}
                            </p>
                          </div>
                        )}

                        {/* Photo count */}
                        {cp.photo_files && cp.photo_files.length > 0 && (
                          <p className="text-xs text-[var(--gray-dim)]">
                            {cp.photo_files.length} photo
                            {cp.photo_files.length !== 1 ? "s" : ""} uploaded
                          </p>
                        )}

                        {/* Upload zone for active pending checkpoint */}
                        {isCurrent && isPending && (
                          <div className="mt-3 space-y-3">
                            <FileUploadZone
                              label="Checkpoint Photos"
                              description="Upload the photos requested above"
                              accept=".jpg,.jpeg,.png,.heic,.heif,.webp"
                              multiple
                              files={uploadFiles}
                              onFilesChange={setUploadFiles}
                            />

                            <div>
                              <label className="block text-xs font-medium text-[var(--gray-muted)] mb-1">
                                Notes (optional)
                              </label>
                              <textarea
                                value={rooferNotes}
                                onChange={(e) => setRooferNotes(e.target.value)}
                                placeholder="Any observations to share with the AI..."
                                className="w-full border border-[var(--border-glass)] rounded-lg px-3 py-2 text-sm resize-none h-16 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>

                            <button
                              onClick={() => handleCheckpointUpload(cp)}
                              disabled={uploading || uploadFiles.length === 0}
                              className="w-full bg-[var(--red)] hover:bg-[var(--red-dark)] disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors"
                            >
                              {uploading
                                ? "Uploading..."
                                : `Submit ${uploadFiles.length} Photo${uploadFiles.length !== 1 ? "s" : ""}`}
                            </button>
                          </div>
                        )}

                        {/* Analyzing indicator */}
                        {isCurrent && isAnalyzing && (
                          <div className="mt-2 flex items-center gap-2 text-amber-600">
                            <svg
                              className="animate-spin w-4 h-4"
                              fill="none"
                              viewBox="0 0 24 24"
                            >
                              <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                              />
                              <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                              />
                            </svg>
                            <span className="text-sm font-medium">
                              AI is reviewing your photos...
                            </span>
                          </div>
                        )}
                      </TimelineItem>
                    </div>
                  );
                })}

                {/* Completion indicator */}
                {isReady && (
                  <TimelineItem icon="check" title="Repair Complete" status="passed">
                    <p className="text-sm text-green-700">
                      All checkpoints passed. Final documents ready below.
                    </p>
                  </TimelineItem>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Output Files */}
        {repair.output_files && repair.output_files.length > 0 && (
          <div className="bg-white rounded-2xl border border-[var(--border-glass)] p-6">
            <h2 className="text-sm font-semibold text-[var(--navy)] mb-4">
              {isReady ? "Repair Documents Ready" : "Preliminary Documents"}
            </h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {repair.output_files.map((file) => {
                const isInstructions = file.includes("INSTRUCTIONS");
                const isTicket = file.includes("TICKET");
                const isReceipt = file.includes("RECEIPT");
                const isLog = file.includes("REPAIR_LOG");

                let description = "Download";
                if (isInstructions)
                  description = "For the roofer — bilingual, skill-calibrated";
                else if (isTicket)
                  description =
                    "For the homeowner — diagnosis, price, approval";
                else if (isReceipt)
                  description = "Completion receipt with warranty";
                else if (isLog)
                  description = "Full repair timeline with checkpoints";

                return (
                  <button
                    key={file}
                    onClick={() => handleDownload(file)}
                    disabled={downloading === file}
                    className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-left hover:bg-green-100 transition-colors disabled:opacity-50"
                  >
                    <svg
                      className="w-5 h-5 text-green-600 shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <div>
                      <p className="text-sm text-[var(--gray)] font-medium">
                        {file.replace(/_/g, " ").replace(".pdf", "")}
                      </p>
                      <p className="text-xs text-[var(--gray-muted)]">{description}</p>
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
                Something went wrong. Please try submitting again with clearer
                photos.
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

// ========== TIMELINE COMPONENTS ==========

function TimelineItem({
  icon,
  title,
  status,
  children,
}: {
  icon: "ai" | "check" | "spin" | "dot";
  title: string;
  status: "passed" | "analyzing" | "pending";
  children: React.ReactNode;
}) {
  const iconColors = {
    passed: "bg-green-500 text-white",
    analyzing: "bg-amber-500 text-white",
    pending: "bg-white/[0.04] text-[var(--gray-muted)]",
  };

  return (
    <div className="relative pl-10">
      {/* Icon */}
      <div
        className={`absolute left-1.5 top-0.5 w-5 h-5 rounded-full flex items-center justify-center ${iconColors[status]}`}
      >
        {icon === "check" && (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
        {icon === "ai" && (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        )}
        {icon === "spin" && (
          <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {icon === "dot" && <div className="w-2 h-2 rounded-full bg-white/[0.04]" />}
      </div>

      {/* Content */}
      <div className="pb-2">
        <h3
          className={`text-sm font-semibold mb-1 ${status === "pending" ? "text-[var(--gray-dim)]" : "text-[var(--navy)]"}`}
        >
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

function formatCheckpointType(type: string): string {
  const labels: Record<string, string> = {
    verify_diagnosis: "Verify Diagnosis",
    expose_and_inspect: "Expose & Inspect",
    mid_repair_check: "Mid-Repair Check",
    completion_verify: "Completion Verification",
  };
  return labels[type] || type.replace(/_/g, " ");
}
