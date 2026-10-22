import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

describe('UsersService — getEquippedCosmeticsForUsers (batched lookup)', () => {
  let service: UsersService;
  let prisma: { userInventory: { findMany: jest.Mock } };

  beforeEach(() => {
    prisma = { userInventory: { findMany: jest.fn() } };
    service = new UsersService(prisma as never, {} as never);
  });

  it('returns {} and runs no query for an empty id list', async () => {
    const result = await service.getEquippedCosmeticsForUsers([]);

    expect(result).toEqual({});
    expect(prisma.userInventory.findMany).not.toHaveBeenCalled();
  });

  it('issues ONE findMany across all user IDs (no per-user queries)', async () => {
    prisma.userInventory.findMany.mockResolvedValue([
      { userId: 'u1', id: 'inv-1', equipped: true, item: { id: 'i1', name: 'Gold Frame', category: 'COSMETIC', metadata: { cosmeticType: 'avatar_frame', style: 'gold' } } },
      { userId: 'u3', id: 'inv-2', equipped: true, item: { id: 'i2', name: 'Neon Theme', category: 'COSMETIC', metadata: { cosmeticType: 'profile_theme', style: 'neon' } } },
    ]);

    const result = await service.getEquippedCosmeticsForUsers(['u1', 'u2', 'u3']);

    expect(prisma.userInventory.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.userInventory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: { in: ['u1', 'u2', 'u3'] }, equipped: true }),
      }),
    );
    // Grouped per user, userId stripped from entries
    expect(result['u1']).toHaveLength(1);
    expect(result['u1'][0].item.name).toBe('Gold Frame');
    expect(result['u2']).toBeUndefined();
    expect(result['u3']).toHaveLength(1);
  });

  it('dedupes IDs before querying', async () => {
    prisma.userInventory.findMany.mockResolvedValue([]);

    await service.getEquippedCosmeticsForUsers(['u1', 'u1', 'u2', 'u1']);

    expect(prisma.userInventory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: { in: ['u1', 'u2'] } }),
      }),
    );
  });
});

describe('UsersController — GET /users/cosmetics ids validation', () => {
  let controller: UsersController;
  let service: { getEquippedCosmeticsForUsers: jest.Mock };

  beforeEach(() => {
    service = { getEquippedCosmeticsForUsers: jest.fn().mockReturnValue({}) };
    controller = new UsersController(service as never);
  });

  it('rejects repeated ids params (?ids=a&ids=b) with 400 BadRequest', () => {
    expect(() => controller.getEquippedCosmetics(['a', 'b'])).toThrow(BadRequestException);
    expect(service.getEquippedCosmeticsForUsers).not.toHaveBeenCalled();
  });

  it('accepts a comma-separated string and passes trimmed IDs through', async () => {
    await controller.getEquippedCosmetics(' u1 ,,u2 ');

    expect(service.getEquippedCosmeticsForUsers).toHaveBeenCalledWith(['u1', 'u2']);
  });

  it('preserves empty/missing behavior: no ids → empty lookup', async () => {
    await controller.getEquippedCosmetics(undefined);

    expect(service.getEquippedCosmeticsForUsers).toHaveBeenCalledWith([]);
  });
});
