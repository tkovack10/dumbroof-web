"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useBillingQuota } from "@/hooks/use-billing-quota";
import { AdminBrainChat } from "@/components/admin-brain-chat";

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
  const stripeConnectSuccess = searchParams.get("stripe_connect") === "success";
  const passwordRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string>("");
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
  // Microsoft 365 integration state
  const [microsoftConnected, setMicrosoftConnected] = useState(false);
  const [microsoftEmail, setMicrosoftEmail] = useState("");
  const [microsoftDisconnecting, setMicrosoftDisconnecting] = useState(false);
  const microsoftJustConnected = searchParams.get("microsoft") === "connected";
  const microsoftError = searchParams.get("microsoft") === "error" ? (searchParams.get("reason") || "unknown") : "";
  // Generic SMTP state
  const [smtpConnected, setSmtpConnected] = useState(false);
  const [smtpFromEmail, setSmtpFromEmail] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUsername, setSmtpUsername] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpDisconnecting, setSmtpDisconnecting] = useState(false);
  const [smtpStatus, setSmtpStatus] = useState<{ type: "success" | "error" | ""; msg: string }>({ type: "", msg: "" });
  // CRM integration state
  const [acculynxKey, setAcculynxKey] = useState("");
  const [acculynxConnected, setAcculynxConnected] = useState(false);
  const [acculynxConnectedAt, setAcculynxConnectedAt] = useState<string | null>(null);
  const [acculynxConnecting, setAcculynxConnecting] = useState(false);
  const [companycamKey, setCompanycamKey] = useState("");
  const [companycamConnected, setCompanycamConnected] = useState(false);
  const [companycamConnectedAt, setCompanycamConnectedAt] = useState<string | null>(null);
  const [companycamConnecting, setCompanycamConnecting] = useState(false);
  const [crmError, setCrmError] = useState("");
  const [verifyingProvider, setVerifyingProvider] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<{ provider: string; ok: boolean; message: string } | null>(null);
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
  const [richardDryRun, setRichardDryRun] = useState(false);
  const [richardDryRunSaving, setRichardDryRunSaving] = useState(false);

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
      setCurrentUserId(user.id);

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
        // Richard dry-run flag (short-circuits destructive approvals)
        setRichardDryRun(Boolean(data.richard_dry_run));
        // Microsoft 365 connection
        if (data.microsoft_refresh_token) {
          setMicrosoftConnected(true);
          setMicrosoftEmail(data.microsoft_email || "");
        }
        // Generic SMTP connection
        if (data.smtp_host && data.smtp_password_encrypted) {
          setSmtpConnected(true);
          setSmtpFromEmail(data.smtp_from_email || "");
          setSmtpHost(data.smtp_host || "");
          setSmtpPort(String(data.smtp_port || "587"));
          setSmtpUsername(data.smtp_username || "");
        }
        // Check CRM connections
        if (data.acculynx_api_key) {
          setAcculynxConnected(true);
          setAcculynxConnectedAt(data.acculynx_connected_at);
        }
        if (data.companycam_api_key) {
          setCompanycamConnected(true);
          setCompanycamConnectedAt(data.companycam_connected_at);
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
      <nav className="bg-[rgba(6,9,24,0.85)] backdrop-blur-[20px] border-b border-[var(--border-glass)] sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--pink)] to-[var(--blue)] flex items-center justify-center font-bold text-white text-xs">DR</div>
            <span className="text-white font-bold text-lg tracking-tight">dumb roof<sup className="text-[9px] font-medium align-super ml-0.5">™</sup></span>
          </div>
          <a href="/dashboard" className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors">Back to Dashboard</a>
        </div>
      </nav>

      <div className="max-w-xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--white)]">Company Profile</h1>
          <p className="text-[var(--gray-muted)] mt-1">
            Your company info and logo will appear on all generated claim documents.
          </p>
        </div>

        {/* Richard onboarding assistant — walks through integrations, team, email setup */}
        {currentUserId && (
          <div className="mb-8">
            <AdminBrainChat userId={currentUserId} />
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-8">
          {/* Logo Upload */}
          <div>
            <label className="block text-sm font-semibold text-[var(--white)] mb-2">Company Logo</label>
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
                <label className="block text-sm font-semibold text-[var(--white)] mb-1">{label}</label>
                <input
                  type="text"
                  value={form[key as keyof typeof form]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  placeholder={placeholder}
                  className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
                />
              </div>
            ))}
          </div>

          {/* Save */}
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={saving}
              className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 text-white px-8 py-3 rounded-xl font-semibold transition-colors text-sm"
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
          <h2 className="text-xl font-bold text-[var(--white)] mb-1">Billing & Subscription</h2>
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
                  <p className="text-sm font-semibold text-[var(--white)]">
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
                  className="bg-gradient-to-r from-[var(--pink)] to-[var(--blue)] h-2 rounded-full transition-all"
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
                    className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    Upgrade Plan
                  </a>
                ) : (
                  <>
                    <a
                      href="/pricing"
                      className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
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

        {/* Stripe Connect — Invoicing */}
        <StripeConnectSection justConnected={stripeConnectSuccess} />

        {/* Authorized Forwarders */}
        <div className="mt-12 pt-8 border-t border-[var(--border-glass)]">
          <h2 className="text-xl font-bold text-[var(--white)] mb-1">Email Forwarding</h2>
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
                    <p className="text-sm font-medium text-[var(--white)]">
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
                className="px-3 py-2.5 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
              />
              <input
                type="text"
                value={newForwarderName}
                onChange={(e) => setNewForwarderName(e.target.value)}
                placeholder="Name (optional)"
                className="px-3 py-2.5 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
              />
              <select
                value={newForwarderRole}
                onChange={(e) => setNewForwarderRole(e.target.value)}
                className="px-3 py-2.5 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
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
              className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {addingForwarder ? "Adding..." : "Add Forwarder"}
            </button>
          </div>
        </div>

        {/* Claim Brain (Richard) safety — dry-run toggle */}
        <div className="mt-12 pt-8 border-t border-[var(--border-glass)]">
          <h2 className="text-xl font-bold text-[var(--white)] mb-1">Claim Brain Safety</h2>
          <p className="text-[var(--gray-muted)] text-sm mb-6">
            Dry-run mode lets you test Richard&apos;s agentic actions (send-to-carrier,
            schedule follow-ups, attach documents) without any of them actually executing.
            Previews still appear; approvals log to the audit trail but nothing ships.
          </p>

          <div className="bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--white)]">
                  Dry-run mode {richardDryRun && <span className="ml-2 text-amber-400 text-xs font-bold">ON</span>}
                </p>
                <p className="text-xs text-[var(--gray-muted)] mt-1">
                  When ON, every approve click returns &quot;DRY RUN&quot; instead of sending or writing.
                </p>
              </div>
              <button
                onClick={async () => {
                  setRichardDryRunSaving(true);
                  const next = !richardDryRun;
                  try {
                    const { data: { user } } = await supabase.auth.getUser();
                    if (user) {
                      await supabase
                        .from("company_profiles")
                        .update({ richard_dry_run: next, updated_at: new Date().toISOString() })
                        .eq("user_id", user.id);
                      setRichardDryRun(next);
                    }
                  } catch (e) {
                    console.warn("[dry-run] save failed:", e);
                  }
                  setRichardDryRunSaving(false);
                }}
                disabled={richardDryRunSaving}
                className={`relative inline-flex items-center h-7 w-12 rounded-full transition-colors disabled:opacity-40 ${
                  richardDryRun ? "bg-amber-500" : "bg-white/10"
                }`}
                aria-label="Toggle dry-run mode"
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${
                    richardDryRun ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Email Integration (Claim Brain) */}
        <div id="email-integration" className="mt-12 pt-8 border-t border-[var(--border-glass)] scroll-mt-20">
          <h2 className="text-xl font-bold text-[var(--white)] mb-1">Email Integration</h2>
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
                    <p className="text-sm font-semibold text-[var(--white)]">Gmail Connected</p>
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
                    <p className="text-sm font-semibold text-[var(--white)]">Gmail Not Connected</p>
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
                  className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  {gmailConnecting ? "Connecting..." : "Connect Gmail"}
                </button>
              </div>
            )}
          </div>

          {/* Microsoft 365 / Outlook */}
          <div className="mt-4 bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-xl p-6">
            {microsoftJustConnected && microsoftConnected && (
              <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-lg px-3 py-2 mb-3">
                Microsoft 365 connected successfully.
              </div>
            )}
            {microsoftError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-3 py-2 mb-3">
                Microsoft connection failed: {microsoftError}
              </div>
            )}
            {microsoftConnected ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--white)]">Microsoft 365 / Outlook Connected</p>
                    <p className="text-xs text-[var(--gray-muted)]">
                      Sending from <strong>{microsoftEmail || "your Microsoft account"}</strong>
                    </p>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    setMicrosoftDisconnecting(true);
                    try {
                      await fetch(`${BACKEND_URL}/api/microsoft-auth/disconnect`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ user_id: currentUserId }),
                      });
                      setMicrosoftConnected(false);
                      setMicrosoftEmail("");
                    } catch { /* ignore */ }
                    setMicrosoftDisconnecting(false);
                  }}
                  disabled={microsoftDisconnecting}
                  className="text-red-400 hover:text-red-300 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {microsoftDisconnecting ? "Disconnecting..." : "Disconnect"}
                </button>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center text-lg">📧</div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--white)]">Microsoft 365 / Outlook</p>
                    <p className="text-xs text-[var(--gray-muted)]">
                      Send as your @yourcompany.com Microsoft address. Richard searches your inbox for carrier replies.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (!currentUserId) return;
                    window.location.href = `${BACKEND_URL}/api/microsoft-auth/connect?user_id=${currentUserId}`;
                  }}
                  disabled={!currentUserId}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  Connect Microsoft 365
                </button>
              </div>
            )}
          </div>

          {/* Generic SMTP */}
          <div className="mt-4 bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-amber-500/10 rounded-lg flex items-center justify-center text-lg">⚙️</div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-[var(--white)]">
                  Generic SMTP {smtpConnected && <span className="ml-2 text-[10px] text-green-400 font-bold">CONNECTED</span>}
                </p>
                <p className="text-xs text-[var(--gray-muted)]">
                  GoDaddy, Zoho, Yahoo, Namecheap, custom domain. Use an app password — not your regular login.
                </p>
              </div>
            </div>
            {smtpConnected ? (
              <div className="text-xs text-[var(--gray-muted)]">
                Sending from <strong className="text-white">{smtpFromEmail}</strong> via {smtpHost}:{smtpPort}
                <button
                  onClick={async () => {
                    setSmtpDisconnecting(true);
                    try {
                      await fetch(`${BACKEND_URL}/api/smtp/disconnect`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ user_id: currentUserId }),
                      });
                      setSmtpConnected(false);
                      setSmtpFromEmail("");
                      setSmtpHost("");
                      setSmtpUsername("");
                      setSmtpPassword("");
                    } catch { /* ignore */ }
                    setSmtpDisconnecting(false);
                  }}
                  disabled={smtpDisconnecting}
                  className="ml-3 text-red-400 hover:text-red-300 text-xs font-medium disabled:opacity-50"
                >
                  {smtpDisconnecting ? "Disconnecting..." : "Disconnect"}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    placeholder="smtp.office365.com"
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder-white/30"
                  />
                  <input
                    placeholder="Port (587 or 465)"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder-white/30"
                  />
                </div>
                <input
                  placeholder="Username (usually your email)"
                  value={smtpUsername}
                  onChange={(e) => setSmtpUsername(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder-white/30"
                />
                <input
                  type="password"
                  placeholder="App password (NOT your regular password)"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder-white/30"
                />
                <input
                  placeholder="From email (e.g. you@yourcompany.com)"
                  value={smtpFromEmail}
                  onChange={(e) => setSmtpFromEmail(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder-white/30"
                />
                {smtpStatus.msg && (
                  <div className={`text-xs rounded-lg px-3 py-2 ${smtpStatus.type === "success" ? "bg-green-500/10 border border-green-500/30 text-green-400" : "bg-red-500/10 border border-red-500/30 text-red-400"}`}>
                    {smtpStatus.msg}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      setSmtpTesting(true);
                      setSmtpStatus({ type: "", msg: "" });
                      try {
                        const res = await fetch(`${BACKEND_URL}/api/smtp/test`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            host: smtpHost,
                            port: parseInt(smtpPort || "587", 10),
                            username: smtpUsername,
                            password: smtpPassword,
                          }),
                        });
                        const data = await res.json();
                        setSmtpStatus(data.ok ? { type: "success", msg: data.message || "Credentials verified." } : { type: "error", msg: data.error || "Unknown error" });
                      } catch (e) {
                        setSmtpStatus({ type: "error", msg: e instanceof Error ? e.message : "Request failed" });
                      }
                      setSmtpTesting(false);
                    }}
                    disabled={smtpTesting || !smtpHost || !smtpPassword}
                    className="bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white/80 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    {smtpTesting ? "Testing..." : "Test connection"}
                  </button>
                  <button
                    onClick={async () => {
                      setSmtpSaving(true);
                      setSmtpStatus({ type: "", msg: "" });
                      try {
                        const res = await fetch(`${BACKEND_URL}/api/smtp/save`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            user_id: currentUserId,
                            host: smtpHost,
                            port: parseInt(smtpPort || "587", 10),
                            username: smtpUsername,
                            password: smtpPassword,
                            from_email: smtpFromEmail,
                          }),
                        });
                        const data = await res.json();
                        if (res.ok) {
                          setSmtpConnected(true);
                          setSmtpPassword("");
                          setSmtpStatus({ type: "success", msg: "SMTP connected — emails will now send from this account." });
                        } else {
                          setSmtpStatus({ type: "error", msg: data.detail || "Save failed" });
                        }
                      } catch (e) {
                        setSmtpStatus({ type: "error", msg: e instanceof Error ? e.message : "Request failed" });
                      }
                      setSmtpSaving(false);
                    }}
                    disabled={smtpSaving || !smtpHost || !smtpPassword || !smtpFromEmail || !currentUserId}
                    className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    {smtpSaving ? "Saving..." : "Save & connect"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* CRM Integrations */}
        <div className="mt-12 pt-8 border-t border-[var(--border-glass)]">
          <h2 className="text-xl font-bold text-[var(--white)] mb-1">CRM Integrations</h2>
          <p className="text-[var(--gray-muted)] text-sm mb-6">
            Connect your CRM to import jobs, photos, and documents directly into claims.
          </p>

          {crmError && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3 mb-4">
              {crmError}
            </div>
          )}

          <div className="space-y-4">
            {/* AccuLynx */}
            <div className="bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-xl p-6">
              {acculynxConnected ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--white)]">AccuLynx Connected</p>
                      <p className="text-xs text-[var(--gray-muted)]">
                        Connected {acculynxConnectedAt ? new Date(acculynxConnectedAt).toLocaleDateString() : ""}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      const { data: { user } } = await supabase.auth.getUser();
                      if (!user) return;
                      setCrmError("");
                      try {
                        await fetch(`${BACKEND_URL}/api/integrations/disconnect`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ provider: "acculynx", user_id: user.id }),
                        });
                        setAcculynxConnected(false);
                        setAcculynxConnectedAt(null);
                        setAcculynxKey("");
                      } catch { /* ignore */ }
                    }}
                    className="text-red-400 hover:text-red-300 text-sm font-medium transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-white/[0.06] rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-[var(--gray-dim)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--white)]">AccuLynx</p>
                      <p className="text-xs text-[var(--gray-muted)]">Import jobs, contacts, and insurance info</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <input
                      type="password"
                      value={acculynxKey}
                      onChange={(e) => setAcculynxKey(e.target.value)}
                      placeholder="Paste your AccuLynx API key"
                      className="flex-1 px-4 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-glass)] text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
                    />
                    <button
                      onClick={async () => {
                        if (!acculynxKey.trim()) return;
                        setAcculynxConnecting(true);
                        setCrmError("");
                        const { data: { user } } = await supabase.auth.getUser();
                        if (!user) return;
                        try {
                          const res = await fetch(`${BACKEND_URL}/api/integrations/connect`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ provider: "acculynx", api_key: acculynxKey.trim(), user_id: user.id }),
                          });
                          const data = await res.json();
                          if (data.ok) {
                            setAcculynxConnected(true);
                            setAcculynxConnectedAt(new Date().toISOString());
                          } else {
                            setCrmError(data.message || "Failed to connect AccuLynx");
                          }
                        } catch {
                          setCrmError("Failed to connect to AccuLynx");
                        }
                        setAcculynxConnecting(false);
                      }}
                      disabled={acculynxConnecting || !acculynxKey.trim()}
                      className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                    >
                      {acculynxConnecting ? "Testing..." : "Connect"}
                    </button>
                  </div>
                  <p className="text-[11px] text-[var(--gray-dim)] mt-2">
                    Find your API key in AccuLynx under Settings &rarr; API &amp; Integrations
                  </p>
                </div>
              )}
            </div>

            {/* CompanyCam */}
            <div className="bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-xl p-6">
              {companycamConnected ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--white)]">CompanyCam Connected</p>
                      <p className="text-xs text-[var(--gray-muted)]">
                        Connected {companycamConnectedAt ? new Date(companycamConnectedAt).toLocaleDateString() : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={async () => {
                        const { data: { user } } = await supabase.auth.getUser();
                        if (!user) return;
                        setVerifyingProvider("companycam");
                        setVerifyResult(null);
                        setCrmError("");
                        try {
                          const res = await fetch(`${BACKEND_URL}/api/integrations/test`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ provider: "companycam", user_id: user.id }),
                          });
                          const data = await res.json();
                          setVerifyResult({ provider: "companycam", ok: data.ok, message: data.message });
                          if (!data.ok) setCrmError(`CompanyCam: ${data.message}`);
                        } catch {
                          setVerifyResult({ provider: "companycam", ok: false, message: "Server unreachable" });
                        }
                        setVerifyingProvider(null);
                      }}
                      disabled={verifyingProvider === "companycam"}
                      className="text-[var(--cyan)] hover:text-[var(--cyan)]/80 text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      {verifyingProvider === "companycam" ? "Verifying..." : "Verify"}
                    </button>
                    <button
                      onClick={async () => {
                        const { data: { user } } = await supabase.auth.getUser();
                        if (!user) return;
                        setCrmError("");
                        try {
                          await fetch(`${BACKEND_URL}/api/integrations/disconnect`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ provider: "companycam", user_id: user.id }),
                          });
                          setCompanycamConnected(false);
                          setCompanycamConnectedAt(null);
                          setCompanycamKey("");
                          setVerifyResult(null);
                        } catch { /* ignore */ }
                      }}
                      className="text-red-400 hover:text-red-300 text-sm font-medium transition-colors"
                    >
                      Disconnect
                    </button>
                    {verifyResult?.provider === "companycam" && (
                      <span className={`text-xs ${verifyResult.ok ? "text-green-400" : "text-red-400"}`}>
                        {verifyResult.ok ? "Key valid" : "Key invalid — reconnect with a new key"}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-white/[0.06] rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-[var(--gray-dim)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--white)]">CompanyCam</p>
                      <p className="text-xs text-[var(--gray-muted)]">Import inspection photos with GPS and damage tags</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <input
                      type="password"
                      value={companycamKey}
                      onChange={(e) => setCompanycamKey(e.target.value)}
                      placeholder="Paste your CompanyCam API key"
                      className="flex-1 px-4 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-glass)] text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
                    />
                    <button
                      onClick={async () => {
                        if (!companycamKey.trim()) return;
                        setCompanycamConnecting(true);
                        setCrmError("");
                        const { data: { user } } = await supabase.auth.getUser();
                        if (!user) return;
                        try {
                          const res = await fetch(`${BACKEND_URL}/api/integrations/connect`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ provider: "companycam", api_key: companycamKey.trim(), user_id: user.id }),
                          });
                          const data = await res.json();
                          if (data.ok) {
                            setCompanycamConnected(true);
                            setCompanycamConnectedAt(new Date().toISOString());
                          } else {
                            setCrmError(data.message || "Failed to connect CompanyCam");
                          }
                        } catch {
                          setCrmError("Failed to connect to CompanyCam");
                        }
                        setCompanycamConnecting(false);
                      }}
                      disabled={companycamConnecting || !companycamKey.trim()}
                      className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                    >
                      {companycamConnecting ? "Testing..." : "Connect"}
                    </button>
                  </div>
                  <p className="text-[11px] text-[var(--gray-dim)] mt-2">
                    Find your API key in CompanyCam under Settings &rarr; Integrations &rarr; API
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Repair Pricing */}
        <div className="mt-12 pt-8 border-t border-[var(--border-glass)]">
          <h2 className="text-xl font-bold text-[var(--white)] mb-1">Repair Pricing</h2>
          <p className="text-[var(--gray-muted)] text-sm mb-6">
            Set your default pricing for repair jobs. These values are used when AI generates repair quotes.
          </p>

          <div className="bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-xl p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-[var(--white)] mb-1">Diagnostic Fee ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={repairPricing.diagnostic_fee}
                  onChange={(e) => setRepairPricing({ ...repairPricing, diagnostic_fee: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
                />
                <p className="text-[11px] text-[var(--gray-dim)] mt-1">Flat fee included in every repair</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--white)] mb-1">Labor Rate ($/hr)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={repairPricing.labor_rate_per_hour}
                  onChange={(e) => setRepairPricing({ ...repairPricing, labor_rate_per_hour: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--white)] mb-1">Material Markup (%)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="200"
                  value={repairPricing.markup_percent}
                  onChange={(e) => setRepairPricing({ ...repairPricing, markup_percent: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
                />
                <p className="text-[11px] text-[var(--gray-dim)] mt-1">Applied on top of material cost (20 = 20% markup)</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--white)] mb-1">Minimum Job Charge ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={repairPricing.minimum_job_charge}
                  onChange={(e) => setRepairPricing({ ...repairPricing, minimum_job_charge: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
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
                className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
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
          <h2 className="text-xl font-bold text-[var(--white)] mb-1">
            {isPasswordReset ? "Set Your Password" : "Change Password"}
          </h2>
          <p className="text-[var(--gray-muted)] text-sm mb-6">
            {isPasswordReset
              ? "Welcome! Set a password to finish setting up your account."
              : "Update your account password."}
          </p>

          <form onSubmit={handlePasswordUpdate} className="space-y-4 max-w-sm">
            <div>
              <label className="block text-sm font-semibold text-[var(--white)] mb-1">New Password</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                minLength={6}
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--white)] mb-1">Confirm Password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                minLength={6}
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
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
              className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 text-white px-8 py-3 rounded-xl font-semibold transition-colors text-sm"
            >
              {passwordSaving ? "Updating..." : "Update Password"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

function StripeConnectSection({ justConnected }: { justConnected?: boolean }) {
  const [status, setStatus] = useState<{
    connected: boolean;
    status: string;
    businessName?: string;
    chargesEnabled?: boolean;
    payoutsEnabled?: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    fetch("/api/stripe-connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status" }),
    })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ connected: false, status: "disconnected" }));
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await fetch("/api/stripe-connect");
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch {
      // fall through
    }
    setConnecting(false);
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect your Stripe account? You won't be able to send invoices from DumbRoof until you reconnect.")) return;
    setLoading(true);
    await fetch("/api/stripe-connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "disconnect" }),
    });
    setStatus({ connected: false, status: "disconnected" });
    setLoading(false);
  };

  return (
    <div className="mt-12 pt-8 border-t border-[var(--border-glass)]">
      <h2 className="text-xl font-bold text-[var(--white)] mb-1">Invoicing — Stripe Connect</h2>
      <p className="text-[var(--gray-muted)] text-sm mb-6">
        Connect your company&apos;s Stripe account to send invoices directly from DumbRoof.
        Payments go to your account — DumbRoof never touches the funds.
      </p>

      {justConnected && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-lg px-4 py-3 mb-4">
          Stripe account connected! You can now send invoices with payment links from DumbRoof.
        </div>
      )}

      <div className="bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-xl p-6">
        {status === null ? (
          <div className="text-sm text-[var(--gray-muted)]">Loading...</div>
        ) : status.connected ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#635bff]/20 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#635bff">
                    <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--white)]">
                    {status.businessName || "Connected Account"}
                  </p>
                  <p className="text-xs text-[var(--gray-muted)]">
                    {status.chargesEnabled && status.payoutsEnabled
                      ? "Ready to send invoices"
                      : "Onboarding in progress — complete setup in Stripe"}
                  </p>
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                status.status === "active"
                  ? "bg-green-500/10 text-green-400"
                  : "bg-amber-500/10 text-amber-400"
              }`}>
                {status.status === "active" ? "Connected" : "Pending"}
              </span>
            </div>

            <div className="flex gap-3">
              {status.status !== "active" && (
                <button
                  onClick={handleConnect}
                  disabled={connecting}
                  className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {connecting ? "Redirecting..." : "Complete Setup"}
                </button>
              )}
              <button
                onClick={handleDisconnect}
                disabled={loading}
                className="bg-[var(--bg-glass)] border border-[var(--border-glass)] text-[var(--gray)] px-5 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 hover:text-red-400 hover:border-red-400/30"
              >
                {loading ? "Disconnecting..." : "Disconnect"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-white/[0.06] flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#94a3b8">
                  <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--white)]">No Stripe account connected</p>
                <p className="text-xs text-[var(--gray-muted)]">
                  Connect your Stripe account to send invoices with payment links from DumbRoof
                </p>
              </div>
            </div>
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {connecting ? "Redirecting to Stripe..." : "Connect Stripe Account"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
