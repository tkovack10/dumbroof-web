"use client";

export default function CarriersPage() {
  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 pl-10 lg:pl-0">
          <h1 className="text-2xl font-bold gradient-text">Carrier Intelligence</h1>
          <p className="text-[var(--gray-muted)] mt-1 text-sm">
            Win rates, tactics, and intelligence per insurance carrier.
          </p>
        </div>
        <div className="glass-card p-12 text-center">
          <svg className="w-12 h-12 text-[var(--gray-dim)] mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
          </svg>
          <p className="text-lg font-semibold text-[var(--white)] mb-1">Carrier Intelligence — Coming Soon</p>
          <p className="text-sm text-[var(--gray-dim)]">
            Carrier-level analytics, win/loss patterns, adjuster profiles, and counter-argument effectiveness.
          </p>
        </div>
      </div>
    </div>
  );
}
