"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useBillingQuota } from "@/hooks/use-billing-quota";

interface Forwarder {
  id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsPageContent />
    </Suspense>
  );
}

function SettingsPageContent() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const isPasswordReset = searchParams.get("reset") === "true";
  const billingSuccess = searchParams.get("billing") === "success";
  const gmailJustConnected = searchParams.get("gmail") === "connected";
  const passwordRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const billing = useBillingQuota();
  const [portalLoading, setPortalLoading] = useState(false);
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
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  // Gmail integration state
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState("");
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [gmailDisconnecting, setGmailDisconnecting] = useState(false);
  // Repair pricing state
  const [repairPricing, setRepairPricing] = useState({
    diagnostic_fee: "250.00",
    labor_rate_per_hour: "85.00",
    markup_percent: "20",
    minimum_job_charge: "450.00",
  });
  const [pricingSaving, setPricingSaving] = useState(false);
  const [pricingSaved, setPricingSaved] = useState(false);
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
    if (isPasswordReset && !loading && passwordRef.current) {
      passwordRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [isPasswordReset, loading]);

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordMessage("");

    if (newPassword.length < 6) {
      setPasswordError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    setPasswordSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setPasswordError(error.message);
    } else {
      setPasswordMessage("Password updated successfully!");
      setNewPassword("");
      setConfirmPassword("");
    }
    setPasswordSaving(false);
  };

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
        // Check Gmail connection
        if (data.gmail_refresh_token) {
          setGmailConnected(true);
          setGmailEmail(data.sending_email || data.email || "");
        }
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

      // Load forwarders + repair pricing in parallel
      const [fwdRes, pricingRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/forwarders?user_id=${user.id}`).catch(() => null),
        supabase.from("repair_pricing").select("*").eq("user_id", user.id).single(),
      ]);

      if (fwdRes?.ok) {
        const fwdData = await fwdRes.json();
        setForwarders(fwdData.forwarders || []);
      }

      if (pricingRes.data) {
        const p = pricingRes.data;
        setRepairPricing({
          diagnostic_fee: String(p.diagnostic_fee ?? "250.00"),
          labor_rate_per_hour: String(p.labor_rate_per_hour ?? "85.00"),
          markup_percent: String(Math.round((p.markup_percent ?? 0.20) * 100)),
          minimum_job_charge: String(p.minimum_job_charge ?? "450.00"),
        });
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
      <main className="min-h-screen bg-white/[0.04] flex items-center justify-center">
        <p className="text-[var(--gray-dim)]">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white/[0.04]">
      <nav className="bg-[var(--navy)] border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white">DR</div>
            <span className="text-white font-bold text-lg tracking-tight">dumb roof<sup className="text-[9px] font-medium align-super ml-0.5">™</sup></span>
          </div>
          <a href="/dashboard" className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors">Back to Dashboard</a>
        </div>
      </nav>

      <div className="max-w-xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--navy)]">Company Profile</h1>
          <p className="text-[var(--gray-muted)] mt-1">
            Your company info and logo will appear on all generated claim documents.
          </p>
        </div>

        <form onSubmit={handleSave} className="space-y-8">
          {/* Logo Upload */}
          <div>
            <label className="block text-sm font-semibold text-[var(--navy)] mb-2">Company Logo</label>
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 rounded-xl bg-white/[0.06] border-2 border-dashed border-[var(--border-glass)] flex items-center justify-center overflow-hidden">
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" />
                ) : (
                  <svg className="w-8 h-8 text-[var(--gray-dim)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                  </svg>
                )}
              </div>
              <div>
                <label className="cursor-pointer bg-[var(--bg-glass)] border border-[var(--border-glass)] hover:border-[var(--border-glass)] px-4 py-2 rounded-lg text-sm font-medium text-[var(--gray)] transition-colors">
                  Upload Logo
                  <input type="file" accept=".jpg,.jpeg,.png,.svg" onChange={handleLogoChange} className="hidden" />
                </label>
                <p className="text-xs text-[var(--gray-dim)] mt-1">JPG, PNG, or SVG. Recommended 400x400px.</p>
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
                  className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
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

        {/* Billing */}
        <div className="mt-12 pt-8 border-t border-[var(--border-glass)]">
          <h2 className="text-xl font-bold text-[var(--navy)] mb-1">Billing & Subscription</h2>
          <p className="text-[var(--gray-muted)] text-sm mb-6">
            Manage your plan and claim quota.
          </p>

          {billingSuccess && (
            <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-lg px-4 py-3 mb-4">
              Subscription activated! Your plan has been upgraded.
            </div>
          )}

          {billing && (
            <div className="bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-[var(--navy)]">
                    {billing.planName} Plan
                  </p>
                  <p className="text-xs text-[var(--gray-muted)] mt-0.5">
                    {billing.planId === "starter"
                      ? `${billing.lifetimeUsed} of ${billing.limit} lifetime claims used`
                      : `${billing.periodUsed} of ${billing.limit} claims used this month`}
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                    billing.status === "active"
                      ? "bg-green-500/10 text-green-400"
                      : billing.status === "past_due"
                      ? "bg-amber-500/10 text-amber-400"
                      : "bg-white/[0.06] text-[var(--gray)]"
                  }`}
                >
                  {billing.status === "active" ? "Active" : billing.status === "past_due" ? "Past Due" : "Canceled"}
                </span>
              </div>

              {/* Usage bar */}
              <div className="w-full bg-white/[0.06] rounded-full h-2">
                <div
                  className="bg-[var(--navy)] h-2 rounded-full transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      ((billing.planId === "starter"
                        ? billing.lifetimeUsed
                        : billing.periodUsed) /
                        (billing.limit || 1)) *
                        100
                    )}%`,
                  }}
                />
              </div>

              <div className="flex gap-3">
                {billing.planId === "starter" ? (
                  <a
                    href="/pricing"
                    className="bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    Upgrade Plan
                  </a>
                ) : (
                  <>
                    <a
                      href="/pricing"
                      className="bg-[var(--navy)] hover:bg-[var(--navy-light)] text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
                    >
                      Change Plan
                    </a>
                    <button
                      onClick={async () => {
                        setPortalLoading(true);
                        try {
                          const res = await fetch("/api/billing/create-portal", {
                            method: "POST",
                          });
                          const data = await res.json();
                          if (data.url) window.location.href = data.url;
                        } catch {
                          // fall through
                        }
                        setPortalLoading(false);
                      }}
                      disabled={portalLoading}
                      className="bg-[var(--bg-glass)] border border-[var(--border-glass)] hover:border-[var(--border-glass)] text-[var(--gray)] px-5 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      {portalLoading ? "Loading..." : "Manage Billing"}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Authorized Forwarders */}
        <div className="mt-12 pt-8 border-t border-[var(--border-glass)]">
          <h2 className="text-xl font-bold text-[var(--navy)] mb-1">Email Forwarding</h2>
          <p className="text-[var(--gray-muted)] text-sm mb-6">
            Add team members authorized to forward carrier emails to <strong>claims@dumbroof.ai</strong>.
            The system will match forwarded emails to their account.
          </p>

          {/* Existing forwarders */}
          {forwarders.length > 0 && (
            <div className="space-y-2 mb-6">
              {forwarders.map((fwd) => (
                <div key={fwd.id} className="flex items-center justify-between bg-white/[0.04] rounded-lg px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--navy)]">
                      {fwd.name || fwd.email}
                    </p>
                    <p className="text-xs text-[var(--gray-muted)]">
                      {fwd.email} &middot; {fwd.role.replace(/_/g, " ")}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteForwarder(fwd.id)}
                    className="text-[var(--gray-dim)] hover:text-red-500 transition-colors"
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
          <div className="bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="email"
                value={newForwarderEmail}
                onChange={(e) => setNewForwarderEmail(e.target.value)}
                placeholder="Email address"
                className="px-3 py-2.5 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
              />
              <input
                type="text"
                value={newForwarderName}
                onChange={(e) => setNewForwarderName(e.target.value)}
                placeholder="Name (optional)"
                className="px-3 py-2.5 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
              />
              <select
                value={newForwarderRole}
                onChange={(e) => setNewForwarderRole(e.target.value)}
                className="px-3 py-2.5 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
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

        {/* Email Integration (Claim Brain) */}
        <div className="mt-12 pt-8 border-t border-[var(--border-glass)]">
          <h2 className="text-xl font-bold text-[var(--navy)] mb-1">Email Integration</h2>
          <p className="text-[var(--gray-muted)] text-sm mb-6">
            Connect your Gmail to send emails from Claim Brain as yourself.
            Without Gmail, emails send via <strong>claims@dumbroof.ai</strong> with your company name.
          </p>

          {(gmailJustConnected && !gmailConnected) && (
            <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-lg px-4 py-3 mb-4">
              Gmail connected successfully! Reload to see the updated status.
            </div>
          )}

          <div className="bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-xl p-6">
            {gmailConnected ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--navy)]">Gmail Connected</p>
                    <p className="text-xs text-[var(--gray-muted)]">
                      Sending from <strong>{gmailEmail}</strong>
                    </p>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    setGmailDisconnecting(true);
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) return;
                    try {
                      await fetch(`${BACKEND_URL}/api/gmail-auth/disconnect`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ user_id: user.id }),
                      });
                      setGmailConnected(false);
                      setGmailEmail("");
                    } catch {
                      // ignore
                    }
                    setGmailDisconnecting(false);
                  }}
                  disabled={gmailDisconnecting}
                  className="text-red-400 hover:text-red-300 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {gmailDisconnecting ? "Disconnecting..." : "Disconnect"}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/[0.06] rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-[var(--gray-dim)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--navy)]">Gmail Not Connected</p>
                    <p className="text-xs text-[var(--gray-muted)]">
                      Emails currently send via <strong>claims@dumbroof.ai</strong>
                    </p>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    setGmailConnecting(true);
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) return;
                    try {
                      const res = await fetch(
                        `${BACKEND_URL}/api/gmail-auth/authorize?user_id=${user.id}`
                      );
                      const data = await res.json();
                      if (data.auth_url) {
                        window.location.href = data.auth_url;
                      }
                    } catch {
                      setGmailConnecting(false);
                    }
                  }}
                  disabled={gmailConnecting}
                  className="bg-[var(--navy)] hover:bg-[var(--navy-light)] disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  {gmailConnecting ? "Connecting..." : "Connect Gmail"}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Repair Pricing */}
        <div className="mt-12 pt-8 border-t border-[var(--border-glass)]">
          <h2 className="text-xl font-bold text-[var(--navy)] mb-1">Repair Pricing</h2>
          <p className="text-[var(--gray-muted)] text-sm mb-6">
            Set your default pricing for repair jobs. These values are used when AI generates repair quotes.
          </p>

          <div className="bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-xl p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-[var(--navy)] mb-1">Diagnostic Fee ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={repairPricing.diagnostic_fee}
                  onChange={(e) => setRepairPricing({ ...repairPricing, diagnostic_fee: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
                />
                <p className="text-[11px] text-[var(--gray-dim)] mt-1">Flat fee included in every repair</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--navy)] mb-1">Labor Rate ($/hr)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={repairPricing.labor_rate_per_hour}
                  onChange={(e) => setRepairPricing({ ...repairPricing, labor_rate_per_hour: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--navy)] mb-1">Material Markup (%)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="200"
                  value={repairPricing.markup_percent}
                  onChange={(e) => setRepairPricing({ ...repairPricing, markup_percent: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
                />
                <p className="text-[11px] text-[var(--gray-dim)] mt-1">Applied on top of material cost (20 = 20% markup)</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--navy)] mb-1">Minimum Job Charge ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={repairPricing.minimum_job_charge}
                  onChange={(e) => setRepairPricing({ ...repairPricing, minimum_job_charge: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
                />
                <p className="text-[11px] text-[var(--gray-dim)] mt-1">Floor price — no repair goes below this</p>
              </div>
            </div>

            <div className="flex items-center gap-4 pt-2">
              <button
                onClick={async () => {
                  setPricingSaving(true);
                  setPricingSaved(false);
                  const { data: { user } } = await supabase.auth.getUser();
                  if (!user) return;
                  const payload = {
                    user_id: user.id,
                    diagnostic_fee: parseFloat(repairPricing.diagnostic_fee) || 250,
                    labor_rate_per_hour: parseFloat(repairPricing.labor_rate_per_hour) || 85,
                    markup_percent: (parseFloat(repairPricing.markup_percent) || 20) / 100,
                    minimum_job_charge: parseFloat(repairPricing.minimum_job_charge) || 450,
                    updated_at: new Date().toISOString(),
                  };
                  await supabase.from("repair_pricing").upsert(payload, { onConflict: "user_id" });
                  setPricingSaving(false);
                  setPricingSaved(true);
                  setTimeout(() => setPricingSaved(false), 3000);
                }}
                disabled={pricingSaving}
                className="bg-[var(--navy)] hover:bg-[var(--navy-light)] disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                {pricingSaving ? "Saving..." : "Save Pricing"}
              </button>
              {pricingSaved && (
                <span className="text-green-600 text-sm font-medium">Saved successfully</span>
              )}
            </div>
          </div>
        </div>

        {/* Password */}
        <div ref={passwordRef} className="mt-12 pt-8 border-t border-[var(--border-glass)]">
          <h2 className="text-xl font-bold text-[var(--navy)] mb-1">
            {isPasswordReset ? "Set Your Password" : "Change Password"}
          </h2>
          <p className="text-[var(--gray-muted)] text-sm mb-6">
            {isPasswordReset
              ? "Welcome! Set a password to finish setting up your account."
              : "Update your account password."}
          </p>

          <form onSubmit={handlePasswordUpdate} className="space-y-4 max-w-sm">
            <div>
              <label className="block text-sm font-semibold text-[var(--navy)] mb-1">New Password</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                minLength={6}
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--navy)] mb-1">Confirm Password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                minLength={6}
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
              />
            </div>

            {passwordError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
                {passwordError}
              </div>
            )}
            {passwordMessage && (
              <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-lg px-4 py-3">
                {passwordMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={passwordSaving}
              className="bg-[var(--red)] hover:bg-[var(--red-dark)] disabled:opacity-50 text-white px-8 py-3 rounded-xl font-semibold transition-colors text-sm"
            >
              {passwordSaving ? "Updating..." : "Update Password"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
