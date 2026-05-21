import Link from 'next/link';
import {
  Zap,
  Users,
  Trophy,
  Shield,
  ArrowRight,
  Star,
  TrendingUp,
  Globe,
} from 'lucide-react';

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-surface text-white overflow-hidden">
      {/* Hero gradient */}
      <div className="absolute inset-0 bg-gradient-hero pointer-events-none" />

      {/* Navbar */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-7xl mx-auto">
        <Link href="/" className="flex items-center">
          <img src="/logo-horizontal.svg" alt="Engganyo" className="h-9" />
        </Link>

        <div className="hidden md:flex items-center gap-8 text-sm text-zinc-400">
          <Link href="#features" className="hover:text-white transition-colors">Features</Link>
          <Link href="#how-it-works" className="hover:text-white transition-colors">How it works</Link>
          <Link href="#about" className="hover:text-white transition-colors">About</Link>
        </div>
        <div className="flex items-center gap-4 text-sm text-zinc-400">
          <a href="/privacy" className="hover:text-white transition-colors">Privacy Policy</a>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm text-zinc-400 hover:text-white transition-colors px-4 py-2"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="text-sm bg-brand-500 hover:bg-brand-600 text-white px-4 py-2 rounded-lg transition-colors font-medium"
          >
            Get started free
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative z-10 pt-24 pb-32 px-6 text-center max-w-5xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-brand-500/30 bg-brand-500/10 text-brand-300 text-xs font-medium mb-8">
          <Star className="w-3 h-3" />
          Creator Growth Platform
        </div>

        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 leading-tight">
          Grow your audience
          <br />
          <span className="text-gradient">the right way</span>
        </h1>

        <p className="text-xl text-zinc-400 max-w-2xl mx-auto mb-8 leading-relaxed">
          Engganyo is a community-driven platform where real creators help each other grow.
          Earn credits by engaging with others, then use them to promote your own content.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/register"
            className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-8 py-3.5 rounded-xl font-semibold transition-all hover:scale-105 shadow-lg shadow-brand-500/25"
          >
            Start growing for free
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="#how-it-works"
            className="flex items-center gap-2 text-zinc-400 hover:text-white px-8 py-3.5 rounded-xl border border-surface-border hover:border-zinc-600 transition-all"
          >
            See how it works
          </Link>
        </div>

        {/* Social proof */}
        <div className="mt-16 flex flex-wrap items-center justify-center gap-8 text-zinc-500 text-sm">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-brand-400" />
            <span><strong className="text-white">10,000+</strong> creators</span>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-accent-400" />
            <span><strong className="text-white">500K+</strong> tasks completed</span>
          </div>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-green-400" />
            <span><strong className="text-white">50+</strong> countries</span>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="relative z-10 py-24 px-6 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">Everything you need to grow</h2>
          <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
            A complete ecosystem built for serious creators who want sustainable, genuine growth.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="card-glass rounded-2xl p-6 hover:border-brand-500/30 transition-all group"
            >
              <div className="w-10 h-10 rounded-lg bg-gradient-brand flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <feature.Icon className="w-5 h-5 text-white" />
              </div>
              <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
              <p className="text-zinc-400 text-sm leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="relative z-10 py-24 px-6 max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">How Engganyo works</h2>
          <p className="text-zinc-400 text-lg">Simple, transparent, and fair for everyone.</p>
        </div>

        <div className="space-y-6">
          {steps.map((step, i) => (
            <div key={step.title} className="flex gap-6 items-start">
              <div className="w-10 h-10 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-brand-400 font-bold text-sm">{i + 1}</span>
              </div>
              <div>
                <h3 className="font-semibold text-lg mb-1">{step.title}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* About Section */}
      <section id="about" className="relative z-10 py-24 px-6 max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">About Engganyo</h2>
          <p className="text-zinc-400 text-lg">A platform built for creators, by creators.</p>
        </div>

        <div className="card-glass rounded-2xl p-8 space-y-4">
          <p className="text-zinc-300 leading-relaxed">
            <strong className="text-white">Engganyo</strong> is a creator growth platform designed to help content creators increase their audience engagement through authentic, community-driven interactions. Our platform enables creators to earn credits by completing engagement tasks for other creators, then use those credits to promote their own content across multiple social media platforms including YouTube, TikTok, Instagram, Twitter, Twitch, and Spotify.
          </p>
          <p className="text-zinc-300 leading-relaxed">
            Unlike traditional engagement services that rely on bots or fake accounts, Engganyo uses a credit-based economy combined with advanced anti-abuse protection and trust scoring to ensure that all engagement comes from real, verified human users. Creators can set up campaigns for specific engagement types (subscribes, likes, follows, comments, etc.) and set their own pricing, while task earners earn credits by completing these tasks with proper verification.
          </p>
          <p className="text-zinc-300 leading-relaxed">
            Our mission is to create a fair, transparent ecosystem where creators can grow their audiences organically while helping others do the same. We believe in genuine engagement over vanity metrics, and our platform is built to facilitate meaningful connections between creators in similar niches.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 py-24 px-6">
        <div className="max-w-3xl mx-auto text-center card-glass rounded-3xl p-16">
          <Trophy className="w-12 h-12 text-brand-400 mx-auto mb-6" />
          <h2 className="text-4xl font-bold mb-4">Ready to start growing?</h2>
          <p className="text-zinc-400 mb-8">
            Join thousands of creators already building their audience on Engganyo.
          </p>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-10 py-4 rounded-xl font-semibold transition-all hover:scale-105 shadow-lg shadow-brand-500/25 text-lg"
          >
            Create free account
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-surface-border py-12 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/logo-square.svg" alt="Engganyo" className="w-6 h-6" />
            <span className="font-semibold text-sm">Engganyo</span>
          </div>
          <p className="text-zinc-500 text-sm">© {new Date().getFullYear()} Engganyo. All rights reserved.</p>
          <div className="flex gap-6 text-zinc-500 text-sm">
            <a href="/privacy" className="hover:text-white transition-colors">Privacy Policy</a>
            <Link href="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
            <Link href="/contact" className="hover:text-white transition-colors">Contact</Link>
          </div>
        </div>
      </footer>
    </main>
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
    description: 'Connect with creators from 50+ countries who share your passion and goals.',
  },
];

const steps = [
  {
    title: 'Create your account',
    description: 'Sign up, verify your email, and get 200 welcome credits to start with.',
  },
  {
    title: 'Complete tasks to earn credits',
    description: 'Browse available tasks, complete them manually, submit proof, and get credited when verified.',
  },
  {
    title: 'Launch your campaign',
    description: 'Spend credits to create a campaign. Set your target platform, URL, slots, and price per completion.',
  },
  {
    title: 'Watch your audience grow',
    description: 'Real creators complete your tasks, your engagement grows, and everyone benefits.',
  },
];
