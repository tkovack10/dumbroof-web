"use client";

import { useEffect, useState } from "react";
import { REPAIR_TYPE_LABELS, REPAIR_SEVERITY_COLORS } from "@/lib/claim-constants";

interface ReviewRepair {
  id: string;
  address: string;
  homeowner_name: string;
  repair_type: string | null;
  severity: string | null;
  total_price: number | null;
  leak_description: string | null;
  created_at: string;
  photo_url: string | null;
  feedback_status: string | null;
}

type FeedbackStatus = "confirmed" | "corrected" | "wrong";

export function RepairReviewContent() {
  const [repairs, setRepairs] = useState<ReviewRepair[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    corrected_repair_type: "",
    corrected_severity: "",
    actual_leak_source: "",
    actual_repair_performed: "",
    notes: "",
  });

  useEffect(() => {
    fetchRepairs();
  }, []);

  async function fetchRepairs() {
    const res = await fetch("/api/repair-review");
    if (res.ok) {
      const data = await res.json();
      setRepairs(data.repairs || []);
      setTotal(data.total || 0);
      setReviewed(data.reviewed || 0);
    }
    setLoading(false);
  }

  async function submitFeedback(repairId: string, status: FeedbackStatus, extras?: Record<string, string>) {
    setSubmitting(repairId);
    const res = await fetch("/api/repair-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repair_id: repairId, status, ...extras }),
    });
    if (res.ok) {
      setRepairs(prev =>
        prev.map(r => r.id === repairId ? { ...r, feedback_status: status } : r)
      );
      setReviewed(prev => prev + 1);
      setEditingId(null);
    }
    setSubmitting(null);
  }

  function startEdit(repair: ReviewRepair) {
    setEditingId(repair.id);
    setEditForm({
      corrected_repair_type: repair.repair_type || "",
      corrected_severity: repair.severity || "",
      actual_leak_source: "",
      actual_repair_performed: "",
      notes: "",
    });
  }

  const repairTypeOptions = Object.entries(REPAIR_TYPE_LABELS)
    .filter(([code]) => code === code.toUpperCase() && code.includes("-")) // Only 22-code system
    .map(([code, label]) => ({ code, label }));

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <nav className="bg-[var(--navy)] border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white">DR</div>
            <span className="text-white font-bold text-lg tracking-tight">dumb roof<sup className="text-[9px] font-medium align-super ml-0.5">&trade;</sup></span>
          </div>
          <a href="/dashboard" className="text-gray-400 hover:text-white text-sm transition-colors">Back to Dashboard</a>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[var(--navy)]">Repair Review</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Review AI diagnoses to improve accuracy over time.
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-[var(--navy)]">{reviewed} / {total} reviewed</p>
            {total > 0 && (
              <div className="w-32 bg-gray-100 rounded-full h-1.5 mt-1">
                <div
                  className="bg-green-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (reviewed / total) * 100)}%` }}
                />
              </div>
            )}
          </div>
        </div>

        {repairs.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 text-center py-16 px-8">
            <h3 className="text-lg font-semibold text-[var(--navy)] mb-2">No repairs to review</h3>
            <p className="text-gray-500 text-sm">Completed repairs will appear here for diagnosis review.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {repairs.map((repair) => {
              const isEditing = editingId === repair.id;
              const severityColor = repair.severity ? REPAIR_SEVERITY_COLORS[repair.severity] : null;
              const statusBadge = repair.feedback_status ? {
                confirmed: { color: "bg-green-100 text-green-700", label: "Confirmed" },
                corrected: { color: "bg-blue-100 text-blue-700", label: "Corrected" },
                wrong: { color: "bg-red-100 text-red-700", label: "Wrong" },
              }[repair.feedback_status] : null;

              return (
                <div key={repair.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="flex gap-4 p-5">
                    {/* Photo preview */}
                    {repair.photo_url && (
                      <div className="w-24 h-24 rounded-lg overflow-hidden shrink-0 bg-gray-100">
                        <img src={repair.photo_url} alt="Leak" className="w-full h-full object-cover" />
                      </div>
                    )}

                    {/* Repair info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-[var(--navy)] truncate">{repair.address}</h3>
                        {statusBadge && (
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusBadge.color}`}>
                            {statusBadge.label}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mb-2">
                        {repair.homeowner_name} &middot; {new Date(repair.created_at).toLocaleDateString()}
                      </p>

                      {/* AI Diagnosis */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold text-gray-400">AI Diagnosis:</span>
                        <span className="text-xs font-medium text-[var(--navy)]">
                          {repair.repair_type ? (REPAIR_TYPE_LABELS[repair.repair_type] || repair.repair_type) : "Unknown"}
                        </span>
                        {severityColor && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${severityColor} capitalize`}>
                            {repair.severity}
                          </span>
                        )}
                        {repair.total_price ? (
                          <span className="text-xs font-bold text-[var(--navy)]">
                            ${repair.total_price.toLocaleString("en-US", { minimumFractionDigits: 0 })}
                          </span>
                        ) : null}
                      </div>

                      {repair.leak_description && (
                        <p className="text-xs text-gray-500 line-clamp-2">{repair.leak_description}</p>
                      )}
                    </div>
                  </div>

                  {/* Action buttons (only if not already reviewed) */}
                  {!repair.feedback_status && !isEditing && (
                    <div className="flex gap-2 px-5 pb-4">
                      <button
                        onClick={() => submitFeedback(repair.id, "confirmed")}
                        disabled={submitting === repair.id}
                        className="flex-1 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 px-4 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => startEdit(repair)}
                        disabled={submitting === repair.id}
                        className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-4 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        Correct
                      </button>
                      <button
                        onClick={() => startEdit(repair)}
                        disabled={submitting === repair.id}
                        className="flex-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-4 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        Wrong
                      </button>
                    </div>
                  )}

                  {/* Edit panel */}
                  {isEditing && (
                    <div className="border-t border-gray-100 p-5 bg-gray-50/50 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 mb-1">Correct Repair Type</label>
                          <select
                            value={editForm.corrected_repair_type}
                            onChange={(e) => setEditForm({ ...editForm, corrected_repair_type: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
                          >
                            <option value="">-- Select --</option>
                            {repairTypeOptions.map(({ code, label }) => (
                              <option key={code} value={code}>{label} ({code})</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 mb-1">Correct Severity</label>
                          <select
                            value={editForm.corrected_severity}
                            onChange={(e) => setEditForm({ ...editForm, corrected_severity: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
                          >
                            <option value="">-- Select --</option>
                            <option value="minor">Minor</option>
                            <option value="moderate">Moderate</option>
                            <option value="major">Major</option>
                            <option value="critical">Critical</option>
                            <option value="emergency">Emergency</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Actual Leak Source</label>
                        <input
                          type="text"
                          value={editForm.actual_leak_source}
                          onChange={(e) => setEditForm({ ...editForm, actual_leak_source: e.target.value })}
                          placeholder="What was actually causing the leak?"
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Actual Repair Performed</label>
                        <input
                          type="text"
                          value={editForm.actual_repair_performed}
                          onChange={(e) => setEditForm({ ...editForm, actual_repair_performed: e.target.value })}
                          placeholder="What repair was actually done?"
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Notes</label>
                        <textarea
                          value={editForm.notes}
                          onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                          placeholder="Any additional notes..."
                          rows={2}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => submitFeedback(
                            repair.id,
                            editForm.corrected_repair_type !== repair.repair_type ? "corrected" : "wrong",
                            editForm,
                          )}
                          disabled={submitting === repair.id}
                          className="bg-[var(--navy)] hover:bg-[var(--navy-light)] text-white px-5 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                        >
                          {submitting === repair.id ? "Saving..." : "Submit Feedback"}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-gray-500 hover:text-gray-700 px-4 py-2 text-xs font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
