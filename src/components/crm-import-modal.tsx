"use client";

import { useState } from "react";

interface CrmImportModalProps {
  open: boolean;
  onClose: () => void;
  integrations: { acculynx: boolean; companycam: boolean };
  backendUrl: string;
  userId: string;
  onImport: (data: {
    address?: string;
    homeownerName?: string;
    carrier?: string;
    importedPhotoCount: number;
  }) => void;
}

type Tab = "acculynx" | "companycam";
type Step = "search" | "preview" | "importing";

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

export function CrmImportModal({
  open,
  onClose,
  integrations,
  backendUrl,
  userId,
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
  const [photoCount, setPhotoCount] = useState(0);

  // Import state
  const [importProgress, setImportProgress] = useState("");
  const [slug, setSlug] = useState("");

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
    // Fetch photo count
    try {
      const res = await fetch(
        `${backendUrl}/api/integrations/companycam/projects/${project.id}/photos?user_id=${userId}`
      );
      const data = await res.json();
      setPhotoCount((data.photos || []).length);
    } catch {
      setPhotoCount(project.photo_count || 0);
    }
    setStep("preview");
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
    setSlug(newSlug);

    try {
      const res = await fetch(
        `${backendUrl}/api/integrations/acculynx/jobs/${selectedJob.id}/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId, slug: newSlug }),
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
      });

      setTimeout(() => onClose(), 1000);
    } catch {
      setError("Failed to import from AccuLynx");
      setStep("preview");
    }
  };

  const importCompanyCam = async () => {
    if (!selectedProject) return;
    setStep("importing");
    setImportProgress("Downloading photos from CompanyCam...");
    setError("");

    const addr =
      selectedProject.address?.street_address_1 ||
      selectedProject.name ||
      "import";
    const newSlug = generateSlug(addr);
    setSlug(newSlug);

    try {
      const res = await fetch(
        `${backendUrl}/api/integrations/companycam/projects/${selectedProject.id}/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId, slug: newSlug }),
        }
      );
      const data = await res.json();
      setImportProgress(
        `Imported ${data.count || 0} photos. Populating form...`
      );

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
      });

      setTimeout(() => onClose(), 1000);
    } catch {
      setError("Failed to import from CompanyCam");
      setStep("preview");
    }
  };

  const reset = () => {
    setStep("search");
    setSearch("");
    setJobs([]);
    setProjects([]);
    setSelectedJob(null);
    setSelectedProject(null);
    setError("");
    setImportProgress("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-lg bg-[rgb(15,18,35)] border border-[var(--border-glass)] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-glass)]">
          <h2 className="text-lg font-bold text-[var(--white)]">
            Import from CRM
          </h2>
          <button
            onClick={() => {
              reset();
              onClose();
            }}
            className="text-[var(--gray-dim)] hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        {step === "search" && (
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
        <div className="p-6 max-h-[60vh] overflow-y-auto">
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
                  {searching ? "..." : "Search"}
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
                        {job.currentMilestone
                          ? ` — ${job.currentMilestone}`
                          : ""}
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
                        {project.address?.street_address_1 ||
                          project.name ||
                          "Unnamed project"}
                      </p>
                      <p className="text-xs text-[var(--gray-muted)] mt-0.5">
                        {project.photo_count
                          ? `${project.photo_count} photos`
                          : ""}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Preview Step */}
          {step === "preview" && (
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

              {tab === "acculynx" && selectedJob && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-white/[0.04] border border-[var(--border-glass)]">
                    <h3 className="text-sm font-semibold text-[var(--white)] mb-2">
                      Job Details
                    </h3>
                    <div className="space-y-1 text-sm text-[var(--gray)]">
                      <p>
                        <span className="text-[var(--gray-muted)]">Address:</span>{" "}
                        {selectedJob.streetAddress}
                        {selectedJob.city ? `, ${selectedJob.city}` : ""}
                        {selectedJob.state ? ` ${selectedJob.state}` : ""}
                      </p>
                      {selectedJob.jobNumber && (
                        <p>
                          <span className="text-[var(--gray-muted)]">Job #:</span>{" "}
                          {selectedJob.jobNumber}
                        </p>
                      )}
                      {selectedJob.currentMilestone && (
                        <p>
                          <span className="text-[var(--gray-muted)]">Status:</span>{" "}
                          {selectedJob.currentMilestone}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30">
                    <p className="text-sm text-blue-400">
                      This will import the job address, homeowner name, carrier info, and any available photos into your new claim form.
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
              )}

              {tab === "companycam" && selectedProject && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-white/[0.04] border border-[var(--border-glass)]">
                    <h3 className="text-sm font-semibold text-[var(--white)] mb-2">
                      Project Details
                    </h3>
                    <div className="space-y-1 text-sm text-[var(--gray)]">
                      <p>
                        <span className="text-[var(--gray-muted)]">Address:</span>{" "}
                        {selectedProject.address?.street_address_1 ||
                          selectedProject.name ||
                          "—"}
                      </p>
                      <p>
                        <span className="text-[var(--gray-muted)]">Photos:</span>{" "}
                        {photoCount} available (max 50 imported)
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30">
                    <p className="text-sm text-blue-400">
                      This will download up to 50 photos from this CompanyCam project and upload them to your claim.
                    </p>
                  </div>

                  {error && (
                    <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
                      {error}
                    </div>
                  )}

                  <button
                    onClick={importCompanyCam}
                    className="w-full bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white py-3 rounded-lg font-semibold transition-colors text-sm"
                  >
                    Import {photoCount} Photos
                  </button>
                </div>
              )}
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
