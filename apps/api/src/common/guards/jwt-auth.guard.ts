import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { IS_PUBLIC_KEY, IS_OPTIONAL_AUTH_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    // Check if the route is marked as public (no auth required)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    // Check if the route is marked as optional auth (auth not required but used if present)
    const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isOptionalAuth) {
      const result = super.canActivate(context);
      if (result instanceof Observable) {
        return result.pipe(catchError(() => {
          return new Observable<boolean>(observer => {
            observer.next(true);
            observer.complete();
          });
        }));
      }
      if (result instanceof Promise) {
        return result.catch(() => true);
      }
      return result;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser>(err: Error | null, user: TUser, _info: unknown, context: ExecutionContext): TUser {
    // For optional auth, allow request to proceed even if no user
    const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isOptionalAuth) {
      return user || (null as TUser);
    }

    if (err || !user) {
      throw new UnauthorizedException('Authentication required');
    }
    return user;
  }
}
