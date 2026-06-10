import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import * as nodemailer from 'nodemailer';

import { announcementEmailTemplate } from './email.templates';

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

  constructor(
    @InjectQueue(EMAIL_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

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

  /** Send announcement directly (not via queue) — used for test sends to get immediate feedback */
  async sendAnnouncementEmailDirect(
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
    const mailer = nodemailer.createTransport({
      host: this.config.get<string>('email.host', 'localhost'),
      port: this.config.get<number>('email.port', 587),
      secure: this.config.get<boolean>('email.secure', false),
      auth: this.config.get<string>('email.user')
        ? {
            user: this.config.get<string>('email.user')!,
            pass: this.config.get<string>('email.pass')!,
          }
        : undefined,
    });

    const fromName = this.config.get<string>('email.fromName', 'Engganyo');
    const fromEmail = this.config.get<string>('email.fromEmail', 'no-reply@engganyo.com');

    try {
      const info = await mailer.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to,
        subject: data.subject,
        html: announcementEmailTemplate(data),
      });

      this.logger.log(`Direct announcement sent → ${to} | response: ${info.response}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Direct announcement FAILED → ${to} | subject: "${data.subject}" | SMTP host: ${this.config.get<string>('email.host')} | error: ${msg}`,
      );
      throw new Error(`Email send failed: ${msg}`);
    }
  }
}
