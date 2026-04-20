"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface Sequence {
  claim_id: string;
  status: "not_started" | "active" | "paused" | "complete";
  started_at: string | null;
  next_send_at: string | null;
  last_template_slug: string | null;
  last_sent_at: string | null;
  completed_at: string | null;
  pause_reason: string | null;
}

interface HomeownerSend {
  id: string;
  template_slug: string | null;
  subject: string | null;
  sent_at: string;
  to_email: string | null;
  replied_at: string | null;
  opened_at: string | null;
}

interface HomeownerEvent {
  id: string;
  event_type: string;
  metadata: Record<string, unknown> | null;
  reported_at: string;
  reported_by: string | null;
}

// Quick-send templates surfaced as buttons in the card
const QUICK_TEMPLATES = [
  { slug: "welcome_what_to_expect",    label: "What to Expect" },
  { slug: "adjuster_meeting_prep",     label: "Adjuster Prep" },
  { slug: "sample_books_pick_colors",  label: "Sample Books" },
  { slug: "nearby_jobs_showcase",      label: "Nearby Jobs" },
  { slug: "adjuster_status_checkin",   label: "Adjuster Check-in" },
  { slug: "scope_status_checkin",      label: "Scope Check-in" },
  { slug: "first_check_guidance",      label: "First Check Guide" },
];

function timeAgo(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function HomeownerEngagementCard({
  claimId,
  homeownerEmail,
}: {
  claimId: string;
  homeownerEmail?: string | null;
}) {
  const supabase = createClient();
  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [sends, setSends] = useState<HomeownerSend[]>([]);
  const [events, setEvents] = useState<HomeownerEvent[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [sequenceBusy, setSequenceBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const [seqRes, sendsRes, eventsRes] = await Promise.all([
      supabase.from("homeowner_sequences").select("*").eq("claim_id", claimId).maybeSingle(),
      supabase
        .from("homeowner_sends")
        .select("id, template_slug, subject, sent_at, to_email, replied_at, opened_at")
        .eq("claim_id", claimId)
        .order("sent_at", { ascending: false })
        .limit(20),
      supabase
        .from("homeowner_events")
        .select("id, event_type, metadata, reported_at, reported_by")
        .eq("claim_id", claimId)
        .order("reported_at", { ascending: false })
        .limit(20),
    ]);
    setSequence((seqRes.data as Sequence | null) || null);
    setSends((sendsRes.data as HomeownerSend[]) || []);
    setEvents((eventsRes.data as HomeownerEvent[]) || []);
  }, [claimId, supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSendNow = async (slug: string) => {
    setError(null);
    setSending(slug);
    try {
      const res = await fetch("/api/homeowner/send-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim_id: claimId, template_slug: slug }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Send failed");
      } else {
        await fetchData();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSending(null);
    }
  };

  const handleSequence = async (action: "start" | "pause" | "resume" | "stop") => {
    setError(null);
    setSequenceBusy(true);
    try {
      const res = await fetch("/api/homeowner/sequence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim_id: claimId, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Action failed");
      } else {
        await fetchData();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSequenceBusy(false);
    }
  };

  const seqStatus = sequence?.status || "not_started";
  const hasEmail = !!homeownerEmail;

  return (
    <div className="glass-card p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-[var(--white)]">Homeowner Engagement</h2>
          <p className="text-xs text-[var(--gray-muted)] mt-1">
            Keep the homeowner excited and informed. Close the silence gap between inspection and approval.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {seqStatus === "active" && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              Active
            </span>
          )}
          {seqStatus === "paused" && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
              Paused
            </span>
          )}
          {seqStatus === "complete" && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-500/15 text-gray-400 border border-gray-500/30">
              Complete
            </span>
          )}
        </div>
      </div>

      {!hasEmail && (
        <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-200">
          Add the homeowner&apos;s email in <strong>Contact details</strong> above to enable sends.
        </div>
      )}

      {/* Sequence control bar */}
      <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-white/[0.03] border border-[var(--border-glass)] mb-4">
        <div className="text-sm flex-1 min-w-0">
          {seqStatus === "not_started" && (
            <span className="text-[var(--gray-muted)]">
              No sequence running — start the 21-day homeowner flow or send one-offs below.
            </span>
          )}
          {seqStatus === "active" && (
            <span className="text-[var(--white)]">
              {sequence?.last_template_slug && sequence?.last_sent_at ? (
                <>
                  Last sent: <strong>{sequence.last_template_slug}</strong> · {timeAgo(sequence.last_sent_at)}
                </>
              ) : (
                "Running. Next send scheduled by cron."
              )}
              {sequence?.next_send_at && (
                <span className="block text-xs text-[var(--gray-dim)] mt-0.5">
                  Next send: {new Date(sequence.next_send_at).toLocaleString()}
                </span>
              )}
            </span>
          )}
          {seqStatus === "paused" && (
            <span className="text-[var(--gray-muted)]">
              Paused{sequence?.pause_reason ? ` — ${sequence.pause_reason}` : ""}
            </span>
          )}
          {seqStatus === "complete" && (
            <span className="text-[var(--gray-muted)]">Completed {sequence?.completed_at ? timeAgo(sequence.completed_at) : ""}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {seqStatus === "not_started" && (
            <button
              onClick={() => handleSequence("start")}
              disabled={sequenceBusy || !hasEmail}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] text-white disabled:opacity-50"
            >
              Start Communications
            </button>
          )}
          {seqStatus === "active" && (
            <>
              <button
                onClick={() => handleSequence("pause")}
                disabled={sequenceBusy}
                className="text-xs px-3 py-1.5 rounded-lg bg-white/[0.04] border border-[var(--border-glass)] text-[var(--gray)] hover:text-[var(--white)] disabled:opacity-50"
              >
                Pause
              </button>
              <button
                onClick={() => handleSequence("stop")}
                disabled={sequenceBusy}
                className="text-xs px-3 py-1.5 rounded-lg bg-white/[0.04] border border-[var(--border-glass)] text-[var(--gray-dim)] hover:text-red-400 disabled:opacity-50"
              >
                Stop
              </button>
            </>
          )}
          {seqStatus === "paused" && (
            <button
              onClick={() => handleSequence("resume")}
              disabled={sequenceBusy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 text-white disabled:opacity-50"
            >
              Resume
            </button>
          )}
        </div>
      </div>

      {/* Send-now buttons */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
          Send now
        </p>
        <div className="flex flex-wrap gap-2">
          {QUICK_TEMPLATES.map((t) => (
            <button
              key={t.slug}
              onClick={() => handleSendNow(t.slug)}
              disabled={!hasEmail || sending !== null}
              className="text-xs px-3 py-1.5 rounded-full bg-white/[0.04] hover:bg-cyan-500/15 border border-[var(--border-glass)] hover:border-cyan-500/40 text-[var(--gray)] hover:text-cyan-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sending === t.slug ? "Sending…" : t.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Activity log */}
      {(sends.length > 0 || events.length > 0) && (
        <div>
          <p className="text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
            Recent activity
          </p>
          <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
            {/* Merge sends + events by timestamp */}
            {[
              ...sends.map((s) => ({
                kind: "send" as const,
                time: s.sent_at,
                title: s.subject || s.template_slug || "Email sent",
                meta: s.replied_at ? "Replied ✓" : s.opened_at ? "Opened" : "Sent",
              })),
              ...events.map((e) => ({
                kind: "event" as const,
                time: e.reported_at,
                title: e.event_type.replace(/_/g, " "),
                meta: e.reported_by || "",
              })),
            ]
              .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
              .slice(0, 12)
              .map((row, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 text-xs py-1.5 px-2 rounded bg-white/[0.02]"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        row.kind === "send" ? "bg-cyan-400" : "bg-emerald-400"
                      }`}
                    />
                    <span className="text-[var(--white)] truncate">{row.title}</span>
                  </span>
                  <span className="text-[var(--gray-dim)] flex-shrink-0">
                    {row.meta} · {timeAgo(row.time)}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
