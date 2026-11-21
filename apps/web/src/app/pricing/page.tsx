import type { Metadata } from 'next';
import Link from 'next/link';
import { innerPageJsonLd } from '@/lib/jsonld';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Engganyo is free to start: every member gets 200 credits. Buy credit packages in USD in the wallet if you want to move faster.',
  alternates: { canonical: 'https://engganyo.com/pricing' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Pricing | Engganyo',
    description:
      'Engganyo is free to start: every member gets 200 credits. Buy credit packages in USD in the wallet if you want to move faster.',
    url: 'https://engganyo.com/pricing',
  },
  twitter: {
    title: 'Pricing | Engganyo',
    description:
      'Engganyo is free to start: every member gets 200 credits. Buy credit packages in USD in the wallet if you want to move faster.',
  },
};

// WebPage only. No Product or Offer markup: package contents and rates
// can change, so the wallet is always the source of truth.
const jsonLd = innerPageJsonLd({
  type: 'WebPage',
  path: '/pricing',
  name: 'Pricing',
  description:
    'Engganyo pricing: free to start with 200 credits, optional credit packages in USD, and where credits can be spent.',
  breadcrumb: 'Pricing',
});

// Example packages seen in the wallet on 2026-11-21. The table is
// labeled as an example because packages and rates can change.
const EXAMPLE_PACKAGES: [string, string][] = [
  ['$1', '5,000 credits'],
  ['$5', '25,500 credits (+500 bonus)'],
  ['$10', '51,500 credits (+1,500 bonus)'],
  ['$20', '104,000 credits (+4,000 bonus)'],
  ['$50', '262,500 credits (+12,500 bonus)'],
  ['$100', '530,000 credits (+30,000 bonus)'],
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-sc text-sc-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader />

      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-white mb-10">Pricing</h1>

        <div className="space-y-6">
          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">Free to start</h2>
            <p className="text-zinc-300 leading-relaxed">
              Joining Engganyo is free and no card is needed. Every member starts with 200 free
              credits. You can earn more credits by completing tasks for other creators and through
              daily rewards inside the app.
            </p>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">Buy credits to move faster</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              Credits can be bought in the Wallet. Packages are priced in USD from $1 to $100, larger
              packages include bonus credits, and a peso equivalent is shown at a live rate where
              supported. See the Wallet for current packages and payment options.
            </p>
            <div className="rounded-lg border border-surface-border overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead className="bg-surface-hover">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium text-zinc-400">Package (example)</th>
                    <th className="text-left px-4 py-2.5 font-medium text-zinc-400">Credits</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {EXAMPLE_PACKAGES.map(([price, credits]) => (
                    <tr key={price}>
                      <td className="px-4 py-2.5 text-zinc-300">{price}</td>
                      <td className="px-4 py-2.5 text-zinc-300">{credits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Example packages shown from the Wallet. Prices and bonuses can change. Purchased
              credits and earned credits are used the same way. Credits are used inside Engganyo and
              cannot be withdrawn as money.
            </p>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">Where credits go</h2>
            <ul className="list-disc list-inside space-y-2 text-zinc-300">
              <li>Campaigns: fund tasks for your own accounts and choose the reward per completion.</li>
              <li>1v1 challenges: challenge another member with a credits reward reserved up front.</li>
              <li>The store: spend credits on cosmetic and account items.</li>
            </ul>
            <p className="text-zinc-300 leading-relaxed mt-4">
              New here? Read{' '}
              <Link href="/how-it-works" className="text-brand-400 hover:underline">how Engganyo
              works</Link>, check the{' '}
              <Link href="/faq" className="text-brand-400 hover:underline">FAQ</Link>, or{' '}
              <Link href="/register" className="text-brand-400 hover:underline">create a free
              account</Link> to start with 200 credits.
            </p>
          </section>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
