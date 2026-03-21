"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FileUploadZone } from "@/components/file-upload-zone";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { uploadFilesBatched } from "@/lib/upload-utils";

type UploadStatus = "idle" | "uploading" | "success" | "error";

export default function NewRepairPage() {
  const [propertyAddress, setPropertyAddress] = useState("");
  const [homeownerName, setHomeownerName] = useState("");
  const [homeownerPhone, setHomeownerPhone] = useState("");
  const [homeownerEmail, setHomeownerEmail] = useState("");
  const [rooferName, setRooferName] = useState("");
  const [skillLevel, setSkillLevel] = useState("journeyman");
  const [language, setLanguage] = useState("en");
  const [leakDescription, setLeakDescription] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [uploadProgress, setUploadProgress] = useState("");

  const canSubmit =
    propertyAddress.trim() !== "" &&
    homeownerName.trim() !== "" &&
    leakDescription.trim() !== "" &&
    photoFiles.length > 0;

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

      const slug =
        propertyAddress
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") +
        `-repair-${Date.now()}`;
      const filePath = `${user.id}/${slug}`;

      // Upload photos with concurrent batching
      setUploadProgress("Uploading photos...");
      const { uploaded: uploadedPhotos, errors } = await uploadFilesBatched(
        supabase, photoFiles, "photos", filePath, {
          concurrency: 3,
          onProgress: (done, total) =>
            setUploadProgress(`Uploading photos... ${done}/${total}`),
        }
      );
      if (uploadedPhotos.length === 0 && photoFiles.length > 0) {
        throw new Error("All photo uploads failed. Please try again.");
      }
      if (errors.length > 0) {
        console.warn("Some photos failed to upload:", errors);
      }

      // Save repair record
      const { error: dbError } = await supabase.from("repairs").insert({
        user_id: user.id,
        address: propertyAddress,
        homeowner_name: homeownerName,
        homeowner_phone: homeownerPhone.trim() || null,
        homeowner_email: homeownerEmail.trim() || null,
        slug,
        status: "uploaded",
        file_path: filePath,
        photo_files: uploadedPhotos,
        leak_description: leakDescription.trim(),
        roofer_name: rooferName.trim(),
        skill_level: skillLevel,
        preferred_language: language,
        updated_at: new Date().toISOString(),
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
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-[var(--white)] mb-2">
            Repair Request Submitted
          </h2>
          <p className="text-[var(--gray-muted)] mb-2">
            AI is diagnosing the leak and generating your repair documents.
          </p>
          <p className="text-sm text-[var(--gray-dim)] mb-8">
            This typically takes 1-2 minutes. Your roofer instructions and homeowner repair ticket will be ready shortly.
          </p>
          <a
            href="/dashboard"
            className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-8 py-3 rounded-xl font-semibold transition-colors text-sm"
          >
            Back to Dashboard
          </a>
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
            New Repair Request
          </h1>
          <p className="text-[var(--gray-muted)] mt-1">
            Upload photos of the leak and we&apos;ll diagnose, price, and generate repair documents instantly.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Property Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[var(--gray-dim)] uppercase tracking-wider">
              Property & Homeowner
            </h3>
            <div>
              <label className="block text-sm font-semibold text-[var(--white)] mb-1">
                Property Address
              </label>
              <AddressAutocomplete
                required
                value={propertyAddress}
                onChange={setPropertyAddress}
                placeholder="123 Main St, Bensalem, PA 19020"
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--white)] mb-1">
                Homeowner Name
              </label>
              <input
                type="text"
                required
                value={homeownerName}
                onChange={(e) => setHomeownerName(e.target.value)}
                placeholder="John Smith"
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-baseline gap-2 mb-1">
                  <label className="block text-sm font-semibold text-[var(--white)]">
                    Phone
                  </label>
                  <span className="text-xs text-[var(--gray-dim)] font-medium">Optional</span>
                </div>
                <input
                  type="tel"
                  value={homeownerPhone}
                  onChange={(e) => setHomeownerPhone(e.target.value)}
                  placeholder="267-555-0100"
                  className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
                />
              </div>
              <div>
                <div className="flex items-baseline gap-2 mb-1">
                  <label className="block text-sm font-semibold text-[var(--white)]">
                    Email
                  </label>
                  <span className="text-xs text-[var(--gray-dim)] font-medium">Optional</span>
                </div>
                <input
                  type="email"
                  value={homeownerEmail}
                  onChange={(e) => setHomeownerEmail(e.target.value)}
                  placeholder="john@email.com"
                  className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
                />
                <p className="text-[11px] text-[var(--gray-dim)] mt-1">
                  Adding email sends the homeowner their repair quote automatically.
                </p>
              </div>
            </div>
          </div>

          {/* Roofer Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[var(--gray-dim)] uppercase tracking-wider">
              Who&apos;s on the Roof?
            </h3>
            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <label className="block text-sm font-semibold text-[var(--white)]">
                  Roofer Name
                </label>
                <span className="text-xs text-[var(--gray-dim)] font-medium">Optional</span>
              </div>
              <input
                type="text"
                value={rooferName}
                onChange={(e) => setRooferName(e.target.value)}
                placeholder="Carlos Hernandez"
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-[var(--white)] mb-1">
                  Skill Level
                </label>
                <select
                  value={skillLevel}
                  onChange={(e) => setSkillLevel(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm bg-white"
                >
                  <option value="laborer">Laborer (max detail)</option>
                  <option value="journeyman">Journeyman (standard)</option>
                  <option value="technician">Technician (concise)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--white)] mb-1">
                  Language
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm bg-white"
                >
                  <option value="en">English (primary)</option>
                  <option value="es">Español (primary)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Leak Description */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--gray-dim)] uppercase tracking-wider">
              The Leak
            </h3>
            <div>
              <label className="block text-sm font-semibold text-[var(--white)] mb-1">
                Where is water showing up? What do you see on the roof?
              </label>
              <p className="text-xs text-[var(--gray-muted)] mb-2">
                Be specific. &quot;Water staining on ceiling below chimney, second floor bedroom. Caulk around flashing is cracking.&quot;
              </p>
              <textarea
                required
                value={leakDescription}
                onChange={(e) => setLeakDescription(e.target.value)}
                placeholder='e.g. "Water dripping from pipe boot area, visible on bathroom ceiling. Neoprene collar is cracked and lifted."'
                rows={4}
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm resize-none"
              />
            </div>
          </div>

          {/* Photos */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--gray-dim)] uppercase tracking-wider">
              Leak Area Photos
            </h3>
            <FileUploadZone
              label="Photos of the Leak"
              description="Upload from camera roll, CompanyCam, JobNimbus, Acculynx, or any photo source. PDFs with photos are also supported. More photos = better diagnosis."
              accept="image/*,.pdf,.zip"
              multiple
              required
              files={photoFiles}
              onFilesChange={setPhotoFiles}
            />
          </div>

          {/* Output Preview */}
          <div className="rounded-xl px-5 py-4 border bg-blue-500/10 border-blue-500/30">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold bg-blue-100 text-blue-700">
                2
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-800">
                  AI will generate 2 documents
                </p>
                <p className="text-xs text-blue-600">
                  Repair instructions (for roofer, bilingual, skill-calibrated) + Repair ticket (for homeowner, with price)
                </p>
              </div>
            </div>
          </div>

          {/* Error */}
          {status === "error" && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-700 text-sm rounded-lg px-4 py-3">
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
                <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {uploadProgress || "Uploading..."}
              </span>
            ) : (
              "Submit Repair Request"
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
