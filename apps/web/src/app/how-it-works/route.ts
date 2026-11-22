// Permanent redirect: /how-it-works moved to /howitworks (owner URL rule,
// 2026-11-22). Old external links must keep resolving forever — this is a
// real 301, not a Next permanent redirect (which emits 308).
export function GET() {
  return new Response(null, {
    status: 301,
    headers: { Location: '/howitworks' },
  });
}
