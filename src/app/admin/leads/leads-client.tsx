"use client";

import { useCallback, useEffect, useState } from "react";

type Lead = {
  id: string;
  from_email: string;
  subject: string | null;
  body_excerpt: string | null;
  matched_touch: string | null;
  opted_out: boolean;
  user_id: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
};

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function LeadsClient() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/leads", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      const data = await res.json();
      setLeads(data.leads || []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const select = (l: Lead) => {
    setSelected(l);
    setReply("");
  };

  const send = async () => {
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/admin/leads/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: selected.from_email,
          subject: selected.subject ? `Re: ${selected.subject.replace(/^re:\s*/i, "")}` : undefined,
          message: reply,
          leadId: selected.id,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      setSentIds((prev) => new Set(prev).add(selected.id));
      setSelected(null);
      setReply("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white/90 px-5 py-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <button onClick={load} className="text-xs text-white/40 hover:text-white/80 transition">
            ↻ refresh
          </button>
        </div>
        <p className="text-sm text-white/40 mb-5">
          Inbound prospects who emailed <span className="text-white/70">tom@dumbroof.ai</span>. Replies go out{" "}
          <span className="text-violet-300">as tom@dumbroof.ai</span> — never your USARM inbox.
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        {loading ? (
          <p className="text-white/40 text-sm">Loading…</p>
        ) : leads.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-10 text-center text-white/40 text-sm">
            No leads yet. The poller surfaces prospect emails to tom@dumbroof.ai here within ~5 minutes of arrival.
          </div>
        ) : (
          <div className="space-y-2">
            {leads.map((l) => {
              const replied = sentIds.has(l.id) || Array.isArray(l.raw_payload?.admin_replies);
              return (
                <div
                  key={l.id}
                  className="rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.05] transition overflow-hidden"
                >
                  <button
                    onClick={() => {
                      if (selected?.id === l.id) {
                        setSelected(null);
                        setReply("");
                      } else select(l);
                    }}
                    className="w-full text-left px-4 py-3"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-white/90">{l.from_email}</span>
                      {l.user_id ? (
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                          signup
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300">
                          fresh
                        </span>
                      )}
                      {l.matched_touch && (
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300">
                          {l.matched_touch.replace(/_/g, " ")}
                        </span>
                      )}
                      {replied && (
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/10 text-white/60">
                          replied
                        </span>
                      )}
                      <span className="ml-auto text-xs text-white/30">{timeAgo(l.created_at)}</span>
                    </div>
                    <div className="text-sm text-white/70 mt-1 truncate">{l.subject || "(no subject)"}</div>
                    {l.body_excerpt && (
                      <div className="text-xs text-white/40 mt-1 line-clamp-2">{l.body_excerpt}</div>
                    )}
                  </button>

                  {selected?.id === l.id && (
                    <div className="border-t border-white/10 px-4 py-3 bg-black/20">
                      {l.body_excerpt && (
                        <pre className="whitespace-pre-wrap text-xs text-white/55 bg-white/[0.03] rounded-lg p-3 mb-3 max-h-48 overflow-y-auto">
                          {l.body_excerpt}
                        </pre>
                      )}
                      <textarea
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        placeholder={`Reply to ${l.from_email} as tom@dumbroof.ai…`}
                        rows={4}
                        className="w-full rounded-lg bg-white/[0.04] border border-white/15 px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50 resize-y"
                      />
                      <div className="flex items-center gap-3 mt-2">
                        <button
                          onClick={send}
                          disabled={sending || !reply.trim()}
                          className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
                        >
                          {sending ? "Sending…" : "Send as tom@dumbroof.ai"}
                        </button>
                        <span className="text-[11px] text-white/30">Goes out from tom@dumbroof.ai · on-brand</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
