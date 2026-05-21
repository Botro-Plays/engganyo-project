import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Engganyo — Collaborative Creator Growth',
    template: '%s | Engganyo',
  },
  description:
    'Grow your social presence through real human engagement. Earn credits, complete tasks, and build a genuine creator community.',
  keywords: ['creator growth', 'social media', 'engagement', 'community', 'creators'],
  authors: [{ name: 'Engganyo' }],
  creator: 'Engganyo',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://engganyo.com',
    siteName: 'Engganyo',
    title: 'Engganyo — Collaborative Creator Growth',
    description: 'Grow your social presence through real human engagement.',
    images: [
      {
        url: 'https://engganyo.com/logo-square.png',
        width: 200,
        height: 200,
        alt: 'Engganyo - Collaborative Creator Growth',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Engganyo — Collaborative Creator Growth',
    description: 'Grow your social presence through real human engagement.',
    images: ['https://engganyo.com/logo-square.png'],
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: 'https://engganyo.com',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0f1117' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
