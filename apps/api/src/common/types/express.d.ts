import 'express';
import type { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      body?: {
        taskId?: string;
      };
    }
  }
}

export {};
