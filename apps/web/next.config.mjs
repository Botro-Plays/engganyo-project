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
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          // Report-only first: observe violations (reCAPTCHA frames,
          // third-party scripts) before any enforcement is considered.
          {
            key: 'Content-Security-Policy-Report-Only',
            value:
              "default-src 'self'; " +
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.google.com https://www.gstatic.com; " +
              "frame-src https://www.google.com https://recaptcha.google.com; " +
              "connect-src 'self' https: wss:; " +
              "img-src 'self' data: https:; " +
              "style-src 'self' 'unsafe-inline'; " +
              "font-src 'self' data:; " +
              "object-src 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
