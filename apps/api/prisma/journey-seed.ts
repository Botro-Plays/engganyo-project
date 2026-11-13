import { PrismaClient, SocialPlatform } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function makePlayer(email: string, username: string, password: string, balance: number) {
  const passwordHash = await argon2.hash(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      username,
      passwordHash,
      displayName: username,
      referralCode: `ref_${username}`,
      creditBalance: balance,
      wallet: { create: { balance, lifetimeEarned: balance } },
    },
  });
  await prisma.wallet.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, balance, lifetimeEarned: balance },
  });
  return user;
}

async function linkTikTok(userId: string, tid: string, uname: string) {
  await prisma.socialAccount.upsert({
    where: { userId_platform: { userId, platform: SocialPlatform.TIKTOK } },
    update: {},
    create: { userId, platform: SocialPlatform.TIKTOK, platformUserId: tid, platformUsername: uname },
  });
}

async function main() {
  const p1 = await makePlayer('player1@engganyo.test', 'player_one', 'Player1@123456', 1000);
  const p2 = await makePlayer('player2@engganyo.test', 'player_two', 'Player2@123456', 1000);
  await linkTikTok(p1.id, 'tiktok_player1', 'player_one_tt');
  await linkTikTok(p2.id, 'tiktok_player2', 'player_two_tt');
  console.log('player1 (creator):', p1.id, p1.email);
  console.log('player2 (claimant):', p2.id, p2.email);
}

main().finally(() => prisma.$disconnect());
