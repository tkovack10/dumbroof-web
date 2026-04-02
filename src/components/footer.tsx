import Link from "next/link";

export function Footer() {
  return (
    <footer className="bg-[rgba(6,9,24,0.85)] backdrop-blur-[20px] border-t border-white/10 py-12 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-8">
          {/* Product */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-dim)] mb-3">Product</p>
            <div className="space-y-2">
              <Link href="/pricing" className="block text-sm text-[var(--gray-muted)] hover:text-white transition-colors">Pricing</Link>
              <Link href="/integrations" className="block text-sm text-[var(--gray-muted)] hover:text-white transition-colors">Integrations</Link>
              <Link href="/inspection-club" className="block text-sm text-[var(--gray-muted)] hover:text-white transition-colors">Inspection Club</Link>
            </div>
          </div>

          {/* Learn */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-dim)] mb-3">Learn</p>
            <div className="space-y-2">
              <Link href="/learn/what-is-hail-damage" className="block text-sm text-[var(--gray-muted)] hover:text-white transition-colors">What Is Hail Damage?</Link>
              <Link href="/learn/what-is-wind-damage" className="block text-sm text-[var(--gray-muted)] hover:text-white transition-colors">What Is Wind Damage?</Link>
              <Link href="/learn/hail-damage-to-slate-roofs" className="block text-sm text-[var(--gray-muted)] hover:text-white transition-colors">Slate Roof Hail Damage</Link>
              <Link href="/learn/hail-damage-to-tpo-roofing" className="block text-sm text-[var(--gray-muted)] hover:text-white transition-colors">TPO Roof Hail Damage</Link>
              <Link href="/learn/hail-damage-to-epdm-roofing" className="block text-sm text-[var(--gray-muted)] hover:text-white transition-colors">EPDM Roof Hail Damage</Link>
            </div>
          </div>

          {/* Company */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-dim)] mb-3">Company</p>
            <div className="space-y-2">
              <Link href="/terms" className="block text-sm text-[var(--gray-muted)] hover:text-white transition-colors">Terms of Service</Link>
              <Link href="/privacy" className="block text-sm text-[var(--gray-muted)] hover:text-white transition-colors">Privacy Policy</Link>
              <a href="mailto:hello@dumbroof.ai" className="block text-sm text-[var(--gray-muted)] hover:text-white transition-colors">hello@dumbroof.ai</a>
            </div>
          </div>

          {/* Social */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-dim)] mb-3">Follow Us</p>
            <div className="space-y-2">
              <a href="https://www.tiktok.com/@dumbroof.ai" target="_blank" rel="noopener noreferrer" className="block text-sm text-[var(--gray-muted)] hover:text-white transition-colors">TikTok</a>
              <a href="https://www.instagram.com/dumbroofai" target="_blank" rel="noopener noreferrer" className="block text-sm text-[var(--gray-muted)] hover:text-white transition-colors">Instagram</a>
              <a href="https://www.facebook.com/DumbRoofAI" target="_blank" rel="noopener noreferrer" className="block text-sm text-[var(--gray-muted)] hover:text-white transition-colors">Facebook</a>
              <a href="https://x.com/DumbRoofAI" target="_blank" rel="noopener noreferrer" className="block text-sm text-[var(--gray-muted)] hover:text-white transition-colors">X / Twitter</a>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--pink)] to-[var(--blue)] flex items-center justify-center font-bold text-white text-sm">
              DR
            </div>
            <span className="text-[var(--gray-dim)] text-sm">
              Dumb Roof Technologies&trade;
            </span>
          </div>
          <div className="text-center sm:text-right">
            <p className="text-[var(--gray-muted)] text-sm">
              &copy; {new Date().getFullYear()} Dumb Roof Technologies. All rights reserved.
            </p>
            <p className="text-[var(--gray)] text-xs mt-1">Patent Pending</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
