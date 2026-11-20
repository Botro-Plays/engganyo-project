import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Upload,
  ExternalLink,
  Users,
  Shield,
  Megaphone,
  ChevronRight,
} from 'lucide-react';
import { LandingNavbar } from '@/components/landing-navbar';
import { PlatformIcon } from '@/components/platform-icon';
import { BrandLogo } from '@/components/brand-logo';
import { TelegramIcon } from '@/components/telegram-icon';

// Server-rendered JSON-LD — a plain <script type="application/ld+json">
// lands in the raw HTML for non-JS crawlers (next/script injects only
// into the RSC payload). sameAs lists only verified official profiles;
// no SearchAction (the /search target is an authenticated app route).
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://engganyo.com/#organization',
      name: 'Engganyo',
      url: 'https://engganyo.com/',
      logo: {
        '@type': 'ImageObject',
        url: 'https://engganyo.com/brand/web-logo-circle.png',
      },
      description:
        'Engganyo is a creator growth platform where creators complete social tasks for each other, earn credits, and grow their audience through community-driven engagement.',
      sameAs: ['https://t.me/Engganyo'],
    },
    {
      '@type': 'WebSite',
      '@id': 'https://engganyo.com/#website',
      url: 'https://engganyo.com/',
      name: 'Engganyo',
      description: 'Small Taps. Big Crowds. Grow your social presence through real human engagement.',
      inLanguage: 'en',
      publisher: { '@id': 'https://engganyo.com/#organization' },
    },
    {
      '@type': 'WebApplication',
      '@id': 'https://engganyo.com/#app',
      name: 'Engganyo',
      url: 'https://engganyo.com/',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Any (web browser)',
      description:
        'Task marketplace where creators earn credits by completing social tasks and spend credits on campaigns to grow their own audience.',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        description: 'Free to join',
      },
      publisher: { '@id': 'https://engganyo.com/#organization' },
    },
    {
      '@type': 'WebPage',
      '@id': 'https://engganyo.com/#webpage',
      url: 'https://engganyo.com/',
      name: 'Engganyo — Small Taps. Big Crowds.',
      isPartOf: { '@id': 'https://engganyo.com/#website' },
      about: { '@id': 'https://engganyo.com/#app' },
      inLanguage: 'en',
    },
  ],
};

export const metadata: Metadata = {
  alternates: { canonical: 'https://engganyo.com' },
};

interface PublicStats {
  totalUsers: number;
  totalTaskCompletions: number;
  totalCountries: number;
}

async function getPublicStats(): Promise<PublicStats | null> {
  try {
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(/\/+$/, '');
    const fetchP = fetch(`${apiUrl}/analytics/public-stats`, {
      next: { revalidate: 3600 },
    });
    const timeoutP = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('stats timeout')), 3000),
    );
    const res = await Promise.race([fetchP, timeoutP]);
    if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as {
      data?: {
        totalUsers?: number;
        totalTaskCompletions?: number;
        totalVerifiedTasks?: number;
        totalCountries?: number;
      };
    };
    const d = json.data ?? {};
    return {
      totalUsers: d.totalUsers ?? 0,
      totalTaskCompletions: d.totalTaskCompletions ?? d.totalVerifiedTasks ?? 0,
      totalCountries: d.totalCountries ?? 0,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    if (process.env.NODE_ENV === 'development') console.error('Landing stats fetch failed:', err);
    return null;
  }
}

export default async function LandingPage() {
  const stats = await getPublicStats();
  return (
    <>
      <script
        id="json-ld"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="relative min-h-screen bg-sc text-sc-text overflow-x-hidden">
        {/* Hero gradient */}
        <div className="absolute inset-0 bg-gradient-hero pointer-events-none" />

        {/* Navbar */}
        <LandingNavbar />

        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="relative z-10 pt-12 pb-20 sm:pt-16 sm:pb-28 px-4 sm:px-6 max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left — headline + CTA */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-brand-500/30 bg-brand-500/10 text-brand-300 text-xs font-medium mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
                Community-powered · Real humans only
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-5">
                Small Taps.
                <br />
                <span className="text-gradient">Big Crowds.</span>
              </h1>

              <p className="text-base sm:text-lg text-sc-muted leading-relaxed mb-8 max-w-lg">
                Complete social tasks for other creators, earn credits, then use them to grow your own audience.
                Every interaction is verified by a human — no bots, no fake engagement.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 mb-8">
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 text-sc-text px-7 py-3.5 rounded-xl font-semibold transition-all hover:scale-[1.02] shadow-lg shadow-brand-500/25 text-sm sm:text-base"
                >
                  Start earning free
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href="#how-it-works"
                  className="inline-flex items-center justify-center gap-2 text-sc-muted hover:text-sc-text px-7 py-3.5 rounded-xl border border-surface-border hover:border-sc-line transition-all text-sm sm:text-base"
                >
                  How it works
                </Link>
                <a
                  href="https://t.me/Engganyo"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tg-hero-cta relative inline-flex items-center justify-center gap-2 text-accent-300 hover:text-accent-200 px-7 py-3.5 rounded-xl border border-accent-500/40 hover:border-accent-400/60 hover:bg-accent-500/10 transition-all text-sm sm:text-base min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300"
                >
                  <span className="tg-hero-shine" aria-hidden="true" />
                  <span className="tg-hero-icon">
                    <TelegramIcon className="w-4 h-4" />
                  </span>
                  Join us on Telegram
                </a>
              </div>

              {/* Social proof */}
              {stats && (
                <div className="flex flex-wrap gap-5 text-sc-dim text-sm">
                  <span>
                    <strong className="text-sc-text tabular-nums">{stats.totalUsers.toLocaleString()}+</strong>{' '}
                    creators joined
                  </span>
                  <span>
                    <strong className="text-sc-text tabular-nums">{stats.totalTaskCompletions.toLocaleString()}+</strong>{' '}
                    tasks verified
                  </span>
                  <span>
                    <strong className="text-sc-text tabular-nums">{stats.totalCountries}+</strong>{' '}
                    countries
                  </span>
                </div>
              )}
            </div>

            {/* Right — live task card mock */}
            <div className="relative lg:flex lg:justify-end" aria-hidden="true">
              {/* Glow behind card */}
              <div className="absolute -inset-8 bg-brand-500/10 rounded-3xl blur-3xl" />
              <div className="relative w-full max-w-sm mx-auto lg:mx-0">
                {/* Task card mock */}
                <div className="bg-surface-card border border-surface-border rounded-2xl p-5 shadow-2xl">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium bg-accent-500/15 text-accent-300 border border-accent-500/20">
                      TikTok · Follow
                    </span>
                    <span className="text-sm font-bold text-green-400 shrink-0">+15 credits</span>
                  </div>
                  {/* Title */}
                  <p className="text-sm font-semibold text-sc-text mb-1">Follow @artbyjamie — TikTok art creator</p>
                  {/* URL mock */}
                  <p className="text-xs text-sc-dim mb-3 flex items-center gap-1 truncate">
                    <ExternalLink className="w-3 h-3 shrink-0" />
                    tiktok.com/@artbyjamie
                  </p>
                  {/* Proof requirement */}
                  <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-2">
                    <p className="text-[11px] font-medium text-amber-300 flex items-center gap-1">
                      <Upload className="w-3 h-3 shrink-0" />
                      Proof required: screenshot showing you followed
                    </p>
                  </div>
                  {/* Slots */}
                  <div className="flex items-center justify-between text-xs text-sc-dim mb-4">
                    <span>8 slots left</span>
                    <span>Manual review</span>
                  </div>
                  {/* Accept button */}
                  <button
                    tabIndex={-1}
                    className="w-full flex items-center justify-center gap-1.5 min-h-11 py-2.5 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 text-sm font-medium"
                  >
                    Accept task
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Journey steps floating below */}
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  {[
                    { step: '1', label: 'Accept', icon: CheckCircle2, color: 'text-brand-300' },
                    { step: '2', label: 'Open & do', icon: ExternalLink, color: 'text-accent-300' },
                    { step: '3', label: 'Submit proof', icon: Upload, color: 'text-amber-300' },
                  ].map(({ step, label, icon: Icon, color }) => (
                    <div key={step} className="bg-surface-card border border-surface-border rounded-xl px-2 py-3">
                      <Icon className={`w-4 h-4 mx-auto mb-1.5 ${color}`} />
                      <p className="text-[11px] text-sc-muted">{label}</p>
                    </div>
                  ))}
                </div>

                {/* Credits awarded callout */}
                <div className="mt-2 flex items-center justify-center gap-2 py-2.5 px-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                  <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                  <p className="text-xs text-green-300 font-medium">Creator approved · <strong>+15 credits</strong> added to your wallet</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Supported platforms ─────────────────────────────── */}
        <section className="relative z-10 py-14 sm:py-16 px-4 sm:px-6 max-w-5xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold mb-2">Supported platforms</h2>
            <p className="text-sc-muted text-sm sm:text-base max-w-lg mx-auto">
              Real tasks across the platforms your audience already uses.
            </p>
          </div>
          <ul className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            {SUPPORTED_PLATFORMS.map((p) => (
              <li
                key={p.platform}
                className="flex items-center gap-2.5 bg-surface-card border border-surface-border rounded-full px-4 py-2.5 sm:px-5 sm:py-3"
              >
                <PlatformIcon platform={p.platform} className="w-5 h-5 shrink-0" />
                <span className="text-sm sm:text-base font-medium text-sc-text">{p.label}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── How it works ─────────────────────────────────────── */}
        <section id="how-it-works" className="relative z-10 py-16 sm:py-20 md:py-24 px-4 sm:px-6 max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">Two ways to participate</h2>
            <p className="text-sc-muted text-base sm:text-lg max-w-2xl mx-auto">
              Earn credits by helping others, or spend them to grow your own audience. Most creators do both.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Earner flow */}
            <div className="bg-surface-card border border-surface-border rounded-2xl p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 rounded-xl bg-brand-500/15 border border-brand-500/25 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4.5 h-4.5 text-brand-300" />
                </div>
                <div>
                  <h3 className="font-bold text-sc-text text-lg">Earn credits</h3>
                  <p className="text-xs text-sc-dim">Complete tasks from other creators</p>
                </div>
              </div>
              <ol className="space-y-4">
                {earnerSteps.map((s, i) => (
                  <li key={s.title} className="flex gap-3 items-start">
                    <span className="w-6 h-6 rounded-full bg-brand-500/20 border border-brand-500/30 text-brand-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-sc-text">{s.title}</p>
                      <p className="text-xs text-sc-dim leading-relaxed mt-0.5">{s.desc}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <Link
                href="/register"
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-300 hover:text-brand-200 transition-colors"
              >
                Start earning <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            {/* Creator flow */}
            <div className="bg-surface-card border border-surface-border rounded-2xl p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 rounded-xl bg-accent-500/15 border border-accent-500/25 flex items-center justify-center shrink-0">
                  <Megaphone className="w-4.5 h-4.5 text-accent-400" />
                </div>
                <div>
                  <h3 className="font-bold text-sc-text text-lg">Grow your audience</h3>
                  <p className="text-xs text-sc-dim">Create campaigns, real humans complete them</p>
                </div>
              </div>
              <ol className="space-y-4">
                {creatorSteps.map((s, i) => (
                  <li key={s.title} className="flex gap-3 items-start">
                    <span className="w-6 h-6 rounded-full bg-accent-500/20 border border-accent-500/30 text-accent-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-sc-text">{s.title}</p>
                      <p className="text-xs text-sc-dim leading-relaxed mt-0.5">{s.desc}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <Link
                href="/register"
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-accent-400 hover:text-accent-300 transition-colors"
              >
                Create a campaign <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </section>

        {/* ── Trust signals ────────────────────────────────────── */}
        <section id="about" className="relative z-10 py-16 sm:py-20 md:py-24 px-4 sm:px-6 max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">Built for real engagement</h2>
            <p className="text-sc-muted text-base sm:text-lg max-w-xl mx-auto">
              Every task completion is reviewed by the creator before credits are released. No bots. No shortcuts.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-4 sm:gap-6">
            {trustPoints.map((t) => (
              <div key={t.title} className="bg-surface-card border border-surface-border rounded-2xl p-5 sm:p-6">
                <t.Icon className="w-6 h-6 text-brand-400 mb-3" />
                <h3 className="font-semibold text-sc-text mb-1.5">{t.title}</h3>
                <p className="text-sc-muted text-sm leading-relaxed">{t.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Community ────────────────────────────────────────── */}
        <section className="relative z-10 pb-16 sm:pb-20 px-4 sm:px-6 max-w-5xl mx-auto">
          <div className="bg-surface-card border border-surface-border rounded-3xl px-6 py-10 sm:px-10 sm:py-12 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-accent-500/40 bg-accent-500/10">
              <TelegramIcon className="h-7 w-7 text-accent-300" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">Join the Engganyo community</h2>
            <p className="text-sc-muted text-sm sm:text-base max-w-md mx-auto mb-7">
              Chat with creators and earners, get product updates, and share wins in our official Telegram group.
            </p>
            <a
              href="https://t.me/Engganyo"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 min-h-11 px-6 py-3 rounded-xl bg-accent-500 hover:bg-accent-400 text-[#050918] font-semibold text-sm sm:text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300 focus-visible:ring-offset-2 focus-visible:ring-offset-sc-bg"
            >
              <TelegramIcon className="h-4 w-4" />
              Join us on Telegram
              <ExternalLink className="h-3.5 w-3.5 opacity-70" />
            </a>
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────────────────── */}
        <section className="relative z-10 py-16 sm:py-20 md:py-24 px-4 sm:px-6">
          <div className="max-w-2xl mx-auto text-center bg-surface-card border border-surface-border rounded-3xl px-6 py-12 sm:px-10 sm:py-14">
            <p className="text-xs uppercase tracking-widest text-brand-400 font-semibold mb-4">
              Free to join
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold mb-3 leading-tight">
              Start with 200 credits.<br />No card needed.
            </h2>
            <p className="text-sc-muted mb-8 text-sm sm:text-base max-w-md mx-auto">
              Create your account, pick a task from the marketplace, complete it, and earn your first credits today.
            </p>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-sc-text px-8 py-3.5 rounded-xl font-semibold transition-all hover:scale-[1.02] shadow-lg shadow-brand-500/25 text-base"
            >
              Create free account
              <ArrowRight className="w-4 h-4" />
            </Link>
            <p className="mt-4 text-xs text-sc-dim">
              Already have an account?{' '}
              <Link href="/login" className="text-sc-muted hover:text-sc-text transition-colors">
                Sign in
              </Link>
            </p>
          </div>
        </section>

        {/* ── Footer ───────────────────────────────────────────── */}
        <footer className="relative z-10 border-t border-surface-border py-10 sm:py-12 px-4 sm:px-6">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <BrandLogo wordmark={false} className="w-6 h-6" />
              <span className="font-semibold text-sm">Engganyo</span>
            </div>
            <p className="text-sc-dim text-sm">© {new Date().getFullYear()} Engganyo. All rights reserved.</p>
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 sm:gap-6 text-sc-dim text-sm">
              <a
                href="https://t.me/Engganyo"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 py-2 hover:text-accent-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300 rounded"
              >
                <TelegramIcon className="h-4 w-4" />
                Telegram
              </a>
              <Link href="/about" className="hover:text-sc-text transition-colors">About</Link>
              <Link href="/faq" className="hover:text-sc-text transition-colors">FAQ</Link>
              <Link href="/contact" className="hover:text-sc-text transition-colors">Contact</Link>
              <Link href="/privacy" className="hover:text-sc-text transition-colors">Privacy Policy</Link>
              <Link href="/terms" className="hover:text-sc-text transition-colors">Terms of Service</Link>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}

const earnerSteps = [
  { title: 'Browse the task marketplace', desc: 'See open tasks across TikTok, Instagram, Telegram, Discord, and more — each showing reward, platform, and what proof is needed.' },
  { title: 'Accept and open the target', desc: 'Click Accept, then open the creator\'s link in a new tab. Complete the action — follow, like, comment, or join.' },
  { title: 'Submit your screenshot', desc: 'Upload a screenshot showing the completed action. The creator reviews it, usually within 48 hours.' },
  { title: 'Credits land in your wallet', desc: 'Once approved, credits are released to your wallet. Spend them on your own campaigns or save up.' },
];

const creatorSteps = [
  { title: 'Set up a campaign', desc: 'Choose a platform (TikTok, Instagram, Telegram…), set your target URL, the reward per completion, and the total slots you want to fill.' },
  { title: 'Community members accept and act', desc: 'Real verified users browse the marketplace, accept your task, and complete the required action.' },
  { title: 'Review the proof', desc: 'Each completion arrives with a screenshot. Approve the ones that look genuine; reject the rest. You\'re in control.' },
  { title: 'Credits are released on approval', desc: 'Credits only leave your wallet when you approve a submission — no wasted spend on bad completions.' },
];

// Platforms with live task types in the released product (matches the
// Find tasks platform picker; YouTube engagement types are disabled).
const SUPPORTED_PLATFORMS = [
  { platform: 'FACEBOOK', label: 'Facebook' },
  { platform: 'TIKTOK', label: 'TikTok' },
  { platform: 'TELEGRAM', label: 'Telegram' },
  { platform: 'TWITTER', label: 'X' },
  { platform: 'INSTAGRAM', label: 'Instagram' },
  { platform: 'DISCORD', label: 'Discord' },
  { platform: 'TWITCH', label: 'Twitch' },
  { platform: 'SPOTIFY', label: 'Spotify' },
  { platform: 'TRUSTPILOT', label: 'Trustpilot' },
  { platform: 'GOOGLE', label: 'Google' },
];

const trustPoints = [
  {
    Icon: CheckCircle2,
    title: 'Creator-reviewed',
    desc: 'Every task completion is manually reviewed by the campaign creator before credits change hands. Automation doesn\'t substitute for human judgment.',
  },
  {
    Icon: Shield,
    title: 'Anti-abuse protection',
    desc: 'IP-sharing rules, trust scoring, and linked account verification ensure only genuine, independent users can complete each task.',
  },
  {
    Icon: Users,
    title: 'Real human community',
    desc: 'Engganyo is built on verified human engagement. No bot traffic, no fake accounts — the platform enforces this at the API level.',
  },
];
