import { PrismaClient, UserRole, UserStatus, CampaignStatus, TaskType } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱 Seeding database...');

  // ─── Admin User ──────────────────────────────────────────────
  const adminPassword = await argon2.hash(
    process.env['ADMIN_PASSWORD'] ?? 'Admin@123456',
  );

  const admin = await prisma.user.upsert({
    where: { email: process.env['ADMIN_EMAIL'] ?? 'admin@engganyo.com' },
    update: {},
    create: {
      email: process.env['ADMIN_EMAIL'] ?? 'admin@engganyo.com',
      username: 'admin',
      passwordHash: adminPassword,
      displayName: 'Engganyo Admin',
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      referralCode: 'ADMIN0001',
      profile: {
        create: {
          isPublic: false,
        },
      },
      wallet: {
        create: {
          balance: 0,
        },
      },
      trustScore: {
        create: {
          score: 100,
          level: 'VERIFIED',
        },
      },
    },
  });
  console.log(`✅ Admin user: ${admin.email}`);

  // ─── Owner / super-admin account ─────────────────────────────
  await prisma.user.updateMany({
    where: {
      OR: [
        { email: 'aquariusbotro@gmail.com' },
        { username: 'botro' },
      ],
    },
    data: {
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
    },
  });
  console.log('✅ Owner account (botro) ensured as SUPER_ADMIN');

  // ─── Achievements ────────────────────────────────────────────
  const achievements = [
    {
      name: 'First Steps',
      slug: 'first-steps',
      description: 'Complete your first task',
      category: 'ENGAGEMENT' as const,
      requirement: 1,
      creditReward: 50,
      xpReward: 100,
      icon: '🚀',
      sortOrder: 1,
    },
    {
      name: 'Task Champion',
      slug: 'task-champion',
      description: 'Complete 10 tasks',
      category: 'ENGAGEMENT' as const,
      requirement: 10,
      creditReward: 100,
      xpReward: 250,
      icon: '⚡',
      sortOrder: 2,
    },
    {
      name: 'Task Master',
      slug: 'task-master',
      description: 'Complete 50 tasks',
      category: 'ENGAGEMENT' as const,
      requirement: 50,
      creditReward: 300,
      xpReward: 750,
      icon: '🏆',
      sortOrder: 3,
    },
    {
      name: 'Campaign Creator',
      slug: 'campaign-creator',
      description: 'Create your first campaign',
      category: 'CREATOR' as const,
      requirement: 1,
      creditReward: 50,
      xpReward: 150,
      icon: '🎯',
      sortOrder: 10,
    },
    {
      name: 'Referral Pioneer',
      slug: 'referral-pioneer',
      description: 'Refer your first friend',
      category: 'COMMUNITY' as const,
      requirement: 1,
      creditReward: 100,
      xpReward: 200,
      icon: '👥',
      sortOrder: 20,
    },
    {
      name: '7-Day Streak',
      slug: '7-day-streak',
      description: 'Log in 7 days in a row',
      category: 'DEDICATION' as const,
      requirement: 7,
      creditReward: 75,
      xpReward: 200,
      icon: '🔥',
      sortOrder: 30,
    },
    {
      name: 'Social Butterfly',
      slug: 'social-butterfly',
      description: 'Connect 3 social accounts',
      category: 'COMMUNITY' as const,
      requirement: 3,
      creditReward: 150,
      xpReward: 300,
      icon: '🦋',
      sortOrder: 21,
    },
  ];

  for (const achievement of achievements) {
    await prisma.achievement.upsert({
      where: { slug: achievement.slug },
      update: {},
      create: achievement,
    });
  }
  console.log(`✅ Seeded ${achievements.length} achievements`);

  // ─── Daily Missions ──────────────────────────────────────────
  const missions = [
    {
      name: 'Daily Grind',
      description: 'Complete 3 tasks today',
      type: 'COMPLETE_N_TASKS' as const,
      requirement: 3,
      creditReward: 30,
      xpReward: 75,
      icon: '✅',
      sortOrder: 1,
    },
    {
      name: 'Power User',
      description: 'Complete 5 tasks today',
      type: 'COMPLETE_N_TASKS' as const,
      requirement: 5,
      creditReward: 60,
      xpReward: 150,
      icon: '💪',
      sortOrder: 2,
    },
    {
      name: 'Campaign Launch',
      description: 'Create a campaign today',
      type: 'CREATE_CAMPAIGN' as const,
      requirement: 1,
      creditReward: 20,
      xpReward: 50,
      icon: '🚀',
      sortOrder: 3,
    },
  ];

  for (const mission of missions) {
    await prisma.dailyMission.upsert({
      where: { name: mission.name },
      update: {},
      create: mission,
    });
  }
  console.log(`✅ Seeded ${missions.length} daily missions`);

  // ─── Platform Configs ────────────────────────────────────────
  const configs = [
    {
      key: 'credits.welcome_bonus',
      value: 200,
      description: 'Credits given to new users on registration',
      isPublic: true,
    },
    {
      key: 'credits.daily_login',
      value: 10,
      description: 'Credits for daily login',
      isPublic: true,
    },
    {
      key: 'credits.referral_referrer',
      value: 100,
      description: 'Credits awarded to referrer when referee qualifies',
      isPublic: true,
    },
    {
      key: 'credits.referral_referee',
      value: 50,
      description: 'Credits awarded to new user who used a referral code',
      isPublic: true,
    },
    {
      key: 'tasks.min_credit_per_task',
      value: 10,
      description: 'Minimum credits that can be set per task',
      isPublic: true,
    },
    {
      key: 'tasks.max_credit_per_task',
      value: 500,
      description: 'Maximum credits that can be set per task',
      isPublic: true,
    },
    {
      key: 'tasks.min_slots',
      value: 10,
      description: 'Minimum task slots per campaign',
      isPublic: true,
    },
    {
      key: 'tasks.max_slots',
      value: 10000,
      description: 'Maximum task slots per campaign',
      isPublic: true,
    },
    {
      key: 'trust.min_score_to_complete_tasks',
      value: 0,
      description: 'Minimum trust score to complete tasks',
      isPublic: false,
    },
    {
      key: 'trust.vpn_penalty',
      value: -20,
      description: 'Trust score deduction for VPN detected',
      isPublic: false,
    },
  ];

  for (const config of configs) {
    await prisma.platformConfig.upsert({
      where: { key: config.key },
      update: {},
      create: {
        key: config.key,
        value: config.value,
        description: config.description,
        isPublic: config.isPublic,
      },
    });
  }
  console.log(`✅ Seeded ${configs.length} platform configs`);

  // ─── Sample Platform Campaigns ──────────────────────────────
  const sampleCampaigns = [
    {
      title: 'Subscribe to Engganyo on YouTube',
      description: 'Help us grow our YouTube channel! Subscribe and turn on notifications.',
      taskType: TaskType.YOUTUBE_SUBSCRIBE,
      targetUrl: 'https://youtube.com/@engganyo',
      totalSlots: 100,
      creditPerTask: 50,
      proofInstructions: 'Take a screenshot showing you are subscribed and paste the URL.',
    },
    {
      title: 'Follow Engganyo on TikTok',
      description: 'Follow our TikTok account for daily creator tips and platform updates.',
      taskType: TaskType.TIKTOK_FOLLOW,
      targetUrl: 'https://tiktok.com/@engganyo',
      totalSlots: 200,
      creditPerTask: 30,
      proofInstructions: 'Screenshot your follower confirmation screen.',
    },
    {
      title: 'Follow Engganyo on Instagram',
      description: 'Follow our Instagram for behind-the-scenes content and updates.',
      taskType: TaskType.INSTAGRAM_FOLLOW,
      targetUrl: 'https://instagram.com/engganyo',
      totalSlots: 150,
      creditPerTask: 30,
      proofInstructions: 'Screenshot your profile showing you are following.',
    },
    {
      title: 'Follow Engganyo on Twitter/X',
      description: 'Follow us on Twitter/X to stay up-to-date with announcements.',
      taskType: TaskType.TWITTER_FOLLOW,
      targetUrl: 'https://twitter.com/engganyo',
      totalSlots: 150,
      creditPerTask: 25,
      proofInstructions: 'Screenshot showing you are following @engganyo.',
    },
    {
      title: 'Like our YouTube Introduction Video',
      description: 'Watch and like our intro video to help with YouTube reach.',
      taskType: TaskType.YOUTUBE_LIKE,
      targetUrl: 'https://youtube.com/watch?v=example',
      totalSlots: 300,
      creditPerTask: 20,
      proofInstructions: 'Screenshot the video page showing your like.',
    },
    {
      title: 'Retweet our Platform Launch Post',
      description: 'Help spread the word about Engganyo by retweeting our launch post.',
      taskType: TaskType.TWITTER_RETWEET,
      targetUrl: 'https://twitter.com/engganyo/status/example',
      totalSlots: 500,
      creditPerTask: 15,
      proofInstructions: 'Screenshot your retweet confirmation.',
    },
  ];

  for (const campaign of sampleCampaigns) {
    const existing = await prisma.campaign.findFirst({
      where: { title: campaign.title, userId: admin.id },
    });
    if (!existing) {
      await prisma.campaign.create({
        data: {
          userId: admin.id,
          title: campaign.title,
          description: campaign.description,
          taskType: campaign.taskType,
          targetUrl: campaign.targetUrl,
          totalSlots: campaign.totalSlots,
          creditPerTask: campaign.creditPerTask,
          totalCost: campaign.totalSlots * campaign.creditPerTask,
          status: CampaignStatus.ACTIVE,
          requiresProof: true,
          proofInstructions: campaign.proofInstructions,
          targetCountries: [],
          targetLanguages: [],
        },
      });
    }
  }
  console.log(`✅ Seeded ${sampleCampaigns.length} sample platform campaigns`);

  console.log('✅ Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
