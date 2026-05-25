import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Contact Us',
  description: 'Get in touch with the Engganyo team. We are here to help with questions, feedback, or support.',
  alternates: { canonical: 'https://engganyo.com/contact' },
  robots: { index: true, follow: true },
};

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-surface">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link href="/" className="inline-flex items-center text-zinc-400 hover:text-white mb-8">
          ← Back to Home
        </Link>

        <h1 className="text-3xl font-bold text-white mb-8">Contact Us</h1>

        <div className="space-y-8">
          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Get in Touch</h2>
            <p className="text-zinc-300 mb-6">
              Have questions, feedback, or need support? We&apos;d love to hear from you.
            </p>

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-zinc-400 mb-1">Email</h3>
                <a href="mailto:support@engganyo.com" className="text-brand-400 hover:underline">
                  support@engganyo.com
                </a>
              </div>

              <div>
                <h3 className="text-sm font-medium text-zinc-400 mb-1">Business Inquiries</h3>
                <a href="mailto:business@engganyo.com" className="text-brand-400 hover:underline">
                  business@engganyo.com
                </a>
              </div>

              <div>
                <h3 className="text-sm font-medium text-zinc-400 mb-1">Response Time</h3>
                <p className="text-zinc-300">We typically respond within 24-48 hours.</p>
              </div>
            </div>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Frequently Asked Questions</h2>

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-white mb-1">How do I earn credits?</h3>
                <p className="text-zinc-300 text-sm">
                  Complete tasks from the campaigns page. Each task has a credit reward that&apos;s added to your wallet upon verification.
                </p>
              </div>

              <div>
                <h3 className="text-sm font-medium text-white mb-1">How do I withdraw credits?</h3>
                <p className="text-zinc-300 text-sm">
                  Visit the Wallet page to request withdrawals. Credits can be converted to real currency through our payment partners.
                </p>
              </div>

              <div>
                <h3 className="text-sm font-medium text-white mb-1">What happens if my task is rejected?</h3>
                <p className="text-zinc-300 text-sm">
                  If your proof doesn&apos;t meet requirements, the task will be rejected and you can resubmit with correct proof.
                </p>
              </div>

              <div>
                <h3 className="text-sm font-medium text-white mb-1">Can I have multiple accounts?</h3>
                <p className="text-zinc-300 text-sm">
                  No, multiple accounts are against our terms and may result in permanent suspension.
                </p>
              </div>
            </div>
          </section>

          <section className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Report an Issue</h2>
            <p className="text-zinc-300 mb-4">
              Found a bug or have a feature request? Let us know!
            </p>
            <a 
              href="mailto:support@engganyo.com?subject=Bug Report or Feature Request" 
              className="inline-flex items-center px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors"
            >
              Report Issue
            </a>
          </section>

          <section className="text-center text-sm text-zinc-500">
            <p>
              For account-specific issues, please include your username and email in your message.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
