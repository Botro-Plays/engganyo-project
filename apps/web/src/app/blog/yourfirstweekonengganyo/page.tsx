import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';
import { POSTS } from '../posts';

export const revalidate = 3600;

const TITLE = 'Your first week on Engganyo: a simple plan';
const DESCRIPTION =
  'A plain guide to your first week on Engganyo: join free, do a few small tasks, earn credits, then try your first campaign.';
const PUBLISHED = POSTS.find((p) => p.slug === 'yourfirstweekonengganyo')!.date;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: 'https://engganyo.com/blog/yourfirstweekonengganyo' },
  robots: { index: true, follow: true },
  openGraph: {
    type: 'article',
    title: TITLE,
    description: DESCRIPTION,
    url: 'https://engganyo.com/blog/yourfirstweekonengganyo',
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
    title: TITLE,
    description: DESCRIPTION,
  },
};

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: TITLE,
    description: DESCRIPTION,
    datePublished: PUBLISHED,
    dateModified: PUBLISHED,
    author: { '@type': 'Organization', name: 'Engganyo', url: 'https://engganyo.com' },
    publisher: { '@type': 'Organization', name: 'Engganyo', url: 'https://engganyo.com' },
    image: 'https://engganyo.com/brand/social-1200x630.png',
    mainEntityOfPage: 'https://engganyo.com/blog/yourfirstweekonengganyo',
    isPartOf: { '@id': 'https://engganyo.com/#website' },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://engganyo.com/' },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://engganyo.com/blog' },
      {
        '@type': 'ListItem',
        position: 3,
        name: TITLE,
        item: 'https://engganyo.com/blog/yourfirstweekonengganyo',
      },
    ],
  },
];

export default function FirstWeekPost() {
  return (
    <div className="min-h-screen bg-sc text-sc-text">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PublicHeader />

      <article className="max-w-3xl mx-auto px-4 py-12">
        <p className="text-xs text-zinc-500 mb-4">
          <Link href="/blog" className="text-brand-400 hover:underline">Engganyo Blog</Link>
          {' · '}
          <time dateTime={PUBLISHED}>{PUBLISHED}</time>
        </p>
        <h1 className="text-3xl font-bold text-white mb-6">{TITLE}</h1>

        <div className="space-y-5 text-zinc-300 leading-relaxed">
          <p>
            A good first week on Engganyo is simple. You do not need to buy anything. You only need
            a few minutes a day.
          </p>
          <p>
            Day 1: Join and look around. Create your account at{' '}
            <Link href="/" className="text-brand-400 hover:underline">engganyo.com</Link>. Joining
            is free and no card is needed. Open your dashboard and look at your balance, your daily
            reward and the task list.
          </p>
          <p>
            Day 2: Do one small task. Open the Tasks page and pick a platform you already use. Do
            the action, such as a follow or a join, then upload a screenshot as proof. The campaign
            owner reviews it, and your credits arrive in your wallet once it is approved. Some task
            types, such as follows on linked Twitch or Spotify accounts, verify automatically.
          </p>
          <p>
            Day 3: Read the rules. Every platform has its own rules about engagement. Read them
            before you do more tasks. Doing tasks on any exchange site can go against a
            platform&apos;s rules, and platforms can warn, restrict or ban accounts. Start small
            and decide for yourself.
          </p>
          <p>
            Day 4 and 5: Build a small streak. Come back each day and claim your daily reward. Do
            one or two more tasks.
          </p>
          <p>
            Day 6: Create your first campaign. Open Campaigns, add your own link, choose a platform,
            set the reward for each task and how many people you want. Keep the reward fair so
            members want to do it.
          </p>
          <p>
            Day 7: Check what worked. Look at which tasks were approved fast and which campaign got
            the most completions. Then repeat what worked.
          </p>
          <p>
            Never share your social media password with anyone. Engganyo never asks for it. If you
            have a question, write to{' '}
            <a href="mailto:contact@engganyo.com" className="text-brand-400 hover:underline">
              contact@engganyo.com
            </a>{' '}
            or join our community on Telegram at{' '}
            <a
              href="https://t.me/Engganyo"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-400 hover:underline"
            >
              t.me/Engganyo
            </a>
            .
          </p>
        </div>

        <nav className="mt-10 card-glass rounded-xl p-6" aria-label="Related pages">
          <p className="text-sm text-zinc-300">
            Keep reading: the{' '}
            <Link href="/faq" className="text-brand-400 hover:underline">FAQ</Link>, the{' '}
            <Link href="/safety" className="text-brand-400 hover:underline">safety rules</Link>,
            and{' '}
            <Link href="/pricing" className="text-brand-400 hover:underline">pricing</Link>.
          </p>
        </nav>
      </article>

      <PublicFooter />
    </div>
  );
}
