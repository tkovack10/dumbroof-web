"use client";

import { useState, useEffect, useCallback } from "react";
import type { InstallSupplement } from "@/types/install-supplement";
import { INSTALL_SUPPLEMENT_CATALOG, CATALOG_CATEGORIES } from "@/lib/install-supplement-catalog";
import { FileUploadZone } from "@/components/file-upload-zone";
import { directUpload } from "@/lib/upload-utils";
import { CrmImportModal } from "@/components/crm-import-modal";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface Props {
  claimId: string;
  claimAddress: string;
  carrierName: string;
  userId: string;
  filePath: string;
  claimNumber?: string;
  adjusterEmail?: string;
}

export function InstallSupplementBuilder({ claimId, claimAddress, carrierName, userId, filePath, claimNumber, adjusterEmail }: Props) {
  const [items, setItems] = useState<InstallSupplement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogFilter, setCatalogFilter] = useState("ALL");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState({ qty: "", unit_price: "", reason: "" });
  const [submitting, setSubmitting] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customItem, setCustomItem] = useState({ description: "", category: "ROOFING", qty: "1", unit: "EA", unit_price: "", reason: "" });
  const [uploadingPhotos, setUploadingPhotos] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File[]>>({});
  const [carrierEmail, setCarrierEmail] = useState(adjusterEmail || "");
  const [showCrmModal, setShowCrmModal] = useState(false);
  const [crmIntegrations, setCrmIntegrations] = useState<{ acculynx: boolean; companycam: boolean }>({ acculynx: false, companycam: false });
  const [claimNum, setClaimNum] = useState(claimNumber || "");
  const [importedPhotoPaths, setImportedPhotoPaths] = useState<string[]>([]);

  const uploadFile = async (file: File, folder: string): Promise<string> => {
    const res = await fetch("/api/storage/sign-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, fileName: file.name, claimPath: filePath }),
    });
    const { signedUrl, path } = await res.json();
    if (!res.ok) throw new Error("Failed to get signed upload URL");
    await directUpload(signedUrl, file);
    return path;
  };

  const uploadPhotosForItem = async (itemId: string) => {
    const files = pendingFiles[itemId];
    if (!files || files.length === 0) return;
    setUploadingPhotos(itemId);
    try {
      const item = items.find((i) => i.id === itemId);
      const existingPaths = item?.photo_paths || [];
      const newPaths: string[] = [];
      for (const file of files) {
        const path = await uploadFile(file, "install-photos");
        newPaths.push(path);
      }
      const allPaths = [...existingPaths, ...newPaths];
      await fetch("/api/install-supplements", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: itemId, photo_paths: allPaths }),
      });
      setPendingFiles((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      await fetchItems();
    } catch {
      /* ignore */
    }
    setUploadingPhotos(null);
  };

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch(`/api/install-supplements?claim_id=${claimId}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items);
        setTotal(data.total);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [claimId]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/integrations/status?user_id=${userId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setCrmIntegrations({ acculynx: !!data.acculynx, companycam: !!data.companycam }); })
      .catch(() => {});
  }, [userId]);

  const addFromCatalog = async (code: string) => {
    const catalogItem = INSTALL_SUPPLEMENT_CATALOG.find((c) => c.code === code);
    if (!catalogItem) return;

    const res = await fetch("/api/install-supplements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claim_id: claimId,
        description: catalogItem.description,
        xactimate_code: catalogItem.code,
        category: catalogItem.category,
        qty: 1,
        unit: catalogItem.default_unit,
        unit_price: catalogItem.default_unit_price,
        reason: catalogItem.typical_reason,
        building_code: catalogItem.building_code,
      }),
    });

    if (res.ok) {
      await fetchItems();
      setCatalogOpen(false);
    }
  };

  const addCustom = async () => {
    if (!customItem.description || !customItem.unit_price) return;
    const res = await fetch("/api/install-supplements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claim_id: claimId,
        description: customItem.description,
        category: customItem.category,
        qty: parseFloat(customItem.qty) || 1,
        unit: customItem.unit,
        unit_price: parseFloat(customItem.unit_price) || 0,
        reason: customItem.reason || null,
      }),
    });

    if (res.ok) {
      await fetchItems();
      setShowCustomForm(false);
      setCustomItem({ description: "", category: "ROOFING", qty: "1", unit: "EA", unit_price: "", reason: "" });
    }
  };

  const updateItem = async (id: string) => {
    const updates: Record<string, unknown> = { id };
    if (editState.qty) updates.qty = parseFloat(editState.qty);
    if (editState.unit_price) updates.unit_price = parseFloat(editState.unit_price);
    if (editState.reason !== undefined) updates.reason = editState.reason;

    const res = await fetch("/api/install-supplements", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    if (res.ok) {
      await fetchItems();
      setEditingId(null);
    }
  };

  const deleteItem = async (id: string) => {
    const res = await fetch(`/api/install-supplements?id=${id}`, { method: "DELETE" });
    if (res.ok) await fetchItems();
  };

  const draftItems = items.filter((i) => i.status === "draft");
  const submittedItems = items.filter((i) => i.status !== "draft");

  const filteredCatalog = catalogFilter === "ALL"
    ? INSTALL_SUPPLEMENT_CATALOG
    : INSTALL_SUPPLEMENT_CATALOG.filter((c) => c.category === catalogFilter);

  // Don't render anything while loading
  if (loading) return (
    <div className="glass-card p-6 animate-pulse">
      <div className="h-5 w-48 bg-white/5 rounded" />
    </div>
  );

  return (
    <div className="glass-card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-6 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.384-3.19c-.196-.116-.196-.393 0-.509l5.384-3.19a.689.689 0 01.718 0l5.384 3.19c.196.116.196.393 0 .509l-5.384 3.19a.689.689 0 01-.718 0zM11.42 19.17l-5.384-3.19c-.196-.116-.196-.393 0-.509l5.384-3.19a.689.689 0 01.718 0l5.384 3.19c.196.116.196.393 0 .509l-5.384 3.19a.689.689 0 01-.718 0z" />
            </svg>
          </div>
          <div className="text-left">
            <h3 className="text-lg font-bold text-[var(--white)]">Install Supplements</h3>
            <p className="text-xs text-[var(--gray-muted)]">
              Items discovered during installation that need to be supplemented
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {items.length > 0 && (
            <span className="text-sm font-semibold text-orange-400">
              {items.length} item{items.length !== 1 ? "s" : ""} &middot; ${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          )}
          <svg className={`w-5 h-5 text-[var(--gray-muted)] transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-4 sm:px-6 pb-6 border-t border-white/[0.06]">
          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-3 mt-4 mb-4">
            <button
              onClick={() => { setCatalogOpen(!catalogOpen); setShowCustomForm(false); }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500/10 text-orange-400 text-sm font-semibold hover:bg-orange-500/20 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add from Catalog
            </button>
            <button
              onClick={() => { setShowCustomForm(!showCustomForm); setCatalogOpen(false); }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 text-[var(--gray)] text-sm font-semibold hover:bg-white/10 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
              </svg>
              Custom Item
            </button>
            {(crmIntegrations.acculynx || crmIntegrations.companycam) && (
              <button
                onClick={() => setShowCrmModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--cyan)]/10 text-[var(--cyan)] text-sm font-semibold hover:bg-[var(--cyan)]/20 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                Import from CRM
              </button>
            )}
          </div>

          {/* Catalog browser */}
          {catalogOpen && (
            <div className="mb-4 rounded-xl bg-white/[0.03] border border-white/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-orange-400">Common Install Supplements</p>
                <div className="flex-1" />
                {/* Category filter */}
                <select
                  value={catalogFilter}
                  onChange={(e) => setCatalogFilter(e.target.value)}
                  className="text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[var(--gray)]"
                >
                  <option value="ALL">All Categories</option>
                  {CATALOG_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2 max-h-48 sm:max-h-64 lg:max-h-96 overflow-y-auto">
                {filteredCatalog.map((item) => (
                  <div
                    key={item.code}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[var(--white)]">{item.description}</p>
                      <p className="text-xs text-[var(--gray-muted)] mt-0.5">{item.typical_reason}</p>
                      {item.building_code && (
                        <p className="text-[10px] text-[var(--cyan)] mt-0.5 font-mono">{item.building_code}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-[var(--gray-muted)]">
                        ${item.default_unit_price.toFixed(2)}/{item.default_unit}
                      </p>
                    </div>
                    <button
                      onClick={() => addFromCatalog(item.code)}
                      className="shrink-0 w-8 h-8 rounded-lg bg-orange-500/10 text-orange-400 flex items-center justify-center hover:bg-orange-500/20 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Custom item form */}
          {showCustomForm && (
            <div className="mb-4 rounded-xl bg-white/[0.03] border border-white/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-muted)] mb-3">Add Custom Item</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <input
                  placeholder="Description"
                  value={customItem.description}
                  onChange={(e) => setCustomItem({ ...customItem, description: e.target.value })}
                  className="sm:col-span-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                />
                <input
                  placeholder="Qty"
                  type="number"
                  value={customItem.qty}
                  onChange={(e) => setCustomItem({ ...customItem, qty: e.target.value })}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                />
                <input
                  placeholder="Unit Price"
                  type="number"
                  step="0.01"
                  value={customItem.unit_price}
                  onChange={(e) => setCustomItem({ ...customItem, unit_price: e.target.value })}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                />
                <select
                  value={customItem.unit}
                  onChange={(e) => setCustomItem({ ...customItem, unit: e.target.value })}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--gray)]"
                >
                  {["EA", "SF", "SQ", "LF", "HR"].map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
                <select
                  value={customItem.category}
                  onChange={(e) => setCustomItem({ ...customItem, category: e.target.value })}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--gray)]"
                >
                  {["ROOFING", "SIDING", "GUTTERS", "INTERIOR", "GENERAL"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <input
                  placeholder="Reason (e.g., 3 layers found during tear-off)"
                  value={customItem.reason}
                  onChange={(e) => setCustomItem({ ...customItem, reason: e.target.value })}
                  className="sm:col-span-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                />
              </div>
              <button
                onClick={addCustom}
                disabled={!customItem.description || !customItem.unit_price}
                className="px-4 py-2 rounded-lg bg-orange-500/10 text-orange-400 text-sm font-semibold hover:bg-orange-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Add Item
              </button>
            </div>
          )}

          {/* Draft items list */}
          {draftItems.length > 0 && (
            <div className="space-y-2 mb-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-muted)]">
                Draft Items ({draftItems.length})
              </p>
              {draftItems.map((item) => (
                <div key={item.id} className="rounded-xl bg-white/[0.03] border border-white/10 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-[var(--white)]">{item.description}</p>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 font-semibold">DRAFT</span>
                      </div>
                      {item.reason && (
                        <p className="text-xs text-[var(--gray-muted)] mt-1">{item.reason}</p>
                      )}
                      {item.building_code && (
                        <p className="text-[10px] text-[var(--cyan)] mt-1 font-mono">{item.building_code}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      {editingId === item.id ? (
                        <div className="space-y-1">
                          <input
                            type="number"
                            value={editState.qty}
                            onChange={(e) => setEditState({ ...editState, qty: e.target.value })}
                            className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-[var(--white)] text-right"
                            placeholder="Qty"
                          />
                          <input
                            type="number"
                            step="0.01"
                            value={editState.unit_price}
                            onChange={(e) => setEditState({ ...editState, unit_price: e.target.value })}
                            className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-[var(--white)] text-right"
                            placeholder="Price"
                          />
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => updateItem(item.id)} className="text-[10px] text-green-400 hover:text-green-300">Save</button>
                            <button onClick={() => setEditingId(null)} className="text-[10px] text-[var(--gray-muted)] hover:text-[var(--white)]">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-[var(--white)]">
                            ${(item.qty * item.unit_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </p>
                          <p className="text-[10px] text-[var(--gray-muted)]">
                            {item.qty} {item.unit} × ${item.unit_price.toFixed(2)}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  {/* Photo evidence */}
                  <div className="mt-3 space-y-2">
                    {(item.photo_paths || []).length > 0 && (
                      <span className="text-[10px] text-green-400 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        {item.photo_paths.length} photo{item.photo_paths.length !== 1 ? "s" : ""} attached
                      </span>
                    )}
                    <div className="rounded-lg border border-white/[0.06] p-2">
                      <FileUploadZone
                        label="Evidence Photos"
                        description="Attach photos showing the issue discovered during install"
                        accept="image/*,.heic,.heif"
                        multiple
                        files={pendingFiles[item.id] || []}
                        onFilesChange={(files) => setPendingFiles((prev) => ({ ...prev, [item.id]: files }))}
                      />
                      {(pendingFiles[item.id]?.length ?? 0) > 0 && (
                        <button
                          onClick={() => uploadPhotosForItem(item.id)}
                          disabled={uploadingPhotos === item.id}
                          className="mt-2 px-3 py-1.5 rounded-lg bg-orange-500/10 text-orange-400 text-xs font-semibold hover:bg-orange-500/20 transition-colors disabled:opacity-50"
                        >
                          {uploadingPhotos === item.id
                            ? `Uploading ${pendingFiles[item.id]?.length} photo${(pendingFiles[item.id]?.length ?? 0) !== 1 ? "s" : ""}...`
                            : `Upload ${pendingFiles[item.id]?.length} Photo${(pendingFiles[item.id]?.length ?? 0) !== 1 ? "s" : ""}`}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1" />
                      {editingId !== item.id && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setEditingId(item.id);
                              setEditState({
                                qty: String(item.qty),
                                unit_price: String(item.unit_price),
                                reason: item.reason || "",
                              });
                            }}
                            className="text-[10px] text-[var(--gray-muted)] hover:text-[var(--white)]"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteItem(item.id)}
                            className="text-[10px] text-red-400 hover:text-red-300"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Submitted items */}
          {submittedItems.length > 0 && (
            <div className="space-y-2 mb-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-muted)]">
                Submitted ({submittedItems.length})
              </p>
              {submittedItems.map((item) => (
                <div key={item.id} className="rounded-xl bg-white/[0.03] border border-white/10 p-4 opacity-70">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-[var(--gray)]">{item.description}</p>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 font-semibold uppercase">
                        {item.status}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--gray)]">
                      ${(item.qty * item.unit_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {items.length === 0 && !catalogOpen && !showCustomForm && (
            <div className="text-center py-8">
              <p className="text-sm text-[var(--gray-muted)]">No install supplements yet.</p>
              <p className="text-xs text-[var(--gray-dim)] mt-1">
                Add items discovered during installation &mdash; plywood, extra layers, hidden damage, etc.
              </p>
            </div>
          )}

          {/* Submit bar */}
          {draftItems.length > 0 && (
            <div className="p-4 rounded-xl bg-orange-500/[0.06] border border-orange-500/20 space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-[var(--white)]">
                    {draftItems.length} item{draftItems.length !== 1 ? "s" : ""} ready to submit
                  </p>
                  <p className="text-xs text-[var(--gray-muted)]">
                    Total: ${draftItems.reduce((s, i) => s + i.qty * i.unit_price, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--gray-muted)] block mb-1">
                  Claim Number
                </label>
                <input
                  placeholder="Auto-populated from claim"
                  value={claimNum}
                  onChange={(e) => setClaimNum(e.target.value)}
                  className="w-full sm:w-48 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--gray-muted)] block mb-1">
                  Carrier / Adjuster Email
                </label>
                <input
                  placeholder="adjuster@carrier.com"
                  value={carrierEmail}
                  onChange={(e) => setCarrierEmail(e.target.value)}
                  className="w-full sm:w-72 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                />
              </div>
              {importedPhotoPaths.length > 0 && (
                <p className="text-[10px] text-[var(--cyan)] flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {importedPhotoPaths.length} CRM photo{importedPhotoPaths.length !== 1 ? "s" : ""} will be attached to email
                </p>
              )}
              <button
                onClick={async () => {
                  setSubmitting(true);
                  try {
                    // Mark all draft items as submitted
                    for (const item of draftItems) {
                      await fetch("/api/install-supplements", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id: item.id, status: "submitted" }),
                      });
                    }
                    // Send email to carrier if address provided
                    if (carrierEmail) {
                      if (!claimNum?.trim()) {
                        alert("Claim number is required before sending to carrier. Carriers auto-reject emails without a claim number in the subject.");
                        setSubmitting(false);
                        return;
                      }
                      const allPhotoPaths = [...draftItems.flatMap((i) => i.photo_paths || []), ...importedPhotoPaths];
                      const itemLines = draftItems.map(
                        (i) => `<tr><td style="padding:4px 8px;border:1px solid #ddd;">${i.description}</td><td style="padding:4px 8px;border:1px solid #ddd;">${i.qty} ${i.unit}</td><td style="padding:4px 8px;border:1px solid #ddd;">$${(i.qty * i.unit_price).toFixed(2)}</td><td style="padding:4px 8px;border:1px solid #ddd;">${i.reason || ""}</td></tr>`
                      ).join("");
                      const emailBody = `<p>Please find the install supplement for <strong>${claimAddress}</strong>.</p><table style="border-collapse:collapse;width:100%;margin:16px 0;"><thead><tr><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Description</th><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Qty</th><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Total</th><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Reason</th></tr></thead><tbody>${itemLines}</tbody></table><p><strong>Total: $${draftItems.reduce((s, i) => s + i.qty * i.unit_price, 0).toFixed(2)}</strong></p>${allPhotoPaths.length > 0 ? `<p>${allPhotoPaths.length} evidence photo${allPhotoPaths.length !== 1 ? "s" : ""} attached.</p>` : ""}`;
                      await fetch(`${BACKEND_URL}/api/supplement-email/send`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          claim_id: claimId,
                          to_email: carrierEmail,
                          subject: claimNum.trim(),
                          body_html: emailBody,
                          attachment_paths: allPhotoPaths,
                          email_type: "install_supplement",
                        }),
                      });
                    }
                    await fetchItems();
                    setImportedPhotoPaths([]);
                  } catch {
                    /* ignore */
                  }
                  setSubmitting(false);
                }}
                disabled={submitting}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-white text-sm font-semibold hover:shadow-lg hover:shadow-orange-500/20 transition-all disabled:opacity-50"
              >
                {submitting ? "Submitting..." : carrierEmail ? "Submit & Email to Carrier" : "Submit to Carrier"}
              </button>
            </div>
          )}
        </div>
      )}

      <CrmImportModal
        open={showCrmModal}
        onClose={() => setShowCrmModal(false)}
        integrations={crmIntegrations}
        backendUrl={BACKEND_URL}
        userId={userId}
        targetPath={filePath}
        targetFolder="install-photos"
        onImport={() => {}}
        onPhotoPaths={async (paths) => {
          // Store imported paths for email attachments
          if (paths && paths.length > 0) {
            setImportedPhotoPaths(prev => [...prev, ...paths]);
          }
          await fetchItems();
        }}
      />
    </div>
  );
}
