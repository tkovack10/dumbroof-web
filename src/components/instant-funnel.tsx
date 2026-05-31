"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { AgenticDropZone, type DropItem, type IntakeCategory } from "@/components/agentic-drop-zone";

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
  collectsMaterials?: boolean;
};

type Phase = "idle" | "processing" | "unlock";
type Storm = "" | "hail" | "wind" | "combined";

// Material options for the supplement funnel — values are sent as cookies +
// stored in claims.estimate_request JSONB so the processor can resolve the
// right Xactimate codes when no photos are present to infer materials.
const ROOF_TYPE_OPTIONS = [
  ["3_tab", "3-tab"],
  ["laminate", "Laminate / Architectural shingle"],
  ["high_grade_laminate", "High-grade laminate"],
  ["slate", "Slate"],
  ["standing_seam_metal", "Standing seam metal"],
  ["epdm", "EPDM"],
  ["tpo", "TPO"],
] as const;

const GUTTER_TYPE_OPTIONS = [
  ["k_style_5", '5" K-style aluminum'],
  ["k_style_6", '6" K-style aluminum'],
  ["half_round", "Half-round"],
  ["copper", "Copper"],
  ["galvanized", "Galvanized"],
  ["na", "N/A — not part of this claim"],
] as const;

const SIDING_TYPE_OPTIONS = [
  ["vinyl", "Vinyl"],
  ["aluminum", "Aluminum"],
  ["fiber_cement", "Fiber cement (Hardie)"],
  ["wood", "Wood"],
  ["stucco", "Stucco"],
  ["brick_veneer", "Brick veneer"],
  ["stone_veneer", "Stone veneer"],
  ["na", "N/A — not part of this claim"],
] as const;

type RoofType = "" | (typeof ROOF_TYPE_OPTIONS)[number][0];
type GutterType = "" | (typeof GUTTER_TYPE_OPTIONS)[number][0];
type SidingType = "" | (typeof SIDING_TYPE_OPTIONS)[number][0];

const STEP_DURATION_MS = 1500; // 4 steps × 1.5s = 6s minimum animation

export function InstantFunnel({
  funnel,
  copy,
  inputs,
  collectsDolStormType,
  collectsMaterials,
}: InstantFunnelProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  // One agentic drop box replaces the old per-folder FunnelDropZone list. Each
  // item carries the file + its (auto-detected, user-correctable) category; we
  // stage them at unlock time so a category correction never leaves a stale
  // copy in the wrong folder.
  const [items, setItems] = useState<DropItem[]>([]);
  const [dol, setDol] = useState("");
  const [storm, setStorm] = useState<Storm>("");
  const [roofType, setRoofType] = useState<RoofType>("");
  const [gutterType, setGutterType] = useState<GutterType>("");
  const [sidingType, setSidingType] = useState<SidingType>("");
  const [error, setError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [uploadDone, setUploadDone] = useState(false);
  const animDoneRef = useRef(false);
  const startedRef = useRef(false);

  const today = new Date().toISOString().slice(0, 10);

  // Which folders this funnel needs at least one file in (derived from the
  // page's input config so the single drop box keeps the same gating the
  // typed boxes had: forensic → photos; supplement → measurements + scope).
  const requiredFolders = inputs
    .filter((cfg) => cfg.required)
    .map((cfg) => cfg.folder) as IntakeCategory[];

  const readyItems = items.filter((it) => it.status === "ready");
  const presentFolders = new Set(readyItems.map((it) => it.category));
  const allRequiredFoldersPresent =
    requiredFolders.length > 0
      ? requiredFolders.every((f) => presentFolders.has(f))
      : readyItems.length > 0;

  const allRequiredPresent =
    allRequiredFoldersPresent &&
    (!collectsDolStormType || (dol && storm)) &&
    (!collectsMaterials || (roofType && gutterType && sidingType));

  // A human-readable list of what the funnel still needs, shown under the box
  // so the user knows why the CTA is disabled (was previously implicit in the
  // separate "Required" drop zones).
  const missingFolders = requiredFolders.filter((f) => !presentFolders.has(f));

  const fireBrowserPixel = (eventId: string) => {
    try {
      window.fbq?.("track", "Upload", { funnel }, { eventID: eventId });
    } catch {
      /* no-op */
    }
  };

  const uploadAll = async () => {
    // Stage each dropped file into its FINAL (auto-detected or user-corrected)
    // category. "other" has no claim-side column, so route it to the funnel's
    // most useful bucket: photos for forensic, scope for supplement.
    const otherFallback: IntakeCategory = funnel === "supplement" ? "scope" : "photos";
    const allFiles = readyItems.map((it) => ({
      folder: (it.category === "other" ? otherFallback : it.category) as IntakeCategory,
      file: it.file,
    }));
    if (allFiles.length === 0) {
      throw new Error("No files selected");
    }

    let firstEventId: string | null = null;
    let dolSent = false;
    let damageSent = false;
    let materialsSent = false;

    // Sequential upload — keeps a single anon token consistent across files
    // (the upload endpoint reuses the cookie's token if the funnel matches).
    // Concurrent would race the cookie set and create multiple anon dirs.
    for (const { folder, file } of allFiles) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("funnel", funnel);
      fd.append("folder", folder);
      // Only attach DOL / damage_type / materials to the FIRST request — the
      // endpoint sets them as cookies and they don't need to be re-sent.
      if (collectsDolStormType && !dolSent && dol) {
        fd.append("dol", dol);
        dolSent = true;
      }
      if (collectsDolStormType && !damageSent && storm) {
        fd.append("damage_type", storm);
        damageSent = true;
      }
      if (collectsMaterials && !materialsSent && roofType && gutterType && sidingType) {
        fd.append("roof_type", roofType);
        fd.append("gutter_type", gutterType);
        fd.append("siding_type", sidingType);
        materialsSent = true;
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

            {collectsMaterials && (
              <div className="space-y-4 mb-5">
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    Roof type <span className="text-[var(--red)]">*</span>
                  </label>
                  <select
                    value={roofType}
                    onChange={(e) => setRoofType(e.target.value as RoofType)}
                    className="w-full bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-lg px-3 py-2 text-sm text-[var(--white)] outline-none focus:border-[var(--red)]"
                  >
                    <option value="">Select roof type…</option>
                    {ROOF_TYPE_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    Gutter type <span className="text-[var(--red)]">*</span>
                  </label>
                  <select
                    value={gutterType}
                    onChange={(e) => setGutterType(e.target.value as GutterType)}
                    className="w-full bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-lg px-3 py-2 text-sm text-[var(--white)] outline-none focus:border-[var(--red)]"
                  >
                    <option value="">Select gutter type…</option>
                    {GUTTER_TYPE_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    Siding type <span className="text-[var(--red)]">*</span>
                  </label>
                  <select
                    value={sidingType}
                    onChange={(e) => setSidingType(e.target.value as SidingType)}
                    className="w-full bg-[var(--bg-glass)] border border-[var(--border-glass)] rounded-lg px-3 py-2 text-sm text-[var(--white)] outline-none focus:border-[var(--red)]"
                  >
                    <option value="">Select siding type…</option>
                    {SIDING_TYPE_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <AgenticDropZone
                deferStaging
                onItemsChange={setItems}
                title="Drop your files — Richard sorts them"
                hint={
                  funnel === "supplement"
                    ? "Your measurement report and the carrier's estimate. Richard detects which is which — fix it if he's wrong."
                    : "Roof photos, a measurement report, or the carrier's estimate. Richard figures out what each one is — you can correct it."
                }
              />
              {missingFolders.length > 0 && readyItems.length > 0 && (
                <p className="text-xs text-[var(--gray-muted)]">
                  Still need:{" "}
                  {missingFolders
                    .map((f) =>
                      f === "photos"
                        ? "roof photos"
                        : f === "measurements"
                          ? "a measurement report"
                          : "the carrier's scope"
                    )
                    .join(" and ")}
                  .
                </p>
              )}
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

            <RecentWinsStrip />
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

// Recent wins below the drop zone — real customer screenshots (address strip
// already cropped out at /tmp/dumbroof-wins → /public/wins/). Each card shows
// the celebration banner + lifecycle panel as a single 1080x1761 portrait
// image. Scrolls horizontally on mobile, wraps to a 3-up grid on desktop.
// Ordered by dollar amount descending — leads with the strongest single-claim
// recovery. Mix of percentage-driven wins (denial overturned, 7×) and
// closed-and-paid claims (4/4 lifecycle phase) so the carousel feels varied
// instead of "just big numbers."
const RECENT_WINS = [
  { src: "/wins/win5-buckingham.jpeg", amount: "+$137,562", pct: "7× increase", note: "Morrisville, PA" },
  { src: "/wins/win3-bellfarm.jpeg", amount: "+$60,023", pct: "54% increase", note: "Saddle River, NJ" },
  { src: "/wins/win6-deerrun.jpeg", amount: "+$40,685", pct: "Denial overturned", note: "Binghamton, NY" },
  { src: "/wins/win1-greenway.jpeg", amount: "+$36,904", pct: "33% increase", note: "Yardley, PA" },
  { src: "/wins/win7-30k-77pct.jpeg", amount: "+$30,628", pct: "77% increase", note: "Closed + paid" },
  { src: "/wins/win4-riverside.jpeg", amount: "+$21,565", pct: "75% increase", note: "Closed + paid" },
  { src: "/wins/win8-19k-160pct.jpeg", amount: "+$19,850", pct: "160% increase", note: "Recently won" },
  { src: "/wins/win9-19k-48pct-binghamton.jpeg", amount: "+$19,644", pct: "48% increase", note: "Binghamton, NY" },
  { src: "/wins/win2-alfred.jpeg", amount: "+$13,035", pct: "60% increase", note: "Binghamton, NY" },
] as const;

function RecentWinsStrip() {
  return (
    <section className="mt-10 -mx-5 px-5">
      <div className="mb-4">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--gray-muted)] mb-1">
          Recent customer wins
        </p>
        <h3 className="text-lg font-semibold text-[var(--white)]">
          Real claims. Real numbers. Real movement.
        </h3>
      </div>
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-3 [-webkit-overflow-scrolling:touch] scrollbar-thin">
        {RECENT_WINS.map((win) => (
          <figure
            key={win.src}
            className="relative shrink-0 w-[260px] snap-start rounded-2xl overflow-hidden border border-[var(--border-glass)] bg-[var(--bg-glass)]"
          >
            <Image
              src={win.src}
              alt={`${win.amount} won — ${win.note}`}
              width={1080}
              height={1761}
              className="w-full h-auto"
              sizes="260px"
            />
            <figcaption className="px-3 py-3 border-t border-[var(--border-glass)] bg-[rgba(0,0,0,0.4)]">
              <p className="text-base font-bold text-white">{win.amount}</p>
              <p className="text-xs text-[var(--gray-muted)]">
                {win.pct} · {win.note}
              </p>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="text-xs text-[var(--gray-dim)] mt-1">
        117 claims processed · $6.9M+ recovered for our customers
      </p>

      <CustomerQuotes />
    </section>
  );
}

// Direct customer quotes — different psychological lever than the dollar
// screenshots above. Quotes hit on time savings, denial overturns,
// competitive win rate, and a credibility-building honest minor-flaws note
// to defang the "AI sounds too good to be true" objection.
const CUSTOMER_QUOTES = [
  {
    quote:
      "We used to pay a supplement company 10% of approved supplements. This is better and cheaper.",
    attribution: "Roofing owner — switched from a 10% supplement vendor",
  },
  {
    quote:
      "We had a claim that was denied. We sent the carrier the forensic report hoping for a reinspection. They contacted the homeowner the next day saying the roof is approved. They didn't even send someone out for a reinspection. Amazing.",
    attribution: "Roofing contractor — denial overturned",
  },
  {
    quote:
      "We are in the Chicago suburbs and there's been some great hail. Tons of roofing companies here though. We've been giving our leads the forensic report while we're still on site after the inspection. All 7 homeowners we showed picked us over the other companies in the neighborhood. Standard operating procedure for our reps moving forward.",
    attribution: "Roofing owner — Chicago suburbs",
  },
  {
    quote:
      "To be honest, I was skeptical of this and signed up just to see what it was. Our first DumbRoof claim just went from $18k to $27k. I'm impressed.",
    attribution: "First-time user",
  },
  {
    quote:
      "I used to spend hours writing estimates, ordering code reports, writing supplement emails. It's really amazing the time I've saved using the DumbRoof supplement automations — not to mention two separate carriers have told me they're impressed with the reports we sent in.",
    attribution: "Roofing contractor",
  },
  {
    quote: "Impressive. Fast. Couple minor errors but it was easy to make edits.",
    attribution: "Honest review",
  },
] as const;

function CustomerQuotes() {
  return (
    <section className="mt-10">
      <div className="mb-4">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--gray-muted)] mb-1">
          What customers are saying
        </p>
        <h3 className="text-lg font-semibold text-[var(--white)]">
          Real roofers. Real claims. Real results.
        </h3>
      </div>
      <div className="space-y-3">
        {CUSTOMER_QUOTES.map((q, i) => (
          <figure
            key={i}
            className="rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-glass)] p-4"
          >
            <svg
              className="w-5 h-5 text-[var(--gray-dim)] mb-2"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M9 7H6a3 3 0 00-3 3v2a3 3 0 003 3h1v3a1 1 0 001 1h2a1 1 0 001-1v-7a4 4 0 00-2-3.46V7zm10 0h-3a3 3 0 00-3 3v2a3 3 0 003 3h1v3a1 1 0 001 1h2a1 1 0 001-1v-7a4 4 0 00-2-3.46V7z" />
            </svg>
            <blockquote className="text-sm text-[var(--white)] leading-relaxed">
              {q.quote}
            </blockquote>
            <figcaption className="mt-3 text-xs text-[var(--gray-muted)]">
              — {q.attribution}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
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
