"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Claim } from "@/types/claim";
import type { Repair } from "@/types/repair";
import { useBillingQuota } from "@/hooks/use-billing-quota";
import { ClaimsMap } from "@/components/claims-map";
import { RepairTabContent } from "./repair-tab-content";

type StatusFilter = "all" | "processing" | "ready" | "attention";
type ViewMode = "table" | "map";
type DashboardTab = "claims" | "repairs";

function fmtMoney(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

export function DashboardContent({ user }: { user: User }) {
  const supabase = useMemo(() => createClient(), []);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [activeTab, setActiveTab] = useState<DashboardTab>("claims");
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const billing = useBillingQuota();

  // Parallel fetch for claims + repairs
  const fetchAll = useCallback(async () => {
    const [claimsRes, repairsRes] = await Promise.all([
      supabase.from("claims").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("repairs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]);

    // No-op guard: only update state if data actually changed
    setClaims(prev => {
      const next = claimsRes.data || [];
      if (prev.length === next.length && prev.every((c, i) =>
        c.id === next[i].id && c.status === next[i].status &&
        c.claim_outcome === next[i].claim_outcome && c.settlement_amount === next[i].settlement_amount &&
        c.contractor_rcv === next[i].contractor_rcv && c.original_carrier_rcv === next[i].original_carrier_rcv
      )) return prev;
      return next;
    });
    setRepairs(prev => {
      const next = (repairsRes.data || []) as Repair[];
      if (prev.length === next.length && prev.every((r, i) => r.id === next[i].id && r.status === next[i].status))
        return prev;
      return next;
    });
    setLoading(false);
  }, [user.id, supabase]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // Auto-select repairs tab if user has repairs but no claims (e.g. Vlad)
  useEffect(() => {
    if (!loading && !initialLoadDone) {
      setInitialLoadDone(true);
      if (repairs.length > 0 && claims.length === 0) {
        setActiveTab("repairs");
      }
    }
  }, [loading, initialLoadDone, repairs.length, claims.length]);

  // Click-outside to close hamburger menu
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const handleDownloadClaim = async (claim: Claim, filename: string) => {
    setDownloading(filename);
    try {
      const path = `${claim.file_path}/output/${filename}`;
      const { data, error } = await supabase.storage.from("claim-documents").download(path);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    }
    setDownloading(null);
  };

  const handleDownloadAllClaims = async (claim: Claim) => {
    if (!claim.output_files) return;
    for (const file of claim.output_files) {
      await handleDownloadClaim(claim, file);
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  const handleDownloadRepair = async (repair: Repair, filename: string) => {
    setDownloading(filename);
    try {
      const path = `${repair.file_path}/output/${filename}`;
      const { data, error } = await supabase.storage.from("claim-documents").download(path);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    }
    setDownloading(null);
  };

  const handleDownloadAllRepairs = async (repair: Repair) => {
    if (!repair.output_files) return;
    for (const file of repair.output_files) {
      await handleDownloadRepair(repair, file);
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  const statusColors: Record<string, string> = {
    uploaded: "bg-blue-100 text-blue-700",
    processing: "bg-amber-100 text-amber-700",
    ready: "bg-green-100 text-green-700",
    needs_improvement: "bg-orange-100 text-orange-700",
    error: "bg-red-100 text-red-700",
  };

  // KPI calculations
  const readyCount = claims.filter(c => c.status === "ready").length;
  const processingCount = claims.filter(c => c.status === "processing" || c.status === "uploaded").length;
  const wonClaims = claims.filter(c => c.claim_outcome === "won");
  const totalMovement = wonClaims.reduce((sum, c) => {
    const movement = (c.settlement_amount ?? 0) - (c.original_carrier_rcv ?? 0);
    return sum + (movement > 0 ? movement : 0);
  }, 0);
  const totalContractorRcv = claims.reduce((s, c) => s + (c.contractor_rcv ?? 0), 0);
  const totalCarrierRcv = claims.reduce((s, c) => s + (c.original_carrier_rcv ?? 0), 0);
  const attentionCount = claims.filter(c => c.status === "error" || c.status === "needs_improvement" || (c.pending_edits ?? 0) > 0).length;

  // Filter logic
  const filteredClaims = claims.filter(c => {
    if (statusFilter === "all") return true;
    if (statusFilter === "processing") return c.status === "processing" || c.status === "uploaded";
    if (statusFilter === "ready") return c.status === "ready";
    if (statusFilter === "attention") return c.status === "error" || c.status === "needs_improvement" || (c.pending_edits ?? 0) > 0;
    return true;
  });

  const filterTabs: { key: StatusFilter; label: string; count?: number }[] = [
    { key: "all", label: "All", count: claims.length },
    { key: "processing", label: "Processing", count: processingCount },
    { key: "ready", label: "Ready", count: readyCount },
    { key: "attention", label: "Needs Attention", count: attentionCount },
  ];

  const navLinks = [
    { href: "/dashboard/correspondence", label: "Correspondence", hasDraftDot: claims.some((c) => (c.pending_drafts || 0) > 0), hasEditDot: claims.some((c) => (c.pending_edits || 0) > 0) },
    { href: "/dashboard/photo-review", label: "Photo Review" },
    { href: "/dashboard/repair-review", label: "Repair Review" },
    { href: "/dashboard/analytics", label: "Analytics" },
    { href: "/dashboard/settings", label: "Settings" },
  ];

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Top Bar */}
      <nav className="bg-[var(--navy)] border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white">
              DR
            </div>
            <span className="text-white font-bold text-lg tracking-tight">
              dumb roof<sup className="text-[9px] font-medium align-super ml-0.5">&trade;</sup>
            </span>
          </a>
          <div className="flex items-center gap-4">
            {/* Desktop nav links */}
            {navLinks.map(link => (
              <a
                key={link.href}
                href={link.href}
                className="text-gray-400 hover:text-white text-sm transition-colors hidden sm:block relative"
              >
                {link.label}
                {link.hasDraftDot && (
                  <span className="absolute -top-1 -right-3 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                )}
                {link.hasEditDot && (
                  <span className="absolute -top-1 -right-6 w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                )}
              </a>
            ))}
            <span className="text-gray-400 text-sm hidden sm:block">
              {user.email}
              {billing?.planName && (
                <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-white/10 text-gray-300">
                  {billing.planName}
                </span>
              )}
            </span>
            <button
              onClick={handleSignOut}
              className="text-gray-400 hover:text-white text-sm transition-colors hidden sm:block"
            >
              Sign Out
            </button>

            {/* Mobile hamburger */}
            <div className="relative sm:hidden" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="text-gray-400 hover:text-white p-1 transition-colors"
                aria-label="Menu"
              >
                {menuOpen ? (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                  </svg>
                )}
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50">
                  {navLinks.map(link => (
                    <a
                      key={link.href}
                      href={link.href}
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      {link.label}
                    </a>
                  ))}
                  <div className="border-t border-gray-100 mt-1 pt-1">
                    <div className="px-4 py-2 text-xs text-gray-400">
                      {user.email}
                      {billing?.planName && (
                        <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500">
                          {billing.planName}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => { setMenuOpen(false); handleSignOut(); }}
                      className="block w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Dashboard */}
      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--navy)]">Dashboard</h1>
            <p className="text-gray-500 mt-1 text-sm">
              {activeTab === "claims" ? "Upload documents and generate claim packages." : "Diagnose leaks and generate repair documents."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/dashboard/new-repair"
              className="bg-[var(--navy)] hover:bg-[var(--navy-light)] text-white px-5 py-3 rounded-xl font-semibold transition-colors text-sm"
            >
              + New Repair
            </a>
            <a
              href="/dashboard/new-claim"
              className="bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-6 py-3 rounded-xl font-semibold transition-colors text-sm"
            >
              + New Claim
            </a>
          </div>
        </div>

        {/* Claims / Repairs Tab Bar */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab("claims")}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              activeTab === "claims"
                ? "bg-[var(--navy)] text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            Claims
            {claims.length > 0 && (
              <span className={`ml-2 ${activeTab === "claims" ? "text-white/70" : "text-gray-400"}`}>
                {claims.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("repairs")}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              activeTab === "repairs"
                ? "bg-[var(--navy)] text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            Repairs
            {repairs.length > 0 && (
              <span className={`ml-2 ${activeTab === "repairs" ? "text-white/70" : "text-gray-400"}`}>
                {repairs.length}
              </span>
            )}
          </button>
        </div>

        {/* === REPAIRS TAB === */}
        {activeTab === "repairs" && (
          <RepairTabContent
            repairs={repairs}
            loading={loading}
            downloading={downloading}
            onDownload={handleDownloadRepair}
            onDownloadAll={handleDownloadAllRepairs}
          />
        )}

        {/* === CLAIMS TAB === */}
        {activeTab === "claims" && (
          <>
            {/* KPI Stats Bar */}
            {!loading && claims.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mb-6">
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className="text-2xl font-bold text-[var(--navy)]">{claims.length}</p>
                  <p className="text-xs text-gray-500 mt-1">Total Claims</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className="text-2xl font-bold text-green-600">{readyCount}</p>
                  <p className="text-xs text-gray-500 mt-1">Ready</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className="text-2xl font-bold text-amber-600">{processingCount}</p>
                  <p className="text-xs text-gray-500 mt-1">Processing</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className="text-2xl font-bold text-green-600">{wonClaims.length}</p>
                  <p className="text-xs text-gray-500 mt-1">Wins</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className="text-2xl font-bold text-[var(--navy)]">{fmtMoney(totalContractorRcv)}</p>
                  <p className="text-xs text-gray-500 mt-1">Contractor RCV</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className="text-2xl font-bold text-[var(--navy)]">{fmtMoney(totalCarrierRcv)}</p>
                  <p className="text-xs text-gray-500 mt-1">Carrier RCV</p>
                </div>
                {totalMovement > 0 ? (
                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border-2 border-green-300 p-4 text-center col-span-2">
                    <p className="text-3xl font-black text-green-600">+{fmtMoney(totalMovement)}</p>
                    <p className="text-xs font-semibold text-green-600 mt-1">Carrier Movement</p>
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-gray-200 p-4 text-center col-span-2">
                    <p className={`text-2xl font-bold ${totalContractorRcv - totalCarrierRcv > 0 ? "text-green-600" : "text-gray-600"}`}>
                      {fmtMoney(Math.abs(totalContractorRcv - totalCarrierRcv))}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">Variance</p>
                  </div>
                )}
              </div>
            )}

            {/* Win Summary Banner */}
            {!loading && wonClaims.length > 0 && (
              <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl p-6 mb-6 text-white shadow-lg">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <p className="text-sm font-medium text-green-100 uppercase tracking-wider">
                      Carrier Movement
                    </p>
                    <p className="text-3xl font-bold mt-1">
                      +${totalMovement.toLocaleString()}
                    </p>
                    <p className="text-sm text-green-100 mt-1">
                      {wonClaims.length} claim{wonClaims.length > 1 ? "s" : ""} won — carriers paid more after dumb roof analysis
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {wonClaims.map(c => {
                      const orig = c.original_carrier_rcv ?? 0;
                      const updated = c.settlement_amount ?? 0;
                      const move = updated - orig;
                      if (move <= 0) return null;
                      return (
                        <div key={c.id} className="text-xs text-green-100 bg-white/10 rounded-lg px-3 py-1.5">
                          <span className="font-medium text-white">{c.address?.split(",")[0]}</span>
                          <span className="mx-1.5">—</span>
                          ${orig.toLocaleString()} → ${updated.toLocaleString()}
                          <span className="ml-1.5 font-bold text-white">(+${move.toLocaleString()})</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* View Toggle + Filter Tabs */}
            {!loading && claims.length > 0 && (
              <div className="flex items-center justify-between mb-6">
                <div className="flex gap-2">
                  <button
                    onClick={() => setViewMode("table")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      viewMode === "table"
                        ? "bg-[var(--navy)] text-white"
                        : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    Table
                  </button>
                  <button
                    onClick={() => setViewMode("map")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      viewMode === "map"
                        ? "bg-[var(--navy)] text-white"
                        : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    Map
                  </button>
                </div>
              </div>
            )}
            {!loading && claims.length > 0 && (
              <div className="flex gap-2 mb-6">
                {filterTabs.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setStatusFilter(tab.key)}
                    className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors ${
                      statusFilter === tab.key
                        ? "bg-[var(--navy)] text-white"
                        : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {tab.label}
                    {tab.count != null && tab.count > 0 && (
                      <span className={`ml-1.5 ${statusFilter === tab.key ? "text-white/70" : "text-gray-400"}`}>
                        {tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Map View */}
            {!loading && viewMode === "map" && claims.length > 0 && (
              <div className="mb-6">
                <ClaimsMap claims={filteredClaims} height="450px" />
              </div>
            )}

            {/* Claims Table */}
            {loading ? (
              <div className="bg-white rounded-2xl border border-gray-200 text-center py-16">
                <p className="text-gray-400 text-sm">Loading claims...</p>
              </div>
            ) : claims.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 text-center py-16 px-8">
                <div className="w-16 h-16 rounded-2xl bg-[var(--gray-50)] border-2 border-dashed border-gray-300 flex items-center justify-center mx-auto mb-5">
                  <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-[var(--navy)] mb-2">No claims yet</h3>
                <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
                  Upload your measurements, inspection photos, and carrier scope to generate your first claim package.
                </p>
                <a href="/dashboard/new-claim" className="inline-block bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-8 py-3 rounded-xl font-semibold transition-colors text-sm">
                  Upload Documents
                </a>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left border-b border-gray-100">
                        <th className="px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase">Property</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase">Carrier</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase text-right">Our Estimate</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase text-right">Original Carrier</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase text-right">Updated Carrier</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredClaims.map((claim) => {
                        const cRcv = claim.contractor_rcv ?? 0;
                        const iRcv = claim.original_carrier_rcv ?? 0;
                        const currentCarrier = claim.settlement_amount ?? 0;
                        const isWon = claim.claim_outcome === "won";
                        const movement = isWon && currentCarrier > iRcv ? currentCarrier - iRcv : 0;
                        const movementPct = iRcv > 0 && movement > 0 ? Math.round((movement / iRcv) * 100) : 0;
                        const isProcessing = claim.status === "processing";

                        return (
                          <tr
                            key={claim.id}
                            onClick={() => setExpandedRow(expandedRow === claim.id ? null : claim.id)}
                            className={`hover:bg-gray-50 transition-colors cursor-pointer ${isWon ? "bg-green-50 border-l-4 border-l-green-500" : ""}`}
                          >
                            <td className="px-3 py-2.5">
                              <a href={`/dashboard/claim/${claim.id}`} className="hover:underline" onClick={e => e.stopPropagation()}>
                                <p className="font-medium text-[var(--navy)] truncate max-w-[220px]">{claim.address}</p>
                              </a>
                              <p className="text-[10px] text-gray-400 mt-0.5">{new Date(claim.created_at).toLocaleDateString()}</p>
                            </td>
                            <td className="px-3 py-2.5 text-gray-600 truncate max-w-[140px]">{claim.carrier || "\u2014"}</td>
                            <td className="px-3 py-2.5 text-right text-xs tabular-nums font-medium text-[var(--navy)]">
                              {cRcv > 0 ? `$${cRcv.toLocaleString()}` : "\u2014"}
                            </td>
                            <td className="px-3 py-2.5 text-right text-xs tabular-nums text-gray-500">
                              {iRcv > 0 ? `$${iRcv.toLocaleString()}` : "\u2014"}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {isWon && movement > 0 ? (
                                <div>
                                  <span className="text-xs tabular-nums font-bold text-green-600">
                                    ${currentCarrier.toLocaleString()}
                                  </span>
                                  <div className="text-[10px] font-bold text-green-500 mt-0.5">
                                    +${movement.toLocaleString()} ({movementPct}%)
                                  </div>
                                </div>
                              ) : currentCarrier > 0 && currentCarrier !== iRcv ? (
                                <span className="text-xs tabular-nums text-gray-600">${currentCarrier.toLocaleString()}</span>
                              ) : (
                                <span className="text-xs text-gray-400">{"\u2014"}</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <div className="flex flex-col items-center gap-1">
                                {isWon ? (
                                  <div className="flex flex-col items-center">
                                    <span className="inline-block px-3 py-1 rounded-full text-xs font-black bg-green-500 text-white shadow-sm">
                                      WON
                                    </span>
                                    {movement > 0 && (
                                      <span className="text-[11px] font-bold text-green-600 mt-1">
                                        +${movement >= 1000 ? `${(movement / 1000).toFixed(0)}K` : movement.toLocaleString()}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[claim.status] || "bg-gray-100 text-gray-600"}`}>
                                    {isProcessing && (
                                      <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                      </svg>
                                    )}
                                    {claim.status === "needs_improvement" ? "Needs Improvement" : claim.status.charAt(0).toUpperCase() + claim.status.slice(1)}
                                  </span>
                                )}
                                {(claim.pending_edits ?? 0) > 0 && (
                                  <span className="text-[10px] text-amber-600 font-medium">{claim.pending_edits} edit{(claim.pending_edits ?? 0) > 1 ? "s" : ""}</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Expanded row detail panels */}
                {filteredClaims.map((claim) => (
                  expandedRow === claim.id ? (
                    <div key={`exp-${claim.id}`} className="px-6 pb-4 bg-gray-50/50 border-t border-gray-200">
                      {/* Source Files */}
                      <div className="grid grid-cols-5 gap-2 mt-3 mb-3">
                        {[
                          { label: "Measurements", files: claim.measurement_files, color: "bg-blue-50 text-blue-700 border-blue-200" },
                          { label: "Photos", files: claim.photo_files, color: "bg-purple-50 text-purple-700 border-purple-200" },
                          { label: "Scope", files: claim.scope_files, color: "bg-amber-50 text-amber-700 border-amber-200" },
                          { label: "Weather", files: claim.weather_files, color: "bg-teal-50 text-teal-700 border-teal-200" },
                          { label: "Other", files: claim.other_files, color: "bg-gray-100 text-gray-600 border-gray-200" },
                        ].map(({ label, files, color }) => (
                          <div key={label} className={`rounded-lg px-3 py-2 border ${color}`}>
                            <p className="text-xs font-bold">{files?.length ?? 0}</p>
                            <p className="text-[10px] font-medium opacity-70">{label}</p>
                          </div>
                        ))}
                      </div>

                      {/* Output Files */}
                      {claim.output_files && claim.output_files.length > 0 ? (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <p className="text-xs font-semibold text-green-800">Your claim package is ready</p>
                            <button
                              onClick={() => handleDownloadAllClaims(claim)}
                              className="bg-[var(--navy)] hover:bg-[var(--navy-light)] text-white px-3 py-1 rounded-lg text-[10px] font-medium transition-colors"
                            >
                              Download All
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {claim.output_files.map((file) => (
                              <button
                                key={file}
                                onClick={() => handleDownloadClaim(claim, file)}
                                disabled={downloading === file}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 hover:bg-green-100 disabled:opacity-50 text-green-700 text-xs font-semibold rounded-lg transition-colors border border-green-200"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M6 20h12a2 2 0 002-2V8l-6-6H6a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                </svg>
                                {file.replace(/_/g, " ").replace(".pdf", "")}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : claim.status === "processing" ? (
                        <div className="flex items-center gap-3 py-2">
                          <svg className="animate-spin w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <p className="text-xs text-amber-700">Analyzing documents... typically 2-5 minutes</p>
                        </div>
                      ) : claim.status === "error" ? (
                        <p className="text-xs text-red-600 py-2">Processing failed. Our team has been notified.</p>
                      ) : (
                        <p className="text-xs text-gray-400 py-2">No output files yet.</p>
                      )}
                    </div>
                  ) : null
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
