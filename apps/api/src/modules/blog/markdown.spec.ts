import { renderPostBody } from './markdown';

describe('renderPostBody', () => {
  it('renders basic markdown to html', () => {
    const html = renderPostBody('# Title\n\nA paragraph with **bold** and [a link](/faq).');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<a href="/faq" rel="noopener noreferrer">a link</a>');
  });

  it('strips script tags and their contents', () => {
    const html = renderPostBody('Before\n\n<script>alert(1)</script>\n\nAfter');
    expect(html).not.toContain('script');
    expect(html).not.toContain('alert');
    expect(html).toContain('Before');
    expect(html).toContain('After');
  });

  it('removes event handlers and iframes', () => {
    const html = renderPostBody(
      '<img src="/x.png" onerror="alert(1)">\n\n<iframe src="https://evil.example"></iframe>',
    );
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('iframe');
  });

  it('neutralizes javascript: and data: URLs', () => {
    const html = renderPostBody('[x](javascript:alert(1)) and [y](data:text/html;base64,AAAA)');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:');
  });

  it('keeps internal links, https, and mailto', () => {
    const html = renderPostBody(
      '[internal](/pricing) [ext](https://example.com) [mail](mailto:a@b.c)',
    );
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="mailto:a@b.c"');
  });

  it('wraps mailto links in Cloudflare email_off opt-out markers', () => {
    const html = renderPostBody('[contact@engganyo.com](mailto:contact@engganyo.com)');
    expect(html).toContain('<!--email_off--><a');
    expect(html).toContain('</a><!--/email_off-->');
  });

  it('forces rel="noopener noreferrer" on links', () => {
    const html = renderPostBody('[t](https://t.me/Engganyo)');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('escapes markdown that would break out of html context', () => {
    const html = renderPostBody('</article><script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</article>');
  });

  it('handles empty and null-ish bodies', () => {
    expect(renderPostBody('')).toBe('');
  });
});
