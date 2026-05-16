"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { WorkorderCard } from "@/components/workorder-card";

interface ClaimSummary {
  id: string;
  address: string | null;
  homeowner_name: string | null;
}

interface Crew {
  id: string;
  name: string;
  color: string;
}

interface ExistingSchedule {
  id: string;
  claim_id: string;
  crew_id: string | null;
  scheduled_at: string;
  end_at: string | null;
  status: string;
  notes: string | null;
  notify_homeowner: boolean;
  notified_at: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** When provided, modal opens in "reschedule" mode for that schedule */
  existing?: ExistingSchedule | null;
  /** Suggested initial date (e.g. when user clicked an empty calendar slot) */
  initialDate?: Date | null;
  /** When provided, modal opens in "schedule this specific claim" mode */
  claimId?: string;
  crews: Crew[];
  onSaved: () => void;
}

function toLocalDatetimeValue(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}

export function ScheduleClaimModal({
  open,
  onClose,
  existing,
  initialDate,
  claimId,
  crews,
  onSaved,
}: Props) {
  const supabase = createClient();

  const [selectedClaimId, setSelectedClaimId] = useState<string>(claimId ?? "");
  const [selectedClaimLabel, setSelectedClaimLabel] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<ClaimSummary[]>([]);
  const [searching, setSearching] = useState(false);

  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [endAt, setEndAt] = useState<string>("");
  const [crewId, setCrewId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [notifyHomeowner, setNotifyHomeowner] = useState(true);
  const [sendNow, setSendNow] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill on open
  useEffect(() => {
    if (!open) return;
    if (existing) {
      setSelectedClaimId(existing.claim_id);
      setScheduledAt(toLocalDatetimeValue(existing.scheduled_at));
      setEndAt(existing.end_at ? toLocalDatetimeValue(existing.end_at) : "");
      setCrewId(existing.crew_id ?? "");
      setNotes(existing.notes ?? "");
      setNotifyHomeowner(existing.notify_homeowner);
      setSendNow(!existing.notified_at && existing.notify_homeowner);
    } else {
      setSelectedClaimId(claimId ?? "");
      const seed = initialDate ?? new Date();
      seed.setHours(9, 0, 0, 0);
      setScheduledAt(toLocalDatetimeValue(seed));
      setEndAt("");
      setCrewId("");
      setNotes("");
      setNotifyHomeowner(true);
      setSendNow(true);
    }
    setSearchTerm("");
    setSearchResults([]);
    setError(null);
  }, [open, existing, claimId, initialDate]);

  // When we have a pre-populated claim id (from per-claim page entry or
  // reschedule mode), look up its address so the chip shows something
  // readable instead of the raw UUID.
  useEffect(() => {
    if (!open || !selectedClaimId) {
      setSelectedClaimLabel("");
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("claims")
        .select("address, homeowner_name")
        .eq("id", selectedClaimId)
        .maybeSingle();
      if (cancelled) return;
      const label =
        (data?.address as string | null) ||
        (data?.homeowner_name as string | null) ||
        selectedClaimId.slice(0, 8);
      setSelectedClaimLabel(label);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedClaimId, open, supabase]);

  // Claim search
  useEffect(() => {
    if (!open || !!claimId || !!existing) return;
    if (searchTerm.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("claims")
        .select("id, address, homeowner_name")
        .ilike("address", `%${searchTerm}%`)
        .limit(8);
      if (!cancelled) {
        setSearchResults((data as ClaimSummary[]) || []);
        setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [searchTerm, open, supabase, claimId, existing]);

  const submit = useCallback(async () => {
    if (!selectedClaimId) {
      setError("Pick a claim first.");
      return;
    }
    if (!scheduledAt) {
      setError("Pick a date & time.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      let scheduleId: string;
      if (existing) {
        const res = await fetch(
          `/api/admin/production/schedules/${existing.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scheduled_at: new Date(scheduledAt).toISOString(),
              end_at: endAt ? new Date(endAt).toISOString() : null,
              crew_id: crewId || null,
              notes: notes.trim() || null,
            }),
          }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        scheduleId = existing.id;
      } else {
        const res = await fetch("/api/admin/production/schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claim_id: selectedClaimId,
            scheduled_at: new Date(scheduledAt).toISOString(),
            end_at: endAt ? new Date(endAt).toISOString() : null,
            crew_id: crewId || null,
            notes: notes.trim() || null,
            notify_homeowner: notifyHomeowner,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        scheduleId = json.schedule.id;
      }

      if (notifyHomeowner && sendNow) {
        const notifyRes = await fetch(
          `/api/admin/production/schedules/${scheduleId}/notify`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reset: !!existing }),
          }
        );
        if (!notifyRes.ok) {
          const body = await notifyRes.json().catch(() => ({}));
          // Schedule saved but email failed — surface but don't roll back.
          setError(
            `Schedule saved. Email failed: ${body.error || `HTTP ${notifyRes.status}`}`
          );
          setSubmitting(false);
          onSaved();
          return;
        }
      }

      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedClaimId,
    scheduledAt,
    endAt,
    crewId,
    notes,
    notifyHomeowner,
    sendNow,
    existing,
    onSaved,
    onClose,
  ]);

  const cancel = useCallback(async () => {
    if (!existing) return;
    if (!window.confirm("Cancel this scheduled install?")) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/admin/production/schedules/${existing.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setSubmitting(false);
    }
  }, [existing, onSaved, onClose]);

  if (!open) return null;

  const isLockedClaim = !!claimId || !!existing;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="w-full sm:max-w-lg bg-[rgb(15,18,35)] sm:rounded-2xl rounded-t-2xl border border-[var(--border-glass)] max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-[var(--border-glass)] flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">
              {existing ? "Reschedule install" : "Schedule install"}
            </h2>
            <p className="text-xs text-[var(--gray-muted)] mt-0.5">
              Homeowner gets an email when you save.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-[var(--gray-muted)] hover:text-white text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {!isLockedClaim && (
            <div>
              <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
                Claim
              </label>
              {selectedClaimId ? (
                <div className="flex items-center justify-between p-3 rounded-xl border border-[var(--cyan)] bg-[var(--cyan)]/[0.08]">
                  <span className="text-sm text-white truncate">
                    {searchResults.find((c) => c.id === selectedClaimId)?.address ??
                      selectedClaimLabel ??
                      selectedClaimId}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedClaimId("")}
                    className="text-xs text-[var(--gray-muted)] hover:text-white"
                  >
                    change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by address…"
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)]"
                  />
                  {searching && (
                    <p className="text-xs text-[var(--gray-dim)] mt-1">Searching…</p>
                  )}
                  {searchResults.length > 0 && (
                    <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                      {searchResults.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setSelectedClaimId(c.id);
                            setSearchTerm("");
                          }}
                          className="block w-full text-left p-2 rounded-lg hover:bg-white/[0.04] text-sm text-white"
                        >
                          {c.address ?? c.id}
                          {c.homeowner_name && (
                            <span className="text-xs text-[var(--gray-muted)] ml-2">
                              {c.homeowner_name}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {selectedClaimId && <WorkorderCard claimId={selectedClaimId} />}

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
                Start <span className="text-red-400">*</span>
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
                End (optional)
              </label>
              <input
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
              Crew
            </label>
            {crews.length === 0 ? (
              <p className="text-xs text-[var(--gray-dim)]">
                No crews yet — add one from the Production page.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {crews.map((c) => {
                  const active = crewId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCrewId(active ? "" : c.id)}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors"
                      style={{
                        background: active
                          ? `color-mix(in srgb, ${c.color} 25%, transparent)`
                          : "rgba(255,255,255,0.04)",
                        borderColor: active ? c.color : "var(--border-glass)",
                        color: active ? c.color : "var(--gray)",
                      }}
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full mr-1.5"
                        style={{ background: c.color }}
                      />
                      {c.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--gray-muted)] uppercase tracking-wide mb-2">
              Notes for the homeowner (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Crew arrives between 7-8 AM. Pets indoors please."
              className="w-full px-3 py-2 rounded-xl border border-[var(--border-glass)] bg-white/[0.04] text-white text-sm focus:outline-none focus:border-[var(--cyan)]"
            />
          </div>

          <div className="space-y-2 p-3 rounded-xl border border-[var(--border-glass)] bg-white/[0.02]">
            <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
              <input
                type="checkbox"
                checked={notifyHomeowner}
                onChange={(e) => setNotifyHomeowner(e.target.checked)}
                className="accent-[var(--cyan)]"
              />
              Notify homeowner about this schedule
            </label>
            {notifyHomeowner && (
              <label className="flex items-center gap-2 text-xs text-[var(--gray)] cursor-pointer ml-6">
                <input
                  type="checkbox"
                  checked={sendNow}
                  onChange={(e) => setSendNow(e.target.checked)}
                  className="accent-[var(--cyan)]"
                />
                Send email immediately on save
              </label>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-[var(--border-glass)] flex items-center gap-3 justify-end flex-wrap">
          {existing && existing.status !== "completed" && existing.status !== "cancelled" && (
            <button
              type="button"
              onClick={cancel}
              disabled={submitting}
              className="mr-auto px-4 py-2 rounded-xl border border-[var(--red-accent)]/40 text-[var(--red-accent)] hover:bg-[var(--red-accent)]/10 text-sm font-semibold transition-colors"
            >
              Cancel install
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-sm text-[var(--gray)] hover:text-white hover:bg-white/[0.04] transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !scheduledAt}
            className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] disabled:opacity-40 text-white px-5 py-2 rounded-xl text-sm font-semibold transition-all"
          >
            {submitting ? "Saving…" : existing ? "Save & notify" : "Schedule & notify"}
          </button>
        </div>
      </div>
    </div>
  );
}
