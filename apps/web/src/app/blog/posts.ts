// Shared blog data: the single source for publication timestamps.
// pubDate is derived from the ISO date via toUTCString so the RFC 822
// weekday can never drift from the real calendar date.
const toRfc822 = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`).toUTCString();

export const POSTS = [
  {
    slug: 'yourfirstweekonengganyo',
    title: 'Your first week on Engganyo: a simple plan',
    description:
      'A plain guide to your first week on Engganyo: join free, do a few small tasks, earn credits, then try your first campaign.',
    date: '2026-11-22',
  },
] as const;

export const PUB_DATES_RFC822 = new Map(POSTS.map((p) => [p.slug, toRfc822(p.date)]));
