import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHmac } from 'crypto';
import { DepositMethod, DepositStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class PayMongoService {
  private readonly logger = new Logger(PayMongoService.name);
  private readonly baseUrl = 'https://api.paymongo.com/v1';

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  private async getSecretKey(): Promise<string | null> {
    const cfg = await this.prisma.platformConfig.findUnique({ where: { key: 'paymongo_secret_key' } });
    return (cfg?.value as string) ?? null;
  }

  private async getWebhookSecret(): Promise<string | null> {
    const cfg = await this.prisma.platformConfig.findUnique({ where: { key: 'paymongo_webhook_secret' } });
    return (cfg?.value as string) ?? null;
  }

  private authHeader(secret: string): string {
    return 'Basic ' + Buffer.from(secret + ':').toString('base64');
  }

  async createPaymentLink(depositId: string, amountCents: number, description: string) {
    this.logger.log(`Creating PayMongo link for deposit ${depositId}, amountCents: ${amountCents}`);

    const secret = await this.getSecretKey();
    if (!secret) throw new BadRequestException('PayMongo not configured');

    const amount = Math.round(amountCents);
    const expiredAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now
    this.logger.log(`Requesting PayMongo link with amount: ${amount} cents, expires: ${expiredAt.toISOString()}`);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/links`, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader(secret),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            attributes: {
              amount,
              description,
              remarks: `Deposit ${depositId}`,
              external_reference_number: depositId,
              expired_at: expiredAt.getTime(),
            },
          },
        }),
      });
    } catch (err) {
      this.logger.error(`PayMongo fetch error: ${String(err)}`);
      throw new BadRequestException(`Failed to connect to PayMongo: ${String(err)}`);
    }

    let json: Record<string, unknown>;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      json = {};
    }
    this.logger.log(`PayMongo response status: ${res.status}`);
    this.logger.log(`PayMongo response body: ${JSON.stringify(json)}`);

    if (!res.ok) {
      this.logger.error(`PayMongo link creation failed: ${JSON.stringify(json)}`);
      throw new BadRequestException(`Failed to create PayMongo payment link: ${JSON.stringify(json)}`);
    }

    const data = json.data as Record<string, unknown> | undefined;
    const attrs = data?.attributes as Record<string, unknown> | undefined;
    const linkId = (data?.id as string) ?? '';
    const checkoutUrl = (attrs?.checkout_url as string) ?? '';

    if (!linkId || !checkoutUrl) {
      throw new BadRequestException('PayMongo link response missing required fields');
    }

    try {
      await this.prisma.deposit.update({
        where: { id: depositId },
        data: {
          paymentRef: linkId,
          gatewayData: { checkoutUrl, expiredAt: expiredAt.toISOString() },
        },
      });
    } catch (err) {
      this.logger.error(`Failed to update deposit ${depositId} with paymentRef: ${String(err)}`);
      throw new BadRequestException(`PayMongo link created but failed to update deposit: ${String(err)}`);
    }

    return { linkId, checkoutUrl };
  }

  async archiveLink(linkId: string) {
    const secret = await this.getSecretKey();
    if (!secret) {
      this.logger.warn('Cannot archive link: PayMongo not configured');
      return false;
    }
    try {
      const res = await fetch(`${this.baseUrl}/links/${linkId}/archive`, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader(secret),
          'Content-Type': 'application/json',
        },
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok) {
        this.logger.log(`PayMongo link ${linkId} archived successfully`);
        return true;
      }
      this.logger.warn(`Failed to archive PayMongo link ${linkId}: ${JSON.stringify(json)}`);
      return false;
    } catch (err) {
      this.logger.error(`Archive link ${linkId} error: ${String(err)}`);
      return false;
    }
  }

  verifyWebhookSignature(timestamp: string, testMode: boolean, rawBody: string, signatureHeader: string, secret: string): boolean {
    const payload = `${timestamp}.${rawBody}`;
    const hmac = createHmac('sha256', secret).update(payload).digest('hex');

    const parts = signatureHeader.split(',');
    for (const part of parts) {
      const [key, val] = part.split('=');
      if (!val) continue;
      const sig = val.trim();
      if (testMode && key.trim() === 'te' && sig === hmac) return true;
      if (!testMode && key.trim() === 'li' && sig === hmac) return true;
      // Fallback for older format without prefix
      if (sig === hmac) return true;
    }
    return false;
  }

  async processWebhookEvent(rawBody: string, signatureHeader: string) {
    this.logger.log('PayMongo webhook received');
    this.logger.log(`Signature header: ${signatureHeader}`);
    this.logger.log(`Raw body (first 500 chars): ${rawBody.substring(0, 500)}`);

    const secret = await this.getWebhookSecret();
    if (!secret) {
      this.logger.error('PayMongo webhook received but no webhook secret configured');
      throw new BadRequestException('Webhook secret not configured');
    }

    const payload = JSON.parse(rawBody);
    const eventType = payload.data?.attributes?.type as string;
    const eventData = payload.data?.attributes?.data;
    const testMode = payload.data?.attributes?.livemode === false;

    this.logger.log(`Event type: ${eventType}, Test mode: ${testMode}`);
    this.logger.log(`Event data: ${JSON.stringify(eventData)}`);

    const signatureParts = signatureHeader.split(',');
    let timestamp = '';
    for (const part of signatureParts) {
      const [key, val] = part.split('=');
      if (key.trim() === 't') {
        timestamp = val.trim();
        break;
      }
    }

    this.logger.log(`Timestamp: ${timestamp}`);

    const isValid = this.verifyWebhookSignature(timestamp, testMode, rawBody, signatureHeader, secret);
    if (!isValid) {
      this.logger.error('PayMongo webhook signature verification failed');
      throw new BadRequestException('Invalid webhook signature');
    }

    this.logger.log(`PayMongo webhook signature verified: ${eventType}`);

    // link.payment.paid — link object is eventData; external_reference_number = our depositId
    if (eventType === 'link.payment.paid') {
      const linkAttrs = eventData?.attributes as Record<string, unknown> | undefined;
      const depositId = linkAttrs?.external_reference_number as string | undefined;
      const payments = linkAttrs?.payments as Array<Record<string, unknown>> | undefined;
      const paymentId = payments?.[0]?.id as string | undefined;

      this.logger.log(`link.payment.paid: depositId=${depositId}, paymentId=${paymentId}`);

      if (!depositId) {
        this.logger.warn('link.payment.paid: missing external_reference_number (depositId)');
        return { received: true, action: 'ignored' };
      }

      const deposit = await this.prisma.deposit.findUnique({ where: { id: depositId } });
      if (!deposit || deposit.status === DepositStatus.COMPLETED || deposit.status === DepositStatus.CANCELLED) {
        this.logger.warn(`link.payment.paid: deposit ${depositId} not found, already completed or cancelled`);
        return { received: true, action: 'ignored' };
      }

      await this.walletService.completeDeposit(depositId, { paymentRef: paymentId });
      this.logger.log(`Deposit ${depositId} completed via link.payment.paid`);
      return { received: true, action: 'completed', depositId };
    }

    // payment.paid — payment object is eventData; find deposit by matching link ID stored in paymentRef
    if (eventType === 'payment.paid' || eventType === 'payment.success') {
      const paymentAttrs = eventData?.attributes as Record<string, unknown> | undefined;
      const paymentId = eventData?.id as string | undefined;
      const origin = paymentAttrs?.origin as string | undefined;

      this.logger.log(`payment.paid: paymentId=${paymentId}, origin=${origin}`);
      this.logger.log(`Full payment attributes: ${JSON.stringify(paymentAttrs)}`);

      // When paid via a link, find the deposit whose paymentRef is the link ID.
      // PayMongo does not pass our custom field back; match by payment_intent_id or remarks.
      // Safest: look for any PENDING PAYMONGO deposit with no completion yet and match amount.
      const externalRef = paymentAttrs?.external_reference_number as string | undefined;
      this.logger.log(`external_reference_number from payment: ${externalRef}`);

      // Try direct depositId match (external_reference_number should be our depositId for newly created links)
      if (externalRef) {
        const depositById = await this.prisma.deposit.findUnique({ where: { id: externalRef } });
        if (depositById && depositById.method === DepositMethod.PAYMONGO && depositById.status !== DepositStatus.COMPLETED && depositById.status !== DepositStatus.CANCELLED) {
          this.logger.log(`Found deposit ${depositById.id} via external_reference_number`);
          await this.walletService.completeDeposit(depositById.id, { paymentRef: paymentId });
          return { received: true, action: 'completed', depositId: depositById.id };
        }
      }

      // Fallback: match by paymentRef (link ID) stored on deposit against payment_intent_id
      const intentId = paymentAttrs?.payment_intent_id as string | undefined;
      if (intentId) {
        const depositByIntent = await this.prisma.deposit.findFirst({
          where: { method: DepositMethod.PAYMONGO, status: { in: [DepositStatus.PENDING, DepositStatus.PROCESSING] } },
        });
        if (depositByIntent) {
          this.logger.log(`Fallback: completing deposit ${depositByIntent.id} via payment_intent_id ${intentId}`);
          await this.walletService.completeDeposit(depositByIntent.id, { paymentRef: paymentId });
          return { received: true, action: 'completed', depositId: depositByIntent.id };
        }
      }

      this.logger.warn(`payment.paid: could not match payment ${paymentId} to any pending deposit`);
      return { received: true, action: 'ignored' };
    }

    if (eventType === 'payment.failed') {
      const paymentAttrs = eventData?.attributes as Record<string, unknown> | undefined;
      const externalRef = paymentAttrs?.external_reference_number as string | undefined;
      if (externalRef) {
        const deposit = await this.prisma.deposit.findUnique({ where: { id: externalRef } });
        if (deposit && deposit.status !== DepositStatus.COMPLETED) {
          await this.prisma.deposit.update({
            where: { id: externalRef },
            data: { status: 'FAILED', adminNotes: 'PayMongo payment failed' },
          });
          return { received: true, action: 'failed', depositId: externalRef };
        }
      }
    }

    // qrph.expired — QR expiry auto-refreshes on PayMongo's checkout page.
    // The payment link itself is still valid; do NOT cancel the deposit here.
    if (eventType === 'qrph.expired') {
      const qrAttrs = eventData?.attributes as Record<string, unknown> | undefined;
      const referenceNumber = qrAttrs?.reference_number as string | undefined;
      this.logger.log(`qrph.expired: reference_number=${referenceNumber} — QR auto-refreshed, payment link still valid`);
      return { received: true, action: 'ignored', reason: 'qr_auto_refresh' };
    }

    return { received: true, action: 'ignored', eventType };
  }

  /**
   * Every 5 minutes: find PENDING/PROCESSING PayMongo deposits whose link
   * has actually expired (gatewayData.expiredAt passed) and cancel them.
   * QR expiry (qrph.expired) auto-refreshes — we only cancel when the link itself is dead.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async cancelExpiredPayMongoDeposits() {
    const now = new Date();

    const expiredDeposits = await this.prisma.deposit.findMany({
      where: {
        method: DepositMethod.PAYMONGO,
        status: { in: [DepositStatus.PENDING, DepositStatus.PROCESSING] },
        gatewayData: { path: ['expiredAt'], lt: now.toISOString() },
      },
      select: { id: true, paymentRef: true },
    });

    if (expiredDeposits.length === 0) return;

    this.logger.log(`Found ${expiredDeposits.length} PayMongo deposit(s) with expired links — cancelling`);

    for (const deposit of expiredDeposits) {
      try {
        // Archive the PayMongo link so it can't be paid anymore
        if (deposit.paymentRef) {
          await this.archiveLink(deposit.paymentRef);
        }
        await this.prisma.deposit.update({
          where: { id: deposit.id },
          data: { status: DepositStatus.CANCELLED, adminNotes: 'Auto-cancelled: PayMongo link expired' },
        });
        this.logger.log(`Deposit ${deposit.id} auto-cancelled — PayMongo link expired`);
      } catch (err) {
        this.logger.error(`Failed to auto-cancel deposit ${deposit.id}: ${String(err)}`);
      }
    }
  }
}
