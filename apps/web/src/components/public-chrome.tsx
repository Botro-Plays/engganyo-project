'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, Menu, X } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { TelegramIcon } from '@/components/telegram-icon';

/**
 * Shared public-site chrome for the inner marketing/legal pages.
 * The landing page keeps its own hero-anchored navbar; this header uses
 * root-anchored links so they resolve correctly from any path.
 */

const NAV_LINKS: { href: string; label: string }[] = [
  { href: '/howitworks', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Contact' },
];

export function PublicHeader() {
  const [open, setOpen] = useState(false);

  return (
    <nav aria-label="Primary navigation" className="relative z-10 px-4 sm:px-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between py-4 sm:py-5">
        <Link
          href="/"
          aria-label="Engganyo home"
          className="flex items-center shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-sc"
        >
          <BrandLogo className="h-8 w-8 sm:h-9 sm:w-9" wordmarkClassName="text-xl sm:text-2xl" size={32} eager />
        </Link>

        <div className="hidden md:flex items-center gap-8 text-sm text-sc-dim">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="hover:text-sc-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="hidden sm:block text-sm text-sc-dim hover:text-sc-text transition-colors px-3 py-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="text-sm bg-brand-500 hover:bg-brand-600 text-sc-text px-3 py-2 sm:px-4 rounded-lg transition-colors font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-sc"
          >
            <span className="hidden sm:inline">Get started free</span>
            <span className="sm:hidden">Sign up</span>
          </Link>
          <button
            onClick={() => setOpen(!open)}
            className="md:hidden p-2 rounded-lg text-sc-dim hover:text-sc-text hover:bg-surface-hover transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden border-t border-surface-border pt-3 pb-4 space-y-0.5">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block px-3 py-2.5 rounded-lg text-sm text-sc-text hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="block px-3 py-2.5 rounded-lg text-sm text-sc-text hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Sign in
          </Link>
          <div className="pt-2 px-3">
            <Link
              href="/register"
              onClick={() => setOpen(false)}
              className="block text-center text-sm bg-brand-500 hover:bg-brand-600 text-sc-text px-4 py-2.5 rounded-lg transition-colors font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              Get started free
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}

/** Shared footer: identical links on every public page so crawlers and
 *  visitors see one consistent public navigation. Three grid groups
 *  (brand, community, nav) stack cleanly at narrow widths instead of
 *  squeezing into one desktop row. */
const FOOTER_LINK_CLS =
  'inline-flex items-center min-h-11 px-3 text-sm leading-5 text-sc-dim hover:text-sc-text transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

export function PublicFooter() {
  return (
    <footer className="relative z-10 border-t border-surface-border py-10 sm:py-12 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3 lg:gap-10 items-start">
        <div className="flex flex-col items-center gap-2 sm:items-start">
          <div className="flex items-center gap-2 min-h-11">
            <BrandLogo wordmark={false} className="w-6 h-6" size={24} />
            <span className="font-semibold text-sm leading-5 text-sc-text">Engganyo</span>
          </div>
          <p className="text-sc-dim text-sm leading-5 text-center sm:text-left">
            © {new Date().getFullYear()} Engganyo. All rights reserved.
          </p>
        </div>
        <nav aria-label="Community and contact" className="sm:justify-self-center lg:justify-self-start">
          <ul className="flex flex-wrap justify-center sm:justify-start items-center gap-x-1 gap-y-1">
            <li>
              <a
                href="https://t.me/Engganyo"
                target="_blank"
                rel="noopener noreferrer"
                className={`${FOOTER_LINK_CLS} gap-1.5 hover:text-accent-300 focus-visible:ring-accent-300`}
              >
                <TelegramIcon className="h-4 w-4 shrink-0" />
                Telegram
              </a>
            </li>
            <li>
              <a href="mailto:contact@engganyo.com" className={`${FOOTER_LINK_CLS} gap-1.5`}>
                <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="break-all">contact@engganyo.com</span>
              </a>
            </li>
          </ul>
        </nav>
        <nav aria-label="Footer navigation" className="sm:col-span-2 lg:col-span-1 sm:justify-self-center lg:justify-self-end">
          <ul className="flex flex-wrap justify-center lg:justify-end items-center gap-x-1 gap-y-1">
            <li><Link href="/howitworks" className={FOOTER_LINK_CLS}>How It Works</Link></li>
            <li><Link href="/pricing" className={FOOTER_LINK_CLS}>Pricing</Link></li>
            <li><Link href="/safety" className={FOOTER_LINK_CLS}>Safety</Link></li>
            <li><Link href="/blog" className={FOOTER_LINK_CLS}>Blog</Link></li>
            <li><Link href="/about" className={FOOTER_LINK_CLS}>About</Link></li>
            <li><Link href="/faq" className={FOOTER_LINK_CLS}>FAQ</Link></li>
            <li><Link href="/contact" className={FOOTER_LINK_CLS}>Contact</Link></li>
            <li><Link href="/privacy" className={FOOTER_LINK_CLS}>Privacy Policy</Link></li>
            <li><Link href="/terms" className={FOOTER_LINK_CLS}>Terms of Service</Link></li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
