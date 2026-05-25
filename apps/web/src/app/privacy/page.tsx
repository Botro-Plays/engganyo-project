import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Learn how Engganyo collects, uses, and protects your personal information on our creator growth platform.',
  alternates: { canonical: 'https://engganyo.com/privacy' },
  robots: { index: true, follow: false },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-surface">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <Link href="/" className="inline-flex items-center text-zinc-400 hover:text-white mb-8">
          ← Back to Home
        </Link>

        <h1 className="text-3xl font-bold text-white mb-8">Privacy Policy</h1>

        <div className="space-y-8 text-zinc-300">
          <section>
            <h2 className="text-xl font-semibold text-white mb-4">1. Introduction</h2>
            <p className="leading-relaxed">
              Engganyo (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;) is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our creator growth platform. Please read this policy carefully. If you do not agree with the terms of this policy, please do not access the platform.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">2. Information We Collect</h2>
            <p className="mb-3 font-medium text-white">Information You Provide Directly:</p>
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li><strong>Account Information:</strong> Username, email address, display name, password (hashed)</li>
              <li><strong>Profile Information:</strong> Bio, avatar image, social media profile links, website URL</li>
              <li><strong>Task Data:</strong> Task completion records, proof submissions, campaign participation history</li>
              <li><strong>Payment Information:</strong> Wallet balance, transaction history (we do not store full payment card details)</li>
              <li><strong>Social Media Credentials:</strong> OAuth tokens (encrypted) for YouTube, Twitch, Spotify connections</li>
              <li><strong>Communications:</strong> Messages sent to our support team</li>
            </ul>
            <p className="mb-3 font-medium text-white">Automatically Collected Information:</p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li><strong>Device Information:</strong> IP address, browser type, operating system, device identifiers</li>
              <li><strong>Usage Data:</strong> Pages visited, time spent, features used, click patterns</li>
              <li><strong>Location Data:</strong> Approximate geographic location based on IP address</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">3. How We Use Your Information</h2>
            <p className="mb-3">We use your information for the following purposes:</p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li><strong>Service Delivery:</strong> To provide, maintain, and improve our platform services</li>
              <li><strong>Task Processing:</strong> To process task completions, verify submissions, and manage credit transactions</li>
              <li><strong>Account Management:</strong> To create and manage your account, authenticate your identity</li>
              <li><strong>Communication:</strong> To send you important updates, security alerts, and support responses</li>
              <li><strong>Fraud Prevention:</strong> To detect, prevent, and address fraud, abuse, and security issues</li>
              <li><strong>Analytics:</strong> To analyze usage patterns and improve our platform performance</li>
              <li><strong>Legal Compliance:</strong> To comply with legal obligations and enforce our terms</li>
              <li><strong>Social Verification:</strong> To verify social media accounts via OAuth APIs (with your consent)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">4. Data Sharing and Disclosure</h2>
            <p className="mb-3">We do not sell your personal data. We may share your information only in the following circumstances:</p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li><strong>Service Providers:</strong> With third-party service providers who perform services on our behalf (e.g., hosting, email delivery, analytics) under strict confidentiality agreements</li>
              <li><strong>Social Media Platforms:</strong> With YouTube, Twitch, Spotify, etc., only when you explicitly connect your account via OAuth for verification purposes</li>
              <li><strong>Legal Requirements:</strong> When required by law, court order, or government authority</li>
              <li><strong>Business Transfer:</strong> In connection with a merger, acquisition, or sale of assets (with notice)</li>
              <li><strong>Safety:</strong> To protect our rights, property, or safety, or that of our users or the public</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">5. Data Security</h2>
            <p className="mb-3 leading-relaxed">
              We implement industry-standard security measures to protect your information:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li><strong>Encryption:</strong> All passwords are hashed using Argon2. OAuth tokens are encrypted at rest using AES-256 encryption. Data in transit is protected via TLS 1.3.</li>
              <li><strong>Access Control:</strong> Access to personal data is restricted to authorized personnel who need it for their job functions.</li>
              <li><strong>Monitoring:</strong> We regularly monitor our systems for security vulnerabilities and unauthorized access.</li>
              <li><strong>Retention:</strong> We retain your data only as long as necessary for the purposes outlined in this policy, unless required by law.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">6. Your Rights and Choices</h2>
            <p className="mb-3">You have the following rights regarding your personal data:</p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li><strong>Access:</strong> Request a copy of your personal data</li>
              <li><strong>Correction:</strong> Request correction of inaccurate or incomplete data</li>
              <li><strong>Deletion:</strong> Request deletion of your account and associated data (subject to legal retention requirements)</li>
              <li><strong>Portability:</strong> Request transfer of your data to another service</li>
              <li><strong>Objection:</strong> Object to processing of your data for certain purposes</li>
              <li><strong>Withdraw Consent:</strong> Withdraw consent for data processing where consent is the legal basis</li>
              <li><strong>Opt-out:</strong> Opt-out of marketing communications (you can still receive essential service communications)</li>
            </ul>
            <p className="mt-3">
              To exercise these rights, please contact us at the address provided in Section 9.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">7. Cookies and Tracking</h2>
            <p className="mb-3 leading-relaxed">
              We use cookies and similar technologies to:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Remember your login session and preferences</li>
              <li>Analyze platform usage and improve performance</li>
              <li>Provide personalized content and features</li>
            </ul>
            <p className="mt-3">
              You can control cookies through your browser settings. Note that disabling certain cookies may affect platform functionality.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">8. Third-Party Services</h2>
            <p className="mb-3">Our platform integrates with the following third-party services:</p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li><strong>Google OAuth:</strong> For YouTube account verification and profile access</li>
              <li><strong>Twitch OAuth:</strong> For Twitch account verification and profile access</li>
              <li><strong>Spotify OAuth:</strong> For Spotify account verification and profile access</li>
              <li><strong>Email Providers:</strong> For transactional email delivery (e.g., SendGrid)</li>
              <li><strong>Analytics:</strong> For platform usage analytics (e.g., Sentry, Grafana)</li>
            </ul>
            <p className="mt-3">
              These services have their own privacy policies. We encourage you to review them.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">9. Children&apos;s Privacy</h2>
            <p className="leading-relaxed">
              Our platform is not intended for children under the age of 13. We do not knowingly collect personal information from children under 13. If we become aware that we have collected such information, we will take steps to delete it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">10. International Data Transfers</h2>
            <p className="leading-relaxed">
              Your information may be transferred to and processed in countries other than your country of residence. We ensure appropriate safeguards are in place to protect your data in accordance with this Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">11. Changes to This Policy</h2>
            <p className="leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the new policy on our platform and updating the &ldquo;Last updated&rdquo; date. Your continued use of the platform after such changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">12. Contact Us</h2>
            <p className="mb-2">
              If you have questions, concerns, or requests regarding this Privacy Policy or your personal data, please contact us:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Through our <Link href="/contact" className="text-brand-400 hover:underline">contact page</Link></li>
              <li>By email at: privacy@engganyo.com</li>
            </ul>
          </section>

          <section className="pt-8 border-t border-surface-border">
            <p className="text-sm text-zinc-500">
              Last updated: {new Date().toLocaleDateString()}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
