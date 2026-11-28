import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const TELEGRAM_ADMIN_COMMAND_TYPES = [
  'OVERVIEW',
  'CLONES_LIST',
  'BOT_USERS_LIST',
  'USERS_LIST',
  'BOT_CHATS_LIST',
  'START_MESSAGES_LIST',
  'START_MESSAGE_GET',
  'ANNOUNCEMENTS_LIST',
  'ANNOUNCEMENT_GET',
  'ANNOUNCEMENT_AUDIENCE_GET',
  'MENTION_STATUS_GET',
  'OWNER_SETTINGS_GET',
  'GROUPS_LIST',
  'GROUPS_EXPORT',
  'GROUP_GET',
  'GROUP_FIND',
  'USER_FIND',
  'BLOCKLIST_LIST',
  'WHITELIST_GET',
  'TICKETS_LIST',
  'TICKET_GET',
  'ADMINS_LIST',
  'AUDIT_LIST',
  'SYSTEM_STATUS',
  'GROUP_BAN',
  'GROUP_UNBAN',
  'GROUP_LEAVE',
  'GROUP_RESET_SETTINGS',
  'GROUP_INVITE_LINK',
  'BLOCKLIST_ADD',
  'BLOCKLIST_REMOVE',
  'BLOCKLIST_IMPORT',
  'WHITELIST_UPDATE',
  'WHITELIST_CLEAR',
  'TICKET_REPLY',
  'TICKET_CLOSE',
  'CLONE_SET_ACTIVE',
  'CLONE_REMOVE',
  'SYSTEM_SET_REDUCED',
  'SYSTEM_CLEAR_CACHES',
  'SYSTEM_DB_BACKUP_TO_OWNERS',
  'ADMIN_ADD',
  'ADMIN_REMOVE',
  'START_MESSAGE_SET_ENABLED',
  'START_MESSAGE_CONFIGURE',
  'START_MESSAGE_RESET',
  'ANNOUNCEMENT_OPTIONS_GET',
  'ANNOUNCEMENT_DELIVERY_GET',
  'ANNOUNCEMENT_CREATE',
  'ANNOUNCEMENT_UPDATE_CONTENT',
  'ANNOUNCEMENT_SET_AUDIENCE',
  'ANNOUNCEMENT_SET_MENTION',
  'ANNOUNCEMENT_DELETE',
  'ANNOUNCEMENT_SEND_NOW',
] as const;
export type TelegramAdminCommandType = (typeof TELEGRAM_ADMIN_COMMAND_TYPES)[number];

const MAX_SAFE_ID = Number.MAX_SAFE_INTEGER;

export class TelegramAdminCommandRequestDto {
  @IsIn([...TELEGRAM_ADMIN_COMMAND_TYPES])
  type!: TelegramAdminCommandType;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  @MaxLength(96)
  requestKey!: string;
}

export class TelegramAdminClaimDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  workerId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}

export class TelegramAdminCompleteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  commandId!: string;

  @IsUUID()
  claimToken!: string;

  @IsOptional()
  @IsObject()
  result?: Record<string, unknown>;
}

export class TelegramAdminFailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  commandId!: string;

  @IsUUID()
  claimToken!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  error!: string;
}

export class TelegramAdminCommandsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_SAFE_ID)
  offset?: number;
}
