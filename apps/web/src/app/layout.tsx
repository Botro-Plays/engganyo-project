import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';
import { CookieConsentBanner } from '@/components/cookie-consent';
import { VisitorBeacon } from '@/components/visitor-beacon';
import './globals.css';

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
    <html lang="en" className="dark" suppressHydrationWarning>
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
