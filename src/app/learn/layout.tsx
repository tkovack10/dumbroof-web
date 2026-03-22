import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: "%s | dumbroof.ai Learn",
    default: "Learn — Roofing Insurance Claims & AI Technology | dumbroof.ai",
  },
  description:
    "Expert guides on roofing insurance claims, supplement strategies, building codes, and AI documentation technology. Learn how to maximize claim outcomes with forensic-grade evidence.",
};

export default function LearnLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Learn Nav */}
      <nav className="bg-[rgba(6,9,24,0.85)] backdrop-blur-[20px] border-b border-[var(--border-glass)] sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[var(--pink)] to-[var(--blue)] flex items-center justify-center font-bold text-white text-lg">
              DR
            </div>
            <span className="text-white font-bold text-xl tracking-tight">
              dumb roof<sup className="text-[10px] font-medium align-super ml-0.5">&trade;</sup>
            </span>
          </a>
          <div className="flex items-center gap-4">
            <a href="/learn" className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors">
              All Articles
            </a>
            <a href="/pricing" className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors">
              Pricing
            </a>
            <a
              href="/login?mode=signup"
              className="bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
            >
              Try Free
            </a>
          </div>
        </div>
      </nav>
      {children}
    </>
  );
}
