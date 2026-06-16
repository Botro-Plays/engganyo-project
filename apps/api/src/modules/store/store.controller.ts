import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { StoreCategory } from '@prisma/client';

import { StoreService } from './store.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { PurchaseItemDto } from './dto/purchase-item.dto';

@Controller('store')
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  @Get('items')
  async getItems(@Query('category') category?: StoreCategory) {
    const items = await this.storeService.getItems(category);
    return { success: true, data: items };
  }

  @Post('purchase')
  @UseGuards(JwtAuthGuard)
  async purchaseItem(@CurrentUser('userId') userId: string, @Body() dto: PurchaseItemDto) {
    const result = await this.storeService.purchaseItem(userId, dto.itemId, dto.quantity);
    return { success: true, data: result };
  }

  @Get('inventory')
  @UseGuards(JwtAuthGuard)
  async getInventory(@CurrentUser('userId') userId: string) {
    const inventory = await this.storeService.getUserInventory(userId);
    return { success: true, data: inventory };
  }
}
