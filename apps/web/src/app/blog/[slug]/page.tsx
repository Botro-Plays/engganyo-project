import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';
import { getPublishedPost } from '@/lib/blog';

export const revalidate = 60;

const DEFAULT_OG = '/brand/social-1200x630.png';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const { slug } = params;
  const post = await getPublishedPost(slug);
  if (!post) return { title: 'Blog' };
  const title = post.seoTitle ?? post.title;
  const description = post.seoDescription ?? post.excerpt;
  const ogImage = post.ogImageUrl ?? post.coverImageUrl ?? DEFAULT_OG;
  const canonical = `https://engganyo.com/blog/${post.slug}`;
  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'article',
      title,
      description,
      url: canonical,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: post.coverImageAlt ?? 'Engganyo: Small Taps. Big Crowds.',
        },
      ],
      ...(post.publishedAt ? { publishedTime: post.publishedAt } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      images: [ogImage],
      title,
      description,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: { slug: string };
}) {
  const { slug } = params;
  const post = await getPublishedPost(slug);
  if (!post) notFound();

  const canonical = `https://engganyo.com/blog/${post.slug}`;
  const ogImage = post.ogImageUrl ?? post.coverImageUrl ?? DEFAULT_OG;
  const absoluteOg = ogImage.startsWith('http') ? ogImage : `https://engganyo.com${ogImage}`;
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.seoDescription ?? post.excerpt,
      datePublished: post.publishedAt,
      dateModified: post.publishedAt,
      author: { '@type': 'Organization', name: post.authorName, url: 'https://engganyo.com' },
      publisher: { '@type': 'Organization', name: 'Engganyo', url: 'https://engganyo.com' },
      image: absoluteOg,
      mainEntityOfPage: canonical,
      isPartOf: { '@id': 'https://engganyo.com/#website' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://engganyo.com/' },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://engganyo.com/blog' },
        { '@type': 'ListItem', position: 3, name: post.title, item: canonical },
      ],
    },
  ];

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
          {post.publishedAt && (
            <>
              {' · '}
              <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
            </>
          )}
        </p>
        <h1 className="text-3xl font-bold text-white mb-6">{post.title}</h1>
        {post.coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.coverImageUrl}
            alt={post.coverImageAlt ?? ''}
            width={1200}
            height={630}
            className="w-full rounded-xl mb-6 object-cover"
          />
        )}
        <div
          className="space-y-5 text-zinc-300 leading-relaxed blog-body"
          dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
        />

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
