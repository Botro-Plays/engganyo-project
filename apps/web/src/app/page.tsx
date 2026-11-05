import Link from 'next/link';
import Script from 'next/script';
import {
  Zap,
  Users,
  Trophy,
  Shield,
  ArrowRight,
  Star,
  TrendingUp,
  Globe,
  Instagram,
  BadgeCheck,
  Camera,
  ListChecks,
} from 'lucide-react';
import { LandingNavbar } from '@/components/landing-navbar';

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
      description: 'Grow your social presence through real human engagement. Earn credits, complete tasks, and build a genuine creator community.',
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
      description: 'A marketplace where creators post small engagement tasks and earn credits for completing them with proof. Creators review every submission before credits are released.',
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
    const res = await fetch(`${apiUrl}/analytics/public-stats`, {
      next: { revalidate: 3600 }, // 1 hour
    });
    if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as {
      data?: {
        totalUsers?: number;
        totalTaskCompletions?: number;
        totalVerifiedTasks?: number; // backward-compat: old API field name
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

const primaryCta =
  'inline-flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-8 py-3.5 rounded-xl font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-warm';
const secondaryCta =
  'inline-flex items-center justify-center gap-2 text-surface-warm-ink hover:text-brand-600 px-8 py-3.5 rounded-xl border border-surface-warm-border bg-white hover:border-brand-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-warm';

export default async function LandingPage() {
  const stats = await getPublicStats();
  return (
    <>
      <Script
        id="json-ld"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="min-h-screen bg-surface-warm text-surface-warm-ink overflow-x-hidden">
        {/* Navbar — client component handles mobile hamburger */}
        <LandingNavbar />

        {/* Hero */}
        <section className="relative z-10 pt-10 pb-14 sm:pt-16 sm:pb-20 px-4 sm:px-6">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-brand-200 bg-brand-50 text-brand-700 text-xs font-medium mb-6">
              <Star className="w-3 h-3" />
              Task marketplace for creators
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-5 leading-tight">
              Find a task.
              <br />
              <span className="text-brand-600">Earn credits.</span>
            </h1>

            <p className="text-base sm:text-lg text-surface-warm-muted max-w-2xl mx-auto mb-8 leading-relaxed">
              Engganyo is a marketplace where creators post small engagement tasks —
              follows, likes, comments, subscribes — and earn credits for completing
              them with proof. Every submission is reviewed by the creator before
              credits are released.
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4 px-2 sm:px-0">
              <Link href="/register" className={primaryCta}>
                Create free account
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link href="#how-it-works" className={secondaryCta}>
                See how it works
              </Link>
            </div>

            {/* Social proof — only shown when stats were successfully fetched */}
            {stats && (
              <div className="mt-12 flex flex-wrap items-center justify-center gap-6 sm:gap-8 text-surface-warm-muted text-sm">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-brand-500" />
                  <span><strong className="text-surface-warm-ink">{stats.totalUsers.toLocaleString()}+</strong> creators</span>
                </div>
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-accent-500" />
                  <span><strong className="text-surface-warm-ink">{stats.totalTaskCompletions.toLocaleString()}+</strong> tasks completed</span>
                </div>
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-green-600" />
                  <span><strong className="text-surface-warm-ink">{stats.totalCountries.toLocaleString()}+</strong> countries</span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Representative task */}
        <section className="relative z-10 py-14 sm:py-20 px-4 sm:px-6 bg-surface-warm-50 border-y border-surface-warm-border">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-8 sm:mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold mb-3">What a task looks like</h2>
              <p className="text-surface-warm-muted text-base sm:text-lg max-w-xl mx-auto">
                Every task shows its reward, exactly what to do, and the proof the
                creator needs before credits are released.
              </p>
            </div>

            <figure className="bg-white rounded-2xl border border-surface-warm-border shadow-sm overflow-hidden max-w-xl mx-auto">
              <figcaption className="sr-only">Example task: follow and like an Instagram account</figcaption>
              <div className="flex items-center gap-3 px-5 sm:px-6 py-4 border-b border-surface-warm-border">
                <div className="w-10 h-10 rounded-lg bg-gradient-brand flex items-center justify-center shrink-0">
                  <Instagram className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm sm:text-base truncate">Follow @auroracreates and like their latest post</p>
                  <p className="text-xs text-surface-warm-muted">Posted by a creator campaign · Instagram</p>
                </div>
                <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-xs font-semibold">
                  +25 credits
                </span>
              </div>
              <dl className="px-5 sm:px-6 py-5 space-y-4 text-sm">
                <div className="flex gap-3">
                  <ListChecks className="w-4 h-4 text-brand-500 mt-0.5 shrink-0" aria-hidden />
                  <div>
                    <dt className="font-medium text-surface-warm-ink">What to do</dt>
                    <dd className="text-surface-warm-muted mt-0.5">Follow the account, then like their most recent post.</dd>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Camera className="w-4 h-4 text-brand-500 mt-0.5 shrink-0" aria-hidden />
                  <div>
                    <dt className="font-medium text-surface-warm-ink">Proof needed</dt>
                    <dd className="text-surface-warm-muted mt-0.5">A screenshot showing the follow and the like.</dd>
                  </div>
                </div>
                <div className="flex gap-3">
                  <BadgeCheck className="w-4 h-4 text-brand-500 mt-0.5 shrink-0" aria-hidden />
                  <div>
                    <dt className="font-medium text-surface-warm-ink">Review</dt>
                    <dd className="text-surface-warm-muted mt-0.5">The creator checks your proof, then credits are released.</dd>
                  </div>
                </div>
              </dl>
            </figure>
          </div>
        </section>

        {/* Creator review */}
        <section id="how-it-works" className="relative z-10 py-14 sm:py-20 px-4 sm:px-6">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-10 sm:mb-14">
              <h2 className="text-2xl sm:text-3xl font-bold mb-3">How creator review works</h2>
              <p className="text-surface-warm-muted text-base sm:text-lg max-w-2xl mx-auto">
                Credits are never automatic. A real creator looks at your proof first.
              </p>
            </div>

            <ol className="grid sm:grid-cols-3 gap-6 sm:gap-8">
              {reviewSteps.map((step, i) => (
                <li key={step.title} className="text-center sm:text-left">
                  <div className="w-10 h-10 rounded-full bg-brand-500/10 border border-brand-200 flex items-center justify-center mb-4 mx-auto sm:mx-0">
                    <span className="text-brand-600 font-bold text-sm">{i + 1}</span>
                  </div>
                  <h3 className="font-semibold text-base mb-1.5">{step.title}</h3>
                  <p className="text-surface-warm-muted text-sm leading-relaxed">{step.description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="relative z-10 py-14 sm:py-20 px-4 sm:px-6 bg-surface-warm-50 border-y border-surface-warm-border">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-10 sm:mb-14">
              <h2 className="text-2xl sm:text-3xl font-bold mb-3">Built for real creators</h2>
              <p className="text-surface-warm-muted text-base sm:text-lg max-w-2xl mx-auto">
                A complete ecosystem for earning credits and growing your own channels.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="bg-white rounded-2xl border border-surface-warm-border p-5 sm:p-6 hover:border-brand-300 transition-colors"
                >
                  <div className="w-10 h-10 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center mb-4">
                    <feature.Icon className="w-5 h-5 text-brand-600" />
                  </div>
                  <h3 className="font-semibold text-base sm:text-lg mb-2">{feature.title}</h3>
                  <p className="text-surface-warm-muted text-sm leading-relaxed">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* About */}
        <section id="about" className="relative z-10 py-14 sm:py-20 px-4 sm:px-6">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-8 sm:mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold mb-3">About Engganyo</h2>
              <p className="text-surface-warm-muted text-base sm:text-lg">A platform built for creators, by creators.</p>
            </div>

            <div className="bg-white rounded-2xl border border-surface-warm-border p-5 sm:p-8 space-y-4">
              <p className="text-surface-warm-ink text-sm sm:text-base leading-relaxed">
                <strong>Engganyo</strong> is a creator growth platform designed to help content creators increase their audience engagement through authentic, community-driven interactions. Our platform enables creators to earn credits by completing engagement tasks for other creators, then use those credits to promote their own content across multiple social media platforms including YouTube, TikTok, Instagram, Twitter, Twitch, and Spotify.
              </p>
              <p className="text-surface-warm-ink text-sm sm:text-base leading-relaxed">
                Unlike traditional engagement services that rely on bots or fake accounts, Engganyo uses a credit-based economy combined with advanced anti-abuse protection and trust scoring to ensure that all engagement comes from real, verified human users. Creators can set up campaigns for specific engagement types (subscribes, likes, follows, comments, etc.) and set their own pricing, while task earners earn credits by completing these tasks with proper verification.
              </p>
              <p className="text-surface-warm-ink text-sm sm:text-base leading-relaxed">
                Our mission is to create a fair, transparent ecosystem where creators can grow their audiences organically while helping others do the same. We believe in genuine engagement over vanity metrics, and our platform is built to facilitate meaningful connections between creators in similar niches.
              </p>
              <div className="pt-2">
                <Link
                  href="/about"
                  className="inline-flex items-center text-brand-600 hover:text-brand-500 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
                >
                  Learn more about us
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="relative z-10 py-14 sm:py-20 px-4 sm:px-6">
          <div className="max-w-3xl mx-auto text-center bg-brand-950 rounded-3xl px-6 py-12 sm:px-12 sm:py-14">
            <Trophy className="w-10 h-10 sm:w-12 sm:h-12 text-brand-300 mx-auto mb-5 sm:mb-6" />
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">Ready to earn your first credits?</h2>
            <p className="text-brand-200 mb-8 text-sm sm:text-base">
              Create a free account, browse open tasks, and submit your first proof today.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/register"
                className="inline-flex items-center gap-2 bg-white hover:bg-brand-50 text-brand-700 px-8 sm:px-10 py-3.5 sm:py-4 rounded-xl font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-950 text-base"
              >
                Create free account
                <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
              </Link>
              <Link
                href="#how-it-works"
                className="inline-flex items-center text-brand-200 hover:text-white text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 rounded"
              >
                Learn how it works
              </Link>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="relative z-10 border-t border-surface-warm-border py-10 sm:py-12 px-4 sm:px-6">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <img src="/logo-horizontal.svg" alt="Engganyo" className="h-7" />
            </div>
            <p className="text-surface-warm-muted text-sm">© {new Date().getFullYear()} Engganyo. All rights reserved.</p>
            <div className="flex flex-wrap justify-center gap-4 sm:gap-6 text-surface-warm-muted text-sm">
              <Link href="/about" className="hover:text-surface-warm-ink transition-colors">About</Link>
              <Link href="/faq" className="hover:text-surface-warm-ink transition-colors">FAQ</Link>
              <Link href="/contact" className="hover:text-surface-warm-ink transition-colors">Contact</Link>
              <Link href="/privacy" className="hover:text-surface-warm-ink transition-colors">Privacy Policy</Link>
              <Link href="/terms" className="hover:text-surface-warm-ink transition-colors">Terms of Service</Link>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}

const features = [
  {
    Icon: Zap,
    title: 'Task Marketplace',
    description: 'Browse and complete engagement tasks across YouTube, TikTok, Instagram, and more platforms.',
  },
  {
    Icon: Trophy,
    title: 'Credit Economy',
    description: 'Earn credits by helping others, spend them to promote your own content. Fair and transparent.',
  },
  {
    Icon: Shield,
    title: 'Anti-Abuse Protection',
    description: 'Advanced trust scoring and verification ensures only real humans participate.',
  },
  {
    Icon: Users,
    title: 'Creator Discovery',
    description: 'Get discovered by other creators in your niche and build meaningful connections.',
  },
  {
    Icon: TrendingUp,
    title: 'Gamification',
    description: 'Level up, earn achievements, maintain streaks, and compete on leaderboards.',
  },
  {
    Icon: Globe,
    title: 'Global Community',
    description: 'Connect with creators from around the world who share your passion and goals.',
  },
];

const reviewSteps = [
  {
    title: 'Complete the task',
    description: 'Do exactly what the task asks — follow, like, comment, or subscribe — on the listed platform.',
  },
  {
    title: 'Submit proof',
    description: 'Attach a screenshot or link showing you finished. The creator sees it with your submission.',
  },
  {
    title: 'Creator approves',
    description: 'The campaign owner reviews your proof. Approved tasks release credits to your wallet instantly.',
  },
];
