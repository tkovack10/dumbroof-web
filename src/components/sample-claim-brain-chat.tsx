"use client";

import { useState, useRef, useEffect } from "react";
import { SAMPLE_RICHARD_SUGGESTIONS } from "@/lib/sample-claim-data";

/**
 * Simplified streaming chat component for the /sample/dashboard demo.
 *
 * Talks to /api/sample/brain/chat, which pipes Claude Sonnet 4.6 output
 * through as an SSE stream of {delta, done, error} events. Unlike the
 * production ClaimBrainChat component (400+ lines with tool actions,
 * approvals, PDF generation, email sending), this one is read-only —
 * just a back-and-forth text chat. That matches what the demo should be.
 */

type Message = { role: "user" | "assistant"; content: string };

export function SampleClaimBrainChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  async function send(userText: string) {
    const text = userText.trim();
    if (!text || streaming) return;
    setError(null);

    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setStreaming(true);

    // Seed a blank assistant message we'll stream into
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/sample/brain/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setError(body.error || `Error ${res.status}`);
        setMessages((m) => m.slice(0, -1)); // drop the empty assistant msg
        setStreaming(false);
        return;
      }

      if (!res.body) {
        setError("No response stream");
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assembled = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const event of events) {
          const line = event.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const payload = line.slice(6);
          try {
            const data = JSON.parse(payload);
            if (typeof data.delta === "string") {
              assembled += data.delta;
              setMessages((m) => {
                const copy = [...m];
                copy[copy.length - 1] = { role: "assistant", content: assembled };
                return copy;
              });
            }
            if (data.error) {
              setError(data.error);
            }
          } catch {
            // ignore malformed
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat failed");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Chat log */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-4 px-4 py-5 min-h-[300px] max-h-[480px]"
      >
        {messages.length === 0 && (
          <div className="text-center py-4">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-br from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] mb-3">
              <span className="text-xl">🧠</span>
            </div>
            <p className="text-sm font-semibold text-white mb-1">Ask Richard about this claim</p>
            <p className="text-xs text-[var(--gray-muted)] mb-4">
              Streaming Claude Sonnet 4.6 · 5 questions per hour
            </p>
            <div className="space-y-2 max-w-sm mx-auto">
              {SAMPLE_RICHARD_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="block w-full text-left text-xs text-[var(--gray-dim)] hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg px-3 py-2 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                m.role === "user"
                  ? "bg-gradient-to-br from-[var(--pink)] to-[var(--purple)] text-white"
                  : "bg-white/[0.06] border border-white/[0.1] text-[var(--gray-dim)]"
              }`}
            >
              {m.role === "assistant" && !m.content && streaming ? (
                <span className="inline-block w-2 h-4 bg-[var(--cyan)] animate-pulse rounded" />
              ) : (
                <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
              )}
            </div>
          </div>
        ))}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-white/[0.08] p-3 flex gap-2 bg-[rgba(6,9,24,0.4)]"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Richard anything about this claim..."
          disabled={streaming}
          className="flex-1 bg-white/[0.05] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="bg-gradient-to-r from-[var(--pink)] to-[var(--blue)] text-white px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
        >
          {streaming ? "..." : "Send"}
        </button>
      </form>
    </div>
  );
}
