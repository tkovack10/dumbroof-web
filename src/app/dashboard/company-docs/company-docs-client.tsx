"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

interface CompanyDoc {
  id: string;
  name: string;
  category: string;
  storage_path: string;
  file_size: number | null;
  mime_type: string | null;
  description: string | null;
  send_to: string[];
  homeowner_sequence_eligible: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  general: "General",
  sample_book: "Sample Book",
  brochure: "Brochure",
  spec_sheet: "Spec Sheet",
  warranty: "Warranty",
  license_insurance: "License & Insurance",
  marketing: "Marketing",
  testimonial: "Testimonial",
  process: "Process / Workflow",
};

const SEND_TO_LABELS: Record<string, string> = {
  customer: "Customer",
  lead: "Lead",
  insurance: "Insurance",
  homeowner: "Homeowner Engagement",
};

function fmtBytes(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function CompanyDocsClient() {
  const [docs, setDocs] = useState<CompanyDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/company-docs");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load");
        return;
      }
      setDocs(data.docs || []);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    setUploadProgress(`Preparing ${file.name}…`);
    try {
      // 1. Get a signed upload URL from our API
      const urlRes = await fetch("/api/company-docs/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          content_type: file.type,
          size: file.size,
        }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok) {
        setError(urlData.error || "Upload-URL request failed");
        return;
      }

      // 2. PUT the file directly to Supabase Storage — bypasses Vercel body limit
      setUploadProgress(`Uploading ${file.name}…`);
      const putRes = await fetch(urlData.upload_url, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });
      if (!putRes.ok) {
        setError(`Storage upload failed (${putRes.status})`);
        return;
      }

      // 3. Register the metadata row pointing at the uploaded path
      setUploadProgress("Saving record…");
      const regRes = await fetch("/api/company-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          storage_path: urlData.storage_path,
          file_size: file.size,
          mime_type: file.type || null,
        }),
      });
      const regData = await regRes.json();
      if (!regRes.ok) {
        setError(regData.error || "Record save failed");
        return;
      }
      // Optimistic prepend
      setDocs((prev) => [regData.doc, ...prev]);
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    try {
      const res = await fetch(`/api/company-docs/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Delete failed");
        return;
      }
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      alert(String(err));
    }
  }

  async function handleUpdate(id: string, patch: Partial<CompanyDoc>) {
    try {
      const res = await fetch(`/api/company-docs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Update failed");
        return;
      }
      setDocs((prev) => prev.map((d) => (d.id === id ? data.doc : d)));
    } catch (err) {
      alert(String(err));
    }
  }

  async function handleView(id: string) {
    try {
      const res = await fetch(`/api/company-docs/${id}`);
      const data = await res.json();
      if (data?.signed_url) {
        window.open(data.signed_url, "_blank");
      } else {
        alert(data?.error || "Could not generate view URL");
      }
    } catch (err) {
      alert(String(err));
    }
  }

  const filtered = useMemo(() => {
    if (categoryFilter === "all") return docs;
    return docs.filter((d) => d.category === categoryFilter);
  }, [docs, categoryFilter]);

  const stats = useMemo(() => {
    const total = docs.length;
    const eligible = docs.filter((d) => d.homeowner_sequence_eligible).length;
    const totalBytes = docs.reduce((acc, d) => acc + (d.file_size || 0), 0);
    return { total, eligible, totalBytes };
  }, [docs]);

  return (
    <div className="p-6 lg:p-8 min-h-screen">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 pl-10 lg:pl-0">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--gray-muted)] hover:text-white mb-3 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold gradient-text">Company Docs</h1>
          <p className="text-[var(--gray-muted)] mt-1 text-sm">
            Upload PDFs, sample books, brochures, license &amp; insurance, marketing materials.
            Attach them to customer/lead/insurance sends or include them in the homeowner
            engagement sequence.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <div className="glass-card p-4">
            <p className="text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">Total Docs</p>
            <p className="text-3xl font-bold text-[var(--white)]">{stats.total}</p>
          </div>
          <div className="glass-card p-4">
            <p className="text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">
              Homeowner-Sequence Eligible
            </p>
            <p className="text-3xl font-bold text-[var(--cyan)]">{stats.eligible}</p>
          </div>
          <div className="glass-card p-4">
            <p className="text-[10px] uppercase tracking-wider text-[var(--gray-muted)]">Storage Used</p>
            <p className="text-3xl font-bold text-[var(--white)] font-mono">
              {fmtBytes(stats.totalBytes)}
            </p>
          </div>
        </div>

        <div className="glass-card p-5 mb-5 flex items-center gap-4 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp,.doc,.docx"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) handleUpload(f);
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-wait"
          >
            {uploading ? uploadProgress || "Uploading…" : "+ Upload Document"}
          </button>
          <p className="text-xs text-[var(--gray-muted)]">
            PDF / image / Word — 50 MB max per file. Direct-to-storage upload (bypasses 4.5MB API limit).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button
            type="button"
            onClick={() => setCategoryFilter("all")}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              categoryFilter === "all"
                ? "bg-[var(--cyan)]/[0.15] border-[var(--cyan)] text-[var(--cyan)]"
                : "bg-white/[0.03] border-white/10 text-[var(--gray)] hover:text-[var(--white)] hover:border-white/30"
            }`}
          >
            All ({docs.length})
          </button>
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
            const count = docs.filter((d) => d.category === key).length;
            if (count === 0 && categoryFilter !== key) return null;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setCategoryFilter(key)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  categoryFilter === key
                    ? "bg-[var(--cyan)]/[0.15] border-[var(--cyan)] text-[var(--cyan)]"
                    : "bg-white/[0.03] border-white/10 text-[var(--gray)] hover:text-[var(--white)] hover:border-white/30"
                }`}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">
            {error}
          </div>
        )}

        <div className="glass-card overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-sm text-[var(--gray-muted)]">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm text-[var(--gray-muted)]">
                {docs.length === 0
                  ? "No company documents yet. Click + Upload Document to add your first."
                  : `No documents in "${CATEGORY_LABELS[categoryFilter] || categoryFilter}" yet.`}
              </p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--gray-muted)] border-b border-white/[0.06]">
                  <th className="px-4 py-3 font-semibold">Document</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Send To</th>
                  <th className="px-4 py-3 font-semibold">In Sequence</th>
                  <th className="px-4 py-3 font-semibold text-right">Size</th>
                  <th className="px-4 py-3 font-semibold">Added</th>
                  <th className="px-4 py-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.id} className="border-t border-white/[0.04] hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      <p className="text-[var(--white)] font-medium truncate max-w-xs" title={d.name}>
                        {d.name}
                      </p>
                      {d.description && (
                        <p className="text-[10px] text-[var(--gray-dim)] truncate max-w-xs">
                          {d.description}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={d.category}
                        onChange={(e) => handleUpdate(d.id, { category: e.target.value })}
                        className="bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[11px] text-[var(--white)] focus:outline-none focus:border-[var(--cyan)]"
                      >
                        {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(SEND_TO_LABELS).map(([key, label]) => {
                          const active = (d.send_to || []).includes(key);
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => {
                                const next = active
                                  ? d.send_to.filter((x) => x !== key)
                                  : [...d.send_to, key];
                                handleUpdate(d.id, { send_to: next });
                              }}
                              className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                                active
                                  ? "bg-[var(--cyan)]/[0.12] border-[var(--cyan)]/40 text-[var(--cyan)]"
                                  : "bg-white/[0.03] border-white/10 text-[var(--gray-dim)] hover:text-white"
                              }`}
                              title={label}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <label className="inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={d.homeowner_sequence_eligible}
                          onChange={(e) =>
                            handleUpdate(d.id, { homeowner_sequence_eligible: e.target.checked })
                          }
                          className="accent-[var(--cyan)]"
                        />
                      </label>
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--gray)] font-mono whitespace-nowrap">
                      {fmtBytes(d.file_size)}
                    </td>
                    <td className="px-4 py-3 text-[var(--gray-dim)] whitespace-nowrap">
                      {fmtDate(d.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleView(d.id)}
                        className="text-[10px] text-[var(--cyan)] hover:text-white px-2"
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(d.id, d.name)}
                        className="text-[10px] text-red-400/70 hover:text-red-400 px-2"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
