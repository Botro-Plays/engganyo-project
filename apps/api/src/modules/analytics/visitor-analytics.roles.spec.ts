/**
 * Role-enforcement tests for the visitor-analytics controller.
 *
 * The IP-level drill-down (`GET /analytics/traffic/recent`) must be
 * SUPER_ADMIN-only; aggregate endpoints allow the admin traffic roles but
 * never plain users. Verified via route metadata + the real RolesGuard.
 */
import 'reflect-metadata';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { VisitorAnalyticsController } from './visitor-analytics.controller';

const rolesFor = (method: keyof VisitorAnalyticsController) =>
  Reflect.getMetadata(ROLES_KEY, VisitorAnalyticsController.prototype[method]) as UserRole[] | undefined;

const ctxFor = (user: { role: UserRole } | null): ExecutionContext =>
  ({
    getHandler: () => VisitorAnalyticsController.prototype.getRecent,
    getClass: () => VisitorAnalyticsController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('visitor analytics role enforcement', () => {
  const guard = new RolesGuard(new Reflector());

  it('IP drill-down requires SUPER_ADMIN only', () => {
    const roles = rolesFor('getRecent');
    expect(roles).toEqual([UserRole.SUPER_ADMIN]);
  });

  it('aggregate endpoints admit admin roles but never USER', () => {
    for (const method of ['getOverview', 'getBreakdown'] as const) {
      const roles = rolesFor(method);
      expect(roles).toBeDefined();
      expect(roles).toContain(UserRole.SUPER_ADMIN);
      expect(roles).toContain(UserRole.ADMIN);
      expect(roles).not.toContain(UserRole.USER);
    }
  });

  it('beacon ingest is unauthenticated by design (rate-limited, no roles)', () => {
    expect(rolesFor('ingestBeacon')).toBeUndefined();
  });

  it('RolesGuard denies ADMIN/MODERATOR/USER on the recent-events role set', () => {
    for (const role of [UserRole.ADMIN, UserRole.MODERATOR, UserRole.USER]) {
      expect(() => guard.canActivate(ctxFor({ role }))).toThrow(ForbiddenException);
    }
  });

  it('RolesGuard admits SUPER_ADMIN on the recent-events role set', () => {
    expect(guard.canActivate(ctxFor({ role: UserRole.SUPER_ADMIN }))).toBe(true);
  });

  it('RolesGuard denies unauthenticated callers', () => {
    expect(() => guard.canActivate(ctxFor(null))).toThrow(ForbiddenException);
  });
});
