import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bullmq';

export const EMAIL_QUEUE = 'email';

export const EMAIL_JOBS = {
  SEND_VERIFICATION: 'send-verification',
  SEND_PASSWORD_RESET: 'send-password-reset',
  SEND_TWO_FACTOR: 'send-two-factor',
  SEND_WEEKLY_DIGEST: 'send-weekly-digest',
  SEND_ANNOUNCEMENT: 'send-announcement',
} as const;

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: 100,
  removeOnFail: 50,
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(@InjectQueue(EMAIL_QUEUE) private readonly queue: Queue) {}

  async queueVerificationEmail(to: string, token: string): Promise<void> {
    await this.queue.add(EMAIL_JOBS.SEND_VERIFICATION, { to, token }, JOB_OPTIONS);
    this.logger.debug(`Queued verification email → ${to}`);
  }

  async queuePasswordResetEmail(to: string, token: string): Promise<void> {
    await this.queue.add(EMAIL_JOBS.SEND_PASSWORD_RESET, { to, token }, JOB_OPTIONS);
    this.logger.debug(`Queued password-reset email → ${to}`);
  }

  async queueTwoFactorEmail(to: string, code: string): Promise<void> {
    await this.queue.add(EMAIL_JOBS.SEND_TWO_FACTOR, { to, code }, JOB_OPTIONS);
    this.logger.debug(`Queued 2FA email → ${to}`);
  }

  async queueWeeklyDigestEmail(
    to: string,
    data: {
      username: string;
      tasksCompleted: number;
      creditsEarned: number;
      currentBalance: number;
      newCampaigns: number;
      weekStart: string;
      weekEnd: string;
      xpEarned?: number;
      tasksInProgress?: number;
      tasksPending?: number;
      totalTasksCompleted?: number;
      weeklyRank?: number;
      allTimeRank?: number;
      streak?: number;
    },
  ): Promise<void> {
    await this.queue.add(EMAIL_JOBS.SEND_WEEKLY_DIGEST, { to, ...data }, JOB_OPTIONS);
    this.logger.debug(`Queued weekly digest → ${to}`);
  }

  async queueAnnouncementEmail(
    to: string,
    data: {
      subject: string;
      title: string;
      bodyHtml: string;
      theme: 'blue' | 'amber' | 'rose';
      ctaLabel?: string;
      ctaUrl?: string;
    },
  ): Promise<void> {
    await this.queue.add(EMAIL_JOBS.SEND_ANNOUNCEMENT, { to, ...data }, JOB_OPTIONS);
    this.logger.debug(`Queued announcement → ${to}`);
  }
}
