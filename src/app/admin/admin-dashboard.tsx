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

interface Stats {
  total: number;
  uploaded: number;
  processing: number;
  ready: number;
  error: number;
  uniqueUsers: number;
}

export function AdminDashboard() {
  const supabase = createClient();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    fetchClaims();
    const interval = setInterval(fetchClaims, 10000);
    return () => clearInterval(interval);
  }, [fetchClaims]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const statusColors: Record<string, string> = {
    uploaded: "bg-blue-100 text-blue-700",
    processing: "bg-amber-100 text-amber-700",
    ready: "bg-green-100 text-green-700",
    error: "bg-red-100 text-red-700",
  };

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
          <p className="text-gray-500 mt-1">All claims across all users.</p>
        </div>

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
      </div>
    </main>
  );
}
