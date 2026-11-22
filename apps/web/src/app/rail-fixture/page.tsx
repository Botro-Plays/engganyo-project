import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BlogRail } from '@/components/blog-rail';
import { BlogPostCard, type BlogPostSummary } from '@/components/blog-post-card';

export const metadata: Metadata = {
  title: 'Rail fixture',
  robots: { index: false, follow: false },
};

// Controlled e2e/fixture route for exercising the multi-post blog rail
// (controls, autoplay pause, touch swipe, screenshots/recordings).
// Gated on the same build-time hook as the tour seam so production
// builds 404 this page.
const ENABLED = process.env.NEXT_PUBLIC_TOUR_E2E_HOOK === '1';

const FIXTURE_POSTS: BlogPostSummary[] = [
  {
    slug: 'fixture-a-simple-week',
    title: 'Fixture: a simple first week',
    description:
      'Fixture copy for rail testing. Enough text to check card height, line clamping, and the descriptive read-more label.',
    date: '2026-11-01',
  },
  {
    slug: 'fixture-proof-that-passes',
    title: 'Fixture: proof that passes review',
    description:
      'Fixture copy for rail testing, second card. Used to verify horizontal scroll steps, wrap-around, and pause behavior.',
    date: '2026-11-08',
  },
  {
    slug: 'fixture-long-title-check',
    title: 'Fixture: a deliberately long article title that wraps across several lines to stress card heights',
    description:
      'Fixture copy for rail testing, third card. The long title exercises reserved card dimensions and prevents layout shift between cards.',
    date: '2026-11-15',
  },
  {
    slug: 'fixture-final-card',
    title: 'Fixture: final card for end-of-rail checks',
    description:
      'Fixture copy for rail testing, fourth card. Lets tests assert the auto-advance wraps back to the first card.',
    date: '2026-11-20',
  },
];

export default function RailFixturePage() {
  if (!ENABLED) notFound();
  return (
    <main className="min-h-screen bg-sc text-sc-text px-4 sm:px-6 py-12">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Blog rail fixture</h1>
        <BlogRail count={FIXTURE_POSTS.length}>
          {FIXTURE_POSTS.map((post) => (
            <BlogPostCard key={post.slug} post={post} />
          ))}
        </BlogRail>
      </div>
    </main>
  );
}
