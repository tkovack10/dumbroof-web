"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FileUploadZone } from "@/components/file-upload-zone";
import { AddressAutocomplete } from "@/components/address-autocomplete";

type UploadStatus = "idle" | "uploading" | "success" | "error";

export default function NewClaimPage() {
  const [propertyAddress, setPropertyAddress] = useState("");
  const [insuranceCarrier, setInsuranceCarrier] = useState("");
  const [measurementFiles, setMeasurementFiles] = useState<File[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [scopeFiles, setScopeFiles] = useState<File[]>([]);
  const [weatherFiles, setWeatherFiles] = useState<File[]>([]);
  const [userNotes, setUserNotes] = useState("");
  const [dateOfLoss, setDateOfLoss] = useState("");
  const [scanningStorms, setScanningStorms] = useState(false);
  const [stormResults, setStormResults] = useState<
    Array<{ date: string; type: string; details: string }> | null
  >(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const supabase = createClient();
  const BACKEND_URL =
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

  const hasScope = scopeFiles.length > 0;
  const phase = hasScope ? "post-scope" : "pre-scope";
  const canSubmit =
    propertyAddress.trim() !== "" &&
    measurementFiles.length > 0 &&
    photoFiles.length > 0;

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

      // Upload via server-signed URLs (bypasses RLS, sanitizes server-side)
      const uploadFile = async (file: File, folder: string) => {
        // Get signed upload URL from server
        const res = await fetch("/api/storage/sign-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder, fileName: file.name, claimPath }),
        });
        const urlData = await res.json();
        if (!res.ok) throw new Error(`Failed to upload ${file.name}: ${urlData.error}`);

        // Upload directly to Supabase using signed URL
        const { error } = await supabase.storage
          .from("claim-documents")
          .uploadToSignedUrl(urlData.path, urlData.token, file);
        if (error) throw new Error(`Failed to upload ${file.name}: ${error.message}`);
        return urlData.safeName;
      };

      const uploadedNames: Record<string, string[]> = {
        measurements: [],
        photos: [],
        scope: [],
        weather: [],
      };

      // Upload measurements
      for (const file of measurementFiles) {
        uploadedNames.measurements.push(await uploadFile(file, "measurements"));
      }

      // Upload photos
      for (const file of photoFiles) {
        uploadedNames.photos.push(await uploadFile(file, "photos"));
      }

      // Upload scope (if provided)
      for (const file of scopeFiles) {
        uploadedNames.scope.push(await uploadFile(file, "scope"));
      }

      // Upload weather data (if provided)
      for (const file of weatherFiles) {
        uploadedNames.weather.push(await uploadFile(file, "weather"));
      }

      // Save claim record to database
      const { error: dbError } = await supabase.from("claims").insert({
        user_id: user.id,
        address: propertyAddress,
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
      });

      if (dbError) throw new Error(dbError.message);

      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
    }
  };

  if (status === "success") {
    return (
      <main className="min-h-screen bg-gray-50">
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
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
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
          <p className="text-gray-500 mb-2">
            Your {phase === "pre-scope" ? "pre-scope" : "supplement"} package is
            being prepared.
          </p>
          <div className="inline-block bg-gray-100 rounded-lg px-4 py-2 mb-8">
            <span className="text-sm text-gray-600">
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
    <main className="min-h-screen bg-gray-50">
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
            className="text-gray-400 hover:text-white text-sm transition-colors"
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
          <p className="text-gray-500 mt-1">
            Upload your documents and we&apos;ll generate your appeal package.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Property Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
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
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
              />
            </div>
            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <label className="block text-sm font-semibold text-[var(--navy)]">
                  Insurance Carrier
                </label>
                <span className="text-xs text-gray-400 font-medium">Optional</span>
              </div>
              <input
                type="text"
                value={insuranceCarrier}
                onChange={(e) => setInsuranceCarrier(e.target.value)}
                placeholder="e.g. State Farm, Allstate, Erie..."
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">
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
              <span className="text-xs text-gray-400 font-medium">Optional</span>
            </div>
            <div className="flex gap-2">
              <input
                type="date"
                value={dateOfLoss}
                onChange={(e) => setDateOfLoss(e.target.value)}
                className="flex-1 px-4 py-3 rounded-lg border border-gray-200 focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
              />
              <button
                type="button"
                onClick={scanForStorms}
                disabled={!propertyAddress.trim() || scanningStorms}
                className="px-4 py-3 text-sm bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
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
            <p className="text-xs text-gray-400 mt-1">
              Enter the storm date, or click &quot;Scan for storms&quot; to find recent events near this address.
            </p>
            {stormResults !== null && stormResults.length === 0 && !scanningStorms && (
              <p className="text-xs text-gray-500 mt-2 bg-gray-50 rounded-lg px-3 py-2">
                No recent storm events found in NOAA records for this area.
              </p>
            )}
            {stormResults && stormResults.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs text-gray-500">
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
                    className="block w-full text-left text-xs px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
                  >
                    <span className="font-semibold text-amber-800">{storm.date}</span>
                    <span className="text-amber-600 ml-2">
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
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
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
              accept=".jpg,.jpeg,.png,.heic,.heif,.webp,.tiff,.tif,.bmp,.pdf,.zip,.eml"
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

          {/* Additional Context */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Additional Context
            </h3>
            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <label className="block text-sm font-semibold text-[var(--navy)]">
                  Notes for the AI
                </label>
                <span className="text-xs text-gray-400 font-medium">Not required</span>
              </div>
              <p className="text-xs text-gray-500 mb-2">
                Describe what you want included in the scope, materials on the property, or anything the adjuster said during inspection.
              </p>
              <textarea
                value={userNotes}
                onChange={(e) => setUserNotes(e.target.value)}
                placeholder='e.g. "Shingle roof, standing seam metal on rear slope, aluminum siding" or "Adjuster said wear and tear during inspection"'
                rows={3}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm resize-none"
              />
            </div>
          </div>

          {/* Phase Indicator */}
          <div
            className={`rounded-xl px-5 py-4 border ${
              hasScope
                ? "bg-blue-50 border-blue-200"
                : "bg-amber-50 border-amber-200"
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                  hasScope
                    ? "bg-blue-100 text-blue-700"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {hasScope ? "5" : "3"}
              </div>
              <div>
                <p
                  className={`text-sm font-semibold ${
                    hasScope ? "text-blue-800" : "text-amber-800"
                  }`}
                >
                  {hasScope
                    ? "Post-Scope: Full 5-document supplement package"
                    : "Pre-Scope: 3-document proactive package"}
                </p>
                <p
                  className={`text-xs ${
                    hasScope ? "text-blue-600" : "text-amber-600"
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
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
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
                Uploading...
              </span>
            ) : (
              "Submit Claim"
            )}
          </button>
          {!canSubmit && status === "idle" && (
            <p className="text-xs text-gray-400 text-center">
              Still need:{" "}
              {[
                !propertyAddress.trim() && "property address",
                measurementFiles.length === 0 && "measurements",
                photoFiles.length === 0 && "inspection photos",
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
