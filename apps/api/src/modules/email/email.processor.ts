import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import * as nodemailer from 'nodemailer';

import { EMAIL_QUEUE, EMAIL_JOBS } from './email.service';
import { verificationEmailTemplate, passwordResetEmailTemplate } from './email.templates';

interface EmailJobData {
  to: string;
  token: string;
}

@Processor(EMAIL_QUEUE)
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);
  private readonly mailer: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    this.mailer = nodemailer.createTransport({
      host: this.config.get<string>('email.host', 'localhost'),
      port: this.config.get<number>('email.port', 1025),
      secure: this.config.get<boolean>('email.secure', false),
      auth: this.config.get<string>('email.user')
        ? {
            user: this.config.get<string>('email.user'),
            pass: this.config.get<string>('email.pass'),
          }
        : undefined,
    });
  }

  @Process(EMAIL_JOBS.SEND_VERIFICATION)
  async handleVerification(job: Job<EmailJobData>): Promise<void> {
    const { to, token } = job.data;
    const frontendUrl = this.config.get<string>('app.frontendUrl', 'http://localhost:3000');
    const fromName = this.config.get<string>('email.fromName', 'Engganyo');
    const fromEmail = this.config.get<string>('email.fromEmail', 'noreply@engganyo.com');

    const verifyUrl = `${frontendUrl}/verify-email?token=${token}`;
    await this.mailer.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject: 'Verify your Engganyo account',
      html: verificationEmailTemplate(verifyUrl),
    });

    this.logger.log(`Verification email sent → ${to}`);
  }

  @Process(EMAIL_JOBS.SEND_PASSWORD_RESET)
  async handlePasswordReset(job: Job<EmailJobData>): Promise<void> {
    const { to, token } = job.data;
    const frontendUrl = this.config.get<string>('app.frontendUrl', 'http://localhost:3000');
    const fromName = this.config.get<string>('email.fromName', 'Engganyo');
    const fromEmail = this.config.get<string>('email.fromEmail', 'noreply@engganyo.com');

    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;
    await this.mailer.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject: 'Reset your Engganyo password',
      html: passwordResetEmailTemplate(resetUrl),
    });

    this.logger.log(`Password-reset email sent → ${to}`);
  }
}
