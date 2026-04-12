"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LanguageToggle } from "@/lib/i18n";

interface AdminNavProps {
  variant?: "full" | "minimal";
}

export function AdminNav({ variant = "full" }: AdminNavProps) {
  const pathname = usePathname();
  const supabase = createClient();
  const [qaCount, setQaCount] = useState(0);
  const [recCount, setRecCount] = useState(0);

  useEffect(() => {
    if (variant !== "full") return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/admin/queue-counts", { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) {
          setQaCount(body.qa_review_pending ?? 0);
          setRecCount(body.recommendations_pending ?? 0);
        }
      } catch {
        // silent — badge is optional polish
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [variant]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const navLinks: Array<{ href: string; label: string; badge?: number }> = [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/qa-review", label: "QA Review", badge: qaCount },
    { href: "/admin/agent-recommendations", label: "Improvements", badge: recCount },
    { href: "/admin/ma-dashboard", label: "M&A" },
    { href: "/admin/analytics", label: "Live Analytics" },
  ];

  return (
    <nav className="bg-[rgba(6,9,24,0.85)] backdrop-blur-[20px] border-b border-[var(--border-glass)] sticky top-0 z-50">
      <div className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/" className="flex items-center gap-3">
            <span className="text-2xl font-extrabold tracking-tight gradient-text">dumbroof<span className="font-normal opacity-70">.ai</span></span>
          </a>
          <span className="bg-amber-500/20 text-amber-400 text-xs font-semibold px-2 py-0.5 rounded-full ml-2">
            ADMIN
          </span>
        </div>
        <div className="flex items-center gap-4">
          {variant === "full" ? (
            <>
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className={`text-sm transition-colors relative inline-flex items-center gap-1.5 ${
                    pathname === link.href
                      ? "text-white font-semibold"
                      : "text-[var(--gray-dim)] hover:text-white"
                  }`}
                >
                  {link.label}
                  {link.badge && link.badge > 0 ? (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">
                      {link.badge > 99 ? "99+" : link.badge}
                    </span>
                  ) : null}
                </a>
              ))}
              <a href="/dashboard" className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors">
                My Dashboard
              </a>
              <LanguageToggle />
              <button onClick={handleSignOut} className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors">
                Sign Out
              </button>
            </>
          ) : (
            <a href="/admin" className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors">
              Back to Admin
            </a>
          )}
        </div>
      </div>
    </nav>
  );
}
