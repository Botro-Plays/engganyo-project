import type { Metadata } from 'next';
import Link from 'next/link';
import { innerPageJsonLd } from '@/lib/jsonld';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';

// Uniform public-page caching: one hour shared cache with
// stale-while-revalidate (emits s-maxage=3600).
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'FAQ',
  description:
    'Frequently asked questions about Engganyo: how credits work, how tasks are reviewed, which platforms are supported, and how to get started.',
  alternates: { canonical: 'https://engganyo.com/faq' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'FAQ | Engganyo',
    description:
      'How Engganyo credits work: earn them on tasks, spend them on campaigns, buy more in your wallet. No cash withdrawals.',
    url: 'https://engganyo.com/faq',
  },
  twitter: {
    title: 'FAQ | Engganyo',
    description:
      'How Engganyo credits work: earn them on tasks, spend them on campaigns, buy more in your wallet. No cash withdrawals.',
  },
};

const faqs = [
  {
    category: 'Getting started',
    questions: [
      {
        q: 'What is Engganyo?',
        a: 'A web platform where creators help each other grow with small tasks and credits. Members complete tasks for other creators, earn credits, and spend them on campaigns for their own accounts.',
      },
      {
        q: 'How do I create an account?',
        a: 'Click "Sign Up" on the homepage, fill in your username, email, and password. You\'ll need to verify your email address before you can start.',
      },
      {
        q: 'Is Engganyo free to use?',
        a: 'Joining is free and every member starts with 200 free credits. No card is needed. You can earn more credits by completing tasks, or buy credits in your wallet if you want to run larger campaigns.',
      },
    ],
  },
  {
    category: 'Earning and spending credits',
    questions: [
      {
        q: 'How do I earn credits?',
        a: 'Browse the open tasks, accept one, do the action on that platform, and upload a screenshot as proof. The campaign owner reviews it, and credits are released to your wallet once it is approved.',
      },
      {
        q: 'How do I spend credits?',
        a: 'Create a campaign: choose a platform, add your link, set the reward for each task and how many completions you want. Credits for the campaign budget are held until the campaign ends or tasks are approved.',
      },
      {
        q: 'Can I buy credits?',
        a: 'Yes. The wallet page offers credit purchases; available payment methods depend on your region and are shown during checkout. Purchased credits work exactly like earned credits.',
      },
      {
        q: 'Can I withdraw credits as money?',
        a: 'No. Credits are used inside Engganyo. They pay for campaigns and platform features, and cannot be withdrawn as money.',
      },
      {
        q: 'What happens if my task is rejected?',
        a: 'If your proof doesn\'t meet the campaign requirements, it will be rejected. You can review the reason, correct your submission, and try again.',
      },
      {
        q: 'How long does review take?',
        a: 'The campaign owner reviews your proof, usually within 48 hours. You can check the status on your tasks page at any time.',
      },
    ],
  },
  {
    category: 'Platforms and tasks',
    questions: [
      {
        q: 'Which platforms are supported?',
        a: 'Tasks are available for TikTok, Instagram, Facebook, X, Telegram, Discord, Twitch, Spotify, Trustpilot, and Google. Each platform has its own rules, so read them before running or completing a task. Engganyo does not offer rewarded YouTube engagement tasks.',
      },
      {
        q: 'How are tasks verified?',
        a: 'Most tasks are reviewed manually: you upload proof and the campaign owner approves or rejects it. Some tasks, like Twitch and Spotify follows, verify automatically through a linked account instead.',
      },
      {
        q: 'Can I complete the same campaign twice?',
        a: 'No, each campaign can only be completed once per account to keep distribution fair.',
      },
      {
        q: 'What if a campaign runs out of slots?',
        a: 'Campaigns have limited slots set by their creator. Once filled, the campaign closes. Check back for new ones.',
      },
    ],
  },
  {
    category: 'Account and security',
    questions: [
      {
        q: 'Can I have multiple accounts?',
        a: 'No, having multiple accounts is against our Terms of Service and may result in permanent suspension. One account per person is strictly enforced.',
      },
      {
        q: 'How do I reset my password?',
        a: 'Click "Forgot Password" on the login page, enter your email, and follow the instructions sent to your inbox.',
      },
      {
        q: 'Is my personal information secure?',
        a: 'We use industry-standard encryption and security practices to protect your data. See our Privacy Policy for details.',
      },
      {
        q: 'Can I delete my account?',
        a: 'Yes, you can request account deletion from the Settings page. This action is irreversible and your data will be permanently removed.',
      },
    ],
  },
];

const jsonLd = innerPageJsonLd({
  type: 'FAQPage',
  path: '/faq',
  name: 'Frequently Asked Questions',
  description:
    'Answers about Engganyo credits, task review, supported platforms, and accounts.',
  breadcrumb: 'FAQ',
  mainEntity: faqs.flatMap((s) =>
    s.questions.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  ),
});

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-sc text-sc-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader />

      <div className="max-w-3xl mx-auto px-4 py-12">
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

      <PublicFooter />
    </div>
  );
}
