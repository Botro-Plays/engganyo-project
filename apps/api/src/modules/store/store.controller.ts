import { Controller, Get, Post, Body, Query, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { StoreCategory } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';

import { StoreService } from './store.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { PurchaseItemDto } from './dto/purchase-item.dto';

@Controller('store')
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  @Get('items')
  @HttpCode(HttpStatus.OK)
  async getItems(@Query('category') category?: StoreCategory) {
    const items = await this.storeService.getItems(category);
    return { success: true, data: items };
  }

  @Post('purchase')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @HttpCode(HttpStatus.OK)
  async purchaseItem(@CurrentUser() user: JwtPayload, @Body() dto: PurchaseItemDto) {
    const result = await this.storeService.purchaseItem(user.sub, dto.itemId, dto.quantity);
    return { success: true, data: result };
  }

  @Get('inventory')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getInventory(@CurrentUser() user: JwtPayload) {
    const inventory = await this.storeService.getUserInventory(user.sub);
    return { success: true, data: inventory };
  }

  @Post('inventory/:id/use')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async useItem(@CurrentUser() user: JwtPayload, @Param('id') inventoryId: string) {
    const result = await this.storeService.useItem(user.sub, inventoryId);
    return { success: true, data: result };
  }
}
