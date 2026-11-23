import type { Metadata } from 'next';
import Link from 'next/link';
import { innerPageJsonLd, jsonLdScript } from '@/lib/jsonld';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';
import { EmailOff } from '@/components/email-off';
import { listPublishedPosts } from '@/lib/blog';
import type { BlogListItem } from '@/lib/blog';

export const revalidate = 60;

const DESCRIPTION =
  'Plain guides and updates for creators who want to grow their pages. We say what we checked and what we could not confirm.';

export const metadata: Metadata = {
  title: 'Blog',
  description: DESCRIPTION,
  alternates: { canonical: 'https://engganyo.com/blog' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Blog | Engganyo',
    description: DESCRIPTION,
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
    description: DESCRIPTION,
  },
};

const jsonLd = innerPageJsonLd({
  type: 'WebPage',
  path: '/blog',
  name: 'Engganyo Blog',
  description: DESCRIPTION,
  breadcrumb: 'Blog',
});

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

export default async function BlogIndex({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const pageParam = searchParams.page;
  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1);
  // At request time a fetch failure throws so ISR keeps serving the
  // last good render. Only a build-time prerender (no API yet) falls
  // back to an explicit unavailable state - never a fake empty index.
  let items: BlogListItem[] = [];
  let total = 0;
  let limit = 12;
  let loadFailed = false;
  try {
    ({ items, total, limit } = await listPublishedPosts(page, 12));
  } catch (err) {
    if (process.env.NEXT_PHASE !== 'phase-production-build') throw err;
    loadFailed = true;
  }
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="min-h-screen bg-sc text-sc-text">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
      <PublicHeader />

      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-white mb-3">Engganyo Blog</h1>
        <p className="text-zinc-300 leading-relaxed mb-3">
          Plain guides and updates for creators who want to grow their pages. We say what we
          checked and what we could not confirm.
        </p>
        <p className="text-zinc-400 text-sm leading-relaxed mb-8">
          What you will find here: guides for new members, plain explanations of how credits
          work, safety tips for doing tasks on any exchange site, and product updates. New
          posts are added as we learn what members ask for. Have a topic you want covered?
          Write to{' '}
          <EmailOff>
            <a href="mailto:contact@engganyo.com" className="text-brand-400 hover:underline">
              contact@engganyo.com
            </a>
          </EmailOff>{' '}
          or join the community on Telegram at{' '}
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

        {loadFailed ? (
          <p className="text-zinc-400">
            Articles could not be loaded right now. Please check back shortly.
          </p>
        ) : items.length === 0 ? (
          <p className="text-zinc-400">No articles yet. Check back soon.</p>
        ) : (
          <div className="space-y-4">
            {items.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="block card-glass rounded-xl p-6 hover:border-brand-500/40 transition-colors"
              >
                <h2 className="text-xl font-semibold text-white mb-2">{post.title}</h2>
                <p className="text-zinc-300 text-sm leading-relaxed mb-2">{post.excerpt}</p>
                <time dateTime={post.publishedAt} className="text-xs text-zinc-500">
                  {formatDate(post.publishedAt)}
                </time>
              </Link>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <nav className="mt-8 flex items-center justify-between text-sm" aria-label="Blog pagination">
            {page > 1 ? (
              <Link href={`/blog?page=${page - 1}`} className="text-brand-400 hover:underline">
                Newer posts
              </Link>
            ) : <span />}
            {page < totalPages && (
              <Link href={`/blog?page=${page + 1}`} className="text-brand-400 hover:underline">
                Older posts
              </Link>
            )}
          </nav>
        )}
      </div>

      <PublicFooter />
    </div>
  );
}
