"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { directUpload } from "@/lib/upload-utils";

type VisibilityMode = "team" | "own";

interface Company {
  id: string;
  name: string;
  address: string;
  city_state_zip: string;
  phone: string;
  office_phone: string;
  website: string;
  logo_path: string;
  license_number: string;
  email_domain: string;
  claims_visibility_mode: VisibilityMode;
  is_usarm: boolean;
}

const BLANK: Company = {
  id: "",
  name: "",
  address: "",
  city_state_zip: "",
  phone: "",
  office_phone: "",
  website: "",
  logo_path: "",
  license_number: "",
  email_domain: "",
  claims_visibility_mode: "team",
  is_usarm: false,
};

export default function CompanyAdminPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [company, setCompany] = useState<Company>(BLANK);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the caller's company.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setLoading(false);
        return;
      }
      const { data: prof } = await supabase
        .from("company_profiles")
        .select("company_id")
        .eq("user_id", user.id)
        .maybeSingle();
      const cid = prof?.company_id ?? null;
      if (!cid) {
        if (!cancelled) setLoading(false);
        return;
      }
      const { data: comp } = await supabase
        .from("companies")
        .select("*")
        .eq("id", cid)
        .maybeSingle();
      if (!cancelled) {
        setCompanyId(cid);
        if (comp) {
          setCompany({
            id: comp.id,
            name: comp.name ?? "",
            address: comp.address ?? "",
            city_state_zip: comp.city_state_zip ?? "",
            phone: comp.phone ?? "",
            office_phone: comp.office_phone ?? "",
            website: comp.website ?? "",
            logo_path: comp.logo_path ?? "",
            license_number: comp.license_number ?? "",
            email_domain: comp.email_domain ?? "",
            claims_visibility_mode: (comp.claims_visibility_mode as VisibilityMode) ?? "team",
            is_usarm: !!comp.is_usarm,
          });
          if (comp.logo_path) {
            const { data: signed } = await supabase.storage
              .from("claim-documents")
              .createSignedUrl(comp.logo_path, 3600);
            if (signed?.signedUrl) setLogoUrl(signed.signedUrl);
          }
        }
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [supabase]);

  const set = useCallback(<K extends keyof Company>(k: K, v: Company[K]) => {
    setCompany((c) => ({ ...c, [k]: v }));
    setSaved(false);
  }, []);

  const save = useCallback(async () => {
    if (!companyId) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { error } = await supabase
        .from("companies")
        .update({
          name: company.name,
          address: company.address || null,
          city_state_zip: company.city_state_zip || null,
          phone: company.phone || null,
          office_phone: company.office_phone || null,
          website: company.website || null,
          license_number: company.license_number || null,
          claims_visibility_mode: company.claims_visibility_mode,
        })
        .eq("id", companyId);
      if (error) throw error;
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [supabase, companyId, company]);

  const uploadLogo = useCallback(async (file: File) => {
    if (!companyId) return;
    setLogoUploading(true);
    setError(null);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `companies/${companyId}/logo.${ext}`;
      const { data: signedUpload, error: signErr } = await supabase.storage
        .from("claim-documents")
        .createSignedUploadUrl(path, { upsert: true });
      if (signErr || !signedUpload?.signedUrl) {
        throw signErr || new Error("Could not create upload URL");
      }
      await directUpload(signedUpload.signedUrl, file);
      const { error } = await supabase
        .from("companies")
        .update({ logo_path: path })
        .eq("id", companyId);
      if (error) throw error;
      set("logo_path", path);
      const { data: signed } = await supabase.storage
        .from("claim-documents")
        .createSignedUrl(path, 3600);
      if (signed?.signedUrl) setLogoUrl(signed.signedUrl);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Logo upload failed");
    } finally {
      setLogoUploading(false);
    }
  }, [supabase, companyId, set]);

  if (loading) {
    return <div className="p-8 text-[var(--gray-muted)]">Loading…</div>;
  }
  if (!companyId) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="glass-card p-6">
          <h1 className="text-xl font-bold text-white mb-2">No Company Linked</h1>
          <p className="text-sm text-[var(--gray-muted)]">
            Your account isn&apos;t part of a company yet. Use the Team / Reps page
            to set up your company and invite reps.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">Company</h1>
        <p className="text-sm text-[var(--gray-muted)] mt-1">
          Canonical org info every rep&apos;s claims and PDFs inherit from. Reps cannot
          override these from their personal Settings — edit here once and it
          propagates to every rep&apos;s account.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="glass-card p-6 space-y-5">
        <h2 className="text-lg font-bold text-white">Company identity</h2>

        <Field label="Company name" value={company.name} onChange={(v) => set("name", v)} required />
        <Field label="Street address" value={company.address} onChange={(v) => set("address", v)} />
        <Field label="City, State ZIP" value={company.city_state_zip} onChange={(v) => set("city_state_zip", v)} />

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Main phone" value={company.phone} onChange={(v) => set("phone", v)} />
          <Field label="Office phone" value={company.office_phone} onChange={(v) => set("office_phone", v)} />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Website" value={company.website} onChange={(v) => set("website", v)} placeholder="www.example.com" />
          <Field label="License number" value={company.license_number} onChange={(v) => set("license_number", v)} />
        </div>

        <div>
          <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
            Company logo
          </label>
          <div className="flex items-center gap-4">
            <div className="w-24 h-24 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] overflow-hidden flex items-center justify-center">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="logo" className="w-full h-full object-contain" />
              ) : (
                <span className="text-xs text-[var(--gray-dim)]">no logo</span>
              )}
            </div>
            <label className="cursor-pointer text-sm font-semibold text-[var(--cyan)] hover:text-white transition-colors">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadLogo(f);
                }}
              />
              {logoUploading ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
            </label>
          </div>
          <p className="text-xs text-[var(--gray-dim)] mt-2">
            Used on every PDF cover + supplement letter for every rep on this account.
          </p>
        </div>
      </div>

      <div className="glass-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-white">Claims visibility</h2>
          <p className="text-sm text-[var(--gray-muted)] mt-1">
            Default is team-wide. Switch to per-rep if you don&apos;t want sales reps
            to see each other&apos;s claims. Admins and owners always see all
            company claims regardless of this setting.
          </p>
        </div>

        <div className="space-y-2">
          <VisibilityOption
            mode="team"
            current={company.claims_visibility_mode}
            label="All reps see every company claim"
            sub="Default. Every rep sees the full dashboard, map, and damage scores for the whole company."
            onSelect={() => set("claims_visibility_mode", "team")}
          />
          <VisibilityOption
            mode="own"
            current={company.claims_visibility_mode}
            label="Each rep sees only their own claims"
            sub="Reps see just the claims they own. Admins/owners still see everything."
            onSelect={() => set("claims_visibility_mode", "own")}
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 text-white px-6 py-2.5 rounded-xl font-semibold transition-all text-sm"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {saved && <span className="text-green-400 text-sm font-medium">Saved — propagating to all reps</span>}
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, required, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white px-3 py-2 text-sm focus:outline-none focus:border-[var(--cyan)]"
      />
    </div>
  );
}

function VisibilityOption({
  mode, current, label, sub, onSelect,
}: {
  mode: VisibilityMode;
  current: VisibilityMode;
  label: string;
  sub: string;
  onSelect: () => void;
}) {
  const active = mode === current;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left p-4 rounded-xl border transition-colors ${
        active
          ? "border-[var(--cyan)] bg-[var(--cyan)]/[0.08]"
          : "border-[var(--border-glass)] bg-white/[0.02] hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 ${
          active ? "border-[var(--cyan)] bg-[var(--cyan)]" : "border-[var(--gray-dim)]"
        }`} />
        <div>
          <div className="text-sm font-semibold text-white">{label}</div>
          <div className="text-xs text-[var(--gray-muted)] mt-0.5">{sub}</div>
        </div>
      </div>
    </button>
  );
}
