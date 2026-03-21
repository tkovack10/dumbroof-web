"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Claim } from "@/types/claim";
import type { Repair } from "@/types/repair";
import { useBillingQuota } from "@/hooks/use-billing-quota";
import { LanguageToggle } from "@/lib/i18n";
import { ClaimsMap } from "@/components/claims-map";
import { RepairTabContent } from "./repair-tab-content";
import { Confetti } from "@/components/confetti";
import { useCountUp } from "@/hooks/use-count-up";

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
  const [showConfetti, setShowConfetti] = useState(false);
  const prevWinCountRef = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const billing = useBillingQuota();

  // Parallel fetch for claims (domain-shared) + repairs
  const fetchAll = useCallback(async () => {
    const [teamClaimsRes, repairsRes] = await Promise.all([
      fetch("/api/team-claims").then(r => r.json()).catch(() => ({ claims: [] })),
      supabase.from("repairs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]);
    const claimsRes = { data: teamClaimsRes.claims || [] };

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

  // Animated count-up for win banner
  const animatedMovement = useCountUp(totalMovement, 2000, 300);

  // Fire confetti when a NEW win appears (not on every render)
  useEffect(() => {
    if (wonClaims.length > prevWinCountRef.current && prevWinCountRef.current >= 0) {
      if (prevWinCountRef.current > 0 || (initialLoadDone && wonClaims.length > 0)) {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 100);
      }
    }
    prevWinCountRef.current = wonClaims.length;
  }, [wonClaims.length, initialLoadDone]);

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
    <main className="min-h-screen">
      <Confetti active={showConfetti} duration={5000} />
      {/* Top Bar */}
      <nav className="bg-[rgba(6,9,24,0.85)] backdrop-blur-[20px] border-b border-[var(--border-glass)] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <span className="text-2xl font-extrabold tracking-tight gradient-text">dumbroof<span className="font-normal opacity-70">.ai</span></span>
          </a>
          <div className="flex items-center gap-4">
            {/* Desktop nav links */}
            {navLinks.map(link => (
              <a
                key={link.href}
                href={link.href}
                className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors hidden sm:block relative"
              >
                {link.label}
                {link.hasDraftDot && (
                  <span className="absolute -top-1 -right-3 w-2 h-2 bg-red-500/100 rounded-full animate-pulse" />
                )}
                {link.hasEditDot && (
                  <span className="absolute -top-1 -right-6 w-2 h-2 bg-amber-500/100 rounded-full animate-pulse" />
                )}
              </a>
            ))}
            <span className="text-[var(--gray-dim)] text-sm hidden sm:block">
              {user.email}
              {billing?.planName && (
                <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-white/10 text-[var(--gray-dim)]">
                  {billing.planName}
                </span>
              )}
            </span>
            <LanguageToggle />
            <button
              onClick={handleSignOut}
              className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors hidden sm:block"
            >
              Sign Out
            </button>

            {/* Mobile hamburger */}
            <div className="relative sm:hidden" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="text-[var(--gray-dim)] hover:text-white p-1 transition-colors"
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
                <div className="absolute right-0 top-full mt-2 w-56 bg-[rgb(15,18,35)] border border-[var(--border-glass)] rounded-2xl shadow-2xl py-2 z-50">
                  {navLinks.map(link => (
                    <a
                      key={link.href}
                      href={link.href}
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2.5 text-sm text-[var(--gray)] hover:bg-white/[0.04] transition-colors"
                    >
                      {link.label}
                    </a>
                  ))}
                  <div className="border-t border-[var(--border-glass)] mt-1 pt-1">
                    <div className="px-4 py-2 text-xs text-[var(--gray-dim)]">
                      {user.email}
                      {billing?.planName && (
                        <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-white/[0.06] text-[var(--gray-muted)]">
                          {billing.planName}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => { setMenuOpen(false); handleSignOut(); }}
                      className="block w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-500/150/10 transition-colors"
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
            <h1 className="text-2xl font-bold gradient-text">Dashboard</h1>
            <p className="text-[var(--gray-muted)] mt-1 text-sm">
              {activeTab === "claims" ? "Upload documents and generate claim packages." : "Diagnose leaks and generate repair documents."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/dashboard/new-repair"
              className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-5 py-3 rounded-xl font-semibold transition-colors text-sm"
            >
              + New Repair
            </a>
            <a
              href="/dashboard/new-claim"
              className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-6 py-3 rounded-xl font-semibold transition-colors text-sm"
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
                ? "bg-gradient-to-r from-[var(--pink)] to-[var(--blue)] text-white"
                : "bg-transparent text-[var(--gray)] border border-[var(--border-glass)] hover:bg-white/[0.04]"
            }`}
          >
            Claims
            {claims.length > 0 && (
              <span className={`ml-2 ${activeTab === "claims" ? "text-white/70" : "text-[var(--gray-dim)]"}`}>
                {claims.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("repairs")}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              activeTab === "repairs"
                ? "bg-gradient-to-r from-[var(--pink)] to-[var(--blue)] text-white"
                : "bg-transparent text-[var(--gray)] border border-[var(--border-glass)] hover:bg-white/[0.04]"
            }`}
          >
            Repairs
            {repairs.length > 0 && (
              <span className={`ml-2 ${activeTab === "repairs" ? "text-white/70" : "text-[var(--gray-dim)]"}`}>
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
                <div className="glass-card p-4 text-center">
                  <p className="text-2xl font-bold gradient-text">{claims.length}</p>
                  <p className="text-xs text-[var(--gray-muted)] mt-1">Total Claims</p>
                </div>
                <div className="glass-card p-4 text-center">
                  <p className="text-2xl font-bold text-green-600">{readyCount}</p>
                  <p className="text-xs text-[var(--gray-muted)] mt-1">Ready</p>
                </div>
                <div className="glass-card p-4 text-center">
                  <p className="text-2xl font-bold text-amber-600">{processingCount}</p>
                  <p className="text-xs text-[var(--gray-muted)] mt-1">Processing</p>
                </div>
                <div className="glass-card p-4 text-center">
                  <p className="text-2xl font-bold text-green-600">{wonClaims.length}</p>
                  <p className="text-xs text-[var(--gray-muted)] mt-1">Wins</p>
                </div>
                <div className="glass-card p-4 text-center">
                  <p className="text-2xl font-bold gradient-text">{fmtMoney(totalContractorRcv)}</p>
                  <p className="text-xs text-[var(--gray-muted)] mt-1">Contractor RCV</p>
                </div>
                <div className="glass-card p-4 text-center">
                  <p className="text-2xl font-bold gradient-text">{fmtMoney(totalCarrierRcv)}</p>
                  <p className="text-xs text-[var(--gray-muted)] mt-1">Carrier RCV</p>
                </div>
                {totalMovement > 0 ? (
                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border-2 border-green-300 p-4 text-center col-span-2">
                    <p className="text-3xl font-black text-green-600">+{fmtMoney(totalMovement)}</p>
                    <p className="text-xs font-semibold text-green-600 mt-1">Carrier Movement</p>
                  </div>
                ) : (
                  <div className="glass-card p-4 text-center col-span-2">
                    <p className={`text-2xl font-bold ${totalContractorRcv - totalCarrierRcv > 0 ? "text-green-600" : "text-[var(--gray)]"}`}>
                      {fmtMoney(Math.abs(totalContractorRcv - totalCarrierRcv))}
                    </p>
                    <p className="text-xs text-[var(--gray-muted)] mt-1">Variance</p>
                  </div>
                )}
              </div>
            )}

            {/* Win Banner — Robinhood-style dopamine */}
            {!loading && wonClaims.length > 0 && (
              <div className="relative overflow-hidden rounded-2xl mb-6 shadow-[0_0_40px_rgba(34,197,94,0.25)]">
                {/* Animated gradient background */}
                <div className="absolute inset-0 bg-gradient-to-br from-green-600 via-emerald-500 to-green-400 animate-gradient-shift" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,rgba(255,255,255,0.15),transparent_60%)]" />

                <div className="relative p-8">
                  <div className="flex items-center justify-between flex-wrap gap-6">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
                          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
                          </svg>
                        </div>
                        <p className="text-sm font-bold text-white/80 uppercase tracking-[0.2em]">
                          Carrier Movement
                        </p>
                      </div>
                      <p className="text-5xl md:text-6xl font-black text-white tracking-tight tabular-nums">
                        +${animatedMovement.toLocaleString()}
                      </p>
                      <p className="text-sm text-white/70 mt-2 font-medium">
                        {wonClaims.length} claim{wonClaims.length > 1 ? "s" : ""} won — carriers moved after dumb roof analysis
                      </p>
                    </div>

                    <div className="flex flex-col gap-2">
                      {wonClaims.map(c => {
                        const orig = c.original_carrier_rcv ?? 0;
                        const updated = c.settlement_amount ?? 0;
                        const move = updated - orig;
                        const pct = orig > 0 ? Math.round((move / orig) * 100) : 0;
                        if (move <= 0) return null;
                        return (
                          <a
                            key={c.id}
                            href={`/dashboard/claim/${c.id}`}
                            className="group flex items-center gap-3 bg-white/10 hover:bg-white/20 backdrop-blur rounded-xl px-4 py-3 transition-all hover:scale-[1.02]"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-white text-sm truncate">{c.address?.split(",")[0]}</p>
                              <p className="text-xs text-white/60 mt-0.5 tabular-nums">
                                ${orig.toLocaleString()} → ${updated.toLocaleString()}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-lg font-black text-white tabular-nums">+${move.toLocaleString()}</p>
                              <p className="text-xs font-bold text-green-200">{pct}% increase</p>
                            </div>
                          </a>
                        );
                      })}
                    </div>
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
                        ? "bg-gradient-to-r from-[var(--pink)] to-[var(--blue)] text-white"
                        : "bg-transparent text-[var(--gray)] border border-[var(--border-glass)] hover:bg-white/[0.04]"
                    }`}
                  >
                    Table
                  </button>
                  <button
                    onClick={() => setViewMode("map")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      viewMode === "map"
                        ? "bg-gradient-to-r from-[var(--pink)] to-[var(--blue)] text-white"
                        : "bg-transparent text-[var(--gray)] border border-[var(--border-glass)] hover:bg-white/[0.04]"
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
                        ? "bg-gradient-to-r from-[var(--pink)] to-[var(--blue)] text-white"
                        : "bg-transparent text-[var(--gray)] border border-[var(--border-glass)] hover:bg-white/[0.04]"
                    }`}
                  >
                    {tab.label}
                    {tab.count != null && tab.count > 0 && (
                      <span className={`ml-1.5 ${statusFilter === tab.key ? "text-white/70" : "text-[var(--gray-dim)]"}`}>
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
              <div className="bg-[var(--bg-glass)] rounded-2xl border border-[var(--border-glass)] text-center py-16">
                <p className="text-[var(--gray-dim)] text-sm">Loading claims...</p>
              </div>
            ) : claims.length === 0 ? (
              <div className="bg-[var(--bg-glass)] rounded-2xl border border-[var(--border-glass)] text-center py-16 px-8">
                <div className="w-16 h-16 rounded-2xl bg-[var(--gray-50)] border-2 border-dashed border-[var(--border-glass)] flex items-center justify-center mx-auto mb-5">
                  <svg className="w-8 h-8 text-[var(--gray-dim)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-[var(--white)] mb-2">No claims yet</h3>
                <p className="text-[var(--gray-muted)] text-sm mb-6 max-w-md mx-auto">
                  Upload your measurements, inspection photos, and carrier scope to generate your first claim package.
                </p>
                <a href="/dashboard/new-claim" className="inline-block bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-8 py-3 rounded-xl font-semibold transition-colors text-sm">
                  Upload Documents
                </a>
              </div>
            ) : (
              <div className="glass-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/[0.06] text-left border-b border-[var(--border-glass)]">
                        <th className="px-3 py-3 text-[10px] font-semibold text-[var(--gray-dim)] uppercase">Property</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-[var(--gray-dim)] uppercase">Carrier</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-[var(--gray-dim)] uppercase text-right">Our Estimate</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-[var(--gray-dim)] uppercase text-right">Original Carrier</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-[var(--gray-dim)] uppercase text-right">Updated Carrier</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-[var(--gray-dim)] uppercase text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
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
                            className={`hover:bg-white/[0.04] transition-colors cursor-pointer ${isWon ? "bg-green-500/10 border-l-4 border-l-green-500 animate-won-glow" : ""}`}
                          >
                            <td className="px-3 py-2.5">
                              <a href={`/dashboard/claim/${claim.id}`} className="hover:underline" onClick={e => e.stopPropagation()}>
                                <p className="font-medium text-[var(--white)] truncate max-w-[220px]">{claim.address}</p>
                              </a>
                              <p className="text-[10px] text-[var(--gray-dim)] mt-0.5">{new Date(claim.created_at).toLocaleDateString()}</p>
                            </td>
                            <td className="px-3 py-2.5 text-[var(--gray)] truncate max-w-[140px]">{claim.carrier || "\u2014"}</td>
                            <td className="px-3 py-2.5 text-right text-xs tabular-nums font-medium text-[var(--white)]">
                              {cRcv > 0 ? `$${cRcv.toLocaleString()}` : "\u2014"}
                            </td>
                            <td className="px-3 py-2.5 text-right text-xs tabular-nums text-[var(--gray-muted)]">
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
                                <span className="text-xs tabular-nums text-[var(--gray)]">${currentCarrier.toLocaleString()}</span>
                              ) : (
                                <span className="text-xs text-[var(--gray-dim)]">{"\u2014"}</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <div className="flex flex-col items-center gap-1">
                                {isWon ? (
                                  <div className="flex flex-col items-center">
                                    <span className="inline-block px-4 py-1.5 rounded-full text-xs font-black bg-green-500 text-white shadow-[0_0_12px_rgba(34,197,94,0.5)] animate-pulse-subtle">
                                      WON
                                    </span>
                                    {movement > 0 && (
                                      <span className="text-sm font-black text-green-400 mt-1.5 tabular-nums">
                                        +${movement >= 1000 ? `${(movement / 1000).toFixed(1)}K` : movement.toLocaleString()}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[claim.status] || "bg-white/[0.06] text-[var(--gray)]"}`}>
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
                    <div key={`exp-${claim.id}`} className="px-6 pb-4 bg-white/[0.04]/50 border-t border-[var(--border-glass)]">
                      {/* Source Files */}
                      <div className="grid grid-cols-5 gap-2 mt-3 mb-3">
                        {[
                          { label: "Measurements", files: claim.measurement_files, color: "bg-blue-500/10 text-blue-700 border-blue-500/30" },
                          { label: "Photos", files: claim.photo_files, color: "bg-purple-500/10 text-purple-700 border-purple-500/30" },
                          { label: "Scope", files: claim.scope_files, color: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
                          { label: "Weather", files: claim.weather_files, color: "bg-teal-500/10 text-teal-700 border-teal-500/30" },
                          { label: "Other", files: claim.other_files, color: "bg-white/[0.06] text-[var(--gray)] border-[var(--border-glass)]" },
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
                              className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-3 py-1 rounded-lg text-[10px] font-medium transition-colors"
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
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 hover:bg-green-500/20 disabled:opacity-50 text-green-700 text-xs font-semibold rounded-lg transition-colors border border-green-500/30"
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
                        <p className="text-xs text-[var(--gray-dim)] py-2">No output files yet.</p>
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
