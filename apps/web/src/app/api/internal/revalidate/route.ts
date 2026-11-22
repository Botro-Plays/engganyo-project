import { revalidatePath, revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

/**
 * Internal cache-revalidation endpoint. The API calls this after blog
 * mutations so publish/unpublish/delete reach every public surface. It
 * is gated by a shared secret (never NEXT_PUBLIC) and bounded to the
 * paths the caller is allowed to bust.
 */
const ALLOWED_PATHS = new Set([
  '/', '/blog', '/blog/rss.xml', '/sitemap.xml',
]);
const SLUG_RE = /^\/blog\/[a-z0-9]{2,64}$/;

export async function POST(request: Request) {
  const expected = process.env.INTERNAL_REVALIDATE_SECRET ?? '';
  const provided = request.headers.get('x-internal-secret') ?? '';
  if (!expected || provided !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: { paths?: unknown; tag?: unknown };
  try {
    body = (await request.json()) as { paths?: unknown; tag?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const revalidated: string[] = [];
  if (body.tag === 'blog') {
    revalidateTag('blog');
    revalidated.push('tag:blog');
  }
  const paths = Array.isArray(body.paths) ? body.paths.slice(0, 20) : [];
  for (const p of paths) {
    if (typeof p !== 'string') continue;
    if (ALLOWED_PATHS.has(p) || SLUG_RE.test(p)) {
      revalidatePath(p);
      revalidated.push(p);
    }
  }

  return NextResponse.json({ ok: true, revalidated });
}
