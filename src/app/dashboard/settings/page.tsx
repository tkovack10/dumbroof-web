"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Forwarder {
  id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
}

export default function SettingsPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [forwarders, setForwarders] = useState<Forwarder[]>([]);
  const [newForwarderEmail, setNewForwarderEmail] = useState("");
  const [newForwarderName, setNewForwarderName] = useState("");
  const [newForwarderRole, setNewForwarderRole] = useState("sales_rep");
  const [addingForwarder, setAddingForwarder] = useState(false);
  const [forwarderError, setForwarderError] = useState("");
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
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

      // Load authorized forwarders
      try {
        const res = await fetch(`${BACKEND_URL}/api/forwarders?user_id=${user.id}`);
        if (res.ok) {
          const fwdData = await res.json();
          setForwarders(fwdData.forwarders || []);
        }
      } catch (err) {
        console.error("Failed to load forwarders:", err);
      }
    }
    loadProfile();
  }, [supabase, BACKEND_URL]);

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

  const handleAddForwarder = async () => {
    if (!newForwarderEmail.trim()) return;
    setAddingForwarder(true);
    setForwarderError("");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/forwarders?user_id=${user.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newForwarderEmail.trim(),
          name: newForwarderName.trim() || null,
          role: newForwarderRole,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to add forwarder");
      }

      const newFwd = await res.json();
      setForwarders([...forwarders, newFwd]);
      setNewForwarderEmail("");
      setNewForwarderName("");
      setNewForwarderRole("sales_rep");
    } catch (err) {
      setForwarderError(err instanceof Error ? err.message : "Failed to add");
    }
    setAddingForwarder(false);
  };

  const handleDeleteForwarder = async (id: string) => {
    try {
      await fetch(`${BACKEND_URL}/api/forwarders/${id}`, { method: "DELETE" });
      setForwarders(forwarders.filter((f) => f.id !== id));
    } catch (err) {
      console.error("Failed to delete forwarder:", err);
    }
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

        {/* Authorized Forwarders */}
        <div className="mt-12 pt-8 border-t border-gray-200">
          <h2 className="text-xl font-bold text-[var(--navy)] mb-1">Email Forwarding</h2>
          <p className="text-gray-500 text-sm mb-6">
            Add team members authorized to forward carrier emails to <strong>claims@dumbroof.ai</strong>.
            The system will match forwarded emails to their account.
          </p>

          {/* Existing forwarders */}
          {forwarders.length > 0 && (
            <div className="space-y-2 mb-6">
              {forwarders.map((fwd) => (
                <div key={fwd.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--navy)]">
                      {fwd.name || fwd.email}
                    </p>
                    <p className="text-xs text-gray-500">
                      {fwd.email} &middot; {fwd.role.replace(/_/g, " ")}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteForwarder(fwd.id)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                    title="Remove forwarder"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add new forwarder */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="email"
                value={newForwarderEmail}
                onChange={(e) => setNewForwarderEmail(e.target.value)}
                placeholder="Email address"
                className="px-3 py-2.5 rounded-lg border border-gray-200 focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
              />
              <input
                type="text"
                value={newForwarderName}
                onChange={(e) => setNewForwarderName(e.target.value)}
                placeholder="Name (optional)"
                className="px-3 py-2.5 rounded-lg border border-gray-200 focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
              />
              <select
                value={newForwarderRole}
                onChange={(e) => setNewForwarderRole(e.target.value)}
                className="px-3 py-2.5 rounded-lg border border-gray-200 focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
              >
                <option value="sales_rep">Sales Rep</option>
                <option value="team_member">Team Member</option>
                <option value="office_admin">Office Admin</option>
              </select>
            </div>
            {forwarderError && (
              <p className="text-red-600 text-xs">{forwarderError}</p>
            )}
            <button
              onClick={handleAddForwarder}
              disabled={!newForwarderEmail.trim() || addingForwarder}
              className="bg-[var(--navy)] hover:bg-[var(--navy-light)] disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {addingForwarder ? "Adding..." : "Add Forwarder"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
