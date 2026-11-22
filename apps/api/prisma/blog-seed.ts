import { PrismaClient, BlogPostStatus } from '@prisma/client';

const FIRST_WEEK_BODY = `A good first week on Engganyo is simple. You do not need to buy anything. You only need a few minutes a day.

Day 1: Join and look around. Create your account at [engganyo.com](/). Joining is free and no card is needed. Open your dashboard and look at your balance, your daily reward and the task list.

Day 2: Do one small task. Open the Tasks page and pick a platform you already use. Do the action, such as a follow or a join, then upload a screenshot as proof. The campaign owner reviews it, and your credits arrive in your wallet once it is approved. Some task types, such as follows on linked Twitch or Spotify accounts, verify automatically.

Day 3: Read the rules. Every platform has its own rules about engagement. Read them before you do more tasks. Doing tasks on any exchange site can go against a platform's rules, and platforms can warn, restrict or ban accounts. Start small and decide for yourself.

Day 4 and 5: Build a small streak. Come back each day and claim your daily reward. Do one or two more tasks.

Day 6: Create your first campaign. Open Campaigns, add your own link, choose a platform, set the reward for each task and how many people you want. Keep the reward fair so members want to do it.

Day 7: Check what worked. Look at which tasks were approved fast and which campaign got the most completions. Then repeat what worked.

Never share your social media password with anyone. Engganyo never asks for it. If you have a question, write to [contact@engganyo.com](mailto:contact@engganyo.com) or join our community on Telegram at [t.me/Engganyo](https://t.me/Engganyo).`;

// Supplied by the release handoff. Wording was checked against the
// codebase before import: credits are not called money, the non-
// withdrawable nature is stated without "withdrawn as money" phrasing,
// and every referenced feature (200 welcome credits, daily streak,
// spin wheel, USD packages, store, 1v1 challenges, proof review,
// linked-account verification) exists in the app.
const CREDITS_BODY = `Credits are the balance inside Engganyo. They let creators help each other without anyone paying cash for a task. Here is how they work in plain words.

How you earn credits. You open the Tasks page and pick a task for a platform you use. You do the action, such as a follow or a join, and upload a screenshot as proof. The campaign owner reviews your proof. When it is approved, the credits arrive in your wallet. Some tasks, like certain Twitch and Spotify follows, can verify automatically through a linked account instead.

How you can get more. Every new member starts with 200 free credits. The dashboard also shows a daily streak reward and a free daily spin. If you want to move faster, you can buy credits in the Wallet. The packages are priced in USD and larger packages include bonus credits. Prices and bonuses can change, so check the Wallet for the current packages. Bought credits and earned credits work the same way.

Where credits go. You spend credits on campaigns for your own accounts. When you create a campaign you choose a platform, add your link, set the reward for each task and decide how many people you want. You can also challenge another member in a 1v1 challenge. The reward for a challenge is reserved up front. The store is another place to spend credits.

What credits are not. Credits are used inside Engganyo only. They are not cash and cannot be taken out or converted back.

Keep your account safe. Never share a social media password with anyone. Engganyo never asks for it. Read the rules of each platform before you do a task. Doing tasks on any exchange site can go against a platform's rules, and platforms can warn, restrict or ban accounts.

Want the full picture? Read [how Engganyo works](/howitworks), the [pricing page](/pricing) and the [FAQ](/faq). If you still have a question, write to [contact@engganyo.com](mailto:contact@engganyo.com) or ask on Telegram at [t.me/Engganyo](https://t.me/Engganyo).`;

const SAFETY_BODY = `Task exchange sites can help small creators get noticed. They also carry risk. These simple rules apply to Engganyo and to any similar site.

Rule 1: Never share a password. No honest site needs your social media password. Engganyo never asks for it. If a site asks, leave.

Rule 2: Read the platform's rules first. Every platform decides what is allowed. Doing tasks on any exchange site can go against a platform's rules, and platforms can warn, restrict or ban accounts. Engganyo cannot change that, so read the rules before you start.

Rule 3: Start small. Do one or two tasks and see what happens. Do not run a big campaign on day one.

Rule 4: Keep proof clear. Upload a clean screenshot that shows what the task asked for. Clear proof gets approved faster.

Rule 5: Check who reviews your work. On Engganyo the campaign owner reviews your proof before credits are released, and some tasks verify automatically through a linked account. Know which kind of task you are doing.

Rule 6: Keep your money plan simple. Credits are not cash on Engganyo and cannot be taken out or converted back. Only buy credits if you want to run campaigns, and only the amount you are happy to spend.

If something goes wrong. If a platform warns or restricts an account, Engganyo cannot reverse that, because the platform makes that decision alone. If a task was approved or rejected by mistake, write to us with your username and the task, by email or on Telegram.

More details are on the [safety page](/safety) and in the [FAQ](/faq). Questions? [contact@engganyo.com](mailto:contact@engganyo.com) or [t.me/Engganyo](https://t.me/Engganyo).`;

const SEED_POSTS = [
  {
    slug: 'yourfirstweekonengganyo',
    title: 'Your first week on Engganyo: a simple plan',
    excerpt:
      'A plain guide to your first week on Engganyo: join free, do a few small tasks, earn credits, then try your first campaign.',
    body: FIRST_WEEK_BODY,
    authorName: 'Engganyo',
    ogImageUrl: '/brand/social-1200x630.png',
    status: BlogPostStatus.PUBLISHED,
    publishedAt: new Date('2026-11-22T00:00:00.000Z'),
  },
  {
    slug: 'howcreditsworkonengganyo',
    title: 'How credits work on Engganyo',
    excerpt:
      'A plain explanation of how credits work on Engganyo: how you earn them, how you can buy them, and where they go.',
    body: CREDITS_BODY,
    authorName: 'Engganyo',
    ogImageUrl: '/brand/social-1200x630.png',
    status: BlogPostStatus.DRAFT,
    publishedAt: null,
  },
  {
    slug: 'stayingsafewithtaskexchanges',
    title: 'Staying safe when you use a task exchange site',
    excerpt:
      'Simple safety rules for using any task exchange site: passwords, platform rules, small first steps and what to do if something goes wrong.',
    body: SAFETY_BODY,
    authorName: 'Engganyo',
    ogImageUrl: '/brand/social-1200x630.png',
    status: BlogPostStatus.DRAFT,
    publishedAt: null,
  },
];

/**
 * Idempotent blog import. Runs on every seed but only creates missing
 * slugs: an empty update object means admin edits are never overwritten
 * by a re-seed. The two supplied posts stay DRAFT until an admin reviews
 * and publishes them through the admin UI.
 */
export async function seedBlogPosts(prisma: PrismaClient): Promise<void> {
  // First-boot import only: once any post exists, admins own the
  // catalog. Without this guard a redeploy would resurrect posts an
  // admin intentionally deleted.
  const existing = await prisma.blogPost.count();
  if (existing > 0) {
    console.log(`   Blog posts already present (${existing}); skipping import`);
    return;
  }
  for (const post of SEED_POSTS) {
    await prisma.blogPost.upsert({
      where: { slug: post.slug },
      update: {},
      create: post,
    });
  }
  console.log(`   Blog posts seeded (${SEED_POSTS.length} slugs, idempotent)`);
}
