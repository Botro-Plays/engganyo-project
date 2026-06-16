import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PurchaseItemDto } from './dto/purchase-item.dto';
import { StoreController } from './store.controller';

describe('PurchaseItemDto runtime availability', () => {
  it('should have PurchaseItemDto class available at runtime', () => {
    expect(PurchaseItemDto).toBeDefined();
    expect(typeof PurchaseItemDto).toBe('function');
    expect(new PurchaseItemDto()).toBeInstanceOf(PurchaseItemDto);
  });

  it('should have PurchaseItemDto in controller param metadata', () => {
    const paramTypes = Reflect.getMetadata('design:paramtypes', StoreController.prototype, 'purchaseItem');
    expect(paramTypes).toBeDefined();
    expect(paramTypes.length).toBeGreaterThanOrEqual(2);
    // The second param should be PurchaseItemDto, not Object
    const dtoType = paramTypes[1];
    expect(dtoType).toBe(PurchaseItemDto);
    expect(dtoType).not.toBe(Object);
  });

  it('should validate itemId as required string', async () => {
    const dto = plainToInstance(PurchaseItemDto, { quantity: 1 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'itemId')).toBe(true);
  });

  it('should validate quantity as optional int between 1-99', async () => {
    const dto1 = plainToInstance(PurchaseItemDto, { itemId: 'abc', quantity: 1 });
    const errors1 = await validate(dto1);
    expect(errors1.length).toBe(0);

    const dto2 = plainToInstance(PurchaseItemDto, { itemId: 'abc', quantity: 100 });
    const errors2 = await validate(dto2);
    expect(errors2.length).toBeGreaterThan(0);
    expect(errors2.some((e) => e.property === 'quantity')).toBe(true);
  });

  it('should default quantity to 1', () => {
    const dto = new PurchaseItemDto();
    dto.itemId = 'abc';
    expect(dto.quantity).toBe(1);
  });
});
