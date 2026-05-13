import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

const ASSIGNABLE_ROLES = [UserRole.USER, UserRole.CREATOR, UserRole.MODERATOR, UserRole.ADMIN] as const;

export class ChangeUserRoleDto {
  @ApiProperty({ enum: ASSIGNABLE_ROLES, description: 'New role — SUPER_ADMIN cannot be assigned via API' })
  @IsEnum(ASSIGNABLE_ROLES, { message: 'Role must be one of USER, CREATOR, MODERATOR, ADMIN' })
  role!: (typeof ASSIGNABLE_ROLES)[number];
}
