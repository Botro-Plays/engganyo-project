import type { Metadata } from 'next';
import Link from 'next/link';
import { innerPageJsonLd } from '@/lib/jsonld';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';

export const metadata: Metadata = {
  title: 'How It Works',
  description:
    'Join free, earn credits by completing tasks for other creators, get approved, and spend credits on campaigns for your own accounts.',
  alternates: { canonical: 'https://engganyo.com/how-it-works' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'How It Works | Engganyo',
    description:
      'Join free, earn credits by completing tasks for other creators, get approved, and spend credits on campaigns for your own accounts.',
    url: 'https://engganyo.com/how-it-works',
  },
  twitter: {
    title: 'How It Works | Engganyo',
    description:
      'Join free, earn credits by completing tasks for other creators, get approved, and spend credits on campaigns for your own accounts.',
  },
};

const jsonLd = innerPageJsonLd({
  type: 'WebPage',
  path: '/how-it-works',
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
  },
];

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-sc text-sc-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader />

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
                </div>
              </div>
            </section>
          ))}
        </div>

        <section className="card-glass rounded-xl p-6 mt-6">
          <h2 className="text-xl font-semibold text-white mb-3">Good to know</h2>
          <ul className="list-disc list-inside space-y-2 text-zinc-300">
            <li>
              Credits are used inside Engganyo and cannot be withdrawn as money. See{' '}
              <Link href="/pricing" className="text-brand-400 hover:underline">Pricing</Link> for how
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
              Our <Link href="/safety" className="text-brand-400 hover:underline">Safety</Link> page
              covers account rules, and the{' '}
              <Link href="/faq" className="text-brand-400 hover:underline">FAQ</Link> answers common
              questions about credits and review timing.
            </li>
          </ul>
        </section>
      </div>

      <PublicFooter />
    </div>
  );
}
