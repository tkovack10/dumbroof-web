"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n";

interface Message {
  role: "user" | "assistant";
  content: string;
  toolActions?: ToolAction[];
}

interface ToolAction {
  action: "preview" | "complete" | "error";
  type: string;
  tool_name: string;
  approval_id?: string;
  message: string;
  draft?: {
    to: string;
    cc?: string;
    subject: string;
    body_html: string;
    attachments?: { path: string; filename: string }[];
  };
  pdf_path?: string;
  sign_link?: string;
  data?: Record<string, unknown>;
}

interface ClaimBrainChatProps {
  claimId: string;
  claimAddress?: string;
  carrier?: string;
  variance?: number;
  userId?: string;
}

// Minimal markdown → HTML (no dependencies)
function renderMarkdown(text: string): string {
  if (!text) return "";
  // Headers BEFORE HTML escaping so # markup is preserved
  let html = text
    .replace(/^### (.+)$/gm, '<!--h3-->$1<!--/h3-->')
    .replace(/^## (.+)$/gm, '<!--h2-->$1<!--/h2-->')
    // Then escape HTML entities
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Restore headers
    .replace(/&lt;!--h3--&gt;(.+?)&lt;!--\/h3--&gt;/g, '<h3 class="text-sm font-bold text-blue-400 mt-3 mb-1">$1</h3>')
    .replace(/&lt;!--h2--&gt;(.+?)&lt;!--\/h2--&gt;/g, '<h2 class="text-sm font-bold text-blue-300 mt-3 mb-1">$1</h2>')
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

const TOOL_ICONS: Record<string, string> = {
  send_supplement_email: "📧",
  generate_invoice: "🧾",
  generate_coc: "📋",
  send_aob_to_carrier: "📜",
  send_aob_for_signature: "✍️",
  send_custom_email: "✉️",
  check_claim_status: "📊",
  check_carrier_emails: "📨",
};

const TOOL_LABELS: Record<string, string> = {
  send_supplement_email: "Supplement Email",
  generate_invoice: "Invoice",
  generate_coc: "Certificate of Completion",
  send_aob_to_carrier: "AOB to Carrier",
  send_aob_for_signature: "AOB for Signature",
  send_custom_email: "Email",
  check_claim_status: "Status Check",
  check_carrier_emails: "Carrier Emails",
};

const QUICK_ACTIONS = [
  { label: "Claim status", prompt: "Where does this claim stand?" },
  { label: "Carrier gaps", prompt: "What did the carrier miss?" },
  { label: "Best argument", prompt: "What's our strongest supplement argument?" },
  { label: "Photo gaps", prompt: "What photos am I missing?" },
  { label: "Draft email", prompt: "Draft a supplement response to the adjuster" },
  { label: "Line items", prompt: "Break down the financials line by line" },
  { label: "Carrier emails", prompt: "Check if the carrier has responded to any emails on this claim" },
];

function ToolActionCard({
  action,
  claimId,
  backendUrl,
  onStatusUpdate,
}: {
  action: ToolAction;
  claimId: string;
  backendUrl: string;
  onStatusUpdate: (id: string, status: string) => void;
}) {
  const [status, setStatus] = useState<"pending" | "approving" | "sent" | "discarded" | "error">("pending");
  const [expanded, setExpanded] = useState(false);

  const icon = TOOL_ICONS[action.tool_name] || "🔧";
  const label = TOOL_LABELS[action.tool_name] || action.tool_name;

  const handleApprove = async () => {
    if (!action.approval_id) return;
    setStatus("approving");
    try {
      const res = await fetch(`${backendUrl}/api/claim-brain/${claimId}/approve-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool_call_id: action.approval_id, approved: true }),
      });
      const data = await res.json();
      if (data.status === "sent") {
        setStatus("sent");
        onStatusUpdate(action.approval_id, "sent");
      } else if (data.status === "error") {
        setStatus("error");
      } else {
        setStatus("sent");
      }
    } catch {
      setStatus("error");
    }
  };

  const handleDiscard = async () => {
    if (!action.approval_id) return;
    try {
      await fetch(`${backendUrl}/api/claim-brain/${claimId}/approve-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool_call_id: action.approval_id, approved: false }),
      });
    } catch {
      // ignore
    }
    setStatus("discarded");
    onStatusUpdate(action.approval_id, "discarded");
  };

  // Status check (no approval needed) — show data inline
  if (action.action === "complete" && action.type === "status" && action.data) {
    return (
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3 my-2">
        <div className="flex items-center gap-1.5 text-xs text-blue-400 font-medium mb-2">
          {icon} {label}
        </div>
        <div className="grid grid-cols-2 gap-1 text-[11px]">
          {Object.entries(action.data).map(([key, val]) => (
            <div key={key} className="flex justify-between">
              <span className="text-white/40">{key.replace(/_/g, " ")}:</span>
              <span className="text-white/70">
                {typeof val === "number" && key.includes("rcv")
                  ? `$${val.toLocaleString()}`
                  : String(val ?? "—")}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // PDF generated (no email) — complete action
  if (action.action === "complete" && action.pdf_path) {
    return (
      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 my-2">
        <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
          {icon} {label} Generated
        </div>
        <div className="text-[11px] text-white/50 mt-1">{action.message}</div>
      </div>
    );
  }

  // Preview card (needs approval)
  return (
    <div className={`border rounded-lg p-3 my-2 ${
      status === "sent" ? "bg-emerald-500/5 border-emerald-500/20" :
      status === "discarded" ? "bg-white/5 border-white/10 opacity-50" :
      status === "error" ? "bg-red-500/5 border-red-500/20" :
      "bg-amber-500/5 border-amber-500/20"
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium" style={{
          color: status === "sent" ? "#34d399" : status === "error" ? "#f87171" : "#fbbf24"
        }}>
          {icon} {label}
          {status === "sent" && " — Sent"}
          {status === "discarded" && " — Discarded"}
          {status === "error" && " — Failed"}
          {status === "approving" && " — Sending..."}
        </div>
        {action.draft && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-white/30 hover:text-white/60"
          >
            {expanded ? "Hide" : "Preview"}
          </button>
        )}
      </div>

      {/* Summary */}
      {action.draft && (
        <div className="mt-1.5 text-[11px] text-white/50">
          <span className="text-white/30">To:</span> {action.draft.to}
          {action.draft.cc && <> · <span className="text-white/30">CC:</span> {action.draft.cc}</>}
          <br />
          <span className="text-white/30">Subject:</span> {action.draft.subject}
          {action.draft.attachments && action.draft.attachments.length > 0 && (
            <div className="mt-0.5">
              <span className="text-white/30">Attachments:</span>{" "}
              {action.draft.attachments.map((a) => a.filename).join(", ")}
            </div>
          )}
        </div>
      )}

      {/* Expanded preview */}
      {expanded && action.draft && (
        <div className="mt-2 p-2 bg-white/5 rounded text-[11px] text-white/60 max-h-40 overflow-y-auto"
          dangerouslySetInnerHTML={{ __html: action.draft.body_html }}
        />
      )}

      {/* Sign link */}
      {action.sign_link && (
        <div className="mt-1.5 text-[11px]">
          <span className="text-white/30">Sign link:</span>{" "}
          <span className="text-blue-400">{action.sign_link}</span>
        </div>
      )}

      {/* Action buttons */}
      {status === "pending" && action.action === "preview" && (
        <div className="flex gap-2 mt-2.5">
          <button
            onClick={handleApprove}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium py-1.5 rounded-lg transition-colors"
          >
            Approve & Send
          </button>
          <button
            onClick={handleDiscard}
            className="px-3 bg-white/5 hover:bg-white/10 text-white/50 text-[11px] py-1.5 rounded-lg transition-colors"
          >
            Discard
          </button>
        </div>
      )}

      {status === "approving" && (
        <div className="mt-2 text-[11px] text-amber-400 animate-pulse">Sending...</div>
      )}
    </div>
  );
}

export function ClaimBrainChat({
  claimId,
  claimAddress,
  carrier,
  variance,
  userId,
}: ClaimBrainChatProps) {
  const { locale } = useI18n();
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

  useEffect(() => {
    let cancelled = false;
    const loadHistory = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/claim-brain/${claimId}/history`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { messages?: Array<{ role: string; content: string }> };
        if (cancelled || !data.messages?.length) return;
        const restored: Message[] = data.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));
        setMessages(restored);
      } catch {
        // Silent — fresh conversation is fine
      }
    };
    loadHistory();
    return () => { cancelled = true; };
  }, [claimId, BACKEND_URL]);

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
    setMessages([...newMessages, { role: "assistant", content: "", toolActions: [] }]);

    try {
      const res = await fetch(
        `${BACKEND_URL}/api/claim-brain/${claimId}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: msg, user_id: userId || null, locale: locale }),
        }
      );

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let fullText = "";
      const toolActions: ToolAction[] = [];

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
                    toolActions: [...toolActions],
                  };
                  return updated;
                });
              }
              if (data.tool_action) {
                toolActions.push(data.tool_action as ToolAction);
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[assistantIndex] = {
                    role: "assistant",
                    content: fullText,
                    toolActions: [...toolActions],
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
                    toolActions: [],
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
          toolActions: [],
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

  const handleToolStatusUpdate = (approvalId: string, status: string) => {
    // Could log or update UI state if needed
    console.log(`Tool action ${approvalId}: ${status}`);
  };

  // Floating button when closed — with first-time tooltip
  if (!isOpen) {
    return (
      <div className="fixed bottom-6 right-6 z-50 group">
        <div className="absolute bottom-full right-0 mb-2 w-52 bg-[rgb(15,18,35)] border border-[var(--border-glass)] rounded-xl px-3 py-2 text-xs text-[var(--gray)] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl">
          AI assistant that knows everything about this claim. Ask it anything.
        </div>
        <button
          onClick={() => setIsOpen(true)}
          className="bg-[#0f1729] hover:bg-[#1a2540] text-white w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 border border-white/10"
          title="Open Claim Brain"
        >
          <span className="text-2xl">🧠</span>
        </button>
      </div>
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
              anything — or tell me to take action.
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
                  <>
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
                    {/* Tool action cards */}
                    {msg.toolActions && msg.toolActions.map((action, j) => (
                      <ToolActionCard
                        key={`${action.approval_id || j}`}
                        action={action}
                        claimId={claimId}
                        backendUrl={BACKEND_URL}
                        onStatusUpdate={handleToolStatusUpdate}
                      />
                    ))}
                  </>
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
