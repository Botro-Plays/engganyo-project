'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';

export function LandingNavbar() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="relative z-10 px-4 sm:px-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between py-4 sm:py-5">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-warm"
        >
          <img src="/logo-horizontal.svg" alt="Engganyo" className="h-8 sm:h-9" />
        </Link>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-8 text-sm text-surface-warm-muted">
          <Link href="#features" className="hover:text-surface-warm-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded">Features</Link>
          <Link href="#how-it-works" className="hover:text-surface-warm-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded">How it works</Link>
          <Link href="#about" className="hover:text-surface-warm-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded">About</Link>
        </div>

        {/* Right side — auth buttons + mobile toggle */}
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="hidden sm:block text-sm text-surface-warm-muted hover:text-surface-warm-ink transition-colors px-3 py-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="text-sm bg-brand-500 hover:bg-brand-600 text-white px-3 py-2 sm:px-4 rounded-lg transition-colors font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-warm"
          >
            <span className="hidden sm:inline">Get started free</span>
            <span className="sm:hidden">Sign up</span>
          </Link>
          <button
            onClick={() => setOpen(!open)}
            className="md:hidden p-2 rounded-lg text-surface-warm-muted hover:text-surface-warm-ink hover:bg-surface-warm-100 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden border-t border-surface-warm-border pt-3 pb-4 space-y-0.5 bg-surface-warm">
          <Link
            href="#features"
            onClick={() => setOpen(false)}
            className="block px-3 py-2.5 rounded-lg text-sm text-surface-warm-ink hover:bg-surface-warm-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Features
          </Link>
          <Link
            href="#how-it-works"
            onClick={() => setOpen(false)}
            className="block px-3 py-2.5 rounded-lg text-sm text-surface-warm-ink hover:bg-surface-warm-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            How it works
          </Link>
          <Link
            href="#about"
            onClick={() => setOpen(false)}
            className="block px-3 py-2.5 rounded-lg text-sm text-surface-warm-ink hover:bg-surface-warm-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            About
          </Link>
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="block px-3 py-2.5 rounded-lg text-sm text-surface-warm-ink hover:bg-surface-warm-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Sign in
          </Link>
          <div className="pt-2 px-3">
            <Link
              href="/register"
              onClick={() => setOpen(false)}
              className="block text-center text-sm bg-brand-500 hover:bg-brand-600 text-white px-4 py-2.5 rounded-lg transition-colors font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-warm"
            >
              Get started free
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
