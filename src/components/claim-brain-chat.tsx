"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ClaimBrainChatProps {
  claimId: string;
  claimAddress?: string;
  carrier?: string;
  variance?: number;
}

// Minimal markdown → HTML (no dependencies)
function renderMarkdown(text: string): string {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-bold text-blue-400 mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-sm font-bold text-blue-300 mt-3 mb-1">$1</h2>')
    // Bold & italic
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Code
    .replace(/`(.+?)`/g, '<code class="bg-white/10 px-1 rounded text-xs">$1</code>')
    // Tables
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.split("|").filter((c) => c.trim());
      if (cells.every((c) => /^[\s\-:]+$/.test(c))) return "<!--sep-->";
      return (
        "<tr>" +
        cells
          .map(
            (c) =>
              `<td class="border border-white/10 px-2 py-1 text-xs">${c.trim()}</td>`
          )
          .join("") +
        "</tr>"
      );
    })
    // Bullet lists
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-sm">$1</li>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(
    /((?:<li[^>]*>.*<\/li>\n?)+)/g,
    '<ul class="list-disc space-y-0.5 my-1">$1</ul>'
  );
  // Wrap <tr> in <table>
  html = html.replace(
    /((?:<tr>.*<\/tr>\n?)+)/g,
    '<table class="w-full border-collapse my-2">$1</table>'
  );
  html = html.replace(/<!--sep-->\n?/g, "");
  // Paragraphs
  html = html.replace(/\n\n/g, "</p><p class=\"text-sm my-1\">");
  html = html.replace(/\n/g, "<br>");
  return '<p class="text-sm my-1">' + html + "</p>";
}

const QUICK_ACTIONS = [
  { label: "Claim status", prompt: "Where does this claim stand?" },
  { label: "Carrier gaps", prompt: "What did the carrier miss?" },
  { label: "Best argument", prompt: "What's our strongest supplement argument?" },
  { label: "Photo gaps", prompt: "What photos am I missing?" },
  { label: "Draft email", prompt: "Draft a supplement response to the adjuster" },
  { label: "Line items", prompt: "Break down the financials line by line" },
];

export function ClaimBrainChat({
  claimId,
  claimAddress,
  carrier,
  variance,
}: ClaimBrainChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const BACKEND_URL =
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

  const scrollToBottom = useCallback(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = async (messageText?: string) => {
    const msg = messageText || input.trim();
    if (!msg || isStreaming) return;

    setInput("");
    setIsStreaming(true);

    // Add user message
    const newMessages: Message[] = [...messages, { role: "user", content: msg }];
    setMessages(newMessages);

    // Add placeholder for assistant
    const assistantIndex = newMessages.length;
    setMessages([...newMessages, { role: "assistant", content: "" }]);

    try {
      const res = await fetch(
        `${BACKEND_URL}/api/claim-brain/${claimId}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: msg }),
        }
      );

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                fullText += data.text;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[assistantIndex] = {
                    role: "assistant",
                    content: fullText,
                  };
                  return updated;
                });
              }
              if (data.error) {
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[assistantIndex] = {
                    role: "assistant",
                    content: `Error: ${data.error}`,
                  };
                  return updated;
                });
              }
            } catch {
              // ignore parse errors on partial chunks
            }
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIndex] = {
          role: "assistant",
          content: `Connection error: ${err instanceof Error ? err.message : "Unknown"}`,
        };
        return updated;
      });
    }

    setIsStreaming(false);
    inputRef.current?.focus();
  };

  const resetChat = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/claim-brain/${claimId}/reset`, {
        method: "POST",
      });
    } catch {
      // ignore
    }
    setMessages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Floating button when closed
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 bg-[#0f1729] hover:bg-[#1a2540] text-white w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 border border-white/10"
        title="Open Claim Brain"
      >
        <span className="text-2xl">🧠</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[440px] h-[600px] bg-[#0f1729] rounded-2xl shadow-2xl border border-white/10 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-[#0a0f1e]">
        <div className="flex items-center gap-2">
          <span className="text-lg">🧠</span>
          <div>
            <div className="text-white text-sm font-semibold">Claim Brain</div>
            <div className="text-white/40 text-[10px]">
              {claimAddress || "Claim"} · {carrier}
              {variance && variance > 0 ? (
                <span className="text-emerald-400 ml-1">
                  +${variance.toLocaleString()}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={resetChat}
            className="text-white/30 hover:text-white/60 text-xs px-2 py-1 rounded transition-colors"
            title="Reset conversation"
          >
            Reset
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="text-white/30 hover:text-white/60 w-7 h-7 flex items-center justify-center rounded transition-colors text-lg"
          >
            ×
          </button>
        </div>
      </div>

      {/* Chat messages */}
      <div ref={chatAreaRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-3xl mb-3">🧠</div>
            <div className="text-white text-sm font-medium mb-1">
              Claim Brain — Ready
            </div>
            <div className="text-white/40 text-xs max-w-[280px] mx-auto">
              I know every document, line item, and dollar on this claim. Ask me
              anything.
            </div>
            <div className="flex flex-wrap gap-1.5 justify-center mt-4">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  onClick={() => sendMessage(action.prompt)}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 text-white/50 hover:text-blue-400 hover:border-blue-400/30 transition-colors"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs flex-shrink-0 ${
                  msg.role === "assistant"
                    ? "bg-blue-500/10 border border-blue-500/20"
                    : "bg-emerald-500/10 border border-emerald-500/20"
                }`}
              >
                {msg.role === "assistant" ? "🧠" : "T"}
              </div>
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white text-sm"
                    : "bg-white/5 border border-white/10 text-white/80"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(msg.content),
                    }}
                    className={
                      isStreaming && i === messages.length - 1
                        ? "streaming-cursor"
                        : ""
                    }
                  />
                ) : (
                  <span className="text-sm">{msg.content}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-white/10 bg-[#0a0f1e]">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this claim..."
            rows={1}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm placeholder-white/30 outline-none focus:border-blue-500/50 resize-none"
          />
          <button
            onClick={() => sendMessage()}
            disabled={isStreaming || !input.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white w-9 h-9 rounded-xl flex items-center justify-center transition-colors text-sm"
          >
            →
          </button>
        </div>
      </div>

      {/* Streaming cursor animation */}
      <style jsx global>{`
        .streaming-cursor > p:last-child::after,
        .streaming-cursor > ul:last-child > li:last-child::after {
          content: "▊";
          animation: blink 0.7s infinite;
          color: #4f8eff;
        }
        @keyframes blink {
          0%,
          50% {
            opacity: 1;
          }
          51%,
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
