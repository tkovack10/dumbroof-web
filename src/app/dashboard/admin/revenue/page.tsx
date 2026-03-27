"use client";

export default function RevenuePage() {
  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 pl-10 lg:pl-0">
          <h1 className="text-2xl font-bold gradient-text">Revenue &amp; A/R</h1>
          <p className="text-[var(--gray-muted)] mt-1 text-sm">
            Invoicing, accounts receivable, and revenue tracking.
          </p>
        </div>
        <div className="glass-card p-12 text-center">
          <svg className="w-12 h-12 text-[var(--gray-dim)] mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-lg font-semibold text-[var(--white)] mb-1">Revenue &amp; A/R — Coming Soon</p>
          <p className="text-sm text-[var(--gray-dim)]">
            Revenue dashboards, invoice tracking, aging reports, and payment reconciliation.
          </p>
        </div>
      </div>
    </div>
  );
}
