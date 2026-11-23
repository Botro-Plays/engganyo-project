import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { innerPageJsonLd, jsonLdScript } from '@/lib/jsonld';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'How It Works',
  description:
    'Join free, do small tasks for other creators, earn credits when the campaign owner approves your proof, then spend credits on campaigns for your own accounts.',
  alternates: { canonical: 'https://engganyo.com/howitworks' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'How It Works | Engganyo',
    description:
      'Join free, earn credits by completing tasks for other creators, get approved, and spend credits on campaigns for your own accounts.',
    url: 'https://engganyo.com/howitworks',
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
    title: 'How It Works | Engganyo',
    description:
      'Join free, earn credits by completing tasks for other creators, get approved, and spend credits on campaigns for your own accounts.',
  },
};

const jsonLd = innerPageJsonLd({
  type: 'WebPage',
  path: '/howitworks',
  name: 'How Engganyo works',
  description:
    'How Engganyo works: join free with 200 credits, earn credits by completing tasks for other creators, and spend credits on campaigns for your own accounts.',
  breadcrumb: 'How It Works',
});

const STEPS = [
  {
    n: '1',
    title: 'Join free',
    body: 'Create an account and you get 200 free credits to start. No card is needed. The welcome credits are enough to try a first campaign or to learn how the task list works before you spend anything.',
  },
  {
    n: '2',
    title: 'Earn credits',
    body: 'Open the task list and pick a task on a platform you use, such as following an account or joining a channel. Do the action on that platform, then upload a screenshot as proof of the completion.',
    img: {
      src: '/brand/product-tasks.webp',
      alt: 'Engganyo Tasks page showing open tasks and the credit reward for each one',
      caption: 'The Tasks page lists open tasks with the credit reward for each one.',
    },
  },
  {
    n: '3',
    title: 'Get approved',
    body: 'The campaign owner reviews your proof. Credits are released to your wallet when the completion is approved. Some tasks, like Twitch and Spotify follows, verify automatically through a linked account instead of manual proof.',
  },
  {
    n: '4',
    title: 'Spend credits',
    body: 'Create a campaign for your own accounts: choose a platform, add your link, set the reward for each task, and set how many completions you want. Other members then complete your tasks the same way.',
    img: {
      src: '/brand/product-campaigns.webp',
      alt: 'Engganyo Campaigns page with the form for creating a campaign',
      caption: 'The campaign creation form in Campaigns.',
    },
  },
];

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-sc text-sc-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <PublicHeader />
      <main id="main-content">

      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-white mb-4">How Engganyo works</h1>
        <p className="text-zinc-300 mb-10 leading-relaxed">
          Engganyo is a web platform where creators complete small tasks for each other, earn
          credits, and spend them on campaigns for their own accounts. Here is the whole loop in
          four steps.
        </p>

        <div className="space-y-6">
          {STEPS.map((step) => (
            <section key={step.n} className="card-glass rounded-xl p-6">
              <div className="flex items-start gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-brand-300 font-bold">
                  {step.n}
                </span>
                <div>
                  <h2 className="text-xl font-semibold text-white mb-2">{step.title}</h2>
                  <p className="text-zinc-300 leading-relaxed">{step.body}</p>
                  {step.img && (
                    <figure className="mt-4 rounded-lg border border-surface-border bg-surface-card overflow-hidden">
                      <Image
                        src={step.img.src}
                        alt={step.img.alt}
                        width={1200}
                        height={750}
                        loading="lazy"
                        sizes="(max-width: 768px) 100vw, 720px"
                        className="w-full h-auto"
                      />
                      <figcaption className="px-3 py-2 text-xs text-zinc-400">{step.img.caption}</figcaption>
                    </figure>
                  )}
                </div>
              </div>
            </section>
          ))}
        </div>

        <section className="card-glass rounded-xl p-6 mt-6">
          <h2 className="text-xl font-semibold text-white mb-3">Before you start</h2>
          <p className="text-zinc-300 leading-relaxed">
            Pick the platforms you already use, so you do not have to create new accounts just to
            earn credits. Read the rules of each platform before you do any task, because every
            platform decides what is allowed. Start with one small task to see how proof and
            approval work. You can see your balance in the Wallet and your daily rewards on your
            dashboard. If you get stuck, ask on Telegram at{' '}
            <a
              href="https://t.me/Engganyo"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-400 underline underline-offset-2 hover:text-brand-300"
            >
              t.me/Engganyo
            </a>{' '}
            or read the <Link href="/faq" className="text-brand-400 underline underline-offset-2 hover:text-brand-300">FAQ</Link>.
          </p>
        </section>

        <section className="card-glass rounded-xl p-6 mt-6">
          <h2 className="text-xl font-semibold text-white mb-3">Good to know</h2>
          <ul className="list-disc list-inside space-y-2 text-zinc-300">
            <li>
              Credits are used inside Engganyo and cannot be withdrawn as money. See{' '}
              <Link href="/pricing" className="text-brand-400 underline underline-offset-2 hover:text-brand-300">Pricing</Link> for how
              credits work and how to buy more.
            </li>
            <li>
              Each platform has its own rules, so read them before you run or complete a task.
            </li>
            <li>
              Completing tasks on Engganyo may violate the Terms of Service of third-party platforms
              (Instagram, TikTok, X, Facebook, and others) and could result in account warnings,
              restrictions, or permanent bans on those platforms. Participate at your own risk.
            </li>
            <li>
              Our <Link href="/safety" className="text-brand-400 underline underline-offset-2 hover:text-brand-300">Safety</Link> page
              covers account rules, and the{' '}
              <Link href="/faq" className="text-brand-400 underline underline-offset-2 hover:text-brand-300">FAQ</Link> answers common
              questions about credits and review timing.
            </li>
          </ul>
        </section>
      </div>
      </main>

      <PublicFooter />
    </div>
  );
}
