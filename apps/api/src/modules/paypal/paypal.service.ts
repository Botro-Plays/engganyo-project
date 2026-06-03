import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';

interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  mode: 'sandbox' | 'live';
}

@Injectable()
export class PayPalService {
  private readonly logger = new Logger(PayPalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  private async getConfig(): Promise<PayPalConfig | null> {
    const [enabled, clientId, clientSecret, mode] = await Promise.all([
      this.prisma.platformConfig.findUnique({ where: { key: 'paypal_enabled' } }),
      this.prisma.platformConfig.findUnique({ where: { key: 'paypal_client_id' } }),
      this.prisma.platformConfig.findUnique({ where: { key: 'paypal_client_secret' } }),
      this.prisma.platformConfig.findUnique({ where: { key: 'paypal_mode' } }),
    ]);

    if (!enabled?.value) return null;
    return {
      clientId: (clientId?.value as string) ?? '',
      clientSecret: (clientSecret?.value as string) ?? '',
      mode: (mode?.value as 'sandbox' | 'live') ?? 'sandbox',
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
          cancel_url: `${process.env['FRONTEND_URL'] ?? 'http://localhost:3000'}/wallet?paypal=cancel`,
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

    const accessToken = await this.getAccessToken(cfg);

    const res = await fetch(`${this.baseUrl(cfg.mode)}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
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

    const deposit = await this.prisma.deposit.findUnique({ where: { id: referenceId } });
    if (!deposit) throw new NotFoundException('Deposit not found');
    if (deposit.status === 'COMPLETED') throw new BadRequestException('Deposit already completed');

    if (capturedValue) {
      const captured = parseFloat(capturedValue);
      const expected = deposit.amountFiat;
      if (Math.abs(captured - expected) > 0.01) {
        this.logger.warn(`PayPal amount mismatch: expected ${expected}, got ${captured}`);
      }
    }

    await this.walletService.completeDeposit(referenceId, { paymentRef: orderId });
    return { depositId: referenceId, orderId, status };
  }
}
