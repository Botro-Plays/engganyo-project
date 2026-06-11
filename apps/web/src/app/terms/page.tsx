import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Read the terms and conditions governing your use of the Engganyo creator growth platform.',
  alternates: { canonical: 'https://engganyo.com/terms' },
  robots: { index: true, follow: false },
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-surface">
      {/* Header with logo - visible on mobile */}
      <header className="md:hidden border-b border-surface-border p-4">
        <Link href="/" className="inline-flex items-center">
          <img src="/logo-horizontal.svg" alt="Engganyo" className="h-7" />
        </Link>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link href="/" className="hidden md:inline-flex items-center text-zinc-400 hover:text-white mb-8">
          ← Back to Home
        </Link>

        <h1 className="text-3xl font-bold text-white mb-8">Terms of Service</h1>

        <div className="space-y-6 text-zinc-300">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">1. Acceptance of Terms</h2>
            <p>
              By accessing and using Engganyo, you agree to be bound by these Terms of Service. 
              If you do not agree to these terms, please do not use our service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">2. Account Responsibilities</h2>
            <p className="mb-2">You are responsible for:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Maintaining the confidentiality of your account credentials</li>
              <li>All activities that occur under your account</li>
              <li>Providing accurate and complete information</li>
              <li>Notifying us immediately of any unauthorized access</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">3. Acceptable Use</h2>
            <p className="mb-2">You agree not to:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Use fake accounts or bots to complete tasks</li>
              <li>Submit false or misleading proof of task completion</li>
              <li>Attempt to exploit or abuse the system</li>
              <li>Harass other users or engage in spam behavior</li>
              <li>Violate any applicable laws or regulations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">4. Task Completion & Payments</h2>
            <p className="mb-2">
              Credits are earned upon successful task verification. We reserve the right to:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Reject incomplete or fraudulent task submissions</li>
              <li>Revoke credits if fraud is detected</li>
              <li>Suspend accounts that violate our policies</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">5. Platform Fees</h2>
            <p className="mb-2">
              Engganyo charges a platform fee on all campaigns created through the service. The fee is calculated as a percentage of the total campaign budget (total slots × credits per task) and is deducted at the time of campaign creation.
            </p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Base platform fee: 10% of the total campaign budget.</li>
              <li>Volume discounts apply based on your lifetime campaign spend:
                <ul className="list-disc list-inside ml-6 mt-1">
                  <li>₱500+ lifetime spend: 8% fee</li>
                  <li>₱2,000+ lifetime spend: 6% fee</li>
                  <li>₱5,000+ lifetime spend: 5% fee</li>
                </ul>
              </li>
              <li>Promotional fee rates may be offered periodically and will be displayed during campaign creation.</li>
              <li>Fees are non-refundable once a campaign has been published.</li>
              <li>All fees are denominated in platform credits.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">6. Content & Intellectual Property</h2>
            <p>
              You retain ownership of content you submit. By using our service, you grant us a license 
              to use your content for the purpose of providing our services. You agree not to submit 
              content that infringes on others&apos; intellectual property rights.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">7. Termination</h2>
            <p>
              We reserve the right to suspend or terminate accounts that violate these terms.
              You may also terminate your account at any time through your account settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">8. Limitation of Liability</h2>
            <p>
              Engganyo is provided &quot;as is&quot; without warranties of any kind. We shall not be liable
              for any indirect, incidental, or consequential damages arising from use of our service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">9. Changes to Terms</h2>
            <p>
              We may update these terms from time to time. Continued use of the service after
              changes constitutes acceptance of the new terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">10. Contact Us</h2>
            <p>
              For questions about these terms, please{' '}
              <Link href="/contact" className="text-brand-400 hover:underline">contact us</Link>.
            </p>
          </section>

          <section className="pt-6 border-t border-surface-border">
            <p className="text-sm text-zinc-500">
              Last updated: {new Date().toLocaleDateString()}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
