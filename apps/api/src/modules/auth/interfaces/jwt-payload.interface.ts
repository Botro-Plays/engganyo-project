import { UserRole, UserStatus } from '@prisma/client';

export type JwtPurpose = 'access' | 'refresh' | 'two_factor_auth' | 'oauth_state';

export interface JwtPayload {
  sub: string;       // user id
  email: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  purpose?: JwtPurpose;
  iat?: number;      // issued at
  exp?: number;      // expiry
}
