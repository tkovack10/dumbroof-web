"use client";

import { useCallback, useEffect, useState } from "react";

type Template = {
  id: string;
  slug: string;
  company_id: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  default_attachments: string[] | null;
  trigger_type: string | null;
  trigger_offset_days: number | null;
  trigger_event: string | null;
  active: boolean;
  is_global: boolean;
};

type Asset = {
  id: string;
  slug: string;
  title: string;
  mime_type: string | null;
  active: boolean;
};

export default function EmailTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Template> | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    const [tR, aR] = await Promise.all([
      fetch("/api/admin/email-templates"),
      fetch("/api/admin/marketing-assets"),
    ]);
    if (!tR.ok) { setError(`Templates: HTTP ${tR.status}`); setLoading(false); return; }
    if (!aR.ok) { setError(`Assets: HTTP ${aR.status}`); setLoading(false); return; }
    const tJ = await tR.json();
    const aJ = await aR.json();
    setTemplates(tJ.templates || []);
    setAssets((aJ.assets || []).filter((x: Asset) => x.active));
    setIsAdmin(!!tJ.caller_is_admin);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const selected = templates.find(t => t.id === selectedId) || null;

  useEffect(() => {
    if (selected) setDraft({ ...selected });
    else setDraft(null);
  }, [selectedId, selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!draft || !selected) return;
    setSaving(true);
    setError(null);

    // If user is editing a global template, clone it into a company-specific
    // copy first. Otherwise PATCH the existing company-scoped row.
    try {
      if (selected.is_global) {
        const r = await fetch("/api/admin/email-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clone_from: selected.id,
            slug: draft.slug || selected.slug,
            subject: draft.subject,
            body_text: draft.body_text,
            body_html: draft.body_html,
            trigger_type: draft.trigger_type,
            trigger_offset_days: draft.trigger_offset_days,
            trigger_event: draft.trigger_event,
            default_attachments: draft.default_attachments,
            active: draft.active,
          }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(`Clone: ${j.error || r.status}`);
        }
        const j = await r.json();
        await refresh();
        setSelectedId(j.template.id);
      } else {
        const patch = {
          subject: draft.subject,
          body_text: draft.body_text,
          body_html: draft.body_html,
          trigger_type: draft.trigger_type,
          trigger_offset_days: draft.trigger_offset_days,
          trigger_event: draft.trigger_event,
          default_attachments: draft.default_attachments,
          active: draft.active,
          slug: draft.slug,
        };
        const r = await fetch(`/api/admin/email-templates/${selected.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(`Save: ${j.error || r.status}`);
        }
        await refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteOverride() {
    if (!selected || selected.is_global) return;
    if (!confirm(`Delete the company override for "${selected.slug}"? The global template will take effect again.`)) return;
    const r = await fetch(`/api/admin/email-templates/${selected.id}`, { method: "DELETE" });
    if (!r.ok) { setError(`Delete: HTTP ${r.status}`); return; }
    setSelectedId(null);
    await refresh();
  }

  function toggleAttachment(assetId: string) {
    setDraft(prev => {
      if (!prev) return prev;
      const list = (prev.default_attachments || []).slice();
      const idx = list.indexOf(assetId);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(assetId);
      return { ...prev, default_attachments: list };
    });
  }

  if (loading) return <main className="min-h-screen bg-white/[0.04] flex items-center justify-center"><p className="text-[var(--gray-dim)]">Loading…</p></main>;

  return (
    <main className="min-h-screen bg-white/[0.04] p-6 md:p-10 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Homeowner Email Templates</h1>
          <p className="text-sm text-[var(--gray-dim)] mt-1">
            Edit the sequence sent to homeowners after a claim is created. Day offsets are from sequence start.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/dashboard/marketing-assets" className="px-3 py-2 rounded-lg border border-[var(--border-glass)] text-sm hover:bg-white/[0.06]">Assets →</a>
          <a href="/dashboard" className="px-3 py-2 rounded-lg border border-[var(--border-glass)] text-sm hover:bg-white/[0.06]">Dashboard</a>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-6">
        {/* Template list */}
        <div className="bg-white/[0.04] border border-[var(--border-glass)] rounded-xl p-2 max-h-[80vh] overflow-y-auto">
          {templates.length === 0 ? (
            <p className="p-4 text-sm text-[var(--gray-dim)]">No templates.</p>
          ) : templates.map(t => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className={`w-full text-left p-3 rounded-lg mb-1 hover:bg-white/[0.06] transition-colors ${
                selectedId === t.id ? "bg-white/[0.08] ring-1 ring-[var(--cyan)]" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono text-[var(--gray-dim)]">
                  {t.trigger_offset_days != null ? `Day ${t.trigger_offset_days}` : "—"}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${t.is_global ? "bg-amber-500/10 text-amber-400" : "bg-green-500/10 text-green-400"}`}>
                  {t.is_global ? "global" : "company"}
                </span>
                {!t.active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-[var(--gray-muted)]">off</span>}
              </div>
              <div className="text-sm font-medium mt-1">{t.subject || t.slug}</div>
              <div className="text-xs text-[var(--gray-muted)] font-mono mt-0.5">{t.slug}</div>
              {(t.default_attachments?.length || 0) > 0 && (
                <div className="text-[10px] text-[var(--cyan)] mt-1">📎 {t.default_attachments?.length} attached</div>
              )}
            </button>
          ))}
        </div>

        {/* Editor */}
        <div className="bg-white/[0.04] border border-[var(--border-glass)] rounded-xl p-6">
          {!selected || !draft ? (
            <p className="text-[var(--gray-dim)] text-sm">Pick a template to edit.</p>
          ) : (
            <>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">{selected.slug}</h2>
                  <p className="text-xs text-[var(--gray-dim)] mt-1">
                    {!isAdmin
                      ? "Read-only preview — only company admins can edit templates."
                      : selected.is_global
                        ? "Editing a global template — saving will create a company-specific override."
                        : "Editing your company override."}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!draft.active}
                    disabled={!isAdmin}
                    onChange={e => setDraft({ ...draft, active: e.target.checked })}
                  />
                  Active
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <label className="text-xs">
                  <span className="text-[var(--gray-dim)]">Slug</span>
                  <input
                    value={draft.slug || ""}
                    onChange={e => setDraft({ ...draft, slug: e.target.value })}
                    className="mt-1 w-full px-2 py-1.5 rounded bg-white/[0.06] border border-[var(--border-glass)] focus:border-[var(--cyan)] outline-none font-mono text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                    disabled={!isAdmin}
                  />
                </label>
                <label className="text-xs">
                  <span className="text-[var(--gray-dim)]">Day offset (from sequence start)</span>
                  <input
                    type="number"
                    value={draft.trigger_offset_days ?? ""}
                    disabled={!isAdmin}
                    onChange={e => setDraft({ ...draft, trigger_offset_days: e.target.value === "" ? null : Number(e.target.value) })}
                    className="mt-1 w-full px-2 py-1.5 rounded bg-white/[0.06] border border-[var(--border-glass)] focus:border-[var(--cyan)] outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </label>
              </div>

              <label className="block mb-4 text-xs">
                <span className="text-[var(--gray-dim)]">Subject (supports {`{{homeowner_name}} {{address}} {{carrier}} {{claim_number}}`})</span>
                <input
                  value={draft.subject || ""}
                  disabled={!isAdmin}
                  onChange={e => setDraft({ ...draft, subject: e.target.value })}
                  className="mt-1 w-full px-3 py-2 rounded bg-white/[0.06] border border-[var(--border-glass)] focus:border-[var(--cyan)] outline-none text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </label>

              <label className="block mb-4 text-xs">
                <span className="text-[var(--gray-dim)]">Body (plain text)</span>
                <textarea
                  value={draft.body_text || ""}
                  disabled={!isAdmin}
                  onChange={e => setDraft({ ...draft, body_text: e.target.value })}
                  rows={14}
                  className="mt-1 w-full px-3 py-2 rounded bg-white/[0.06] border border-[var(--border-glass)] focus:border-[var(--cyan)] outline-none text-sm font-mono leading-relaxed disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </label>

              <div className="mb-4">
                <p className="text-xs text-[var(--gray-dim)] mb-2">
                  Attachments (sent with this email) — {(draft.default_attachments?.length || 0)} selected
                </p>
                {assets.length === 0 ? (
                  <div className="p-3 rounded border border-dashed border-[var(--border-glass)] text-xs text-[var(--gray-muted)]">
                    No assets yet — <a href="/dashboard/marketing-assets" className="text-[var(--cyan)] underline">upload some</a>.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto p-2 rounded border border-[var(--border-glass)] bg-white/[0.02]">
                    {assets.map(a => {
                      const checked = (draft.default_attachments || []).includes(a.id);
                      return (
                        <label key={a.id} className={`flex items-start gap-2 p-2 rounded text-xs ${isAdmin ? "cursor-pointer" : "opacity-70"} ${checked ? "bg-[var(--cyan)]/10 ring-1 ring-[var(--cyan)]" : isAdmin ? "hover:bg-white/[0.04]" : ""}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!isAdmin}
                            onChange={() => toggleAttachment(a.id)}
                            className="mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{a.title}</span>
                            <span className="block truncate font-mono text-[10px] text-[var(--gray-muted)]">{a.slug}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {isAdmin ? (
                <div className="flex items-center gap-3">
                  <button
                    onClick={save}
                    disabled={saving}
                    className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    {saving ? "Saving…" : selected.is_global ? "Save (creates company override)" : "Save"}
                  </button>
                  {!selected.is_global && (
                    <button onClick={deleteOverride} className="px-3 py-2 rounded-lg border border-red-500/20 text-red-400 text-sm hover:bg-red-500/10">
                      Delete override (revert to global)
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-xs text-[var(--gray-muted)]">
                  To send this template to a homeowner, open a claim and use the Engagement card&apos;s Quick Send buttons.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
