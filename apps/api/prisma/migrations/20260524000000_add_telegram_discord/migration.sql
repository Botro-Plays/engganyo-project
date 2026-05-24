-- AlterEnum: Add Telegram and Discord task types
ALTER TYPE "TaskType" ADD VALUE 'TELEGRAM_JOIN_CHANNEL';
ALTER TYPE "TaskType" ADD VALUE 'TELEGRAM_JOIN_GROUP';
ALTER TYPE "TaskType" ADD VALUE 'DISCORD_JOIN_SERVER';

-- AlterEnum: Add Telegram and Discord as social platforms
ALTER TYPE "SocialPlatform" ADD VALUE 'TELEGRAM';
ALTER TYPE "SocialPlatform" ADD VALUE 'DISCORD';
