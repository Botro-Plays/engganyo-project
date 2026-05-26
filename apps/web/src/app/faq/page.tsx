import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'FAQ - Engganyo',
  description: 'Frequently asked questions about Engganyo. Learn how to earn credits, withdraw earnings, and more.',
  alternates: { canonical: 'https://engganyo.com/faq' },
  robots: { index: true, follow: true },
};

const faqs = [
  {
    category: 'Getting Started',
    questions: [
      {
        q: 'What is Engganyo?',
        a: 'Engganyo is a platform that connects brands with social media users. Users complete social media tasks (like following, subscribing, watching) and earn credits that can be withdrawn as real currency.',
      },
      {
        q: 'How do I create an account?',
        a: 'Click the "Sign Up" button on the homepage, fill in your username, email, and password. You\'ll need to verify your email address before you can start earning.',
      },
      {
        q: 'Is Engganyo free to use?',
        a: 'Yes, creating an account and participating in campaigns is completely free. You earn money by completing tasks, not by paying us.',
      },
    ],
  },
  {
    category: 'Earning Credits',
    questions: [
      {
        q: 'How do I earn credits?',
        a: 'Browse the campaigns page, select a campaign that interests you, complete the required task (e.g., subscribe to a YouTube channel, follow on Twitch), and submit proof. Once verified, credits are added to your wallet.',
      },
      {
        q: 'How are credits calculated?',
        a: 'Each campaign has a set credit reward based on the task difficulty and the brand\'s budget. Credits are awarded upon successful verification of your proof.',
      },
      {
        q: 'What happens if my task is rejected?',
        a: 'If your proof doesn\'t meet the campaign requirements, it will be rejected. You can review the rejection reason, correct your submission, and try again.',
      },
      {
        q: 'How long does verification take?',
        a: 'Verification typically takes 24-72 hours depending on the campaign volume and admin availability. You can check the status in your tasks page.',
      },
    ],
  },
  {
    category: 'Withdrawals',
    questions: [
      {
        q: 'How do I withdraw my earnings?',
        a: 'Go to the Wallet page, check your available balance, and request a withdrawal. You\'ll need to select a payment method and provide the necessary details.',
      },
      {
        q: 'What payment methods are available?',
        a: 'We support various payment methods including PayPal, bank transfer, and other options depending on your region. Available methods are shown in the withdrawal page.',
      },
      {
        q: 'What is the minimum withdrawal amount?',
        a: 'The minimum withdrawal amount varies by payment method. Check the Wallet page for current thresholds.',
      },
      {
        q: 'How long do withdrawals take to process?',
        a: 'Withdrawal processing times vary by method. PayPal is typically instant, while bank transfers may take 3-5 business days.',
      },
    ],
  },
  {
    category: 'Account & Security',
    questions: [
      {
        q: 'Can I have multiple accounts?',
        a: 'No, having multiple accounts is against our Terms of Service and may result in permanent suspension. One account per person is strictly enforced.',
      },
      {
        q: 'How do I reset my password?',
        a: 'Click "Forgot Password" on the login page, enter your email, and follow the instructions sent to your inbox to reset your password.',
      },
      {
        q: 'Is my personal information secure?',
        a: 'Yes, we use industry-standard encryption and security practices to protect your data. We never share your personal information with third parties without your consent.',
      },
      {
        q: 'Can I delete my account?',
        a: 'Yes, you can request account deletion from the Settings page. Note that this action is irreversible and all your data will be permanently removed.',
      },
    ],
  },
  {
    category: 'Campaigns & Tasks',
    questions: [
      {
        q: 'What platforms are supported?',
        a: 'We currently support YouTube, Twitch, and Spotify. More platforms may be added in the future.',
      },
      {
        q: 'Can I participate in the same campaign multiple times?',
        a: 'No, each campaign can only be completed once per account to ensure fair distribution of opportunities.',
      },
      {
        q: 'What type of proof is required?',
        a: 'Proof requirements vary by campaign. Common types include screenshots, video recordings, or links to your completed action. The requirements are clearly listed on each campaign page.',
      },
      {
        q: 'What if a campaign runs out of slots?',
        a: 'Campaigns have limited slots based on the brand\'s budget. Once all slots are filled, the campaign closes. Check back often for new campaigns.',
      },
    ],
  },
  {
    category: 'For Brands',
    questions: [
      {
        q: 'How can I launch a campaign?',
        a: 'Contact our business team at business@engganyo.com to discuss your campaign goals and get started with the brand onboarding process.',
      },
      {
        q: 'What are the pricing options?',
        a: 'Pricing depends on campaign scope, target audience, and duration. Contact us for a custom quote based on your needs.',
      },
      {
        q: 'How do you ensure quality engagement?',
        a: 'We use verification systems, proof review, and anti-fraud measures to ensure all engagement is genuine. Suspicious activity is investigated and removed.',
      },
    ],
  },
];

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-surface">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link href="/" className="inline-flex items-center text-zinc-400 hover:text-white mb-8">
          ← Back to Home
        </Link>

        <h1 className="text-3xl font-bold text-white mb-2">Frequently Asked Questions</h1>
        <p className="text-zinc-400 mb-8">Everything you need to know about Engganyo</p>

        <div className="space-y-8">
          {faqs.map((section) => (
            <section key={section.category} className="card-glass rounded-xl p-6">
              <h2 className="text-xl font-semibold text-white mb-4">{section.category}</h2>
              <div className="space-y-4">
                {section.questions.map((faq, idx) => (
                  <div key={idx} className="border-b border-surface-border pb-4 last:border-0 last:pb-0">
                    <h3 className="text-white font-medium mb-2">{faq.q}</h3>
                    <p className="text-zinc-300 text-sm leading-relaxed">{faq.a}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}

          <section className="card-glass rounded-xl p-6 text-center">
            <h2 className="text-xl font-semibold text-white mb-4">Still have questions?</h2>
            <p className="text-zinc-300 mb-4">
              Can&apos;t find the answer you&apos;re looking for? Please reach out to our support team.
            </p>
            <Link
              href="/contact"
              className="inline-flex items-center px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors"
            >
              Contact Support
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
