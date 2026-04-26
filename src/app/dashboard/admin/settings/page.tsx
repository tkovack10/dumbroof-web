"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { directUpload } from "@/lib/upload-utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TeamMember {
  id: string;
  email: string;
  last_sign_in: string | null;
  claims_count: number;
}

type RepVisibility = "own_only" | "all";
type ReportTemplate = "modern" | "classic" | "bold" | "minimal";

/* ------------------------------------------------------------------ */
/*  Collapsible Section                                                */
/* ------------------------------------------------------------------ */

function Section({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="glass-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-5 text-left"
      >
        <div>
          <h2 className="text-lg font-bold text-[var(--white)]">{title}</h2>
          <p className="text-sm text-[var(--gray-muted)] mt-0.5">{description}</p>
        </div>
        <svg
          className={`w-5 h-5 text-[var(--gray-dim)] transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-6 pb-6 border-t border-[var(--border-glass)]">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Save button helper                                                 */
/* ------------------------------------------------------------------ */

function SaveButton({
  saving,
  saved,
  onClick,
  label = "Save",
}: {
  saving: boolean;
  saved: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-4 pt-4">
      <button
        type="button"
        onClick={onClick}
        disabled={saving}
        className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 text-white px-6 py-2.5 rounded-xl font-semibold transition-all text-sm"
      >
        {saving ? "Saving..." : label}
      </button>
      {saved && <span className="text-green-400 text-sm font-medium">Saved successfully</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Status badge (connected / not connected)                           */
/* ------------------------------------------------------------------ */

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span
      className={`px-2.5 py-1 rounded-full text-xs font-bold ${
        connected ? "bg-green-500/10 text-green-400" : "bg-white/[0.06] text-[var(--gray-dim)]"
      }`}
    >
      {connected ? "Connected" : "Not Connected"}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function AdminSettingsPage() {
  const supabase = createClient();
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

  /* ---------- loading ---------- */
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("");

  /* ---------- company info ---------- */
  const [companyForm, setCompanyForm] = useState({
    company_name: "",
    address: "",
    city_state_zip: "",
    phone: "",
    email: "",
    website: "",
    license_number: "",
    contact_name: "",
    contact_title: "",
  });
  const [companySaving, setCompanySaving] = useState(false);
  const [companySaved, setCompanySaved] = useState(false);

  /* ---------- logo ---------- */
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoSaved, setLogoSaved] = useState(false);

  /* ---------- CRM integrations ---------- */
  const [acculynxKey, setAcculynxKey] = useState("");
  const [acculynxConnected, setAcculynxConnected] = useState(false);
  const [acculynxConnectedAt, setAcculynxConnectedAt] = useState<string | null>(null);
  const [acculynxConnecting, setAcculynxConnecting] = useState(false);

  const [companycamKey, setCompanycamKey] = useState("");
  const [companycamConnected, setCompanycamConnected] = useState(false);
  const [companycamConnectedAt, setCompanycamConnectedAt] = useState<string | null>(null);
  const [companycamConnecting, setCompanycamConnecting] = useState(false);

  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState("");
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [gmailDisconnecting, setGmailDisconnecting] = useState(false);

  const [crmError, setCrmError] = useState("");
  const [verifyingProvider, setVerifyingProvider] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<{ provider: string; ok: boolean; message: string } | null>(null);

  /* ---------- rep visibility ---------- */
  const [repVisibility, setRepVisibility] = useState<RepVisibility>("own_only");
  const [repVisSaving, setRepVisSaving] = useState(false);
  const [repVisSaved, setRepVisSaved] = useState(false);

  /* ---------- report customization ---------- */
  const [reportTemplate, setReportTemplate] = useState<ReportTemplate>("modern");
  const [reportPrimary, setReportPrimary] = useState("#ff3cac");
  const [reportAccent, setReportAccent] = useState("#2b86c5");
  const [reportSaving, setReportSaving] = useState(false);
  const [reportSaved, setReportSaved] = useState(false);

  /* ---------- W9 ---------- */
  const [w9File, setW9File] = useState<File | null>(null);
  const [w9Path, setW9Path] = useState<string | null>(null);
  const [w9FileName, setW9FileName] = useState<string | null>(null);
  const [w9Saving, setW9Saving] = useState(false);
  const [w9Saved, setW9Saved] = useState(false);

  /* ---------- team ---------- */
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);

  /* ---------------------------------------------------------------- */
  /*  Load profile                                                     */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    async function loadProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data } = await supabase
        .from("company_profiles")
        .select("*")
        .eq("user_id", user.id)
        .limit(1);

      const profile = data?.[0];
      if (profile) {
        setCompanyForm({
          company_name: profile.company_name || "",
          address: profile.address || "",
          city_state_zip: profile.city_state_zip || "",
          phone: profile.phone || "",
          email: profile.email || "",
          website: profile.website || "",
          license_number: profile.license_number || "",
          contact_name: profile.contact_name || "",
          contact_title: profile.contact_title || "",
        });

        // Gmail
        if (profile.gmail_refresh_token) {
          setGmailConnected(true);
          setGmailEmail(profile.sending_email || profile.email || "");
        }

        // CRM
        if (profile.acculynx_api_key) {
          setAcculynxConnected(true);
          setAcculynxConnectedAt(profile.acculynx_connected_at);
        }
        if (profile.companycam_api_key) {
          setCompanycamConnected(true);
          setCompanycamConnectedAt(profile.companycam_connected_at);
        }

        // Logo
        if (profile.logo_path) {
          setLogoPath(profile.logo_path);
          const { data: signedData } = await supabase.storage
            .from("claim-documents")
            .createSignedUrl(profile.logo_path, 3600);
          if (signedData?.signedUrl) {
            setLogoPreview(signedData.signedUrl);
          }
        }

        // Rep visibility
        if (profile.rep_visibility) {
          setRepVisibility(profile.rep_visibility as RepVisibility);
        }

        // Report customization
        if (profile.report_template) {
          setReportTemplate(profile.report_template as ReportTemplate);
        }
        if (profile.report_color_scheme) {
          const scheme =
            typeof profile.report_color_scheme === "string"
              ? JSON.parse(profile.report_color_scheme)
              : profile.report_color_scheme;
          if (scheme.primary) setReportPrimary(scheme.primary);
          if (scheme.accent) setReportAccent(scheme.accent);
        }

        // W9
        if (profile.w9_path) {
          setW9Path(profile.w9_path);
          const parts = profile.w9_path.split("/");
          setW9FileName(parts[parts.length - 1]);
        }
      }

      setLoading(false);
    }
    loadProfile();
  }, [supabase]);

  /* ---------------------------------------------------------------- */
  /*  Load team members                                                */
  /* ---------------------------------------------------------------- */

  const loadTeam = useCallback(async () => {
    setTeamLoading(true);
    try {
      const res = await fetch("/api/admin/team");
      if (res.ok) {
        const data = await res.json();
        setTeamMembers(data.members || []);
      }
    } catch {
      // ignore
    }
    setTeamLoading(false);
  }, []);

  useEffect(() => {
    if (!loading) loadTeam();
  }, [loading, loadTeam]);

  /* ---------------------------------------------------------------- */
  /*  Helpers                                                          */
  /* ---------------------------------------------------------------- */

  const upsertProfile = async (fields: Record<string, unknown>) => {
    await supabase.from("company_profiles").upsert(
      { user_id: userId, ...fields, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  };

  const flashSaved = (setter: (v: boolean) => void) => {
    setter(true);
    setTimeout(() => setter(false), 3000);
  };

  /* ---------------------------------------------------------------- */
  /*  Save handlers                                                    */
  /* ---------------------------------------------------------------- */

  const saveCompanyInfo = async () => {
    setCompanySaving(true);
    setCompanySaved(false);
    await upsertProfile(companyForm);
    setCompanySaving(false);
    flashSaved(setCompanySaved);
  };

  const saveLogo = async () => {
    if (!logoFile) return;
    setLogoSaving(true);
    setLogoSaved(false);

    try {
      const ext = logoFile.name.split(".").pop();
      const uploadPath = `${userId}/branding/logo.${ext}`;

      // Sign the upload URL
      const signRes = await fetch("/api/storage/sign-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder: "branding",
          fileName: `logo.${ext}`,
          claimPath: `company/${userId}`,
        }),
      });

      if (signRes.ok) {
        const signData = await signRes.json();
        await directUpload(signData.signedUrl, logoFile);
        await upsertProfile({ logo_path: signData.path });
        setLogoPath(signData.path);
      } else {
        // Fallback: direct SDK upload
        await supabase.storage
          .from("claim-documents")
          .upload(uploadPath, logoFile, { upsert: true });
        await upsertProfile({ logo_path: uploadPath });
        setLogoPath(uploadPath);
      }

      setLogoFile(null);
      flashSaved(setLogoSaved);
    } catch (err) {
      console.error("Logo upload failed:", err);
    }

    setLogoSaving(false);
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Revoke old blob URL to prevent memory leak
      if (logoPreview && logoPreview.startsWith("blob:")) {
        URL.revokeObjectURL(logoPreview);
      }
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const saveRepVisibility = async () => {
    setRepVisSaving(true);
    setRepVisSaved(false);
    await upsertProfile({ rep_visibility: repVisibility });
    setRepVisSaving(false);
    flashSaved(setRepVisSaved);
  };

  const saveReportCustomization = async () => {
    setReportSaving(true);
    setReportSaved(false);
    await upsertProfile({
      report_template: reportTemplate,
      report_color_scheme: { primary: reportPrimary, accent: reportAccent },
    });
    setReportSaving(false);
    flashSaved(setReportSaved);
  };

  const saveW9 = async () => {
    if (!w9File) return;
    setW9Saving(true);
    setW9Saved(false);

    try {
      const safeName = w9File.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const uploadPath = `${userId}/documents/${safeName}`;

      const signRes = await fetch("/api/storage/sign-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder: "documents",
          fileName: safeName,
          claimPath: `company/${userId}`,
        }),
      });

      if (signRes.ok) {
        const signData = await signRes.json();
        await directUpload(signData.signedUrl, w9File);
        await upsertProfile({ w9_path: signData.path });
        setW9Path(signData.path);
        setW9FileName(safeName);
      } else {
        // Fallback: direct SDK upload
        await supabase.storage
          .from("claim-documents")
          .upload(uploadPath, w9File, { upsert: true });
        await upsertProfile({ w9_path: uploadPath });
        setW9Path(uploadPath);
        setW9FileName(safeName);
      }

      flashSaved(setW9Saved);
    } catch (err) {
      console.error("W9 upload failed:", err);
    }

    setW9Saving(false);
  };

  const handleW9Change = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setW9File(file);
  };

  const downloadW9 = async () => {
    if (!w9Path) return;
    const { data } = await supabase.storage
      .from("claim-documents")
      .createSignedUrl(w9Path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  /* ---- CRM handlers ---- */

  const connectCRM = async (provider: "acculynx" | "companycam", apiKey: string) => {
    if (!apiKey.trim()) return;
    const setConnecting = provider === "acculynx" ? setAcculynxConnecting : setCompanycamConnecting;
    setConnecting(true);
    setCrmError("");

    try {
      const res = await fetch(`${BACKEND_URL}/api/integrations/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, api_key: apiKey.trim(), user_id: userId }),
      });
      const data = await res.json();
      if (data.ok) {
        if (provider === "acculynx") {
          setAcculynxConnected(true);
          setAcculynxConnectedAt(new Date().toISOString());
        } else {
          setCompanycamConnected(true);
          setCompanycamConnectedAt(new Date().toISOString());
        }
      } else {
        setCrmError(data.message || `Failed to connect ${provider}`);
      }
    } catch {
      setCrmError(`Failed to connect to ${provider}`);
    }

    setConnecting(false);
  };

  const disconnectCRM = async (provider: "acculynx" | "companycam") => {
    setCrmError("");
    try {
      await fetch(`${BACKEND_URL}/api/integrations/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, user_id: userId }),
      });
      if (provider === "acculynx") {
        setAcculynxConnected(false);
        setAcculynxConnectedAt(null);
        setAcculynxKey("");
      } else {
        setCompanycamConnected(false);
        setCompanycamConnectedAt(null);
        setCompanycamKey("");
      }
    } catch {
      /* ignore */
    }
  };

  const verifyCRM = async (provider: "acculynx" | "companycam") => {
    setVerifyingProvider(provider);
    setVerifyResult(null);
    setCrmError("");
    try {
      const res = await fetch(`${BACKEND_URL}/api/integrations/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, user_id: userId }),
      });
      const data = await res.json();
      setVerifyResult({ provider, ok: data.ok, message: data.message });
      if (!data.ok) {
        setCrmError(`${provider === "companycam" ? "CompanyCam" : "AccuLynx"}: ${data.message}`);
      }
    } catch {
      setVerifyResult({ provider, ok: false, message: "Failed to reach server" });
      setCrmError("Could not verify connection — server unreachable");
    }
    setVerifyingProvider(null);
  };

  const connectGmail = async () => {
    setGmailConnecting(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/gmail-auth/authorize?user_id=${userId}`);
      const data = await res.json();
      if (data.auth_url) window.location.href = data.auth_url;
    } catch {
      setGmailConnecting(false);
    }
  };

  const disconnectGmail = async () => {
    setGmailDisconnecting(true);
    try {
      await fetch(`${BACKEND_URL}/api/gmail-auth/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      setGmailConnected(false);
      setGmailEmail("");
    } catch {
      /* ignore */
    }
    setGmailDisconnecting(false);
  };

  /* ---------------------------------------------------------------- */
  /*  Field config                                                     */
  /* ---------------------------------------------------------------- */

  const companyFields = [
    { key: "company_name", label: "Company Name", placeholder: "Acme Roofing LLC" },
    { key: "address", label: "Street Address", placeholder: "123 Main St, Suite 100" },
    { key: "city_state_zip", label: "City, State ZIP", placeholder: "Bensalem, PA 19020" },
    { key: "phone", label: "Phone", placeholder: "267-555-0100" },
    { key: "email", label: "Email", placeholder: "info@yourcompany.com" },
    { key: "website", label: "Website", placeholder: "www.yourcompany.com" },
    { key: "license_number", label: "License Number", placeholder: "HIC-0654321" },
    { key: "contact_name", label: "Primary Contact Name", placeholder: "John Smith" },
    { key: "contact_title", label: "Title", placeholder: "CEO / Owner / Project Manager" },
  ];

  const templateOptions: { value: ReportTemplate; label: string; desc: string }[] = [
    { value: "modern", label: "Modern", desc: "Clean gradients and glassmorphism" },
    { value: "classic", label: "Classic", desc: "Traditional professional layout" },
    { value: "bold", label: "Bold", desc: "High-contrast with accent borders" },
    { value: "minimal", label: "Minimal", desc: "Simple and text-focused" },
  ];

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  if (loading) {
    return (
      <div className="p-6 lg:p-8 flex items-center justify-center min-h-[60vh]">
        <p className="text-[var(--gray-dim)]">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8 pl-10 lg:pl-0">
          <h1 className="text-2xl font-bold gradient-text">Company Settings</h1>
          <p className="text-[var(--gray-muted)] mt-1 text-sm">
            Branding, integrations, team visibility, and company configuration.
          </p>
        </div>

        <div className="space-y-4">
          {/* ============================================================ */}
          {/*  1. Company Information                                       */}
          {/* ============================================================ */}
          <Section
            title="Company Information"
            description="Your company details for generated claim documents."
            defaultOpen
          >
            <div className="space-y-4 pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {companyFields.map(({ key, label, placeholder }) => (
                  <div key={key} className={key === "company_name" ? "sm:col-span-2" : ""}>
                    <label className="block text-sm font-semibold text-[var(--white)] mb-1">
                      {label}
                    </label>
                    <input
                      type="text"
                      value={companyForm[key as keyof typeof companyForm]}
                      onChange={(e) => setCompanyForm({ ...companyForm, [key]: e.target.value })}
                      placeholder={placeholder}
                      className="w-full px-4 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-glass)] text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
                    />
                  </div>
                ))}
              </div>
              <SaveButton saving={companySaving} saved={companySaved} onClick={saveCompanyInfo} label="Save Company Info" />
            </div>
          </Section>

          {/* ============================================================ */}
          {/*  2. Logo Upload                                               */}
          {/* ============================================================ */}
          <Section title="Company Logo" description="Appears on all generated PDFs and claim documents.">
            <div className="pt-4">
              <div className="flex items-center gap-6">
                <div className="w-24 h-24 rounded-xl bg-white/[0.06] border-2 border-dashed border-[var(--border-glass)] flex items-center justify-center overflow-hidden flex-shrink-0">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" />
                  ) : (
                    <svg
                      className="w-8 h-8 text-[var(--gray-dim)]"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
                      />
                    </svg>
                  )}
                </div>
                <div>
                  <label className="cursor-pointer bg-[var(--bg-glass)] border border-[var(--border-glass)] hover:border-[var(--cyan)]/30 px-4 py-2 rounded-lg text-sm font-medium text-[var(--gray)] transition-colors inline-block">
                    {logoPath ? "Replace Logo" : "Upload Logo"}
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.svg"
                      onChange={handleLogoChange}
                      className="hidden"
                    />
                  </label>
                  <p className="text-xs text-[var(--gray-dim)] mt-1">
                    JPG, PNG, or SVG. Recommended 400x400px.
                  </p>
                </div>
              </div>
              {logoFile && (
                <SaveButton saving={logoSaving} saved={logoSaved} onClick={saveLogo} label="Upload Logo" />
              )}
            </div>
          </Section>

          {/* ============================================================ */}
          {/*  3. CRM Integrations                                          */}
          {/* ============================================================ */}
          <Section title="CRM Integrations" description="Connect your tools to import jobs, photos, and documents.">
            <div className="space-y-4 pt-4">
              {crmError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
                  {crmError}
                </div>
              )}

              {/* AccuLynx */}
              <div className="bg-white/[0.04] border border-[var(--border-glass)] rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${acculynxConnected ? "bg-green-500/10" : "bg-white/[0.06]"}`}>
                      <svg className={`w-5 h-5 ${acculynxConnected ? "text-green-400" : "text-[var(--gray-dim)]"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={acculynxConnected ? 2 : 1.5}>
                        {acculynxConnected ? (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
                        )}
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--white)]">AccuLynx</p>
                      <p className="text-xs text-[var(--gray-muted)]">
                        {acculynxConnected
                          ? `Connected ${acculynxConnectedAt ? new Date(acculynxConnectedAt).toLocaleDateString() : ""}`
                          : "Import jobs, contacts, and insurance info"}
                      </p>
                    </div>
                  </div>
                  <StatusBadge connected={acculynxConnected} />
                </div>
                {acculynxConnected ? (
                  <button
                    onClick={() => disconnectCRM("acculynx")}
                    className="text-red-400 hover:text-red-300 text-sm font-medium transition-colors"
                  >
                    Disconnect
                  </button>
                ) : (
                  <div>
                    <div className="flex gap-3">
                      <input
                        type="password"
                        value={acculynxKey}
                        onChange={(e) => setAcculynxKey(e.target.value)}
                        placeholder="Paste your AccuLynx API key"
                        className="flex-1 px-4 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-glass)] text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
                      />
                      <button
                        onClick={() => connectCRM("acculynx", acculynxKey)}
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
              <div className="bg-white/[0.04] border border-[var(--border-glass)] rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${companycamConnected ? "bg-green-500/10" : "bg-white/[0.06]"}`}>
                      <svg className={`w-5 h-5 ${companycamConnected ? "text-green-400" : "text-[var(--gray-dim)]"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={companycamConnected ? 2 : 1.5}>
                        {companycamConnected ? (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                        )}
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--white)]">CompanyCam</p>
                      <p className="text-xs text-[var(--gray-muted)]">
                        {companycamConnected
                          ? `Connected ${companycamConnectedAt ? new Date(companycamConnectedAt).toLocaleDateString() : ""}`
                          : "Import inspection photos with GPS and damage tags"}
                      </p>
                    </div>
                  </div>
                  <StatusBadge connected={companycamConnected} />
                </div>
                {companycamConnected ? (
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => verifyCRM("companycam")}
                      disabled={verifyingProvider === "companycam"}
                      className="text-[var(--cyan)] hover:text-[var(--cyan)]/80 text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      {verifyingProvider === "companycam" ? "Verifying..." : "Verify Connection"}
                    </button>
                    <button
                      onClick={() => disconnectCRM("companycam")}
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
                ) : (
                  <div>
                    <div className="flex gap-3">
                      <input
                        type="password"
                        value={companycamKey}
                        onChange={(e) => setCompanycamKey(e.target.value)}
                        placeholder="Paste your CompanyCam API key"
                        className="flex-1 px-4 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-glass)] text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
                      />
                      <button
                        onClick={() => connectCRM("companycam", companycamKey)}
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

              {/* Gmail */}
              <div className="bg-white/[0.04] border border-[var(--border-glass)] rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${gmailConnected ? "bg-green-500/10" : "bg-white/[0.06]"}`}>
                      <svg className={`w-5 h-5 ${gmailConnected ? "text-green-400" : "text-[var(--gray-dim)]"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={gmailConnected ? 2 : 1.5}>
                        {gmailConnected ? (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                        )}
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--white)]">Gmail</p>
                      <p className="text-xs text-[var(--gray-muted)]">
                        {gmailConnected
                          ? <>Sending from <strong>{gmailEmail}</strong></>
                          : "Send emails from Claim Brain as yourself"}
                      </p>
                    </div>
                  </div>
                  <StatusBadge connected={gmailConnected} />
                </div>
                {gmailConnected ? (
                  <button
                    onClick={disconnectGmail}
                    disabled={gmailDisconnecting}
                    className="text-red-400 hover:text-red-300 text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {gmailDisconnecting ? "Disconnecting..." : "Disconnect"}
                  </button>
                ) : (
                  <button
                    onClick={connectGmail}
                    disabled={gmailConnecting}
                    className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    {gmailConnecting ? "Connecting..." : "Connect Gmail"}
                  </button>
                )}
              </div>

              {/* EagleView — Coming Soon */}
              <div className="bg-white/[0.04] border border-[var(--border-glass)] rounded-xl p-5 opacity-60">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/[0.06] rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-[var(--gray-dim)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--white)]">EagleView</p>
                      <p className="text-xs text-[var(--gray-muted)]">Auto-import aerial measurements</p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--purple)]/10 text-[var(--purple)]">
                    Coming Soon
                  </span>
                </div>
              </div>

              {/* HOVER — Coming Soon */}
              <div className="bg-white/[0.04] border border-[var(--border-glass)] rounded-xl p-5 opacity-60">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/[0.06] rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-[var(--gray-dim)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 21v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21m0 0h4.5V3.545M12.75 21h7.5V10.75M2.25 21h1.5m18 0h-18M2.25 9l4.5-1.636M18.75 3l-1.5.545m0 6.205l3 1m1.5.5l-1.5-.5M6.75 7.364V3h-3v18m3-13.636l10.5-3.819" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--white)]">HOVER</p>
                      <p className="text-xs text-[var(--gray-muted)]">3D property models and measurements</p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--purple)]/10 text-[var(--purple)]">
                    Coming Soon
                  </span>
                </div>
              </div>
            </div>
          </Section>

          {/* ============================================================ */}
          {/*  4. Rep Visibility                                            */}
          {/* ============================================================ */}
          <Section title="Rep Visibility" description="Control what claims your sales reps can see.">
            <div className="pt-4 space-y-3">
              <label className="flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors bg-white/[0.04] border-[var(--border-glass)] hover:border-[var(--cyan)]/30">
                <input
                  type="radio"
                  name="rep_visibility"
                  value="own_only"
                  checked={repVisibility === "own_only"}
                  onChange={() => setRepVisibility("own_only")}
                  className="mt-0.5 accent-[var(--cyan)]"
                />
                <div>
                  <p className="text-sm font-semibold text-[var(--white)]">Own Claims Only</p>
                  <p className="text-xs text-[var(--gray-muted)]">
                    Each rep sees only claims they submitted. Best for competitive teams.
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors bg-white/[0.04] border-[var(--border-glass)] hover:border-[var(--cyan)]/30">
                <input
                  type="radio"
                  name="rep_visibility"
                  value="all"
                  checked={repVisibility === "all"}
                  onChange={() => setRepVisibility("all")}
                  className="mt-0.5 accent-[var(--cyan)]"
                />
                <div>
                  <p className="text-sm font-semibold text-[var(--white)]">All Company Claims</p>
                  <p className="text-xs text-[var(--gray-muted)]">
                    Reps see every claim across the company. Best for collaborative teams.
                  </p>
                </div>
              </label>
              <SaveButton saving={repVisSaving} saved={repVisSaved} onClick={saveRepVisibility} label="Save Visibility" />
            </div>
          </Section>

          {/* ============================================================ */}
          {/*  5. Report Customization                                      */}
          {/* ============================================================ */}
          <Section title="Report Customization" description="Choose the look of your generated claim documents.">
            <div className="pt-4 space-y-6">
              {/* Template */}
              <div>
                <p className="text-sm font-semibold text-[var(--white)] mb-3">Template Style</p>
                <div className="grid grid-cols-2 gap-3">
                  {templateOptions.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors bg-white/[0.04] ${
                        reportTemplate === opt.value
                          ? "border-[var(--cyan)] ring-1 ring-[var(--cyan)]"
                          : "border-[var(--border-glass)] hover:border-[var(--cyan)]/30"
                      }`}
                    >
                      <input
                        type="radio"
                        name="report_template"
                        value={opt.value}
                        checked={reportTemplate === opt.value}
                        onChange={() => setReportTemplate(opt.value)}
                        className="mt-0.5 accent-[var(--cyan)]"
                      />
                      <div>
                        <p className="text-sm font-semibold text-[var(--white)]">{opt.label}</p>
                        <p className="text-xs text-[var(--gray-muted)]">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Color scheme */}
              <div>
                <p className="text-sm font-semibold text-[var(--white)] mb-3">Color Scheme</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-[var(--gray-muted)] mb-1">Primary Color</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={reportPrimary}
                        onChange={(e) => setReportPrimary(e.target.value)}
                        className="w-10 h-10 rounded-lg border border-[var(--border-glass)] bg-transparent cursor-pointer"
                      />
                      <input
                        type="text"
                        value={reportPrimary}
                        onChange={(e) => setReportPrimary(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-glass)] text-[var(--white)] text-sm font-mono focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--gray-muted)] mb-1">Accent Color</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={reportAccent}
                        onChange={(e) => setReportAccent(e.target.value)}
                        className="w-10 h-10 rounded-lg border border-[var(--border-glass)] bg-transparent cursor-pointer"
                      />
                      <input
                        type="text"
                        value={reportAccent}
                        onChange={(e) => setReportAccent(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-glass)] text-[var(--white)] text-sm font-mono focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <SaveButton saving={reportSaving} saved={reportSaved} onClick={saveReportCustomization} label="Save Report Settings" />
            </div>
          </Section>

          {/* ============================================================ */}
          {/*  6. W9 Upload                                                 */}
          {/* ============================================================ */}
          <Section title="W9 Document" description="Upload your W-9 for carrier payment processing.">
            <div className="pt-4">
              {w9Path && (
                <div className="flex items-center gap-3 mb-4 bg-white/[0.04] rounded-lg px-4 py-3">
                  <svg className="w-5 h-5 text-[var(--cyan)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--white)] truncate">{w9FileName}</p>
                    <p className="text-xs text-[var(--gray-muted)]">Current W9 on file</p>
                  </div>
                  <button
                    onClick={downloadW9}
                    className="text-[var(--cyan)] hover:text-[var(--cyan)]/80 text-sm font-medium transition-colors flex-shrink-0"
                  >
                    Download
                  </button>
                </div>
              )}

              <label className="cursor-pointer bg-[var(--bg-glass)] border border-[var(--border-glass)] hover:border-[var(--cyan)]/30 px-4 py-2 rounded-lg text-sm font-medium text-[var(--gray)] transition-colors inline-block">
                {w9Path ? "Replace W9" : "Upload W9"}
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleW9Change}
                  className="hidden"
                />
              </label>
              <p className="text-xs text-[var(--gray-dim)] mt-1">PDF only.</p>

              {w9File && (
                <div className="mt-2">
                  <p className="text-sm text-[var(--gray)] mb-2">
                    Selected: <strong>{w9File.name}</strong>
                  </p>
                  <SaveButton saving={w9Saving} saved={w9Saved} onClick={saveW9} label="Upload W9" />
                </div>
              )}
            </div>
          </Section>

          {/* ============================================================ */}
          {/*  7. Team Members                                              */}
          {/* ============================================================ */}
          <Section title="Team Members" description="Users that share your company email domain.">
            <div className="pt-4">
              {teamLoading ? (
                <p className="text-sm text-[var(--gray-dim)]">Loading team...</p>
              ) : teamMembers.length === 0 ? (
                <p className="text-sm text-[var(--gray-dim)]">No team members found.</p>
              ) : (
                <div className="space-y-2">
                  {/* Header */}
                  <div className="grid grid-cols-12 gap-3 px-4 py-2 text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider">
                    <div className="col-span-5">Email</div>
                    <div className="col-span-4">Last Sign In</div>
                    <div className="col-span-3 text-right">Claims</div>
                  </div>
                  {teamMembers.map((member) => (
                    <div
                      key={member.id}
                      className="grid grid-cols-12 gap-3 items-center bg-white/[0.04] rounded-lg px-4 py-3"
                    >
                      <div className="col-span-5 min-w-0">
                        <p className="text-sm font-medium text-[var(--white)] truncate">
                          {member.email}
                        </p>
                      </div>
                      <div className="col-span-4">
                        <p className="text-sm text-[var(--gray-muted)]">
                          {member.last_sign_in
                            ? new Date(member.last_sign_in).toLocaleDateString()
                            : "Never"}
                        </p>
                      </div>
                      <div className="col-span-3 text-right">
                        <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full text-xs font-bold bg-[var(--bg-glass)] text-[var(--white)]">
                          {member.claims_count}
                        </span>
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-[var(--gray-dim)] pt-2">
                    {teamMembers.length} team member{teamMembers.length !== 1 ? "s" : ""} total.
                    Invite and role management coming soon.
                  </p>
                </div>
              )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
