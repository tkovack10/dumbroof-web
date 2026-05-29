"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { useRouter } from "next/navigation";
import { getRichardAuthHeaders } from "@/lib/richard-auth";
import { RichardIcon } from "@/components/richard-icon";
import { MarkdownContent } from "@/components/markdown-content";

// Richard ONBOARDING surface (/welcome). A brand-new, signed-in user's first
// experience: Richard creates their first claim conversationally. Files stage to
// {user_id}/{slug}/{folder}/ via /api/onboarding/upload; Richard discovers them
// and creates the claim (scope="onboarding"). Activation is the bottleneck —
// see project_richard_onboarding_activation.

type Folder = "photos" | "scope" | "measurements";
interface Msg { role: "user" | "assistant"; content: string; }
interface StagedFile { key: string; name: string; folder: Folder; status: "uploading" | "done" | "error"; previewUrl?: string; }

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

function makeSlug(): string {
  const rnd =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `richard-${rnd}`;
}

const STARTERS: { label: string; prompt: string }[] = [
  { label: "I have roof photos", prompt: "I have inspection photos of the roof to upload." },
  { label: "I have the carrier's estimate", prompt: "I have the insurance carrier's estimate / scope." },
  { label: "Not sure where to start", prompt: "I'm not sure where to start — what do you need from me first?" },
];

const REPORT_LABELS: Record<string, string> = {
  forensic_only: "forensic damage report",
  supplement_only: "instant supplement",
  full: "full appeal package",
};

function cleanText(t: string): string {
  return t.replace(/\n*\*Running:[^*]*\*\n*/g, "\n").trimStart();
}

export function OnboardingChat({ userId, firstName }: { userId: string; firstName?: string }) {
  const router = useRouter();
  const [slug] = useState(makeSlug);
  const greeting = useMemo(
    () =>
      `Hey${firstName ? ` ${firstName}` : ""} — I'm Richard. Give me the property address and a few roof photos (or the carrier's estimate) and I'll build your first report in minutes. What's the address?`,
    [firstName]
  );
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: greeting }]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [created, setCreated] = useState<{ claimSlug: string; label: string } | null>(null);

  const chatRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const scopeInputRef = useRef<HTMLInputElement>(null);
  const measInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const heroMode = messages.length <= 1 && files.length === 0 && !created;

  useEffect(() => {
    if (!heroMode && chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, files, heroMode]);

  const counts = useMemo(() => {
    const done = files.filter((f) => f.status === "done");
    return {
      photos: done.filter((f) => f.folder === "photos").length,
      scope: done.filter((f) => f.folder === "scope").length,
      measurements: done.filter((f) => f.folder === "measurements").length,
    };
  }, [files]);

  const uploadFiles = useCallback(
    async (list: File[], folder: Folder) => {
      for (const file of list) {
        const key = `${folder}-${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`;
        const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
        setFiles((prev) => [...prev, { key, name: file.name, folder, status: "uploading", previewUrl }]);
        try {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("folder", folder);
          fd.append("slug", slug);
          const res = await fetch("/api/onboarding/upload", { method: "POST", body: fd });
          setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, status: res.ok ? "done" : "error" } : f)));
        } catch {
          setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, status: "error" } : f)));
        }
      }
    },
    [slug]
  );

  const onPick = (folder: Folder) => (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    if (list.length) uploadFiles(list, folder);
    e.target.value = "";
    setAttachOpen(false);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files || []);
    const images = dropped.filter((f) => f.type.startsWith("image/"));
    const pdfs = dropped.filter((f) => !f.type.startsWith("image/"));
    if (images.length) uploadFiles(images, "photos");
    if (pdfs.length) uploadFiles(pdfs, "scope");
  };

  const sendMessage = useCallback(
    async (messageText?: string) => {
      const msg = (messageText ?? input).trim();
      if (!msg || isStreaming) return;
      setInput("");
      setIsStreaming(true);
      const base: Msg[] = [...messages, { role: "user", content: msg }];
      setMessages(base);
      const assistantIndex = base.length;
      setMessages([...base, { role: "assistant", content: "" }]);
      try {
        const authHeaders = await getRichardAuthHeaders();
        const res = await fetch(`${BACKEND_URL}/api/admin-brain/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ message: msg, user_id: userId, scope: "onboarding", slug, uploaded_files: counts }),
        });
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No reader");
        const decoder = new TextDecoder();
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of decoder.decode(value, { stream: true }).split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                fullText += data.text;
                setMessages((prev) => {
                  const u = [...prev];
                  u[assistantIndex] = { role: "assistant", content: cleanText(fullText) };
                  return u;
                });
              }
              if (data.tool_action) {
                const ta = data.tool_action as { action?: string; data?: Record<string, unknown> };
                if (ta.action === "complete" && ta.data?.claim_id) {
                  const claimSlug = String(ta.data.slug || slug);
                  setCreated({
                    claimSlug,
                    label: REPORT_LABELS[String(ta.data.report_mode || "")] || "claim package",
                  });
                  // Activation event: the user just created their first claim via
                  // Richard onboarding. Fire StartTrial (browser pixel + CAPI mirror,
                  // deduped by event_id) so Meta can optimize the live StartTrial ad
                  // set on real activations. Fire-and-forget — never blocks the UI.
                  const capiEventId = `claim_${claimSlug}_starttrial`;
                  window.fbq?.("track", "StartTrial", { value: 499, currency: "USD" }, { eventID: capiEventId });
                  fetch("/api/capi-event", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      eventName: "StartTrial",
                      eventId: capiEventId,
                      eventSourceUrl: window.location.href,
                      customData: { value: 499, currency: "USD", content_name: "Claim Package", content_category: "onboarding" },
                    }),
                  }).catch(() => {});
                }
              }
              if (data.error) {
                fullText += `\n\n_(connection hiccup: ${data.error})_`;
                setMessages((prev) => {
                  const u = [...prev];
                  u[assistantIndex] = { role: "assistant", content: cleanText(fullText) };
                  return u;
                });
              }
            } catch { /* partial frame */ }
          }
        }
      } catch (err) {
        setMessages((prev) => {
          const u = [...prev];
          u[assistantIndex] = { role: "assistant", content: `I hit a connection snag — give that another tap? (${err instanceof Error ? err.message : "unknown"})` };
          return u;
        });
      }
      setIsStreaming(false);
      inputRef.current?.focus();
    },
    [BACKEND_URL, userId, input, isStreaming, messages, slug, counts]
  );

  const ambient = (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 -top-32 h-72"
      style={{ background: "radial-gradient(55% 100% at 50% 0%, rgba(139,92,246,0.16), rgba(236,72,153,0.05) 45%, transparent 72%)" }}
    />
  );

  const hiddenInputs = (
    <>
      <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onPick("photos")} />
      <input ref={scopeInputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={onPick("scope")} />
      <input ref={measInputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={onPick("measurements")} />
    </>
  );

  // ── Success hand-off ───────────────────────────────────────────────
  if (created) {
    return (
      <div className="relative min-h-[100dvh] flex items-center justify-center px-6 bg-[#08080c] text-white overflow-hidden">
        {ambient}
        <div className="relative max-w-sm w-full text-center">
          <div className="relative mx-auto w-16 h-16 mb-6">
            <div aria-hidden className="absolute inset-0 blur-2xl opacity-70" style={{ background: "radial-gradient(circle, rgba(139,92,246,0.55), transparent 70%)" }} />
            <div className="relative w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center backdrop-blur-xl">
              <RichardIcon size={36} />
            </div>
          </div>
          <h1 className="text-[22px] font-medium tracking-tight text-white/95 mb-2.5">Your {created.label} is building.</h1>
          <p className="text-[14px] leading-relaxed text-white/45 mb-7">
            Richard is analyzing everything you sent — about a minute. Watch it come together, and add your logo to brand
            the report whenever you like.
          </p>
          <button
            onClick={() => router.push(`/dashboard/claim/${created.claimSlug}`)}
            className="w-full bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-white text-[15px] font-medium py-3 rounded-xl transition-colors shadow-[0_8px_30px_-8px_rgba(139,92,246,0.6)]"
          >
            Watch Richard build it
          </button>
          <button onClick={() => router.push("/dashboard")} className="mt-3.5 text-white/35 hover:text-white/60 text-[13px] transition-colors">
            Go to my dashboard
          </button>
        </div>
      </div>
    );
  }

  // ── Composer (single instance, rendered in the dock) ───────────────
  const composer = (
    <div className="relative w-full max-w-xl mx-auto">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2.5 px-0.5">
          {files.map((f) => (
            <div key={f.key} className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] pl-1 pr-2.5 py-1" title={f.name}>
              {f.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.previewUrl} alt="" className="w-6 h-6 rounded object-cover" />
              ) : (
                <span className="w-6 h-6 rounded bg-violet-500/15 flex items-center justify-center text-[11px]">{f.folder === "scope" ? "📄" : "📐"}</span>
              )}
              <span className="text-[11px] text-white/55 max-w-[110px] truncate">{f.name}</span>
              {f.status === "uploading" ? (
                <span className="w-2.5 h-2.5 rounded-full border border-white/20 border-t-violet-400 animate-spin" />
              ) : f.status === "done" ? (
                <span className="text-violet-400 text-[11px]">✓</span>
              ) : (
                <span className="text-rose-400 text-[11px]">!</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="relative flex items-end gap-1.5 rounded-2xl border border-white/[0.09] bg-white/[0.035] backdrop-blur-xl px-2 py-2 transition-colors focus-within:border-violet-400/40 focus-within:bg-white/[0.05]">
        {/* Attach */}
        <div className="relative">
          {attachOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setAttachOpen(false)} />
              <div className="absolute bottom-12 left-0 z-20 w-52 rounded-xl border border-white/[0.1] bg-[#111016]/95 backdrop-blur-xl p-1 shadow-2xl">
                {[
                  { icon: "📷", label: "Roof photos", hint: "→ forensic report", ref: photoInputRef },
                  { icon: "📄", label: "Carrier's estimate", hint: "→ instant supplement", ref: scopeInputRef },
                  { icon: "📐", label: "Measurement report", hint: "EagleView / HOVER", ref: measInputRef },
                ].map((o) => (
                  <button
                    key={o.label}
                    onClick={() => { o.ref.current?.click(); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/[0.06] transition-colors text-left"
                  >
                    <span className="text-base">{o.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-[13px] text-white/85 leading-tight">{o.label}</span>
                      <span className="block text-[11px] text-white/35 leading-tight">{o.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <button
            onClick={() => setAttachOpen((v) => !v)}
            aria-label="Attach photos or documents"
            className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg transition-colors ${attachOpen ? "bg-white/[0.08] text-white" : "text-white/45 hover:text-white/80 hover:bg-white/[0.05]"}`}
          >
            +
          </button>
        </div>

        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder="Property address…"
          rows={1}
          className="flex-1 bg-transparent py-1.5 text-[15px] text-white placeholder-white/30 outline-none resize-none max-h-32"
        />

        <button
          onClick={() => sendMessage()}
          disabled={isStreaming || !input.trim()}
          aria-label="Send"
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all bg-gradient-to-b from-violet-500 to-violet-600 text-white disabled:from-white/10 disabled:to-white/10 disabled:text-white/30 enabled:shadow-[0_6px_20px_-6px_rgba(139,92,246,0.7)]"
        >
          ↑
        </button>
      </div>
    </div>
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={onDrop}
      className="relative min-h-[100dvh] flex flex-col bg-[#08080c] text-white overflow-hidden"
    >
      {ambient}
      {dragOver && (
        <div className="absolute inset-0 z-30 m-3 rounded-3xl border-2 border-dashed border-violet-400/50 bg-violet-500/5 backdrop-blur-sm flex items-center justify-center">
          <span className="text-white/80 text-sm font-medium">Drop your photos to upload</span>
        </div>
      )}

      {heroMode ? (
        // ── HERO ────────────────────────────────────────────────────
        <main className="relative flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="relative w-14 h-14 mb-7">
            <div aria-hidden className="absolute -inset-4 blur-2xl opacity-70" style={{ background: "radial-gradient(circle, rgba(139,92,246,0.5), rgba(236,72,153,0.22) 55%, transparent 72%)" }} />
            <div className="relative w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center backdrop-blur-xl">
              <RichardIcon size={30} />
            </div>
          </div>
          <h1 className="text-[27px] sm:text-[32px] font-medium tracking-tight text-white/95 leading-[1.15]">
            Let&rsquo;s build your<br />first claim.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/45 max-w-[20rem]">
            {firstName ? `${firstName}, t` : "T"}ell me the property address and drop your roof photos — Richard has your
            report in minutes.
          </p>

          <div className="w-full mt-9">{composer}</div>

          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 mt-6">
            {STARTERS.map((s) => (
              <button
                key={s.label}
                onClick={() => sendMessage(s.prompt)}
                className="text-[12.5px] text-white/35 hover:text-violet-300 transition-colors"
              >
                {s.label}
              </button>
            ))}
          </div>
        </main>
      ) : (
        // ── CONVERSATION ────────────────────────────────────────────
        <>
          <header className="relative px-4 h-14 flex items-center gap-2.5 border-b border-white/[0.06] backdrop-blur-xl sticky top-0 z-10">
            <RichardIcon size={24} />
            <div>
              <div className="text-white/90 text-[13px] font-medium leading-tight">Richard</div>
              <div className="text-white/35 text-[11px] leading-tight">building your first claim</div>
            </div>
          </header>

          <div ref={chatRef} className="relative flex-1 overflow-y-auto px-4 py-6">
            <div className="max-w-2xl mx-auto space-y-6">
              {messages.map((m, i) =>
                m.role === "assistant" ? (
                  <div key={i} className="flex gap-3">
                    <div className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <RichardIcon size={18} />
                    </div>
                    <div className="min-w-0 flex-1 text-[15px] leading-relaxed text-white/85 pt-0.5">
                      {m.content ? (
                        <MarkdownContent content={m.content} />
                      ) : (
                        <span className="inline-flex gap-1 py-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-violet-400/70 animate-bounce [animation-delay:-0.3s]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-violet-400/70 animate-bounce [animation-delay:-0.15s]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-violet-400/70 animate-bounce" />
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-br-md bg-white/[0.07] border border-white/[0.06] px-3.5 py-2 text-[15px] text-white/90">
                      {m.content}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>

          <div className="relative px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{composer}</div>
        </>
      )}

      {hiddenInputs}
    </div>
  );
}
