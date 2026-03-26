"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import { FileUploadZone } from "@/components/file-upload-zone";
import { PendingChangesBanner } from "@/components/pending-changes-banner";
import { ScopeComparison } from "@/components/scope-comparison";
import { EstimateView } from "@/components/estimate-view";
import { SupplementComposer } from "@/components/supplement-composer";
import { SignatureManager } from "@/components/signature-manager";
import { InstallSupplementBuilder } from "@/components/install-supplement-builder";
import { CocBuilder } from "@/components/coc-builder";
import { InvoiceBuilder } from "@/components/invoice-builder";
import type { ScopeComparisonRow } from "@/types/scope-comparison";

import type { Claim } from "@/types/claim";
import { CATEGORY_CONFIG, CLAIM_STATUS_CONFIG, type UploadCategory } from "@/lib/claim-constants";
import { uploadClaimDocuments } from "@/lib/upload-utils";
import { useBillingQuota } from "@/hooks/use-billing-quota";
import { useCountUp } from "@/hooks/use-count-up";
import { Confetti } from "@/components/confetti";
import { ClaimBrainChat } from "@/components/claim-brain-chat";
import { CommunicationLog } from "@/components/communication-log";

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

export default function ClaimDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const claimId = params.id as string;

  const quota = useBillingQuota();
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
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [userProfile, setUserProfile] = useState<{ name: string; company: string; phone: string }>({ name: "", company: "", phone: "" });
  const formRef = useRef<HTMLDivElement>(null);

  const fetchClaim = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    if (user.id && !currentUserId) {
      setCurrentUserId(user.id);
      // Fetch company profile for supplement composer signature
      supabase.from("company_profiles").select("contact_name,company_name,phone").eq("user_id", user.id).limit(1).then(({ data }) => {
        if (data?.[0]) setUserProfile({ name: data[0].contact_name || "", company: data[0].company_name || "", phone: data[0].phone || "" });
      });
    }

    // Domain sharing: fetch via API which checks team membership
    const claimRes = await fetch(`/api/team-claims/claim?id=${claimId}`);
    const data = claimRes.ok ? (await claimRes.json()).claim : null;

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

      const uploadedNames = await uploadClaimDocuments(
        supabase,
        newFiles,
        selectedCategory,
        claim
      );

      const fieldKey = catConfig.dbField as keyof Claim;
      const existingFiles: string[] = (claim[fieldKey] as string[] | null) ?? [];
      const updatedFiles = [...existingFiles, ...uploadedNames];

      const updates: Record<string, unknown> = { [catConfig.dbField]: updatedFiles };
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
    const c = configs[stance] || { bg: "bg-white/[0.06]", text: "text-[var(--gray)]", label: stance || "Pending" };
    return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>{c.label}</span>;
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--gray-dim)]">Loading...</p>
      </main>
    );
  }

  if (!claim) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-[var(--gray-muted)] mb-4">Claim not found</p>
          <a href="/dashboard" className="text-[var(--red)] font-medium">
            Back to Dashboard
          </a>
        </div>
      </main>
    );
  }

  const sc = CLAIM_STATUS_CONFIG[claim.status] || CLAIM_STATUS_CONFIG.uploaded;
  const isReady = claim.status === "ready" && claim.output_files?.length;
  const isProcessing = claim.status === "processing";
  const isUploaded = claim.status === "uploaded";
  const isReprocessingState = isProcessing || isUploaded;
  const integrity = claim.photo_integrity;

  return (
    <main className="min-h-screen">
      {/* Top Bar */}
      <nav className="bg-[rgba(6,9,24,0.85)] backdrop-blur-[20px] border-b border-[var(--border-glass)] sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--pink)] to-[var(--blue)] flex items-center justify-center font-bold text-white text-xs">
              DR
            </div>
            <span className="text-white font-bold text-lg tracking-tight">
              dumb roof<sup className="text-[9px] font-medium align-super ml-0.5">™</sup>
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

      {/* Win Celebration Banner — Robinhood dopamine */}
      {claim.claim_outcome === "won" && (claim.settlement_amount ?? 0) > (claim.original_carrier_rcv ?? 0) && (() => {
        const orig = claim.original_carrier_rcv ?? 0;
        const updated = claim.settlement_amount ?? 0;
        const move = updated - orig;
        const pct = orig > 0 ? Math.round((move / orig) * 100) : 0;
        return (
          <WinBanner orig={orig} updated={updated} move={move} pct={pct} />
        );
      })()}

      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        {/* Claim Header */}
        <div className="glass-card p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold text-[var(--white)]">
                {claim.address}
              </h1>
              <p className="text-sm text-[var(--gray-muted)] mt-1">
                {claim.carrier || "No carrier"} &middot;{" "}
                {claim.phase === "pre-scope" ? "Pre-Scope" : "Supplement"} &middot;{" "}
                {new Date(claim.created_at).toLocaleDateString()}
              </p>
              {(claim.claim_number || claim.adjuster_name || claim.adjuster_email) && (
                <p className="text-xs text-[var(--gray-dim)] mt-1">
                  {claim.claim_number && <span>Claim #{claim.claim_number}</span>}
                  {claim.claim_number && claim.adjuster_name && <span> &middot; </span>}
                  {claim.adjuster_name && <span>{claim.adjuster_name}</span>}
                  {claim.adjuster_email && <span className="ml-1 text-[var(--cyan)]">({claim.adjuster_email})</span>}
                </p>
              )}
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

          {/* Damage Score + Tech Boost */}
          {claim.damage_score != null && (() => {
            const dsValue = claim.damage_score;
            const dsGrade = claim.damage_grade || "F";
            const dsPct = Math.round((dsValue / 100) * 100);
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
            const techBoost = claim.approval_score ?? 0;
            return (
              <div className="mt-4 grid grid-cols-2 gap-3">
                {/* Damage Score — ring + grade */}
                <div className="bg-white/[0.04] border border-[var(--border-glass)] rounded-xl px-4 py-3 flex items-center gap-3">
                  <div className="relative w-11 h-11 shrink-0">
                    <svg className="w-11 h-11 -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-white/20" strokeWidth="3" />
                      <circle cx="18" cy="18" r="15.5" fill="none" className={`${ringColors[dsGrade] || "text-[var(--gray-dim)]"} stroke-current`} strokeWidth="3" strokeDasharray={`${dsPct} ${100 - dsPct}`} strokeLinecap="round" />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-[var(--white)]">{dsValue}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--gray-muted)]">Damage Score</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-sm font-bold text-[var(--white)]">{dsValue}/100</span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${gradeColors[dsGrade] || "bg-white/[0.06] text-[var(--gray)] border-[var(--border-glass)]"}`}>
                        {dsGrade}
                      </span>
                    </div>
                    <p className="text-[10px] text-[var(--gray-dim)] mt-0.5 leading-tight">Storm damage severity</p>
                  </div>
                </div>
                {/* Tech Boost — green positive indicator */}
                {techBoost > 0 && (
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 flex items-center gap-3">
                    <div className="w-11 h-11 shrink-0 rounded-full bg-emerald-100 flex items-center justify-center">
                      <span className="text-emerald-600 text-lg font-bold">&#9650;</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-emerald-600 font-medium">Tech Boost</p>
                      <span className="text-sm font-bold text-emerald-700">+{techBoost}</span>
                      <p className="text-[10px] text-emerald-500 mt-0.5 leading-tight">Discontinued products, code compliance &amp; O&amp;L triggers</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Photo Integrity Badge */}
          {integrity && (
            <div className="mt-4 inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-2">
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
            <div className="mt-4 bg-amber-500/10 border border-amber-300 rounded-lg px-4 py-3">
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
                      ? "The uploaded EagleView file is a Property Owner Report (images only). Upload a Premium EagleView report with roof measurements, then reprocess for accurate quantities."
                      : claim.processing_warnings!.includes("MEASUREMENTS_FROM_CARRIER_FALLBACK")
                      ? "Measurements were estimated from the carrier scope. For more accurate quantities, upload an EagleView Premium report and reprocess."
                      : "Could not extract roof measurements from the uploaded documents. Upload an EagleView Premium report with measurement tables, then reprocess."}
                  </p>
                </div>
              </div>
            </div>
          )}

          {claim.user_notes && (
            <div className="mt-4 bg-white/[0.04] rounded-lg px-4 py-3">
              <p className="text-xs font-semibold text-[var(--gray-dim)] uppercase mb-1">
                Your Notes
              </p>
              <p className="text-sm text-[var(--gray)]">{claim.user_notes}</p>
            </div>
          )}
        </div>

        {/* Processing indicator */}
        {isReprocessingState && (
          <div className="bg-amber-500/10 border border-amber-100 rounded-2xl p-5">
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

        {/* Pending Changes Banner */}
        {!isReprocessingState && <PendingChangesBanner claimId={claimId} />}

        {/* Needs Improvement — Coaching Card */}
        {claim.status === "needs_improvement" && claim.improvement_guidance && (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-2xl p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-bold text-orange-900">
                  More Documentation Needed
                </h2>
                <p className="text-sm text-orange-800 mt-1">
                  {claim.improvement_guidance.summary}
                </p>
              </div>
            </div>
            <div className="grid gap-3">
              {claim.improvement_guidance.tips.map((tip, i) => (
                <div key={i} className="bg-[var(--bg-glass)] border border-orange-100 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-700 border border-orange-500/30">
                      {tip.category}
                    </span>
                    <span className="text-sm font-semibold text-[var(--white)]">{tip.title}</span>
                  </div>
                  <p className="text-xs text-[var(--gray)] leading-relaxed">{tip.detail}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 bg-orange-100/50 rounded-lg px-4 py-3">
              <p className="text-xs text-orange-800">
                <strong>What to do:</strong> Upload additional photos following the tips above, then click &ldquo;Reprocess&rdquo; to re-analyze your claim. Better documentation can turn a weak claim into a winning one.
              </p>
            </div>
          </div>
        )}

        {/* Flash Sale — 50% off after first claim */}
        {isReady && quota && quota.planId === "starter" && quota.lifetimeUsed === 1 && (
          <div className="bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 rounded-2xl p-6 text-white">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <p className="text-sm font-bold uppercase tracking-wider text-orange-100">First Claim Special</p>
                <p className="text-2xl font-black mt-1">50% Off Your First Month</p>
                <p className="text-sm text-orange-100 mt-1">
                  Your claim package identified ${((claim.contractor_rcv ?? 0)).toLocaleString()} in damages. Upgrade now to keep building.
                </p>
              </div>
              <div className="flex gap-3">
                <a
                  href="/pricing?coupon=FIRSTCLAIM50"
                  className="bg-[var(--bg-glass)] text-red-600 px-5 py-3 rounded-xl font-bold text-sm hover:bg-orange-500/150/10 transition-colors"
                >
                  Pro — $249/mo
                </a>
                <a
                  href="/pricing?coupon=FIRSTCLAIM50"
                  className="bg-white/20 backdrop-blur text-white px-5 py-3 rounded-xl font-bold text-sm hover:bg-white/30 transition-colors border border-white/30"
                >
                  Growth — $499/mo
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Output Files */}
        {isReady && (
          <div className="glass-card p-6">
            <h2 className="text-sm font-semibold text-[var(--white)] mb-4">
              Generated Documents
            </h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {claim.output_files!.map((file) => (
                <button
                  key={file}
                  onClick={() => handleDownload(file)}
                  disabled={downloading === file}
                  className="flex items-center gap-3 bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-left hover:bg-green-500/20 transition-colors disabled:opacity-50"
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
                  <span className="text-sm text-[var(--gray)] font-medium">
                    {file.replace(/_/g, " ").replace(".pdf", "")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Scope Comparison — only when scope_comparison data exists */}
        {isReady && claim.scope_comparison && (
          <ScopeComparison claimId={claim.id} carrierName={claim.carrier} />
        )}

        {/* Estimate & Damage Assessment */}
        {isReady && (
          <EstimateView claimId={claim.id} />
        )}

        {/* Supplement Composer — only for post-scope claims with comparison data */}
        {isReady && claim.scope_comparison && (
          <SupplementComposer
            claimId={claim.id}
            claimAddress={claim.address}
            carrierName={claim.carrier}
            comparisonRows={claim.scope_comparison as ScopeComparisonRow[]}
            carrierRcv={claim.current_carrier_rcv ?? claim.original_carrier_rcv ?? 0}
            contractorRcv={claim.contractor_rcv ?? 0}
            userId={currentUserId}
            userName={userProfile.name}
            companyName={userProfile.company}
            companyPhone={userProfile.phone}
          />
        )}

        {/* Upload Additional Documents */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--white)]">
                Add Documents
              </h2>
              <p className="text-xs text-[var(--gray-muted)] mt-0.5">
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
                className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                + Upload Files
              </button>
            )}
          </div>

          {/* Review Photos button — visible when claim has photos and is ready */}
          {isReady && (claim.photo_files?.length ?? 0) > 0 && (
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-purple-800">
                  Review photo annotations for this claim
                </p>
                <p className="text-xs text-purple-600 mt-0.5">
                  Approve, correct, or reject AI-generated annotations. Rejected photos are excluded on reprocess.
                  {(claim.excluded_photos?.length ?? 0) > 0 && (
                    <span className="ml-1 font-semibold">({claim.excluded_photos!.length} photo{claim.excluded_photos!.length > 1 ? "s" : ""} excluded)</span>
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

          {/* Review Scope button — visible when claim is ready and has contractor_rcv */}
          {isReady && (claim.contractor_rcv ?? 0) > 0 && (
            <div className="bg-teal-500/10 border border-teal-500/30 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-teal-800">
                  Review AI-generated line items
                </p>
                <p className="text-xs text-teal-600 mt-0.5">
                  Approve, correct, remove, or add line items. Changes update your contractor RCV.
                  {(claim.excluded_line_items?.length ?? 0) > 0 && (
                    <span className="ml-1 font-semibold">({claim.excluded_line_items!.length} item{claim.excluded_line_items!.length > 1 ? "s" : ""} excluded)</span>
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

          {/* Reprocess button — visible when claim is ready/needs_improvement and user may have uploaded new docs */}
          {(isReady || claim.status === "needs_improvement") && !showUpload && !isReprocessingState && (
            <div className={`${claim.status === "needs_improvement" ? "bg-orange-500/10 border-orange-500/30" : "bg-blue-500/10 border-blue-500/30"} border rounded-lg px-4 py-3 mb-4 flex items-center justify-between`}>
              <div>
                <p className={`text-sm font-medium ${claim.status === "needs_improvement" ? "text-orange-800" : "text-blue-800"}`}>
                  {claim.status === "needs_improvement"
                    ? "Uploaded better documentation? Reprocess to re-score your claim."
                    : "Updated documents? Reprocess to generate new reports."}
                </p>
                <p className={`text-xs ${claim.status === "needs_improvement" ? "text-orange-600" : "text-blue-600"} mt-0.5`}>
                  {claim.status === "needs_improvement"
                    ? "Follow the tips above, upload more photos or evidence, then reprocess."
                    : "If you uploaded a revised scope or appraisal award, reprocess to compare and record changes."}
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
            <div className="bg-green-500/10 border border-green-500/30 text-green-700 text-sm rounded-lg px-4 py-3 mb-4">
              {uploadSuccess}
            </div>
          )}
          {uploadError && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
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
                        ? "bg-gradient-to-r from-[var(--pink)] to-[var(--blue)] text-white border-[var(--navy)]"
                        : "bg-[var(--bg-glass)] text-[var(--gray)] border-[var(--border-glass)] hover:border-[var(--border-glass)]"
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
                  className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-xl font-semibold transition-colors text-sm"
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
                  className="text-[var(--gray-dim)] hover:text-[var(--gray)] text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* AOB / Contingency Agreement — digital signatures */}
        {isReady && (
          <SignatureManager
            claimId={claim.id}
            claimAddress={claim.address}
            carrierName={claim.carrier}
            userId={currentUserId}
            filePath={claim.file_path}
            claimNumber={claim.claim_number || ""}
          />
        )}

        {/* Install Supplements — items discovered during installation */}
        {isReady && (
          <InstallSupplementBuilder
            claimId={claim.id}
            claimAddress={claim.address}
            carrierName={claim.carrier}
            userId={currentUserId}
            filePath={claim.file_path}
            claimNumber={claim.claim_number || ""}
          />
        )}

        {/* Certificate of Completion */}
        {isReady && (
          <CocBuilder
            claimId={claim.id}
            claimAddress={claim.address}
            carrierName={claim.carrier}
            userId={currentUserId}
            filePath={claim.file_path}
            claimNumber={claim.claim_number || ""}
          />
        )}

        {/* Invoicing */}
        {isReady && (
          <InvoiceBuilder
            claimId={claim.id}
            claimAddress={claim.address}
            carrierName={claim.carrier}
            userId={currentUserId}
          />
        )}

        {/* Error state */}
        {claim.status === "error" && (
          <div className="bg-red-500/10 border border-red-100 rounded-2xl p-5">
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

        {/* ============================================================ */}
        {/* EDIT REQUESTS PANEL                                          */}
        {/* ============================================================ */}
        {editRequests.filter((r) => r.status === "pending").length > 0 && (
          <div className="bg-[var(--bg-glass)] rounded-2xl border-2 border-amber-300 p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-amber-500/100 animate-pulse" />
              <h2 className="text-sm font-semibold text-[var(--white)]">
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
                      className="border border-amber-500/30 bg-amber-500/10/50 rounded-xl p-4"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-sm font-medium text-[var(--white)]">
                            {req.original_subject || "Edit Request"}
                          </p>
                          <p className="text-xs text-[var(--gray-muted)] mt-0.5">
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
                        <div className="bg-[var(--bg-glass)] border border-amber-100 rounded-lg p-3 mb-3">
                          <p className="text-xs font-semibold text-[var(--gray-muted)] mb-1.5">
                            AI-Parsed Changes
                            {summary.confidence && (
                              <span className="ml-2 text-[var(--gray-dim)] font-normal">
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
                                  className="text-xs text-[var(--gray)] flex items-start gap-1.5"
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
                        <div className="text-xs text-[var(--gray)] bg-white/[0.04] rounded-lg p-2 mb-3 max-h-20 overflow-y-auto whitespace-pre-wrap">
                          {req.original_body.slice(0, 300)}
                          {req.original_body.length > 300 && "..."}
                        </div>
                      )}

                      {/* Attachments */}
                      {req.attachment_paths && req.attachment_paths.length > 0 && (
                        <p className="text-xs text-[var(--gray-muted)] mb-3">
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
                          className="text-[var(--gray-dim)] hover:text-red-500 text-xs transition-colors"
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
          <div className="glass-card p-6">
            <h2 className="text-sm font-semibold text-[var(--white)] mb-4">
              Carrier Correspondence
            </h2>
            <div className="space-y-3">
              {correspondence.map((email) => {
                const isExpanded = expandedEmail === email.id;
                const position = typeof email.carrier_position === "string"
                  ? JSON.parse(email.carrier_position)
                  : email.carrier_position;

                return (
                  <div key={email.id} className="border border-white/[0.04] rounded-xl overflow-hidden">
                    {/* Email header row */}
                    <button
                      onClick={() => setExpandedEmail(isExpanded ? null : email.id)}
                      className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/[0.04] transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
                          <svg className="w-4 h-4 text-[var(--gray-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--white)] truncate">
                            {email.original_subject || "No subject"}
                          </p>
                          <p className="text-xs text-[var(--gray-dim)]">
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
                        <svg className={`w-4 h-4 text-[var(--gray-dim)] transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>

                    {/* Expanded email body */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-white/[0.04]">
                        {/* AI Analysis Summary */}
                        {position && (
                          <div className="mt-3 bg-white/[0.04] rounded-lg p-3">
                            <p className="text-xs font-semibold text-[var(--gray-muted)] uppercase mb-1">AI Analysis</p>
                            <p className="text-sm text-[var(--gray)] mb-2">{position.summary}</p>
                            {position.weaknesses && position.weaknesses.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-[var(--gray-muted)] mt-2 mb-1">Identified Weaknesses:</p>
                                <ul className="space-y-1">
                                  {position.weaknesses.map((w: { weakness: string }, i: number) => (
                                    <li key={i} className="text-xs text-[var(--gray)] flex items-start gap-1.5">
                                      <span className="text-red-500 mt-0.5">&#8226;</span>
                                      {w.weakness}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <div className="flex items-center gap-3 mt-2 text-xs text-[var(--gray-muted)]">
                              <span>Tone: {position.tone}</span>
                              <span>Urgency: {position.urgency}</span>
                            </div>
                          </div>
                        )}

                        {/* Email body */}
                        <div className="mt-3 bg-[var(--bg-glass)] border border-white/[0.04] rounded-lg p-3">
                          <p className="text-xs font-semibold text-[var(--gray-dim)] mb-2">Original Email</p>
                          <div className="text-sm text-[var(--gray)] whitespace-pre-wrap max-h-64 overflow-y-auto">
                            {email.text_body}
                          </div>
                        </div>

                        {/* Action buttons */}
                        {email.analysis_status === "pending" && email.status === "matched" && (
                          <button
                            onClick={() => handleTriggerAnalysis(email.id)}
                            className="mt-3 bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors"
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
            <div key={draft.id} className="bg-[var(--bg-glass)] rounded-2xl border-2 border-red-500/30 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500/100 animate-pulse" />
                  <h2 className="text-sm font-semibold text-[var(--white)]">
                    Draft Response Pending Review
                  </h2>
                </div>
                <span className="text-xs text-[var(--gray-dim)]">
                  Strategy: {draft.response_strategy} &middot; {draft.compliance_role} mode
                </span>
              </div>

              {/* AI Strategy Notes */}
              {weaknesses.length > 0 && (
                <div className="bg-amber-500/10 border border-amber-100 rounded-lg p-3 mb-4">
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
                  <p className="text-xs font-semibold text-[var(--gray-muted)] mb-2">
                    Selected Evidence Photos ({photos.length})
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {photos.map((photo: { description: string; reasons: string[]; score: number }, i: number) => (
                      <div key={i} className="bg-white/[0.04] border border-[var(--border-glass)] rounded-lg p-2">
                        <p className="text-xs font-medium text-[var(--white)] truncate">
                          Photo {i + 1}
                        </p>
                        <p className="text-xs text-[var(--gray-muted)] truncate">{photo.description}</p>
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
                  <p className="text-xs font-semibold text-[var(--gray-muted)]">
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
                      className="w-full h-64 px-3 py-2 text-sm border border-[var(--border-glass)] rounded-lg font-mono focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none"
                    />
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => handleSaveDraftEdits(draft.id)}
                        className="bg-gradient-to-r from-[var(--pink)] to-[var(--blue)] text-white px-3 py-1.5 rounded-lg text-xs font-medium"
                      >
                        Save Edits
                      </button>
                      <button
                        onClick={() => setEditingDraft(null)}
                        className="text-[var(--gray-dim)] hover:text-[var(--gray)] text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="bg-white/[0.04] border border-[var(--border-glass)] rounded-lg p-4 text-sm text-[var(--gray)] max-h-80 overflow-y-auto prose prose-sm"
                    dangerouslySetInnerHTML={{
                      __html: draft.edited_body_html || draft.body_html,
                    }}
                  />
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 pt-3 border-t border-white/[0.04]">
                <button
                  onClick={() => handleApproveSend(draft)}
                  disabled={isSending}
                  className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 text-white px-5 py-2.5 rounded-xl font-semibold transition-colors text-sm flex items-center gap-2"
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
                  className="bg-[var(--bg-glass)] border border-[var(--border-glass)] hover:border-[var(--border-glass)] text-[var(--gray)] px-4 py-2.5 rounded-xl font-medium transition-colors text-sm disabled:opacity-50"
                >
                  {isRegenerating ? "Regenerating..." : "Regenerate"}
                </button>
                <button
                  onClick={() => handleRejectDraft(draft.id)}
                  className="text-[var(--gray-dim)] hover:text-red-500 text-sm transition-colors"
                >
                  Discard
                </button>
                <span className="ml-auto text-xs text-[var(--gray-dim)]">
                  Cost: ${draft.generation_cost?.toFixed(4) || "0.00"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Communication Log */}
      {isReady && <CommunicationLog claimId={claim.id} />}

      {/* Claim Brain — AI Chat */}
      {claim && (
        <ClaimBrainChat
          claimId={claim.id}
          claimAddress={claim.address}
          carrier={claim.carrier}
          variance={
            (claim.contractor_rcv || 0) - (claim.current_carrier_rcv || claim.original_carrier_rcv || 0)
          }
          userId={currentUserId}
        />
      )}
    </main>
  );
}

/** Robinhood-style win celebration with confetti + animated counter */
function WinBanner({ orig, updated, move, pct }: { orig: number; updated: number; move: number; pct: number }) {
  const animatedMove = useCountUp(move, 2500, 500);
  const animatedPct = useCountUp(pct, 2000, 800);
  const [confetti, setConfetti] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setConfetti(false), 100);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <Confetti active={confetti} duration={5000} />
      <div className="relative overflow-hidden">
        {/* Animated gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-green-600 via-emerald-500 to-green-400 animate-gradient-shift" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.15),transparent_60%)]" />

        <div className="relative max-w-4xl mx-auto px-6 py-10">
          <div className="flex items-center justify-between flex-wrap gap-6">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.3)]">
                  <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-bold text-white/70 uppercase tracking-[0.2em]">Carrier Moved</p>
                  <p className="text-xs text-white/50 font-medium">dumb roof got the carrier to pay more</p>
                </div>
              </div>
              <p className="text-6xl md:text-7xl font-black text-white tracking-tight tabular-nums">
                +${animatedMove.toLocaleString()}
              </p>
              <div className="flex items-center gap-4 mt-3">
                <span className="inline-flex items-center gap-1.5 bg-white/20 backdrop-blur rounded-full px-4 py-1.5 text-sm font-bold text-white">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                  </svg>
                  {animatedPct}% increase
                </span>
                <span className="text-sm text-white/60 tabular-nums font-medium">
                  ${orig.toLocaleString()} → ${updated.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="text-center">
              <div className="text-7xl animate-bounce" style={{ animationDuration: "2s" }}>
                &#127942;
              </div>
              <p className="text-sm font-black text-white/90 uppercase tracking-widest mt-2">Claim Won</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
