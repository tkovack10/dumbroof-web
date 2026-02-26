"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

interface Claim {
  id: string;
  address: string;
  carrier: string;
  phase: string;
  status: string;
  created_at: string;
}

export function DashboardContent({ user }: { user: User }) {
  const supabase = createClient();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchClaims() {
      const { data } = await supabase
        .from("claims")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setClaims(data || []);
      setLoading(false);
    }
    fetchClaims();
  }, [user.id, supabase]);

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
      {/* Top Bar */}
      <nav className="bg-[var(--navy)] border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white">
              DR
            </div>
            <span className="text-white font-bold text-lg tracking-tight">
              dumb roof
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-gray-400 text-sm hidden sm:block">
              {user.email}
            </span>
            <button
              onClick={handleSignOut}
              className="text-gray-400 hover:text-white text-sm transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      {/* Dashboard */}
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[var(--navy)]">Dashboard</h1>
            <p className="text-gray-500 mt-1">
              Upload documents and generate claim packages.
            </p>
          </div>
          <a
            href="/dashboard/new-claim"
            className="bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-6 py-3 rounded-xl font-semibold transition-colors text-sm"
          >
            + New Claim
          </a>
        </div>

        {/* Claims List */}
        <div className="bg-white rounded-2xl border border-gray-200">
          {loading ? (
            <div className="text-center py-16">
              <p className="text-gray-400 text-sm">Loading claims...</p>
            </div>
          ) : claims.length === 0 ? (
            <div className="text-center py-16 px-8">
              <div className="w-16 h-16 rounded-2xl bg-[var(--gray-50)] border-2 border-dashed border-gray-300 flex items-center justify-center mx-auto mb-5">
                <svg
                  className="w-8 h-8 text-gray-300"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-[var(--navy)] mb-2">
                No claims yet
              </h3>
              <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
                Upload your measurements, inspection photos, and carrier scope
                to generate your first claim package.
              </p>
              <a
                href="/dashboard/new-claim"
                className="inline-block bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-8 py-3 rounded-xl font-semibold transition-colors text-sm"
              >
                Upload Documents
              </a>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              <div className="px-6 py-3 bg-gray-50 rounded-t-2xl grid grid-cols-12 gap-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                <div className="col-span-5">Property</div>
                <div className="col-span-3">Carrier</div>
                <div className="col-span-2">Phase</div>
                <div className="col-span-2">Status</div>
              </div>
              {claims.map((claim) => (
                <div
                  key={claim.id}
                  className="px-6 py-4 grid grid-cols-12 gap-4 items-center hover:bg-gray-50 transition-colors"
                >
                  <div className="col-span-5">
                    <p className="text-sm font-medium text-[var(--navy)]">
                      {claim.address}
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(claim.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="col-span-3 text-sm text-gray-600">
                    {claim.carrier}
                  </div>
                  <div className="col-span-2">
                    <span className="text-xs font-medium text-gray-500">
                      {claim.phase === "pre-scope" ? "Pre-Scope" : "Supplement"}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span
                      className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${
                        statusColors[claim.status] || "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {claim.status.charAt(0).toUpperCase() +
                        claim.status.slice(1)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
