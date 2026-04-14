"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { FileUploadZone } from "@/components/file-upload-zone";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { useBillingQuota } from "@/hooks/use-billing-quota";
import { uploadFilesBatched } from "@/lib/upload-utils";
import { CrmImportModal } from "@/components/crm-import-modal";
import { trackBoth, FunnelEvent } from "@/lib/track";
import { compressImages } from "@/lib/image-compress";

type UploadStatus = "idle" | "uploading" | "success" | "error";

export default function NewClaimPage() {
  const [propertyAddress, setPropertyAddress] = useState("");
  const quota = useBillingQuota();
  const [homeownerName, setHomeownerName] = useState("");
  const [insuranceCarrier, setInsuranceCarrier] = useState("");
  const [measurementFiles, setMeasurementFiles] = useState<File[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [crmPhotoCount, setCrmPhotoCount] = useState(0);
  const [crmSlug, setCrmSlug] = useState("");
  const [scopeFiles, setScopeFiles] = useState<File[]>([]);
  const [weatherFiles, setWeatherFiles] = useState<File[]>([]);
  const [userNotes, setUserNotes] = useState("");
  const [dateOfLoss, setDateOfLoss] = useState("");
  const [roofMaterial, setRoofMaterial] = useState("");
  const [damageType, setDamageType] = useState<"" | "hail" | "wind" | "combined">("");
  const [includeGutters, setIncludeGutters] = useState(false);
  const [gutterType, setGutterType] = useState("");
  const [includeSiding, setIncludeSiding] = useState(false);
  const [sidingType, setSidingType] = useState("");
  const [scanningStorms, setScanningStorms] = useState(false);
  const [stormResults, setStormResults] = useState<
    Array<{ date: string; type: string; details: string }> | null
  >(null);
  const [stormReason, setStormReason] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showChecklist, setShowChecklist] = useState(true);
  const [hasPhotos, setHasPhotos] = useState(true);
  const [hasMeasurements, setHasMeasurements] = useState(false);
  const [hasCarrierScope, setHasCarrierScope] = useState(false);
  const [userRole, setUserRole] = useState("");
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [uploadProgress, setUploadProgress] = useState("");
  const [showCrmModal, setShowCrmModal] = useState(false);
  const [crmIntegrations, setCrmIntegrations] = useState<{ acculynx: boolean; companycam: boolean }>({ acculynx: false, companycam: false });
  const [crmUserId, setCrmUserId] = useState("");
  const [importedPhotoNote, setImportedPhotoNote] = useState("");
  const [isMobile, setIsMobile] = useState(false);

  // Stable object URLs for photo thumbnails — revokes previous URLs on change
  const photoUrls = useMemo(() => {
    const urls = photoFiles.map((f) => URL.createObjectURL(f));
    return urls;
  }, [photoFiles]);
  useEffect(() => {
    return () => { photoUrls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [photoUrls]);

  // Shared handler for mobile photo inputs (camera + camera roll)
  const handleMobilePhotoAdd = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) setPhotoFiles((prev) => [...prev, ...files]);
    e.target.value = "";
  }, []);

  const BACKEND_URL =
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

  // Detect mobile device — enables simplified camera-first upload flow
  useEffect(() => {
    const ua = navigator.userAgent;
    const mobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|Windows Phone/i.test(ua) || window.innerWidth < 768;
    if (mobile) {
      setIsMobile(true);
      setShowChecklist(false); // skip guided checklist — mobile users just want to upload
      setHasPhotos(true);
    }
  }, []);

  // Check CRM integration status on mount
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
      } catch { /* ignore — CRM import just won't show */ }
    }
    checkIntegrations();
  }, [BACKEND_URL]);

  const hasScope = scopeFiles.length > 0;
  const phase = hasScope ? "post-scope" : "pre-scope";
  // Photos are the ONLY hard requirement. Measurements and carrier scope
  // are both optional — each one unlocks more of the package when added.
  // Contractor can submit photos-only and get a Forensic Causation Report,
  // then add measurements for Xactimate + scope comparison, then add the
  // carrier scope for the full 5-doc supplement package.
  // Tom's directive 2026-04-06: "we dont NEED EAGLEVIEW"
  const canSubmit =
    propertyAddress.trim() !== "" &&
    (photoFiles.length > 0 || crmPhotoCount > 0) &&
    roofMaterial !== "" &&
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
    } catch (err) {
      console.error("Storm scan failed:", err);
      setStormResults([]);
      setStormReason("noaa_unavailable");
    } finally {
      setScanningStorms(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    trackBoth(FunnelEvent.NEW_CLAIM_FORM_SUBMITTED, {
      phase,
      measurement_count: measurementFiles.length,
      photo_count: photoFiles.length + crmPhotoCount,
      scope_count: scopeFiles.length,
      has_carrier_scope: scopeFiles.length > 0,
    });

    setStatus("uploading");
    setErrorMsg("");

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Reuse CRM slug if photos were imported, otherwise generate new
      const slug = crmSlug ||
        (propertyAddress
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") +
        `-${Date.now()}`);
      const claimPath = `${user.id}/${slug}`;

      // Compress photos before upload (HEIC → JPEG, resize to 2048px max)
      setUploadProgress("Compressing photos...");
      const compressedPhotos = await compressImages(photoFiles);

      // Upload all file categories with concurrent batching
      const uploadCategory = async (files: File[], folder: string, label: string) => {
        if (files.length === 0) return { uploaded: [] as string[], errors: [] as string[] };
        setUploadProgress(`Uploading ${label}...`);
        return uploadFilesBatched(supabase, files, folder, claimPath, {
          concurrency: 3,
          onProgress: (done, total) =>
            setUploadProgress(`Uploading ${label}... ${done}/${total}`),
        });
      };

      const [mResult, pResult, sResult, wResult] = await Promise.all([
        uploadCategory(measurementFiles, "measurements", "measurements"),
        uploadCategory(compressedPhotos, "photos", "photos"),
        uploadCategory(scopeFiles, "scope", "carrier scope"),
        uploadCategory(weatherFiles, "weather", "weather data"),
      ]);

      const uploadedNames = {
        measurements: mResult.uploaded,
        photos: pResult.uploaded,
        scope: sResult.uploaded,
        weather: wResult.uploaded,
      };

      // Collect any upload errors for warning
      const allErrors = [
        ...mResult.errors,
        ...pResult.errors,
        ...sResult.errors,
        ...wResult.errors,
      ];
      if (allErrors.length > 0) {
        console.warn("Some files failed to upload:", allErrors);
      }

      // Save claim record to database
      const { error: dbError } = await supabase.from("claims").insert({
        user_id: user.id,
        address: propertyAddress,
        ...(homeownerName.trim() ? { homeowner_name: homeownerName.trim() } : {}),
        carrier: insuranceCarrier,
        slug,
        phase,
        status: "uploaded",
        file_path: claimPath,
        measurement_files: uploadedNames.measurements,
        photo_files: uploadedNames.photos,
        scope_files: uploadedNames.scope,
        weather_files: uploadedNames.weather,
        ...(userNotes.trim() ? { user_notes: userNotes.trim() } : {}),
        ...(dateOfLoss ? { date_of_loss: dateOfLoss } : {}),
        ...(roofMaterial ? {
          estimate_request: {
            roof_material: roofMaterial,
            ...(damageType ? { damage_type: damageType } : {}),
            ...(includeGutters && gutterType ? { gutters: gutterType } : {}),
            ...(includeSiding && sidingType ? { siding: sidingType } : {}),
          }
        } : {}),
      });

      if (dbError) throw new Error(dbError.message);

      // Increment claim usage counter
      await fetch("/api/billing/check-quota", { method: "POST" });

      // Generate a single event_id used by BOTH the browser pixel and the
      // server-side CAPI mirror. Meta dedupes events with matching IDs so
      // we count this upload exactly once even though we fire from two places.
      const capiEventId = `claim_${slug}_${Date.now()}`;

      window.fbq?.("track", "StartTrial", { value: 499, currency: "USD" }, { eventID: capiEventId });
      window.fbq?.("track", "Lead", {}, { eventID: `${capiEventId}_lead` });
      window.ttq?.track("SubmitForm");
      window.ttq?.track("Lead", {
        contents: [{ content_id: slug, content_type: "product", content_name: "Claim Package" }],
        value: 499,
        currency: "USD",
      });

      // Mirror the StartTrial event to Meta Conversions API server-side.
      // iOS 14+ blocks the browser pixel for ~25-40% of users; CAPI bypasses
      // that. Same eventId = Meta merges into one canonical conversion.
      // Fire-and-forget — never blocks the success state.
      fetch("/api/capi-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventName: "StartTrial",
          eventId: capiEventId,
          eventSourceUrl: window.location.href,
          customData: {
            value: 499,
            currency: "USD",
            content_name: "Claim Package",
            content_category: phase,
          },
        }),
      }).catch(() => {});

      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
      trackBoth(FunnelEvent.NEW_CLAIM_UPLOAD_FAILED, {
        error_message: err instanceof Error ? err.message : "unknown",
      });
    }
  };

  if (status === "success") {
    return (
      <main className="min-h-screen bg-white/[0.04]">
        <nav className="bg-[rgba(6,9,24,0.85)] backdrop-blur-[20px] border-b border-[var(--border-glass)] sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--pink)] to-[var(--blue)] flex items-center justify-center font-bold text-white text-xs">
              DR
            </div>
            <span className="text-white font-bold text-lg tracking-tight">
              dumb roof<sup className="text-[9px] font-medium align-super ml-0.5">™</sup>
            </span>
          </div>
        </nav>

        <div className="max-w-xl mx-auto px-6 py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-8 h-8 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-[var(--white)] mb-2">
            Documents Uploaded
          </h2>
          <p className="text-[var(--gray-muted)] mb-2">
            Your {phase === "pre-scope" ? "pre-scope" : "supplement"} package is
            being prepared.
          </p>
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-5 py-4 mb-4 text-left max-w-md mx-auto">
            <p className="text-sm text-blue-400 font-semibold mb-1">What happens next?</p>
            <ul className="text-xs text-[var(--gray)] space-y-1.5">
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5 shrink-0">1.</span>
                Our AI is analyzing every photo and document now
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5 shrink-0">2.</span>
                Your documents will be ready in 2-5 minutes
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5 shrink-0">3.</span>
                They&apos;ll appear on your dashboard for download
              </li>
            </ul>
          </div>
          <div className="inline-block bg-white/[0.06] rounded-lg px-4 py-2 mb-8">
            <span className="text-sm text-[var(--gray)]">
              Phase:{" "}
              <span className="font-semibold text-[var(--white)]">
                {phase === "pre-scope"
                  ? "Pre-Scope (no carrier scope uploaded)"
                  : "Post-Scope (supplement)"}
              </span>
            </span>
          </div>
          <div>
            <a
              href="/dashboard"
              className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-8 py-3 rounded-xl font-semibold transition-colors text-sm"
            >
              Back to Dashboard
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white/[0.04]">
      {/* Top Bar */}
      <nav className="bg-[rgba(6,9,24,0.85)] backdrop-blur-[20px] border-b border-[var(--border-glass)] sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--pink)] to-[var(--blue)] flex items-center justify-center font-bold text-white text-xs">
              DR
            </div>
            <span className="text-white font-bold text-lg tracking-tight">
              dumb roof<sup className="text-[9px] font-medium align-super ml-0.5">™</sup>
            </span>
          </div>
          <a
            href="/dashboard"
            className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors"
          >
            Cancel
          </a>
        </div>
      </nav>

      <div className="max-w-xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--white)]">
            New Claim Package
          </h1>
          <p className="text-[var(--gray-muted)] mt-1">
            Upload your documents and we&apos;ll generate your appeal package.
          </p>
        </div>

        {/* Import from CRM */}
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
                  Pull photos and job data from {[crmIntegrations.acculynx && "AccuLynx", crmIntegrations.companycam && "CompanyCam"].filter(Boolean).join(" or ")}
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
                `Imported ${data.importedPhotoCount} photos from CRM. They've been uploaded to storage and will be included in your claim.`
              );
              setShowAdvanced(true);
            }
          }}
        />

        {/* Guided Checklist — shows before the form */}
        {showChecklist && (
          <div className="mb-8 space-y-8">
            <div>
              <h2 className="text-xl font-bold text-[var(--white)] mb-2">What do you have for this claim?</h2>
              <p className="text-sm text-[var(--gray-muted)]">Check what you have right now. You can always add more documents later.</p>
            </div>

            <div className="space-y-3">
              {/* Photos — always checked */}
              <div onClick={() => setHasPhotos(!hasPhotos)} className="flex items-start gap-4 p-4 rounded-xl bg-white/[0.04] border border-[var(--border-glass)] cursor-pointer hover:bg-white/[0.06] transition-colors">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setHasPhotos(!hasPhotos); }}
                  className={`mt-0.5 w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${
                    hasPhotos ? "border-green-400 bg-green-500/20" : "border-[var(--border-glass)]"
                  }`}
                >
                  {hasPhotos && <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                </button>
                <div>
                  <p className="text-sm font-semibold text-[var(--white)]">Inspection photos</p>
                  <p className="text-xs text-[var(--gray-muted)] mt-0.5">Take photos during your inspection. AI annotates every photo, weather data and code compliance requirements are built into the report.</p>
                </div>
              </div>

              <div className="rounded-xl bg-white/[0.04] border border-[var(--border-glass)] overflow-hidden">
                <div onClick={() => setHasMeasurements(!hasMeasurements)} className="flex items-start gap-4 p-4 cursor-pointer hover:bg-white/[0.06] transition-colors">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setHasMeasurements(!hasMeasurements); }}
                    className={`mt-0.5 w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${
                      hasMeasurements ? "border-green-400 bg-green-500/20" : "border-[var(--border-glass)]"
                    }`}
                  >
                    {hasMeasurements && <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                  </button>
                  <div>
                    <p className="text-sm font-semibold text-[var(--white)]">Roof / siding measurements</p>
                    <p className="text-xs text-[var(--gray-muted)] mt-0.5">EagleView, HOVER, GAF QuickMeasure, or any measurement report. Don&apos;t have them yet? That&apos;s fine &mdash; add them anytime.</p>
                  </div>
                </div>
                {hasMeasurements && (
                  <div className="px-4 pb-4 pt-0">
                    <FileUploadZone
                      label="Upload Measurements"
                      description="PDF or email file (.eml) with your EagleView, HOVER, or measurement report."
                      accept=".pdf,.eml"
                      multiple
                      files={measurementFiles}
                      onFilesChange={setMeasurementFiles}
                    />
                  </div>
                )}
              </div>

              <div className="rounded-xl bg-white/[0.04] border border-[var(--border-glass)] overflow-hidden">
                <div onClick={() => setHasCarrierScope(!hasCarrierScope)} className="flex items-start gap-4 p-4 cursor-pointer hover:bg-white/[0.06] transition-colors">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setHasCarrierScope(!hasCarrierScope); }}
                    className={`mt-0.5 w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${
                      hasCarrierScope ? "border-green-400 bg-green-500/20" : "border-[var(--border-glass)]"
                    }`}
                  >
                    {hasCarrierScope && <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                  </button>
                  <div>
                    <p className="text-sm font-semibold text-[var(--white)]">Insurance carrier scope</p>
                    <p className="text-xs text-[var(--gray-muted)] mt-0.5">The carrier&apos;s estimate or scope of loss. Don&apos;t have it yet? That&apos;s fine &mdash; add it once you receive it.</p>
                  </div>
                </div>
                {hasCarrierScope && (
                  <div className="px-4 pb-4 pt-0">
                    <FileUploadZone
                      label="Upload Carrier Scope"
                      description="The carrier's estimate or scope of loss PDF, or forward the email (.eml)."
                      accept=".pdf,.eml"
                      multiple
                      files={scopeFiles}
                      onFilesChange={setScopeFiles}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Role selector */}
            <div>
              <p className="text-sm font-semibold text-[var(--white)] mb-2">I am a...</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { value: "sales_rep", label: "Sales Rep" },
                  { value: "company_owner", label: "Company Owner" },
                  { value: "public_adjuster", label: "Public Adjuster" },
                  { value: "attorney", label: "Attorney" },
                  { value: "claims_adjuster", label: "Claims Adjuster" },
                  { value: "homeowner", label: "Homeowner" },
                ].map((role) => (
                  <button
                    key={role.value}
                    type="button"
                    onClick={() => setUserRole(role.value)}
                    className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      userRole === role.value
                        ? "bg-gradient-to-r from-[var(--pink)] to-[var(--blue)] text-white"
                        : "bg-white/[0.04] border border-[var(--border-glass)] text-[var(--gray)] hover:bg-white/[0.08]"
                    }`}
                  >
                    {role.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Company profile alert */}
            <div className="rounded-xl bg-[var(--cyan)]/5 border border-[var(--cyan)]/20 p-4 flex items-start gap-3">
              <svg className="w-5 h-5 text-[var(--cyan)] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-[var(--white)]">Want your branding on the reports?</p>
                <p className="text-xs text-[var(--gray-muted)] mt-0.5">
                  Add your company name, address, logo, and contact info in{" "}
                  <a href="/dashboard/settings" className="text-[var(--cyan)] hover:underline">Settings</a>{" "}
                  and every report will be branded with your info.
                </p>
              </div>
            </div>

            {/* What you'll get */}
            <div className="rounded-xl bg-white/[0.04] border border-[var(--border-glass)] p-5">
              <p className="text-xs text-[var(--gray-dim)] uppercase tracking-wider font-semibold mb-3">Here&apos;s what you&apos;ll get</p>
              {hasPhotos && !hasMeasurements && !hasCarrierScope && (
                <div>
                  <p className="text-base font-bold text-[var(--white)]">Forensic Causation Report</p>
                  <p className="text-xs text-[var(--gray-muted)] mt-1">AI-annotated photos, weather data, code compliance. Ready in ~5 minutes.</p>
                </div>
              )}
              {hasPhotos && hasMeasurements && !hasCarrierScope && (
                <div>
                  <p className="text-base font-bold text-[var(--white)]">Forensic Report + Xactimate Estimate + Code Compliance Report</p>
                  <p className="text-xs text-[var(--gray-muted)] mt-1">3 documents with market-specific pricing, code citations, and annotated house rendering. Ready in ~15 minutes.</p>
                </div>
              )}
              {hasPhotos && hasMeasurements && hasCarrierScope && (
                <div>
                  <p className="text-base font-bold text-[var(--white)]">Full 6-Document Package + Scope Comparison + Supplement Composer</p>
                  <p className="text-xs text-[var(--gray-muted)] mt-1">Complete claim package with carrier comparison, supplement letter, and automated follow-ups. Ready in ~15 minutes.</p>
                </div>
              )}
              {hasPhotos && !hasMeasurements && hasCarrierScope && (
                <div>
                  <p className="text-base font-bold text-[var(--white)]">Forensic Report + Carrier Analysis</p>
                  <p className="text-xs text-[var(--gray-muted)] mt-1">Add measurements later to unlock the full estimate and scope comparison.</p>
                </div>
              )}
              {!hasPhotos && (
                <div>
                  <p className="text-sm text-[var(--gray-muted)]">Check at least &quot;Inspection photos&quot; to get started.</p>
                </div>
              )}
              <p className="text-xs text-[var(--gray-dim)] mt-3 italic">This guides your claim from first inspection to final payment. Add documents at any stage.</p>
            </div>

            <button
              type="button"
              onClick={() => setShowChecklist(false)}
              disabled={!hasPhotos}
              className="w-full bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white py-4 rounded-xl font-semibold text-base transition-all shadow-lg shadow-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Got it &mdash; let&apos;s get started
            </button>
          </div>
        )}

        {!showChecklist && (<>
        {/* Quota Gate — Upgrade */}
        {quota && !quota.allowed && (
          <div className="mb-8 bg-gradient-to-br from-[var(--navy)] to-[var(--navy-light)] rounded-2xl p-8 text-center text-white">
            <h3 className="text-xl font-bold mb-2">
              You&apos;ve used your {quota.limit} free claims
            </h3>
            <p className="text-[var(--gray-dim)] text-sm mb-6">
              Upgrade to keep submitting claims and generating revenue.
            </p>
            <div className="flex items-center justify-center gap-4 flex-wrap">
              <a
                href="/pricing"
                className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-6 py-3 rounded-xl font-bold text-sm transition-colors"
              >
                Pro — $499/mo (10 claims)
              </a>
              <a
                href="/pricing"
                className="bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-xl font-bold text-sm transition-colors border border-white/20"
              >
                Growth — $999/mo (30 claims)
              </a>
            </div>
            <p className="text-[var(--gray-dim)] text-xs mt-4">Cancel anytime. No long-term contracts.</p>
          </div>
        )}

        {quota && quota.allowed && (
          <div className="mb-6 flex items-center justify-between bg-white/[0.04] rounded-lg px-4 py-2.5 border border-[var(--border-glass)]">
            <span className="text-xs text-[var(--gray-muted)]">
              <span className="font-semibold text-[var(--white)]">{quota.planName}</span> plan
            </span>
            <span className="text-xs text-[var(--gray-muted)]">
              <span className="font-semibold text-[var(--white)]">{quota.remaining}</span> claim{quota.remaining !== 1 ? "s" : ""} remaining
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Property Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[var(--gray-dim)] uppercase tracking-wider">
              {isMobile ? "Claim Info" : "Property Info"}
            </h3>
            <div>
              <label className="block text-sm font-semibold text-[var(--white)] mb-1">
                Property Address
              </label>
              <AddressAutocomplete
                required
                value={propertyAddress}
                onChange={setPropertyAddress}
                placeholder="123 Main St, Binghamton, NY 13901"
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
              />
            </div>
            {/* Date of Loss — on mobile, show here (above photos) as a required-looking field */}
            {isMobile && (
              <div>
                <label className="block text-sm font-semibold text-[var(--white)] mb-1">
                  Storm Date (hail or wind)
                </label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={dateOfLoss}
                    onChange={(e) => setDateOfLoss(e.target.value)}
                    className="flex-1 px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
                  />
                  <button
                    type="button"
                    onClick={scanForStorms}
                    disabled={!propertyAddress.trim() || scanningStorms}
                    className="px-3 py-3 text-xs bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                  >
                    {scanningStorms ? "Scanning..." : "Find storms"}
                  </button>
                </div>
                <p className="text-xs text-[var(--gray-dim)] mt-1">Required for NOAA weather data in the forensic report</p>
                {stormResults && stormResults.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {stormResults.map((storm, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => { setDateOfLoss(storm.date); setStormResults(null); }}
                        className="block w-full text-left text-xs px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg"
                      >
                        <span className="font-semibold text-amber-400">{storm.date}</span>
                        <span className="text-amber-400 ml-2">{storm.type}{storm.details ? ` — ${storm.details}` : ""}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!isMobile && (
            <>
            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <label className="block text-sm font-semibold text-[var(--white)]">
                  Homeowner Name
                </label>
                <span className="text-xs text-[var(--gray-dim)] font-medium">Optional</span>
              </div>
              <input
                type="text"
                value={homeownerName}
                onChange={(e) => setHomeownerName(e.target.value)}
                placeholder="e.g. John Smith"
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
              />
            </div>
            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <label className="block text-sm font-semibold text-[var(--white)]">
                  Insurance Carrier
                </label>
                <span className="text-xs text-[var(--gray-dim)] font-medium">Optional</span>
              </div>
              <input
                type="text"
                value={insuranceCarrier}
                onChange={(e) => setInsuranceCarrier(e.target.value)}
                placeholder="e.g. State Farm, Allstate, Erie..."
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
              />
              <p className="text-xs text-[var(--gray-dim)] mt-1">
                {hasScope
                  ? "We'll auto-detect the carrier from your scope if left blank."
                  : "Leave blank if you don't know yet — you can add it later."}
              </p>
            </div>
            </>
            )}
          </div>

          {/* Date of Loss — desktop only (mobile has it in the Claim Info section above) */}
          {!isMobile && (<div>
            <div className="flex items-baseline gap-2 mb-1">
              <label className="block text-sm font-semibold text-[var(--white)]">
                Date of Loss
              </label>
              <span className="text-xs text-[var(--gray-dim)] font-medium">Optional</span>
            </div>
            <div className="flex gap-2">
              <input
                type="date"
                value={dateOfLoss}
                onChange={(e) => setDateOfLoss(e.target.value)}
                className="flex-1 px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
              />
              <button
                type="button"
                onClick={scanForStorms}
                disabled={!propertyAddress.trim() || scanningStorms}
                className="px-4 py-3 text-sm bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                {scanningStorms ? (
                  <span className="flex items-center gap-2">
                    <svg
                      className="animate-spin w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Scanning...
                  </span>
                ) : (
                  "Scan for storms"
                )}
              </button>
            </div>
            <p className="text-xs text-[var(--gray-dim)] mt-1">
              Enter the storm date, or click &quot;Scan for storms&quot; to find recent events near this address.
            </p>
            {stormResults !== null && stormResults.length === 0 && !scanningStorms && (
              <div className="text-xs mt-2 bg-white/[0.04] rounded-lg px-3 py-2">
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
                  <p className="text-[var(--gray-muted)]">No recent storm events found in NOAA records for this area.</p>
                )}
              </div>
            )}
            {stormResults && stormResults.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs text-[var(--gray-muted)]">
                  Recent storm events near this address (click to select):
                </p>
                {stormResults.map((storm, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setDateOfLoss(storm.date);
                      setStormResults(null);
                    }}
                    className="block w-full text-left text-xs px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg hover:bg-amber-500/20 transition-colors"
                  >
                    <span className="font-semibold text-amber-400">{storm.date}</span>
                    <span className="text-amber-400 ml-2">
                      {storm.type}
                      {storm.details ? ` — ${storm.details}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>)}

          {/* Documents — mobile gets simplified camera-first UI */}
          {isMobile ? (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-[var(--gray-dim)] uppercase tracking-wider">
                Inspection Photos
              </h3>

              {/* Photo count guidance */}
              <div className="text-xs text-[var(--gray-muted)] flex items-center gap-2">
                {photoFiles.length === 0 && <span>Take at least 3 photos of the roof damage</span>}
                {photoFiles.length >= 1 && photoFiles.length <= 2 && (
                  <span className="text-amber-400">Add more photos for a better report (3+ recommended)</span>
                )}
                {photoFiles.length >= 3 && photoFiles.length <= 9 && (
                  <span className="text-green-400">Good coverage &mdash; more angles = more thorough report</span>
                )}
                {photoFiles.length >= 10 && (
                  <span className="text-green-400">Excellent coverage</span>
                )}
              </div>

              {/* Camera button — opens rear camera on mobile */}
              <label className="flex items-center justify-center gap-3 w-full py-5 rounded-xl bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] text-white font-semibold text-base cursor-pointer active:scale-[0.98] transition-transform">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                </svg>
                Take Photos
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  onChange={handleMobilePhotoAdd}
                />
              </label>

              {/* Camera roll fallback */}
              <label className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-white/[0.04] border border-[var(--border-glass)] text-[var(--gray)] text-sm cursor-pointer hover:bg-white/[0.06] transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                </svg>
                Or select from camera roll
                <input
                  type="file"
                  accept="image/*,.heic,.heif,.jpg,.jpeg,.png"
                  multiple
                  className="hidden"
                  onChange={handleMobilePhotoAdd}
                />
              </label>

              {/* Photo thumbnails grid */}
              {photoFiles.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {photoFiles.map((file, i) => (
                    <div key={`${file.name}-${i}`} className="relative aspect-square rounded-lg overflow-hidden bg-white/[0.04]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photoUrls[i]}
                        alt={file.name}
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setPhotoFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white text-xs"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Optional extras accordion */}
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-sm text-[var(--gray-dim)] hover:text-[var(--white)] transition-colors mt-2"
              >
                <svg className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
                Add measurements, carrier scope, or notes (optional)
              </button>
              {showAdvanced && (
                <div className="space-y-4">
                  <FileUploadZone
                    label="Measurements"
                    description="EagleView, HOVER, or any measurement report. Add later if you don't have it yet."
                    accept=".pdf,.eml"
                    multiple
                    files={measurementFiles}
                    onFilesChange={setMeasurementFiles}
                  />
                  <FileUploadZone
                    label="Carrier Scope"
                    description="The carrier's estimate or scope of loss. Add later if you don't have it yet."
                    accept=".pdf,.eml"
                    multiple
                    files={scopeFiles}
                    onFilesChange={setScopeFiles}
                  />
                  <div>
                    <label className="block text-sm font-semibold text-[var(--white)] mb-1">Homeowner Name</label>
                    <input
                      type="text"
                      value={homeownerName}
                      onChange={(e) => setHomeownerName(e.target.value)}
                      placeholder="e.g. John Smith"
                      className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-[var(--white)] mb-1">Insurance Carrier</label>
                    <input
                      type="text"
                      value={insuranceCarrier}
                      onChange={(e) => setInsuranceCarrier(e.target.value)}
                      placeholder="e.g. State Farm, Allstate..."
                      className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-[var(--white)] mb-1">Notes for the AI</label>
                    <textarea
                      value={userNotes}
                      onChange={(e) => setUserNotes(e.target.value)}
                      placeholder="Describe damage, materials, or what the adjuster said..."
                      rows={3}
                      className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm resize-none"
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
          <div className="space-y-6">
            <h3 className="text-sm font-semibold text-[var(--gray-dim)] uppercase tracking-wider">
              Documents
            </h3>

            <FileUploadZone
              label="Measurements"
              description="EagleView, HOVER, GAF QuickMeasure, or any roof measurement report. You can upload multiple reports (e.g. separate roof and siding EagleViews). PDFs or email files (.eml) with attachments."
              accept=".pdf,.eml"
              multiple
              required
              files={measurementFiles}
              onFilesChange={setMeasurementFiles}
            />

            <FileUploadZone
              label="Inspection Photos"
              description="Upload from camera roll, CompanyCam, JobNimbus, Acculynx, or any source. ZIP archives, PDFs, and email files (.eml) with photo attachments are also supported."
              accept="image/*,.pdf,.zip,.eml"
              multiple
              required
              files={photoFiles}
              onFilesChange={setPhotoFiles}
            />

            <FileUploadZone
              label="Carrier Scope"
              description="The insurance company's estimate or scope of loss. You can upload the PDF directly or forward the email (.eml). Upload multiple if you have revised scopes. If you don't have one yet, skip this — we'll generate a pre-scope package."
              accept=".pdf,.eml"
              multiple
              files={scopeFiles}
              onFilesChange={setScopeFiles}
            />

          </div>
          )}

          {/* Estimate Request — always visible */}
          {(hasMeasurements || measurementFiles.length > 0 || isMobile) && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[var(--gray-dim)] uppercase tracking-wider">
              Estimate Request
            </h3>

            {/* Roof Material */}
            <div>
              <label className="block text-sm font-semibold text-[var(--white)] mb-1">
                Roof Material
              </label>
              <select
                required
                value={roofMaterial}
                onChange={(e) => setRoofMaterial(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
              >
                <option value="">Select roof material...</option>
                <option value="3-Tab">3-Tab</option>
                <option value="Laminate Comp Shingle">Laminate Comp Shingle</option>
                <option value="Premium Grade Laminate Comp Shingle">Premium Grade Laminate Comp Shingle</option>
                <option value="Slate">Slate</option>
                <option value="Standing Seam Metal">Standing Seam Metal</option>
                <option value="Tile">Tile</option>
                <option value="Cedar">Cedar</option>
              </select>
            </div>

            {/* Damage Type — tells the AI + NOAA + PDF generator what to focus on */}
            <div>
              <label className="block text-sm font-semibold text-[var(--white)] mb-1">
                Damage Type
              </label>
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

            {/* Gutters Toggle */}
            <div>
              <label className="flex items-center gap-3 cursor-pointer group">
                <button
                  type="button"
                  onClick={() => {
                    setIncludeGutters(!includeGutters);
                    if (includeGutters) setGutterType("");
                  }}
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    includeGutters
                      ? "border-[var(--pink)] bg-gradient-to-r from-[var(--pink)] to-[var(--blue)]"
                      : "border-[var(--border-glass)] bg-[var(--bg-glass)] group-hover:border-[var(--border-glass)]"
                  }`}
                >
                  {includeGutters && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                <span className="text-sm font-semibold text-[var(--white)]">Include Gutters</span>
              </label>
              {includeGutters && (
                <div className="mt-2 ml-8">
                  <select
                    value={gutterType}
                    onChange={(e) => setGutterType(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
                  >
                    <option value="">Select gutter type...</option>
                    <option value="5K Gutters and Downspouts">5K Gutters and Downspouts</option>
                    <option value="6K Gutters and Downspouts">6K Gutters and Downspouts</option>
                    <option value="Copper Half Round">Copper Half Round</option>
                  </select>
                </div>
              )}
            </div>

            {/* Siding Toggle */}
            <div>
              <label className="flex items-center gap-3 cursor-pointer group">
                <button
                  type="button"
                  onClick={() => {
                    setIncludeSiding(!includeSiding);
                    if (includeSiding) setSidingType("");
                  }}
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    includeSiding
                      ? "border-[var(--pink)] bg-gradient-to-r from-[var(--pink)] to-[var(--blue)]"
                      : "border-[var(--border-glass)] bg-[var(--bg-glass)] group-hover:border-[var(--border-glass)]"
                  }`}
                >
                  {includeSiding && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                <span className="text-sm font-semibold text-[var(--white)]">Include Siding</span>
              </label>
              {includeSiding && (
                <div className="mt-2 ml-8">
                  <select
                    value={sidingType}
                    onChange={(e) => setSidingType(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
                  >
                    <option value="">Select siding type...</option>
                    <option value="Vinyl Siding">Vinyl Siding</option>
                    <option value="Vinyl w/ Insulation">Vinyl w/ Insulation</option>
                    <option value="Aluminum">Aluminum</option>
                    <option value="Cedar">Cedar</option>
                    <option value="Specialty">Specialty</option>
                  </select>
                </div>
              )}
            </div>
          </div>
          )}

          {/* Additional Context — desktop only (mobile has these in accordion) */}
          {!isMobile && (<div className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--gray-dim)] uppercase tracking-wider">
              Additional Context
            </h3>
            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <label className="block text-sm font-semibold text-[var(--white)]">
                  Notes for the AI
                </label>
                <span className="text-xs text-[var(--gray-dim)] font-medium">Not required</span>
              </div>
              <p className="text-xs text-[var(--gray-muted)] mb-2">
                Describe what you want included in the scope, materials on the property, or anything the adjuster said during inspection.
              </p>
              <textarea
                value={userNotes}
                onChange={(e) => setUserNotes(e.target.value)}
                placeholder='e.g. "Shingle roof, standing seam metal on rear slope, aluminum siding" or "Adjuster said wear and tear during inspection"'
                rows={3}
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm resize-none"
              />
            </div>
          </div>)}

          {/* Advanced Options — desktop only (mobile has these in accordion) */}
          {!isMobile && (<>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm text-[var(--gray-dim)] hover:text-[var(--white)] transition-colors"
          >
            <svg className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            Advanced Options
          </button>
          {showAdvanced && (
            <div className="space-y-4">
              <FileUploadZone
                label="Weather Data"
                description="HailTrace report, NOAA data, or any storm/weather documentation. Strengthens the forensic case. Usually auto-detected — only upload if you have a specific report."
                accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.tiff,.tif,.bmp,.zip,.eml"
                multiple
                files={weatherFiles}
                onFilesChange={setWeatherFiles}
              />
            </div>
          )}
          </>)}

          {/* Phase Indicator */}
          <div
            className={`rounded-xl px-5 py-4 border ${
              hasScope
                ? "bg-blue-500/10 border-blue-500/30"
                : "bg-amber-500/10 border-amber-500/30"
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                  hasScope
                    ? "bg-blue-500/10 text-blue-400"
                    : "bg-amber-500/10 text-amber-400"
                }`}
              >
                {hasScope ? "5" : "3"}
              </div>
              <div>
                <p
                  className={`text-sm font-semibold ${
                    hasScope ? "text-blue-400" : "text-amber-400"
                  }`}
                >
                  {hasScope
                    ? "Post-Scope: Full 5-document supplement package"
                    : "Pre-Scope: 3-document proactive package"}
                </p>
                <p
                  className={`text-xs ${
                    hasScope ? "text-blue-400" : "text-amber-400"
                  }`}
                >
                  {hasScope
                    ? "Forensic report, estimate, supplement, appeal letter, cover email"
                    : "Forensic report, estimate, cover letter — submitted before adjuster inspection"}
                </p>
              </div>
            </div>
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
            className="w-full bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-xl font-semibold transition-colors"
          >
            {status === "uploading" ? (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="animate-spin w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                {uploadProgress || "Uploading..."}
              </span>
            ) : (
              "Submit Claim"
            )}
          </button>
          {!canSubmit && status === "idle" && (
            <p className="text-xs text-[var(--gray-dim)] text-center">
              Still need:{" "}
              {[
                !propertyAddress.trim() && "property address",
                measurementFiles.length === 0 && "measurements",
                photoFiles.length === 0 && crmPhotoCount === 0 && "inspection photos",
                !roofMaterial && "roof material",
              ]
                .filter(Boolean)
                .join(", ")}
            </p>
          )}
        </form>
        </>)}
      </div>
    </main>
  );
}
