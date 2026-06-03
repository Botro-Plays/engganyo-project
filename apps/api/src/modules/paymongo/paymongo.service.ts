import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
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
    const secret = await this.getSecretKey();
    if (!secret) throw new BadRequestException('PayMongo not configured');

    const res = await fetch(`${this.baseUrl}/links`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(secret),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          attributes: {
            amount: Math.round(amountCents),
            description,
            remarks: `Deposit ${depositId}`,
            external_reference_number: depositId,
          },
        },
      }),
    });

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      this.logger.error(`PayMongo link creation failed: ${JSON.stringify(json)}`);
      throw new BadRequestException('Failed to create PayMongo payment link');
    }

    const data = json.data as Record<string, unknown> | undefined;
    const attrs = data?.attributes as Record<string, unknown> | undefined;
    const linkId = (data?.id as string) ?? '';
    const checkoutUrl = (attrs?.checkout_url as string) ?? '';

    if (!linkId || !checkoutUrl) {
      throw new BadRequestException('PayMongo link response missing required fields');
    }

    await this.prisma.deposit.update({
      where: { id: depositId },
      data: { paymentRef: linkId },
    });

    return { linkId, checkoutUrl };
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

    if (eventType === 'payment.paid' || eventType === 'payment.success') {
      const payment = eventData?.attributes;
      const externalRef = payment?.external_reference_number as string | undefined;
      const paymentId = eventData?.id as string | undefined;

      this.logger.log(`External reference number: ${externalRef}`);
      this.logger.log(`Payment ID: ${paymentId}`);

      if (!externalRef) {
        this.logger.warn('PayMongo webhook missing external_reference_number');
        return { received: true, action: 'ignored' };
      }

      // Find deposit by external_reference_number (which we set to depositId)
      const deposit = await this.prisma.deposit.findFirst({
        where: {
          method: DepositMethod.PAYMONGO,
          status: { in: [DepositStatus.PENDING, DepositStatus.PROCESSING] },
          paymentRef: externalRef, // We stored the link ID, but external_ref should match depositId
        },
      });

      if (!deposit) {
        this.logger.warn(`PayMongo webhook: no pending deposit found for external_ref ${externalRef}`);
        // Try finding by id directly as fallback
        const depositById = await this.prisma.deposit.findUnique({
          where: { id: externalRef },
        });
        if (depositById && depositById.status !== DepositStatus.COMPLETED) {
          this.logger.log(`Found deposit by ID as fallback: ${externalRef}`);
          await this.walletService.completeDeposit(externalRef, { paymentRef: paymentId });
          return { received: true, action: 'completed', depositId: externalRef };
        }
        return { received: true, action: 'ignored' };
      }

      this.logger.log(`Found deposit ${deposit.id} for external_ref ${externalRef}`);
      await this.walletService.completeDeposit(deposit.id, { paymentRef: paymentId });
      this.logger.log(`Deposit ${deposit.id} completed successfully`);
      return { received: true, action: 'completed', depositId: deposit.id };
    }

    if (eventType === 'payment.failed') {
      const payment = eventData?.attributes;
      const metadata = payment?.metadata ?? {};
      const depositId = metadata.depositId as string | undefined;
      if (depositId) {
        await this.prisma.deposit.update({
          where: { id: depositId },
          data: { status: 'FAILED', adminNotes: 'PayMongo payment failed' },
        });
        return { received: true, action: 'failed', depositId };
      }
    }

    return { received: true, action: 'ignored', eventType };
  }
}
