import { Injectable, Logger, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { EventsService } from '../events/events.service';
import { DepositStatus } from '@prisma/client';

interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  mode: 'sandbox' | 'live';
  webhookId?: string;
}

@Injectable()
export class PayPalService {
  private readonly logger = new Logger(PayPalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly eventsService: EventsService,
  ) {}

  private async getConfig(): Promise<PayPalConfig | null> {
    const [enabled, clientId, clientSecret, mode, webhookId] = await Promise.all([
      this.prisma.platformConfig.findUnique({ where: { key: 'paypal_enabled' } }),
      this.prisma.platformConfig.findUnique({ where: { key: 'paypal_client_id' } }),
      this.prisma.platformConfig.findUnique({ where: { key: 'paypal_client_secret' } }),
      this.prisma.platformConfig.findUnique({ where: { key: 'paypal_mode' } }),
      this.prisma.platformConfig.findUnique({ where: { key: 'paypal_webhook_id' } }),
    ]);

    if (!enabled?.value) return null;
    return {
      clientId: (clientId?.value as string) ?? '',
      clientSecret: (clientSecret?.value as string) ?? '',
      mode: (mode?.value as 'sandbox' | 'live') ?? 'sandbox',
      webhookId: (webhookId?.value as string) ?? undefined,
    };
  }

  private baseUrl(mode: 'sandbox' | 'live'): string {
    return mode === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
  }

  private async getAccessToken(cfg: PayPalConfig): Promise<string> {
    const res = await fetch(`${this.baseUrl(cfg.mode)}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    const json = (await res.json()) as { access_token?: string };
    if (!res.ok || !json.access_token) {
      this.logger.error(`PayPal token error: ${JSON.stringify(json)}`);
      throw new BadRequestException('Failed to authenticate with PayPal');
    }
    return json.access_token;
  }

  async createOrder(depositId: string, amount: number, currency: string) {
    const cfg = await this.getConfig();
    if (!cfg) throw new BadRequestException('PayPal not configured');

    const accessToken = await this.getAccessToken(cfg);

    const res = await fetch(`${this.baseUrl(cfg.mode)}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: currency,
            value: amount.toFixed(2),
          },
          reference_id: depositId,
          description: `Engganyo deposit ${depositId}`,
        }],
        application_context: {
          return_url: `${process.env['FRONTEND_URL'] ?? 'http://localhost:3000'}/wallet?paypal=success`,
          cancel_url: `${process.env['FRONTEND_URL'] ?? 'http://localhost:3000'}/wallet?paypal=cancel&depositId=${depositId}`,
          brand_name: 'Engganyo',
        },
      }),
    });

    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      this.logger.error(`PayPal create order failed: ${JSON.stringify(json)}`);
      throw new BadRequestException('Failed to create PayPal order');
    }

    const orderId = json.id as string;
    const links = json.links as Array<{ rel: string; href: string }> | undefined;
    const approvalUrl = links?.find((l) => l.rel === 'approve')?.href ?? '';

    if (!orderId || !approvalUrl) {
      throw new BadRequestException('PayPal order response missing required fields');
    }

    await this.prisma.deposit.update({
      where: { id: depositId },
      data: { paymentRef: orderId },
    });

    return { orderId, approvalUrl };
  }

  async captureOrder(orderId: string) {
    const cfg = await this.getConfig();
    if (!cfg) throw new BadRequestException('PayPal not configured');

    // ── Idempotency: find deposit first, skip if already completed ──
    const deposit = await this.prisma.deposit.findUnique({
      where: { paymentRef: orderId },
    });
    if (deposit?.status === DepositStatus.COMPLETED) {
      this.logger.log(`PayPal order ${orderId} already captured — skipping`);
      return { depositId: deposit.id, orderId, status: 'COMPLETED' };
    }
    if (deposit?.status === DepositStatus.CANCELLED || deposit?.status === DepositStatus.FAILED) {
      throw new BadRequestException(`Deposit was ${deposit.status.toLowerCase()}`);
    }

    const accessToken = await this.getAccessToken(cfg);

    const res = await fetch(`${this.baseUrl(cfg.mode)}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const json = (await res.json()) as Record<string, unknown>;

    // ── Handle already-captured at PayPal level ──
    if (!res.ok) {
      const name = (json.name as string) ?? '';
      const details = (json.details as Array<{ issue?: string }>) ?? [];
      const isAlreadyCaptured =
        name === 'UNPROCESSABLE_ENTITY' &&
        details.some((d) => d.issue === 'ORDER_ALREADY_CAPTURED');
      if (isAlreadyCaptured && deposit) {
        this.logger.log(`PayPal order ${orderId} already captured at gateway — returning success`);
        return { depositId: deposit.id, orderId, status: 'COMPLETED' };
      }
      this.logger.error(`PayPal capture failed: ${JSON.stringify(json)}`);
      throw new BadRequestException('Failed to capture PayPal order');
    }

    const status = json.status as string;
    const purchaseUnits = json.purchase_units as Array<Record<string, unknown>> | undefined;
    const referenceId = purchaseUnits?.[0]?.reference_id as string | undefined;
    const payments = purchaseUnits?.[0]?.payments as { captures?: Array<{ amount?: { value?: string } }> } | undefined;
    const capturedValue = payments?.captures?.[0]?.amount?.value;

    if (status !== 'COMPLETED') {
      throw new BadRequestException(`PayPal order status: ${status}`);
    }

    if (!referenceId) {
      throw new BadRequestException('PayPal capture missing deposit reference');
    }

    if (capturedValue) {
      const captured = parseFloat(capturedValue);
      const expected = deposit?.amountFiat ?? 0;
      if (expected > 0 && Math.abs(captured - expected) > 0.01) {
        this.logger.warn(`PayPal amount mismatch: expected ${expected}, got ${captured}`);
      }
    }

    await this.walletService.completeDeposit(referenceId, { paymentRef: orderId });
    return { depositId: referenceId, orderId, status };
  }

  // ─── Webhook Verification ───────────────────────────────────

  private async verifyWebhookSignature(
    cfg: PayPalConfig,
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): Promise<boolean> {
    if (!cfg.webhookId) {
      this.logger.warn('PayPal webhook_id not configured — skipping signature verification');
      return false;
    }

    const authAlgo = headers['paypal-auth-algo'];
    const certUrl = headers['paypal-cert-url'];
    const transmissionId = headers['paypal-transmission-id'];
    const transmissionSig = headers['paypal-transmission-sig'];
    const transmissionTime = headers['paypal-transmission-time'];

    if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
      this.logger.error('PayPal webhook missing required signature headers');
      return false;
    }

    const accessToken = await this.getAccessToken(cfg);

    const res = await fetch(`${this.baseUrl(cfg.mode)}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: cfg.webhookId,
        webhook_event: JSON.parse(rawBody),
      }),
    });

    const json = (await res.json()) as { verification_status?: string };
    return json.verification_status === 'SUCCESS';
  }

  // ─── Webhook Event Processor ────────────────────────────────

  async processWebhookEvent(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): Promise<{ received: boolean; action: string; depositId?: string }> {
    this.logger.log('PayPal webhook received');
    this.logger.log(`Raw body (first 500 chars): ${rawBody.substring(0, 500)}`);

    const cfg = await this.getConfig();
    if (!cfg) {
      this.logger.error('PayPal webhook received but PayPal is not configured');
      throw new BadRequestException('PayPal not configured');
    }

    // Verify signature if webhook_id is configured
    const isVerified = await this.verifyWebhookSignature(cfg, rawBody, headers);
    if (!isVerified && cfg.webhookId) {
      this.logger.error('PayPal webhook signature verification failed');
      throw new UnauthorizedException('Invalid webhook signature');
    }
    if (!isVerified && !cfg.webhookId) {
      this.logger.warn('PayPal webhook_id not configured — accepting webhook without signature verification (configure webhook_id in Server Config for production)');
    }

    // Parse payload
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch (err) {
      this.logger.error('PayPal webhook: invalid JSON body');
      throw new BadRequestException('Invalid webhook payload');
    }

    const eventType = payload.event_type as string;
    const resource = payload.resource as Record<string, unknown> | undefined;
    const orderId = resource?.id as string | undefined;

    this.logger.log(`PayPal webhook event: ${eventType}, orderId: ${orderId}`);

    if (!orderId) {
      return { received: true, action: 'ignored_no_order_id' };
    }

    // ── CHECKOUT.ORDER.APPROVED → capture the order ──
    if (eventType === 'CHECKOUT.ORDER.APPROVED') {
      // Pre-check: skip capture if deposit already completed by frontend return handler
      const deposit = await this.prisma.deposit.findUnique({ where: { paymentRef: orderId } });
      if (deposit?.status === DepositStatus.COMPLETED) {
        return { received: true, action: 'already_completed', depositId: deposit.id };
      }
      if (deposit?.status === DepositStatus.CANCELLED || deposit?.status === DepositStatus.FAILED) {
        return { received: true, action: 'ignored_wrong_status', depositId: deposit.id };
      }
      try {
        const result = await this.captureOrder(orderId);
        return { received: true, action: 'captured', depositId: result.depositId };
      } catch (err) {
        if (err instanceof BadRequestException || err instanceof NotFoundException) {
          this.logger.warn(`PayPal capture ignored: ${err.message}`);
          return { received: true, action: 'ignored', depositId: orderId };
        }
        throw err;
      }
    }

    // ── PAYMENT.CAPTURE.COMPLETED → complete deposit if not already done ──
    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      const deposit = await this.prisma.deposit.findUnique({ where: { paymentRef: orderId } });
      if (!deposit) return { received: true, action: 'ignored_no_deposit' };
      if (deposit.status === DepositStatus.COMPLETED) return { received: true, action: 'already_completed', depositId: deposit.id };
      if (deposit.status !== DepositStatus.PENDING && deposit.status !== DepositStatus.PROCESSING) {
        return { received: true, action: 'ignored_wrong_status', depositId: deposit.id };
      }

      await this.walletService.completeDeposit(deposit.id, { paymentRef: orderId });
      return { received: true, action: 'completed', depositId: deposit.id };
    }

    // ── PAYMENT.CAPTURE.PENDING → mark deposit processing ──
    if (eventType === 'PAYMENT.CAPTURE.PENDING') {
      const deposit = await this.prisma.deposit.findUnique({ where: { paymentRef: orderId } });
      if (!deposit) return { received: true, action: 'ignored_no_deposit' };
      if (deposit.status === DepositStatus.COMPLETED) return { received: true, action: 'already_completed', depositId: deposit.id };
      if (deposit.status === DepositStatus.PROCESSING) return { received: true, action: 'already_processing', depositId: deposit.id };

      await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: { status: DepositStatus.PROCESSING },
      });
      this.eventsService.emitToUser(deposit.userId, 'deposit:updated', { depositId: deposit.id, status: DepositStatus.PROCESSING });
      return { received: true, action: 'marked_processing', depositId: deposit.id };
    }

    // ── PAYMENT.CAPTURE.DENIED → mark deposit failed ──
    if (eventType === 'PAYMENT.CAPTURE.DENIED') {
      const deposit = await this.prisma.deposit.findUnique({ where: { paymentRef: orderId } });
      if (!deposit) return { received: true, action: 'ignored_no_deposit' };
      if (deposit.status === DepositStatus.COMPLETED) return { received: true, action: 'already_completed', depositId: deposit.id };

      await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: { status: DepositStatus.FAILED },
      });
      this.eventsService.emitToUser(deposit.userId, 'deposit:updated', { depositId: deposit.id, status: DepositStatus.FAILED });
      return { received: true, action: 'marked_failed', depositId: deposit.id };
    }

    // ── CHECKOUT.ORDER.VOIDED → mark deposit cancelled ──
    if (eventType === 'CHECKOUT.ORDER.VOIDED') {
      const deposit = await this.prisma.deposit.findUnique({ where: { paymentRef: orderId } });
      if (!deposit) return { received: true, action: 'ignored_no_deposit' };
      if (deposit.status === DepositStatus.COMPLETED) return { received: true, action: 'already_completed', depositId: deposit.id };
      if (deposit.status === DepositStatus.CANCELLED) return { received: true, action: 'already_cancelled', depositId: deposit.id };

      await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: { status: DepositStatus.CANCELLED, adminNotes: 'PayPal order voided' },
      });
      this.eventsService.emitToUser(deposit.userId, 'deposit:updated', { depositId: deposit.id, status: DepositStatus.CANCELLED });
      return { received: true, action: 'marked_cancelled', depositId: deposit.id };
    }

    return { received: true, action: 'ignored_unsupported_event' };
  }
}
