"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface CorrespondenceItem {
  id: string;
  claim_id: string | null;
  original_from: string;
  original_subject: string;
  original_date: string;
  carrier_name: string;
  address_parsed: string;
  match_method: string;
  match_confidence: number;
  carrier_position: {
    stance: string;
    summary: string;
  } | null;
  suggested_action: string;
  analysis_status: string;
  status: string;
  created_at: string;
}

interface ClaimOption {
  id: string;
  address: string;
  carrier: string;
}

type FilterStatus = "all" | "unmatched" | "matched" | "response_drafted" | "response_sent" | "archived";

export default function CorrespondencePage() {
  const supabase = createClient();
  const router = useRouter();
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

  const [correspondence, setCorrespondence] = useState<CorrespondenceItem[]>([]);
  const [claims, setClaims] = useState<ClaimOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [selectedClaimId, setSelectedClaimId] = useState<string>("");

  const fetchAll = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    try {
      const res = await fetch(`${BACKEND_URL}/api/correspondence?user_id=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setCorrespondence(data.correspondence || []);
      }
    } catch (err) {
      console.error("Failed to fetch correspondence:", err);
    }

    const { data: claimsData } = await supabase
      .from("claims")
      .select("id, address, carrier")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setClaims(claimsData || []);
    setLoading(false);
  }, [supabase, router, BACKEND_URL]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleManualMatch = async (correspondenceId: string) => {
    if (!selectedClaimId) return;
    try {
      await fetch(`${BACKEND_URL}/api/correspondence/${correspondenceId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim_id: selectedClaimId }),
      });
      setMatchingId(null);
      setSelectedClaimId("");
      fetchAll();
    } catch (err) {
      console.error("Failed to match:", err);
    }
  };

  const filtered = filter === "all"
    ? correspondence
    : correspondence.filter((c) => c.status === filter);

  const stanceBadge = (stance: string) => {
    const configs: Record<string, { bg: string; text: string; label: string }> = {
      full_denial: { bg: "bg-red-100", text: "text-red-700", label: "Full Denial" },
      partial_denial: { bg: "bg-orange-100", text: "text-orange-700", label: "Partial Denial" },
      underpayment: { bg: "bg-amber-100", text: "text-amber-700", label: "Underpayment" },
      request_for_info: { bg: "bg-blue-100", text: "text-blue-700", label: "Info Request" },
      reinspection_offer: { bg: "bg-purple-100", text: "text-purple-700", label: "Reinspection" },
      acceptance: { bg: "bg-green-100", text: "text-green-700", label: "Acceptance" },
    };
    const c = configs[stance] || { bg: "bg-gray-100", text: "text-gray-700", label: stance || "Pending" };
    return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>{c.label}</span>;
  };

  const statusBadge = (status: string) => {
    const configs: Record<string, { bg: string; text: string }> = {
      unmatched: { bg: "bg-yellow-100", text: "text-yellow-700" },
      matched: { bg: "bg-blue-100", text: "text-blue-700" },
      response_drafted: { bg: "bg-purple-100", text: "text-purple-700" },
      response_sent: { bg: "bg-green-100", text: "text-green-700" },
      archived: { bg: "bg-gray-100", text: "text-gray-500" },
    };
    const c = configs[status] || { bg: "bg-gray-100", text: "text-gray-500" };
    return (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
        {status.replace(/_/g, " ")}
      </span>
    );
  };

  const counts = {
    all: correspondence.length,
    unmatched: correspondence.filter((c) => c.status === "unmatched").length,
    matched: correspondence.filter((c) => c.status === "matched").length,
    response_drafted: correspondence.filter((c) => c.status === "response_drafted").length,
    response_sent: correspondence.filter((c) => c.status === "response_sent").length,
    archived: correspondence.filter((c) => c.status === "archived").length,
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Top Bar */}
      <nav className="bg-[var(--navy)] border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white">DR</div>
            <span className="text-white font-bold text-lg tracking-tight">
              dumb roof<sup className="text-[9px] font-medium align-super ml-0.5">™</sup>
            </span>
          </div>
          <a href="/dashboard" className="text-gray-400 hover:text-white text-sm transition-colors">
            Back to Dashboard
          </a>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--navy)]">Carrier Correspondence</h1>
          <p className="text-gray-500 mt-1">
            All inbound carrier emails across your claims. Forward carrier emails to <strong>claims@dumbroof.ai</strong> to auto-ingest.
          </p>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {(["all", "unmatched", "matched", "response_drafted", "response_sent", "archived"] as FilterStatus[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                filter === f
                  ? "bg-[var(--navy)] text-white border-[var(--navy)]"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
              }`}
            >
              {f === "all" ? "All" : f.replace(/_/g, " ")}
              {counts[f] > 0 && (
                <span className={`ml-1.5 ${filter === f ? "text-white/70" : "text-gray-400"}`}>
                  ({counts[f]})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Correspondence list */}
        {filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 text-center py-16 px-8">
            <div className="w-16 h-16 rounded-2xl bg-gray-50 border-2 border-dashed border-gray-300 flex items-center justify-center mx-auto mb-5">
              <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-[var(--navy)] mb-2">
              {filter === "all" ? "No correspondence yet" : `No ${filter.replace(/_/g, " ")} emails`}
            </h3>
            <p className="text-gray-500 text-sm max-w-md mx-auto">
              Forward carrier emails to <strong>claims@dumbroof.ai</strong> and they&apos;ll appear here automatically with AI analysis.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((item) => {
              const position = typeof item.carrier_position === "string"
                ? JSON.parse(item.carrier_position as unknown as string)
                : item.carrier_position;
              const isMatchingThis = matchingId === item.id;

              return (
                <div key={item.id} className="bg-white rounded-xl border border-gray-200 px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {statusBadge(item.status)}
                        {position && stanceBadge(position.stance)}
                        {item.carrier_name && (
                          <span className="text-xs text-gray-400">{item.carrier_name}</span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-[var(--navy)] truncate">
                        {item.original_subject || "No subject"}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        From: {item.original_from}
                        {item.address_parsed && <> &middot; {item.address_parsed}</>}
                        {" "}&middot; {new Date(item.original_date || item.created_at).toLocaleDateString()}
                      </p>
                      {position?.summary && (
                        <p className="text-xs text-gray-600 mt-1.5 line-clamp-2">{position.summary}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.claim_id ? (
                        <a
                          href={`/dashboard/claim/${item.claim_id}`}
                          className="bg-[var(--navy)] hover:bg-[var(--navy-light)] text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        >
                          View Claim
                        </a>
                      ) : (
                        <button
                          onClick={() => {
                            setMatchingId(isMatchingThis ? null : item.id);
                            setSelectedClaimId("");
                          }}
                          className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        >
                          {isMatchingThis ? "Cancel" : "Link to Claim"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Manual matching UI */}
                  {isMatchingThis && (
                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-3">
                      <select
                        value={selectedClaimId}
                        onChange={(e) => setSelectedClaimId(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none"
                      >
                        <option value="">Select a claim...</option>
                        {claims.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.address} ({c.carrier})
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleManualMatch(item.id)}
                        disabled={!selectedClaimId}
                        className="bg-[var(--navy)] hover:bg-[var(--navy-light)] disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                      >
                        Match
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
