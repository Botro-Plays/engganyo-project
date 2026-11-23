import type { Metadata } from 'next';
import Link from 'next/link';
import { innerPageJsonLd, jsonLdScript } from '@/lib/jsonld';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';
import { EmailOff } from '@/components/email-off';

// Uniform public-page caching: one hour shared cache with
// stale-while-revalidate (emits s-maxage=3600).
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Contact Us',
  description:
    'Contact Engganyo by email or on Telegram. Ask about your account, report a problem or send feedback. We usually reply within 24 to 48 hours.',
  alternates: { canonical: 'https://engganyo.com/contact' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Contact | Engganyo',
    description: 'Get in touch with the Engganyo team: questions, feedback, or support.',
    url: 'https://engganyo.com/contact',
      images: [
        {
          url: '/brand/social-1200x630.png',
          width: 1200,
          height: 630,
          alt: 'Engganyo: Small Taps. Big Crowds.',
        },
      ],
  },
  twitter: {
      card: 'summary_large_image',
      images: ['/brand/social-1200x630.png'],
    title: 'Contact | Engganyo',
    description: 'Get in touch with the Engganyo team: questions, feedback, or support.',
  },
};

const jsonLd = innerPageJsonLd({
  type: 'ContactPage',
  path: '/contact',
  name: 'Contact Engganyo',
  description: 'Get in touch with the Engganyo team: questions, feedback, or support.',
  breadcrumb: 'Contact',
});

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-sc text-sc-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <PublicHeader />

      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-white mb-8">Contact Us</h1>

        <div className="space-y-8">
          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Get in touch</h2>
            <p className="text-zinc-300 mb-6">
              Have questions, feedback, or need support? We&apos;d love to hear from you.
            </p>

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-zinc-400 mb-1">Email</h3>
                <address className="not-italic">
                  <EmailOff>
                    <a href="mailto:contact@engganyo.com" className="text-brand-400 hover:underline">
                      contact@engganyo.com
                    </a>
                  </EmailOff>
                </address>
              </div>

              <div>
                <h3 className="text-sm font-medium text-zinc-400 mb-1">Community</h3>
                <a
                  href="https://t.me/Engganyo"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-400 hover:underline"
                >
                  t.me/Engganyo
                </a>
              </div>

              <div>
                <h3 className="text-sm font-medium text-zinc-400 mb-1">Response time</h3>
                <p className="text-zinc-300">We typically respond within 24-48 hours.</p>
              </div>
            </div>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Report an issue</h2>
            <p className="text-zinc-300 mb-4">
              Found a bug or have a feature request? Let us know!
            </p>
            <EmailOff>
              <a
                href="mailto:contact@engganyo.com?subject=Bug Report or Feature Request"
                className="inline-flex items-center px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors"
              >
                Report Issue
              </a>
            </EmailOff>
          </section>

          <section className="card-glass rounded-xl p-6 text-center">
            <p className="text-zinc-300">
              Looking for quick answers? Check our{' '}
              <Link href="/faq" className="text-brand-400 hover:underline">
                FAQ
              </Link>
              .
            </p>
          </section>

          <section className="text-center text-sm text-zinc-500">
            <p>
              For account-specific issues, please include your username and email in your message.
            </p>
          </section>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
