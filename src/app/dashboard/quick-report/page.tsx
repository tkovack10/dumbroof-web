"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { FileUploadZone } from "@/components/file-upload-zone";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { useBillingQuota } from "@/hooks/use-billing-quota";
import { uploadFilesBatched } from "@/lib/upload-utils";
import { CrmImportModal } from "@/components/crm-import-modal";

type UploadStatus = "idle" | "uploading" | "success" | "error";

const ROOF_MATERIALS = [
  "3-Tab Asphalt Shingle",
  "Architectural / Laminate Shingle",
  "Metal (Standing Seam)",
  "Metal (Corrugated / R-Panel)",
  "EPDM / Rubber",
  "TPO",
  "PVC",
  "Modified Bitumen",
  "Built-Up (BUR)",
  "Clay Tile",
  "Concrete Tile",
  "Slate",
  "Wood Shake / Shingle",
  "Other",
];

export default function QuickReportPage() {
  const [propertyAddress, setPropertyAddress] = useState("");
  const quota = useBillingQuota();
  const [homeownerName, setHomeownerName] = useState("");
  const [insuranceCarrier, setInsuranceCarrier] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [crmPhotoCount, setCrmPhotoCount] = useState(0);
  const [crmSlug, setCrmSlug] = useState("");
  const [dateOfLoss, setDateOfLoss] = useState("");
  const [roofMaterial, setRoofMaterial] = useState("");
  const [damageType, setDamageType] = useState<"" | "hail" | "wind" | "combined">("");
  const [scanningStorms, setScanningStorms] = useState(false);
  const [stormResults, setStormResults] = useState<
    Array<{ date: string; type: string; details: string }> | null
  >(null);
  const [stormReason, setStormReason] = useState<string | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [uploadProgress, setUploadProgress] = useState("");
  const [showCrmModal, setShowCrmModal] = useState(false);
  const [crmIntegrations, setCrmIntegrations] = useState<{ acculynx: boolean; companycam: boolean }>({ acculynx: false, companycam: false });
  const [crmUserId, setCrmUserId] = useState("");
  const [importedPhotoNote, setImportedPhotoNote] = useState("");
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

  useEffect(() => {
    async function checkIntegrations() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCrmUserId(user.id);
      try {
        const res = await fetch(`${BACKEND_URL}/api/integrations/status?user_id=${user.id}`);
        if (res.ok) {
          const data = await res.json();
          setCrmIntegrations({ acculynx: !!data.acculynx, companycam: !!data.companycam });
        }
      } catch { /* ignore */ }
    }
    checkIntegrations();
  }, [BACKEND_URL]);

  const canSubmit =
    propertyAddress.trim() !== "" &&
    (photoFiles.length > 0 || crmPhotoCount > 0) &&
    roofMaterial !== "" &&
    dateOfLoss !== "" &&
    (quota === null || quota.allowed);

  const scanForStorms = async () => {
    setScanningStorms(true);
    setStormResults(null);
    setStormReason(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/noaa-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: propertyAddress }),
      });
      const data = await res.json();
      setStormResults(data.storms || []);
      setStormReason(data.reason || null);
    } catch {
      setStormResults([]);
      setStormReason("noaa_unavailable");
    } finally {
      setScanningStorms(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setStatus("uploading");
    setErrorMsg("");

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Reuse CRM slug if photos were imported, otherwise generate new
      const slug = crmSlug ||
        (propertyAddress
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") +
        `-${Date.now()}`);
      const claimPath = `${user.id}/${slug}`;

      // Upload manual photos (skip if only CRM photos)
      let uploadedPhotoNames: string[] = [];
      if (photoFiles.length > 0) {
        setUploadProgress("Uploading photos...");
        const pResult = await uploadFilesBatched(supabase, photoFiles, "photos", claimPath, {
          concurrency: 3,
          onProgress: (done, total) => setUploadProgress(`Uploading photos... ${done}/${total}`),
        });
        uploadedPhotoNames = pResult.uploaded;
      }

      const { error: dbError } = await supabase.from("claims").insert({
        user_id: user.id,
        address: propertyAddress,
        ...(homeownerName.trim() ? { homeowner_name: homeownerName.trim() } : {}),
        carrier: insuranceCarrier || "",
        slug,
        phase: "pre-scope",
        status: "uploaded",
        file_path: claimPath,
        measurement_files: [],
        photo_files: uploadedPhotoNames,
        scope_files: [],
        weather_files: [],
        date_of_loss: dateOfLoss,
        report_mode: "forensic_only",
        estimate_request: {
          roof_material: roofMaterial,
          ...(damageType ? { damage_type: damageType } : {}),
        },
      });

      if (dbError) throw new Error(dbError.message);

      await fetch("/api/billing/check-quota", { method: "POST" });
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
    }
  };

  if (status === "success") {
    return (
      <div className="min-h-screen p-6">
        <div className="max-w-2xl mx-auto mt-20 text-center">
          <div className="w-20 h-20 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-[var(--white)] mb-2">Forensic Report Submitted</h2>
          <p className="text-[var(--gray-muted)] mb-6">
            Your photos are being analyzed. The forensic causation report will be ready in minutes.
          </p>
          <a
            href="/dashboard"
            className="inline-flex items-center gap-2 bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] text-white px-6 py-3 rounded-xl font-semibold transition-colors"
          >
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <a href="/dashboard" className="text-sm text-[var(--gray-dim)] hover:text-[var(--white)] transition-colors mb-4 inline-block">
            &larr; Back to Dashboard
          </a>
          <h1 className="text-2xl font-bold text-[var(--white)]">Quick Forensic Report</h1>
          <p className="text-[var(--gray-muted)] text-sm mt-1">
            Generate a forensic causation report in minutes. No measurements needed &mdash; just photos, address, and date of loss.
          </p>
        </div>

        {/* CRM Import */}
        {(crmIntegrations.acculynx || crmIntegrations.companycam) && (
          <div className="mb-6 p-4 rounded-xl bg-white/[0.04] border border-[var(--border-glass)] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[var(--cyan)]/10 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-[var(--cyan)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--white)]">Import from CRM</p>
                <p className="text-xs text-[var(--gray-muted)]">
                  Pull photos from {[crmIntegrations.acculynx && "AccuLynx", crmIntegrations.companycam && "CompanyCam"].filter(Boolean).join(" or ")}
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowCrmModal(true)}
              className="bg-white/[0.08] hover:bg-white/[0.12] border border-[var(--border-glass)] text-[var(--white)] px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Import
            </button>
          </div>
        )}

        {importedPhotoNote && (
          <div className="mb-4 bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-lg px-4 py-3">
            {importedPhotoNote}
          </div>
        )}

        <CrmImportModal
          open={showCrmModal}
          onClose={() => setShowCrmModal(false)}
          integrations={crmIntegrations}
          backendUrl={BACKEND_URL}
          userId={crmUserId}
          onImport={(data) => {
            if (data.address) setPropertyAddress(data.address);
            if (data.homeownerName) setHomeownerName(data.homeownerName);
            if (data.carrier) setInsuranceCarrier(data.carrier);
            if (data.importedPhotoCount > 0) {
              setCrmPhotoCount(data.importedPhotoCount);
              if (data.slug) setCrmSlug(data.slug);
              setImportedPhotoNote(
                `Imported ${data.importedPhotoCount} photos from CRM. They'll be included in your forensic report.`
              );
            }
          }}
        />

        {/* Quota check */}
        {quota && !quota.allowed && (
          <div className="mb-8 glass-card p-8 text-center">
            <h3 className="text-xl font-bold text-[var(--white)] mb-2">You&apos;ve used your {quota.limit} free claims</h3>
            <p className="text-[var(--gray-dim)] text-sm mb-6">Upgrade to keep generating reports.</p>
            <a href="/pricing" className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] text-white px-6 py-3 rounded-xl font-bold text-sm">
              View Plans
            </a>
          </div>
        )}

        {/* Form */}
        {(!quota || quota.allowed) && (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Address */}
            <div>
              <label className="block text-sm font-semibold text-[var(--white)] mb-1">Property Address *</label>
              <AddressAutocomplete
                required
                value={propertyAddress}
                onChange={setPropertyAddress}
                placeholder="123 Main St, Binghamton, NY 13901"
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
              />
            </div>

            {/* Date of loss + storm scan */}
            <div>
              <label className="block text-sm font-semibold text-[var(--white)] mb-1">Date of Loss *</label>
              <div className="flex gap-3">
                <input
                  type="date"
                  required
                  value={dateOfLoss}
                  onChange={(e) => setDateOfLoss(e.target.value)}
                  className="flex-1 px-4 py-3 rounded-lg border border-[var(--border-glass)] bg-[var(--bg-input)] text-[var(--white)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none text-sm"
                />
                {propertyAddress && (
                  <button
                    type="button"
                    onClick={scanForStorms}
                    disabled={scanningStorms}
                    className="px-4 py-3 bg-[var(--cyan)]/10 text-[var(--cyan)] border border-[var(--cyan)]/30 rounded-lg text-sm font-medium hover:bg-[var(--cyan)]/20 transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {scanningStorms ? "Scanning..." : "Scan for Storms"}
                  </button>
                )}
              </div>
              {stormResults && stormResults.length > 0 && (
                <div className="mt-3 space-y-2">
                  {stormResults.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setDateOfLoss(s.date)}
                      className={`w-full text-left p-3 rounded-lg border text-sm transition-colors ${
                        dateOfLoss === s.date
                          ? "border-[var(--cyan)] bg-[var(--cyan)]/10 text-[var(--white)]"
                          : "border-[var(--border-glass)] bg-white/[0.03] text-[var(--gray)] hover:bg-white/[0.06]"
                      }`}
                    >
                      <span className="font-semibold">{s.date}</span> &mdash; {s.type}: {s.details}
                    </button>
                  ))}
                </div>
              )}
              {stormResults && stormResults.length === 0 && (
                <div className="text-xs mt-2">
                  {stormReason === "geocode_failed" && (
                    <p className="text-amber-400">Could not locate this address. Try adding city, state, and ZIP.</p>
                  )}
                  {stormReason === "county_failed" && (
                    <p className="text-amber-400">Could not determine county for this address.</p>
                  )}
                  {stormReason === "noaa_unavailable" && (
                    <div className="flex items-center gap-2">
                      <p className="text-amber-400">NOAA weather database temporarily unavailable.</p>
                      <button type="button" onClick={scanForStorms} className="text-[var(--cyan)] hover:underline font-medium">Try again</button>
                    </div>
                  )}
                  {(stormReason === "no_events" || !stormReason) && (
                    <p className="text-[var(--gray-dim)]">No recent storm events found in NOAA records for this area.</p>
                  )}
                </div>
              )}
            </div>

            {/* Roof material */}
            <div>
              <label className="block text-sm font-semibold text-[var(--white)] mb-1">Roof Material *</label>
              <select
                required
                value={roofMaterial}
                onChange={(e) => setRoofMaterial(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] bg-[var(--bg-input)] text-[var(--white)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none text-sm"
              >
                <option value="">Select roof material...</option>
                {ROOF_MATERIALS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Damage Type */}
            <div>
              <label className="block text-sm font-semibold text-[var(--white)] mb-1">Damage Type</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: "hail" as const, label: "Hail", icon: "🧊" },
                  { value: "wind" as const, label: "Wind", icon: "💨" },
                  { value: "combined" as const, label: "Hail & Wind", icon: "⛈" },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDamageType(damageType === opt.value ? "" : opt.value)}
                    className={`flex flex-col items-center gap-1 py-3 px-2 rounded-lg border-2 text-xs font-semibold transition-colors ${
                      damageType === opt.value
                        ? "border-[var(--cyan)] bg-[var(--cyan)]/10 text-[var(--cyan)]"
                        : "border-[var(--border-glass)] text-[var(--gray-muted)] hover:border-white/30 hover:text-white"
                    }`}
                  >
                    <span className="text-lg">{opt.icon}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-[var(--gray-dim)] mt-1">
                {damageType === "hail"
                  ? "AI will prioritize hail indicators: dents, granule loss, chalk test gaps"
                  : damageType === "wind"
                  ? "AI will prioritize wind indicators: creased tabs, missing shingles, directional patterns"
                  : damageType === "combined"
                  ? "AI will analyze for both hail and wind damage patterns"
                  : "Optional — helps the AI focus its analysis"}
              </p>
            </div>

            {/* Optional fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-baseline gap-2 mb-1">
                  <label className="text-sm font-semibold text-[var(--white)]">Homeowner Name</label>
                  <span className="text-xs text-[var(--gray-dim)]">Optional</span>
                </div>
                <input
                  type="text"
                  value={homeownerName}
                  onChange={(e) => setHomeownerName(e.target.value)}
                  placeholder="e.g. John Smith"
                  className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] bg-[var(--bg-input)] text-[var(--white)] placeholder-[var(--gray-dim)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none text-sm"
                />
              </div>
              <div>
                <div className="flex items-baseline gap-2 mb-1">
                  <label className="text-sm font-semibold text-[var(--white)]">Insurance Carrier</label>
                  <span className="text-xs text-[var(--gray-dim)]">Optional</span>
                </div>
                <input
                  type="text"
                  value={insuranceCarrier}
                  onChange={(e) => setInsuranceCarrier(e.target.value)}
                  placeholder="e.g. State Farm"
                  className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] bg-[var(--bg-input)] text-[var(--white)] placeholder-[var(--gray-dim)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none text-sm"
                />
              </div>
            </div>

            {/* Photos */}
            <div>
              <label className="block text-sm font-semibold text-[var(--white)] mb-1">Inspection Photos *</label>
              <FileUploadZone
                label="Photos"
                description="Upload inspection photos. ZIP archives and HEIC files are supported."
                accept="image/*,.heic,.heif,.zip"
                multiple
                files={photoFiles}
                onFilesChange={setPhotoFiles}
              />
            </div>

            {/* Info box */}
            <div className="rounded-xl bg-[var(--cyan)]/[0.06] border border-[var(--cyan)]/20 p-4">
              <p className="text-xs text-[var(--gray)] leading-relaxed">
                <span className="font-semibold text-[var(--cyan)]">Quick Forensic Report</span> generates a
                professional forensic causation report with photo annotations, damage analysis, and weather
                correlation &mdash; all without EagleView measurements. Upload measurements later to unlock
                the full 5-document package including estimate, scope comparison, and supplement letter.
              </p>
            </div>

            {/* Error */}
            {status === "error" && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
                {errorMsg}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={!canSubmit || status === "uploading"}
              className="w-full bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-4 rounded-xl text-lg font-semibold transition-colors"
            >
              {status === "uploading" ? uploadProgress || "Uploading..." : "Generate Forensic Report"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
