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

interface Stats {
  total: number;
  uploaded: number;
  processing: number;
  ready: number;
  error: number;
  uniqueUsers: number;
}

type Tab = "claims" | "inspectors";

export function AdminDashboard() {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<Tab>("claims");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [inspectors, setInspectors] = useState<InspectorApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [inspectorsLoading, setInspectorsLoading] = useState(true);
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

  const fetchInspectors = useCallback(async () => {
    setInspectorsLoading(true);
    const { data } = await supabase
      .from("inspector_applications")
      .select("*")
      .order("created_at", { ascending: false });

    setInspectors(data || []);
    setInspectorsLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchClaims();
    const interval = setInterval(fetchClaims, 10000);
    return () => clearInterval(interval);
  }, [fetchClaims]);

  useEffect(() => {
    if (activeTab === "inspectors") {
      fetchInspectors();
    }
  }, [activeTab, fetchInspectors]);

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

  const statusColors: Record<string, string> = {
    uploaded: "bg-blue-100 text-blue-700",
    processing: "bg-amber-100 text-amber-700",
    ready: "bg-green-100 text-green-700",
    error: "bg-red-100 text-red-700",
  };

  const inspectorStatusColors: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700",
    approved: "bg-green-100 text-green-700",
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

  const pendingCount = inspectors.filter(i => i.status === "pending").length;

  return (
    <main className="min-h-screen bg-gray-50">
      <nav className="bg-[var(--navy)] border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white">DR</div>
            <span className="text-white font-bold text-lg tracking-tight">dumb roof</span>
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
                              onClick={() => updateInspectorStatus(app.id, "pending")}
                              className="px-3 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg transition-colors"
                            >
                              Undo
                            </button>
                          )}
                          {app.status === "rejected" && (
                            <button
                              onClick={() => updateInspectorStatus(app.id, "pending")}
                              className="px-3 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg transition-colors"
                            >
                              Reconsider
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
