import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

export function IsCuid(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCuid',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          // Prisma cuid() / cuid2: starts with 'c', lowercase alphanumerics, 24–25 chars total
          return /^c[a-z0-9]{23,24}$/.test(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid CUID`;
        },
      },
    });
  };
}
