"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spectral, Libre_Franklin, IBM_Plex_Mono } from "next/font/google";
import { AgenticDropZone, type DropItem, type IntakeCategory } from "@/components/agentic-drop-zone";
import { RichardIcon } from "@/components/richard-icon";
import { trackBoth, FunnelEvent } from "@/lib/track";

// ── Anonymous Richard-chat landing (/start), Spectral skin ─────────────────
// Ad-pointable route that drops a visitor STRAIGHT into a Richard conversation,
// anonymous-first, re-skinned to the Spectral design language (flat navy/brick,
// three-voice type, NO gradients, NO emoji in chrome).
//
// Why scripted turns (not a live /api/admin-brain/chat stream): that backend
// endpoint requires a user_id (loads the user's company profile + writes
// per-user chat history) and 400s without one — there is no anonymous code
// path, and the backend is frozen. So this landing reuses the PROVEN anonymous
// instant-intake pipeline:
//   • files upload to anon-instant-intake/<token>/<folder>/ via
//     /api/instant-intake/upload (funnel="forensic" — sets the 24h cookie),
//   • each file is auto-classified by /api/classify-intake (multipart, no auth)
//     inside the shared <AgenticDropZone>, and
//   • "Start my claim" → /signup?next=/instant/continue, where the existing
//     /api/instant-intake/claim moves the staged files into a real claim.
//
// The "watch Richard work" feed is driven by the REAL upload/classify-intake
// events the drop zone already emits (per-file classifying → uploading → ready)
// — NOT a faked timer and NOT the net-new per-stage backend stream (deferred).
//
// This is ADDITIVE — the homepage and /fb signup landings are untouched.

// Weights trimmed to only what this page renders (ad-landing LCP):
//   serif 600 (h2) + italic 400 (moat); sans 400/600/700/800; mono 400/600/700.
const spectral = Spectral({
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  variable: "--font-spectral",
  display: "swap",
});
const libre = Libre_Franklin({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-libre",
  display: "swap",
});
const plex = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-plex",
  display: "swap",
});

const FUNNEL = "forensic" as const;

interface Turn {
  role: "richard" | "user";
  content: string;
}

// The three real capability modes (DropConfig: photos | measurements | scope),
// surfaced as a ledger that lights up by what's provided.
const CHIPS: { key: string; cat: IntakeCategory; builds: string }[] = [
  { key: "FORENSIC", cat: "photos", builds: "Forensic Causation Report" },
  { key: "X-STYLE BUILD", cat: "measurements", builds: "Xactimate-style estimate" },
  { key: "SUPPLEMENT", cat: "scope", builds: "scope comparison + supplement" },
];

// Per-file feed copy, keyed off the REAL detected category.
const FEED_READY: Record<IntakeCategory, { label: string; builds: string }> = {
  photos: { label: "Roof photos", builds: "building your Forensic Report" },
  measurements: { label: "EagleView measurements", builds: "adding your Xactimate-style estimate" },
  scope: { label: "Carrier scope", builds: "finding every line they left out" },
  other: { label: "File received", builds: "added to your claim file" },
};

// Rotating tips ticker — soft upsell + education, mapped to real capabilities.
const TIPS = [
  "TIP — Close-up hail shots beat wide shots. Richard scores tight, in-focus impacts higher.",
  "TIP — Add your EagleView and Richard prices every line item to your local market.",
  "TIP — Got a denial letter? Drop it in — Richard writes the appeal.",
  "TIP — Richard re-reads everything and rebuilds the report each time you add a file.",
  "DID YOU KNOW — Richard cites the exact building code (e.g. RCNYS R703.2) on every claim.",
];

const DASH_TILES: { label: string; body: string }[] = [
  {
    label: "One-click send to carrier",
    body: "Richard drafts the carrier email with the report attached. You approve. It sends.",
  },
  {
    label: "Homeowner updates + engagement",
    body: "Keep the homeowner in the loop automatically — every milestone, no chasing.",
  },
  {
    label: "Supplement automation",
    body: "Richard runs the Day 3 / 7 / 14 / 21 follow-up cadence so the carrier never goes quiet.",
  },
  {
    label: "Full Richard control",
    body: "The chat lives on every claim — line items, pricing, photo coaching, NOAA weather, carrier playbook, by approval.",
  },
];

const WINS: { amount: string; pct: string; note: string }[] = [
  { amount: "+$137,562", pct: "7× increase", note: "Morrisville, PA" },
  { amount: "+$60,023", pct: "54% increase", note: "Saddle River, NJ" },
  { amount: "+$40,685", pct: "Denial overturned", note: "Binghamton, NY" },
];

function lit(cats: Set<IntakeCategory>, cat: IntakeCategory): boolean {
  return cats.has(cat);
}

// Adaptive Richard reply keyed to WHAT the user gave him.
function adaptiveReply(cats: Set<IntakeCategory>): string {
  const p = cats.has("photos");
  const m = cats.has("measurements");
  const s = cats.has("scope");
  if (p && m && s) {
    return "This is everything — I'm building the full package: a forensic report, a full estimate, and a side-by-side of exactly what your carrier missed. This is the one that moves claims. Add files anytime — reports regenerate.";
  }
  if (s) {
    return "Got the carrier's scope — I'll read it line by line and show you every item they left out, then build the supplement. Add your photos and EagleView and I'll back it with a forensic report and a full estimate. Add files anytime — reports regenerate.";
  }
  if (m && !p) {
    return "Perfect — measurements are all I need for an Xactimate-style estimate, line items and pricing for your market. Add photos and I'll prove the damage with a forensic report; add the carrier scope and I'll find the gap. Add files anytime — reports regenerate.";
  }
  return "Got your photos — I can see these. I'm building you a Forensic Causation Report right now: every shingle, the damage type, the storm that caused it, and the building code that backs it up. Drop your EagleView for a full estimate, or the carrier's scope and I'll show you line-by-line what they left out. Add files anytime — reports regenerate.";
}

// ── inline Spectral glyphs (no emoji in chrome) ────────────────────────────
function MicGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
    </svg>
  );
}
function SendGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12h14M12 6l6 6-6 6" />
    </svg>
  );
}
function CheckGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function StartChat() {
  const greeting =
    "Hey — I'm Richard. I do storm-damage roof claims all day, every day. Send me what ya got — inspection photos, your EagleView measurements, the insurance scope, whatever's on your phone. I'll read it and start building. No account, no form. Just show me the roof.";

  const [turns, setTurns] = useState<Turn[]>([{ role: "richard", content: greeting }]);
  const [items, setItems] = useState<DropItem[]>([]);
  const [note, setNote] = useState("");
  const [listening, setListening] = useState(false);
  const [staging, setStaging] = useState(false);
  const [tipIdx, setTipIdx] = useState(0);

  const recognitionRef = useRef<unknown>(null);
  const [micSupported, setMicSupported] = useState(false);

  const readyItems = items.filter((it) => it.status === "ready");
  const hasReady = readyItems.length > 0;
  const readyCats = useMemo(() => {
    const s = new Set<IntakeCategory>();
    for (const it of readyItems) s.add(it.category);
    return s;
  }, [readyItems]);

  // Rotate the tips ticker (real browser timer — no backend).
  useEffect(() => {
    const t = setInterval(() => setTipIdx((i) => (i + 1) % TIPS.length), 4200);
    return () => clearInterval(t);
  }, []);

  // Funnel: ad-clicker landed on /start. GA4 auto-fires page_view; this is the
  // NAMED funnel step (GA4 + Vercel + funnel_events DB) so /start can be compared
  // to /fb/whoops in the landing split test. Once per mount.
  useEffect(() => {
    trackBoth(FunnelEvent.START_LANDING_VIEW, { funnel: FUNNEL });
  }, []);

  // Web Speech dictation — progressive enhancement, self-contained (no backend).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR =
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    if (SR) setMicSupported(true);
  }, []);

  const toggleMic = useCallback(() => {
    const w = window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    if (listening) {
      (recognitionRef.current as { stop?: () => void } | null)?.stop?.();
      return;
    }
    const rec = new SR() as {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onend: () => void;
      onerror: () => void;
      start: () => void;
      stop: () => void;
    };
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      setNote(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }, [listening]);

  // Anonymous upload — stage one file into anon-instant-intake/<token>/<folder>.
  // "other" has no claim-side column, so it lands in photos (forensic default).
  const uploadFile = useMemo(
    () => async (file: File, category: IntakeCategory) => {
      const folder = category === "other" ? "photos" : category;
      const fd = new FormData();
      fd.append("file", file);
      fd.append("funnel", FUNNEL);
      fd.append("folder", folder);
      const res = await fetch("/api/instant-intake/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Upload failed (${res.status})`);
      }
    },
    []
  );

  // Scripted Richard reaction when a NEW file finishes — keyed to the live
  // category set so the copy adapts (photos vs measurements vs scope).
  const handleItems = (next: DropItem[]) => {
    const prevReadyCount = items.filter((it) => it.status === "ready").length;
    const nextReady = next.filter((it) => it.status === "ready");
    setItems(next);
    if (nextReady.length > prevReadyCount) {
      const cats = new Set<IntakeCategory>();
      for (const it of nextReady) cats.add(it.category);
      // Funnel: a file finished classify + stage — the core engagement step that
      // was previously untracked. GA4 + Vercel + funnel_events DB, + a Meta custom
      // event for mid-funnel visibility.
      const catList = Array.from(cats).join(",");
      trackBoth(FunnelEvent.START_INTAKE_READY, { ready_count: nextReady.length, categories: catList });
      try {
        window.fbq?.("trackCustom", "StartIntakeReady", { categories: catList, ready_count: nextReady.length });
      } catch {
        /* non-fatal — analytics must never break the flow */
      }
      setTurns((prev) => {
        // Replace a trailing Richard line so the convo stays tight.
        const base = prev[prev.length - 1]?.role === "richard" && prev.length > 1 ? prev.slice(0, -1) : prev;
        return [...base, { role: "richard", content: adaptiveReply(cats) }];
      });
    }
  };

  const sendNote = () => {
    const text = note.trim();
    if (!text) return;
    setTurns((prev) => [
      ...prev,
      { role: "user", content: text },
      {
        role: "richard",
        content:
          "Got it. Drop your photos, your EagleView, or the carrier's scope whenever you're ready and I'll start building — or hit Start my claim and we'll pick it right up from here.",
      },
    ]);
    try {
      sessionStorage.setItem("richard_intake_note", text);
    } catch {
      /* sessionStorage may be unavailable (private mode) — non-fatal. */
    }
    setNote("");
  };

  const startClaim = () => {
    if (!hasReady || staging) return;
    setStaging(true);
    if (note.trim()) {
      try {
        sessionStorage.setItem("richard_intake_note", note.trim());
      } catch {
        /* non-fatal */
      }
    }
    // Funnel: intent-to-activate — the key /start conversion step (clicking
    // through to signup with files staged). trackBoth uses sendBeacon so it
    // survives the navigation; a Meta custom event mirrors it for mid-funnel
    // visibility (the standard StartTrial fires downstream on claim creation).
    const catList = Array.from(readyCats).join(",");
    trackBoth(FunnelEvent.START_CLAIM_CLICKED, { ready_count: readyItems.length, categories: catList });
    try {
      window.fbq?.("trackCustom", "StartClaimClicked", { categories: catList, ready_count: readyItems.length });
    } catch {
      /* non-fatal */
    }
    // Files are already staged anonymously under the instant-intake cookie
    // token. Hand off to the existing signup → /instant/continue pipeline.
    window.location.href = "/signup?next=" + encodeURIComponent("/instant/continue");
  };

  const composer = (idSuffix: string) => (
    <div className="rounded-[8px] border border-[var(--c-hairline-navy)] bg-[var(--c-fill-navy)] p-2.5 flex items-end gap-2">
      <textarea
        id={`composer-${idSuffix}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendNote();
          }
        }}
        rows={1}
        aria-label="Tell Richard about your roof"
        placeholder="Type or talk — tell Richard about your roof…"
        className="ss-textarea flex-1 min-h-[40px] max-h-32 py-2 px-1 leading-snug"
      />
      {micSupported && (
        <button
          type="button"
          onClick={toggleMic}
          aria-label={listening ? "Stop dictation" : "Dictate to Richard"}
          className={`ss-iconbtn ${listening ? "ss-iconbtn--live ss-pulse" : ""} w-10 h-10`}
        >
          <MicGlyph />
        </button>
      )}
      <button
        type="button"
        onClick={sendNote}
        disabled={!note.trim()}
        aria-label="Send"
        className="ss-iconbtn ss-iconbtn--send w-10 h-10"
      >
        <SendGlyph />
      </button>
    </div>
  );

  return (
    <main
      className={`${spectral.variable} ${libre.variable} ${plex.variable} start-spectral relative min-h-[100dvh] flex flex-col overflow-x-hidden`}
    >
      {/* ── top bar: logo leads ─────────────────────────────────────────── */}
      <header className="relative px-4 sm:px-6 h-14 flex items-center justify-between border-b border-[var(--c-hairline-navy)]">
        <div className="flex items-center gap-2.5">
          <RichardIcon size={26} />
          <div className="ss-wordmark text-[15px] leading-none">
            DumbRoof
            <span className="sub">Storm-damage claims</span>
          </div>
        </div>
        <a
          href="/login?next=/dashboard"
          className="ss-kicker text-[var(--c-on-navy-mute)] hover:text-[var(--c-on-navy)] transition-colors"
        >
          Sign in
        </a>
      </header>

      {/* ── HERO: the conversation, already in progress ─────────────────── */}
      <section className="relative flex-1 px-4 sm:px-6 py-7">
        <div className="max-w-xl mx-auto">
          <p className="ss-eyebrow mb-3">Talk to Richard · free · no card</p>

          {/* conversation thread */}
          <div className="space-y-4">
            {turns.map((t, i) =>
              t.role === "richard" ? (
                <div key={i} className="flex gap-3">
                  <div className="w-8 h-8 rounded-[6px] bg-[var(--c-fill-navy)] border border-[var(--c-hairline-navy)] flex items-center justify-center flex-shrink-0 mt-0.5">
                    <RichardIcon size={19} />
                  </div>
                  <div className="min-w-0 flex-1 text-[15px] leading-relaxed text-[var(--c-on-navy-dim)] pt-1">
                    {t.content}
                    {i === turns.length - 1 && <span className="ss-caret" aria-hidden />}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[82%] rounded-[3px] border-l-[3px] border-[var(--c-brick-bright)] bg-[var(--c-navy-soft)] px-3.5 py-2 text-[15px] text-[var(--c-on-navy)]">
                    {t.content}
                  </div>
                </div>
              )
            )}
          </div>

          {/* capability chips — light by what's provided */}
          <div className="mt-5 flex flex-wrap gap-2">
            {CHIPS.map((c) => {
              const on = lit(readyCats, c.cat);
              return (
                <span key={c.key} className={`ss-chip ${on ? "ss-chip--lit" : ""}`} title={c.builds}>
                  <span className="dot" />
                  {c.key}
                </span>
              );
            })}
          </div>

          {/* the console: drop surface + type/talk composer */}
          <div className="mt-4 rounded-[8px] border border-[var(--c-hairline-navy)] bg-[var(--c-fill-navy)] p-3 space-y-3">
            <AgenticDropZone
              uploadFile={uploadFile}
              onItemsChange={handleItems}
              title="Drop your photos, EagleView, or the carrier's scope"
              hint="Richard detects what each file is — you can correct him. Or type / talk below."
            />
            {composer("hero")}
            <p className="ss-mono text-[12px] text-[var(--c-on-navy-mute)] text-center pt-0.5">
              Free. No card. Your files stay private.
            </p>
          </div>

          {/* ── WATCH RICHARD WORK: live event feed from real classify/upload ── */}
          {items.length > 0 && (
            <div className="mt-5 ss-worksurface p-4">
              <p className="ss-kicker text-[var(--c-slate)] mb-2.5">Watch Richard work</p>
              <div>
                {items.map((it) => {
                  if (it.status === "classifying") {
                    return (
                      <div key={it.id} className="ss-feedline ss-feedline--active ss-pulse">
                        <span className="glyph">›</span>
                        <span>Reading {it.name}…</span>
                      </div>
                    );
                  }
                  if (it.status === "uploading") {
                    return (
                      <div key={it.id} className="ss-feedline ss-feedline--active ss-pulse">
                        <span className="glyph">›</span>
                        <span>Staging {it.name}…</span>
                      </div>
                    );
                  }
                  if (it.status === "error") {
                    return (
                      <div key={it.id} className="ss-feedline ss-feedline--error">
                        <span className="glyph">✕</span>
                        <span>Couldn&apos;t read {it.name} — try dropping it again.</span>
                      </div>
                    );
                  }
                  const meta = FEED_READY[it.category];
                  return (
                    <div key={it.id} className="ss-feedline ss-feedline--done">
                      <span className="glyph">
                        <CheckGlyph />
                      </span>
                      <span>
                        {meta.label} — {meta.builds}.
                      </span>
                    </div>
                  );
                })}
              </div>
              {/* tips ticker */}
              <div className="mt-3 pt-3 border-t border-[var(--c-line,#d8d2c5)]">
                <p key={tipIdx} className="ss-tip">
                  {TIPS[tipIdx]}
                </p>
              </div>
            </div>
          )}

          {/* start-claim CTA — appears once at least one file is ready */}
          {hasReady && (
            <div className="mt-5 rounded-[8px] border border-[var(--c-brick-bright)]/40 bg-[var(--c-navy-soft)] p-4">
              <p className="text-[14px] text-[var(--c-on-navy-dim)] mb-3">
                Your report is staged. Create a free account and I&apos;ll build it and save it — no credit card.
              </p>
              <button
                onClick={startClaim}
                disabled={staging}
                className="ss-btn-primary w-full text-[15px] py-3.5 inline-flex items-center justify-center gap-2"
              >
                {staging ? "Taking you there…" : "Start my claim"}
                {!staging && <SendGlyph size={17} />}
              </button>
              <p className="ss-mono mt-3 text-[11px] text-[var(--c-on-navy-mute)] text-center">
                Free · No card · Your files stay private, visible only to you and DumbRoof support.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── DASHBOARD TAKEOVER ───────────────────────────────────────────── */}
      <section className="relative px-4 sm:px-6 py-10 border-t border-[var(--c-hairline-navy)]">
        <div className="max-w-xl mx-auto">
          <p className="ss-eyebrow mb-2">Once it&apos;s built, your dashboard takes over</p>
          <h2 className="ss-serif text-[22px] sm:text-[25px] font-semibold text-[var(--c-on-navy)] leading-tight mb-2">
            An agentic claims hub, not a filing cabinet
          </h2>
          <p className="ss-serif italic text-[15px] text-[var(--c-on-navy-dim)] leading-relaxed mb-5">
            Roofing-grade claims depth and agentic automation, running on the best AI on earth. The big
            roofing-tech platforms can&apos;t match this.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DASH_TILES.map((tile) => (
              <div key={tile.label} className="ss-tile p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[var(--c-brick-warm)]">
                    <CheckGlyph size={15} />
                  </span>
                  <span className="ss-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--c-on-navy)]">
                    {tile.label}
                  </span>
                </div>
                <p className="text-[13.5px] text-[var(--c-on-navy-dim)] leading-relaxed">{tile.body}</p>
              </div>
            ))}
          </div>

          {/* proof strip — real figures */}
          <div className="mt-6 rounded-[8px] border-t-2 border-[var(--c-brick)] bg-[var(--c-navy-soft)] px-4 py-4 text-center">
            <p className="ss-mono text-[13px] text-[var(--c-on-navy)]">
              $20M+ in claims processed · $3M+ in approved supplements
            </p>
          </div>

          {/* real win cards */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {WINS.map((w) => (
              <div key={w.note} className="ss-tile p-3 text-center">
                <p className="ss-mono text-[15px] font-semibold text-[var(--c-brick-warm)]">{w.amount}</p>
                <p className="ss-mono text-[11px] text-[var(--c-on-navy-mute)] mt-1 leading-tight">{w.pct}</p>
                <p className="text-[11px] text-[var(--c-on-navy-mute)] mt-0.5 leading-tight">{w.note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CLOSING CTA: back to the conversation ───────────────────────── */}
      <section className="relative px-4 sm:px-6 py-10 border-t border-[var(--c-hairline-navy)]">
        <div className="max-w-xl mx-auto">
          <div className="flex gap-3 mb-4">
            <div className="w-8 h-8 rounded-[6px] bg-[var(--c-fill-navy)] border border-[var(--c-hairline-navy)] flex items-center justify-center flex-shrink-0 mt-0.5">
              <RichardIcon size={19} />
            </div>
            <div className="min-w-0 flex-1 text-[15px] leading-relaxed text-[var(--c-on-navy-dim)] pt-1">
              Still got that roof on your phone? Send it over — I&apos;ll have your report before you finish
              your coffee.
            </div>
          </div>
          {composer("close")}
          <p className="ss-mono mt-3 text-[12px] text-[var(--c-on-navy-mute)] text-center">
            Free. No card. Your files stay private.
          </p>
          <p className="mt-4 text-center text-[13px] text-[var(--c-on-navy-mute)]">
            Already have an account?{" "}
            <a href="/login?next=/dashboard" className="text-[var(--c-brick-warm)] hover:underline">
              Sign in
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
