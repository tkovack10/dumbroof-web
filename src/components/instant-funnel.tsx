"use client";

import { useEffect, useRef, useState } from "react";

// Shared 3-state funnel UI used by /instant-forensic + /instant-supplement.
// Mirrors the Perplexity Computer FB-ad pattern Tom screenshot'd:
//   1. idle:       hero + drop zone(s), no email field
//   2. processing: animated checkmark sequence while files genuinely upload
//   3. unlock:     "Unlock your X" CTA → /signup?next=/instant/continue
//
// The genius is asking for the artifact (PDF / photos) BEFORE the email — by
// the time the user hits the auth wall they've already invested effort
// uploading, so the auth wall feels like the final step, not a gate.

export type InstantFunnelKind = "forensic" | "supplement";

export type DropConfig = {
  folder: "photos" | "measurements" | "scope";
  label: string;
  description: string;
  accept: string;
  multiple: boolean;
  required: boolean;
};

export type InstantFunnelCopy = {
  h1: string;
  sub: string;
  checkmarks: [string, string, string, string];
  lockButton: string;
  successHeadline: string;
};

export type InstantFunnelProps = {
  funnel: InstantFunnelKind;
  copy: InstantFunnelCopy;
  inputs: DropConfig[];
  collectsDolStormType?: boolean;
};

type Phase = "idle" | "processing" | "unlock";
type Storm = "" | "hail" | "wind" | "combined";

const STEP_DURATION_MS = 1500; // 4 steps × 1.5s = 6s minimum animation

export function InstantFunnel({
  funnel,
  copy,
  inputs,
  collectsDolStormType,
}: InstantFunnelProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [dol, setDol] = useState("");
  const [storm, setStorm] = useState<Storm>("");
  const [error, setError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [uploadDone, setUploadDone] = useState(false);
  const animDoneRef = useRef(false);
  const startedRef = useRef(false);

  const today = new Date().toISOString().slice(0, 10);

  const setFolderFiles = (folder: string, picked: File[]) => {
    setFiles((prev) => ({ ...prev, [folder]: picked }));
  };

  const allRequiredPresent =
    inputs.every((cfg) => !cfg.required || (files[cfg.folder]?.length ?? 0) > 0) &&
    (!collectsDolStormType || (dol && storm));

  const fireBrowserPixel = (eventId: string) => {
    try {
      window.fbq?.("track", "Upload", { funnel }, { eventID: eventId });
    } catch {
      /* no-op */
    }
  };

  const uploadAll = async () => {
    const allFiles = inputs.flatMap((cfg) =>
      (files[cfg.folder] || []).map((f) => ({ folder: cfg.folder, file: f }))
    );
    if (allFiles.length === 0) {
      throw new Error("No files selected");
    }

    let firstEventId: string | null = null;
    let dolSent = false;
    let damageSent = false;

    // Sequential upload — keeps a single anon token consistent across files
    // (the upload endpoint reuses the cookie's token if the funnel matches).
    // Concurrent would race the cookie set and create multiple anon dirs.
    for (const { folder, file } of allFiles) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("funnel", funnel);
      fd.append("folder", folder);
      // Only attach DOL / damage_type to the FIRST request — the endpoint
      // sets them as cookies and they don't need to be re-sent.
      if (collectsDolStormType && !dolSent && dol) {
        fd.append("dol", dol);
        dolSent = true;
      }
      if (collectsDolStormType && !damageSent && storm) {
        fd.append("damage_type", storm);
        damageSent = true;
      }

      const res = await fetch("/api/instant-intake/upload", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Upload failed (${res.status})`);
      }
      const body = (await res.json()) as { eventId?: string };
      if (!firstEventId && body.eventId) firstEventId = body.eventId;
    }

    if (firstEventId) fireBrowserPixel(firstEventId);
  };

  const handleStart = async () => {
    if (!allRequiredPresent || startedRef.current) return;
    startedRef.current = true;
    setError(null);
    setPhase("processing");
    setActiveStep(0);

    // Animate the 4 checkmarks regardless of upload speed — UX commitment is
    // a visible 6s of "the AI is working." If upload is faster, we wait;
    // if slower, the upload promise blocks the unlock state.
    const interval = window.setInterval(() => {
      setActiveStep((s) => {
        if (s >= 3) {
          window.clearInterval(interval);
          animDoneRef.current = true;
          return 4;
        }
        return s + 1;
      });
    }, STEP_DURATION_MS);

    try {
      await uploadAll();
      setUploadDone(true);
    } catch (err) {
      window.clearInterval(interval);
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("idle");
      startedRef.current = false;
    }
  };

  // Unlock once both the animation and the upload are done.
  useEffect(() => {
    if (phase !== "processing") return;
    if (uploadDone && activeStep >= 4) setPhase("unlock");
  }, [phase, uploadDone, activeStep]);

  const handleUnlock = () => {
    window.location.href = "/signup?next=" + encodeURIComponent("/instant/continue");
  };

  return (
    <main className="min-h-screen bg-[var(--bg-deep)] text-[var(--white)]">
      <div className="mx-auto w-full max-w-xl px-5 pt-8 pb-16">
        <div className="mb-6 flex items-center gap-2">
          <span className="text-xl font-extrabold tracking-tight gradient-text">
            dumbroof<span className="font-normal opacity-70">.ai</span>
          </span>
        </div>

        {phase === "idle" && (
          <>
            <h1 className="text-3xl font-bold leading-tight tracking-tight mb-3">
              {copy.h1}
            </h1>
            <p className="text-[var(--gray-muted)] text-sm leading-relaxed mb-6">
              {copy.sub}
            </p>

            {collectsDolStormType && (
              <div className="space-y-4 mb-5">
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    Date of loss <span className="text-[var(--red)]">*</span>
                  </label>
                  <input
                    type="date"
                    max={today}
                    value={dol}
                    onChange={(e) => setDol(e.target.value)}
                    className="w-full bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-lg px-3 py-2 text-sm text-[var(--white)] outline-none focus:border-[var(--red)]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    Storm type <span className="text-[var(--red)]">*</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        ["hail", "Hail"],
                        ["wind", "Wind"],
                        ["combined", "Hail + Wind"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setStorm(value)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                          storm === value
                            ? "border-[var(--red)] bg-[var(--pink)]/10 text-[var(--white)]"
                            : "border-[var(--border-glass)] bg-[var(--bg-glass)] text-[var(--gray-muted)] hover:text-[var(--white)]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {inputs.map((cfg) => (
                <FunnelDropZone
                  key={cfg.folder}
                  config={cfg}
                  files={files[cfg.folder] || []}
                  onFilesChange={(picked) => setFolderFiles(cfg.folder, picked)}
                />
              ))}
            </div>

            {error && (
              <div className="mt-4 bg-red-500/10 border border-red-500/20 text-red-300 text-sm rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleStart}
              disabled={!allRequiredPresent}
              className="w-full mt-6 bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] disabled:opacity-30 text-white py-3 rounded-lg font-semibold text-sm transition-opacity"
            >
              Generate my report →
            </button>

            <p className="mt-4 text-xs text-[var(--gray-dim)] text-center">
              Free. No card required. Your files stay private — visible only to your team and DumbRoof support.
            </p>
          </>
        )}

        {phase === "processing" && (
          <ProcessingScreen
            steps={copy.checkmarks}
            activeStep={activeStep}
            lockButton={copy.lockButton}
          />
        )}

        {phase === "unlock" && (
          <UnlockScreen
            headline={copy.successHeadline}
            buttonLabel={copy.lockButton}
            onClick={handleUnlock}
          />
        )}
      </div>
    </main>
  );
}

function FunnelDropZone({
  config,
  files,
  onFilesChange,
}: {
  config: DropConfig;
  files: File[];
  onFilesChange: (picked: File[]) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    onFilesChange(config.multiple ? [...files, ...dropped] : dropped.slice(0, 1));
  };
  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    onFilesChange(config.multiple ? [...files, ...picked] : picked.slice(0, 1));
    e.target.value = "";
  };
  const removeAt = (i: number) => onFilesChange(files.filter((_, idx) => idx !== i));

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <label className="block text-sm font-semibold">{config.label}</label>
        {config.required ? (
          <span className="text-xs text-[var(--red)] font-medium">Required</span>
        ) : (
          <span className="text-xs text-[var(--gray-dim)]">Optional</span>
        )}
      </div>
      <p className="text-xs text-[var(--gray-muted)] mb-2">{config.description}</p>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
          dragging
            ? "border-[var(--red)] bg-[var(--pink)]/10"
            : files.length > 0
              ? "border-green-300/60 bg-green-500/10"
              : "border-[var(--border-glass)] bg-[var(--bg-glass)]"
        }`}
      >
        <input
          type="file"
          accept={config.accept}
          multiple={config.multiple}
          onChange={handleSelect}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        {files.length === 0 ? (
          <div>
            <svg className="w-8 h-8 text-[var(--gray-dim)] mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-sm text-[var(--gray-muted)]">
              Tap to choose, or drop a file here
            </p>
          </div>
        ) : (
          <div className="space-y-2 text-left">
            {files.map((file, i) => (
              <div key={`${file.name}-${i}`} className="flex items-center justify-between bg-[var(--bg-glass)] border border-white/[0.04] rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
                  </svg>
                  <span className="text-sm truncate">{file.name}</span>
                  <span className="text-xs text-[var(--gray-dim)] shrink-0">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAt(i);
                  }}
                  className="text-[var(--gray-dim)] hover:text-red-400 ml-2 shrink-0"
                  aria-label="Remove file"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProcessingScreen({
  steps,
  activeStep,
  lockButton,
}: {
  steps: string[];
  activeStep: number;
  lockButton: string;
}) {
  return (
    <div className="flex flex-col items-center text-center pt-6">
      <div className="w-12 h-12 mb-5 flex items-center justify-center rounded-xl border border-[var(--border-glass)] bg-[var(--bg-glass)]">
        <svg className="w-6 h-6 text-[var(--white)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="M7 20h10" strokeLinecap="round" />
          <path d="M9 8.5h6M9 12h4" strokeLinecap="round" />
        </svg>
      </div>
      <h2 className="text-2xl font-bold mb-6">Designing your workflow…</h2>

      <div className="w-full space-y-3">
        {steps.map((label, i) => {
          const done = i < activeStep;
          const active = i === activeStep && activeStep < steps.length;
          return (
            <div
              key={i}
              className={`flex items-start gap-3 text-left rounded-xl border px-4 py-3 transition-colors ${
                done
                  ? "border-green-400/30 bg-green-500/10"
                  : active
                    ? "border-[var(--red)]/40 bg-[var(--pink)]/5"
                    : "border-[var(--border-glass)] bg-[var(--bg-glass)]"
              }`}
            >
              <div
                className={`shrink-0 mt-0.5 w-6 h-6 rounded-md border flex items-center justify-center ${
                  done
                    ? "border-green-400/50 bg-green-500/20"
                    : "border-[var(--border-glass)] bg-[var(--bg-deep)]"
                }`}
              >
                {done ? (
                  <svg className="w-4 h-4 text-green-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : active ? (
                  <span className="block w-2 h-2 rounded-full bg-[var(--red)] animate-pulse" />
                ) : null}
              </div>
              <span className={`text-sm leading-relaxed ${done ? "text-[var(--white)]" : active ? "text-[var(--white)]" : "text-[var(--gray-muted)]"}`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        disabled
        className="mt-6 inline-flex items-center gap-2 bg-[var(--bg-glass)] border border-[var(--border-glass)] text-[var(--gray-muted)] py-3 px-5 rounded-lg font-medium text-sm cursor-not-allowed"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 10-8 0v4M5 11h14v9a2 2 0 01-2 2H7a2 2 0 01-2-2v-9z" />
        </svg>
        {lockButton}
      </button>
    </div>
  );
}

function UnlockScreen({
  headline,
  buttonLabel,
  onClick,
}: {
  headline: string;
  buttonLabel: string;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center pt-6">
      <div className="w-14 h-14 mb-5 flex items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--pink)] via-[var(--purple)] to-[var(--blue)]">
        <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-2xl font-bold mb-2">Your report is ready.</h2>
      <p className="text-[var(--gray-muted)] text-sm mb-6 max-w-sm">
        {headline} Create a free account in 10 seconds to view it — no credit card.
      </p>
      <button
        type="button"
        onClick={onClick}
        className="w-full bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] text-white py-3 rounded-lg font-semibold text-sm"
      >
        {buttonLabel} →
      </button>
      <p className="mt-4 text-xs text-[var(--gray-dim)]">
        Already have an account?{" "}
        <a href={"/login?next=" + encodeURIComponent("/instant/continue")} className="underline hover:text-white">
          Sign in
        </a>
      </p>
    </div>
  );
}
