import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';

import { GamificationController } from './gamification.controller';
import { GamificationService } from './gamification.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

// HTTP-boundary coverage for POST /gamification/wheel/spin header validation.
// The controller must reject missing/malformed Idempotency-Key and
// X-Expected-Cost BEFORE the service (and therefore settlement) is invoked.
describe('GamificationController — wheel/spin header boundary', () => {
  let controller: GamificationController;
  const spinWheelMock = jest.fn();

  const user: JwtPayload = {
    sub: 'user-1',
    email: 'user@example.com',
    username: 'user1',
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  };

  beforeEach(async () => {
    spinWheelMock.mockReset().mockResolvedValue({ isFree: true, cost: 0 });
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GamificationController],
      providers: [{ provide: GamificationService, useValue: { spinWheel: spinWheelMock } }],
    }).compile();
    controller = module.get(GamificationController);
  });

  const VALID_KEY = 'valid-key-123';
  const VALID_COST = '0';

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['too short', 'short'],
    ['too long', 'k'.repeat(129)],
    ['spaces', 'has space key'],
    ['dots', 'key.with.dots'],
    ['symbols', 'key+plus/slash='],
  ])('rejects %s Idempotency-Key with 400 before settlement', (_label, key) => {
    // spinWheel throws synchronously at the boundary — settlement never starts.
    expect(() => controller.spinWheel(user, key, VALID_COST)).toThrow(BadRequestException);
    expect(spinWheelMock).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['non-numeric', 'abc'],
    ['decimal', '20.5'],
    ['negative', '-5'],
    ['non-canonical', '020'],
  ])('rejects %s X-Expected-Cost with 400 before settlement', (_label, cost) => {
    expect(() => controller.spinWheel(user, VALID_KEY, cost)).toThrow(BadRequestException);
    expect(spinWheelMock).not.toHaveBeenCalled();
  });

  it('accepts a valid key and expected cost, forwarding parsed values', async () => {
    await controller.spinWheel(user, VALID_KEY, '20');
    expect(spinWheelMock).toHaveBeenCalledWith('user-1', VALID_KEY, 20);
  });

  it('accepts expected cost 0 (free spin quote)', async () => {
    await controller.spinWheel(user, VALID_KEY, '0');
    expect(spinWheelMock).toHaveBeenCalledWith('user-1', VALID_KEY, 0);
  });
});
