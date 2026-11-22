import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export interface BlogPostSummary {
  slug: string;
  title: string;
  description: string;
  date: string; // ISO yyyy-mm-dd
}

/** Preview card used inside the landing blog rail (and the e2e rail
 *  fixture). Server-renderable: plain markup and anchors, no client JS. */
export function BlogPostCard({ post }: { post: BlogPostSummary }) {
  return (
    <li className="snap-start shrink-0 w-[19rem] sm:w-[22rem] list-none">
      <article className="card-glass rounded-xl p-6 min-h-[11.5rem] h-full flex flex-col">
        <time dateTime={post.date} className="text-xs text-zinc-400 mb-2 block">
          {new Date(`${post.date}T00:00:00Z`).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          })}
        </time>
        <h3 className="text-lg font-semibold text-white mb-2 leading-snug">{post.title}</h3>
        <p className="text-zinc-300 text-sm leading-relaxed mb-4 line-clamp-3">{post.description}</p>
        <Link
          href={`/blog/${post.slug}`}
          aria-label={`Read more: ${post.title}`}
          className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-brand-400 hover:text-brand-300 transition-colors rounded w-fit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 px-1 py-1 -ml-1"
        >
          Read more...
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </article>
    </li>
  );
}
