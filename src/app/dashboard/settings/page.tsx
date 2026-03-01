"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [form, setForm] = useState({
    company_name: "",
    address: "",
    city_state_zip: "",
    contact_name: "",
    contact_title: "",
    email: "",
    phone: "",
    website: "",
  });

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("company_profiles")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (data) {
        setForm({
          company_name: data.company_name || "",
          address: data.address || "",
          city_state_zip: data.city_state_zip || "",
          contact_name: data.contact_name || "",
          contact_title: data.contact_title || "",
          email: data.email || "",
          phone: data.phone || "",
          website: data.website || "",
        });
        if (data.logo_path) {
          const { data: logoData } = supabase.storage
            .from("claim-documents")
            .getPublicUrl(data.logo_path);
          // For private buckets, generate a signed URL instead
          const { data: signedData } = await supabase.storage
            .from("claim-documents")
            .createSignedUrl(data.logo_path, 3600);
          if (signedData?.signedUrl) {
            setLogoPreview(signedData.signedUrl);
          }
        }
      }
      setLoading(false);
    }
    loadProfile();
  }, [supabase]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let logoPath = "";

    // Upload logo if provided
    if (logoFile) {
      const ext = logoFile.name.split(".").pop();
      logoPath = `${user.id}/branding/logo.${ext}`;
      await supabase.storage
        .from("claim-documents")
        .upload(logoPath, logoFile, { upsert: true });
    }

    // Upsert company profile
    const profileData = {
      user_id: user.id,
      ...form,
      ...(logoPath ? { logo_path: logoPath } : {}),
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from("company_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (existing) {
      await supabase
        .from("company_profiles")
        .update(profileData)
        .eq("user_id", user.id);
    } else {
      await supabase.from("company_profiles").insert(profileData);
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const fields = [
    { key: "company_name", label: "Company Name", placeholder: "Your Roofing Company" },
    { key: "address", label: "Street Address", placeholder: "123 Main St, Suite 100" },
    { key: "city_state_zip", label: "City, State ZIP", placeholder: "Bensalem, PA 19020" },
    { key: "contact_name", label: "Contact Name", placeholder: "John Smith" },
    { key: "contact_title", label: "Title", placeholder: "CEO / Owner / Project Manager" },
    { key: "email", label: "Email", placeholder: "john@yourcompany.com" },
    { key: "phone", label: "Phone", placeholder: "267-555-0100" },
    { key: "website", label: "Website", placeholder: "www.yourcompany.com" },
  ];

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
            <span className="text-white font-bold text-lg tracking-tight">dumb roof<sup className="text-[9px] font-medium align-super ml-0.5">™</sup></span>
          </div>
          <a href="/dashboard" className="text-gray-400 hover:text-white text-sm transition-colors">Back to Dashboard</a>
        </div>
      </nav>

      <div className="max-w-xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--navy)]">Company Profile</h1>
          <p className="text-gray-500 mt-1">
            Your company info and logo will appear on all generated claim documents.
          </p>
        </div>

        <form onSubmit={handleSave} className="space-y-8">
          {/* Logo Upload */}
          <div>
            <label className="block text-sm font-semibold text-[var(--navy)] mb-2">Company Logo</label>
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 rounded-xl bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden">
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" />
                ) : (
                  <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                  </svg>
                )}
              </div>
              <div>
                <label className="cursor-pointer bg-white border border-gray-200 hover:border-gray-300 px-4 py-2 rounded-lg text-sm font-medium text-gray-700 transition-colors">
                  Upload Logo
                  <input type="file" accept=".jpg,.jpeg,.png,.svg" onChange={handleLogoChange} className="hidden" />
                </label>
                <p className="text-xs text-gray-400 mt-1">JPG, PNG, or SVG. Recommended 400x400px.</p>
              </div>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            {fields.map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-sm font-semibold text-[var(--navy)] mb-1">{label}</label>
                <input
                  type="text"
                  value={form[key as keyof typeof form]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  placeholder={placeholder}
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
                />
              </div>
            ))}
          </div>

          {/* Save */}
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={saving}
              className="bg-[var(--red)] hover:bg-[var(--red-dark)] disabled:opacity-50 text-white px-8 py-3 rounded-xl font-semibold transition-colors text-sm"
            >
              {saving ? "Saving..." : "Save Profile"}
            </button>
            {saved && (
              <span className="text-green-600 text-sm font-medium">Saved successfully</span>
            )}
          </div>
        </form>
      </div>
    </main>
  );
}
