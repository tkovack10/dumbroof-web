"use client";

import { useMemo, useState } from "react";
import { AgenticDropZone, type DropItem, type IntakeCategory } from "@/components/agentic-drop-zone";
import { RichardIcon } from "@/components/richard-icon";

// ── Anonymous Richard-chat landing (/start) ───────────────────────────────
// Ad-pointable route that drops a visitor STRAIGHT into a Richard conversation,
// anonymous-first. Richard greets immediately, the single agentic drop box is
// rendered inline, and the report can be STAGED before an account exists —
// account creation is prompted AFTER.
//
// Why scripted turns (not a live /api/admin-brain/chat stream): that backend
// endpoint requires a user_id (it loads the user's company profile + writes
// per-user chat history) and 400s without one — there is no anonymous code
// path, and the backend is frozen (lives on main from #114, must not change).
// So this landing reuses the PROVEN anonymous instant-intake pipeline:
//   • files upload to anon-instant-intake/<token>/<folder>/ via
//     /api/instant-intake/upload (funnel="forensic" — sets the 24h cookie),
//   • each file is auto-classified by /api/classify-intake (multipart — no auth
//     needed; the agentic box does this), and
//   • "Start my claim" → /signup?next=/instant/continue, where the existing
//     /api/instant-intake/claim moves the staged files into a real claim the
//     instant a user signs up. Richard's replies are scripted reactions, so the
//     conversation is genuinely anonymous and fully self-contained.
//
// This is ADDITIVE — the homepage and /fb signup landings are untouched.

interface Turn {
  role: "richard" | "user";
  content: string;
}

const FUNNEL = "forensic" as const;

const CATEGORY_PHRASE: Record<IntakeCategory, string> = {
  photos: "roof photos",
  measurements: "a measurement report",
  scope: "the carrier's estimate",
  other: "a file",
};

function summarize(items: DropItem[]): string {
  const ready = items.filter((it) => it.status === "ready");
  const counts: Record<IntakeCategory, number> = { photos: 0, measurements: 0, scope: 0, other: 0 };
  for (const it of ready) counts[it.category] += 1;
  const parts: string[] = [];
  if (counts.photos) parts.push(`${counts.photos} roof photo${counts.photos === 1 ? "" : "s"}`);
  if (counts.measurements) parts.push("a measurement report");
  if (counts.scope) parts.push("the carrier's estimate");
  if (counts.other) parts.push(`${counts.other} other file${counts.other === 1 ? "" : "s"}`);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

export function StartChat() {
  const greeting =
    "Hey — I'm Richard. Send me what ya got — a few roof photos, a measurement report, or your carrier's estimate — and I'll start your claim.";

  const [turns, setTurns] = useState<Turn[]>([{ role: "richard", content: greeting }]);
  const [items, setItems] = useState<DropItem[]>([]);
  const [staging, setStaging] = useState(false);

  const readyItems = items.filter((it) => it.status === "ready");
  const hasReady = readyItems.length > 0;

  // Anonymous upload — stage one file into anon-instant-intake/<token>/<folder>.
  // "other" has no claim-side column, so it lands in photos (a forensic claim's
  // default + the most forgiving bucket).
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

  // Scripted Richard reaction when the file set changes. Only react to NEW ready
  // files so we don't spam a line on every status tick.
  const handleItems = (next: DropItem[]) => {
    const prevReadyCount = items.filter((it) => it.status === "ready").length;
    const nextReady = next.filter((it) => it.status === "ready");
    setItems(next);
    if (nextReady.length > prevReadyCount) {
      const latest = nextReady[nextReady.length - 1];
      const phrase = CATEGORY_PHRASE[latest.category];
      setTurns((prev) => {
        // Replace a trailing Richard "got it" line so the convo stays tight.
        const base = prev[prev.length - 1]?.role === "richard" && prev.length > 1 ? prev.slice(0, -1) : prev;
        return [
          ...base,
          {
            role: "richard",
            content: `Got it — that looks like ${phrase}. ${
              nextReady.length >= 1
                ? "Drop anything else you have, or hit “Start my claim” and I'll get to work."
                : ""
            }`,
          },
        ];
      });
    }
  };

  const startClaim = () => {
    if (!hasReady || staging) return;
    setStaging(true);
    // Files are already staged anonymously under the instant-intake cookie
    // token. Hand off to the existing signup → /instant/continue pipeline,
    // which creates the real claim and moves the files the moment they sign up.
    window.location.href = "/signup?next=" + encodeURIComponent("/instant/continue");
  };

  return (
    <main className="relative min-h-[100dvh] flex flex-col bg-[#08080c] text-white overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-32 h-72"
        style={{
          background:
            "radial-gradient(55% 100% at 50% 0%, rgba(139,92,246,0.16), rgba(236,72,153,0.05) 45%, transparent 72%)",
        }}
      />

      <header className="relative px-4 h-14 flex items-center gap-2.5 border-b border-white/[0.06] backdrop-blur-xl">
        <RichardIcon size={24} />
        <div>
          <div className="text-white/90 text-[13px] font-medium leading-tight">Richard</div>
          <div className="text-white/35 text-[11px] leading-tight">DumbRoof · start your claim</div>
        </div>
      </header>

      <div className="relative flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-xl mx-auto space-y-5">
          {turns.map((t, i) =>
            t.role === "richard" ? (
              <div key={i} className="flex gap-3">
                <div className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <RichardIcon size={18} />
                </div>
                <div className="min-w-0 flex-1 text-[15px] leading-relaxed text-white/85 pt-0.5">
                  {t.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md bg-white/[0.07] border border-white/[0.06] px-3.5 py-2 text-[15px] text-white/90">
                  {t.content}
                </div>
              </div>
            )
          )}

          {/* The single agentic drop box, inline in the conversation. */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3">
            <AgenticDropZone
              uploadFile={uploadFile}
              onItemsChange={handleItems}
              title="Drop your files here — Richard sorts them"
              hint="Roof photos, a measurement report, or the carrier's estimate. He detects each one; you can correct it."
            />
          </div>

          {hasReady && (
            <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.06] p-4">
              <p className="text-[13px] text-white/70 mb-3">
                {`I've got ${summarize(readyItems)}. Create a free account and I'll build your report — no credit card.`}
              </p>
              <button
                onClick={startClaim}
                disabled={staging}
                className="w-full bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 disabled:opacity-60 text-white text-[15px] font-medium py-3 rounded-xl transition-colors shadow-[0_8px_30px_-8px_rgba(139,92,246,0.6)]"
              >
                {staging ? "Taking you there…" : "Start my claim →"}
              </button>
              <p className="mt-3 text-[11px] text-white/30 text-center">
                Free. No card required. Your files stay private — visible only to you and DumbRoof support.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
