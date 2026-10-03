import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/** Old-site look: #0A0A1F bg + grid, white/10 panels, purple accent, micro-labels. */

export function Header() {
  return (
    <header className="border-b border-white/10">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4">
        <Link to="/" className="flex items-baseline gap-2">
          <span className="text-base font-black tracking-tighter text-white">Integrity</span>
          <span className="micro-label text-white/40">by 3Two Studios</span>
        </Link>
        <nav className="flex items-center gap-4 text-xs uppercase tracking-widest text-white/50">
          <Link to="/" className="hover:text-white">
            Scan
          </Link>
          <Link to="/methodology" className="hover:text-white">
            Methodology
          </Link>
          <Link to="/pricing" className="hover:text-white">
            Pricing
          </Link>
          <Link to="/self-audit" className="hover:text-white">
            Self-audit
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-white/10 px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-4 text-xs tracking-wide text-white/40">
        <p className="leading-relaxed">
          We list website claims and the public evidence for or against them. This is not a legal
          verdict, not a scam guarantee — it only checks public sources.
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 pt-4">
          <span>© 2026 3Two Studios</span>
          <Link to="/methodology" className="hover:text-white">
            Methodology
          </Link>
          <Link to="/pricing" className="hover:text-white">
            Pricing
          </Link>
          <Link to="/self-audit" className="hover:text-white">
            Self-audit
          </Link>
          <Link to="/terms" className="hover:text-white">
            Terms
          </Link>
          <Link to="/privacy" className="hover:text-white">
            Privacy
          </Link>
        </div>
      </div>
    </footer>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="grid-bg flex min-h-dvh flex-col bg-[#0A0A1F] text-white">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">{children}</main>
      <Footer />
    </div>
  );
}

/** Page heading in the old-site voice: micro-label kicker + display title. */
export function PageHeading({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <div className="rise-in">
      <p className="micro-label text-[#B57BE0]">{kicker}</p>
      <h1 className="mt-2 text-2xl font-black tracking-tighter text-white sm:text-3xl">
        {children}
      </h1>
    </div>
  );
}