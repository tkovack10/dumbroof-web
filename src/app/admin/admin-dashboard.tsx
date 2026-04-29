"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Claim } from "@/types/claim";
import { RichardLauncher } from "@/components/richard-launcher";

interface InspectorApplication {
  id: number;
  name: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  experience: string;
  haag_certified: string;
  willing_to_travel: string;
  notes: string | null;
  status: string;
  created_at: string;
}

interface Repair {
  id: string;
  user_id: string;
  address: string;
  homeowner_name: string;
  status: string;
  file_path: string;
  output_files: string[] | null;
  photo_files: string[] | null;
  created_at: string;
  repair_type: string | null;
  severity: string | null;
  total_price: number | null;
  error_message: string | null;
}

interface BetaSignup {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  company_name: string | null;
  role: string;
  products: string[];
  status: string;
  notes: string | null;
  created_at: string;
}

interface Stats {
  total: number;
  uploaded: number;
  processing: number;
  ready: number;
  error: number;
  uniqueUsers: number;
}

import { ClaimsMap } from "@/components/claims-map";

type Tab = "claims" | "repairs" | "inspectors" | "beta" | "companies" | "map";

interface CompanyRow {
  key: string;                   // company_id or solo admin user_id
  companyName: string;
  hasLogo: boolean;
  members: { userId: string; name: string; email: string; isAdmin: boolean }[];
  phone: string;
  claimsCount: number;
  planId: string | null;
  planStatus: string | null;
}

export function AdminDashboard({ userId }: { userId: string }) {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<Tab>("claims");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [inspectors, setInspectors] = useState<InspectorApplication[]>([]);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [betaSignups, setBetaSignups] = useState<BetaSignup[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [repairsLoading, setRepairsLoading] = useState(true);
  const [inspectorsLoading, setInspectorsLoading] = useState(true);
  const [betaLoading, setBetaLoading] = useState(true);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [reprocessing, setReprocessing] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [stats, setStats] = useState<Stats>({
    total: 0, uploaded: 0, processing: 0, ready: 0, error: 0, uniqueUsers: 0
  });

  const [userMap, setUserMap] = useState<Record<string, { name: string; email: string; phone: string; company: string }>>({});
  // email (lowercased) → company_name. Used in the Signups tab so each signup
  // row can show the user's CURRENT company (resolved from company_profiles
  // by email) — separate from `signup.company_name` which is the free-text
  // value the user typed at signup time.
  const [emailToCompany, setEmailToCompany] = useState<Record<string, string>>({});
  // claim_wins per-claim aggregates: forensic_approval / supplement counts
  const [claimWins, setClaimWins] = useState<Record<string, { forensic: number; supplement: number }>>({});
  // CLI claims (from claim_outcomes source=cli) — included in platform-wide
  // forensic + supplement totals so the admin numbers match the homepage hero
  // and don't undercount Tom's local-CLI workflow.
  const [cliWinsTotals, setCliWinsTotals] = useState<{ forensic: number; supplement: number; supplementDollars: number; settled: number; settledDollars: number }>({
    forensic: 0, supplement: 0, supplementDollars: 0, settled: 0, settledDollars: 0,
  });

  const fetchUserProfiles = useCallback(async () => {
    const map: Record<string, { name: string; email: string; phone: string; company: string }> = {};

    // 1. Company profiles (preferred — has company name + phone for direct outreach)
    const { data } = await supabase
      .from("company_profiles")
      .select("user_id, company_name, contact_name, email, phone");
    const emailMap: Record<string, string> = {};
    if (data) {
      for (const p of data) {
        map[p.user_id] = {
          name: p.contact_name || p.company_name || "Unknown",
          email: p.email || "",
          phone: p.phone || "",
          company: p.company_name || "",
        };
        if (p.email && p.company_name) {
          emailMap[p.email.toLowerCase()] = p.company_name;
        }
      }
    }
    setEmailToCompany(emailMap);

    // 2. Auth users fallback — fills in users without company profiles
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const authUsers: { id: string; email: string }[] = await res.json();
        for (const u of authUsers) {
          if (!map[u.id] && u.email) {
            map[u.id] = {
              name: u.email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
              email: u.email,
              phone: "",
              company: "",
            };
          }
        }
      }
    } catch {
      // Non-critical — company_profiles map still works
    }

    setUserMap(map);
  }, [supabase]);

  const fetchClaims = useCallback(async () => {
    const { data } = await supabase
      .from("claims")
      .select("*")
      .order("created_at", { ascending: false });

    const allClaims = data || [];
    setClaims(allClaims);

    const userIds = new Set(allClaims.map(c => c.user_id));
    setStats({
      total: allClaims.length,
      uploaded: allClaims.filter(c => c.status === "uploaded").length,
      processing: allClaims.filter(c => c.status === "processing").length,
      ready: allClaims.filter(c => c.status === "ready").length,
      error: allClaims.filter(c => c.status === "error").length,
      uniqueUsers: userIds.size,
    });

    setLoading(false);
  }, [supabase]);

  const fetchRepairs = useCallback(async () => {
    setRepairsLoading(true);
    const { data } = await supabase
      .from("repairs")
      .select("*")
      .order("created_at", { ascending: false });

    setRepairs(data || []);
    setRepairsLoading(false);
  }, [supabase]);

  const fetchInspectors = useCallback(async () => {
    setInspectorsLoading(true);
    const { data } = await supabase
      .from("inspector_applications")
      .select("*")
      .order("created_at", { ascending: false });

    setInspectors(data || []);
    setInspectorsLoading(false);
  }, [supabase]);

  const fetchCompanies = useCallback(async () => {
    setCompaniesLoading(true);
    try {
      // Pull company_profiles + subscriptions + claims in parallel
      const [profilesRes, subsRes, claimsCountRes] = await Promise.all([
        supabase
          .from("company_profiles")
          .select("user_id, company_id, company_name, contact_name, email, phone, logo_path, is_admin, role"),
        supabase
          .from("subscriptions")
          .select("user_id, company_id, plan_id, status"),
        supabase
          .from("claims")
          .select("user_id"),
      ]);

      const profiles = profilesRes.data || [];
      const subs = subsRes.data || [];
      const claimsRows = claimsCountRes.data || [];

      // Per-user claim counts (we'll roll up to company)
      const userClaimCounts = new Map<string, number>();
      for (const c of claimsRows) {
        userClaimCounts.set(c.user_id, (userClaimCounts.get(c.user_id) || 0) + 1);
      }

      // Group profiles into companies. Key:
      //   - profile.company_id when set
      //   - profile.user_id when company_id is NULL AND profile is an admin (solo)
      //   - profiles with NULL company_id and is_admin=false are orphans;
      //     fold each into its own pseudo-company (so they show up at all).
      const groups = new Map<string, typeof profiles>();
      for (const p of profiles) {
        const key = p.company_id || p.user_id;
        const existing = groups.get(key) || [];
        existing.push(p);
        groups.set(key, existing);
      }

      // Plan resolver: find any subscription tied to the company
      // (by company_id, OR by any member's user_id) — first non-canceled wins.
      const planFor = (members: typeof profiles): { planId: string | null; status: string | null } => {
        const memberIds = new Set(members.map((m) => m.user_id));
        const companyIds = new Set(members.map((m) => m.company_id).filter(Boolean));
        const candidates = subs.filter(
          (s) => (s.company_id && companyIds.has(s.company_id)) || memberIds.has(s.user_id)
        );
        const active = candidates.find((s) => s.status === "active" || s.status === "trialing")
          || candidates.find((s) => s.status === "past_due")
          || candidates[0];
        return active ? { planId: active.plan_id, status: active.status } : { planId: null, status: null };
      };

      // Pick the canonical "company representative" — admin if any, else
      // the first member. Used for company name + phone + logo.
      const rows: CompanyRow[] = [];
      for (const [key, members] of groups) {
        const admin = members.find((m) => m.is_admin) || members[0];
        const totalClaims = members.reduce((sum, m) => sum + (userClaimCounts.get(m.user_id) || 0), 0);
        const { planId, status: planStatus } = planFor(members);
        rows.push({
          key,
          companyName: admin.company_name || "(no company name)",
          hasLogo: Boolean(admin.logo_path),
          members: members.map((m) => ({
            userId: m.user_id,
            name: m.contact_name || m.email || "Unknown",
            email: m.email || "",
            isAdmin: !!m.is_admin,
          })),
          phone: admin.phone || "",
          claimsCount: totalClaims,
          planId,
          planStatus,
        });
      }

      // Order: most claims first, then by company name
      rows.sort((a, b) => b.claimsCount - a.claimsCount || a.companyName.localeCompare(b.companyName));
      setCompanies(rows);
    } finally {
      setCompaniesLoading(false);
    }
  }, [supabase]);

  const fetchBetaSignups = useCallback(async () => {
    setBetaLoading(true);
    const { data } = await supabase
      .from("beta_signups")
      .select("*")
      .order("created_at", { ascending: false });

    setBetaSignups(data || []);
    setBetaLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchUserProfiles();
    fetchClaims();
    // Populate forensic/supplement win aggregates — both per-claim (for badges)
    // and the CLI-side totals (for platform-wide stat tiles).
    (async () => {
      try {
        const [{ data: wins }, { data: cliRows }] = await Promise.all([
          supabase.from("claim_wins").select("claim_id, win_type, amount"),
          supabase.from("claim_outcomes").select("original_carrier_rcv, current_carrier_rcv, settlement_amount, win, source").eq("source", "cli"),
        ]);
        if (wins) {
          const agg: Record<string, { forensic: number; supplement: number }> = {};
          for (const w of wins) {
            const cid = w.claim_id as string;
            if (!agg[cid]) agg[cid] = { forensic: 0, supplement: 0 };
            if (w.win_type === "forensic_approval") agg[cid].forensic += 1;
            else if (w.win_type === "supplement") agg[cid].supplement += 1;
          }
          setClaimWins(agg);
        }
        if (cliRows) {
          let f = 0, s = 0, sd = 0, st = 0, std = 0;
          for (const r of cliRows) {
            const orig = (r.original_carrier_rcv as number | null) ?? 0;
            const cur = (r.current_carrier_rcv as number | null) ?? 0;
            const settle = (r.settlement_amount as number | null) ?? 0;
            if (orig > 0) f += 1;
            if (orig > 0 && cur > orig) { s += 1; sd += (cur - orig); }
            if (r.win) { st += 1; std += settle; }
          }
          setCliWinsTotals({ forensic: f, supplement: s, supplementDollars: sd, settled: st, settledDollars: std });
        }
      } catch { /* non-fatal */ }
    })();
    const interval = setInterval(fetchClaims, 30000);
    return () => clearInterval(interval);
  }, [fetchUserProfiles, fetchClaims]);

  useEffect(() => {
    if (activeTab === "repairs") {
      fetchRepairs();
    }
    if (activeTab === "inspectors") {
      fetchInspectors();
    }
    if (activeTab === "beta") {
      fetchBetaSignups();
    }
    if (activeTab === "companies") {
      fetchCompanies();
    }
  }, [activeTab, fetchRepairs, fetchInspectors, fetchBetaSignups, fetchCompanies]);

  const updateInspectorStatus = async (id: number, newStatus: string) => {
    await supabase
      .from("inspector_applications")
      .update({ status: newStatus })
      .eq("id", id);

    setInspectors(prev =>
      prev.map(app => app.id === id ? { ...app, status: newStatus } : app)
    );
  };

  const updateBetaStatus = async (id: number, newStatus: string) => {
    await supabase
      .from("beta_signups")
      .update({ status: newStatus })
      .eq("id", id);

    setBetaSignups(prev =>
      prev.map(s => s.id === id ? { ...s, status: newStatus } : s)
    );
  };

  const [inviting, setInviting] = useState<number | null>(null);

  const sendBetaInvite = async (id: number) => {
    setInviting(id);
    try {
      const res = await fetch("/api/beta-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to send invite");
        return;
      }
      setBetaSignups(prev =>
        prev.map(s => s.id === id ? { ...s, status: "invited" } : s)
      );
    } catch {
      alert("Failed to send invite");
    } finally {
      setInviting(null);
    }
  };

  const [invitingInspector, setInvitingInspector] = useState<number | null>(null);

  const sendInspectorInvite = async (id: number) => {
    setInvitingInspector(id);
    try {
      const res = await fetch("/api/inspector-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to send invite");
        return;
      }
      setInspectors(prev =>
        prev.map(a => a.id === id ? { ...a, status: "invited" } : a)
      );
    } catch {
      alert("Failed to send invite");
    } finally {
      setInvitingInspector(null);
    }
  };

  const reprocessRepair = async (id: string) => {
    setReprocessing(id);
    try {
      await supabase
        .from("repairs")
        .update({ status: "uploaded", error_message: null })
        .eq("id", id);
      setRepairs(prev =>
        prev.map(r => r.id === id ? { ...r, status: "uploaded", error_message: null } : r)
      );
    } catch {
      alert("Failed to reprocess repair");
    } finally {
      setReprocessing(null);
    }
  };

  const reprocessClaim = async (id: string) => {
    setReprocessing(id);
    try {
      await supabase
        .from("claims")
        .update({ status: "uploaded", error_message: null })
        .eq("id", id);
      setClaims(prev =>
        prev.map(c => c.id === id ? { ...c, status: "uploaded", error_message: null } : c)
      );
    } catch {
      alert("Failed to reprocess claim");
    } finally {
      setReprocessing(null);
    }
  };

  const handleDownload = async (filePath: string, outputFile: string) => {
    const key = `${filePath}/${outputFile}`;
    setDownloading(key);
    try {
      const path = `${filePath}/output/${outputFile}`;
      const { data, error } = await supabase.storage
        .from("claim-documents")
        .download(path);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = outputFile;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
      alert("Download failed");
    }
    setDownloading(null);
  };

  const betaStatusColors: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700",
    approved: "bg-green-100 text-green-700",
    invited: "bg-blue-100 text-blue-700",
    active: "bg-emerald-100 text-emerald-700",
    rejected: "bg-red-100 text-red-700",
  };

  const roleLabels: Record<string, string> = {
    sales_rep: "Sales Rep",
    public_adjuster: "Public Adjuster",
    attorney: "Attorney",
    appraiser: "Appraiser",
    contractor: "Contractor",
    owner: "Owner",
  };

  const statusColors: Record<string, string> = {
    uploaded: "bg-blue-100 text-blue-700",
    processing: "bg-amber-100 text-amber-700",
    ready: "bg-green-100 text-green-700",
    needs_improvement: "bg-orange-100 text-orange-700",
    error: "bg-red-100 text-red-700",
  };

  const inspectorStatusColors: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700",
    approved: "bg-green-100 text-green-700",
    invited: "bg-blue-100 text-blue-700",
    active: "bg-emerald-100 text-emerald-700",
    rejected: "bg-red-100 text-red-700",
  };

  const haagColors: Record<string, string> = {
    yes: "bg-yellow-100 text-yellow-800",
    "in-progress": "bg-blue-100 text-blue-700",
    no: "bg-white/[0.06] text-[var(--gray)]",
  };

  const travelLabels: Record<string, string> = {
    local: "Local (50mi)",
    regional: "Regional (150mi)",
    state: "Statewide",
    "multi-state": "Multi-State",
    nationwide: "Nationwide",
  };

  const repairErrorCount = repairs.filter(r => r.status === "error").length;
  const pendingCount = inspectors.filter(i => i.status === "pending").length;
  const betaPendingCount = betaSignups.filter(s => s.status === "pending").length;

  const filteredClaims = searchQuery
    ? claims.filter(c => {
        const q = searchQuery.toLowerCase();
        return (c.address || "").toLowerCase().includes(q)
          || (c.carrier || "").toLowerCase().includes(q)
          || (userMap[c.user_id]?.name || "").toLowerCase().includes(q)
          || (userMap[c.user_id]?.email || "").toLowerCase().includes(q);
      })
    : claims;

  return (
    <main className="min-h-screen">
      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="mb-8 flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--white)]">Admin Dashboard</h1>
            <p className="text-[var(--gray-muted)] mt-1">Manage claims and inspector applications.</p>
          </div>
          <div className="relative w-full max-w-md">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--gray-dim)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by address, carrier, or user..."
              className="w-full pl-10 pr-4 py-2.5 bg-[var(--bg-input)] border border-[var(--border-glass)] rounded-xl text-sm text-[var(--white)] placeholder-[var(--gray-dim)] focus:border-[var(--cyan)] focus:outline-none focus:ring-1 focus:ring-[var(--cyan)] backdrop-blur-sm transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--gray-dim)] hover:text-[var(--white)] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-8 bg-white/[0.06] rounded-xl p-1 w-fit">
          <button
            onClick={() => setActiveTab("claims")}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === "claims"
                ? "bg-[var(--bg-glass)] text-[var(--white)] shadow-sm"
                : "text-[var(--gray-muted)] hover:text-[var(--gray)]"
            }`}
          >
            Claims
          </button>
          <button
            onClick={() => setActiveTab("repairs")}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
              activeTab === "repairs"
                ? "bg-[var(--bg-glass)] text-[var(--white)] shadow-sm"
                : "text-[var(--gray-muted)] hover:text-[var(--gray)]"
            }`}
          >
            Repairs
            {repairErrorCount > 0 && (
              <span className="bg-red-500/100 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                {repairErrorCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("inspectors")}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
              activeTab === "inspectors"
                ? "bg-[var(--bg-glass)] text-[var(--white)] shadow-sm"
                : "text-[var(--gray-muted)] hover:text-[var(--gray)]"
            }`}
          >
            Inspector Applications
            {pendingCount > 0 && (
              <span className="bg-amber-500/100 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("beta")}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
              activeTab === "beta"
                ? "bg-[var(--bg-glass)] text-[var(--white)] shadow-sm"
                : "text-[var(--gray-muted)] hover:text-[var(--gray)]"
            }`}
          >
            Signups
            {betaPendingCount > 0 && (
              <span className="bg-amber-500/100 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                {betaPendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("companies")}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === "companies"
                ? "bg-[var(--bg-glass)] text-[var(--white)] shadow-sm"
                : "text-[var(--gray-muted)] hover:text-[var(--gray)]"
            }`}
          >
            Companies
          </button>
          <button
            onClick={() => setActiveTab("map")}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === "map"
                ? "bg-[var(--bg-glass)] text-[var(--white)] shadow-sm"
                : "text-[var(--gray-muted)] hover:text-[var(--gray)]"
            }`}
          >
            Map
          </button>
        </div>

        {activeTab === "claims" && (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-10 gap-3 mb-8">
              {(() => {
                const wonClaims = claims.filter(c => c.claim_outcome === "won");
                const totalContractorRcv = claims.reduce((s, c) => s + (c.contractor_rcv ?? 0), 0);
                const totalCarrierRcv = claims.reduce((s, c) => s + (c.current_carrier_rcv ?? c.original_carrier_rcv ?? 0), 0);
                const totalVariance = totalContractorRcv - totalCarrierRcv;
                const fmt = (v: number) => v >= 1000000 ? `$${(v / 1000000).toFixed(2)}M` : v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v.toFixed(0)}`;

                // Forensic + supplement wins — blend web (claim_wins table) with CLI
                // (from claim_outcomes source=cli, captured into cliWinsTotals).
                const webForensic = claims.filter(c => (claimWins[c.id]?.forensic ?? 0) > 0).length;
                const webSupplement = claims.filter(c => (claimWins[c.id]?.supplement ?? 0) > 0).length;
                const totalForensic = webForensic + cliWinsTotals.forensic;
                const totalSupplement = webSupplement + cliWinsTotals.supplement;

                return [
                  { label: "Total Claims", value: String(stats.total), color: "text-[var(--white)]" },
                  { label: "Users", value: String(stats.uniqueUsers), color: "text-[var(--white)]" },
                  { label: "Ready", value: String(stats.ready), color: "text-green-600" },
                  { label: "Processing", value: String(stats.processing), color: "text-amber-600" },
                  { label: "Contractor RCV", value: fmt(totalContractorRcv), color: "text-[var(--white)]" },
                  { label: "Carrier RCV", value: fmt(totalCarrierRcv), color: "text-[var(--white)]" },
                  { label: "Variance", value: fmt(totalVariance), color: totalVariance > 0 ? "text-green-600" : "text-red-600" },
                  { label: "🧠 Forensic Wins", value: String(totalForensic), color: "text-blue-400" },
                  { label: "📈 Supplement Wins", value: String(totalSupplement), color: "text-emerald-400" },
                  { label: "💰 Settled Wins", value: String(wonClaims.length + cliWinsTotals.settled), color: "text-green-600" },
                ];
              })().map(({ label, value, color }) => (
                <div key={label} className="glass-card p-4 text-center">
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-[var(--gray-muted)] mt-1">{label}</p>
                </div>
              ))}
            </div>

            {/* Claims Table — Google Sheet style */}
            <div className="glass-card overflow-hidden">
              {loading ? (
                <div className="text-center py-16">
                  <p className="text-[var(--gray-dim)] text-sm">Loading all claims...</p>
                </div>
              ) : claims.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-[var(--gray-dim)] text-sm">No claims processed yet.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/[0.04] text-left border-b border-white/[0.04]">
                        <th className="px-3 py-3 text-[10px] font-semibold text-[var(--gray-dim)] uppercase w-8">#</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-[var(--gray-dim)] uppercase">Property</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-[var(--gray-dim)] uppercase">Carrier</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-[var(--gray-dim)] uppercase">User</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-[var(--gray-dim)] uppercase text-right">Contractor RCV</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-[var(--gray-dim)] uppercase text-right">Carrier RCV</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-[var(--gray-dim)] uppercase text-right">Variance</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-[var(--gray-dim)] uppercase text-center">Phase</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-[var(--gray-dim)] uppercase text-center">Status</th>
                        <th className="px-3 py-3 text-[10px] font-semibold text-[var(--gray-dim)] uppercase">Date</th>
                        <th className="px-3 py-3 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                    {filteredClaims.map((claim, i) => (
                      <tr
                        key={claim.id}
                        onClick={() => { window.location.href = `/admin/claim/${claim.id}`; }}
                        className={`hover:bg-white/[0.04] transition-colors cursor-pointer ${claim.claim_outcome === "won" ? "bg-green-500/10/40" : ""}`}
                      >
                        <td className="px-3 py-2.5 text-[var(--gray-dim)] text-xs">{claims.length - i}</td>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-[var(--white)] truncate max-w-[200px]">{claim.address}</p>
                          {((claimWins[claim.id]?.forensic ?? 0) > 0 || (claimWins[claim.id]?.supplement ?? 0) > 0) && (
                            <div className="flex items-center gap-1 mt-1 flex-wrap">
                              {(claimWins[claim.id]?.forensic ?? 0) > 0 && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30" title="Forensic Win — carrier issued an approved scope after our forensic">🧠 Forensic</span>
                              )}
                              {(claimWins[claim.id]?.supplement ?? 0) > 0 && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" title="Supplement Win — carrier increased their number after our supplement">📈 Supplement</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-[var(--gray)] truncate max-w-[150px]">{claim.carrier || "—"}</td>
                        <td className="px-3 py-2.5 truncate max-w-[200px]">
                          <p className="text-[var(--gray)] text-xs font-medium">{userMap[claim.user_id]?.name || "—"}</p>
                          {userMap[claim.user_id]?.company && (
                            <p className="text-[var(--gray-muted)] text-[10px] truncate font-medium">🏢 {userMap[claim.user_id].company}</p>
                          )}
                          <p className="text-[var(--gray-dim)] text-[10px] truncate">{userMap[claim.user_id]?.email || ""}</p>
                          {userMap[claim.user_id]?.phone && (
                            <a
                              href={`tel:${userMap[claim.user_id].phone.replace(/[^0-9+]/g, "")}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-[var(--cyan)] text-[10px] hover:underline"
                              title="Click to call"
                            >
                              📞 {userMap[claim.user_id].phone}
                            </a>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs text-[var(--gray)] tabular-nums">
                          {claim.contractor_rcv ? `$${claim.contractor_rcv.toLocaleString()}` : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs text-[var(--gray)] tabular-nums">
                          {(claim.current_carrier_rcv ?? claim.original_carrier_rcv) ? `$${(claim.current_carrier_rcv ?? claim.original_carrier_rcv)!.toLocaleString()}` : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                          {(() => {
                            const cRcv = claim.contractor_rcv ?? 0;
                            const iRcv = claim.current_carrier_rcv ?? claim.original_carrier_rcv ?? 0;
                            if (!cRcv && !iRcv) return "—";
                            const v = cRcv - iRcv;
                            return <span className={v > 0 ? "text-green-700 font-medium" : v < 0 ? "text-red-600 font-medium" : "text-[var(--gray-muted)]"}>{v > 0 ? "+" : ""}${v.toLocaleString()}</span>;
                          })()}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="text-xs text-[var(--gray-muted)]">{claim.phase === "pre-scope" ? "Pre" : "Post"}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {claim.claim_outcome === "won" ? (
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">Won</span>
                          ) : (
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[claim.status] || "bg-white/[0.06] text-[var(--gray)]"}`}>
                              {claim.status.charAt(0).toUpperCase() + claim.status.slice(1)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-[var(--gray-dim)]">{new Date(claim.created_at).toLocaleDateString()}</span>
                            {(claim.status === "error" || claim.status === "processing") && (
                              <button
                                onClick={(e) => { e.stopPropagation(); reprocessClaim(claim.id); }}
                                disabled={reprocessing === claim.id}
                                className="px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 disabled:opacity-50 text-blue-700 text-xs font-semibold rounded-lg transition-colors"
                              >
                                {reprocessing === claim.id ? "..." : "Reprocess"}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); setExpandedRow(expandedRow === claim.id ? null : claim.id); }}
                            className="p-1 rounded hover:bg-white/[0.08] transition-colors"
                            title="Quick preview"
                          >
                            <svg className={`w-4 h-4 text-[var(--gray-dim)] transition-transform ${expandedRow === claim.id ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                    </tbody>
                  </table>
                  {/* Expanded row detail panel */}
                  {filteredClaims.map((claim) => (
                    expandedRow === claim.id ? (
                      <div key={`exp-${claim.id}`} className="px-6 pb-4 bg-white/[0.04]/50 border-t border-[var(--border-glass)]">
                        {claim.error_message && (
                          <p className="text-xs text-red-600 bg-red-500/10 rounded px-3 py-2 mt-2 mb-2 font-mono">
                            {claim.error_message}
                          </p>
                        )}
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
                              {files && files.length > 0 && (
                                <div className="mt-1 space-y-0.5">
                                  {files.slice(0, 3).map(f => (
                                    <p key={f} className="text-[10px] truncate opacity-60">{f}</p>
                                  ))}
                                  {files.length > 3 && <p className="text-[10px] opacity-40">+{files.length - 3} more</p>}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        {/* Output Files */}
                        {claim.output_files && claim.output_files.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {claim.output_files.map((file) => (
                              <button
                                key={file}
                                onClick={() => handleDownload(claim.file_path, file)}
                                disabled={downloading === `${claim.file_path}/${file}`}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 hover:bg-green-500/20 disabled:opacity-50 text-green-700 text-xs font-semibold rounded-lg transition-colors border border-green-500/30"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M6 20h12a2 2 0 002-2V8l-6-6H6a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                </svg>
                                {downloading === `${claim.file_path}/${file}` ? "..." : file.replace(/_/g, " ").replace(".pdf", "")}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-[var(--gray-dim)]">No output files yet.</p>
                        )}
                      </div>
                    ) : null
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "repairs" && (
          <>
            {/* Repair Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
              {[
                { label: "Total Repairs", value: repairs.length, color: "text-[var(--white)]" },
                { label: "Processing", value: repairs.filter(r => r.status === "processing").length, color: "text-amber-600" },
                { label: "Ready", value: repairs.filter(r => r.status === "ready").length, color: "text-green-600" },
                { label: "Errors", value: repairErrorCount, color: "text-red-600" },
                { label: "Revenue", value: `$${repairs.reduce((sum, r) => sum + (r.total_price || 0), 0).toLocaleString()}`, color: "text-emerald-600" },
              ].map(({ label, value, color }) => (
                <div key={label} className="glass-card p-4 text-center">
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-[var(--gray-muted)] mt-1">{label}</p>
                </div>
              ))}
            </div>

            {/* Repairs Table */}
            <div className="glass-card overflow-hidden">
              {repairsLoading ? (
                <div className="text-center py-16">
                  <p className="text-[var(--gray-dim)] text-sm">Loading repairs...</p>
                </div>
              ) : repairs.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-[var(--gray-dim)] text-sm">No repairs yet.</p>
                </div>
              ) : (
                <div>
                  <div className="px-6 py-3 bg-white/[0.04] grid grid-cols-12 gap-4 text-xs font-semibold text-[var(--gray-dim)] uppercase tracking-wider border-b border-white/[0.04]">
                    <div className="col-span-3">Address</div>
                    <div className="col-span-2">Homeowner</div>
                    <div className="col-span-1">Photos</div>
                    <div className="col-span-1">Status</div>
                    <div className="col-span-2">Error</div>
                    <div className="col-span-1">Price</div>
                    <div className="col-span-2">Date / Actions</div>
                  </div>
                  <div className="divide-y divide-white/[0.04]">
                    {repairs.map((repair) => (
                      <div key={repair.id}>
                        <div
                          onClick={() => setExpandedRow(expandedRow === repair.id ? null : repair.id)}
                          className="px-6 py-3 grid grid-cols-12 gap-4 items-center hover:bg-white/[0.04] transition-colors text-sm cursor-pointer"
                        >
                          <div className="col-span-3">
                            <p className="font-medium text-[var(--white)] truncate">{repair.address}</p>
                            <p className="text-xs text-[var(--gray-dim)] truncate">{userMap[repair.user_id]?.name || repair.user_id.slice(0, 8)}</p>
                          </div>
                          <div className="col-span-2 text-[var(--gray)] truncate">{repair.homeowner_name}</div>
                          <div className="col-span-1 text-[var(--gray-muted)] text-xs">
                            {repair.photo_files?.length || 0}
                          </div>
                          <div className="col-span-1">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[repair.status] || "bg-white/[0.06] text-[var(--gray)]"}`}>
                              {repair.status.charAt(0).toUpperCase() + repair.status.slice(1)}
                            </span>
                          </div>
                          <div className="col-span-2">
                            {repair.error_message ? (
                              <p className="text-xs text-red-600 truncate" title={repair.error_message}>
                                {repair.error_message.slice(0, 80)}
                              </p>
                            ) : (
                              <span className="text-xs text-[var(--gray-dim)]">—</span>
                            )}
                          </div>
                          <div className="col-span-1 text-[var(--gray)] text-sm font-medium">
                            {repair.total_price ? `$${repair.total_price.toLocaleString()}` : "—"}
                          </div>
                          <div className="col-span-2 flex items-center gap-2">
                            <span className="text-xs text-[var(--gray-dim)]">
                              {new Date(repair.created_at).toLocaleDateString()}
                            </span>
                            {(repair.status === "error" || repair.status === "processing") && (
                              <button
                                onClick={(e) => { e.stopPropagation(); reprocessRepair(repair.id); }}
                                disabled={reprocessing === repair.id}
                                className="px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 disabled:opacity-50 text-blue-700 text-xs font-semibold rounded-lg transition-colors"
                              >
                                {reprocessing === repair.id ? "..." : "Reprocess"}
                              </button>
                            )}
                          </div>
                        </div>
                        {expandedRow === repair.id && (
                          <div className="px-6 pb-4 bg-white/[0.04]/50 border-t border-white/[0.04]">
                            {repair.error_message && (
                              <p className="text-xs text-red-600 bg-red-500/10 rounded px-3 py-2 mt-2 mb-2 font-mono">
                                {repair.error_message}
                              </p>
                            )}
                            {repair.output_files && repair.output_files.length > 0 ? (
                              <div className="flex flex-wrap gap-2 mt-2">
                                {repair.output_files.map((file) => (
                                  <button
                                    key={file}
                                    onClick={() => handleDownload(repair.file_path, file)}
                                    disabled={downloading === `${repair.file_path}/${file}`}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 hover:bg-green-500/20 disabled:opacity-50 text-green-700 text-xs font-semibold rounded-lg transition-colors border border-green-500/30"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M6 20h12a2 2 0 002-2V8l-6-6H6a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                    </svg>
                                    {downloading === `${repair.file_path}/${file}` ? "..." : file.replace(/_/g, " ").replace(".pdf", "")}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-[var(--gray-dim)] mt-2">No output files yet.</p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "beta" && (
          <>
            {/* Beta Signup Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                { label: "Total Signups", value: betaSignups.length, color: "text-[var(--white)]" },
                { label: "Pending", value: betaSignups.filter(s => s.status === "pending").length, color: "text-amber-600" },
                { label: "Approved", value: betaSignups.filter(s => s.status === "approved").length, color: "text-green-600" },
                { label: "Active", value: betaSignups.filter(s => s.status === "active").length, color: "text-emerald-600" },
              ].map(({ label, value, color }) => (
                <div key={label} className="glass-card p-4 text-center">
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-[var(--gray-muted)] mt-1">{label}</p>
                </div>
              ))}
            </div>

            {/* Beta Signups Table */}
            <div className="glass-card overflow-hidden">
              {betaLoading ? (
                <div className="text-center py-16">
                  <p className="text-[var(--gray-dim)] text-sm">Loading signups...</p>
                </div>
              ) : betaSignups.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-[var(--gray-dim)] text-sm">No beta signups yet.</p>
                </div>
              ) : (
                <div>
                  <div className="px-6 py-3 bg-white/[0.04] grid grid-cols-12 gap-4 text-xs font-semibold text-[var(--gray-dim)] uppercase tracking-wider border-b border-white/[0.04]">
                    <div className="col-span-2">Name</div>
                    <div className="col-span-2">Contact</div>
                    <div className="col-span-2">Company</div>
                    <div className="col-span-1">Role</div>
                    <div className="col-span-2">Products</div>
                    <div className="col-span-1">Status</div>
                    <div className="col-span-2">Actions</div>
                  </div>
                  <div className="divide-y divide-white/[0.04]">
                    {betaSignups.map((signup) => (
                      <div key={signup.id} className="px-6 py-4 grid grid-cols-12 gap-4 items-center hover:bg-white/[0.04] transition-colors text-sm">
                        <div className="col-span-2">
                          <p className="font-medium text-[var(--white)]">{signup.name}</p>
                          <p className="text-xs text-[var(--gray-dim)] mt-0.5">
                            {new Date(signup.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-[var(--gray)] truncate">{signup.email}</p>
                          {signup.phone && <p className="text-xs text-[var(--gray-dim)]">{signup.phone}</p>}
                        </div>
                        <div className="col-span-2">
                          <p className="text-[var(--gray)] truncate">{signup.company_name || "-"}</p>
                          {(() => {
                            const platformCompany = emailToCompany[(signup.email || "").toLowerCase()];
                            if (!platformCompany) return null;
                            const matchesSelfReported = (signup.company_name || "").trim().toLowerCase() === platformCompany.trim().toLowerCase();
                            return (
                              <p className={`text-[10px] truncate mt-0.5 ${matchesSelfReported ? "text-[var(--gray-dim)]" : "text-emerald-400"}`} title={matchesSelfReported ? "Same as self-reported" : "Currently a member of this company on the platform"}>
                                🏢 {platformCompany}
                              </p>
                            );
                          })()}
                        </div>
                        <div className="col-span-1">
                          <span className="text-xs text-[var(--gray)] font-medium">
                            {roleLabels[signup.role] || signup.role}
                          </span>
                        </div>
                        <div className="col-span-2">
                          <div className="flex flex-wrap gap-1">
                            {(signup.products || []).map((p) => (
                              <span key={p} className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-white/[0.06] text-[var(--white)]">
                                {p === "claims_ai" ? "Claims" : p === "repair_ai" ? "Repair" : p}
                              </span>
                            ))}
                            {(!signup.products || signup.products.length === 0) && (
                              <span className="text-xs text-[var(--gray-dim)]">-</span>
                            )}
                          </div>
                        </div>
                        <div className="col-span-1">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${betaStatusColors[signup.status] || "bg-white/[0.06] text-[var(--gray)]"}`}>
                            {signup.status.charAt(0).toUpperCase() + signup.status.slice(1)}
                          </span>
                        </div>
                        <div className="col-span-2 flex gap-2">
                          {signup.status === "pending" && (
                            <>
                              <button
                                onClick={() => updateBetaStatus(signup.id, "approved")}
                                className="px-3 py-1 bg-green-500/10 hover:bg-green-500/20 text-green-700 text-xs font-semibold rounded-lg transition-colors"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => updateBetaStatus(signup.id, "rejected")}
                                className="px-3 py-1 bg-red-500/10 hover:bg-red-100 text-red-700 text-xs font-semibold rounded-lg transition-colors"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {signup.status === "approved" && (
                            <button
                              onClick={() => sendBetaInvite(signup.id)}
                              disabled={inviting === signup.id}
                              className="px-3 py-1 bg-blue-500/10 hover:bg-blue-500/20 disabled:opacity-50 text-blue-700 text-xs font-semibold rounded-lg transition-colors"
                            >
                              {inviting === signup.id ? "Sending..." : "Send Invite"}
                            </button>
                          )}
                          {signup.status === "invited" && (
                            <button
                              onClick={() => updateBetaStatus(signup.id, "active")}
                              className="px-3 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 text-xs font-semibold rounded-lg transition-colors"
                            >
                              Mark Active
                            </button>
                          )}
                          {(signup.status === "approved" || signup.status === "invited" || signup.status === "active" || signup.status === "rejected") && (
                            <button
                              onClick={() => updateBetaStatus(signup.id, "pending")}
                              className="px-3 py-1 bg-white/[0.04] hover:bg-white/[0.06] text-[var(--gray)] text-xs font-semibold rounded-lg transition-colors"
                            >
                              Undo
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "inspectors" && (
          <>
            {/* Inspector Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                { label: "Total Applications", value: inspectors.length, color: "text-[var(--white)]" },
                { label: "Pending Review", value: inspectors.filter(i => i.status === "pending").length, color: "text-amber-600" },
                { label: "Approved", value: inspectors.filter(i => i.status === "approved").length, color: "text-green-600" },
                { label: "HAAG Certified", value: inspectors.filter(i => i.haag_certified === "yes").length, color: "text-yellow-700" },
              ].map(({ label, value, color }) => (
                <div key={label} className="glass-card p-4 text-center">
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-[var(--gray-muted)] mt-1">{label}</p>
                </div>
              ))}
            </div>

            {/* Inspector Applications Table */}
            <div className="glass-card overflow-hidden">
              {inspectorsLoading ? (
                <div className="text-center py-16">
                  <p className="text-[var(--gray-dim)] text-sm">Loading applications...</p>
                </div>
              ) : inspectors.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-[var(--gray-dim)] text-sm">No inspector applications yet.</p>
                </div>
              ) : (
                <div>
                  <div className="px-6 py-3 bg-white/[0.04] grid grid-cols-12 gap-4 text-xs font-semibold text-[var(--gray-dim)] uppercase tracking-wider border-b border-white/[0.04]">
                    <div className="col-span-2">Name</div>
                    <div className="col-span-2">Contact</div>
                    <div className="col-span-1">Location</div>
                    <div className="col-span-1">Exp</div>
                    <div className="col-span-1">HAAG</div>
                    <div className="col-span-2">Travel</div>
                    <div className="col-span-1">Status</div>
                    <div className="col-span-2">Actions</div>
                  </div>
                  <div className="divide-y divide-white/[0.04]">
                    {inspectors.map((app) => (
                      <div key={app.id} className="px-6 py-4 grid grid-cols-12 gap-4 items-center hover:bg-white/[0.04] transition-colors text-sm">
                        <div className="col-span-2">
                          <p className="font-medium text-[var(--white)]">{app.name}</p>
                          {app.notes && (
                            <p className="text-xs text-[var(--gray-dim)] mt-0.5 truncate" title={app.notes}>{app.notes}</p>
                          )}
                        </div>
                        <div className="col-span-2">
                          <p className="text-[var(--gray)] truncate">{app.email}</p>
                          <p className="text-xs text-[var(--gray-dim)]">{app.phone}</p>
                        </div>
                        <div className="col-span-1">
                          <p className="text-[var(--gray)]">{app.city}</p>
                          <p className="text-xs text-[var(--gray-dim)] font-medium">{app.state}</p>
                        </div>
                        <div className="col-span-1 text-[var(--gray)]">{app.experience} yrs</div>
                        <div className="col-span-1">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${haagColors[app.haag_certified] || "bg-white/[0.06] text-[var(--gray)]"}`}>
                            {app.haag_certified === "yes" ? "HAAG" : app.haag_certified === "in-progress" ? "In Prog" : "No"}
                          </span>
                        </div>
                        <div className="col-span-2">
                          <p className="text-[var(--gray)] text-xs">{travelLabels[app.willing_to_travel] || app.willing_to_travel}</p>
                        </div>
                        <div className="col-span-1">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${inspectorStatusColors[app.status] || "bg-white/[0.06] text-[var(--gray)]"}`}>
                            {app.status.charAt(0).toUpperCase() + app.status.slice(1)}
                          </span>
                        </div>
                        <div className="col-span-2 flex gap-2">
                          {app.status === "pending" && (
                            <>
                              <button
                                onClick={() => updateInspectorStatus(app.id, "approved")}
                                className="px-3 py-1 bg-green-500/10 hover:bg-green-500/20 text-green-700 text-xs font-semibold rounded-lg transition-colors"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => updateInspectorStatus(app.id, "rejected")}
                                className="px-3 py-1 bg-red-500/10 hover:bg-red-100 text-red-700 text-xs font-semibold rounded-lg transition-colors"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {app.status === "approved" && (
                            <button
                              onClick={() => sendInspectorInvite(app.id)}
                              disabled={invitingInspector === app.id}
                              className="px-3 py-1 bg-blue-500/10 hover:bg-blue-500/20 disabled:opacity-50 text-blue-700 text-xs font-semibold rounded-lg transition-colors"
                            >
                              {invitingInspector === app.id ? "Sending..." : "Send Invite"}
                            </button>
                          )}
                          {app.status === "invited" && (
                            <button
                              onClick={() => updateInspectorStatus(app.id, "active")}
                              className="px-3 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 text-xs font-semibold rounded-lg transition-colors"
                            >
                              Mark Active
                            </button>
                          )}
                          {(app.status === "approved" || app.status === "invited" || app.status === "active" || app.status === "rejected") && (
                            <button
                              onClick={() => updateInspectorStatus(app.id, "pending")}
                              className="px-3 py-1 bg-white/[0.04] hover:bg-white/[0.06] text-[var(--gray)] text-xs font-semibold rounded-lg transition-colors"
                            >
                              Undo
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "companies" && (
          <>
            {/* Companies Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                { label: "Total Companies", value: companies.length, color: "text-[var(--white)]" },
                { label: "With Logo", value: companies.filter(c => c.hasLogo).length, color: "text-emerald-400" },
                { label: "Paid Plan", value: companies.filter(c => c.planId && c.planId !== "starter" && c.planStatus !== "canceled").length, color: "text-blue-400" },
                { label: "With Claims", value: companies.filter(c => c.claimsCount > 0).length, color: "text-amber-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="glass-card p-4 text-center">
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-[var(--gray-muted)] mt-1">{label}</p>
                </div>
              ))}
            </div>

            <div className="glass-card overflow-hidden">
              {companiesLoading ? (
                <div className="text-center py-16">
                  <p className="text-[var(--gray-dim)] text-sm">Loading companies...</p>
                </div>
              ) : companies.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-[var(--gray-dim)] text-sm">No companies yet.</p>
                </div>
              ) : (
                <div>
                  <div className="px-6 py-3 bg-white/[0.04] grid grid-cols-12 gap-4 text-xs font-semibold text-[var(--gray-dim)] uppercase tracking-wider border-b border-white/[0.04]">
                    <div className="col-span-3">Company</div>
                    <div className="col-span-1 text-center">Logo</div>
                    <div className="col-span-2">Users</div>
                    <div className="col-span-2">Phone</div>
                    <div className="col-span-1 text-center">Claims</div>
                    <div className="col-span-2">Plan</div>
                    <div className="col-span-1 text-center">Expand</div>
                  </div>
                  <div className="divide-y divide-white/[0.04]">
                    {companies.map((c) => {
                      const expanded = expandedCompany === c.key;
                      return (
                        <div key={c.key}>
                          <button
                            onClick={() => setExpandedCompany(expanded ? null : c.key)}
                            className="w-full px-6 py-4 grid grid-cols-12 gap-4 items-center hover:bg-white/[0.04] transition-colors text-sm text-left"
                          >
                            <div className="col-span-3">
                              <p className="font-semibold text-[var(--white)] truncate">{c.companyName}</p>
                              {c.members[0]?.email && (
                                <p className="text-xs text-[var(--gray-dim)] truncate">{c.members.find(m => m.isAdmin)?.email || c.members[0].email}</p>
                              )}
                            </div>
                            <div className="col-span-1 text-center">
                              {c.hasLogo
                                ? <span className="text-emerald-400 text-xs font-semibold">Yes</span>
                                : <span className="text-[var(--gray-dim)] text-xs">—</span>}
                            </div>
                            <div className="col-span-2">
                              <p className="text-[var(--gray)] text-xs font-medium">{c.members.length} {c.members.length === 1 ? "user" : "users"}</p>
                              <p className="text-[10px] text-[var(--gray-dim)] truncate">
                                {c.members.slice(0, 2).map(m => m.name).join(", ")}{c.members.length > 2 ? ` +${c.members.length - 2}` : ""}
                              </p>
                            </div>
                            <div className="col-span-2">
                              {c.phone ? (
                                <a
                                  href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[var(--cyan)] text-xs hover:underline"
                                >
                                  📞 {c.phone}
                                </a>
                              ) : (
                                <span className="text-[var(--gray-dim)] text-xs">—</span>
                              )}
                            </div>
                            <div className="col-span-1 text-center text-[var(--gray)] text-sm font-medium tabular-nums">{c.claimsCount}</div>
                            <div className="col-span-2">
                              {c.planId ? (
                                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                                  c.planStatus === "active" || c.planStatus === "trialing" ? "bg-emerald-500/15 text-emerald-300" :
                                  c.planStatus === "past_due" ? "bg-amber-500/15 text-amber-300" :
                                  c.planStatus === "canceled" ? "bg-red-500/15 text-red-300" :
                                  "bg-white/[0.06] text-[var(--gray)]"
                                }`}>
                                  {c.planId.charAt(0).toUpperCase() + c.planId.slice(1)}{c.planStatus && c.planStatus !== "active" ? ` · ${c.planStatus}` : ""}
                                </span>
                              ) : (
                                <span className="text-[var(--gray-dim)] text-xs">No subscription</span>
                              )}
                            </div>
                            <div className="col-span-1 text-center">
                              <svg className={`w-4 h-4 inline-block text-[var(--gray-dim)] transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </button>
                          {expanded && (
                            <div className="px-6 py-4 bg-white/[0.02] border-t border-white/[0.04]">
                              <p className="text-[10px] uppercase tracking-wider text-[var(--gray-dim)] mb-2">Members ({c.members.length})</p>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {c.members.map((m) => (
                                  <div key={m.userId} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white/[0.03]">
                                    <div className="min-w-0">
                                      <p className="text-sm text-[var(--white)] truncate">
                                        {m.name}
                                        {m.isAdmin && <span className="ml-2 text-[9px] uppercase tracking-wide text-amber-300">Admin</span>}
                                      </p>
                                      <p className="text-[10px] text-[var(--gray-dim)] truncate">{m.email}</p>
                                    </div>
                                    <span className="text-xs text-[var(--gray-muted)] tabular-nums shrink-0">
                                      {(claims.filter(cl => cl.user_id === m.userId).length)} claims
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "map" && (
          <div className="glass-card p-6">
            <h2 className="text-lg font-bold text-[var(--white)] mb-4">All Claims Map</h2>
            <ClaimsMap claims={claims} height="600px" showUserEmail />
          </div>
        )}
      </div>
      <RichardLauncher userId={userId} scope="company" />
    </main>
  );
}
