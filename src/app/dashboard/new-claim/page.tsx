"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FileUploadZone } from "@/components/file-upload-zone";

type UploadStatus = "idle" | "uploading" | "success" | "error";

export default function NewClaimPage() {
  const [propertyAddress, setPropertyAddress] = useState("");
  const [insuranceCarrier, setInsuranceCarrier] = useState("");
  const [measurementFiles, setMeasurementFiles] = useState<File[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [scopeFiles, setScopeFiles] = useState<File[]>([]);
  const [weatherFiles, setWeatherFiles] = useState<File[]>([]);
  const [userNotes, setUserNotes] = useState("");
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const supabase = createClient();

  const hasScope = scopeFiles.length > 0;
  const phase = hasScope ? "post-scope" : "pre-scope";
  const canSubmit =
    propertyAddress.trim() !== "" &&
    insuranceCarrier.trim() !== "" &&
    measurementFiles.length > 0 &&
    photoFiles.length > 0;

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

      // Upload all files
      const uploadFile = async (file: File, folder: string) => {
        const filePath = `${claimPath}/${folder}/${file.name}`;
        const { error } = await supabase.storage
          .from("claim-documents")
          .upload(filePath, file, { upsert: true });
        if (error) throw new Error(`Failed to upload ${file.name}: ${error.message}`);
        return filePath;
      };

      // Upload measurements
      for (const file of measurementFiles) {
        await uploadFile(file, "measurements");
      }

      // Upload photos
      for (const file of photoFiles) {
        await uploadFile(file, "photos");
      }

      // Upload scope (if provided)
      for (const file of scopeFiles) {
        await uploadFile(file, "scope");
      }

      // Upload weather data (if provided)
      for (const file of weatherFiles) {
        await uploadFile(file, "weather");
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
        measurement_files: measurementFiles.map((f) => f.name),
        photo_files: photoFiles.map((f) => f.name),
        scope_files: scopeFiles.map((f) => f.name),
        weather_files: weatherFiles.map((f) => f.name),
        ...(userNotes.trim() ? { user_notes: userNotes.trim() } : {}),
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
              dumb roof
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
              dumb roof
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
              <input
                type="text"
                required
                value={propertyAddress}
                onChange={(e) => setPropertyAddress(e.target.value)}
                placeholder="123 Main St, Binghamton, NY 13901"
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--navy)] mb-1">
                Insurance Carrier
              </label>
              <input
                type="text"
                required
                value={insuranceCarrier}
                onChange={(e) => setInsuranceCarrier(e.target.value)}
                placeholder="e.g. State Farm, Allstate, Erie..."
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
              />
            </div>
          </div>

          {/* Documents */}
          <div className="space-y-6">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Documents
            </h3>

            <FileUploadZone
              label="Measurements"
              description="EagleView, HOVER, GAF QuickMeasure, or any roof measurement report (PDF)"
              accept=".pdf"
              required
              files={measurementFiles}
              onFilesChange={setMeasurementFiles}
            />

            <FileUploadZone
              label="Inspection Photos"
              description="Upload from camera roll, CompanyCam, JobNimbus, Acculynx, or any source. ZIP archives and PDFs with photos are also supported."
              accept=".jpg,.jpeg,.png,.heic,.heif,.webp,.tiff,.tif,.bmp,.pdf,.zip"
              multiple
              required
              files={photoFiles}
              onFilesChange={setPhotoFiles}
            />

            <FileUploadZone
              label="Carrier Scope"
              description="The insurance company's estimate or scope of loss. If you don't have one yet, skip this — we'll generate a pre-scope package."
              accept=".pdf"
              files={scopeFiles}
              onFilesChange={setScopeFiles}
            />

            <FileUploadZone
              label="Weather Data"
              description="HailTrace report, NOAA data, or any storm/weather documentation for the loss date. Strengthens the forensic case."
              accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.tiff,.tif,.bmp,.zip"
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
        </form>
      </div>
    </main>
  );
}
