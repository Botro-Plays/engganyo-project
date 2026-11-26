import {
  IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, NotEquals,
} from 'class-validator';

export const BOT_COMMANDS = ['connect', 'disconnect', 'status'] as const;
export type BotCommand = (typeof BOT_COMMANDS)[number];

// Runtime-validated bodies for the bot channel. The scoped-secret guard
// authenticates the caller; these DTOs constrain what authenticated input
// may look like - ids as integers inside JS-safe range, commands from a
// fixed allowlist, bounded lengths, and the per-attempt claim token on
// every mutation. Malformed bodies are rejected with 400 before a row is
// ever persisted - a command that could only no-op never enters the inbox.
const MAX_SAFE_ID = Number.MAX_SAFE_INTEGER;

export class BotIngestDto {
  @IsInt()
  @Min(0)
  @Max(MAX_SAFE_ID)
  updateId!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  workerId!: string;

  // Reply destination: every Phase-1 command replies, so it is required.
  // Non-zero - private chats are positive, group ids may be negative.
  @IsInt()
  @NotEquals(0)
  @Min(-MAX_SAFE_ID)
  @Max(MAX_SAFE_ID)
  chatId!: number;

  @IsIn([...BOT_COMMANDS])
  command!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  args?: string;

  // Sender identity: all three commands need it. Telegram user ids are
  // positive integers.
  @IsInt()
  @Min(1)
  @Max(MAX_SAFE_ID)
  telegramUserId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  telegramUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  telegramFirstName?: string;
}

// Effects and acknowledgements carry only the update id and the fencing
// claim token - command input is bound to the immutable row persisted at
// ingest, so no replacement parameters exist to validate here.
export class BotApplyDto {
  @IsInt()
  @Min(0)
  @Max(MAX_SAFE_ID)
  updateId!: number;

  @IsUUID()
  claimToken!: string;
}

export class BotAckDto {
  @IsInt()
  @Min(0)
  @Max(MAX_SAFE_ID)
  updateId!: number;

  @IsUUID()
  claimToken!: string;
}

export class BotFailDto {
  @IsInt()
  @Min(0)
  @Max(MAX_SAFE_ID)
  updateId!: number;

  @IsUUID()
  claimToken!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  error?: string;
}

export class BotRecoverDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  workerId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

// Website-originated bodies.
export class TelegramClaimIdDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  claimId!: string;
}
