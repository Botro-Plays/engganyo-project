import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Providers } from './providers';
import { CookieConsentBanner } from '@/components/cookie-consent';
import { VisitorBeacon } from '@/components/visitor-beacon';
import './globals.css';

// Self-hosted pixel fonts as subset WOFF2 via next/font/local: metric-
// compatible fallback (adjustFontFallback, default on) keeps swap-era
// layout shift down, and _next/static/media serving is immutable by
// default. Both faces are preloaded - DotGothic16 is the body/heading
// face and VT323 renders the above-the-fold hero card. Full TTFs + OFL
// licenses remain in public/fonts/.
const dotGothic = localFont({
  src: '../fonts/DotGothic16-subset.woff2',
  variable: '--font-dotgothic',
  display: 'swap',
});
const vt323 = localFont({
  src: '../fonts/VT323-subset.woff2',
  variable: '--font-vt323',
  display: 'swap',
  // Used above the fold in the hero task card - a late swap measured
  // 0.113 CLS on the deployed site, so the ~18 KB subset is preloaded.
  preload: true,
});

export const metadata: Metadata = {
  metadataBase: new URL('https://engganyo.com'),
  title: {
    default: 'Engganyo | Small Taps. Big Crowds.',
    template: '%s | Engganyo',
  },
  description:
    'Grow your social presence through real human engagement. Earn credits, complete tasks, and build a genuine creator community.',
  keywords: ['creator growth', 'social media', 'engagement', 'community', 'creators'],
  authors: [{ name: 'Engganyo' }],
  creator: 'Engganyo',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    shortcut: '/favicon.svg',
    apple: '/brand/apple-touch-icon.png',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://engganyo.com',
    siteName: 'Engganyo',
    title: 'Engganyo | Small Taps. Big Crowds.',
    description: 'Grow your social presence through real human engagement.',
    images: [
      {
        url: 'https://engganyo.com/brand/social-1200x630.png',
        width: 1200,
        height: 630,
        alt: 'Engganyo - Small Taps. Big Crowds.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Engganyo | Small Taps. Big Crowds.',
    description: 'Grow your social presence through real human engagement.',
    images: ['https://engganyo.com/brand/social-1200x630.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#050918',
  // Where supported (Chrome/Android), the layout viewport itself shrinks
  // when the software keyboard opens, so fixed-bottom UI stays visible.
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${dotGothic.variable} ${vt323.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>
          {children}
          <VisitorBeacon />
          <CookieConsentBanner />
        </Providers>
      </body>
    </html>
  );
}
