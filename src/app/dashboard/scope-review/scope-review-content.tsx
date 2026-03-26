"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import type { LineItemForReview, ScopeReviewResponse } from "@/types/scope-review";
import { getBackendUrl } from "@/lib/backend-config";
import { RoofSectionsEditor } from "@/components/roof-sections-editor";

const CATEGORY_COLORS: Record<string, string> = {
  ROOFING: "bg-red-50 text-red-700 border-red-200",
  GUTTERS: "bg-blue-50 text-blue-700 border-blue-200",
  SIDING: "bg-purple-50 text-purple-700 border-purple-200",
  WINDOWS: "bg-cyan-50 text-cyan-700 border-cyan-200",
  INTERIOR: "bg-amber-50 text-amber-700 border-amber-200",
  GENERAL: "bg-white/[0.06] text-[var(--gray)] border-[var(--border-glass)]",
};

function getCategoryColor(cat: string): string {
  return CATEGORY_COLORS[cat.toUpperCase()] || CATEGORY_COLORS.GENERAL;
}

interface EditState {
  description: string;
  qty: string;
  unit: string;
  unit_price: string;
}

export function ScopeReviewContent() {
  const searchParams = useSearchParams();
  const claimId = searchParams.get("claim");

  const [items, setItems] = useState<LineItemForReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contractorRcv, setContractorRcv] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ description: "", qty: "", unit: "", unit_price: "" });
  const [showAddForm, setShowAddForm] = useState<string | null>(null); // category
  const [newItem, setNewItem] = useState<EditState>({ description: "", qty: "", unit: "EA", unit_price: "" });
  const [regenerating, setRegenerating] = useState(false);

  // Session stats
  const [sessionStats, setSessionStats] = useState({ approved: 0, corrected: 0, removed: 0, added: 0 });

  const fetchItems = useCallback(async () => {
    if (!claimId) return;
    const res = await fetch(`/api/scope-review?claim_id=${claimId}`);
    if (!res.ok) {
      setError("Failed to load line items.");
      setLoading(false);
      return;
    }
    const data: ScopeReviewResponse = await res.json();
    setItems(data.items);
    setContractorRcv(data.contractor_rcv);
    setCategories(data.categories);
    setLoading(false);
  }, [claimId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleAction = async (itemId: string, status: "approved" | "corrected" | "removed", corrections?: Partial<EditState>) => {
    setSubmitting(itemId);
    setError(null);

    const body: Record<string, unknown> = { line_item_id: itemId, status };
    if (status === "corrected" && corrections) {
      if (corrections.description) body.corrected_description = corrections.description;
      if (corrections.qty) body.corrected_qty = parseFloat(corrections.qty);
      if (corrections.unit_price) body.corrected_unit_price = parseFloat(corrections.unit_price);
      if (corrections.unit) body.corrected_unit = corrections.unit;
    }

    const res = await fetch("/api/scope-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: "Unknown error" }));
      setError(`Failed to save: ${errData.error || res.statusText}`);
      setSubmitting(null);
      return;
    }

    const data = await res.json();
    setContractorRcv(data.new_contractor_rcv);

    // Update local state
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        const updated = { ...item, feedback_status: status as LineItemForReview["feedback_status"] };
        if (status === "corrected" && corrections) {
          if (corrections.description) updated.description = corrections.description;
          if (corrections.qty) updated.qty = parseFloat(corrections.qty);
          if (corrections.unit_price) updated.unit_price = parseFloat(corrections.unit_price);
          if (corrections.unit) updated.unit = corrections.unit;
          updated.total = Math.round(updated.qty * updated.unit_price * 100) / 100;
        }
        return updated;
      })
    );

    setSessionStats((s) => ({ ...s, [status]: s[status as keyof typeof s] + 1 }));
    setEditingId(null);
    setSubmitting(null);
  };

  const handleAddItem = async (category: string) => {
    if (!claimId) return;
    const qty = parseFloat(newItem.qty);
    const unitPrice = parseFloat(newItem.unit_price);
    if (!newItem.description || isNaN(qty) || isNaN(unitPrice)) {
      setError("Description, quantity, and unit price are required.");
      return;
    }

    setSubmitting("add");
    setError(null);

    const res = await fetch("/api/scope-review", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claim_id: claimId,
        category,
        description: newItem.description,
        qty,
        unit: newItem.unit || "EA",
        unit_price: unitPrice,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: "Unknown error" }));
      setError(`Failed to add: ${errData.error || res.statusText}`);
      setSubmitting(null);
      return;
    }

    const data = await res.json();
    setContractorRcv(data.new_contractor_rcv);
    setItems((prev) => [...prev, data.item]);
    setSessionStats((s) => ({ ...s, added: s.added + 1 }));
    setNewItem({ description: "", qty: "", unit: "EA", unit_price: "" });
    setShowAddForm(null);
    setSubmitting(null);
  };

  const handleRegenerate = async () => {
    if (!claimId || regenerating) return;
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`${getBackendUrl()}/api/reprocess/${claimId}`, { method: "POST" });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: "Unknown error" }));
        setError(`Reprocess failed: ${errData.detail || errData.error || res.statusText}`);
      }
    } catch (err) {
      setError(`Reprocess failed: ${err instanceof Error ? err.message : "Network error"}`);
    }
    setRegenerating(false);
  };

  const startEdit = (item: LineItemForReview) => {
    setEditingId(item.id);
    setEditState({
      description: item.description,
      qty: String(item.qty),
      unit: item.unit,
      unit_price: String(item.unit_price),
    });
  };

  const toggleCategory = (cat: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // Group items by category
  const grouped = new Map<string, LineItemForReview[]>();
  for (const item of items) {
    const cat = item.category || "GENERAL";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(item);
  }

  const activeItems = items.filter((i) => i.feedback_status !== "removed");
  const liveTotal = activeItems.reduce((sum, i) => sum + i.qty * i.unit_price, 0);
  const reviewedCount = items.filter((i) => i.feedback_status !== null).length;

  if (!claimId) {
    return (
      <main className="min-h-screen bg-white/[0.04] flex items-center justify-center">
        <p className="text-[var(--gray-dim)]">No claim specified. Go back to your dashboard.</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-white/[0.04] flex items-center justify-center">
        <p className="text-[var(--gray-dim)]">Loading line items...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white/[0.04]">
      {/* Nav */}
      <nav className="bg-[rgba(6,9,24,0.85)] backdrop-blur-[20px] border-b border-[var(--border-glass)] sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/dashboard" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--pink)] to-[var(--blue)] flex items-center justify-center font-bold text-white text-xs">DR</div>
            <span className="text-white font-bold text-lg tracking-tight">Scope Review</span>
          </a>
          <div className="flex items-center gap-4 text-sm text-[var(--gray-dim)]">
            <span className="text-green-400">{sessionStats.approved} approved</span>
            <span className="text-blue-400">{sessionStats.corrected} corrected</span>
            <span className="text-red-400">{sessionStats.removed} removed</span>
            <span className="text-purple-400">{sessionStats.added} added</span>
          </div>
        </div>
      </nav>

      {/* Error banner */}
      {error && (
        <div className="max-w-5xl mx-auto px-6 mt-4">
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-3">&times;</button>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Roof Sections Editor */}
        {claimId && <RoofSectionsEditor claimId={claimId} />}

        {/* Financial summary */}
        <div className="bg-white rounded-2xl border border-[var(--border-glass)] p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-[var(--gray-dim)]">Contractor RCV</p>
              <p className="text-2xl font-bold text-[var(--white)]">${Math.round(liveTotal).toLocaleString()}</p>
              {contractorRcv > 0 && Math.abs(liveTotal - contractorRcv) > 1 && (
                <p className="text-xs text-[var(--gray-dim)] mt-0.5">
                  Original: ${Math.round(contractorRcv).toLocaleString()}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-[var(--gray-dim)]">Line Items</p>
              <p className="text-2xl font-bold text-[var(--white)]">{activeItems.length}</p>
              {items.length !== activeItems.length && (
                <p className="text-xs text-[var(--gray-dim)] mt-0.5">{items.length - activeItems.length} removed</p>
              )}
            </div>
            <div>
              <p className="text-xs text-[var(--gray-dim)]">Reviewed</p>
              <p className="text-2xl font-bold text-[var(--white)]">{reviewedCount} / {items.length}</p>
            </div>
          </div>
        </div>

        {/* Category sections */}
        {(categories.length > 0 ? categories : [...grouped.keys()]).map((cat) => {
          const catItems = grouped.get(cat) || [];
          if (catItems.length === 0) return null;
          const isCollapsed = collapsedCats.has(cat);
          const catActive = catItems.filter((i) => i.feedback_status !== "removed");
          const catSubtotal = catActive.reduce((s, i) => s + i.qty * i.unit_price, 0);

          return (
            <div key={cat} className="bg-white rounded-2xl border border-[var(--border-glass)] overflow-hidden">
              {/* Category header */}
              <button
                onClick={() => toggleCategory(cat)}
                className="w-full px-5 py-3 flex items-center justify-between hover:bg-white/[0.04] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getCategoryColor(cat)}`}>
                    {cat}
                  </span>
                  <span className="text-sm text-[var(--gray-muted)]">{catItems.length} items</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-[var(--white)]">${Math.round(catSubtotal).toLocaleString()}</span>
                  <svg className={`w-4 h-4 text-[var(--gray-dim)] transition-transform ${isCollapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* Items */}
              {!isCollapsed && (
                <div className="border-t border-white/[0.04] overflow-x-auto">
                  {/* Table header */}
                  <div className="grid grid-cols-[1fr_70px_50px_80px_80px_160px] gap-2 px-5 py-2 bg-white/[0.04] text-xs font-semibold text-[var(--gray-dim)] uppercase min-w-[640px]">
                    <span>Description</span>
                    <span className="text-right">Qty</span>
                    <span className="text-center">Unit</span>
                    <span className="text-right">Price</span>
                    <span className="text-right">Total</span>
                    <span className="text-center">Actions</span>
                  </div>

                  {catItems.map((item) => {
                    const isRemoved = item.feedback_status === "removed";
                    const isEditing = editingId === item.id;
                    const isBusy = submitting === item.id;
                    const total = Math.round(item.qty * item.unit_price * 100) / 100;

                    if (isEditing) {
                      return (
                        <div key={item.id} className="px-5 py-3 border-t border-white/[0.04] bg-white/[0.04] min-w-[640px]">
                          <div className="grid grid-cols-[1fr_70px_50px_80px] gap-2 mb-3">
                            <input
                              value={editState.description}
                              onChange={(e) => setEditState({ ...editState, description: e.target.value })}
                              className="rounded-lg border border-[var(--border-glass)] bg-white/5 text-[var(--white)] px-2 py-1.5 text-sm"
                              placeholder="Description"
                            />
                            <input
                              value={editState.qty}
                              onChange={(e) => setEditState({ ...editState, qty: e.target.value })}
                              type="number"
                              step="0.01"
                              className="rounded-lg border border-[var(--border-glass)] bg-white/5 text-[var(--white)] px-2 py-1.5 text-sm text-right"
                              placeholder="Qty"
                            />
                            <input
                              value={editState.unit}
                              onChange={(e) => setEditState({ ...editState, unit: e.target.value })}
                              className="rounded-lg border border-[var(--border-glass)] bg-white/5 text-[var(--white)] px-2 py-1.5 text-sm text-center"
                              placeholder="Unit"
                            />
                            <input
                              value={editState.unit_price}
                              onChange={(e) => setEditState({ ...editState, unit_price: e.target.value })}
                              type="number"
                              step="0.01"
                              className="rounded-lg border border-[var(--border-glass)] bg-white/5 text-[var(--white)] px-2 py-1.5 text-sm text-right"
                              placeholder="Price"
                            />
                          </div>
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => setEditingId(null)}
                              className="px-3 py-1.5 text-xs font-medium text-[var(--gray)] bg-white/[0.06] hover:bg-white/[0.04] rounded-lg transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleAction(item.id, "corrected", editState)}
                              disabled={isBusy}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
                            >
                              {isBusy ? "Saving..." : "Save Correction"}
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={item.id}
                        className={`grid grid-cols-[1fr_70px_50px_80px_80px_160px] gap-2 px-5 py-2.5 border-t border-white/[0.04] items-center text-sm min-w-[640px] ${
                          isRemoved ? "opacity-50 bg-red-50/30" : item.feedback_status === "approved" ? "bg-green-50/20" : item.feedback_status === "corrected" ? "bg-blue-50/20" : ""
                        }`}
                      >
                        <span className={`text-[var(--gray)] ${isRemoved ? "line-through" : ""}`}>
                          {item.description}
                          {item.source === "user_added" && (
                            <span className="ml-1.5 text-[10px] font-semibold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded-full">ADDED</span>
                          )}
                        </span>
                        <span className={`text-right text-[var(--gray)] ${isRemoved ? "line-through" : ""}`}>{item.qty}</span>
                        <span className={`text-center text-[var(--gray-dim)] text-xs ${isRemoved ? "line-through" : ""}`}>{item.unit}</span>
                        <span className={`text-right text-[var(--gray)] ${isRemoved ? "line-through" : ""}`}>${item.unit_price.toFixed(2)}</span>
                        <span className={`text-right font-medium text-[var(--gray)] ${isRemoved ? "line-through" : ""}`}>${total.toLocaleString()}</span>
                        <div className="flex justify-center gap-1.5">
                          {isRemoved ? (
                            <button
                              onClick={() => handleAction(item.id, "approved")}
                              disabled={isBusy}
                              className="px-2.5 py-1 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg border border-green-200 transition-colors disabled:opacity-50"
                            >
                              Restore
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => handleAction(item.id, "approved")}
                                disabled={isBusy || item.feedback_status === "approved"}
                                className={`px-2 py-1 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50 ${
                                  item.feedback_status === "approved"
                                    ? "text-green-700 bg-green-100 border-green-300"
                                    : "text-green-700 bg-green-50 hover:bg-green-100 border-green-200"
                                }`}
                              >
                                {item.feedback_status === "approved" ? "OK" : "Approve"}
                              </button>
                              <button
                                onClick={() => startEdit(item)}
                                disabled={isBusy}
                                className="px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors disabled:opacity-50"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleAction(item.id, "removed")}
                                disabled={isBusy}
                                className="px-2 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg border border-red-200 transition-colors disabled:opacity-50"
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Add item form */}
                  {showAddForm === cat ? (
                    <div className="px-5 py-3 border-t border-white/[0.04] bg-purple-50/30 min-w-[640px]">
                      <div className="grid grid-cols-[1fr_70px_50px_80px] gap-2 mb-3">
                        <input
                          value={newItem.description}
                          onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                          className="rounded-lg border border-[var(--border-glass)] px-2 py-1.5 text-sm"
                          placeholder="Description"
                        />
                        <input
                          value={newItem.qty}
                          onChange={(e) => setNewItem({ ...newItem, qty: e.target.value })}
                          type="number"
                          step="0.01"
                          className="rounded-lg border border-[var(--border-glass)] px-2 py-1.5 text-sm text-right"
                          placeholder="Qty"
                        />
                        <input
                          value={newItem.unit}
                          onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                          className="rounded-lg border border-[var(--border-glass)] px-2 py-1.5 text-sm text-center"
                          placeholder="Unit"
                        />
                        <input
                          value={newItem.unit_price}
                          onChange={(e) => setNewItem({ ...newItem, unit_price: e.target.value })}
                          type="number"
                          step="0.01"
                          className="rounded-lg border border-[var(--border-glass)] px-2 py-1.5 text-sm text-right"
                          placeholder="Price"
                        />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => { setShowAddForm(null); setNewItem({ description: "", qty: "", unit: "EA", unit_price: "" }); }}
                          className="px-3 py-1.5 text-xs font-medium text-[var(--gray)] bg-white/[0.06] hover:bg-white/[0.04] rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleAddItem(cat)}
                          disabled={submitting === "add"}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {submitting === "add" ? "Adding..." : "Add Item"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowAddForm(cat)}
                      className="w-full px-5 py-2.5 border-t border-white/[0.04] text-xs font-medium text-purple-600 hover:bg-purple-50 transition-colors text-left"
                    >
                      + Add Item
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Action buttons */}
        <div className="flex flex-col items-center gap-3 pt-4">
          {claimId && (
            <a
              href={`/dashboard/claim/${claimId}`}
              className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-8 py-3 rounded-xl font-semibold transition-colors inline-block"
            >
              Review All Changes
            </a>
          )}
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="text-sm text-[var(--gray-muted)] hover:text-[var(--white)] font-medium transition-colors disabled:opacity-50"
          >
            {regenerating ? "Resubmitting..." : "Resubmit Now"}
          </button>
        </div>

        {/* Back link */}
        <div className="text-center pb-8">
          <a href="/dashboard" className="text-sm text-[var(--gray-muted)] hover:text-[var(--white)]">Back to Dashboard</a>
        </div>
      </div>
    </main>
  );
}
