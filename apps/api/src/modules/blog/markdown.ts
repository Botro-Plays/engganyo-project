import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'strong', 'em', 'del', 'hr', 'br', 'img',
];
const ALLOWED_ATTRS: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
};

const SAFE_URL = /^(?:https?:|mailto:|\/|#)/i;

function filterUnsafeUrls(html: string): string {
  return html.replace(/(href|src)="([^"]*)"/g, (m, attr: string, url: string) =>
    SAFE_URL.test(url.trim()) ? m : `${attr}="#"`);
}

marked.use({ gfm: true, breaks: false });

export function renderPostBody(markdown: string): string {
  const raw = marked.parse(markdown ?? '', { async: false }) as string;
  const clean = sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
    },
  });
  const safe = filterUnsafeUrls(clean);
  // Keep contact mailto links visible through Cloudflare email obfuscation:
  // CF honors <!--email_off--> opt-out markers around the link element.
  return safe.replace(
    /<a\s+([^>]*?)href="mailto:[^"]*"([^>]*)>[\s\S]*?<\/a>/g,
    (tag) => `<!--email_off-->${tag}<!--/email_off-->`,
  );
}
