import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'About Engganyo',
  description: 'Learn about Engganyo - the platform that connects brands with social media users for authentic engagement campaigns.',
  alternates: { canonical: 'https://engganyo.com/about' },
  robots: { index: true, follow: true },
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-surface">
      {/* Header with logo - visible on mobile */}
      <header className="md:hidden border-b border-surface-border p-4">
        <Link href="/" className="inline-flex items-center">
          <img src="/logo-horizontal.svg" alt="Engganyo" className="h-7" />
        </Link>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link href="/" className="hidden md:inline-flex items-center text-zinc-400 hover:text-white mb-8">
          ← Back to Home
        </Link>

        <h1 className="text-3xl font-bold text-white mb-8">About Engganyo</h1>

        <div className="space-y-8">
          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Our Mission</h2>
            <p className="text-zinc-300 leading-relaxed">
              Engganyo is a platform that bridges the gap between brands and social media users. We enable authentic engagement campaigns where users complete social media tasks and earn rewards, while brands reach real audiences through genuine interactions.
            </p>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">How It Works</h2>
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white font-bold text-sm">1</div>
                <div>
                  <h3 className="text-white font-medium mb-1">Browse Campaigns</h3>
                  <p className="text-zinc-300 text-sm">Explore available campaigns from brands across YouTube, Twitch, Spotify, and more.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white font-bold text-sm">2</div>
                <div>
                  <h3 className="text-white font-medium mb-1">Complete Tasks</h3>
                  <p className="text-zinc-300 text-sm">Follow the campaign requirements and submit proof of completion.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white font-bold text-sm">3</div>
                <div>
                  <h3 className="text-white font-medium mb-1">Earn Credits</h3>
                  <p className="text-zinc-300 text-sm">Get your task verified and earn credits that can be withdrawn as real currency.</p>
                </div>
              </div>
            </div>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">For Brands</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              Brands can launch targeted campaigns to reach engaged audiences. Our platform ensures:
            </p>
            <ul className="space-y-2 text-zinc-300 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-brand-400 mt-1">•</span>
                <span>Real user engagement — no bots or fake accounts</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-400 mt-1">•</span>
                <span>Transparent verification through proof submission</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-400 mt-1">•</span>
                <span>Flexible campaign management and analytics</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-400 mt-1">•</span>
                <span>Cost-effective reach compared to traditional advertising</span>
              </li>
            </ul>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">For Users</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              Users can monetize their social media presence by participating in campaigns they genuinely enjoy.
            </p>
            <ul className="space-y-2 text-zinc-300 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-brand-400 mt-1">•</span>
                <span>Earn rewards for activities you already do</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-400 mt-1">•</span>
                <span>Choose campaigns that match your interests</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-400 mt-1">•</span>
                <span>Secure withdrawal options for your earnings</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-400 mt-1">•</span>
                <span>Grow your social media presence through authentic engagement</span>
              </li>
            </ul>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Our Values</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h3 className="text-white font-medium mb-1">Authenticity</h3>
                <p className="text-zinc-300 text-sm">We prioritize genuine interactions over artificial metrics.</p>
              </div>
              <div>
                <h3 className="text-white font-medium mb-1">Fairness</h3>
                <p className="text-zinc-300 text-sm">Transparent verification and fair compensation for all users.</p>
              </div>
              <div>
                <h3 className="text-white font-medium mb-1">Security</h3>
                <p className="text-zinc-300 text-sm">Robust protection against fraud and abuse for both brands and users.</p>
              </div>
              <div>
                <h3 className="text-white font-medium mb-1">Community</h3>
                <p className="text-zinc-300 text-sm">Building a trusted ecosystem where everyone benefits.</p>
              </div>
            </div>
          </section>

          <section className="text-center">
            <Link
              href="/register"
              className="inline-flex items-center px-6 py-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors"
            >
              Get Started
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
