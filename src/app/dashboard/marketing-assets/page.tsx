"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Asset = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string | null;
  manufacturer: string | null;
  file_path: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  active: boolean;
  sort_order: number | null;
  created_at: string;
  preview_url: string | null;
  is_global: boolean;
  company_id: string | null;
};

function fmtBytes(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export default function MarketingAssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const r = await fetch("/api/admin/marketing-assets");
    if (!r.ok) { setError(`Load failed: HTTP ${r.status}`); setLoading(false); return; }
    const j = await r.json();
    setAssets(j.assets || []);
    setIsAdmin(!!j.caller_is_admin);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        // 1. Get signed upload URL
        const signR = await fetch("/api/admin/marketing-assets/sign-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, fileSize: file.size }),
        });
        if (!signR.ok) {
          const j = await signR.json().catch(() => ({}));
          throw new Error(`Sign upload: ${j.error || signR.status}`);
        }
        const sign = await signR.json();

        // 2. Upload bytes directly to Supabase storage
        const upR = await fetch(sign.signedUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!upR.ok) throw new Error(`Upload to storage: HTTP ${upR.status}`);

        // 3. Register row
        const baseTitle = file.name.replace(/\.[^.]+$/, "");
        const regR = await fetch("/api/admin/marketing-assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug: slugify(baseTitle) + "-" + Date.now().toString(36),
            title: baseTitle,
            file_path: sign.path,
            file_size_bytes: file.size,
            mime_type: file.type || null,
          }),
        });
        if (!regR.ok) {
          const j = await regR.json().catch(() => ({}));
          throw new Error(`Register asset: ${j.error || regR.status}`);
        }
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function updateField(id: string, patch: Partial<Asset>) {
    const r = await fetch(`/api/admin/marketing-assets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(`Update: ${j.error || r.status}`);
      return;
    }
    await refresh();
  }

  async function archive(id: string) {
    if (!confirm("Archive this asset? It will no longer attach to new emails. Existing template references stay intact.")) return;
    const r = await fetch(`/api/admin/marketing-assets/${id}`, { method: "DELETE" });
    if (!r.ok) { setError(`Archive failed: HTTP ${r.status}`); return; }
    await refresh();
  }

  if (loading) return <main className="min-h-screen bg-white/[0.04] flex items-center justify-center"><p className="text-[var(--gray-dim)]">Loading…</p></main>;

  const active = assets.filter(a => a.active);
  const archived = assets.filter(a => !a.active);

  return (
    <main className="min-h-screen bg-white/[0.04] p-6 md:p-10 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Marketing Assets</h1>
          <p className="text-sm text-[var(--gray-dim)] mt-1">PDFs and images you attach to homeowner engagement emails.</p>
        </div>
        <div className="flex gap-2">
          <a href="/dashboard/email-templates" className="px-3 py-2 rounded-lg border border-[var(--border-glass)] text-sm hover:bg-white/[0.06]">Templates →</a>
          <a href="/dashboard" className="px-3 py-2 rounded-lg border border-[var(--border-glass)] text-sm hover:bg-white/[0.06]">Dashboard</a>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {isAdmin ? (
        <div
          onDragOver={e => { e.preventDefault(); }}
          onDrop={e => { e.preventDefault(); handleUpload(e.dataTransfer.files); }}
          className="mb-8 p-8 rounded-xl border-2 border-dashed border-[var(--border-glass)] hover:border-[var(--cyan)] transition-colors text-center"
        >
          <p className="mb-3 text-[var(--gray-dim)]">
            {uploading ? "Uploading…" : "Drag files here, or"}
          </p>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Choose Files
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,image/*"
            className="hidden"
            onChange={e => handleUpload(e.target.files)}
          />
          <p className="mt-2 text-xs text-[var(--gray-muted)]">PDFs, images. Uploaded direct to Supabase storage (no Vercel size limit).</p>
        </div>
      ) : (
        <div className="mb-8 p-4 rounded-xl border border-[var(--border-glass)] bg-white/[0.02] text-sm text-[var(--gray-dim)]">
          Browse the library below. Only admins can upload new assets.
        </div>
      )}

      {active.length === 0 ? (
        <div className="p-8 text-center text-[var(--gray-dim)] border border-dashed border-[var(--border-glass)] rounded-xl">
          No assets yet. Upload your sample books, color guides, before/after galleries.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {active.map(a => (
            <div key={a.id} className="bg-white/[0.04] border border-[var(--border-glass)] rounded-xl p-4 flex flex-col">
              {a.preview_url && a.mime_type?.startsWith("image/") ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={a.preview_url} alt={a.title} className="w-full h-32 object-cover rounded mb-3" />
              ) : (
                <div className="w-full h-32 rounded mb-3 bg-white/[0.03] flex items-center justify-center text-3xl">📄</div>
              )}
              <input
                value={a.title}
                readOnly={!isAdmin || a.is_global}
                onChange={e => setAssets(prev => prev.map(x => x.id === a.id ? { ...x, title: e.target.value } : x))}
                onBlur={e => { if (isAdmin && !a.is_global && e.target.value !== a.title) updateField(a.id, { title: e.target.value }); }}
                className="bg-transparent border-0 text-sm font-semibold mb-1 focus:outline-none focus:bg-white/[0.06] rounded px-1 read-only:focus:bg-transparent"
              />
              <input
                value={a.slug}
                readOnly={!isAdmin || a.is_global}
                onChange={e => setAssets(prev => prev.map(x => x.id === a.id ? { ...x, slug: e.target.value } : x))}
                onBlur={e => { if (isAdmin && !a.is_global && e.target.value !== a.slug) updateField(a.id, { slug: e.target.value }); }}
                className="bg-transparent border-0 text-xs text-[var(--gray-dim)] font-mono mb-2 focus:outline-none focus:bg-white/[0.06] rounded px-1 read-only:focus:bg-transparent"
              />
              <div className="flex items-center justify-between text-xs text-[var(--gray-muted)] mt-auto pt-2 border-t border-white/[0.04]">
                <span>{fmtBytes(a.file_size_bytes)} · {a.mime_type || "—"}</span>
                <div className="flex gap-2">
                  {a.preview_url && (
                    <a href={a.preview_url} target="_blank" rel="noopener noreferrer" className="text-[var(--cyan)] hover:underline">View</a>
                  )}
                  {isAdmin && !a.is_global && (
                    <button onClick={() => archive(a.id)} className="text-red-400 hover:underline">Archive</button>
                  )}
                  {a.is_global && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">global</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin && archived.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm text-[var(--gray-dim)]">{archived.length} archived</summary>
          <div className="mt-3 space-y-1 text-sm">
            {archived.map(a => (
              <div key={a.id} className="flex items-center justify-between p-2 rounded bg-white/[0.02]">
                <span className="text-[var(--gray-muted)]">{a.title} <span className="font-mono text-xs">({a.slug})</span></span>
                <button onClick={() => updateField(a.id, { active: true })} className="text-xs text-[var(--cyan)] hover:underline">Restore</button>
              </div>
            ))}
          </div>
        </details>
      )}
    </main>
  );
}
