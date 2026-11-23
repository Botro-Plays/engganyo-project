import type { Metadata } from 'next';
import Link from 'next/link';
import { innerPageJsonLd, jsonLdScript } from '@/lib/jsonld';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';
import { TelegramIcon } from '@/components/telegram-icon';
import { EmailOff } from '@/components/email-off';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Safety',
  description:
    'Safety and rules on Engganyo: account basics, third-party platform rules, how proof review works, and how to report a problem.',
  alternates: { canonical: 'https://engganyo.com/safety' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Safety | Engganyo',
    description:
      'Safety and rules on Engganyo: account basics, third-party platform rules, how proof review works, and how to report a problem.',
    url: 'https://engganyo.com/safety',
      images: [
        {
          url: '/brand/social-1200x630.png',
          width: 1200,
          height: 630,
          alt: 'Engganyo: Small Taps. Big Crowds.',
        },
      ],
  },
  twitter: {
      card: 'summary_large_image',
      images: ['/brand/social-1200x630.png'],
    title: 'Safety | Engganyo',
    description:
      'Safety and rules on Engganyo: account basics, third-party platform rules, how proof review works, and how to report a problem.',
  },
};

const jsonLd = innerPageJsonLd({
  type: 'WebPage',
  path: '/safety',
  name: 'Safety and rules',
  description:
    'Safety and rules on Engganyo: account basics, third-party platform rules, proof review, and how to report a problem.',
  breadcrumb: 'Safety',
});

export default function SafetyPage() {
  return (
    <div className="min-h-screen bg-sc text-sc-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <PublicHeader />
      <main id="main-content">

      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-white mb-10">Safety and rules</h1>

        <div className="space-y-6">
          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">Your passwords stay yours</h2>
            <p className="text-zinc-300 leading-relaxed">
              Never share a social media password with anyone. Engganyo never asks for one. Where
              account verification is available, it uses the platform&apos;s own sign-in (OAuth), and
              most tasks only need a screenshot as proof.
            </p>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">Each platform has its own rules</h2>
            <p className="text-zinc-300 leading-relaxed">
              Read the rules of each platform before you run or complete a task. What a platform
              allows is its own decision, and Engganyo cannot change that.
            </p>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">Third-party platform risk</h2>
            <p className="text-zinc-300 leading-relaxed">
              Completing tasks on Engganyo may violate the Terms of Service of third-party platforms
              (Instagram, TikTok, X, Facebook, and others) and could result in account warnings,
              restrictions, or permanent bans on those platforms. Participate at your own risk.
            </p>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">Proof is reviewed before credits move</h2>
            <p className="text-zinc-300 leading-relaxed">
              The campaign owner reviews your proof before credits are released, so completions are
              checked by a person first. Some tasks, like Twitch and Spotify follows, verify
              automatically through a linked account instead.
            </p>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">Credits stay inside Engganyo</h2>
            <p className="text-zinc-300 leading-relaxed">
              Credits are used inside the platform for campaigns, challenges, and the store. They
              cannot be withdrawn as money.
            </p>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">Report a problem</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              See something wrong, or need help with your account? Reach us by email or on Telegram.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <address className="not-italic">
                <EmailOff>
                  <a
                    href="mailto:contact@engganyo.com"
                    className="inline-flex items-center px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors"
                  >
                    contact@engganyo.com
                  </a>
                </EmailOff>
              </address>
              <a
                href="https://t.me/Engganyo"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-surface-border text-zinc-300 hover:text-white hover:border-zinc-500 text-sm font-medium transition-colors"
              >
                <TelegramIcon className="h-4 w-4" />
                t.me/Engganyo
              </a>
            </div>
            <p className="text-sm text-zinc-400 mt-4">
              For account issues, include your username in the message. More answers are in the{' '}
              <Link href="/faq" className="text-brand-400 underline underline-offset-2 hover:text-brand-300">FAQ</Link>, and{' '}
              <Link href="/howitworks" className="text-brand-400 underline underline-offset-2 hover:text-brand-300">How it works</Link>{' '}
              explains the task loop.
            </p>
          </section>

          <section className="card-glass rounded-xl p-6 mt-6">
            <h2 className="text-xl font-semibold text-white mb-3">If something goes wrong</h2>
            <p className="text-zinc-300 leading-relaxed">
              If a platform warns or restricts an account, Engganyo cannot reverse that, because the
              platform makes that decision alone. If a task was approved or rejected by mistake,
              write to us with your username and the task, by{' '}
              <Link href="/contact" className="text-brand-400 underline underline-offset-2 hover:text-brand-300">email</Link> or on{' '}
              <a
                href="https://t.me/Engganyo"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-400 underline underline-offset-2 hover:text-brand-300"
              >
                Telegram
              </a>
              . Never send your password to anyone, including us.
            </p>
          </section>
        </div>
      </div>
      </main>

      <PublicFooter />
    </div>
  );
}
