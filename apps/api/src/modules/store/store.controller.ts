import { Controller, Get, Post, Patch, Body, Query, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { StoreCategory } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';

import { StoreService } from './store.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PurchaseItemDto } from './dto/purchase-item.dto';

@Controller('store')
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  @Get('items')
  @HttpCode(HttpStatus.OK)
  async getItems(@Query('category') category?: StoreCategory) {
    return this.storeService.getItems(category);
  }

  @Post('purchase')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @HttpCode(HttpStatus.OK)
  async purchaseItem(@CurrentUser() user: JwtPayload, @Body() dto: PurchaseItemDto) {
    return this.storeService.purchaseItem(user.sub, dto.itemId, dto.quantity);
  }

  @Get('inventory')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getInventory(@CurrentUser() user: JwtPayload) {
    return this.storeService.getUserInventory(user.sub);
  }

  @Post('inventory/:id/use')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async useItem(@CurrentUser() user: JwtPayload, @Param('id') inventoryId: string) {
    return this.storeService.useItem(user.sub, inventoryId);
  }

  @Patch('inventory/:id/equip')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async equipCosmetic(@CurrentUser() user: JwtPayload, @Param('id') inventoryId: string) {
    return this.storeService.equipCosmetic(user.sub, inventoryId);
  }
}
