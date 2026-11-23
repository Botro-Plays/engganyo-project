import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  compress: true,
  output: 'standalone',
  experimental: {
    outputFileTracingRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  },
  images: {
    domains: ['localhost', 'engganyo.com', 'www.engganyo.com', 'avatars.githubusercontent.com'],
    formats: ['image/avif', 'image/webp'],
  },
  async headers() {
    return [
      {
        // Versioned font files: content-addressed by build, safe to pin.
        // _next/static gets its own immutable header from Next already.
        source: '/fonts/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // Brand assets are NOT name-versioned (files can change in
        // place), so caching stays bounded — one day, not immutable.
        source: '/brand/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          // Enforced after live violation review on public AND
          // authenticated pages (simulated enforcement via response
          // rewriting). Two legitimate origins were observed blocked:
          //   - static.cloudflareinsights.com: Cloudflare Web Analytics
          //     beacon, owner retains -> added to script-src.
          //   - reCAPTCHA v3 runtime resources: it injects a
          //     www.gstatic.com stylesheet and fonts.gstatic.com Roboto
          //     woff2 on authenticated pages -> added to style-src and
          //     font-src. Without these, enforcing the policy breaks
          //     reCAPTCHA rendering on login, register and every
          //     authenticated page.
          // unsafe-inline stays: Next.js injects inline bootstrap/inline
          // JSON payloads. unsafe-eval stays: retained for libraries that
          // still use new Function/eval paths in production bundles.
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; " +
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.google.com https://www.gstatic.com https://static.cloudflareinsights.com; " +
              "frame-src https://www.google.com https://recaptcha.google.com; " +
              "connect-src 'self' https: wss:; " +
              "img-src 'self' data: https:; " +
              "style-src 'self' 'unsafe-inline' https://www.gstatic.com; " +
              "font-src 'self' data: https://fonts.gstatic.com; " +
              "object-src 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
