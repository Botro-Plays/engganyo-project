import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-surface">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link href="/" className="inline-flex items-center text-zinc-400 hover:text-white mb-8">
          ← Back to Home
        </Link>

        <h1 className="text-3xl font-bold text-white mb-8">Privacy Policy</h1>

        <div className="space-y-6 text-zinc-300">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">1. Information We Collect</h2>
            <p className="mb-2">We collect information you provide directly, including:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Account information (username, email, display name)</li>
              <li>Profile information (bio, avatar, social media links)</li>
              <li>Task completion data and proof submissions</li>
              <li>Payment and wallet information</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">2. How We Use Your Information</h2>
            <p className="mb-2">We use your information to:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Provide and improve our services</li>
              <li>Process task completions and payments</li>
              <li>Communicate with you about your account</li>
              <li>Prevent fraud and abuse</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">3. Data Security</h2>
            <p>
              We implement industry-standard security measures to protect your data. All passwords are hashed using argon2, 
              and sensitive data is encrypted in transit and at rest.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">4. Third-Party Services</h2>
            <p className="mb-2">We may use third-party services for:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Payment processing</li>
              <li>Email delivery</li>
              <li>Analytics</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">5. Your Rights</h2>
            <p className="mb-2">You have the right to:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Access your personal data</li>
              <li>Correct inaccurate data</li>
              <li>Delete your account and associated data</li>
              <li>Opt-out of marketing communications</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">6. Contact Us</h2>
            <p>
              For privacy-related questions or requests, please contact us at{' '}
              <Link href="/contact" className="text-brand-400 hover:underline">our contact page</Link>.
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
