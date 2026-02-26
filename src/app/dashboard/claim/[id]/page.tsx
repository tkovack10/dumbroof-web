"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import { FileUploadZone } from "@/components/file-upload-zone";

interface Claim {
  id: string;
  address: string;
  carrier: string;
  phase: string;
  status: string;
  file_path: string;
  output_files: string[] | null;
  created_at: string;
  user_notes?: string | null;
  photo_integrity?: { total: number; flagged: number; score: string } | null;
}

type UploadCategory = "photos" | "scope" | "weather" | "other";

const CATEGORY_CONFIG: Record<
  UploadCategory,
  { label: string; description: string; accept: string; multiple: boolean; dbField: string }
> = {
  photos: {
    label: "Additional Photos",
    description: "More inspection photos, construction photos, or damage close-ups",
    accept: ".jpg,.jpeg,.png,.heic",
    multiple: true,
    dbField: "photo_files",
  },
  scope: {
    label: "Carrier Scope / Insurance Documents",
    description: "Insurance company's estimate, adjuster report, or revised scope",
    accept: ".pdf",
    multiple: false,
    dbField: "scope_files",
  },
  weather: {
    label: "Weather Data",
    description: "HailTrace report, NOAA data, or storm documentation",
    accept: ".pdf,.jpg,.jpeg,.png",
    multiple: true,
    dbField: "weather_files",
  },
  other: {
    label: "Other Documents",
    description: "Email screenshots, adjuster correspondence, change orders, or any other supporting documents",
    accept: ".pdf,.jpg,.jpeg,.png,.doc,.docx",
    multiple: true,
    dbField: "other_files",
  },
};

export default function ClaimDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const claimId = params.id as string;

  const [claim, setClaim] = useState<Claim | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<UploadCategory>("photos");
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const fetchClaim = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    const { data } = await supabase
      .from("claims")
      .select("*")
      .eq("id", claimId)
      .eq("user_id", user.id)
      .single();

    setClaim(data);
    setLoading(false);
  }, [claimId, router, supabase]);

  useEffect(() => {
    fetchClaim();
    const interval = setInterval(fetchClaim, 5000);
    return () => clearInterval(interval);
  }, [fetchClaim]);

  const handleDownload = async (filename: string) => {
    if (!claim) return;
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

  const handleUploadDocuments = async () => {
    if (!claim || newFiles.length === 0) return;
    setUploading(true);
    setUploadError("");
    setUploadSuccess("");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const catConfig = CATEGORY_CONFIG[selectedCategory];
      const folder = selectedCategory === "other" ? "other" : selectedCategory;
      const uploadedNames: string[] = [];

      for (const file of newFiles) {
        const filePath = `${claim.file_path}/${folder}/${file.name}`;
        const { error } = await supabase.storage
          .from("claim-documents")
          .upload(filePath, file, { upsert: true });
        if (error) throw new Error(`Failed to upload ${file.name}: ${error.message}`);
        uploadedNames.push(file.name);
      }

      // Update the claim record with new file names
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingFiles: string[] =
        (claim as unknown as Record<string, unknown>)[catConfig.dbField] as string[] || [];
      const updatedFiles = [...existingFiles, ...uploadedNames];

      await supabase
        .from("claims")
        .update({ [catConfig.dbField]: updatedFiles })
        .eq("id", claim.id);

      setUploadSuccess(
        `${uploadedNames.length} file${uploadedNames.length > 1 ? "s" : ""} uploaded successfully`
      );
      setNewFiles([]);
      setShowUpload(false);
      fetchClaim();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    }
    setUploading(false);
  };

  const statusConfig: Record<string, { color: string; label: string; bg: string }> = {
    uploaded: { color: "text-blue-700", label: "Uploaded", bg: "bg-blue-100" },
    processing: { color: "text-amber-700", label: "Processing", bg: "bg-amber-100" },
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

  if (!claim) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-4">Claim not found</p>
          <a href="/dashboard" className="text-[var(--red)] font-medium">
            Back to Dashboard
          </a>
        </div>
      </main>
    );
  }

  const sc = statusConfig[claim.status] || statusConfig.uploaded;
  const isReady = claim.status === "ready" && claim.output_files?.length;
  const isProcessing = claim.status === "processing";
  const integrity = claim.photo_integrity;

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
              dumb roof
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
            </div>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}
            >
              {isProcessing && (
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
              {sc.label}
            </span>
          </div>

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
              <p className="text-xs font-semibold text-gray-400 uppercase mb-1">
                Your Notes
              </p>
              <p className="text-sm text-gray-700">{claim.user_notes}</p>
            </div>
          )}
        </div>

        {/* Processing indicator */}
        {isProcessing && (
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
                  Analyzing documents and generating your claim package...
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  This typically takes 2-5 minutes
                </p>
              </div>
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
            <p className="text-sm text-red-700">
              Processing failed. Our team has been notified and will look into
              it.
            </p>
          </div>
        )}

        {/* Upload Additional Documents */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--navy)]">
                Add Documents
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Upload additional photos, carrier scope, weather data, or correspondence
              </p>
            </div>
            {!showUpload && (
              <button
                onClick={() => {
                  setShowUpload(true);
                  setTimeout(
                    () =>
                      formRef.current?.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                      }),
                    100
                  );
                }}
                className="bg-[var(--navy)] hover:bg-[var(--navy-light)] text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                + Upload Files
              </button>
            )}
          </div>

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

          {showUpload && (
            <div ref={formRef} className="space-y-5">
              {/* Category selector */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(
                  Object.entries(CATEGORY_CONFIG) as [
                    UploadCategory,
                    (typeof CATEGORY_CONFIG)[UploadCategory],
                  ][]
                ).map(([key, config]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setSelectedCategory(key);
                      setNewFiles([]);
                    }}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                      selectedCategory === key
                        ? "bg-[var(--navy)] text-white border-[var(--navy)]"
                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    {config.label.split(" / ")[0]}
                  </button>
                ))}
              </div>

              {/* File upload zone */}
              <FileUploadZone
                label={CATEGORY_CONFIG[selectedCategory].label}
                description={CATEGORY_CONFIG[selectedCategory].description}
                accept={CATEGORY_CONFIG[selectedCategory].accept}
                multiple={CATEGORY_CONFIG[selectedCategory].multiple}
                files={newFiles}
                onFilesChange={setNewFiles}
              />

              {/* Actions */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleUploadDocuments}
                  disabled={newFiles.length === 0 || uploading}
                  className="bg-[var(--red)] hover:bg-[var(--red-dark)] disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-xl font-semibold transition-colors text-sm"
                >
                  {uploading ? (
                    <span className="flex items-center gap-2">
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
                      Uploading...
                    </span>
                  ) : (
                    `Upload ${newFiles.length} File${newFiles.length !== 1 ? "s" : ""}`
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowUpload(false);
                    setNewFiles([]);
                    setUploadError("");
                  }}
                  className="text-gray-400 hover:text-gray-600 text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
