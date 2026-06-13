import { Controller, Post, Body, Param, HttpCode, HttpStatus, UseGuards, Headers, Req, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PayPalService } from './paypal.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface';
import type { Request } from 'express';

@ApiTags('paypal')
@Controller({ path: 'paypal' })
export class PayPalController {
  constructor(private readonly paypalService: PayPalService) {}

  @Post('create-order')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a PayPal order for a deposit' })
  async createOrder(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { depositId: string; amount: number; currency: string },
  ) {
    return this.paypalService.createOrder(dto.depositId, dto.amount, dto.currency);
  }

  @Post('capture/:orderId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Capture a PayPal order and complete the deposit' })
  async captureOrder(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
  ) {
    return this.paypalService.captureOrder(orderId);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive PayPal webhook events (public — no auth)' })
  async handleWebhook(
    @Req() req: Request,
    @Headers('paypal-auth-algo') authAlgo: string,
    @Headers('paypal-cert-url') certUrl: string,
    @Headers('paypal-transmission-id') transmissionId: string,
    @Headers('paypal-transmission-sig') transmissionSig: string,
    @Headers('paypal-transmission-time') transmissionTime: string,
  ) {
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing raw body');
    }
    return this.paypalService.processWebhookEvent(rawBody.toString(), {
      'paypal-auth-algo': authAlgo,
      'paypal-cert-url': certUrl,
      'paypal-transmission-id': transmissionId,
      'paypal-transmission-sig': transmissionSig,
      'paypal-transmission-time': transmissionTime,
    });
  }
}
