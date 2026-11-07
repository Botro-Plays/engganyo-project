import Link from 'next/link';
import Script from 'next/script';
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

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'Engganyo',
      url: 'https://engganyo.com',
      logo: 'https://engganyo.com/logo-square.svg',
      description: 'Engganyo is a creator growth platform designed to help content creators increase their audience engagement through authentic, community-driven interactions.',
    },
    {
      '@type': 'WebSite',
      url: 'https://engganyo.com',
      name: 'Engganyo',
      description: 'Find a task. Earn credits. Grow your social presence through real human engagement.',
      potentialAction: {
        '@type': 'SearchAction',
        target: 'https://engganyo.com/search?q={search_term_string}',
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'WebPage',
      url: 'https://engganyo.com',
      name: 'Engganyo — Find a task. Earn credits.',
      description: 'Find a task. Earn credits. Grow your social presence through real human engagement.',
    },
  ],
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
      <Script
        id="json-ld"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="relative min-h-screen bg-surface text-white overflow-x-hidden">
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
                Find a task.
                <br />
                <span className="text-gradient">Earn credits.</span>
              </h1>

              <p className="text-base sm:text-lg text-zinc-400 leading-relaxed mb-8 max-w-lg">
                Complete social tasks for other creators, earn credits, then use them to grow your own audience.
                Every interaction is verified by a human — no bots, no fake engagement.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 mb-8">
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-7 py-3.5 rounded-xl font-semibold transition-all hover:scale-[1.02] shadow-lg shadow-brand-500/25 text-sm sm:text-base"
                >
                  Start earning free
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href="#how-it-works"
                  className="inline-flex items-center justify-center gap-2 text-zinc-400 hover:text-white px-7 py-3.5 rounded-xl border border-surface-border hover:border-zinc-600 transition-all text-sm sm:text-base"
                >
                  How it works
                </Link>
              </div>

              {/* Social proof */}
              {stats && (
                <div className="flex flex-wrap gap-5 text-zinc-500 text-sm">
                  <span>
                    <strong className="text-white tabular-nums">{stats.totalUsers.toLocaleString()}+</strong>{' '}
                    creators joined
                  </span>
                  <span>
                    <strong className="text-white tabular-nums">{stats.totalTaskCompletions.toLocaleString()}+</strong>{' '}
                    tasks verified
                  </span>
                  <span>
                    <strong className="text-white tabular-nums">{stats.totalCountries}+</strong>{' '}
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
                    <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium bg-pink-500/15 text-pink-300 border border-pink-500/20">
                      TikTok · Follow
                    </span>
                    <span className="text-sm font-bold text-green-400 shrink-0">+15 credits</span>
                  </div>
                  {/* Title */}
                  <p className="text-sm font-semibold text-white mb-1">Follow @artbyjamie — TikTok art creator</p>
                  {/* URL mock */}
                  <p className="text-xs text-zinc-500 mb-3 flex items-center gap-1 truncate">
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
                  <div className="flex items-center justify-between text-xs text-zinc-500 mb-4">
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
                    { step: '2', label: 'Open & do', icon: ExternalLink, color: 'text-pink-300' },
                    { step: '3', label: 'Submit proof', icon: Upload, color: 'text-amber-300' },
                  ].map(({ step, label, icon: Icon, color }) => (
                    <div key={step} className="bg-surface-card border border-surface-border rounded-xl px-2 py-3">
                      <Icon className={`w-4 h-4 mx-auto mb-1.5 ${color}`} />
                      <p className="text-[11px] text-zinc-400">{label}</p>
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
            <p className="text-zinc-400 text-sm sm:text-base max-w-lg mx-auto">
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
                <span className="text-sm sm:text-base font-medium text-zinc-200">{p.label}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── How it works ─────────────────────────────────────── */}
        <section id="how-it-works" className="relative z-10 py-16 sm:py-20 md:py-24 px-4 sm:px-6 max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">Two ways to participate</h2>
            <p className="text-zinc-400 text-base sm:text-lg max-w-2xl mx-auto">
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
                  <h3 className="font-bold text-white text-lg">Earn credits</h3>
                  <p className="text-xs text-zinc-500">Complete tasks from other creators</p>
                </div>
              </div>
              <ol className="space-y-4">
                {earnerSteps.map((s, i) => (
                  <li key={s.title} className="flex gap-3 items-start">
                    <span className="w-6 h-6 rounded-full bg-brand-500/20 border border-brand-500/30 text-brand-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-white">{s.title}</p>
                      <p className="text-xs text-zinc-500 leading-relaxed mt-0.5">{s.desc}</p>
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
                  <h3 className="font-bold text-white text-lg">Grow your audience</h3>
                  <p className="text-xs text-zinc-500">Create campaigns, real humans complete them</p>
                </div>
              </div>
              <ol className="space-y-4">
                {creatorSteps.map((s, i) => (
                  <li key={s.title} className="flex gap-3 items-start">
                    <span className="w-6 h-6 rounded-full bg-accent-500/20 border border-accent-500/30 text-accent-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-white">{s.title}</p>
                      <p className="text-xs text-zinc-500 leading-relaxed mt-0.5">{s.desc}</p>
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
            <p className="text-zinc-400 text-base sm:text-lg max-w-xl mx-auto">
              Every task completion is reviewed by the creator before credits are released. No bots. No shortcuts.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-4 sm:gap-6">
            {trustPoints.map((t) => (
              <div key={t.title} className="bg-surface-card border border-surface-border rounded-2xl p-5 sm:p-6">
                <t.Icon className="w-6 h-6 text-brand-400 mb-3" />
                <h3 className="font-semibold text-white mb-1.5">{t.title}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{t.desc}</p>
              </div>
            ))}
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
            <p className="text-zinc-400 mb-8 text-sm sm:text-base max-w-md mx-auto">
              Create your account, pick a task from the marketplace, complete it, and earn your first credits today.
            </p>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-8 py-3.5 rounded-xl font-semibold transition-all hover:scale-[1.02] shadow-lg shadow-brand-500/25 text-base"
            >
              Create free account
              <ArrowRight className="w-4 h-4" />
            </Link>
            <p className="mt-4 text-xs text-zinc-600">
              Already have an account?{' '}
              <Link href="/login" className="text-zinc-400 hover:text-white transition-colors">
                Sign in
              </Link>
            </p>
          </div>
        </section>

        {/* ── Footer ───────────────────────────────────────────── */}
        <footer className="relative z-10 border-t border-surface-border py-10 sm:py-12 px-4 sm:px-6">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <img src="/logo-square.svg" alt="Engganyo" className="w-6 h-6" />
              <span className="font-semibold text-sm">Engganyo</span>
            </div>
            <p className="text-zinc-500 text-sm">© {new Date().getFullYear()} Engganyo. All rights reserved.</p>
            <div className="flex flex-wrap justify-center gap-4 sm:gap-6 text-zinc-500 text-sm">
              <Link href="/about" className="hover:text-white transition-colors">About</Link>
              <Link href="/faq" className="hover:text-white transition-colors">FAQ</Link>
              <Link href="/contact" className="hover:text-white transition-colors">Contact</Link>
              <Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
              <Link href="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
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
