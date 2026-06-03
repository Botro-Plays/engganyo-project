import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { createHmac } from 'crypto';
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
            metadata: { depositId },
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
    const secret = await this.getWebhookSecret();
    if (!secret) {
      this.logger.warn('PayMongo webhook received but no webhook secret configured');
      throw new BadRequestException('Webhook secret not configured');
    }

    const payload = JSON.parse(rawBody);
    const eventType = payload.data?.attributes?.type as string;
    const eventData = payload.data?.attributes?.data;
    const testMode = payload.data?.attributes?.livemode === false;

    const signatureParts = signatureHeader.split(',');
    let timestamp = '';
    for (const part of signatureParts) {
      const [key, val] = part.split('=');
      if (key.trim() === 't') {
        timestamp = val.trim();
        break;
      }
    }

    const isValid = this.verifyWebhookSignature(timestamp, testMode, rawBody, signatureHeader, secret);
    if (!isValid) {
      this.logger.warn('PayMongo webhook signature verification failed');
      throw new BadRequestException('Invalid webhook signature');
    }

    this.logger.log(`PayMongo webhook: ${eventType}`);

    if (eventType === 'payment.paid' || eventType === 'payment.success') {
      const payment = eventData?.attributes;
      const metadata = payment?.metadata ?? {};
      const depositId = metadata.depositId as string | undefined;
      const paymentId = eventData?.id as string | undefined;

      if (!depositId) {
        this.logger.warn('PayMongo webhook missing depositId in metadata');
        return { received: true, action: 'ignored' };
      }

      await this.walletService.completeDeposit(depositId, { paymentRef: paymentId });
      return { received: true, action: 'completed', depositId };
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
