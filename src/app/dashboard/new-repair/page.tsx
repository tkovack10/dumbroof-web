"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FileUploadZone } from "@/components/file-upload-zone";
import { AddressAutocomplete } from "@/components/address-autocomplete";

type UploadStatus = "idle" | "uploading" | "success" | "error";

export default function NewRepairPage() {
  const [propertyAddress, setPropertyAddress] = useState("");
  const [homeownerName, setHomeownerName] = useState("");
  const [rooferName, setRooferName] = useState("");
  const [skillLevel, setSkillLevel] = useState("journeyman");
  const [language, setLanguage] = useState("en");
  const [leakDescription, setLeakDescription] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const supabase = createClient();

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

      // Upload photos via server-signed URLs
      const uploadedPhotos: string[] = [];
      for (const file of photoFiles) {
        const res = await fetch("/api/storage/sign-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder: "photos", fileName: file.name, claimPath: filePath }),
        });
        const urlData = await res.json();
        if (!res.ok) throw new Error(`Failed to upload ${file.name}: ${urlData.error}`);

        const { error } = await supabase.storage
          .from("claim-documents")
          .uploadToSignedUrl(urlData.path, urlData.token, file);
        if (error) throw new Error(`Failed to upload ${file.name}: ${error.message}`);
        uploadedPhotos.push(urlData.safeName);
      }

      // Save repair record
      const { error: dbError } = await supabase.from("repairs").insert({
        user_id: user.id,
        address: propertyAddress,
        homeowner_name: homeownerName,
        slug,
        status: "uploaded",
        file_path: filePath,
        photo_files: uploadedPhotos,
        leak_description: leakDescription.trim(),
        roofer_name: rooferName.trim(),
        skill_level: skillLevel,
        preferred_language: language,
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
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-[var(--navy)] mb-2">
            Repair Request Submitted
          </h2>
          <p className="text-gray-500 mb-2">
            AI is diagnosing the leak and generating your repair documents.
          </p>
          <p className="text-sm text-gray-400 mb-8">
            This typically takes 1-2 minutes. Your roofer instructions and homeowner repair ticket will be ready shortly.
          </p>
          <a
            href="/dashboard"
            className="bg-[var(--navy)] hover:bg-[var(--navy-light)] text-white px-8 py-3 rounded-xl font-semibold transition-colors text-sm"
          >
            Back to Dashboard
          </a>
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
            New Repair Request
          </h1>
          <p className="text-gray-500 mt-1">
            Upload photos of the leak and we&apos;ll diagnose, price, and generate repair documents instantly.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Property Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Property & Homeowner
            </h3>
            <div>
              <label className="block text-sm font-semibold text-[var(--navy)] mb-1">
                Property Address
              </label>
              <AddressAutocomplete
                required
                value={propertyAddress}
                onChange={setPropertyAddress}
                placeholder="123 Main St, Bensalem, PA 19020"
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--navy)] mb-1">
                Homeowner Name
              </label>
              <input
                type="text"
                required
                value={homeownerName}
                onChange={(e) => setHomeownerName(e.target.value)}
                placeholder="John Smith"
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
              />
            </div>
          </div>

          {/* Roofer Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Who&apos;s on the Roof?
            </h3>
            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <label className="block text-sm font-semibold text-[var(--navy)]">
                  Roofer Name
                </label>
                <span className="text-xs text-gray-400 font-medium">Optional</span>
              </div>
              <input
                type="text"
                value={rooferName}
                onChange={(e) => setRooferName(e.target.value)}
                placeholder="Carlos Hernandez"
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-[var(--navy)] mb-1">
                  Skill Level
                </label>
                <select
                  value={skillLevel}
                  onChange={(e) => setSkillLevel(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm bg-white"
                >
                  <option value="laborer">Laborer (max detail)</option>
                  <option value="journeyman">Journeyman (standard)</option>
                  <option value="technician">Technician (concise)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--navy)] mb-1">
                  Language
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm bg-white"
                >
                  <option value="en">English (primary)</option>
                  <option value="es">Español (primary)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Leak Description */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              The Leak
            </h3>
            <div>
              <label className="block text-sm font-semibold text-[var(--navy)] mb-1">
                Where is water showing up? What do you see on the roof?
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Be specific. &quot;Water staining on ceiling below chimney, second floor bedroom. Caulk around flashing is cracking.&quot;
              </p>
              <textarea
                required
                value={leakDescription}
                onChange={(e) => setLeakDescription(e.target.value)}
                placeholder='e.g. "Water dripping from pipe boot area, visible on bathroom ceiling. Neoprene collar is cracked and lifted."'
                rows={4}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none transition-colors text-sm resize-none"
              />
            </div>
          </div>

          {/* Photos */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Leak Area Photos
            </h3>
            <FileUploadZone
              label="Photos of the Leak"
              description="Upload from camera roll, CompanyCam, JobNimbus, Acculynx, or any photo source. PDFs with photos are also supported. More photos = better diagnosis."
              accept=".jpg,.jpeg,.png,.heic,.heif,.webp,.tiff,.tif,.bmp,.pdf,.zip"
              multiple
              required
              files={photoFiles}
              onFilesChange={setPhotoFiles}
            />
          </div>

          {/* Output Preview */}
          <div className="rounded-xl px-5 py-4 border bg-blue-50 border-blue-200">
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
                <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Uploading...
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
