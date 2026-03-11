"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import type { PhotoForReview, PhotoFeedback } from "@/types/photo-review";

const TAG_COLORS: Record<string, string> = {
  damage_type: "bg-red-100 text-red-700",
  trade: "bg-blue-100 text-blue-700",
  material: "bg-purple-100 text-purple-700",
  elevation: "bg-cyan-100 text-cyan-700",
};

const SEVERITY_COLORS: Record<string, string> = {
  minor: "bg-yellow-100 text-yellow-700",
  moderate: "bg-orange-100 text-orange-700",
  severe: "bg-red-100 text-red-800",
  catastrophic: "bg-red-200 text-red-900",
};

const DAMAGE_TYPES = ["hail", "wind", "water", "impact", "wear", "mechanical", "unknown"];
const TRADES = ["roofing", "siding", "gutters", "windows", "interior", "other"];
const MATERIALS = ["asphalt_shingle", "metal", "vinyl_siding", "wood", "slate", "tile", "other"];
const ELEVATIONS = ["roof", "front", "rear", "left", "right", "interior", "ground"];
const SEVERITIES = ["minor", "moderate", "severe", "catastrophic"];

export function PhotoReviewContent({ userId }: { userId: string }) {
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
  const [regenerating, setRegenereating] = useState(false);

  // Session stats
  const [sessionStats, setSessionStats] = useState({ approved: 0, corrected: 0, rejected: 0 });

  // Edit form
  const [editAnnotation, setEditAnnotation] = useState("");
  const [editTags, setEditTags] = useState<Record<string, string>>({});
  const [editNotes, setEditNotes] = useState("");

  // Preload refs
  const imgRefs = useRef<HTMLImageElement[]>([]);

  const fetchPhotos = useCallback(async () => {
    const params = new URLSearchParams({ limit: "50", offset: "0" });
    if (claimId) params.set("claim_id", claimId);

    const res = await fetch(`/api/photo-review?${params}`);
    const data = await res.json();
    // Filter out already-reviewed in global mode
    const unreviewed = data.photos.filter((p: PhotoForReview) => !p.feedback_status);
    setPhotos(unreviewed);
    setTotal(data.total);
    setReviewed(data.reviewed);
    setCurrentIndex(0);
    setLoading(false);
  }, [claimId]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  // Preload next 2 images
  useEffect(() => {
    for (let i = 1; i <= 2; i++) {
      const next = photos[currentIndex + i];
      if (next?.signed_url) {
        const img = new Image();
        img.src = next.signed_url;
        imgRefs.current[i] = img;
      }
    }
  }, [currentIndex, photos]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showEditor) return;
      if (e.key === "a" || e.key === "A") handleAction("approved");
      if (e.key === "r" || e.key === "R") handleAction("rejected");
      if (e.key === "e" || e.key === "E") openEditor();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const currentPhoto = photos[currentIndex];

  const openEditor = () => {
    if (!currentPhoto) return;
    setEditAnnotation(currentPhoto.annotation_text || "");
    setEditTags({
      damage_type: currentPhoto.damage_type || "",
      material: currentPhoto.material || "",
      trade: currentPhoto.trade || "",
      elevation: currentPhoto.elevation || "",
      severity: currentPhoto.severity || "",
    });
    setEditNotes("");
    setShowEditor(true);
  };

  const handleAction = async (status: "approved" | "corrected" | "rejected") => {
    if (!currentPhoto || submitting) return;
    setSubmitting(true);

    // Show stamp animation
    if (status === "approved") setStampType("APPROVE");
    else if (status === "rejected") setStampType("REJECT");

    const feedback: PhotoFeedback = {
      photo_id: currentPhoto.id,
      claim_id: claimId || undefined,
      status,
    };

    if (status === "corrected") {
      feedback.corrected_annotation = editAnnotation;
      feedback.corrected_tags = editTags as PhotoFeedback["corrected_tags"];
      feedback.notes = editNotes || undefined;
    }

    await fetch("/api/photo-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(feedback),
    });

    setSessionStats((s) => ({ ...s, [status]: s[status as keyof typeof s] + 1 }));
    setReviewed((r) => r + 1);
    setShowEditor(false);

    // Animate out then advance
    setTimeout(() => {
      setStampType(null);
      setCurrentIndex((i) => i + 1);
      setSubmitting(false);
    }, 400);
  };

  const handleRegenerate = async () => {
    if (!claimId || regenerating) return;
    setRegenereating(true);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "https://dumbroof-backend-production.up.railway.app";
      await fetch(`${backendUrl}/api/reprocess/${claimId}`, { method: "POST" });
    } catch (err) {
      console.error("Reprocess failed:", err);
    }
    setRegenereating(false);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">Loading photos...</p>
      </main>
    );
  }

  // All done state
  if (!currentPhoto || currentIndex >= photos.length) {
    return (
      <main className="min-h-screen bg-gray-50">
        <nav className="bg-[var(--navy)] border-b border-white/10">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <a href="/dashboard" className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white">DR</div>
              <span className="text-white font-bold text-lg tracking-tight">Photo Review</span>
            </a>
          </div>
        </nav>
        <div className="max-w-lg mx-auto mt-20 text-center">
          <div className="text-5xl mb-4">&#10003;</div>
          <h2 className="text-2xl font-bold text-[var(--navy)] mb-2">All caught up!</h2>
          <p className="text-gray-500 mb-6">No more photos to review{claimId ? " for this claim" : ""}.</p>
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
          {claimId && (
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-8 py-3 rounded-xl font-semibold transition-colors disabled:opacity-50"
            >
              {regenerating ? "Regenerating..." : "Regenerate Report"}
            </button>
          )}
          <div className="mt-4">
            <a href="/dashboard" className="text-sm text-gray-500 hover:text-[var(--navy)]">Back to Dashboard</a>
          </div>
        </div>
      </main>
    );
  }

  const progress = total > 0 ? ((reviewed + currentIndex) / total) * 100 : 0;

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Nav */}
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
          </div>
        </div>
      </nav>

      {/* Progress bar */}
      <div className="h-1 bg-gray-200">
        <div className="h-1 bg-[var(--red)] transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      {/* Card */}
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className={`bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-lg transition-all duration-300 ${stampType ? "scale-95 opacity-80" : ""}`}>
          {/* Header */}
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-[var(--navy)]">{currentPhoto.address}</p>
              <p className="text-xs text-gray-400">{currentPhoto.annotation_key}</p>
            </div>
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
              {currentPhoto.damage_type && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TAG_COLORS.damage_type}`}>
                  {currentPhoto.damage_type}
                </span>
              )}
              {currentPhoto.trade && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TAG_COLORS.trade}`}>
                  {currentPhoto.trade}
                </span>
              )}
              {currentPhoto.severity && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_COLORS[currentPhoto.severity] || "bg-gray-100 text-gray-600"}`}>
                  {currentPhoto.severity}
                </span>
              )}
              {currentPhoto.material && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TAG_COLORS.material}`}>
                  {currentPhoto.material}
                </span>
              )}
              {currentPhoto.elevation && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TAG_COLORS.elevation}`}>
                  {currentPhoto.elevation}
                </span>
              )}
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

        {/* Keyboard hint */}
        <p className="text-center text-xs text-gray-400 mt-4">
          Keyboard: <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-600">A</kbd> approve &middot; <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-600">R</kbd> reject &middot; <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-600">E</kbd> edit
        </p>
      </div>
    </main>
  );
}
