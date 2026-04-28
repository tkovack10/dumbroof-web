"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { getRichardAuthHeaders } from "@/lib/richard-auth";
import { RichardIcon } from "@/components/richard-icon";
import { MarkdownContent } from "@/components/markdown-content";

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
  preview?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

type AdminBrainScope = "user" | "company";

interface AdminBrainChatProps {
  userId: string;
  scope?: AdminBrainScope;
}

const QUICK_SETUP_ACTIONS = [
  { label: "What's connected?", prompt: "What's my current setup status?" },
  { label: "Connect Gmail", prompt: "Help me connect Gmail" },
  { label: "Connect Outlook", prompt: "Help me connect Microsoft 365 / Outlook" },
  { label: "Connect CompanyCam", prompt: "Help me connect CompanyCam" },
  { label: "Connect Hover", prompt: "Help me connect Hover" },
  { label: "Connect AccuLynx", prompt: "Help me connect AccuLynx" },
  { label: "Invite teammate", prompt: "I want to invite a new team member" },
  { label: "What's left?", prompt: "What's left on my onboarding checklist?" },
];

const QUICK_COMPANY_ACTIONS = [
  { label: "Portfolio summary", prompt: "Give me a portfolio summary across all our claims." },
  { label: "Open claims by carrier", prompt: "Break down open claims by carrier." },
  { label: "Team performance", prompt: "Compare team performance — who is winning supplements and who is stalling?" },
  { label: "Overdue follow-ups", prompt: "Which claims need a follow-up this week?" },
  { label: "Top variance", prompt: "Top 5 claims by variance — where is the biggest unrecovered money?" },
  { label: "Onboarding status", prompt: "How is the team's onboarding looking — who hasn't connected their tools?" },
];

function IntegrationsStatusCard({ data }: { data: Record<string, unknown> }) {
  const integrations = (data.integrations || {}) as Record<string, { connected: boolean; status?: string }>;
  const count = data.connected_count as number;
  const total = data.total_count as number;
  const profileComplete = data.profile_complete as boolean;
  return (
    <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg p-3 my-2">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-indigo-300 font-medium">🔌 Integration Status — {count}/{total} connected</div>
        <div className={`text-[10px] ${profileComplete ? "text-emerald-300" : "text-amber-300"}`}>
          {profileComplete ? "Profile ✓" : "Profile incomplete"}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1 text-[11px]">
        {Object.entries(integrations).map(([name, info]) => (
          <div key={name} className="flex items-center gap-1">
            <span className={info.connected ? "text-emerald-400" : info.status === "coming_soon" ? "text-amber-400" : "text-white/30"}>
              {info.connected ? "●" : info.status === "coming_soon" ? "◐" : "○"}
            </span>
            <span className="text-white/70 capitalize">{name.replace(/_/g, " ")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SetupGuideCard({ data }: { data: Record<string, unknown> }) {
  const displayName = data.display_name as string;
  const category = data.category as string;
  const authType = data.auth_type as string;
  const unlocks = (data.unlocks || []) as string[];
  const steps = (data.steps || []) as string[];
  const gotchas = (data.gotchas || []) as string[];
  return (
    <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg p-3 my-2">
      <div className="text-xs text-indigo-300 font-medium mb-1">
        📘 {displayName} Setup<span className="text-white/40 ml-2">· {category} · {authType}</span>
      </div>
      {unlocks.length > 0 && (
        <div className="mt-2 p-2 rounded bg-emerald-500/10 border border-emerald-500/20">
          <div className="text-[10px] text-emerald-300 font-semibold uppercase tracking-wide mb-1">Unlocks</div>
          {unlocks.map((u, i) => <div key={i} className="text-[11px] text-white/70">✓ {u}</div>)}
        </div>
      )}
      {steps.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] text-white/40 font-semibold uppercase tracking-wide mb-1">Steps</div>
          <ol className="space-y-1">
            {steps.map((s, i) => (
              <li key={i} className="text-[11px] text-white/70 leading-snug">
                <span className="text-indigo-300 font-semibold">{i + 1}.</span> {s}
              </li>
            ))}
          </ol>
        </div>
      )}
      {gotchas.length > 0 && (
        <div className="mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/20">
          <div className="text-[10px] text-amber-300 font-semibold uppercase tracking-wide mb-1">Gotchas</div>
          {gotchas.map((g, i) => <div key={i} className="text-[11px] text-white/70">⚠ {g}</div>)}
        </div>
      )}
    </div>
  );
}

function OAuthRedirectCard({ data }: { data: Record<string, unknown> }) {
  const service = String(data.service || "");
  const url = data.authorize_url ? String(data.authorize_url) : null;
  const configured = Boolean(data.configured);
  const missingEnv = data.missing_env_var ? String(data.missing_env_var) : null;
  const label = service.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg p-3 my-2">
      <div className="text-xs text-indigo-300 font-medium mb-1.5">🔗 Connect {label}</div>
      {configured && url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          Authorize {label} →
        </a>
      ) : (
        <div className="text-[11px] text-amber-300">
          OAuth not configured yet. Backend env var <code className="bg-white/10 px-1 rounded">{missingEnv ?? "?"}</code> must be set first.
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  action,
  userId,
  backendUrl,
  onStatusUpdate,
}: {
  action: ToolAction;
  userId: string;
  backendUrl: string;
  onStatusUpdate: (id: string, status: string) => void;
}) {
  const [status, setStatus] = useState<"pending" | "approving" | "sent" | "discarded" | "error">("pending");
  const p = (action.preview || {}) as Record<string, unknown>;

  const handleApprove = async () => {
    if (!action.approval_id) return;
    setStatus("approving");
    try {
      const authHeaders = await getRichardAuthHeaders();
      const res = await fetch(`${backendUrl}/api/admin-brain/approve-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ tool_call_id: action.approval_id, approved: true, user_id: userId }),
      });
      const data = await res.json();
      if (data.status === "sent" || data.status === "complete") {
        setStatus("sent");
        onStatusUpdate(action.approval_id, "sent");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  };

  const handleDiscard = async () => {
    if (!action.approval_id) return;
    try {
      const authHeaders = await getRichardAuthHeaders();
      await fetch(`${backendUrl}/api/admin-brain/approve-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ tool_call_id: action.approval_id, approved: false, user_id: userId }),
      });
    } catch { /* ignore */ }
    setStatus("discarded");
    onStatusUpdate(action.approval_id, "discarded");
  };

  const statusColor =
    status === "sent" ? "bg-emerald-500/5 border-emerald-500/20" :
    status === "discarded" ? "bg-white/5 border-white/10 opacity-50" :
    status === "error" ? "bg-red-500/5 border-red-500/20" :
    "bg-amber-500/5 border-amber-500/20";

  return (
    <div className={`border rounded-lg p-3 my-2 ${statusColor}`}>
      <div className="text-xs font-medium mb-2" style={{
        color: status === "sent" ? "#34d399" : status === "error" ? "#f87171" : "#fbbf24",
      }}>
        {String(p.action_label || action.tool_name)}
        {status === "sent" && " — Done"}
        {status === "discarded" && " — Cancelled"}
        {status === "error" && " — Failed"}
        {status === "approving" && " — Working..."}
      </div>
      <div className="text-[11px] text-white/70 space-y-0.5">
        {action.tool_name === "save_integration_key" && (
          <>
            <div><span className="text-white/40">Service:</span> <span className="text-white">{String(p.display_name || p.service || "")}</span></div>
            <div><span className="text-white/40">API key:</span> <code className="text-white/80">{String(p.api_key_masked || "")}</code></div>
          </>
        )}
        {action.tool_name === "invite_team_member" && (
          <>
            <div><span className="text-white/40">Email:</span> <span className="text-white">{String(p.email || "")}</span></div>
            <div><span className="text-white/40">Role:</span> <span className="text-white">{String(p.role || "user")}</span></div>
          </>
        )}
      </div>
      {status === "pending" && (
        <div className="flex gap-2 mt-2.5">
          <button onClick={handleApprove} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium py-1.5 rounded-lg transition-colors">Approve</button>
          <button onClick={handleDiscard} className="px-3 bg-white/5 hover:bg-white/10 text-white/50 text-[11px] py-1.5 rounded-lg transition-colors">Discard</button>
        </div>
      )}
    </div>
  );
}

export function AdminBrainChat({ userId, scope = "user" }: AdminBrainChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

  useEffect(() => {
    if (chatAreaRef.current) chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
  }, [messages]);

  const sendMessage = useCallback(async (messageText?: string) => {
    const msg = messageText || input.trim();
    if (!msg || isStreaming) return;
    setInput("");
    setIsStreaming(true);

    const newMessages: Message[] = [...messages, { role: "user", content: msg }];
    setMessages(newMessages);
    const assistantIndex = newMessages.length;
    setMessages([...newMessages, { role: "assistant", content: "", toolActions: [] }]);

    try {
      const authHeaders = await getRichardAuthHeaders();
      const res = await fetch(`${BACKEND_URL}/api/admin-brain/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ message: msg, user_id: userId, scope }),
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");
      const decoder = new TextDecoder();
      let fullText = "";
      const toolActions: ToolAction[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                fullText += data.text;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[assistantIndex] = { role: "assistant", content: fullText, toolActions: [...toolActions] };
                  return updated;
                });
              }
              if (data.tool_action) {
                toolActions.push(data.tool_action as ToolAction);
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[assistantIndex] = { role: "assistant", content: fullText, toolActions: [...toolActions] };
                  return updated;
                });
              }
              if (data.error) {
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[assistantIndex] = { role: "assistant", content: `Error: ${data.error}`, toolActions: [] };
                  return updated;
                });
              }
            } catch { /* ignore partial parse */ }
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
  }, [BACKEND_URL, userId, input, isStreaming, messages]);

  const reset = async () => {
    try {
      const authHeaders = await getRichardAuthHeaders();
      await fetch(`${BACKEND_URL}/api/admin-brain/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ user_id: userId, scope }),
      });
    } catch { /* ignore */ }
    setMessages([]);
  };

  const handleToolStatusUpdate = () => { /* noop — cards manage their own state */ };

  return (
    <div className="rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-glass)] overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-[rgb(15,18,35)]">
        <div className="flex items-center gap-2">
          <RichardIcon size={24} />
          <div>
            <div className="text-white text-sm font-semibold">
              {scope === "company" ? "Richard — Portfolio" : "Richard — Setup"}
            </div>
            <div className="text-white/40 text-[10px]">
              {scope === "company"
                ? "Cross-claim portfolio insights · for one claim, open it and use Richard inside"
                : "Integrations, team, company info · for claim questions, open the claim's Richard"}
            </div>
          </div>
        </div>
        <button onClick={reset} className="text-white/30 hover:text-white/60 text-xs px-2 py-1 rounded transition-colors">Reset</button>
      </div>

      <div ref={chatAreaRef} className="max-h-[500px] overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="py-6">
            <div className="text-center mb-4">
              <RichardIcon size={48} className="mb-3" />
              <div className="text-white text-sm font-medium mb-1">
                {scope === "company" ? "Richard — Portfolio" : "Richard — Setup"}
              </div>
              <div className="text-white/50 text-xs max-w-[360px] mx-auto">
                {scope === "company"
                  ? "Portfolio insights and team setup. For specific claims, open the claim and use the Richard inside it."
                  : "I help with setup — integrations, team, company info. For questions about a specific claim, open the claim and use the Richard inside it."}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {(scope === "company" ? QUICK_COMPANY_ACTIONS : QUICK_SETUP_ACTIONS).map((a) => (
                <button
                  key={a.label}
                  onClick={() => sendMessage(a.prompt)}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 text-white/50 hover:text-indigo-300 hover:border-indigo-400/30 transition-colors"
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs flex-shrink-0 ${
                msg.role === "assistant" ? "bg-indigo-500/10 border border-indigo-500/20" : "bg-emerald-500/10 border border-emerald-500/20"
              }`}>{msg.role === "assistant" ? <RichardIcon size={20} /> : "T"}</div>
              <div className={`max-w-[85%] min-w-0 rounded-xl px-3 py-2 break-words ${
                msg.role === "user" ? "bg-indigo-600 text-white text-sm" : "bg-white/5 border border-white/10 text-white/80"
              }`}>
                {msg.role === "assistant" ? (
                  <>
                    <MarkdownContent content={msg.content} />
                    {msg.toolActions?.map((a, j) => {
                      if (a.type === "integrations_status" && a.data) return <IntegrationsStatusCard key={j} data={a.data} />;
                      if (a.type === "integration_setup_guide" && a.data) return <SetupGuideCard key={j} data={a.data} />;
                      if (a.type === "oauth_redirect" && a.data) return <OAuthRedirectCard key={j} data={a.data} />;
                      if (a.action === "preview") return <ApprovalCard key={j} action={a} userId={userId} backendUrl={BACKEND_URL} onStatusUpdate={handleToolStatusUpdate} />;
                      return null;
                    })}
                  </>
                ) : (
                  <span className="text-sm">{msg.content}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="px-3 py-3 border-t border-white/10 bg-[rgb(15,18,35)]">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Ask Richard about setup..."
            rows={1}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm placeholder-white/30 outline-none focus:border-indigo-500/50 resize-none"
          />
          <button
            onClick={() => sendMessage()}
            disabled={isStreaming || !input.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 text-white w-9 h-9 rounded-xl flex items-center justify-center transition-colors text-sm"
          >→</button>
        </div>
      </div>
    </div>
  );
}
