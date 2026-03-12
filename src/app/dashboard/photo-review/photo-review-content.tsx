"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import type { PhotoForReview, PhotoFeedback, FeedbackStatus } from "@/types/photo-review";
import { SEVERITY_COLORS } from "@/lib/claim-constants";
import { getBackendUrl } from "@/lib/backend-config";

const TAG_COLORS: Record<string, string> = {
  damage_type: "bg-red-100 text-red-700",
  trade: "bg-blue-100 text-blue-700",
  material: "bg-purple-100 text-purple-700",
  elevation: "bg-cyan-100 text-cyan-700",
};

const TAG_CONFIG: { key: string; color: string }[] = [
  { key: "damage_type", color: "damage_type" },
  { key: "trade", color: "trade" },
  { key: "severity", color: "" },
  { key: "material", color: "material" },
  { key: "elevation", color: "elevation" },
];

const DAMAGE_TYPES = ["hail", "wind", "water", "impact", "wear", "mechanical", "unknown"];
const TRADES = ["roofing", "siding", "gutters", "windows", "interior", "other"];
const MATERIALS = ["asphalt_shingle", "metal", "vinyl_siding", "wood", "slate", "tile", "other"];
const ELEVATIONS = ["roof", "front", "rear", "left", "right", "interior", "ground"];
const SEVERITIES = ["minor", "moderate", "severe", "catastrophic"];

type ViewMode = "card" | "grid";

// Status color for thumbnail borders and grid badges
function statusBorderColor(status: string | null): string {
  switch (status) {
    case "approved": return "border-green-500";
    case "rejected": return "border-red-500";
    case "corrected": return "border-blue-500";
    default: return "border-gray-300";
  }
}

function statusBadge(status: string | null): { bg: string; label: string } {
  switch (status) {
    case "approved": return { bg: "bg-green-500", label: "Approved" };
    case "rejected": return { bg: "bg-red-500", label: "Rejected" };
    case "corrected": return { bg: "bg-blue-500", label: "Corrected" };
    default: return { bg: "bg-gray-400", label: "Unreviewed" };
  }
}

export function PhotoReviewContent() {
  const searchParams = useSearchParams();
  const claimId = searchParams.get("claim");

  const [photos, setPhotos] = useState<PhotoForReview[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [showEditor, setShowEditor] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stampType, setStampType] = useState<"APPROVE" | "REJECT" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("card");

  // Track which photos have been reviewed/skipped this session
  const [localStatuses, setLocalStatuses] = useState<Map<string, string>>(new Map());

  // Session stats
  const [sessionStats, setSessionStats] = useState({ approved: 0, corrected: 0, rejected: 0, skipped: 0 });

  // Edit form
  const [editAnnotation, setEditAnnotation] = useState("");
  const [editTags, setEditTags] = useState<Record<string, string>>({});
  const [editNotes, setEditNotes] = useState("");

  // Preload refs
  const imgRefs = useRef<HTMLImageElement[]>([]);
  const thumbnailRef = useRef<HTMLDivElement>(null);

  const fetchPhotos = useCallback(async () => {
    const params = new URLSearchParams({ limit: "200", offset: "0" });
    if (claimId) params.set("claim_id", claimId);

    const res = await fetch(`/api/photo-review?${params}`);
    if (!res.ok) {
      setError("Failed to load photos. Please refresh.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    // Keep ALL photos (including already-reviewed) for navigation
    setPhotos(data.photos);
    setTotal(data.total);
    setReviewed(data.reviewed);

    // Initialize local statuses from server feedback
    const statusMap = new Map<string, string>();
    for (const p of data.photos) {
      if (p.feedback_status) {
        statusMap.set(p.id, p.feedback_status);
      }
    }
    setLocalStatuses(statusMap);

    // Start at first unreviewed photo
    const firstUnreviewed = data.photos.findIndex((p: PhotoForReview) => !p.feedback_status);
    setCurrentIndex(firstUnreviewed >= 0 ? firstUnreviewed : 0);
    setLoading(false);
  }, [claimId]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  // Preload next 2 images
  useEffect(() => {
    imgRefs.current = [];
    for (let i = 1; i <= 2; i++) {
      const next = photos[currentIndex + i];
      if (next?.signed_url) {
        const img = new Image();
        img.src = next.signed_url;
        imgRefs.current.push(img);
      }
    }
    return () => {
      imgRefs.current = [];
    };
  }, [currentIndex, photos]);

  // Scroll thumbnail strip to keep current photo visible
  useEffect(() => {
    if (thumbnailRef.current && viewMode === "card") {
      const thumb = thumbnailRef.current.children[currentIndex] as HTMLElement;
      if (thumb) {
        thumb.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }
  }, [currentIndex, viewMode]);

  const getEffectiveStatus = useCallback((photo: PhotoForReview): string | null => {
    return localStatuses.get(photo.id) || photo.feedback_status || null;
  }, [localStatuses]);

  const openEditor = useCallback(() => {
    const photo = photos[currentIndex];
    if (!photo) return;
    setEditAnnotation(photo.annotation_text || "");
    setEditTags({
      damage_type: photo.damage_type || "",
      material: photo.material || "",
      trade: photo.trade || "",
      elevation: photo.elevation || "",
      severity: photo.severity || "",
    });
    setEditNotes("");
    setShowEditor(true);
  }, [photos, currentIndex]);

  const advanceToNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, photos.length));
  }, [photos.length]);

  const handleAction = useCallback(async (status: FeedbackStatus) => {
    const photo = photos[currentIndex];
    if (!photo || submitting) return;
    setSubmitting(true);
    setError(null);

    // Show stamp animation
    if (status === "approved") setStampType("APPROVE");
    else if (status === "rejected") setStampType("REJECT");

    const feedback: PhotoFeedback = {
      photo_id: photo.id,
      claim_id: claimId || undefined,
      status,
    };

    if (status === "corrected") {
      feedback.corrected_annotation = editAnnotation;
      feedback.corrected_tags = editTags as PhotoFeedback["corrected_tags"];
      feedback.notes = editNotes || undefined;
    }

    const res = await fetch("/api/photo-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(feedback),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: "Unknown error" }));
      setError(`Failed to save: ${errData.error || res.statusText}`);
      setStampType(null);
      setSubmitting(false);
      return;
    }

    // Update local status tracking
    setLocalStatuses((prev) => new Map(prev).set(photo.id, status));
    setSessionStats((s) => ({ ...s, [status]: s[status as keyof typeof s] + 1 }));
    if (!getEffectiveStatus(photo)) {
      setReviewed((r) => r + 1);
    }
    setShowEditor(false);

    // Animate out then advance
    setTimeout(() => {
      setStampType(null);
      advanceToNext();
      setSubmitting(false);
    }, 400);
  }, [photos, currentIndex, submitting, claimId, editAnnotation, editTags, editNotes, getEffectiveStatus, advanceToNext]);

  const handleSkip = useCallback(() => {
    if (submitting) return;
    setSessionStats((s) => ({ ...s, skipped: s.skipped + 1 }));
    advanceToNext();
  }, [submitting, advanceToNext]);

  const handlePrevious = useCallback(() => {
    if (submitting) return;
    setCurrentIndex((i) => Math.max(0, i - 1));
  }, [submitting]);

  const jumpToIndex = useCallback((idx: number) => {
    setCurrentIndex(idx);
    setViewMode("card");
    setShowEditor(false);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in editor inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (showEditor) return;

      switch (e.key) {
        case "a": case "A": handleAction("approved"); break;
        case "r": case "R": handleAction("rejected"); break;
        case "e": case "E": openEditor(); break;
        case "s": case "S": case "ArrowRight": handleSkip(); break;
        case "ArrowLeft": handlePrevious(); break;
        case "g": case "G": setViewMode((m) => m === "card" ? "grid" : "card"); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showEditor, handleAction, openEditor, handleSkip, handlePrevious]);

  const currentPhoto = photos[currentIndex];

  // Compute progress stats
  const reviewedCount = photos.filter((p) => getEffectiveStatus(p) !== null).length;
  const skippedCount = photos.filter((p) => getEffectiveStatus(p) === null).length;
  const progress = photos.length > 0 ? (reviewedCount / photos.length) * 100 : 0;

  // Shared nav bar
  const navBar = (
    <nav className="bg-[var(--navy)] border-b border-white/10">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <a href="/dashboard" className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white">DR</div>
          <span className="text-white font-bold text-lg tracking-tight">Photo Review</span>
        </a>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <span>{currentIndex + 1} of {photos.length}</span>
          <span className="text-green-400">{sessionStats.approved} approved</span>
          <span className="text-blue-400">{sessionStats.corrected} corrected</span>
          <span className="text-red-400">{sessionStats.rejected} rejected</span>
          {sessionStats.skipped > 0 && <span className="text-gray-500">{sessionStats.skipped} skipped</span>}
          <button
            onClick={() => setViewMode((m) => m === "card" ? "grid" : "card")}
            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors"
            title="Toggle grid view (G)"
          >
            {viewMode === "card" ? "Grid" : "Card"}
          </button>
        </div>
      </div>
    </nav>
  );

  // Error banner
  const errorBanner = error && (
    <div className="max-w-2xl mx-auto px-4 mt-4">
      <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex items-center justify-between">
        <span>{error}</span>
        <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-3">&times;</button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">Loading photos...</p>
      </main>
    );
  }

  if (photos.length === 0) {
    return (
      <main className="min-h-screen bg-gray-50">
        {navBar}
        <div className="max-w-lg mx-auto mt-20 text-center">
          <div className="text-5xl mb-4">&#128247;</div>
          <h2 className="text-2xl font-bold text-[var(--navy)] mb-2">No photos found</h2>
          <p className="text-gray-500 mb-6">This claim doesn&apos;t have any photos to review yet.</p>
          <a href="/dashboard" className="text-sm text-gray-500 hover:text-[var(--navy)]">Back to Dashboard</a>
        </div>
      </main>
    );
  }

  // Completion state — past end of photos
  if (currentIndex >= photos.length && viewMode === "card") {
    const unreviewedCount = photos.filter((p) => getEffectiveStatus(p) === null).length;
    return (
      <main className="min-h-screen bg-gray-50">
        {navBar}
        {errorBanner}
        <div className="max-w-lg mx-auto mt-20 text-center">
          <div className="text-5xl mb-4">&#10003;</div>
          <h2 className="text-2xl font-bold text-[var(--navy)] mb-2">Review complete!</h2>
          <p className="text-gray-500 mb-6">
            {unreviewedCount > 0
              ? `${unreviewedCount} photo${unreviewedCount > 1 ? "s" : ""} skipped — you can go back and review them.`
              : `All ${photos.length} photos reviewed.`}
          </p>
          <div className="flex justify-center gap-6 mb-8">
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{sessionStats.approved}</p>
              <p className="text-xs text-gray-500">Approved</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-600">{sessionStats.corrected}</p>
              <p className="text-xs text-gray-500">Corrected</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-red-600">{sessionStats.rejected}</p>
              <p className="text-xs text-gray-500">Rejected</p>
            </div>
          </div>
          <div className="flex flex-col items-center gap-3">
            {unreviewedCount > 0 && (
              <button
                onClick={() => {
                  const idx = photos.findIndex((p) => getEffectiveStatus(p) === null);
                  if (idx >= 0) jumpToIndex(idx);
                }}
                className="bg-amber-500 hover:bg-amber-600 text-white px-6 py-2.5 rounded-xl font-semibold transition-colors"
              >
                Review {unreviewedCount} Skipped Photo{unreviewedCount > 1 ? "s" : ""}
              </button>
            )}
            {claimId && (
              <a
                href={`/dashboard/scope-review?claim=${claimId}`}
                className="bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-8 py-3 rounded-xl font-semibold transition-colors"
              >
                Continue to Scope Review
              </a>
            )}
            <a href={claimId ? `/dashboard/claim/${claimId}` : "/dashboard"} className="text-sm text-gray-500 hover:text-[var(--navy)]">
              Back to Claim
            </a>
          </div>
        </div>
      </main>
    );
  }

  // ==================== GRID VIEW ====================
  if (viewMode === "grid") {
    return (
      <main className="min-h-screen bg-gray-50">
        {navBar}
        {errorBanner}
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {photos.map((photo, idx) => {
              const status = getEffectiveStatus(photo);
              const badge = statusBadge(status);
              return (
                <button
                  key={photo.id}
                  onClick={() => jumpToIndex(idx)}
                  className={`relative rounded-xl overflow-hidden border-2 ${statusBorderColor(status)} hover:shadow-lg transition-all bg-white`}
                >
                  <div className="aspect-square bg-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.signed_url}
                      alt={photo.annotation_key}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  {/* Status badge */}
                  <div className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold text-white ${badge.bg}`}>
                    {badge.label}
                  </div>
                  {/* Info bar */}
                  <div className="px-2 py-1.5">
                    <p className="text-[10px] font-mono text-gray-500 truncate">{photo.annotation_key}</p>
                    {photo.damage_type && (
                      <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-red-100 text-red-700">
                        {photo.damage_type}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </main>
    );
  }

  // ==================== CARD VIEW ====================
  return (
    <main className="min-h-screen bg-gray-50">
      {navBar}

      {/* Progress bar — two-tone */}
      <div className="h-1.5 bg-gray-200 flex">
        <div className="h-full bg-[var(--red)] transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      {errorBanner}

      {/* Card */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        {currentPhoto && (
          <div className={`bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-lg transition-all duration-300 ${stampType ? "scale-95 opacity-80" : ""}`}>
            {/* Header */}
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--navy)]">{currentPhoto.address}</p>
                <p className="text-xs text-gray-400">{currentPhoto.annotation_key}</p>
              </div>
              {getEffectiveStatus(currentPhoto) && (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold text-white ${statusBadge(getEffectiveStatus(currentPhoto)).bg}`}>
                  {statusBadge(getEffectiveStatus(currentPhoto)).label}
                </span>
              )}
            </div>

            {/* Photo */}
            <div className="relative aspect-[4/3] bg-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={currentPhoto.signed_url}
                alt={currentPhoto.annotation_text || currentPhoto.annotation_key}
                className="w-full h-full object-contain"
              />
              {/* Stamp overlay */}
              {stampType && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div
                    className={`text-5xl font-black tracking-widest transform -rotate-12 border-4 px-6 py-2 rounded-lg ${
                      stampType === "APPROVE"
                        ? "text-green-500 border-green-500"
                        : "text-red-500 border-red-500"
                    }`}
                  >
                    {stampType}
                  </div>
                </div>
              )}
            </div>

            {/* Annotation */}
            <div className="px-5 py-4">
              <p className="text-sm text-gray-700 mb-3">{currentPhoto.annotation_text || "No annotation"}</p>
              <div className="flex flex-wrap gap-2">
                {TAG_CONFIG.map(({ key, color }) => {
                  const value = currentPhoto[key as keyof PhotoForReview] as string | null;
                  if (!value) return null;
                  const colorClass = key === "severity"
                    ? (SEVERITY_COLORS[value] || "bg-gray-100 text-gray-600")
                    : TAG_COLORS[color];
                  return (
                    <span key={key} className={`px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
                      {value}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Action buttons */}
            {!showEditor && (
              <div className="px-5 pb-5 flex gap-3">
                <button
                  onClick={() => handleAction("rejected")}
                  disabled={submitting}
                  className="flex-1 py-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 font-semibold text-sm transition-colors border border-red-200 disabled:opacity-50"
                >
                  Reject (R)
                </button>
                <button
                  onClick={openEditor}
                  disabled={submitting}
                  className="flex-1 py-3 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-sm transition-colors border border-blue-200 disabled:opacity-50"
                >
                  Edit (E)
                </button>
                <button
                  onClick={() => handleAction("approved")}
                  disabled={submitting}
                  className="flex-1 py-3 rounded-xl bg-green-50 hover:bg-green-100 text-green-700 font-semibold text-sm transition-colors border border-green-200 disabled:opacity-50"
                >
                  Approve (A)
                </button>
                <button
                  onClick={handleSkip}
                  disabled={submitting}
                  className="py-3 px-4 rounded-xl bg-gray-50 hover:bg-gray-100 text-gray-500 font-semibold text-sm transition-colors border border-gray-200 disabled:opacity-50"
                  title="Skip (S or ArrowRight)"
                >
                  Skip
                </button>
              </div>
            )}

            {/* Editor panel */}
            {showEditor && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Annotation</label>
                  <textarea
                    value={editAnnotation}
                    onChange={(e) => setEditAnnotation(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: "damage_type", label: "Damage Type", options: DAMAGE_TYPES },
                    { key: "trade", label: "Trade", options: TRADES },
                    { key: "material", label: "Material", options: MATERIALS },
                    { key: "elevation", label: "Elevation", options: ELEVATIONS },
                    { key: "severity", label: "Severity", options: SEVERITIES },
                  ].map(({ key, label, options }) => (
                    <div key={key}>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
                      <select
                        value={editTags[key] || ""}
                        onChange={(e) => setEditTags({ ...editTags, [key]: e.target.value })}
                        className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                      >
                        <option value="">—</option>
                        {options.map((o) => (
                          <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Notes (why the correction?)</label>
                  <input
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    placeholder="Optional"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowEditor(false)}
                    className="flex-1 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold text-sm transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleAction("corrected")}
                    disabled={submitting}
                    className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-colors disabled:opacity-50"
                  >
                    Save Correction
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Thumbnail strip */}
        <div
          ref={thumbnailRef}
          className="flex gap-1.5 mt-4 overflow-x-auto pb-2 scrollbar-thin"
          style={{ scrollbarWidth: "thin" }}
        >
          {photos.map((photo, idx) => {
            const status = getEffectiveStatus(photo);
            const isCurrent = idx === currentIndex;
            return (
              <button
                key={photo.id}
                onClick={() => setCurrentIndex(idx)}
                className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${
                  isCurrent ? "ring-2 ring-[var(--red)] ring-offset-1 scale-110" : ""
                } ${statusBorderColor(status)} hover:opacity-80`}
                title={`${photo.annotation_key} — ${status || "unreviewed"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.signed_url}
                  alt={photo.annotation_key}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </button>
            );
          })}
        </div>

        {/* Navigation + keyboard hints */}
        <div className="flex items-center justify-between mt-3">
          <button
            onClick={handlePrevious}
            disabled={currentIndex === 0}
            className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium disabled:opacity-30 transition-colors"
          >
            ← Previous
          </button>
          <p className="text-center text-xs text-gray-400">
            <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-600">A</kbd> approve &middot;{" "}
            <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-600">R</kbd> reject &middot;{" "}
            <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-600">E</kbd> edit &middot;{" "}
            <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-600">S</kbd> skip &middot;{" "}
            <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-600">G</kbd> grid
          </p>
          <button
            onClick={handleSkip}
            disabled={currentIndex >= photos.length - 1}
            className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium disabled:opacity-30 transition-colors"
          >
            Next →
          </button>
        </div>
      </div>
    </main>
  );
}
