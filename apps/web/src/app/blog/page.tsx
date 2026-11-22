import type { Metadata } from 'next';
import Link from 'next/link';
import { innerPageJsonLd } from '@/lib/jsonld';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Blog',
  description:
    'Plain guides and updates for creators who want to grow their pages. We say what we checked and what we could not confirm.',
  alternates: { canonical: 'https://engganyo.com/blog' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Blog | Engganyo',
    description:
      'Plain guides and updates for creators who want to grow their pages.',
    url: 'https://engganyo.com/blog',
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
    title: 'Blog | Engganyo',
    description:
      'Plain guides and updates for creators who want to grow their pages.',
  },
};

const jsonLd = innerPageJsonLd({
  type: 'WebPage',
  path: '/blog',
  name: 'Engganyo Blog',
  description:
    'Plain guides and updates for creators who want to grow their pages.',
  breadcrumb: 'Blog',
});

export const POSTS = [
  {
    slug: 'yourfirstweekonengganyo',
    title: 'Your first week on Engganyo: a simple plan',
    description:
      'A plain guide to your first week on Engganyo: join free, do a few small tasks, earn credits, then try your first campaign.',
    date: '2026-11-22',
  },
];

export default function BlogIndex() {
  return (
    <div className="min-h-screen bg-sc text-sc-text">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PublicHeader />

      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-white mb-3">Engganyo Blog</h1>
        <p className="text-zinc-300 leading-relaxed mb-8">
          Plain guides and updates for creators who want to grow their pages. We say what we
          checked and what we could not confirm.
        </p>

        <div className="space-y-4">
          {POSTS.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="block card-glass rounded-xl p-6 hover:border-brand-500/40 transition-colors"
            >
              <h2 className="text-xl font-semibold text-white mb-2">{post.title}</h2>
              <p className="text-zinc-300 text-sm leading-relaxed mb-2">{post.description}</p>
              <time dateTime={post.date} className="text-xs text-zinc-500">
                {post.date}
              </time>
            </Link>
          ))}
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
