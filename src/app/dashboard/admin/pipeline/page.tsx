"use client";

export default function PipelinePage() {
  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 pl-10 lg:pl-0">
          <h1 className="text-2xl font-bold gradient-text">Pipeline</h1>
          <p className="text-[var(--gray-muted)] mt-1 text-sm">
            Track claims through every stage from upload to payment.
          </p>
        </div>
        <div className="glass-card p-12 text-center">
          <svg className="w-12 h-12 text-[var(--gray-dim)] mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
          </svg>
          <p className="text-lg font-semibold text-[var(--white)] mb-1">Pipeline — Coming Soon</p>
          <p className="text-sm text-[var(--gray-dim)]">
            Kanban-style board with drag-and-drop claim management across lifecycle stages.
          </p>
        </div>
      </div>
    </div>
  );
}
