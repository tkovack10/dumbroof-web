"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface Claim {
  id: string;
  user_id: string;
  address: string;
  carrier: string;
  phase: string;
  status: string;
  output_files: string[] | null;
  created_at: string;
  user_email?: string;
}

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

type Tab = "claims" | "repairs" | "inspectors" | "beta";

export function AdminDashboard() {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<Tab>("claims");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [inspectors, setInspectors] = useState<InspectorApplication[]>([]);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [betaSignups, setBetaSignups] = useState<BetaSignup[]>([]);
  const [loading, setLoading] = useState(true);
  const [repairsLoading, setRepairsLoading] = useState(true);
  const [inspectorsLoading, setInspectorsLoading] = useState(true);
  const [betaLoading, setBetaLoading] = useState(true);
  const [reprocessing, setReprocessing] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>({
    total: 0, uploaded: 0, processing: 0, ready: 0, error: 0, uniqueUsers: 0
  });

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
    fetchClaims();
    const interval = setInterval(fetchClaims, 10000);
    return () => clearInterval(interval);
  }, [fetchClaims]);

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
  }, [activeTab, fetchRepairs, fetchInspectors, fetchBetaSignups]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

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
    no: "bg-gray-100 text-gray-600",
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

  return (
    <main className="min-h-screen bg-gray-50">
      <nav className="bg-[var(--navy)] border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white">DR</div>
            <span className="text-white font-bold text-lg tracking-tight">dumb roof<sup className="text-[9px] font-medium align-super ml-0.5">™</sup></span>
            <span className="bg-amber-500/20 text-amber-400 text-xs font-semibold px-2 py-0.5 rounded-full ml-2">ADMIN</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/dashboard" className="text-gray-400 hover:text-white text-sm transition-colors">My Dashboard</a>
            <button onClick={handleSignOut} className="text-gray-400 hover:text-white text-sm transition-colors">Sign Out</button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--navy)]">Admin Dashboard</h1>
          <p className="text-gray-500 mt-1">Manage claims and inspector applications.</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-8 bg-gray-100 rounded-xl p-1 w-fit">
          <button
            onClick={() => setActiveTab("claims")}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === "claims"
                ? "bg-white text-[var(--navy)] shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Claims
          </button>
          <button
            onClick={() => setActiveTab("repairs")}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
              activeTab === "repairs"
                ? "bg-white text-[var(--navy)] shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Repairs
            {repairErrorCount > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                {repairErrorCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("inspectors")}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
              activeTab === "inspectors"
                ? "bg-white text-[var(--navy)] shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Inspector Applications
            {pendingCount > 0 && (
              <span className="bg-amber-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("beta")}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
              activeTab === "beta"
                ? "bg-white text-[var(--navy)] shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Beta Signups
            {betaPendingCount > 0 && (
              <span className="bg-amber-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                {betaPendingCount}
              </span>
            )}
          </button>
        </div>

        {activeTab === "claims" && (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-8">
              {[
                { label: "Total Claims", value: stats.total, color: "text-[var(--navy)]" },
                { label: "Users", value: stats.uniqueUsers, color: "text-[var(--navy)]" },
                { label: "Uploaded", value: stats.uploaded, color: "text-blue-600" },
                { label: "Processing", value: stats.processing, color: "text-amber-600" },
                { label: "Ready", value: stats.ready, color: "text-green-600" },
                { label: "Errors", value: stats.error, color: "text-red-600" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-gray-500 mt-1">{label}</p>
                </div>
              ))}
            </div>

            {/* Claims Table */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              {loading ? (
                <div className="text-center py-16">
                  <p className="text-gray-400 text-sm">Loading all claims...</p>
                </div>
              ) : claims.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-gray-400 text-sm">No claims processed yet.</p>
                </div>
              ) : (
                <div>
                  <div className="px-6 py-3 bg-gray-50 grid grid-cols-12 gap-4 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    <div className="col-span-1">#</div>
                    <div className="col-span-3">Property</div>
                    <div className="col-span-2">Carrier</div>
                    <div className="col-span-2">User</div>
                    <div className="col-span-1">Phase</div>
                    <div className="col-span-1">Status</div>
                    <div className="col-span-2">Date</div>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {claims.map((claim, i) => (
                      <div key={claim.id} className="px-6 py-3 grid grid-cols-12 gap-4 items-center hover:bg-gray-50 transition-colors text-sm">
                        <div className="col-span-1 text-gray-400 text-xs">{claims.length - i}</div>
                        <div className="col-span-3">
                          <p className="font-medium text-[var(--navy)] truncate">{claim.address}</p>
                        </div>
                        <div className="col-span-2 text-gray-600 truncate">{claim.carrier}</div>
                        <div className="col-span-2 text-gray-400 text-xs truncate">{claim.user_id.slice(0, 8)}...</div>
                        <div className="col-span-1">
                          <span className="text-xs text-gray-500">
                            {claim.phase === "pre-scope" ? "Pre" : "Post"}
                          </span>
                        </div>
                        <div className="col-span-1">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[claim.status] || "bg-gray-100 text-gray-600"}`}>
                            {claim.status.charAt(0).toUpperCase() + claim.status.slice(1)}
                          </span>
                        </div>
                        <div className="col-span-2 text-gray-400 text-xs">
                          {new Date(claim.created_at).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
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
                { label: "Total Repairs", value: repairs.length, color: "text-[var(--navy)]" },
                { label: "Processing", value: repairs.filter(r => r.status === "processing").length, color: "text-amber-600" },
                { label: "Ready", value: repairs.filter(r => r.status === "ready").length, color: "text-green-600" },
                { label: "Errors", value: repairErrorCount, color: "text-red-600" },
                { label: "Revenue", value: `$${repairs.reduce((sum, r) => sum + (r.total_price || 0), 0).toLocaleString()}`, color: "text-emerald-600" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-gray-500 mt-1">{label}</p>
                </div>
              ))}
            </div>

            {/* Repairs Table */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              {repairsLoading ? (
                <div className="text-center py-16">
                  <p className="text-gray-400 text-sm">Loading repairs...</p>
                </div>
              ) : repairs.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-gray-400 text-sm">No repairs yet.</p>
                </div>
              ) : (
                <div>
                  <div className="px-6 py-3 bg-gray-50 grid grid-cols-12 gap-4 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    <div className="col-span-3">Address</div>
                    <div className="col-span-2">Homeowner</div>
                    <div className="col-span-1">Photos</div>
                    <div className="col-span-1">Status</div>
                    <div className="col-span-2">Error</div>
                    <div className="col-span-1">Price</div>
                    <div className="col-span-2">Date / Actions</div>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {repairs.map((repair) => (
                      <div key={repair.id} className="px-6 py-3 grid grid-cols-12 gap-4 items-center hover:bg-gray-50 transition-colors text-sm">
                        <div className="col-span-3">
                          <p className="font-medium text-[var(--navy)] truncate">{repair.address}</p>
                          <p className="text-xs text-gray-400 truncate">{repair.user_id.slice(0, 8)}...</p>
                        </div>
                        <div className="col-span-2 text-gray-600 truncate">{repair.homeowner_name}</div>
                        <div className="col-span-1 text-gray-500 text-xs">
                          {repair.photo_files?.length || 0}
                        </div>
                        <div className="col-span-1">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[repair.status] || "bg-gray-100 text-gray-600"}`}>
                            {repair.status.charAt(0).toUpperCase() + repair.status.slice(1)}
                          </span>
                        </div>
                        <div className="col-span-2">
                          {repair.error_message ? (
                            <p className="text-xs text-red-600 truncate" title={repair.error_message}>
                              {repair.error_message.slice(0, 80)}
                            </p>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </div>
                        <div className="col-span-1 text-gray-700 text-sm font-medium">
                          {repair.total_price ? `$${repair.total_price.toLocaleString()}` : "—"}
                        </div>
                        <div className="col-span-2 flex items-center gap-2">
                          <span className="text-xs text-gray-400">
                            {new Date(repair.created_at).toLocaleDateString()}
                          </span>
                          {repair.status === "error" && (
                            <button
                              onClick={() => reprocessRepair(repair.id)}
                              disabled={reprocessing === repair.id}
                              className="px-2 py-1 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-700 text-xs font-semibold rounded-lg transition-colors"
                            >
                              {reprocessing === repair.id ? "..." : "Reprocess"}
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

        {activeTab === "beta" && (
          <>
            {/* Beta Signup Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                { label: "Total Signups", value: betaSignups.length, color: "text-[var(--navy)]" },
                { label: "Pending", value: betaSignups.filter(s => s.status === "pending").length, color: "text-amber-600" },
                { label: "Approved", value: betaSignups.filter(s => s.status === "approved").length, color: "text-green-600" },
                { label: "Active", value: betaSignups.filter(s => s.status === "active").length, color: "text-emerald-600" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-gray-500 mt-1">{label}</p>
                </div>
              ))}
            </div>

            {/* Beta Signups Table */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              {betaLoading ? (
                <div className="text-center py-16">
                  <p className="text-gray-400 text-sm">Loading signups...</p>
                </div>
              ) : betaSignups.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-gray-400 text-sm">No beta signups yet.</p>
                </div>
              ) : (
                <div>
                  <div className="px-6 py-3 bg-gray-50 grid grid-cols-12 gap-4 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    <div className="col-span-2">Name</div>
                    <div className="col-span-2">Contact</div>
                    <div className="col-span-2">Company</div>
                    <div className="col-span-1">Role</div>
                    <div className="col-span-2">Products</div>
                    <div className="col-span-1">Status</div>
                    <div className="col-span-2">Actions</div>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {betaSignups.map((signup) => (
                      <div key={signup.id} className="px-6 py-4 grid grid-cols-12 gap-4 items-center hover:bg-gray-50 transition-colors text-sm">
                        <div className="col-span-2">
                          <p className="font-medium text-[var(--navy)]">{signup.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {new Date(signup.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-gray-700 truncate">{signup.email}</p>
                          {signup.phone && <p className="text-xs text-gray-400">{signup.phone}</p>}
                        </div>
                        <div className="col-span-2">
                          <p className="text-gray-700 truncate">{signup.company_name || "-"}</p>
                        </div>
                        <div className="col-span-1">
                          <span className="text-xs text-gray-600 font-medium">
                            {roleLabels[signup.role] || signup.role}
                          </span>
                        </div>
                        <div className="col-span-2">
                          <div className="flex flex-wrap gap-1">
                            {(signup.products || []).map((p) => (
                              <span key={p} className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--navy)]/10 text-[var(--navy)]">
                                {p === "claims_ai" ? "Claims" : p === "repair_ai" ? "Repair" : p}
                              </span>
                            ))}
                            {(!signup.products || signup.products.length === 0) && (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </div>
                        </div>
                        <div className="col-span-1">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${betaStatusColors[signup.status] || "bg-gray-100 text-gray-600"}`}>
                            {signup.status.charAt(0).toUpperCase() + signup.status.slice(1)}
                          </span>
                        </div>
                        <div className="col-span-2 flex gap-2">
                          {signup.status === "pending" && (
                            <>
                              <button
                                onClick={() => updateBetaStatus(signup.id, "approved")}
                                className="px-3 py-1 bg-green-50 hover:bg-green-100 text-green-700 text-xs font-semibold rounded-lg transition-colors"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => updateBetaStatus(signup.id, "rejected")}
                                className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold rounded-lg transition-colors"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {signup.status === "approved" && (
                            <button
                              onClick={() => sendBetaInvite(signup.id)}
                              disabled={inviting === signup.id}
                              className="px-3 py-1 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-700 text-xs font-semibold rounded-lg transition-colors"
                            >
                              {inviting === signup.id ? "Sending..." : "Send Invite"}
                            </button>
                          )}
                          {signup.status === "invited" && (
                            <button
                              onClick={() => updateBetaStatus(signup.id, "active")}
                              className="px-3 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-lg transition-colors"
                            >
                              Mark Active
                            </button>
                          )}
                          {(signup.status === "approved" || signup.status === "invited" || signup.status === "active" || signup.status === "rejected") && (
                            <button
                              onClick={() => updateBetaStatus(signup.id, "pending")}
                              className="px-3 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg transition-colors"
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
                { label: "Total Applications", value: inspectors.length, color: "text-[var(--navy)]" },
                { label: "Pending Review", value: inspectors.filter(i => i.status === "pending").length, color: "text-amber-600" },
                { label: "Approved", value: inspectors.filter(i => i.status === "approved").length, color: "text-green-600" },
                { label: "HAAG Certified", value: inspectors.filter(i => i.haag_certified === "yes").length, color: "text-yellow-700" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-gray-500 mt-1">{label}</p>
                </div>
              ))}
            </div>

            {/* Inspector Applications Table */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              {inspectorsLoading ? (
                <div className="text-center py-16">
                  <p className="text-gray-400 text-sm">Loading applications...</p>
                </div>
              ) : inspectors.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-gray-400 text-sm">No inspector applications yet.</p>
                </div>
              ) : (
                <div>
                  <div className="px-6 py-3 bg-gray-50 grid grid-cols-12 gap-4 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    <div className="col-span-2">Name</div>
                    <div className="col-span-2">Contact</div>
                    <div className="col-span-1">Location</div>
                    <div className="col-span-1">Exp</div>
                    <div className="col-span-1">HAAG</div>
                    <div className="col-span-2">Travel</div>
                    <div className="col-span-1">Status</div>
                    <div className="col-span-2">Actions</div>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {inspectors.map((app) => (
                      <div key={app.id} className="px-6 py-4 grid grid-cols-12 gap-4 items-center hover:bg-gray-50 transition-colors text-sm">
                        <div className="col-span-2">
                          <p className="font-medium text-[var(--navy)]">{app.name}</p>
                          {app.notes && (
                            <p className="text-xs text-gray-400 mt-0.5 truncate" title={app.notes}>{app.notes}</p>
                          )}
                        </div>
                        <div className="col-span-2">
                          <p className="text-gray-700 truncate">{app.email}</p>
                          <p className="text-xs text-gray-400">{app.phone}</p>
                        </div>
                        <div className="col-span-1">
                          <p className="text-gray-700">{app.city}</p>
                          <p className="text-xs text-gray-400 font-medium">{app.state}</p>
                        </div>
                        <div className="col-span-1 text-gray-600">{app.experience} yrs</div>
                        <div className="col-span-1">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${haagColors[app.haag_certified] || "bg-gray-100 text-gray-600"}`}>
                            {app.haag_certified === "yes" ? "HAAG" : app.haag_certified === "in-progress" ? "In Prog" : "No"}
                          </span>
                        </div>
                        <div className="col-span-2">
                          <p className="text-gray-600 text-xs">{travelLabels[app.willing_to_travel] || app.willing_to_travel}</p>
                        </div>
                        <div className="col-span-1">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${inspectorStatusColors[app.status] || "bg-gray-100 text-gray-600"}`}>
                            {app.status.charAt(0).toUpperCase() + app.status.slice(1)}
                          </span>
                        </div>
                        <div className="col-span-2 flex gap-2">
                          {app.status === "pending" && (
                            <>
                              <button
                                onClick={() => updateInspectorStatus(app.id, "approved")}
                                className="px-3 py-1 bg-green-50 hover:bg-green-100 text-green-700 text-xs font-semibold rounded-lg transition-colors"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => updateInspectorStatus(app.id, "rejected")}
                                className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold rounded-lg transition-colors"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {app.status === "approved" && (
                            <button
                              onClick={() => sendInspectorInvite(app.id)}
                              disabled={invitingInspector === app.id}
                              className="px-3 py-1 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-700 text-xs font-semibold rounded-lg transition-colors"
                            >
                              {invitingInspector === app.id ? "Sending..." : "Send Invite"}
                            </button>
                          )}
                          {app.status === "invited" && (
                            <button
                              onClick={() => updateInspectorStatus(app.id, "active")}
                              className="px-3 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-lg transition-colors"
                            >
                              Mark Active
                            </button>
                          )}
                          {(app.status === "approved" || app.status === "invited" || app.status === "active" || app.status === "rejected") && (
                            <button
                              onClick={() => updateInspectorStatus(app.id, "pending")}
                              className="px-3 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg transition-colors"
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
      </div>
    </main>
  );
}
