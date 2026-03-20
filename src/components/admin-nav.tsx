"use client";

import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LanguageToggle } from "@/lib/i18n";

interface AdminNavProps {
  variant?: "full" | "minimal";
}

export function AdminNav({ variant = "full" }: AdminNavProps) {
  const pathname = usePathname();
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const navLinks = [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/ma-dashboard", label: "M&A" },
  ];

  return (
    <nav className="bg-[rgba(6,9,24,0.85)] backdrop-blur-[20px] border-b border-[var(--border-glass)] sticky top-0 z-50">
      <div className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--pink)] to-[var(--blue)] flex items-center justify-center font-bold text-white text-xs">
              DR
            </div>
            <span className="gradient-text font-bold text-lg tracking-tight">
              dumb roof<sup className="text-[9px] font-medium align-super ml-0.5">&trade;</sup>
            </span>
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
                  className={`text-sm transition-colors ${
                    pathname === link.href
                      ? "text-white font-semibold"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {link.label}
                </a>
              ))}
              <a href="/dashboard" className="text-gray-400 hover:text-white text-sm transition-colors">
                My Dashboard
              </a>
              <LanguageToggle />
              <button onClick={handleSignOut} className="text-gray-400 hover:text-white text-sm transition-colors">
                Sign Out
              </button>
            </>
          ) : (
            <a href="/admin" className="text-gray-400 hover:text-white text-sm transition-colors">
              Back to Admin
            </a>
          )}
        </div>
      </div>
    </nav>
  );
}
