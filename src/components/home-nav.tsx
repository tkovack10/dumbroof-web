"use client";

import { useState, useRef, useEffect } from "react";

const NAV_LINKS = [
  { href: "#problem", label: "The Problem" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#repair", label: "Repair" },
  { href: "#results", label: "Results" },
  { href: "#inspectors", label: "Inspectors" },
  { href: "/integrations", label: "Integrations" },
  { href: "/learn", label: "Learn" },
  { href: "/pricing", label: "Pricing" },
  { href: "/pricing#faq", label: "FAQ" },
];

export function HomeNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[var(--bg-glass)]/95 backdrop-blur-sm border-b border-white/10">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <a href="/" className="flex items-center gap-3">
          <span className="text-2xl font-extrabold tracking-tight gradient-text">
            dumbroof<span className="font-normal opacity-70">.ai</span>
          </span>
        </a>
        <div className="flex items-center gap-6">
          {/* Desktop links */}
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors hidden sm:block"
            >
              {link.label}
            </a>
          ))}
          <a
            href="/login"
            className="text-[var(--gray-dim)] hover:text-white text-sm font-medium transition-colors hidden sm:block"
          >
            Sign In
          </a>
          <a
            href="/login?mode=signup"
            className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors hidden sm:block"
          >
            Try 3 Free Claims
          </a>

          {/* Mobile hamburger */}
          <div className="relative sm:hidden" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="text-[var(--gray-dim)] hover:text-white p-2 transition-colors"
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
                {NAV_LINKS.map((link) => (
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
                  <a
                    href="/login"
                    onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2.5 text-sm text-[var(--gray)] hover:bg-white/[0.04] transition-colors"
                  >
                    Sign In
                  </a>
                  <a
                    href="/login?mode=signup"
                    onClick={() => setMenuOpen(false)}
                    className="block mx-3 mt-1 mb-1 text-center bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] text-white px-4 py-2.5 rounded-xl text-sm font-semibold"
                  >
                    Try 3 Free Claims
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
