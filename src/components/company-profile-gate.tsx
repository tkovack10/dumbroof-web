"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isPersonalDomain } from "@/lib/personal-domains";

interface CompanyProfileGateProps {
  open: boolean;
  userId: string;
  defaultEmail?: string;
  defaultCompanyName?: string;
  onSaved: () => void;
  onClose: () => void;
}

export function CompanyProfileGate({
  open,
  userId,
  defaultEmail,
  defaultCompanyName,
  onSaved,
  onClose,
}: CompanyProfileGateProps) {
  const [companyName, setCompanyName] = useState(defaultCompanyName || "");
  const [contactName, setContactName] = useState("");
  const [contactTitle, setContactTitle] = useState("Owner");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [cityStateZip, setCityStateZip] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const canSubmit =
    companyName.trim() !== "" &&
    contactName.trim() !== "" &&
    phone.trim() !== "" &&
    address.trim() !== "" &&
    cityStateZip.trim() !== "" &&
    logoFile !== null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");

    try {
      const supabase = createClient();

      let logoPath = "";
      if (logoFile) {
        const ext = logoFile.name.split(".").pop() || "png";
        logoPath = `${userId}/branding/logo.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("claim-documents")
          .upload(logoPath, logoFile, { upsert: true });
        if (uploadErr) throw new Error(`Logo upload failed: ${uploadErr.message}`);
      }

      const profileData = {
        user_id: userId,
        company_name: companyName.trim(),
        contact_name: contactName.trim(),
        contact_title: contactTitle.trim() || "Owner",
        email: defaultEmail || "",
        phone: phone.trim(),
        website: website.trim(),
        address: address.trim(),
        city_state_zip: cityStateZip.trim(),
        logo_path: logoPath,
        user_role: "contractor",
        is_admin: true,
        updated_at: new Date().toISOString(),
      };

      const { data: existing } = await supabase
        .from("company_profiles")
        .select("id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();

      if (existing) {
        const { error: updErr } = await supabase
          .from("company_profiles")
          .update(profileData)
          .eq("user_id", userId);
        if (updErr) throw new Error(updErr.message);
      } else {
        const { error: insErr } = await supabase
          .from("company_profiles")
          .insert(profileData);
        if (insErr) throw new Error(insErr.message);
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[rgb(15,18,35)] border border-[var(--border-glass)] rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-[var(--border-glass)]">
          <h2 className="text-xl font-bold text-white">One last step</h2>
          <p className="text-sm text-[var(--gray-muted)] mt-1">
            Add your company branding so your reports go out with <strong>your</strong> name
            and logo — not ours.
          </p>
          {isPersonalDomain(defaultEmail) && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <strong>Heads up:</strong> You signed up with a personal email
              ({defaultEmail?.split("@")[1]}). Your account works fine, but your
              team can&apos;t be auto-linked to you by email. To share branding
              with teammates, invite them directly from Settings — or use a
              company-domain email instead.
            </div>
          )}
        </div>

        <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">
              Company name *
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g., XPRO Elite Roofing & Exteriors"
              className="w-full px-3 py-2 bg-white/5 border border-[var(--border-glass)] rounded-lg text-white placeholder:text-[var(--gray-muted)] focus:outline-none focus:border-[var(--pink)]"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">
                Your name *
              </label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Dominic Mantia"
                className="w-full px-3 py-2 bg-white/5 border border-[var(--border-glass)] rounded-lg text-white placeholder:text-[var(--gray-muted)] focus:outline-none focus:border-[var(--pink)]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">
                Title
              </label>
              <input
                type="text"
                value={contactTitle}
                onChange={(e) => setContactTitle(e.target.value)}
                placeholder="Owner"
                className="w-full px-3 py-2 bg-white/5 border border-[var(--border-glass)] rounded-lg text-white placeholder:text-[var(--gray-muted)] focus:outline-none focus:border-[var(--pink)]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">
              Phone *
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="937-807-6637"
              className="w-full px-3 py-2 bg-white/5 border border-[var(--border-glass)] rounded-lg text-white placeholder:text-[var(--gray-muted)] focus:outline-none focus:border-[var(--pink)]"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">
              Business address *
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="108 Mound Builder Pl"
              className="w-full px-3 py-2 bg-white/5 border border-[var(--border-glass)] rounded-lg text-white placeholder:text-[var(--gray-muted)] focus:outline-none focus:border-[var(--pink)]"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">
              City, State ZIP *
            </label>
            <input
              type="text"
              value={cityStateZip}
              onChange={(e) => setCityStateZip(e.target.value)}
              placeholder="Miamisburg, OH 45005"
              className="w-full px-3 py-2 bg-white/5 border border-[var(--border-glass)] rounded-lg text-white placeholder:text-[var(--gray-muted)] focus:outline-none focus:border-[var(--pink)]"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">
              Website
            </label>
            <input
              type="text"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="www.yourcompany.com"
              className="w-full px-3 py-2 bg-white/5 border border-[var(--border-glass)] rounded-lg text-white placeholder:text-[var(--gray-muted)] focus:outline-none focus:border-[var(--pink)]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">
              Company logo *
            </label>
            <div className="flex items-center gap-3">
              {logoPreview ? (
                <img
                  src={logoPreview}
                  alt="Logo preview"
                  className="w-20 h-20 rounded-lg object-contain bg-white/10 border border-[var(--border-glass)]"
                />
              ) : (
                <div className="w-20 h-20 rounded-lg bg-white/5 border border-dashed border-[var(--border-glass)] flex items-center justify-center text-[10px] text-[var(--gray-muted)] text-center px-1">
                  No logo
                </div>
              )}
              <label className="flex-1 cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoChange}
                  className="hidden"
                />
                <div className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-[var(--border-glass)] rounded-lg text-sm text-white text-center transition">
                  {logoFile ? "Change logo" : "Upload logo"}
                </div>
              </label>
            </div>
            <p className="text-[11px] text-[var(--gray-muted)] mt-1.5">
              PNG or JPG — appears on every page of every report.
            </p>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm transition"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit || saving}
              className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[var(--pink)] to-[var(--blue)] text-white font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {saving ? "Saving..." : "Save & submit claim"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
