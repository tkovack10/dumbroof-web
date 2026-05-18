"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { resolveUiVersion, type UiVersion } from "@/lib/ui-version";
import type { User } from "@supabase/supabase-js";
import { V2Layout } from "@/components/claim-detail/v2/v2-layout";
import type { SupplementItem } from "@/components/supplement-composer";
import { FileUploadZone } from "@/components/file-upload-zone";
import { PendingChangesBanner } from "@/components/pending-changes-banner";
import { ScopeComparison } from "@/components/scope-comparison";
import { EstimateView } from "@/components/estimate-view";
import { RoofPhotoMap } from "@/components/roof-photo-map";
import type { RoofPhotoMapPhoto } from "@/types/roof-facets";
import { SupplementComposer } from "@/components/supplement-composer";
import { SignatureManager } from "@/components/signature-manager";
import { InstallSupplementBuilder } from "@/components/install-supplement-builder";
import { CocBuilder } from "@/components/coc-builder";
import { InvoiceBuilder } from "@/components/invoice-builder";
import { SendDocumentsBlock } from "@/components/send-documents-block";
import { UploadedDocuments } from "@/components/uploaded-documents";
import type { ScopeComparisonRow } from "@/types/scope-comparison";

import type { Claim } from "@/types/claim";
import { CATEGORY_CONFIG, CLAIM_STATUS_CONFIG, type UploadCategory } from "@/lib/claim-constants";
import { uploadClaimDocuments } from "@/lib/upload-utils";
import { useBillingQuota } from "@/hooks/use-billing-quota";
import { useCountUp } from "@/hooks/use-count-up";
import { Confetti } from "@/components/confetti";
import { ClaimBrainChat } from "@/components/claim-brain-chat";
import { CommunicationLog } from "@/components/communication-log";
import { ClaimLifecycleBar } from "@/components/claim-lifecycle-bar";
import { ContactRegistryCard } from "@/components/contact-registry-card";
import { HomeownerEngagementCard } from "@/components/homeowner-engagement-card";
import { ReadyToBuildCard } from "@/components/ready-to-build-card";
import { ClaimTimelineRail } from "@/components/claim-timeline-rail";
import { EditReportFieldsCard } from "@/components/edit-report-fields-card";
import { ClaimActionBar } from "@/components/claim-action-bar";
import { ClaimMoneyActions } from "@/components/claim-money-actions";
import { ClaimProductionActions } from "@/components/claim-production-actions";
import { ClaimExpenseActions } from "@/components/claim-expense-actions";
import { ClaimAssignmentDropdown } from "@/components/claim-assignment-dropdown";
import { RichardSuggestionBanner } from "@/components/richard-suggestion-banner";
import { CommunicationsCenter } from "@/components/claim-detail/communications-center";
import type { Correspondence, EditRequest, EmailDraft } from "@/types/claim-comms";
import { ScopeReviewContent } from "@/app/dashboard/scope-review/scope-review-content";
import { PhotoReviewContent } from "@/app/dashboard/photo-review/photo-review-content";
import { CrmImportModal } from "@/components/crm-import-modal";

function EditableField({ value, placeholder, field, claimId, prefix, className, onSave }: {
  value: string;
  placeholder: string;
  field: string;
  claimId: string;
  prefix?: string;
  className?: string;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const supabase = useMemo(() => createClient(), []);

  const save = async () => {
    const trimmed = editValue.trim();
    if (trimmed !== value) {
      await supabase.from("claims").update({ [field]: trimmed || null }).eq("id", claimId);
      onSave(trimmed);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setEditValue(value); setEditing(false); } }}
        placeholder={placeholder}
        className="bg-white/5 border border-[var(--cyan)]/30 rounded px-2 py-0.5 text-sm text-[var(--white)] outline-none focus:ring-1 focus:ring-[var(--cyan)] min-w-[120px]"
      />
    );
  }

  return (
    <button
      onClick={() => { setEditValue(value); setEditing(true); }}
      className={`hover:text-[var(--white)] transition-colors cursor-text ${className || "text-sm text-[var(--gray-muted)]"}`}
      title="Click to edit"
    >
      {value ? (
        <>{prefix}{value}</>
      ) : (
        <span className="text-[var(--gray-dim)] italic text-xs">{placeholder}</span>
      )}
    </button>
  );
}

export default function ClaimDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const claimId = params.id as string;
  // UI version flag — Phase 2 gate. Reads URL ?ui= → user_metadata → 'v1'.
  const [authUser, setAuthUser] = useState<User | null>(null);
  const uiVersion: UiVersion = resolveUiVersion(searchParams.get("ui"), authUser);
  // Phase 3b cross-tab linking: when a row is clicked in the SupplementComposer
  // (Scope tab), the v2 Inspector reflects the selection. v1 ignores this state.
  const [activeSupplementItem, setActiveSupplementItem] = useState<SupplementItem | null>(null);

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
  const [sendingDraft, setSendingDraft] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [editRequests, setEditRequests] = useState<EditRequest[]>([]);
  const [applyingEdit, setApplyingEdit] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [userProfile, setUserProfile] = useState<{ name: string; company: string; phone: string }>({ name: "", company: "", phone: "" });
  const [roofMapPhotos, setRoofMapPhotos] = useState<RoofPhotoMapPhoto[]>([]);
  const [roofMapPhotoUrls, setRoofMapPhotoUrls] = useState<Record<string, string>>({});
  const [hasForensicWin, setHasForensicWin] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  // CompanyCam / AccuLynx integration state — for "import more photos to an
  // existing claim" flow. Same modal used by install-supplement / coc /
  // new-claim flows; this is the 4th surface.
  const [crmIntegrations, setCrmIntegrations] = useState<{ acculynx: boolean; companycam: boolean }>({ acculynx: false, companycam: false });
  const [showCrmModal, setShowCrmModal] = useState(false);

  const fetchClaim = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    setAuthUser(user);
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

    // Check if this claim has a forensic-approval win — unlocks Ready to Build
    // even before a traditional supplement win. Best-effort.
    try {
      const { data: wins } = await supabase
        .from("claim_wins")
        .select("win_type")
        .eq("claim_id", claimId)
        .eq("win_type", "forensic_approval")
        .limit(1);
      setHasForensicWin(!!(wins && wins.length > 0));
    } catch {
      /* ignore */
    }
  }, [claimId, router, supabase]);

  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

  // Fetch CRM integrations (CompanyCam + AccuLynx) so we know whether to show
  // the "Import more photos" button. Same pattern as install-supplement-builder.
  useEffect(() => {
    if (!currentUserId) return;
    fetch(`${BACKEND_URL}/api/integrations/status?user_id=${currentUserId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setCrmIntegrations({ acculynx: !!data.acculynx, companycam: !!data.companycam });
      })
      .catch(() => {});
  }, [currentUserId, BACKEND_URL]);

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

  // Auto-clear the local `reprocessing` flag once the claim flips back to
  // ready/error/etc. (i.e., pipeline finished). The flag is set optimistically
  // by handlers that trigger reprocess (handleReprocess, CRM import,
  // scope-review onAfterReprocess) for immediate banner feedback. Without
  // this sync, paths that don't manually setReprocessing(false) leave the
  // banner stuck forever (caught in code review of commit 47b708f).
  useEffect(() => {
    if (!claim) return;
    if (reprocessing && claim.status !== "uploaded" && claim.status !== "processing") {
      setReprocessing(false);
    }
  }, [claim?.status, reprocessing]);

  // Load photo rows + sign URLs for the overhead roof map — only when facet
  // data exists. Deps are SCALARS (not the roof_facets object) to avoid
  // re-firing on every 5s status poll: `setClaim` produces a new object
  // identity even when contents are unchanged, which would flood the photos
  // table with reads + flicker the thumbnail grid.
  const facetCount = claim?.roof_facets?.roof_facets?.length ?? 0;
  const claimFilePath = claim?.file_path ?? "";
  useEffect(() => {
    if (!claim?.id || facetCount === 0) {
      setRoofMapPhotos([]);
      setRoofMapPhotoUrls({});
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("photos")
        .select("annotation_key, filename, slope_id, damage_type, severity, annotation_text, heading")
        .eq("claim_id", claim.id)
        .limit(500);
      if (cancelled || error || !data) return;
      const rows = data as RoofPhotoMapPhoto[];
      setRoofMapPhotos(rows);

      // Pre-sign URLs in one pass. Bucket is private; getPublicUrl would 401.
      // 2-hour expiry is plenty — user re-enters page = new signs.
      const signed = await Promise.all(
        rows.map(async (p) => {
          if (!p.filename || !claimFilePath) return null;
          const { data: s } = await supabase.storage
            .from("claim-documents")
            .createSignedUrl(`${claimFilePath}/photos/${p.filename}`, 7200);
          return s?.signedUrl ? [p.annotation_key, s.signedUrl] as const : null;
        })
      );
      if (cancelled) return;
      const urlMap: Record<string, string> = {};
      for (const entry of signed) {
        if (entry) urlMap[entry[0]] = entry[1];
      }
      setRoofMapPhotoUrls(urlMap);
    })();
    return () => { cancelled = true; };
  }, [claim?.id, facetCount, claimFilePath, claim?.last_processed_at, supabase]);

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
      const updatedFiles = Array.from(new Set([...existingFiles, ...uploadedNames]));

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

  const handleSaveDraftEdits = async (draftId: string, html: string) => {
    try {
      await fetch(`${BACKEND_URL}/api/drafts/${draftId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edited_body_html: html, status: "edited" }),
      });
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
  const isQAReviewPending = claim.status === "qa_review_pending";
  const integrity = claim.photo_integrity;
  const isForensicOnly = claim.report_mode === "forensic_only";

  // Hoisted once so v1 inline mount and v2 slot reference the same JSX. Only one
  // branch of the v1/v2 ternary is in the tree at a time, so this mounts exactly once.
  const communicationsCenter = (
    <CommunicationsCenter
      editRequests={editRequests}
      correspondence={correspondence}
      drafts={drafts}
      applyingEditId={applyingEdit}
      sendingDraftId={sendingDraft}
      regeneratingDraftId={regenerating}
      onApplyEditRequest={handleApplyEditRequest}
      onRejectEditRequest={handleRejectEditRequest}
      onTriggerAnalysis={handleTriggerAnalysis}
      onApproveSend={handleApproveSend}
      onRegenerateDraft={handleRegenerateDraft}
      onRejectDraft={handleRejectDraft}
      onSaveDraftEdits={handleSaveDraftEdits}
    />
  );

  // Upload form — shared between v1's inline render (page bottom) and v2's
  // Documents tab slot. SAME JSX, SAME state, SAME handlers — just rendered
  // in the right place for each UI version. Function form (not const JSX)
  // so the tree is only constructed when showUpload is true.
  const renderUploadForm = () => (
    <div ref={formRef} className="space-y-5">
      {/* Import from CompanyCam / AccuLynx — only when at least one is connected.
          Imports photos directly to {claim.file_path}/photos/, appends to
          claim.photo_files, then triggers reprocess so the pipeline picks
          up the new photos for analysis. */}
      {(crmIntegrations.acculynx || crmIntegrations.companycam) && (
        <div className="flex items-center justify-between gap-3 px-3 py-3 rounded-lg bg-[var(--cyan)]/5 border border-[var(--cyan)]/20">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Import photos from CRM</p>
            <p className="text-xs text-[var(--gray-muted)]">
              {[crmIntegrations.companycam && "CompanyCam", crmIntegrations.acculynx && "AccuLynx"]
                .filter(Boolean)
                .join(" + ")}{" "}
              connected · imports straight into this claim and re-runs analysis
            </p>
          </div>
          <button
            onClick={() => setShowCrmModal(true)}
            className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--cyan)]/10 text-[var(--cyan)] text-sm font-semibold hover:bg-[var(--cyan)]/20 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 0115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Import photos
          </button>
        </div>
      )}

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
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
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
  );

  const LockedCard = ({ title, description }: { title: string; description: string }) => (
    <div className="glass-card p-6 text-center">
      <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mx-auto mb-3">
        <svg className="w-6 h-6 text-[var(--gray-dim)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-[var(--white)] mb-1">{title}</p>
      <p className="text-xs text-[var(--gray-muted)] mb-3">{description}</p>
      <p className="text-xs text-[var(--cyan)] font-semibold">Upload measurements to unlock this feature</p>
    </div>
  );

  const EstimateConfigPanel = ({ claimId, existingRequest, onReprocess }: {
    claimId: string;
    existingRequest?: Record<string, string> | null;
    onReprocess: () => void;
  }) => {
    const [roofMaterial, setRoofMaterial] = useState(existingRequest?.roof_material || "");
    const [includeGutters, setIncludeGutters] = useState(!!existingRequest?.gutters);
    const [gutterType, setGutterType] = useState(existingRequest?.gutters || "");
    const [includeSiding, setIncludeSiding] = useState(!!existingRequest?.siding);
    const [sidingType, setSidingType] = useState(existingRequest?.siding || "");
    const [saving, setSaving] = useState(false);

    const handleGenerate = async () => {
      if (!roofMaterial) return;
      setSaving(true);
      try {
        const estimateRequest: Record<string, string> = { roof_material: roofMaterial };
        if (includeGutters && gutterType) estimateRequest.gutters = gutterType;
        if (includeSiding && sidingType) estimateRequest.siding = sidingType;

        const res = await fetch("/api/claims/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claimId,
            updates: { estimate_request: estimateRequest, status: "uploaded" },
          }),
        });
        if (!res.ok) throw new Error("Failed to update");
        onReprocess();
      } catch (err) {
        console.error(err);
      } finally {
        setSaving(false);
      }
    };

    return (
      <div className="glass-card overflow-hidden">
        <div className="bg-gradient-to-r from-[var(--cyan)]/10 to-[var(--pink)]/10 border-b border-[var(--border-glass)] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--cyan)] to-[var(--blue)] flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--white)]">Estimate Configuration</h3>
              <p className="text-xs text-[var(--gray-muted)]">Configure roof material, gutters, and siding — then reprocess to update your documents</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {/* Roof Material */}
          <div>
            <label className="block text-sm font-semibold text-[var(--white)] mb-1.5">Roof Material *</label>
            <select
              value={roofMaterial}
              onChange={(e) => setRoofMaterial(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-[rgb(15,18,35)] border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm text-[var(--white)]"
            >
              <option value="">Select roof material...</option>
              <option value="3-Tab">3-Tab</option>
              <option value="Laminate Comp Shingle">Laminate Comp Shingle</option>
              <option value="Premium Grade Laminate Comp Shingle">Premium Grade Laminate Comp Shingle</option>
              <option value="Slate">Slate</option>
              <option value="Standing Seam Metal">Standing Seam Metal</option>
              <option value="Tile">Tile</option>
              <option value="Cedar">Cedar</option>
            </select>
          </div>

          {/* Gutters */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer group">
              <button
                type="button"
                onClick={() => { setIncludeGutters(!includeGutters); if (includeGutters) setGutterType(""); }}
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  includeGutters
                    ? "border-[var(--pink)] bg-gradient-to-r from-[var(--pink)] to-[var(--blue)]"
                    : "border-[var(--border-glass)] bg-[var(--bg-glass)]"
                }`}
              >
                {includeGutters && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <span className="text-sm font-semibold text-[var(--white)]">Include Gutters</span>
            </label>
            {includeGutters && (
              <select
                value={gutterType}
                onChange={(e) => setGutterType(e.target.value)}
                className="w-full mt-2 ml-8 px-4 py-3 rounded-lg bg-[rgb(15,18,35)] border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm text-[var(--white)]"
              >
                <option value="">Select gutter type...</option>
                <option value="5K Gutters and Downspouts">5K Gutters and Downspouts</option>
                <option value="6K Gutters and Downspouts">6K Gutters and Downspouts</option>
                <option value="Copper Half Round">Copper Half Round</option>
              </select>
            )}
          </div>

          {/* Siding */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer group">
              <button
                type="button"
                onClick={() => { setIncludeSiding(!includeSiding); if (includeSiding) setSidingType(""); }}
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  includeSiding
                    ? "border-[var(--pink)] bg-gradient-to-r from-[var(--pink)] to-[var(--blue)]"
                    : "border-[var(--border-glass)] bg-[var(--bg-glass)]"
                }`}
              >
                {includeSiding && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <span className="text-sm font-semibold text-[var(--white)]">Include Siding</span>
            </label>
            {includeSiding && (
              <select
                value={sidingType}
                onChange={(e) => setSidingType(e.target.value)}
                className="w-full mt-2 ml-8 px-4 py-3 rounded-lg bg-[rgb(15,18,35)] border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm text-[var(--white)]"
              >
                <option value="">Select siding type...</option>
                <option value="Vinyl Siding">Vinyl Siding</option>
                <option value="Vinyl w/ Insulation">Vinyl w/ Insulation</option>
                <option value="Aluminum">Aluminum</option>
                <option value="Cedar">Cedar</option>
                <option value="Specialty">Specialty</option>
              </select>
            )}
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={!roofMaterial || saving}
            className="w-full py-3 rounded-lg bg-gradient-to-r from-[var(--cyan)] to-[var(--blue)] text-white font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            {saving ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            )}
            {saving ? "Saving & Reprocessing..." : "Save & Reprocess"}
          </button>
        </div>
      </div>
    );
  };

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

      {/* Richard inline suggestion — Bet 2 */}
      <div className="max-w-4xl mx-auto px-6 pt-4">
        <RichardSuggestionBanner surface="claim_detail" claimId={claim.id} />
      </div>

      {uiVersion === "v2" ? (
        <V2Layout
          claim={claim}
          activeSupplementItem={activeSupplementItem}
          isReprocessing={reprocessing || isReprocessingState}
          onUpload={() => {
            setShowUpload(true);
            setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
          }}
          onReprocess={handleReprocess}
          win={
            claim.claim_outcome === "won" && (claim.settlement_amount ?? 0) > (claim.original_carrier_rcv ?? 0)
              ? {
                  orig: claim.original_carrier_rcv ?? 0,
                  updated: claim.settlement_amount ?? 0,
                  move: (claim.settlement_amount ?? 0) - (claim.original_carrier_rcv ?? 0),
                  pct: (claim.original_carrier_rcv ?? 0) > 0
                    ? Math.round((((claim.settlement_amount ?? 0) - (claim.original_carrier_rcv ?? 0)) / (claim.original_carrier_rcv ?? 0)) * 100)
                    : 0,
                }
              : null
          }
          slots={{
            pathBar: (
              <ClaimLifecycleBar
                claim={claim}
                onScrollTo={(section) => {
                  const el = document.getElementById(`lifecycle-${section}`);
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
            ),
            contactCard: (
              <ContactRegistryCard
                claimId={claim.id}
                initial={{
                  homeowner_name: claim.homeowner_name,
                  homeowner_email: claim.homeowner_email,
                  homeowner_phone: claim.homeowner_phone,
                  adjuster_name: claim.adjuster_name,
                  adjuster_email: claim.adjuster_email,
                  adjuster_phone: claim.adjuster_phone,
                  claim_number: claim.claim_number,
                  policy_number: claim.policy_number,
                  contact_source: claim.contact_source as Record<string, string | undefined> | null,
                }}
                onChange={(patch) => setClaim({ ...claim, ...patch })}
              />
            ),
            editFieldsCard: (
              <EditReportFieldsCard
                claimId={claim.id}
                initial={{
                  date_of_loss: claim.date_of_loss,
                  inspection_date: claim.inspection_date,
                  homeowner_name: claim.homeowner_name,
                  address: claim.address,
                }}
              />
            ),
            timelineRail: <ClaimTimelineRail claimId={claim.id} />,
            communicationLog: isReady ? <CommunicationLog claimId={claim.id} /> : null,
            generatedDocs: isReady && claim.output_files && claim.output_files.length > 0 ? (
              <div>
                <div className="grid sm:grid-cols-2 gap-3 mb-4">
                  {claim.output_files.map((file) => (
                    <button
                      key={file}
                      onClick={() => handleDownload(file)}
                      disabled={downloading === file}
                      className="flex items-center gap-3 bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-left hover:bg-green-500/20 transition-colors disabled:opacity-50"
                    >
                      <svg className="w-5 h-5 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-sm text-[var(--gray)] font-medium">
                        {file.replace(/_/g, " ").replace(".pdf", "")}
                      </span>
                    </button>
                  ))}
                </div>
                <SendDocumentsBlock
                  claimId={claim.id}
                  claimAddress={claim.address}
                  claimNumber={claim.claim_number || ""}
                  adjusterEmail={claim.adjuster_email || ""}
                  homeownerEmail={claim.homeowner_email || ""}
                  carrierName={claim.carrier || ""}
                  outputFiles={claim.output_files}
                  filePath={claim.file_path}
                />
              </div>
            ) : null,
            // Source docs are uploaded files in storage — they exist regardless of
            // pipeline state. Don't blank them out during reprocess (Bug A fix).
            sourceDocs: (
              <UploadedDocuments
                filePath={claim.file_path}
                measurementFiles={claim.measurement_files}
                scopeFiles={claim.scope_files}
                weatherFiles={claim.weather_files}
                otherFiles={claim.other_files}
                cocFiles={claim.coc_files}
                aobFiles={claim.aob_files}
              />
            ),
            scopeComparison: <ScopeComparison claimId={claim.id} carrierName={claim.carrier} refreshKey={claim.last_processed_at} />,
            roofPhotoMap: (
              <RoofPhotoMap
                roofFacets={claim.roof_facets || null}
                slopeDamage={claim.slope_damage || null}
                fullReroofTrigger={Boolean(claim.full_reroof_trigger)}
                photos={roofMapPhotos}
                photoUrls={roofMapPhotoUrls}
              />
            ),
            photoEditor: isReady ? (
              <PhotoReviewContent claimId={claim.id} embedded />
            ) : null,
            estimateView: (
              <div id="lifecycle-estimate"><EstimateView claimId={claim.id} refreshKey={claim.last_processed_at} /></div>
            ),
            estimateEditor: isReady ? (
              <ScopeReviewContent
                claimId={claim.id}
                embedded
                onAfterReprocess={() => {
                  // Immediate visual feedback so the user sees the page reacting
                  // to their "Resubmit Now" click. The polling effect at L235
                  // takes over once claim.status flips to "uploaded"/"processing".
                  setReprocessing(true);
                  fetchClaim();
                }}
              />
            ) : null,
            estimateConfig: isReady && (claim.measurement_files?.length ?? 0) > 0 ? (
              <EstimateConfigPanel
                claimId={claim.id}
                existingRequest={claim.estimate_request}
                onReprocess={() => { setClaim((prev) => prev ? { ...prev, status: "uploaded" } : prev); }}
              />
            ) : null,
            supplementComposer: isReady && claim.scope_comparison && !isForensicOnly ? (
              <div id="lifecycle-supplement">
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
                  adjusterEmail={claim.adjuster_email || ""}
                  claimNumber={claim.claim_number || ""}
                  onActiveItemChange={setActiveSupplementItem}
                />
              </div>
            ) : null,
            // v2: upload form is ALWAYS rendered inside the Documents tab so
            // users don't need to discover an "Upload" button before they can
            // attach a file. The header Upload button still works as a deep
            // link — it switches to Documents and (no-op) sets showUpload=true.
            // The form's Cancel button is now effectively redundant in v2;
            // kept for v1 compat where the form IS still gated.
            uploadDocsBlock: renderUploadForm(),
            signatureManager: isReady ? (
              <SignatureManager
                claimId={claim.id}
                claimAddress={claim.address}
                carrierName={claim.carrier}
                userId={currentUserId}
                filePath={claim.file_path}
                claimNumber={claim.claim_number || ""}
                adjusterEmail={claim.adjuster_email || ""}
              />
            ) : null,
            homeownerEngagement: isReady ? (
              <HomeownerEngagementCard claimId={claim.id} homeownerEmail={claim.homeowner_email} />
            ) : null,
            readyToBuild: isReady ? (
              <ReadyToBuildCard
                claimId={claim.id}
                claimOutcome={claim.claim_outcome || null}
                hasForensicWin={hasForensicWin}
              />
            ) : null,
            installSupplements: isReady ? (
              <InstallSupplementBuilder
                claimId={claim.id}
                claimAddress={claim.address}
                carrierName={claim.carrier}
                userId={currentUserId}
                filePath={claim.file_path}
                claimNumber={claim.claim_number || ""}
                adjusterEmail={claim.adjuster_email || ""}
              />
            ) : null,
            certificateOfCompletion: isReady ? (
              <div id="lifecycle-completion">
                <CocBuilder
                  claimId={claim.id}
                  claimAddress={claim.address}
                  carrierName={claim.carrier}
                  userId={currentUserId}
                  filePath={claim.file_path}
                  claimNumber={claim.claim_number || ""}
                  adjusterEmail={claim.adjuster_email || ""}
                />
              </div>
            ) : null,
            invoicing: isReady && !isForensicOnly ? (
              <InvoiceBuilder
                claimId={claim.id}
                claimAddress={claim.address}
                carrierName={claim.carrier}
                userId={currentUserId}
              />
            ) : null,
            // Phase 3c-1: single Comms slot — Edit Requests + Correspondence + Drafts
            // all live in the consolidated CommunicationsCenter component (v1 + v2 share).
            communicationsCenter,
            // Conditional banners — v2 renders them above the tabs; reuse the existing
            // logic by leaving as null here and letting the dedicated banner components
            // (PendingChangesBanner) keep firing (they're outside the v1/v2 gate).
            conditionalBanners: !isReprocessingState ? <PendingChangesBanner claimId={claimId} /> : null,
            lockedScopeComparison: isReady && isForensicOnly ? (
              <LockedCard title="Line-by-Line Carrier Comparison" description="Compare your scope against the carrier's to find every underpayment and missing item." />
            ) : null,
            lockedEstimate: isReady && isForensicOnly && !(claim.measurement_files?.length) ? (
              <LockedCard title="Code-Cited Estimate" description="Every line item backed by building codes, photo evidence, and regional Xactimate pricing." />
            ) : null,
            lockedInstall: null,
            lockedCoc: null,
            lockedInvoice: isReady && isForensicOnly ? (
              <LockedCard title="Invoice Builder" description="Generate and send invoices with Stripe payment links." />
            ) : null,
          }}
        />
      ) : (
      <div className="max-w-4xl mx-auto px-6 pt-10 pb-28 sm:pb-24 space-y-6">
        {/* Claim Lifecycle Progress Bar */}
        <ClaimLifecycleBar
          claim={claim}
          onScrollTo={(section) => {
            // Scroll to the relevant upload section or component
            const el = document.getElementById(`lifecycle-${section}`);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />

        {/* Claim Header */}
        <div className="glass-card p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold text-[var(--white)]">
                {claim.address}
              </h1>
              <p className="text-sm text-[var(--gray-muted)] mt-1">
                <EditableField
                  value={claim.carrier || ""}
                  placeholder="Add insurance carrier"
                  field="carrier"
                  claimId={claim.id}
                  onSave={(v) => setClaim({ ...claim, carrier: v })}
                />
                {" "}&middot;{" "}
                {claim.phase === "pre-scope" ? "Pre-Scope" : "Supplement"} &middot;{" "}
                {new Date(claim.created_at).toLocaleDateString()}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                <EditableField
                  value={claim.claim_number || ""}
                  placeholder="Add claim #"
                  field="claim_number"
                  claimId={claim.id}
                  prefix="Claim #"
                  className="text-xs text-[var(--gray-dim)]"
                  onSave={(v) => setClaim({ ...claim, claim_number: v })}
                />
                <EditableField
                  value={claim.adjuster_name || ""}
                  placeholder="Add adjuster name"
                  field="adjuster_name"
                  claimId={claim.id}
                  className="text-xs text-[var(--gray-dim)]"
                  onSave={(v) => setClaim({ ...claim, adjuster_name: v })}
                />
                <EditableField
                  value={claim.adjuster_email || ""}
                  placeholder="Add adjuster email"
                  field="adjuster_email"
                  claimId={claim.id}
                  className="text-xs text-[var(--cyan)]"
                  onSave={(v) => setClaim({ ...claim, adjuster_email: v })}
                />
              </div>
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
            {isForensicOnly && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--cyan)]/10 text-[var(--cyan)] border border-[var(--cyan)]/30">
                Forensic Only
              </span>
            )}
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

          {/* Carrier Scope Warning Banner — scope uploaded but extractor couldn't parse it */}
          {claim.processing_warnings?.includes("SCOPE_EXTRACTION_FAILED") && (
            <div className="mt-4 bg-amber-500/10 border border-amber-300 rounded-lg px-4 py-3">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-amber-800">
                    Carrier Scope Couldn&apos;t Be Read
                  </p>
                  <p className="text-xs text-amber-700 mt-1">
                    We generated a pre-scope package (forensic + estimate) because your carrier scope file couldn&apos;t be parsed. For a full supplement with scope comparison, upload the scope as a PDF (or a clear photo/screenshot) and reprocess.
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

        {/* Contact Registry — inline-editable homeowner/adjuster/policy fields, source-tracked */}
        <ContactRegistryCard
          claimId={claim.id}
          initial={{
            homeowner_name: claim.homeowner_name,
            homeowner_email: claim.homeowner_email,
            homeowner_phone: claim.homeowner_phone,
            adjuster_name: claim.adjuster_name,
            adjuster_email: claim.adjuster_email,
            adjuster_phone: claim.adjuster_phone,
            claim_number: claim.claim_number,
            policy_number: claim.policy_number,
            contact_source: claim.contact_source as Record<string, string | undefined> | null,
          }}
          onChange={(patch) => setClaim({ ...claim, ...patch })}
        />

        {/* Edit report fields — surgical re-gen for inspection date, DOL, name, address */}
        <EditReportFieldsCard
          claimId={claim.id}
          initial={{
            date_of_loss: claim.date_of_loss,
            inspection_date: claim.inspection_date,
            homeowner_name: claim.homeowner_name,
            address: claim.address,
          }}
        />

        {/* Timeline rail — event-sourced history (milestones, comms, docs, actions) */}
        <ClaimTimelineRail claimId={claim.id} />

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

        {/* Communication Log — pinned to the top so carrier emails / drafts
            are the first thing visible after claim status. */}
        {isReady && <CommunicationLog claimId={claim.id} />}

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

        {/* QA Review Pending — our auditor caught something we want to fix before release */}
        {isQAReviewPending && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-2xl p-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div className="flex-1">
                <h2 className="text-base font-bold text-blue-100">
                  Under Quality Review
                </h2>
                <p className="text-sm text-blue-200/90 mt-1">
                  Our AI quality auditor flagged your report for a final human review before release. This is a safety check to make sure every detail is accurate — we&apos;ll release it shortly, typically within a few hours. You&apos;ll get an email the moment it&apos;s ready.
                </p>
                <p className="text-xs text-blue-200/70 mt-2">
                  No action needed on your end.
                </p>
              </div>
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

        {/* Output Files + Send */}
        {isReady && (
          <div className="glass-card p-6">
            <h2 className="text-sm font-semibold text-[var(--white)] mb-4">
              Generated Documents
            </h2>
            <div className="grid sm:grid-cols-2 gap-3 mb-4">
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

            {/* Send Documents via Email */}
            <SendDocumentsBlock
              claimId={claim.id}
              claimAddress={claim.address}
              claimNumber={claim.claim_number || ""}
              adjusterEmail={claim.adjuster_email || ""}
              carrierName={claim.carrier || ""}
              filePath={claim.file_path}
              outputFiles={claim.output_files!}
            />
          </div>
        )}

        {/* Source Documents — uploaded EagleView, carrier scope, weather reports */}
        <UploadedDocuments
          filePath={claim.file_path}
          measurementFiles={claim.measurement_files}
          scopeFiles={claim.scope_files}
          weatherFiles={claim.weather_files}
          otherFiles={claim.other_files}
          cocFiles={claim.coc_files}
          aobFiles={claim.aob_files}
        />

        {/* Scope Comparison — only when scope_comparison data exists */}
        {isReady && claim.scope_comparison && !isForensicOnly && (
          <ScopeComparison claimId={claim.id} carrierName={claim.carrier} refreshKey={claim.last_processed_at} />
        )}
        {isReady && isForensicOnly && !(claim.measurement_files?.length) && (
          <LockedCard title="Line-by-Line Carrier Comparison" description="Compare your scope against the carrier's to find every underpayment and missing item." />
        )}

        {/* Overhead Roof Map — per-slope damage from EagleView facets + EXIF heading */}
        {isReady && claim.roof_facets?.roof_facets?.length ? (
          <RoofPhotoMap
            roofFacets={claim.roof_facets}
            slopeDamage={claim.slope_damage ?? []}
            fullReroofTrigger={!!claim.full_reroof_trigger}
            photos={roofMapPhotos}
            photoUrls={roofMapPhotoUrls}
          />
        ) : null}

        {/* Estimate & Damage Assessment */}
        {isReady && !isForensicOnly && (
          <div id="lifecycle-estimate"><EstimateView claimId={claim.id} refreshKey={claim.last_processed_at} /></div>
        )}

        {/* Estimate Configuration — any claim with measurements can configure roof/gutters/siding */}
        {isReady && (claim.measurement_files?.length ?? 0) > 0 && (
          <EstimateConfigPanel
            claimId={claim.id}
            existingRequest={claim.estimate_request}
            onReprocess={() => {
              setClaim((prev) => prev ? { ...prev, status: "uploaded" } : prev);
            }}
          />
        )}

        {isReady && isForensicOnly && !(claim.measurement_files?.length) && (
          <LockedCard title="Code-Cited Estimate" description="Every line item backed by building codes, photo evidence, and regional Xactimate pricing." />
        )}

        {/* Supplement Composer — only for post-scope claims with comparison data */}
        {isReady && claim.scope_comparison && !isForensicOnly && (
          <div id="lifecycle-supplement">
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
              adjusterEmail={claim.adjuster_email || ""}
              claimNumber={claim.claim_number || ""}
            />
          </div>
        )}

        {/* Upload Additional Documents */}
        <div id="lifecycle-forensic" className="glass-card p-6">
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
                <p className="text-sm font-medium text-white">
                  Review photo annotations for this claim
                </p>
                <p className="text-xs text-purple-300 mt-0.5">
                  Approve, correct, or reject AI-generated annotations. Rejected photos are excluded on reprocess.
                  {(claim.excluded_photos?.length ?? 0) > 0 && (
                    <span className="ml-1 font-semibold">({claim.excluded_photos!.length} photo{claim.excluded_photos!.length > 1 ? "s" : ""} excluded)</span>
                  )}
                </p>
              </div>
              <a
                href={`/dashboard/photo-review?claim=${claim.id}`}
                className="bg-white/[0.04] border border-purple-500/30 text-purple-300 hover:text-white hover:bg-white/[0.08] px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ml-4"
              >
                Review Photos
              </a>
            </div>
          )}

          {/* Review Scope button — visible when claim is ready and has contractor_rcv */}
          {isReady && (claim.contractor_rcv ?? 0) > 0 && (
            <div className="bg-teal-500/10 border border-teal-500/30 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">
                  Review AI-generated line items
                </p>
                <p className="text-xs text-teal-300 mt-0.5">
                  Approve, correct, remove, or add line items. Changes update your contractor RCV.
                  {(claim.excluded_line_items?.length ?? 0) > 0 && (
                    <span className="ml-1 font-semibold">({claim.excluded_line_items!.length} item{claim.excluded_line_items!.length > 1 ? "s" : ""} excluded)</span>
                  )}
                </p>
              </div>
              <a
                href={`/dashboard/scope-review?claim=${claim.id}`}
                className="bg-white/[0.04] border border-teal-500/30 text-teal-300 hover:text-white hover:bg-white/[0.08] px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ml-4"
              >
                Review Scope
              </a>
            </div>
          )}

          {/* Reprocess button — visible when claim is ready/needs_improvement and user may have uploaded new docs */}
          {(isReady || claim.status === "needs_improvement") && !showUpload && !isReprocessingState && (
            <div className={`${claim.status === "needs_improvement" ? "bg-orange-500/10 border-orange-500/30" : "bg-blue-500/10 border-blue-500/30"} border rounded-lg px-4 py-3 mb-4 flex items-center justify-between`}>
              <div>
                <p className="text-sm font-medium text-white">
                  {claim.status === "needs_improvement"
                    ? "Uploaded better documentation? Reprocess to re-score your claim."
                    : "Updated documents? Reprocess to generate new reports."}
                </p>
                <p className={`text-xs ${claim.status === "needs_improvement" ? "text-orange-300" : "text-blue-300"} mt-0.5`}>
                  {claim.status === "needs_improvement"
                    ? "Follow the tips above, upload more photos or evidence, then reprocess."
                    : "If you uploaded a revised scope or appraisal award, reprocess to compare and record changes."}
                </p>
              </div>
              <button
                onClick={handleReprocess}
                disabled={reprocessing}
                className={`bg-white/[0.04] border ${claim.status === "needs_improvement" ? "border-orange-500/30 text-orange-300" : "border-blue-500/30 text-blue-300"} hover:text-white hover:bg-white/[0.08] disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ml-4`}
              >
                {reprocessing ? "Starting..." : "Reprocess Claim"}
              </button>
            </div>
          )}

          {/* Success/Error messages */}
          {uploadSuccess && (
            <div className="bg-green-500/10 border border-green-500/30 text-green-300 text-sm rounded-lg px-4 py-3 mb-4">
              {uploadSuccess}
            </div>
          )}
          {uploadError && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">
              {uploadError}
            </div>
          )}

          {showUpload && renderUploadForm()}
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
            adjusterEmail={claim.adjuster_email || ""}
          />
        )}

        {/* Homeowner Engagement — keep the homeowner engaged between inspection and approval */}
        {isReady && (
          <HomeownerEngagementCard
            claimId={claim.id}
            homeownerEmail={claim.homeowner_email}
          />
        )}

        {/* Ready to Build — production handoff with scope validation (gated on win) */}
        {isReady && (
          <ReadyToBuildCard
            claimId={claim.id}
            claimOutcome={claim.claim_outcome || null}
            hasForensicWin={hasForensicWin}
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
            adjusterEmail={claim.adjuster_email || ""}
          />
        )}

        {/* Certificate of Completion */}
        {isReady && (
          <div id="lifecycle-completion">
            <CocBuilder
              claimId={claim.id}
              claimAddress={claim.address}
              carrierName={claim.carrier}
              userId={currentUserId}
              filePath={claim.file_path}
              claimNumber={claim.claim_number || ""}
              adjusterEmail={claim.adjuster_email || ""}
            />
          </div>
        )}

        {/* Invoicing */}
        {isReady && !isForensicOnly && (
          <InvoiceBuilder
            claimId={claim.id}
            claimAddress={claim.address}
            carrierName={claim.carrier}
            userId={currentUserId}
          />
        )}
        {isReady && isForensicOnly && (
          <LockedCard title="Invoice Builder" description="Generate and send invoices with Stripe payment links." />
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

        {/* Phase 3c-1: consolidated edit requests + correspondence + drafts */}
        {communicationsCenter}
      </div>
      )}

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
          filePath={claim.file_path}
        />
      )}

      {/* Phase-aware sticky action bar (Phase 1 of per-claim page redesign).
          On v2 desktop, the bar's pill is hidden — v2's highlights panel already
          surfaces phase-aware actions. Mobile bar stays for both v1 and v2. */}
      {claim && (
        <ClaimActionBar
          claim={claim}
          isReprocessing={reprocessing || isReprocessingState}
          onUpload={() => {
            setShowUpload(true);
            setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
          }}
          onReprocess={handleReprocess}
          uiVersion={uiVersion}
        />
      )}

      {/* Phase 1 (Admin Workspace v2): self-contained money actions —
          Upload check + Submit commission. Owns its own modal state so
          the rest of the claim detail page stays untouched. */}
      {claim && <ClaimMoneyActions claimId={claim.id} />}

      {/* Phase 2 (Admin Workspace v2): self-contained production actions —
          Schedule install (admin-only, team-gated). */}
      {claim && <ClaimProductionActions claimId={claim.id} />}

      {/* Phase 3 (Admin Workspace v2): self-contained expense capture —
          floating "+ Receipt" button. Team-member gated. */}
      {claim && <ClaimExpenseActions claimId={claim.id} />}

      {/* Phase 5 Slice B: rep assignment dropdown — admin OR current
          assignee can reassign. */}
      {claim && <ClaimAssignmentDropdown claimId={claim.id} />}

      {/* CompanyCam / AccuLynx import modal — same component used by
          install-supplement, COC, and new-claim flows. Mounts once at page
          level so it works whether the user opened the upload form in v1
          inline OR v2 Documents tab. */}
      {claim && (
        <CrmImportModal
          open={showCrmModal}
          onClose={() => setShowCrmModal(false)}
          integrations={crmIntegrations}
          backendUrl={BACKEND_URL}
          userId={currentUserId}
          targetPath={claim.file_path}
          targetFolder="photos"
          onImport={() => {}}
          onPhotoPaths={async (paths) => {
            if (!paths || paths.length === 0) return;
            // Append the new filenames to claim.photo_files. The modal uploaded
            // them under {file_path}/photos/{filename}; photo_files is a flat
            // list of filenames in that folder (matching the existing
            // companycam_NN.jpg convention on this claim's existing 50 photos).
            const newFilenames = paths
              .map((p) => p.split("/").pop() || "")
              .filter(Boolean);
            const merged = Array.from(new Set([...(claim.photo_files || []), ...newFilenames]));
            try {
              await supabase
                .from("claims")
                .update({ photo_files: merged })
                .eq("id", claim.id);
              setClaim({ ...claim, photo_files: merged });
            } catch (err) {
              console.error("Failed to merge imported photo paths:", err);
            }
            // Trigger reprocess so the new photos get analyzed by the pipeline
            // (same pattern as gmail_poller.py:887 for forwarded edit-requests).
            try {
              await fetch(`${BACKEND_URL}/api/reprocess/${claim.id}`, { method: "POST" });
              setReprocessing(true);
              // Refetch the claim so the page sees status=processing and the
              // polling effect (L235) takes over until reprocess completes.
              fetchClaim();
            } catch (err) {
              console.error("Failed to trigger reprocess after CRM import:", err);
            }
          }}
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

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 py-5 sm:py-10">
          <div className="flex items-center justify-between flex-wrap gap-3 sm:gap-6">
            <div>
              <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3">
                <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-full bg-white/20 backdrop-blur flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.3)]">
                  <svg className="w-4 h-4 sm:w-7 sm:h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
                  </svg>
                </div>
                <div>
                  <p className="text-[10px] sm:text-xs font-bold text-white/70 uppercase tracking-[0.15em] sm:tracking-[0.2em]">Carrier Moved</p>
                  <p className="text-[10px] sm:text-xs text-white/50 font-medium hidden sm:block">dumb roof got the carrier to pay more</p>
                </div>
              </div>
              <p className="text-3xl sm:text-6xl md:text-7xl font-black text-white tracking-tight tabular-nums leading-none">
                +${animatedMove.toLocaleString()}
              </p>
              <div className="flex items-center gap-2 sm:gap-4 mt-2 sm:mt-3 flex-wrap">
                <span className="inline-flex items-center gap-1 sm:gap-1.5 bg-white/20 backdrop-blur rounded-full px-2.5 py-1 sm:px-4 sm:py-1.5 text-xs sm:text-sm font-bold text-white">
                  <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                  </svg>
                  {animatedPct}% increase
                </span>
                <span className="text-[11px] sm:text-sm text-white/60 tabular-nums font-medium">
                  ${orig.toLocaleString()} → ${updated.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="text-center">
              <div className="text-4xl sm:text-7xl animate-bounce" style={{ animationDuration: "2s" }}>
                &#127942;
              </div>
              <p className="text-[10px] sm:text-sm font-black text-white/90 uppercase tracking-widest mt-1 sm:mt-2">Claim Won</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
