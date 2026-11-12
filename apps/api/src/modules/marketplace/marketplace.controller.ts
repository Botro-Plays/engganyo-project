import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { StoreCategory } from '@prisma/client';

import { MarketplaceService, getMarketplacePublicConfig } from './marketplace.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateListingDto } from './dto/create-listing.dto';
import { PurchaseListingDto } from './dto/purchase-listing.dto';
import { TakedownListingDto } from './dto/takedown-listing.dto';

@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  /** Proposed internal-test rules — public so the UI can display exact terms. */
  @Get('config')
  @HttpCode(HttpStatus.OK)
  config() {
    return getMarketplacePublicConfig();
  }

  @Get('listings')
  @HttpCode(HttpStatus.OK)
  async browse(
    @Query('category') category?: StoreCategory,
    @Query('itemId') itemId?: string,
    @Query('sort') sort?: 'price_asc' | 'price_desc' | 'newest',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.marketplaceService.browseListings({
      category,
      itemId,
      sort,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('listings/:id')
  @HttpCode(HttpStatus.OK)
  async detail(@CurrentUser() user: JwtPayload | undefined, @Param('id') id: string) {
    // Public route — viewerId only used to flag viewerIsSeller/canPurchase.
    // JwtAuthGuard is optional here; when absent user is undefined.
    return this.marketplaceService.getListingDetail(id, user?.sub);
  }

  @Get('sellable-inventory')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async sellableInventory(@CurrentUser() user: JwtPayload) {
    return this.marketplaceService.getSellableInventory(user.sub);
  }

  @Get('my-listings')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async myListings(@CurrentUser() user: JwtPayload) {
    return this.marketplaceService.getMyListings(user.sub);
  }

  @Get('orders')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async orderHistory(@CurrentUser() user: JwtPayload) {
    return this.marketplaceService.getOrderHistory(user.sub);
  }

  @Post('listings')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @HttpCode(HttpStatus.CREATED)
  async createListing(@CurrentUser() user: JwtPayload, @Body() dto: CreateListingDto) {
    return this.marketplaceService.createListing(user.sub, dto);
  }

  @Delete('listings/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async cancelListing(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.marketplaceService.cancelListing(user.sub, id);
  }

  @Post('listings/:id/purchase')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @HttpCode(HttpStatus.OK)
  async purchase(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: PurchaseListingDto) {
    return this.marketplaceService.purchaseListing(user.sub, id, dto);
  }

  @Post('admin/listings/:id/takedown')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  async takedown(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: TakedownListingDto) {
    return this.marketplaceService.adminTakedown(user.sub, id, dto.reason);
  }
}
