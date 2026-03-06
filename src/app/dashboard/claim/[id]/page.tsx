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
  error_message?: string | null;
  correspondence_count?: number;
  pending_drafts?: number;
  pending_edits?: number;
  latest_carrier_position?: string;
}

interface EditRequest {
  id: string;
  claim_id: string;
  from_email: string;
  original_subject: string;
  original_body: string;
  request_type: string;
  attachment_paths: string[];
  ai_summary: {
    changes: { action: string; item: string; details: string }[];
    request_type: string;
    confidence: number;
  } | null;
  status: string;
  applied_at: string | null;
  created_at: string;
}

interface Correspondence {
  id: string;
  original_from: string;
  original_subject: string;
  original_date: string;
  text_body: string;
  carrier_name: string;
  carrier_position: {
    stance: string;
    key_arguments: string[];
    weaknesses: { weakness: string; evidence: string; suggested_question: string }[];
    tone: string;
    urgency: string;
    summary: string;
  } | null;
  suggested_action: string;
  analysis_status: string;
  status: string;
  created_at: string;
}

interface EmailDraft {
  id: string;
  correspondence_id: string;
  to_email: string;
  subject: string;
  body_html: string;
  body_text: string;
  selected_photos: { path: string; annotation_key: string; description: string; reasons: string[]; score: number }[];
  response_strategy: string;
  carrier_weaknesses: { weakness: string; evidence: string; suggested_question: string }[];
  compliance_role: string;
  edited_body_html: string | null;
  status: string;
  generation_cost: number;
  created_at: string;
}

type UploadCategory = "photos" | "scope" | "weather" | "other";

const CATEGORY_CONFIG: Record<
  UploadCategory,
  { label: string; description: string; accept: string; multiple: boolean; dbField: string }
> = {
  photos: {
    label: "Additional Photos",
    description: "More inspection photos, construction photos, or damage close-ups. ZIP archives and PDFs with photos also supported.",
    accept: ".jpg,.jpeg,.png,.heic,.heif,.webp,.tiff,.tif,.bmp,.pdf,.zip",
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
    accept: ".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.tiff,.tif,.bmp,.zip",
    multiple: true,
    dbField: "weather_files",
  },
  other: {
    label: "Other Documents",
    description: "Email screenshots, adjuster correspondence, change orders, or any other supporting documents",
    accept: ".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.tiff,.tif,.bmp,.doc,.docx,.zip",
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
  const [reprocessing, setReprocessing] = useState(false);
  const [correspondence, setCorrespondence] = useState<Correspondence[]>([]);
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<string | null>(null);
  const [editedHtml, setEditedHtml] = useState<string>("");
  const [sendingDraft, setSendingDraft] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [editRequests, setEditRequests] = useState<EditRequest[]>([]);
  const [applyingEdit, setApplyingEdit] = useState<string | null>(null);
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

  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

  const fetchCorrespondence = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/correspondence/${claimId}`);
      if (res.ok) {
        const data = await res.json();
        setCorrespondence(data.correspondence || []);
      }
    } catch (err) {
      console.error("Failed to fetch correspondence:", err);
    }
  }, [claimId, BACKEND_URL]);

  const fetchDrafts = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/drafts/${claimId}`);
      if (res.ok) {
        const data = await res.json();
        setDrafts(data.drafts || []);
      }
    } catch (err) {
      console.error("Failed to fetch drafts:", err);
    }
  }, [claimId, BACKEND_URL]);

  const fetchEditRequests = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/edit-requests/${claimId}`);
      if (res.ok) {
        const data = await res.json();
        setEditRequests(data.edit_requests || []);
      }
    } catch (err) {
      console.error("Failed to fetch edit requests:", err);
    }
  }, [claimId, BACKEND_URL]);

  useEffect(() => {
    fetchClaim();
    fetchCorrespondence();
    fetchDrafts();
    fetchEditRequests();
  }, [fetchClaim, fetchCorrespondence, fetchDrafts, fetchEditRequests]);

  // Poll for status changes only when claim is actively being processed
  useEffect(() => {
    if (!claim || (claim.status !== "uploaded" && claim.status !== "processing")) return;
    const interval = setInterval(fetchClaim, 5000);
    return () => clearInterval(interval);
  }, [claim?.status, fetchClaim]);

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

      // Upload via server-signed URLs (bypasses RLS, sanitizes filenames server-side)
      for (const file of newFiles) {
        const res = await fetch("/api/storage/sign-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder, fileName: file.name, claimPath: claim.file_path }),
        });
        const urlData = await res.json();
        if (!res.ok) throw new Error(`Failed to upload ${file.name}: ${urlData.error}`);

        const { error } = await supabase.storage
          .from("claim-documents")
          .uploadToSignedUrl(urlData.path, urlData.token, file);
        if (error) throw new Error(`Failed to upload ${file.name}: ${error.message}`);
        uploadedNames.push(urlData.safeName);
      }

      // Update the claim record with new file names via server API (bypasses RLS)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingFiles: string[] =
        (claim as unknown as Record<string, unknown>)[catConfig.dbField] as string[] || [];
      const updatedFiles = [...existingFiles, ...uploadedNames];

      const updates: Record<string, unknown> = { [catConfig.dbField]: updatedFiles };
      // Auto-upgrade phase when scope is uploaded to a pre-scope claim
      if (selectedCategory === "scope" && claim.phase === "pre-scope") {
        updates.phase = "post-scope";
      }

      const updateRes = await fetch("/api/claims/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimId: claim.id, updates }),
      });
      if (!updateRes.ok) {
        const errData = await updateRes.json();
        throw new Error(`Failed to update claim: ${errData.error}`);
      }

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

  const handleReprocess = async () => {
    if (!claim) return;
    setReprocessing(true);
    setUploadError("");
    try {
      // Call backend reprocess endpoint directly — uses service_role (bypasses RLS),
      // sets status to "processing", and starts processing immediately (no poller delay)
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

  const handleApproveSend = async (draft: EmailDraft) => {
    setSendingDraft(draft.id);
    try {
      // Get photo paths for attachments
      const photoPaths = (draft.selected_photos || []).map((p) => p.path).filter(Boolean);

      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft_id: draft.id,
          to: draft.to_email,
          subject: draft.subject,
          body_html: draft.edited_body_html || draft.body_html,
          photo_paths: photoPaths,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Send failed");
      }

      fetchDrafts();
      fetchCorrespondence();
      fetchClaim();
    } catch (err) {
      console.error("Failed to send:", err);
      alert(err instanceof Error ? err.message : "Failed to send email");
    }
    setSendingDraft(null);
  };

  const handleSaveDraftEdits = async (draftId: string) => {
    try {
      await fetch(`${BACKEND_URL}/api/drafts/${draftId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edited_body_html: editedHtml, status: "edited" }),
      });
      setEditingDraft(null);
      fetchDrafts();
    } catch (err) {
      console.error("Failed to save edits:", err);
    }
  };

  const handleRejectDraft = async (draftId: string) => {
    try {
      await fetch(`${BACKEND_URL}/api/drafts/${draftId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected" }),
      });
      fetchDrafts();
      fetchClaim();
    } catch (err) {
      console.error("Failed to reject draft:", err);
    }
  };

  const handleRegenerateDraft = async (draftId: string, strategy?: string) => {
    setRegenerating(draftId);
    try {
      const url = new URL(`${BACKEND_URL}/api/drafts/${draftId}/regenerate`);
      if (strategy) url.searchParams.set("strategy", strategy);
      await fetch(url.toString(), { method: "POST" });
      // Poll for completion
      setTimeout(() => {
        fetchDrafts();
        setRegenerating(null);
      }, 10000);
    } catch (err) {
      console.error("Failed to regenerate:", err);
      setRegenerating(null);
    }
  };

  const handleTriggerAnalysis = async (correspondenceId: string) => {
    try {
      await fetch(`${BACKEND_URL}/api/analyze-correspondence/${correspondenceId}`, {
        method: "POST",
      });
      // Poll for completion
      setTimeout(() => {
        fetchCorrespondence();
        fetchDrafts();
      }, 15000);
    } catch (err) {
      console.error("Failed to trigger analysis:", err);
    }
  };

  const handleApplyEditRequest = async (requestId: string) => {
    setApplyingEdit(requestId);
    try {
      const res = await fetch(`${BACKEND_URL}/api/edit-requests/${requestId}/apply`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Apply failed");
      }
      fetchEditRequests();
      fetchClaim();
    } catch (err) {
      console.error("Failed to apply edit request:", err);
      alert(err instanceof Error ? err.message : "Failed to apply edit request");
    }
    setApplyingEdit(null);
  };

  const handleRejectEditRequest = async (requestId: string) => {
    try {
      await fetch(`${BACKEND_URL}/api/edit-requests/${requestId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected" }),
      });
      fetchEditRequests();
      fetchClaim();
    } catch (err) {
      console.error("Failed to reject edit request:", err);
    }
  };

  const stanceBadge = (stance: string) => {
    const configs: Record<string, { bg: string; text: string; label: string }> = {
      full_denial: { bg: "bg-red-100", text: "text-red-700", label: "Full Denial" },
      partial_denial: { bg: "bg-orange-100", text: "text-orange-700", label: "Partial Denial" },
      underpayment: { bg: "bg-amber-100", text: "text-amber-700", label: "Underpayment" },
      request_for_info: { bg: "bg-blue-100", text: "text-blue-700", label: "Info Request" },
      reinspection_offer: { bg: "bg-purple-100", text: "text-purple-700", label: "Reinspection" },
      acceptance: { bg: "bg-green-100", text: "text-green-700", label: "Acceptance" },
    };
    const c = configs[stance] || { bg: "bg-gray-100", text: "text-gray-700", label: stance || "Pending" };
    return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>{c.label}</span>;
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
  const isUploaded = claim.status === "uploaded";
  const isReprocessingState = isProcessing || isUploaded;
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
              {isReprocessingState && (
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
              {isUploaded ? "Queued for Processing" : sc.label}
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
        {isReprocessingState && (
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
                  {isUploaded
                    ? "Claim queued — waiting for processing to begin..."
                    : "Analyzing documents and generating your claim package..."}
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
            <p className="text-sm font-medium text-red-800 mb-1">
              Processing failed
            </p>
            {claim.error_message ? (
              <p className="text-sm text-red-600 font-mono bg-red-100/50 rounded px-3 py-2 mt-2">
                {claim.error_message}
              </p>
            ) : (
              <p className="text-sm text-red-600">
                Our team has been notified and will look into it.
              </p>
            )}
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

          {/* Reprocess button — visible when claim is ready and user may have uploaded new docs */}
          {isReady && !showUpload && !isReprocessingState && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-blue-800">
                  Updated documents? Reprocess to generate new reports.
                </p>
                <p className="text-xs text-blue-600 mt-0.5">
                  If you uploaded a revised scope or appraisal award, reprocess to compare and record changes.
                </p>
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

        {/* ============================================================ */}
        {/* EDIT REQUESTS PANEL                                          */}
        {/* ============================================================ */}
        {editRequests.filter((r) => r.status === "pending").length > 0 && (
          <div className="bg-white rounded-2xl border-2 border-amber-300 p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <h2 className="text-sm font-semibold text-[var(--navy)]">
                Edit Requests
              </h2>
              <span className="ml-auto text-xs text-amber-600 font-medium">
                {editRequests.filter((r) => r.status === "pending").length} pending
              </span>
            </div>
            <div className="space-y-3">
              {editRequests
                .filter((r) => r.status === "pending")
                .map((req) => {
                  const summary =
                    typeof req.ai_summary === "string"
                      ? JSON.parse(req.ai_summary)
                      : req.ai_summary;
                  const isApplying = applyingEdit === req.id;

                  return (
                    <div
                      key={req.id}
                      className="border border-amber-200 bg-amber-50/50 rounded-xl p-4"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-sm font-medium text-[var(--navy)]">
                            {req.original_subject || "Edit Request"}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            From {req.from_email} &middot;{" "}
                            {new Date(req.created_at).toLocaleDateString()}{" "}
                            {new Date(req.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                          {req.request_type.replace(/_/g, " ")}
                        </span>
                      </div>

                      {/* AI Summary of Changes */}
                      {summary && summary.changes && summary.changes.length > 0 && (
                        <div className="bg-white border border-amber-100 rounded-lg p-3 mb-3">
                          <p className="text-xs font-semibold text-gray-500 mb-1.5">
                            AI-Parsed Changes
                            {summary.confidence && (
                              <span className="ml-2 text-gray-400 font-normal">
                                ({summary.confidence}% confidence)
                              </span>
                            )}
                          </p>
                          <ul className="space-y-1">
                            {summary.changes.map(
                              (
                                change: { action: string; item: string; details: string },
                                i: number,
                              ) => (
                                <li
                                  key={i}
                                  className="text-xs text-gray-700 flex items-start gap-1.5"
                                >
                                  <span
                                    className={`mt-0.5 font-semibold ${
                                      change.action === "add"
                                        ? "text-green-600"
                                        : change.action === "remove"
                                          ? "text-red-600"
                                          : "text-blue-600"
                                    }`}
                                  >
                                    {change.action.toUpperCase()}
                                  </span>
                                  <span>
                                    <strong>{change.item}</strong>
                                    {change.details && ` — ${change.details}`}
                                  </span>
                                </li>
                              ),
                            )}
                          </ul>
                        </div>
                      )}

                      {/* Original email body preview */}
                      {req.original_body && (
                        <div className="text-xs text-gray-600 bg-gray-50 rounded-lg p-2 mb-3 max-h-20 overflow-y-auto whitespace-pre-wrap">
                          {req.original_body.slice(0, 300)}
                          {req.original_body.length > 300 && "..."}
                        </div>
                      )}

                      {/* Attachments */}
                      {req.attachment_paths && req.attachment_paths.length > 0 && (
                        <p className="text-xs text-gray-500 mb-3">
                          {req.attachment_paths.length} attachment
                          {req.attachment_paths.length !== 1 ? "s" : ""} included
                        </p>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-3 pt-2 border-t border-amber-100">
                        <button
                          onClick={() => handleApplyEditRequest(req.id)}
                          disabled={isApplying}
                          className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2"
                        >
                          {isApplying ? (
                            <>
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
                              Applying...
                            </>
                          ) : (
                            "Approve & Apply"
                          )}
                        </button>
                        <button
                          onClick={() => handleRejectEditRequest(req.id)}
                          className="text-gray-400 hover:text-red-500 text-xs transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* CARRIER CORRESPONDENCE TIMELINE                              */}
        {/* ============================================================ */}
        {correspondence.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-[var(--navy)] mb-4">
              Carrier Correspondence
            </h2>
            <div className="space-y-3">
              {correspondence.map((email) => {
                const isExpanded = expandedEmail === email.id;
                const position = typeof email.carrier_position === "string"
                  ? JSON.parse(email.carrier_position)
                  : email.carrier_position;

                return (
                  <div key={email.id} className="border border-gray-100 rounded-xl overflow-hidden">
                    {/* Email header row */}
                    <button
                      onClick={() => setExpandedEmail(isExpanded ? null : email.id)}
                      className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                          <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--navy)] truncate">
                            {email.original_subject || "No subject"}
                          </p>
                          <p className="text-xs text-gray-400">
                            {email.carrier_name || email.original_from} &middot;{" "}
                            {email.original_date
                              ? new Date(email.original_date).toLocaleDateString()
                              : new Date(email.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {position && stanceBadge(position.stance)}
                        {email.analysis_status === "analyzing" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                            <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Analyzing
                          </span>
                        )}
                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>

                    {/* Expanded email body */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-gray-100">
                        {/* AI Analysis Summary */}
                        {position && (
                          <div className="mt-3 bg-gray-50 rounded-lg p-3">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">AI Analysis</p>
                            <p className="text-sm text-gray-700 mb-2">{position.summary}</p>
                            {position.weaknesses && position.weaknesses.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-gray-500 mt-2 mb-1">Identified Weaknesses:</p>
                                <ul className="space-y-1">
                                  {position.weaknesses.map((w: { weakness: string }, i: number) => (
                                    <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                                      <span className="text-red-500 mt-0.5">&#8226;</span>
                                      {w.weakness}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                              <span>Tone: {position.tone}</span>
                              <span>Urgency: {position.urgency}</span>
                            </div>
                          </div>
                        )}

                        {/* Email body */}
                        <div className="mt-3 bg-white border border-gray-100 rounded-lg p-3">
                          <p className="text-xs font-semibold text-gray-400 mb-2">Original Email</p>
                          <div className="text-sm text-gray-700 whitespace-pre-wrap max-h-64 overflow-y-auto">
                            {email.text_body}
                          </div>
                        </div>

                        {/* Action buttons */}
                        {email.analysis_status === "pending" && email.status === "matched" && (
                          <button
                            onClick={() => handleTriggerAnalysis(email.id)}
                            className="mt-3 bg-[var(--navy)] hover:bg-[var(--navy-light)] text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                          >
                            Analyze & Draft Response
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* DRAFT RESPONSE PANEL                                         */}
        {/* ============================================================ */}
        {drafts.filter((d) => d.status === "draft" || d.status === "edited").map((draft) => {
          const photos = typeof draft.selected_photos === "string"
            ? JSON.parse(draft.selected_photos)
            : draft.selected_photos || [];
          const weaknesses = typeof draft.carrier_weaknesses === "string"
            ? JSON.parse(draft.carrier_weaknesses)
            : draft.carrier_weaknesses || [];
          const isEditing = editingDraft === draft.id;
          const isSending = sendingDraft === draft.id;
          const isRegenerating = regenerating === draft.id;

          return (
            <div key={draft.id} className="bg-white rounded-2xl border-2 border-red-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <h2 className="text-sm font-semibold text-[var(--navy)]">
                    Draft Response Pending Review
                  </h2>
                </div>
                <span className="text-xs text-gray-400">
                  Strategy: {draft.response_strategy} &middot; {draft.compliance_role} mode
                </span>
              </div>

              {/* AI Strategy Notes */}
              {weaknesses.length > 0 && (
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 mb-4">
                  <p className="text-xs font-semibold text-amber-800 mb-1">AI Strategy Notes</p>
                  <ul className="space-y-1">
                    {weaknesses.map((w: { weakness: string; suggested_question: string }, i: number) => (
                      <li key={i} className="text-xs text-amber-700">
                        <strong>{w.weakness}:</strong> {w.suggested_question}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Selected Evidence Photos */}
              {photos.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-gray-500 mb-2">
                    Selected Evidence Photos ({photos.length})
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {photos.map((photo: { description: string; reasons: string[]; score: number }, i: number) => (
                      <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg p-2">
                        <p className="text-xs font-medium text-[var(--navy)] truncate">
                          Photo {i + 1}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{photo.description}</p>
                        {photo.reasons && photo.reasons.length > 0 && (
                          <p className="text-xs text-green-600 mt-1 truncate">
                            {photo.reasons[0]}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Email Draft Body */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-500">
                    To: {draft.to_email} &middot; Subject: {draft.subject}
                  </p>
                  {!isEditing && (
                    <button
                      onClick={() => {
                        setEditingDraft(draft.id);
                        setEditedHtml(draft.edited_body_html || draft.body_html);
                      }}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Edit
                    </button>
                  )}
                </div>

                {isEditing ? (
                  <div>
                    <textarea
                      value={editedHtml}
                      onChange={(e) => setEditedHtml(e.target.value)}
                      className="w-full h-64 px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none"
                    />
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => handleSaveDraftEdits(draft.id)}
                        className="bg-[var(--navy)] text-white px-3 py-1.5 rounded-lg text-xs font-medium"
                      >
                        Save Edits
                      </button>
                      <button
                        onClick={() => setEditingDraft(null)}
                        className="text-gray-400 hover:text-gray-600 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-700 max-h-80 overflow-y-auto prose prose-sm"
                    dangerouslySetInnerHTML={{
                      __html: draft.edited_body_html || draft.body_html,
                    }}
                  />
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
                <button
                  onClick={() => handleApproveSend(draft)}
                  disabled={isSending}
                  className="bg-[var(--red)] hover:bg-[var(--red-dark)] disabled:opacity-50 text-white px-5 py-2.5 rounded-xl font-semibold transition-colors text-sm flex items-center gap-2"
                >
                  {isSending ? (
                    <>
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Sending...
                    </>
                  ) : (
                    "Approve & Send"
                  )}
                </button>
                <button
                  onClick={() => handleRegenerateDraft(draft.id)}
                  disabled={isRegenerating}
                  className="bg-white border border-gray-200 hover:border-gray-300 text-gray-700 px-4 py-2.5 rounded-xl font-medium transition-colors text-sm disabled:opacity-50"
                >
                  {isRegenerating ? "Regenerating..." : "Regenerate"}
                </button>
                <button
                  onClick={() => handleRejectDraft(draft.id)}
                  className="text-gray-400 hover:text-red-500 text-sm transition-colors"
                >
                  Discard
                </button>
                <span className="ml-auto text-xs text-gray-400">
                  Cost: ${draft.generation_cost?.toFixed(4) || "0.00"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
