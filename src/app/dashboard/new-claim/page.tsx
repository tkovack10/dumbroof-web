"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FileUploadZone } from "@/components/file-upload-zone";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { useBillingQuota } from "@/hooks/use-billing-quota";
import { uploadFilesBatched } from "@/lib/upload-utils";

type UploadStatus = "idle" | "uploading" | "success" | "error";

export default function NewClaimPage() {
  const [propertyAddress, setPropertyAddress] = useState("");
  const quota = useBillingQuota();
  const [homeownerName, setHomeownerName] = useState("");
  const [insuranceCarrier, setInsuranceCarrier] = useState("");
  const [measurementFiles, setMeasurementFiles] = useState<File[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [scopeFiles, setScopeFiles] = useState<File[]>([]);
  const [weatherFiles, setWeatherFiles] = useState<File[]>([]);
  const [userNotes, setUserNotes] = useState("");
  const [dateOfLoss, setDateOfLoss] = useState("");
  const [roofMaterial, setRoofMaterial] = useState("");
  const [includeGutters, setIncludeGutters] = useState(false);
  const [gutterType, setGutterType] = useState("");
  const [includeSiding, setIncludeSiding] = useState(false);
  const [sidingType, setSidingType] = useState("");
  const [scanningStorms, setScanningStorms] = useState(false);
  const [stormResults, setStormResults] = useState<
    Array<{ date: string; type: string; details: string }> | null
  >(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [uploadProgress, setUploadProgress] = useState("");
  const BACKEND_URL =
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

  const hasScope = scopeFiles.length > 0;
  const phase = hasScope ? "post-scope" : "pre-scope";
  const canSubmit =
    propertyAddress.trim() !== "" &&
    measurementFiles.length > 0 &&
    photoFiles.length > 0 &&
    roofMaterial !== "" &&
    (quota === null || quota.allowed);

  const scanForStorms = async () => {
    setScanningStorms(true);
    setStormResults(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/noaa-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: propertyAddress }),
      });
      const data = await res.json();
      setStormResults(data.storms || []);
    } catch (err) {
      console.error("Storm scan failed:", err);
      setStormResults([]);
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
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create a slug from the address — append timestamp to prevent collisions
      const slug =
        propertyAddress
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") +
        `-${Date.now()}`;
      const claimPath = `${user.id}/${slug}`;

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
        uploadCategory(photoFiles, "photos", "photos"),
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
            ...(includeGutters && gutterType ? { gutters: gutterType } : {}),
            ...(includeSiding && sidingType ? { siding: sidingType } : {}),
          }
        } : {}),
      });

      if (dbError) throw new Error(dbError.message);

      // Increment claim usage counter
      await fetch("/api/billing/check-quota", { method: "POST" });

      window.fbq?.("track", "Lead");
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
    }
  };

  if (status === "success") {
    return (
      <main className="min-h-screen bg-white/[0.04]">
        <nav className="bg-[var(--navy)] border-b border-white/10">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white">
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
          <h2 className="text-2xl font-bold text-[var(--navy)] mb-2">
            Documents Uploaded
          </h2>
          <p className="text-[var(--gray-muted)] mb-2">
            Your {phase === "pre-scope" ? "pre-scope" : "supplement"} package is
            being prepared.
          </p>
          <div className="inline-block bg-white/[0.06] rounded-lg px-4 py-2 mb-8">
            <span className="text-sm text-[var(--gray)]">
              Phase:{" "}
              <span className="font-semibold text-[var(--navy)]">
                {phase === "pre-scope"
                  ? "Pre-Scope (no carrier scope uploaded)"
                  : "Post-Scope (supplement)"}
              </span>
            </span>
          </div>
          <div>
            <a
              href="/dashboard"
              className="bg-[var(--navy)] hover:bg-[var(--navy-light)] text-white px-8 py-3 rounded-xl font-semibold transition-colors text-sm"
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
      <nav className="bg-[var(--navy)] border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white">
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
          <h1 className="text-2xl font-bold text-[var(--navy)]">
            New Claim Package
          </h1>
          <p className="text-[var(--gray-muted)] mt-1">
            Upload your documents and we&apos;ll generate your appeal package.
          </p>
        </div>

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
                className="bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-6 py-3 rounded-xl font-bold text-sm transition-colors"
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
              <span className="font-semibold text-[var(--navy)]">{quota.planName}</span> plan
            </span>
            <span className="text-xs text-[var(--gray-muted)]">
              <span className="font-semibold text-[var(--navy)]">{quota.remaining}</span> claim{quota.remaining !== 1 ? "s" : ""} remaining
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Property Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[var(--gray-dim)] uppercase tracking-wider">
              Property Info
            </h3>
            <div>
              <label className="block text-sm font-semibold text-[var(--navy)] mb-1">
                Property Address
              </label>
              <AddressAutocomplete
                required
                value={propertyAddress}
                onChange={setPropertyAddress}
                placeholder="123 Main St, Binghamton, NY 13901"
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
              />
            </div>
            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <label className="block text-sm font-semibold text-[var(--navy)]">
                  Homeowner Name
                </label>
                <span className="text-xs text-[var(--gray-dim)] font-medium">Optional</span>
              </div>
              <input
                type="text"
                value={homeownerName}
                onChange={(e) => setHomeownerName(e.target.value)}
                placeholder="e.g. John Smith"
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
              />
            </div>
            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <label className="block text-sm font-semibold text-[var(--navy)]">
                  Insurance Carrier
                </label>
                <span className="text-xs text-[var(--gray-dim)] font-medium">Optional</span>
              </div>
              <input
                type="text"
                value={insuranceCarrier}
                onChange={(e) => setInsuranceCarrier(e.target.value)}
                placeholder="e.g. State Farm, Allstate, Erie..."
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
              />
              <p className="text-xs text-[var(--gray-dim)] mt-1">
                {hasScope
                  ? "We'll auto-detect the carrier from your scope if left blank."
                  : "Leave blank if you don't know yet — you can add it later."}
              </p>
            </div>
          </div>

          {/* Date of Loss */}
          <div>
            <div className="flex items-baseline gap-2 mb-1">
              <label className="block text-sm font-semibold text-[var(--navy)]">
                Date of Loss
              </label>
              <span className="text-xs text-[var(--gray-dim)] font-medium">Optional</span>
            </div>
            <div className="flex gap-2">
              <input
                type="date"
                value={dateOfLoss}
                onChange={(e) => setDateOfLoss(e.target.value)}
                className="flex-1 px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
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
              <p className="text-xs text-[var(--gray-muted)] mt-2 bg-white/[0.04] rounded-lg px-3 py-2">
                No recent storm events found in NOAA records for this area.
              </p>
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
          </div>

          {/* Documents */}
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

            <FileUploadZone
              label="Weather Data"
              description="HailTrace report, NOAA data, or any storm/weather documentation for the loss date. You can forward the email (.eml) directly. Strengthens the forensic case."
              accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.tiff,.tif,.bmp,.zip,.eml"
              multiple
              files={weatherFiles}
              onFilesChange={setWeatherFiles}
            />
          </div>

          {/* Estimate Request */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[var(--gray-dim)] uppercase tracking-wider">
              Estimate Request
            </h3>

            {/* Roof Material */}
            <div>
              <label className="block text-sm font-semibold text-[var(--navy)] mb-1">
                Roof Material
              </label>
              <select
                required
                value={roofMaterial}
                onChange={(e) => setRoofMaterial(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
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
                      ? "border-[var(--navy)] bg-[var(--navy)]"
                      : "border-[var(--border-glass)] bg-[var(--bg-glass)] group-hover:border-[var(--border-glass)]"
                  }`}
                >
                  {includeGutters && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                <span className="text-sm font-semibold text-[var(--navy)]">Include Gutters</span>
              </label>
              {includeGutters && (
                <div className="mt-2 ml-8">
                  <select
                    value={gutterType}
                    onChange={(e) => setGutterType(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
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
                      ? "border-[var(--navy)] bg-[var(--navy)]"
                      : "border-[var(--border-glass)] bg-[var(--bg-glass)] group-hover:border-[var(--border-glass)]"
                  }`}
                >
                  {includeSiding && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                <span className="text-sm font-semibold text-[var(--navy)]">Include Siding</span>
              </label>
              {includeSiding && (
                <div className="mt-2 ml-8">
                  <select
                    value={sidingType}
                    onChange={(e) => setSidingType(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
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

          {/* Additional Context */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--gray-dim)] uppercase tracking-wider">
              Additional Context
            </h3>
            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <label className="block text-sm font-semibold text-[var(--navy)]">
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
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm resize-none"
              />
            </div>
          </div>

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
            className="w-full bg-[var(--red)] hover:bg-[var(--red-dark)] disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-xl font-semibold transition-colors"
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
                photoFiles.length === 0 && "inspection photos",
                !roofMaterial && "roof material",
              ]
                .filter(Boolean)
                .join(", ")}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
