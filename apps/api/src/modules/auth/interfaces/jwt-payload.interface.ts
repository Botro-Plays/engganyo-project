import { UserRole, UserStatus } from '@prisma/client';

export interface JwtPayload {
  sub: string;       // user id
  email: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  iat?: number;      // issued at
  exp?: number;      // expiry
}
