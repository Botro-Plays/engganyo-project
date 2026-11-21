import type { Metadata } from 'next';
import Link from 'next/link';
import { innerPageJsonLd } from '@/lib/jsonld';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Learn about Engganyo, a creator engagement exchange where members complete social tasks for each other, earn credits, and grow their own audiences.',
  alternates: { canonical: 'https://engganyo.com/about' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'About | Engganyo',
    description:
      'A creator engagement exchange: complete small tasks for other creators, earn credits, and spend them on campaigns for your own accounts.',
    url: 'https://engganyo.com/about',
  },
  twitter: {
    title: 'About | Engganyo',
    description:
      'A creator engagement exchange: complete small tasks for other creators, earn credits, and spend them on campaigns for your own accounts.',
  },
};

const jsonLd = innerPageJsonLd({
  type: 'AboutPage',
  path: '/about',
  name: 'About Engganyo',
  description:
    'Engganyo is a creator engagement exchange where members complete social tasks for each other, earn credits, and grow their own audiences.',
  breadcrumb: 'About',
});

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-sc text-sc-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader />

      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-white mb-8">About Engganyo</h1>

        <div className="space-y-8">
          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">What Engganyo is</h2>
            <p className="text-zinc-300 leading-relaxed">
              Engganyo is a web platform where creators help each other grow. You complete small
              tasks for other creators, such as following an account or joining a channel, and
              you earn credits once the campaign owner approves your proof. You can then spend
              your credits on campaigns for your own accounts.
            </p>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">How it works</h2>
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white font-bold text-sm">1</div>
                <div>
                  <h3 className="text-white font-medium mb-1">Browse open tasks</h3>
                  <p className="text-zinc-300 text-sm">
                    See open tasks across TikTok, Instagram, Telegram, Discord, and more, each
                    shows the reward, the platform, and exactly what proof is needed.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white font-bold text-sm">2</div>
                <div>
                  <h3 className="text-white font-medium mb-1">Complete the task</h3>
                  <p className="text-zinc-300 text-sm">
                    Do the action on that platform and submit your proof. Most tasks are reviewed
                    by the campaign owner; some, like Twitch and Spotify follows, verify
                    automatically through a linked account.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white font-bold text-sm">3</div>
                <div>
                  <h3 className="text-white font-medium mb-1">Earn and spend credits</h3>
                  <p className="text-zinc-300 text-sm">
                    Approved completions add credits to your wallet. Spend them on campaigns for
                    your own accounts, or buy more credits from your wallet if you want to scale
                    faster.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">For task creators</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              Create a campaign: choose a platform, add your link, set the reward for each task
              and how many completions you want. Engganyo provides:
            </p>
            <ul className="space-y-2 text-zinc-300 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-brand-400 mt-1">•</span>
                <span>Real member engagement, reviewed before credits move</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-400 mt-1">•</span>
                <span>You review each proof before credits are released</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-400 mt-1">•</span>
                <span>Campaign management tools and progress tracking</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-400 mt-1">•</span>
                <span>Credits stay escrowed in the campaign until you approve the work</span>
              </li>
            </ul>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">For members</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              Every member starts with 200 free credits. No card is needed.
            </p>
            <ul className="space-y-2 text-zinc-300 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-brand-400 mt-1">•</span>
                <span>Earn credits for tasks you complete</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-400 mt-1">•</span>
                <span>Choose the platforms and campaigns that match your accounts</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-400 mt-1">•</span>
                <span>Credits are used inside Engganyo and cannot be withdrawn as money</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-400 mt-1">•</span>
                <span>Grow your social presence through genuine engagement</span>
              </li>
            </ul>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Supported platforms</h2>
            <p className="text-zinc-300 leading-relaxed">
              Tasks are available for TikTok, Instagram, Facebook, X, Telegram, Discord, Twitch,
              Spotify, Trustpilot, and Google. Each platform has its own rules, so please read
              them before you run or complete any task. Engganyo does not offer rewarded YouTube
              engagement tasks.
            </p>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Our values</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h3 className="text-white font-medium mb-1">Authenticity</h3>
                <p className="text-zinc-300 text-sm">We prioritize genuine interactions over artificial metrics.</p>
              </div>
              <div>
                <h3 className="text-white font-medium mb-1">Fairness</h3>
                <p className="text-zinc-300 text-sm">Transparent verification and fair credit handling for all members.</p>
              </div>
              <div>
                <h3 className="text-white font-medium mb-1">Security</h3>
                <p className="text-zinc-300 text-sm">Protection against fraud and abuse for the whole community.</p>
              </div>
              <div>
                <h3 className="text-white font-medium mb-1">Community</h3>
                <p className="text-zinc-300 text-sm">A trusted ecosystem where creators help each other grow.</p>
              </div>
            </div>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Questions?</h2>
            <p className="text-zinc-300 leading-relaxed">
              Write to{' '}
              <address className="not-italic inline">
                <a href="mailto:contact@engganyo.com" className="text-brand-400 hover:underline">
                contact@engganyo.com
              </a>
              </address>{' '}
              or join our community on{' '}
              <a
                href="https://t.me/Engganyo"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-400 hover:underline"
              >
                Telegram
              </a>
              .
            </p>
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

      <PublicFooter />
    </div>
  );
}
