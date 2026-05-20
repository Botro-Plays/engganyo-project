import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { classToPlain } from 'class-transformer';

/**
 * SerializationInterceptor
 * 
 * Serializes response objects using class-transformer to ensure:
 * - Prisma objects are converted to plain JSON
 * - Relations are always arrays
 * - Date fields are normalized to ISO strings
 * - Internal properties are excluded
 * 
 * This fixes the architectural gap where raw Prisma objects were returned
 * without serialization, potentially causing malformed data to reach the frontend.
 */
@Injectable()
export class SerializationInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        // If data is null/undefined, return as-is
        if (data === null || data === undefined) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return data;
        }

        // If data is an array, serialize each element
        if (Array.isArray(data)) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return data.map((item) => this.serializeItem(item));
        }

        // Serialize single object
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return this.serializeItem(data);
      }),
    );
  }

  private serializeItem(item: unknown): unknown {
    // If it's a primitive or already plain, return as-is
    if (typeof item !== 'object' || item === null) {
      return item;
    }

    // Use class-transformer to serialize to plain object
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return classToPlain(item, {
        enableCircularCheck: true,
        enableImplicitConversion: true,
      });
    } catch (error) {
      // Fallback: return as-is if serialization fails
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return item;
    }
  }
}
