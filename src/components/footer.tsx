import Link from "next/link";

export function Footer() {
  return (
    <footer className="bg-[rgba(6,9,24,0.85)] backdrop-blur-[20px] border-t border-white/10 py-8 px-6">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--pink)] to-[var(--blue)] flex items-center justify-center font-bold text-white text-sm">
            DR
          </div>
          <span className="text-[var(--gray-dim)] text-sm">
            Dumb Roof Technologies&trade;
          </span>
        </div>
        <div className="flex items-center gap-6">
          <Link
            href="/integrations"
            className="text-[var(--gray-muted)] hover:text-[var(--gray-dim)] text-sm transition-colors"
          >
            Integrations
          </Link>
          <Link
            href="/terms"
            className="text-[var(--gray-muted)] hover:text-[var(--gray-dim)] text-sm transition-colors"
          >
            Terms
          </Link>
          <Link
            href="/privacy"
            className="text-[var(--gray-muted)] hover:text-[var(--gray-dim)] text-sm transition-colors"
          >
            Privacy
          </Link>
          <Link
            href="/login"
            className="text-[var(--gray-muted)] hover:text-[var(--gray-dim)] text-sm transition-colors"
          >
            Sign In
          </Link>
        </div>
        <div className="text-center sm:text-right">
          <p className="text-[var(--gray-muted)] text-sm">
            &copy; {new Date().getFullYear()} Dumb Roof Technologies. All
            rights reserved.
          </p>
          <p className="text-[var(--gray)] text-xs mt-1">Patent Pending</p>
        </div>
      </div>
    </footer>
  );
}
