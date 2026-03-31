"use client";

import { useState } from "react";

interface CrmImportModalProps {
  open: boolean;
  onClose: () => void;
  integrations: { acculynx: boolean; companycam: boolean };
  backendUrl: string;
  userId: string;
  targetPath?: string;     // Override storage base path (claim's file_path)
  targetFolder?: string;   // Subfolder (e.g., "install-photos")
  onPhotoPaths?: (paths: string[]) => void | Promise<void>;  // Callback with imported storage paths
  onImport: (data: {
    address?: string;
    homeownerName?: string;
    carrier?: string;
    importedPhotoCount: number;
    slug?: string;
  }) => void;
}

type Tab = "acculynx" | "companycam";
type Step = "search" | "preview" | "photos" | "importing";

interface AccuLynxJob {
  id: string;
  jobNumber?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  currentMilestone?: string;
}

interface CompanyCamProject {
  id: string;
  name?: string;
  address?: { street_address_1?: string; city?: string; state?: string };
  photo_count?: number;
}

interface PhotoItem {
  id: string;
  url: string | null;
  photo_url: string | null; // thumbnail
  created_at?: string;
}

export function CrmImportModal({
  open,
  onClose,
  integrations,
  backendUrl,
  userId,
  targetPath,
  targetFolder,
  onPhotoPaths,
  onImport,
}: CrmImportModalProps) {
  const defaultTab: Tab = integrations.acculynx ? "acculynx" : "companycam";
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [step, setStep] = useState<Step>("search");
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  // AccuLynx state
  const [jobs, setJobs] = useState<AccuLynxJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<AccuLynxJob | null>(null);

  // CompanyCam state
  const [projects, setProjects] = useState<CompanyCamProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<CompanyCamProject | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [selectedPhotoIndices, setSelectedPhotoIndices] = useState<Set<number>>(new Set());
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  // Import state
  const [importProgress, setImportProgress] = useState("");

  if (!open) return null;

  const generateSlug = (address: string) => {
    return (
      address
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") +
      `-${Date.now()}`
    );
  };

  const searchAccuLynx = async () => {
    setSearching(true);
    setError("");
    try {
      const res = await fetch(
        `${backendUrl}/api/integrations/acculynx/jobs?user_id=${userId}&search=${encodeURIComponent(search)}`
      );
      const data = await res.json();
      setJobs(data.jobs || []);
      if ((data.jobs || []).length === 0) {
        setError("No jobs found. Try a different search term.");
      }
    } catch {
      setError("Failed to search AccuLynx jobs");
    }
    setSearching(false);
  };

  const searchCompanyCam = async () => {
    setSearching(true);
    setError("");
    try {
      const res = await fetch(
        `${backendUrl}/api/integrations/companycam/projects?user_id=${userId}&query=${encodeURIComponent(search)}`
      );
      const data = await res.json();
      setProjects(data.projects || []);
      if ((data.projects || []).length === 0) {
        setError("No projects found. Try a different address.");
      }
    } catch {
      setError("Failed to search CompanyCam projects");
    }
    setSearching(false);
  };

  const handleSearch = () => {
    if (tab === "acculynx") searchAccuLynx();
    else searchCompanyCam();
  };

  const selectAccuLynxJob = (job: AccuLynxJob) => {
    setSelectedJob(job);
    setStep("preview");
  };

  const selectCompanyCamProject = async (project: CompanyCamProject) => {
    setSelectedProject(project);
    setLoadingPhotos(true);
    setError("");
    try {
      const res = await fetch(
        `${backendUrl}/api/integrations/companycam/projects/${project.id}/photos?user_id=${userId}`
      );
      const data = await res.json();
      const photoList = data.photos || [];
      setPhotos(photoList);
      // Pre-select first 100 photos
      const initial = new Set<number>();
      for (let i = 0; i < Math.min(photoList.length, 100); i++) initial.add(i);
      setSelectedPhotoIndices(initial);
    } catch {
      setPhotos([]);
    }
    setLoadingPhotos(false);
    setStep("photos");
  };

  const togglePhoto = (idx: number) => {
    setSelectedPhotoIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else if (next.size < 100) next.add(idx);
      return next;
    });
  };

  const selectAllPhotos = () => {
    const all = new Set<number>();
    for (let i = 0; i < Math.min(photos.length, 100); i++) all.add(i);
    setSelectedPhotoIndices(all);
  };

  const deselectAllPhotos = () => {
    setSelectedPhotoIndices(new Set());
  };

  const importAccuLynx = async () => {
    if (!selectedJob) return;
    setStep("importing");
    setImportProgress("Fetching job data and photos from AccuLynx...");
    setError("");

    const addr = [selectedJob.streetAddress, selectedJob.city, selectedJob.state]
      .filter(Boolean)
      .join(", ");
    const newSlug = generateSlug(addr || "import");

    try {
      const res = await fetch(
        `${backendUrl}/api/integrations/acculynx/jobs/${selectedJob.id}/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            slug: newSlug,
            ...(targetPath ? { target_path: targetPath, target_folder: targetFolder || "photos" } : {}),
          }),
        }
      );
      const data = await res.json();
      setImportProgress(
        `Imported ${data.photo_count || 0} photos. Populating form...`
      );

      onImport({
        address: data.address || addr,
        homeownerName: data.homeowner || "",
        carrier: data.carrier || "",
        importedPhotoCount: data.photo_count || 0,
        slug: newSlug,
      });

      if (onPhotoPaths && data.paths) {
        await onPhotoPaths(data.paths);
      }

      setTimeout(() => onClose(), 1000);
    } catch {
      setError("Failed to import from AccuLynx");
      setStep("preview");
    }
  };

  const importCompanyCam = async () => {
    if (!selectedProject || selectedPhotoIndices.size === 0) return;
    setStep("importing");
    setImportProgress(`Downloading ${selectedPhotoIndices.size} photos from CompanyCam...`);
    setError("");

    const addr =
      selectedProject.address?.street_address_1 ||
      selectedProject.name ||
      "import";
    const newSlug = generateSlug(addr);

    try {
      const res = await fetch(
        `${backendUrl}/api/integrations/companycam/projects/${selectedProject.id}/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            slug: newSlug,
            selected_indices: Array.from(selectedPhotoIndices).sort((a, b) => a - b),
            ...(targetPath ? { target_path: targetPath, target_folder: targetFolder || "photos" } : {}),
          }),
        }
      );
      const data = await res.json();
      setImportProgress(
        `Imported ${data.count || 0} photos. Populating form...`
      );

      onPhotoPaths?.(data.paths || []);

      const projectAddr = [
        selectedProject.address?.street_address_1,
        selectedProject.address?.city,
        selectedProject.address?.state,
      ]
        .filter(Boolean)
        .join(", ");

      onImport({
        address: projectAddr || selectedProject.name || "",
        importedPhotoCount: data.count || 0,
        slug: newSlug,
      });

      setTimeout(() => onClose(), 1000);
    } catch {
      setError("Failed to import from CompanyCam");
      setStep("photos");
    }
  };

  const reset = () => {
    setStep("search");
    setSearch("");
    setJobs([]);
    setProjects([]);
    setSelectedJob(null);
    setSelectedProject(null);
    setPhotos([]);
    setSelectedPhotoIndices(new Set());
    setError("");
    setImportProgress("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-2xl bg-[rgb(15,18,35)] border border-[var(--border-glass)] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-glass)]">
          <h2 className="text-lg font-bold text-[var(--white)]">
            Import from CRM
          </h2>
          <button
            onClick={() => { reset(); onClose(); }}
            className="text-[var(--gray-dim)] hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        {step === "search" && (integrations.acculynx || integrations.companycam) && (
          <div className="flex border-b border-[var(--border-glass)]">
            {integrations.acculynx && (
              <button
                onClick={() => { setTab("acculynx"); setJobs([]); setProjects([]); setError(""); }}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                  tab === "acculynx"
                    ? "text-white border-b-2 border-[var(--cyan)]"
                    : "text-[var(--gray-dim)] hover:text-white"
                }`}
              >
                AccuLynx
              </button>
            )}
            {integrations.companycam && (
              <button
                onClick={() => { setTab("companycam"); setJobs([]); setProjects([]); setError(""); }}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                  tab === "companycam"
                    ? "text-white border-b-2 border-[var(--cyan)]"
                    : "text-[var(--gray-dim)] hover:text-white"
                }`}
              >
                CompanyCam
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="p-6 max-h-[70vh] overflow-y-auto">
          {/* Not connected state */}
          {!integrations.acculynx && !integrations.companycam && (
            <div className="text-center py-8 space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-[var(--cyan)]/10 flex items-center justify-center mx-auto">
                <svg className="w-7 h-7 text-[var(--cyan)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.718a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.343 8.97" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-[var(--white)] mb-1">Connect Your CRM</h3>
                <p className="text-sm text-[var(--gray-muted)] max-w-sm mx-auto">
                  Import completion photos directly from CompanyCam or AccuLynx. Connect in Settings to get started.
                </p>
              </div>
              <a
                href="/dashboard/settings"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] text-white text-sm font-semibold hover:shadow-lg transition-all"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.204-.107-.397.165-.71.505-.78.929l-.15.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Go to Settings
              </a>
            </div>
          )}
          {/* Search Step */}
          {step === "search" && (
            <>
              <div className="flex gap-3 mb-4">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder={
                    tab === "acculynx"
                      ? "Search by address, job number, or name..."
                      : "Search by address..."
                  }
                  className="flex-1 px-4 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-glass)] text-[var(--white)] placeholder:text-[var(--gray-dim)] focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] outline-none transition-colors text-sm"
                />
                <button
                  onClick={handleSearch}
                  disabled={searching}
                  className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                >
                  {searching ? "Searching..." : "Search"}
                </button>
              </div>

              {error && (
                <p className="text-sm text-[var(--gray-muted)] mb-4">{error}</p>
              )}

              {/* AccuLynx Results */}
              {tab === "acculynx" && jobs.length > 0 && (
                <div className="space-y-2">
                  {jobs.map((job) => (
                    <button
                      key={job.id}
                      onClick={() => selectAccuLynxJob(job)}
                      className="w-full text-left p-3 rounded-lg bg-white/[0.04] border border-[var(--border-glass)] hover:border-[var(--cyan)] transition-colors"
                    >
                      <p className="text-sm font-medium text-[var(--white)]">
                        {job.streetAddress || "No address"}
                        {job.city ? `, ${job.city}` : ""}
                        {job.state ? ` ${job.state}` : ""}
                      </p>
                      <p className="text-xs text-[var(--gray-muted)] mt-0.5">
                        {job.jobNumber ? `#${job.jobNumber}` : ""}
                        {job.currentMilestone ? ` — ${job.currentMilestone}` : ""}
                      </p>
                    </button>
                  ))}
                </div>
              )}

              {/* CompanyCam Results */}
              {tab === "companycam" && projects.length > 0 && (
                <div className="space-y-2">
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => selectCompanyCamProject(project)}
                      className="w-full text-left p-3 rounded-lg bg-white/[0.04] border border-[var(--border-glass)] hover:border-[var(--cyan)] transition-colors"
                    >
                      <p className="text-sm font-medium text-[var(--white)]">
                        {project.address?.street_address_1 || project.name || "Unnamed project"}
                      </p>
                      <p className="text-xs text-[var(--gray-muted)] mt-0.5">
                        {project.photo_count ? `${project.photo_count} photos` : ""}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* AccuLynx Preview Step */}
          {step === "preview" && tab === "acculynx" && selectedJob && (
            <>
              <button
                onClick={reset}
                className="text-sm text-[var(--gray-dim)] hover:text-white transition-colors mb-4 flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back to search
              </button>

              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-white/[0.04] border border-[var(--border-glass)]">
                  <h3 className="text-sm font-semibold text-[var(--white)] mb-2">Job Details</h3>
                  <div className="space-y-1 text-sm text-[var(--gray)]">
                    <p>
                      <span className="text-[var(--gray-muted)]">Address:</span>{" "}
                      {selectedJob.streetAddress}
                      {selectedJob.city ? `, ${selectedJob.city}` : ""}
                      {selectedJob.state ? ` ${selectedJob.state}` : ""}
                    </p>
                    {selectedJob.jobNumber && (
                      <p><span className="text-[var(--gray-muted)]">Job #:</span> {selectedJob.jobNumber}</p>
                    )}
                    {selectedJob.currentMilestone && (
                      <p><span className="text-[var(--gray-muted)]">Status:</span> {selectedJob.currentMilestone}</p>
                    )}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30">
                  <p className="text-sm text-blue-400">
                    This will auto-fill the address, homeowner name, and carrier from AccuLynx. You&#39;ll still upload photos and measurements separately.
                  </p>
                </div>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
                    {error}
                  </div>
                )}

                <button
                  onClick={importAccuLynx}
                  className="w-full bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white py-3 rounded-lg font-semibold transition-colors text-sm"
                >
                  Import from AccuLynx
                </button>
              </div>
            </>
          )}

          {/* CompanyCam Photo Picker Step */}
          {step === "photos" && tab === "companycam" && selectedProject && (
            <>
              <button
                onClick={reset}
                className="text-sm text-[var(--gray-dim)] hover:text-white transition-colors mb-4 flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back to search
              </button>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--white)]">
                      Select Photos to Import
                    </h3>
                    <p className="text-xs text-[var(--gray-muted)] mt-0.5">
                      {selectedPhotoIndices.size} of {photos.length} selected (max 100)
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={selectAllPhotos}
                      className="text-xs text-[var(--cyan)] hover:text-white transition-colors"
                    >
                      Select All
                    </button>
                    <span className="text-[var(--gray-dim)]">|</span>
                    <button
                      onClick={deselectAllPhotos}
                      className="text-xs text-[var(--gray-muted)] hover:text-white transition-colors"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>

                {loadingPhotos ? (
                  <div className="text-center py-8">
                    <div className="w-8 h-8 border-2 border-[var(--cyan)] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-xs text-[var(--gray-muted)]">Loading photos...</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 max-h-[50vh] overflow-y-auto pr-1">
                    {photos.map((photo, idx) => {
                      const isSelected = selectedPhotoIndices.has(idx);
                      const thumbUrl = photo.photo_url || photo.url;
                      return (
                        <button
                          key={photo.id || idx}
                          onClick={() => togglePhoto(idx)}
                          className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                            isSelected
                              ? "border-[var(--cyan)] ring-1 ring-[var(--cyan)]"
                              : "border-transparent hover:border-white/20"
                          }`}
                          style={{ paddingBottom: "100%", height: 0, position: "relative" }}
                        >
                          {thumbUrl ? (
                            <img
                              src={thumbUrl}
                              alt={`Photo ${idx + 1}`}
                              className="absolute inset-0 w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="absolute inset-0 w-full h-full bg-white/[0.06] flex items-center justify-center">
                              <svg className="w-6 h-6 text-[var(--gray-dim)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5" />
                              </svg>
                            </div>
                          )}
                          {isSelected && (
                            <div className="absolute top-1 right-1 w-4 h-4 bg-[var(--cyan)] rounded-full flex items-center justify-center z-10">
                              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          )}
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[9px] text-white text-center py-px z-10">
                            {idx + 1}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3 mb-4">
                  {error}
                </div>
              )}

              <button
                onClick={importCompanyCam}
                disabled={selectedPhotoIndices.size === 0}
                className="w-full bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-50 text-white py-3 rounded-lg font-semibold transition-colors text-sm"
              >
                Import {selectedPhotoIndices.size} Selected Photos
              </button>
            </>
          )}

          {/* Importing Step */}
          {step === "importing" && (
            <div className="text-center py-8">
              <div className="w-12 h-12 border-2 border-[var(--cyan)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm text-[var(--white)] font-medium">
                {importProgress || "Importing..."}
              </p>
              <p className="text-xs text-[var(--gray-muted)] mt-2">
                This may take a moment for large photo sets.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
