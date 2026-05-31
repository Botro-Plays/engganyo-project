import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bullmq';

export const EMAIL_QUEUE = 'email';

export const EMAIL_JOBS = {
  SEND_VERIFICATION: 'send-verification',
  SEND_PASSWORD_RESET: 'send-password-reset',
  SEND_TWO_FACTOR: 'send-two-factor',
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
}
