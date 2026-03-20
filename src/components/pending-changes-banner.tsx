"use client";

import { useEffect, useState, useCallback } from "react";
import { getBackendUrl } from "@/lib/backend-config";

interface PendingChanges {
  photo_changes: number;
  scope_changes: number;
  measurement_changes: number;
  total: number;
  last_processed_at: string | null;
}

interface Props {
  claimId: string;
}

export function PendingChangesBanner({ claimId }: Props) {
  const [changes, setChanges] = useState<PendingChanges | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChanges = useCallback(async () => {
    try {
      const res = await fetch(`/api/pending-changes?claim_id=${claimId}`);
      if (res.ok) {
        const data = await res.json();
        setChanges(data);
      }
    } catch {
      // Non-fatal — banner just won't show
    }
  }, [claimId]);

  useEffect(() => {
    fetchChanges();
  }, [fetchChanges]);

  const handleResubmit = async () => {
    setResubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${getBackendUrl()}/api/reprocess/${claimId}`, { method: "POST" });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: "Unknown error" }));
        setError(`Resubmit failed: ${errData.detail || errData.error || res.statusText}`);
      } else {
        // Clear changes display after successful resubmit
        setChanges(null);
        // Reload page to show processing state
        window.location.reload();
      }
    } catch (err) {
      setError(`Resubmit failed: ${err instanceof Error ? err.message : "Network error"}`);
    }
    setResubmitting(false);
  };

  if (!changes || changes.total === 0) return null;

  const parts: string[] = [];
  if (changes.photo_changes > 0) parts.push(`${changes.photo_changes} photo correction${changes.photo_changes > 1 ? "s" : ""}`);
  if (changes.scope_changes > 0) parts.push(`${changes.scope_changes} scope edit${changes.scope_changes > 1 ? "s" : ""}`);
  if (changes.measurement_changes > 0) parts.push(`${changes.measurement_changes} material override${changes.measurement_changes > 1 ? "s" : ""}`);

  return (
    <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
            <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-amber-400">
              {changes.total} pending change{changes.total > 1 ? "s" : ""}
            </h3>
            <p className="text-xs text-amber-400 mt-0.5">
              {parts.join(" + ")}
            </p>
            {expanded && (
              <div className="mt-3 space-y-1.5 text-xs text-amber-400">
                {changes.photo_changes > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-purple-400" />
                    <span>{changes.photo_changes} photo annotation{changes.photo_changes > 1 ? "s" : ""} corrected/rejected since last processing</span>
                  </div>
                )}
                {changes.scope_changes > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-teal-400" />
                    <span>{changes.scope_changes} line item{changes.scope_changes > 1 ? "s" : ""} edited/removed/added since last processing</span>
                  </div>
                )}
                {changes.measurement_changes > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-400" />
                    <span>{changes.measurement_changes} roof slope{changes.measurement_changes > 1 ? "s" : ""} with material overrides</span>
                  </div>
                )}
                {changes.last_processed_at && (
                  <p className="text-amber-400 mt-2">
                    Last processed: {new Date(changes.last_processed_at).toLocaleString()}
                  </p>
                )}
              </div>
            )}
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-amber-400 hover:text-amber-300 mt-1 font-medium"
            >
              {expanded ? "Hide details" : "Show details"}
            </button>
          </div>
        </div>
        <button
          onClick={handleResubmit}
          disabled={resubmitting}
          className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 whitespace-nowrap ml-4 shrink-0"
        >
          {resubmitting ? "Resubmitting..." : "Resubmit Claim"}
        </button>
      </div>
      {error && (
        <div className="mt-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
