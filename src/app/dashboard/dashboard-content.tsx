"use client";

import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export function DashboardContent({ user }: { user: User }) {
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
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
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--navy)]">Dashboard</h1>
          <p className="text-gray-500 mt-1">
            Upload source documents and generate claim packages.
          </p>
        </div>

        {/* Upload Card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-[var(--gray-50)] border-2 border-dashed border-gray-300 flex items-center justify-center mx-auto mb-5">
            <svg
              className="w-8 h-8 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--navy)] mb-2">
            New Claim Package
          </h3>
          <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
            Upload your carrier scope, EagleView report, inspection photos, and
            HailTrace data. We&apos;ll generate your 5-document appeal package.
          </p>
          <button className="bg-[var(--red)] hover:bg-[var(--red-dark)] text-white px-8 py-3 rounded-xl font-semibold transition-colors text-sm">
            Upload Documents
          </button>
          <p className="text-xs text-gray-400 mt-3">
            Coming soon — file upload in next release
          </p>
        </div>

        {/* Recent Claims Placeholder */}
        <div className="bg-white rounded-2xl border border-gray-200 p-8">
          <h3 className="text-lg font-semibold text-[var(--navy)] mb-4">
            Recent Claims
          </h3>
          <div className="text-center py-10">
            <p className="text-gray-400 text-sm">
              No claims yet. Upload your first set of source documents to get
              started.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
