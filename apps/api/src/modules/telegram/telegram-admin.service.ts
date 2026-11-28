import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { TelegramBotAdminCommand } from '@prisma/client';
import { randomUUID } from 'crypto';

import { PrismaService } from '../../database/prisma.service';
import {
  TelegramAdminCommandRequestDto,
  TelegramAdminCommandsQueryDto,
} from './telegram-admin.dto';

const LEASE_MS_DEFAULT = 60_000;
const MAX_ATTEMPTS = 3;
const MAX_PARAMS_BYTES = 32 * 1024;
const MAX_RESULT_BYTES = 256 * 1024;
const SECRET_KEY_PARTS = ['token', 'secret', 'password', 'apikey', 'api_key', 'cookie', 'session'];
const SECRET_VALUE_PATTERNS = [
  /\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/i,
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (SECRET_KEY_PARTS.some((part) => normalized.includes(part))) return true;
  return (
    normalized === 'fileid' ||
    normalized === 'file_id' ||
    normalized.endsWith('_file_id') ||
    key.endsWith('FileId')
  );
}

function scanSecrets(value: unknown, path: string[] = []): string | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = scanSecrets(item, [...path, String(index)]);
      if (found) return found;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        return [...path, key].join('.');
      }
      const found = scanSecrets(item, [...path, key]);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'string' && SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    return path.join('.') || 'value';
  }
  return null;
}

function replaceSecretValues(text: string): string {
  let out = text;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    while (pattern.test(out)) out = out.replace(pattern, '[redacted]');
  }
  return out;
}

function redactSecretValues(text: string): string {
  return replaceSecretValues(text.slice(0, 500));
}

function sanitizeResultStrings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeResultStrings);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (isSensitiveKey(key))
          throw new BadRequestException(`Sensitive result field is not allowed: ${key}`);
        return [key, sanitizeResultStrings(item)];
      }),
    );
  }
  return typeof value === 'string' ? replaceSecretValues(value) : value;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalJson(value));
}

function cleanJson(
  input: Record<string, unknown> | undefined,
  label: string,
  maxBytes: number,
  redactStringValues = false,
): Prisma.InputJsonValue {
  if (!input) return {};
  let serialized: string;
  let copy: unknown;
  try {
    serialized = JSON.stringify(input);
    copy = JSON.parse(serialized);
  } catch {
    throw new BadRequestException(`${label} must be JSON serializable`);
  }
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new BadRequestException(`${label} exceeds the ${maxBytes} byte limit`);
  }
  if (redactStringValues) {
    return sanitizeResultStrings(copy) as Prisma.InputJsonValue;
  }
  const leak = scanSecrets(copy);
  if (leak) {
    throw new BadRequestException(`Sensitive ${label} field is not allowed: ${leak}`);
  }
  return copy as Prisma.InputJsonValue;
}

function numericParam(value: unknown): number {
  if (typeof value === 'boolean' || value === null || value === '') return Number.NaN;
  return Number(value);
}

function positiveInt(params: Record<string, unknown>, key: string): number {
  const value = numericParam(params[key]);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new BadRequestException(`${key} must be a positive safe integer`);
  return value;
}

function nonZeroInt(params: Record<string, unknown>, key: string): number {
  const value = numericParam(params[key]);
  if (!Number.isSafeInteger(value) || value === 0)
    throw new BadRequestException(`${key} must be a non-zero safe integer`);
  return value;
}

function boundedString(
  params: Record<string, unknown>,
  key: string,
  max: number,
  required = false,
): string {
  const value = params[key];
  if (value === undefined || value === null || value === '') {
    if (required) throw new BadRequestException(`${key} is required`);
    return '';
  }
  if (typeof value !== 'string' || value.length > max)
    throw new BadRequestException(`${key} must be a string up to ${max} characters`);
  return value;
}

function idList(params: Record<string, unknown>, key: string, max: number): unknown[] {
  const value = params[key];
  if (!Array.isArray(value) || value.length > max)
    throw new BadRequestException(`${key} must be a list of at most ${max} entries`);
  return value;
}

function booleanParam(params: Record<string, unknown>, key: string) {
  if (params[key] !== undefined && typeof params[key] !== 'boolean') {
    throw new BadRequestException(`${key} must be a boolean`);
  }
}

function nonNegativeIntParam(params: Record<string, unknown>, key: string, max: number) {
  if (params[key] === undefined) return;
  const value = numericParam(params[key]);
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new BadRequestException(`${key} must be an integer between 0 and ${max}`);
  }
}

function validateCommandParams(type: string, params: Record<string, unknown>) {
  const pageTypes = new Set([
    'BOT_USERS_LIST',
    'BOT_CHATS_LIST',
    'ANNOUNCEMENTS_LIST',
    'GROUPS_LIST',
    'BLOCKLIST_LIST',
    'TICKETS_LIST',
    'AUDIT_LIST',
  ]);
  if (pageTypes.has(type)) {
    const limit = numericParam(params.limit ?? 25);
    const offset = numericParam(params.offset ?? 0);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      throw new BadRequestException('limit must be 1-100 and offset must be non-negative');
    }
  }
  switch (type) {
    case 'START_MESSAGE_GET':
    case 'START_MESSAGE_RESET':
      positiveInt(params, 'botId');
      break;
    case 'START_MESSAGE_SET_ENABLED':
      positiveInt(params, 'botId');
      if (typeof params.enabled !== 'boolean')
        throw new BadRequestException('enabled must be a boolean');
      break;
    case 'START_MESSAGE_CONFIGURE':
      positiveInt(params, 'botId');
      boundedString(params, 'text', 10000);
      boundedString(params, 'buttons', 8000);
      boundedString(params, 'mediaUrl', 1500);
      if (params.mediaUrl && !String(params.mediaUrl).startsWith('https://')) {
        throw new BadRequestException('mediaUrl must use https');
      }
      booleanParam(params, 'addButton');
      booleanParam(params, 'enabled');
      booleanParam(params, 'removeMedia');
      if (
        params.mediaType !== undefined &&
        !['photo', 'video', 'animation', 'document', 'audio'].includes(String(params.mediaType))
      ) {
        throw new BadRequestException('unsupported mediaType');
      }
      break;
    case 'ANNOUNCEMENT_GET':
    case 'ANNOUNCEMENT_AUDIENCE_GET':
    case 'ANNOUNCEMENT_DELIVERY_GET':
    case 'ANNOUNCEMENT_UPDATE_CONTENT':
    case 'ANNOUNCEMENT_SET_AUDIENCE':
    case 'ANNOUNCEMENT_SET_MENTION':
    case 'ANNOUNCEMENT_DELETE':
    case 'ANNOUNCEMENT_SEND_NOW':
      positiveInt(params, 'announcementId');
      if (type === 'ANNOUNCEMENT_SET_MENTION') {
        if (typeof params.enabled !== 'boolean')
          throw new BadRequestException('enabled must be a boolean');
        if (![1, 2, 3, 5, 10, 20].includes(numericParam(params.every)))
          throw new BadRequestException('every must be one of 1, 2, 3, 5, 10, 20');
      }
      break;
    case 'GROUP_GET':
    case 'GROUP_BAN':
    case 'GROUP_UNBAN':
    case 'GROUP_LEAVE':
    case 'GROUP_RESET_SETTINGS':
    case 'GROUP_INVITE_LINK':
      nonZeroInt(params, 'chatId');
      break;
    case 'BLOCKLIST_ADD':
    case 'BLOCKLIST_REMOVE':
    case 'ADMIN_ADD':
    case 'ADMIN_REMOVE':
      positiveInt(params, 'userId');
      if (type === 'BLOCKLIST_ADD') {
        boundedString(params, 'reason', 300);
        nonNegativeIntParam(params, 'durationSeconds', 31_536_000);
      }
      break;
    case 'TICKET_REPLY':
    case 'TICKET_CLOSE':
      positiveInt(params, 'ticketId');
      if (type === 'TICKET_REPLY') boundedString(params, 'text', 3500, true);
      break;
    case 'CLONE_SET_ACTIVE':
    case 'CLONE_REMOVE':
      positiveInt(params, 'cloneId');
      if (type === 'CLONE_SET_ACTIVE' && typeof params.active !== 'boolean') {
        throw new BadRequestException('active must be a boolean');
      }
      break;
    case 'SYSTEM_SET_REDUCED':
      if (typeof params.enabled !== 'boolean')
        throw new BadRequestException('enabled must be a boolean');
      break;
    case 'GROUP_FIND':
    case 'USER_FIND':
      boundedString(params, 'query', 120, true);
      break;
    case 'BLOCKLIST_IMPORT':
      for (const userId of idList(params, 'userIds', 1000)) {
        if (!Number.isSafeInteger(numericParam(userId)) || numericParam(userId) <= 0) {
          throw new BadRequestException('userIds must contain positive safe integers');
        }
      }
      break;
    case 'WHITELIST_UPDATE':
      for (const entry of idList(params, 'entries', 500)) {
        if (typeof entry !== 'string' || entry.length > 200)
          throw new BadRequestException('whitelist entries must be strings up to 200 characters');
      }
      break;
    case 'ANNOUNCEMENT_CREATE': {
      boundedString(params, 'text', 10000);
      boundedString(params, 'buttons', 8000);
      boundedString(params, 'mediaUrl', 1500);
      if (params.mediaUrl && !String(params.mediaUrl).startsWith('https://'))
        throw new BadRequestException('mediaUrl must use https');
      booleanParam(params, 'mentionEnabled');
      if (params.every !== undefined && ![1, 2, 3, 5, 10, 20].includes(numericParam(params.every)))
        throw new BadRequestException('every must be one of 1, 2, 3, 5, 10, 20');
      if (
        params.mediaType !== undefined &&
        !['photo', 'video', 'animation', 'document', 'audio'].includes(String(params.mediaType))
      )
        throw new BadRequestException('unsupported mediaType');
      idList(params, 'bots', 500);
      idList(params, 'groups', 500);
      break;
    }
    default:
      break;
  }
  if (type === 'ANNOUNCEMENT_UPDATE_CONTENT') {
    boundedString(params, 'text', 10000);
    boundedString(params, 'buttons', 8000);
    boundedString(params, 'mediaUrl', 1500);
    if (params.mediaUrl && !String(params.mediaUrl).startsWith('https://'))
      throw new BadRequestException('mediaUrl must use https');
    booleanParam(params, 'removeMedia');
    booleanParam(params, 'clearButtons');
    if (
      params.mediaType !== undefined &&
      !['photo', 'video', 'animation', 'document', 'audio'].includes(String(params.mediaType))
    )
      throw new BadRequestException('unsupported mediaType');
  }
  if (type === 'ANNOUNCEMENT_SET_AUDIENCE' || type === 'ANNOUNCEMENT_CREATE') {
    const bots = idList(params, 'bots', 500);
    const groups = idList(params, 'groups', 500);
    if (bots.length === 0 && groups.length === 0) {
      throw new BadRequestException('select at least one bot audience or group');
    }
    for (const botId of bots) {
      if (
        botId !== 'all' &&
        (!Number.isSafeInteger(numericParam(botId)) || numericParam(botId) <= 0)
      ) {
        throw new BadRequestException('bots must contain positive bot IDs or all');
      }
    }
    for (const groupId of groups) {
      if (
        groupId !== 'all' &&
        (!Number.isSafeInteger(numericParam(groupId)) || numericParam(groupId) === 0)
      ) {
        throw new BadRequestException('groups must contain non-zero chat IDs or all');
      }
    }
    if (
      type === 'ANNOUNCEMENT_CREATE' &&
      params.mentionEnabled === true &&
      !groups.some((groupId) => groupId !== 'all')
    ) {
      throw new BadRequestException('select explicit groups before enabling mention mode');
    }
  }
}

function publicCommand(command: TelegramBotAdminCommand) {
  return {
    id: command.id,
    requestKey: command.requestKey,
    type: command.type,
    status: command.status,
    params: command.params ?? {},
    result: command.result ?? null,
    error: command.error ?? null,
    botUsername: command.botUsername,
    attempts: command.attempts,
    workerId: command.workerId ?? null,
    createdAt: command.createdAt,
    updatedAt: command.updatedAt,
    claimedAt: command.claimedAt,
    completedAt: command.completedAt,
  };
}

@Injectable()
export class TelegramAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async createCommand(adminUserId: string, dto: TelegramAdminCommandRequestDto) {
    const params = cleanJson(dto.params, 'parameter', MAX_PARAMS_BYTES) as Record<string, unknown>;
    validateCommandParams(dto.type, params);
    const botUsername = this.config.get<string>('app.telegram.botUsername') ?? 'EngganyoBot';
    const scopedKey = `${adminUserId}:${dto.requestKey}`;
    try {
      const command = await this.prisma.$transaction(async (tx) => {
        const created = await tx.telegramBotAdminCommand.create({
          data: {
            type: dto.type,
            params: params as Prisma.InputJsonValue,
            requestKey: scopedKey,
            adminUserId,
            botUsername,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: adminUserId,
            action: 'telegram_bot_admin.command.create',
            entityType: 'TelegramBotAdminCommand',
            entityId: created.id,
            metadata: {
              type: created.type,
              requestKey: dto.requestKey,
            } as Prisma.InputJsonValue,
          },
        });
        return created;
      });
      return { command: publicCommand(command), reused: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.telegramBotAdminCommand.findUnique({
          where: { requestKey: scopedKey },
        });
        if (!existing) throw error;
        if (
          existing.type !== dto.type ||
          canonicalStringify(existing.params ?? {}) !== canonicalStringify(params)
        ) {
          throw new ConflictException('requestKey was already used with different command input');
        }
        return { command: publicCommand(existing), reused: true };
      }
      throw error;
    }
  }

  async listCommands(adminUserId: string, query: TelegramAdminCommandsQueryDto) {
    const limit = query.limit ?? 30;
    const offset = query.offset ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.telegramBotAdminCommand.findMany({
        where: { adminUserId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.telegramBotAdminCommand.count({ where: { adminUserId } }),
    ]);
    return { items: items.map(publicCommand), total, limit, offset };
  }

  async getCommand(adminUserId: string, id: string) {
    const command = await this.prisma.telegramBotAdminCommand.findFirst({
      where: { id, adminUserId },
    });
    if (!command) throw new NotFoundException('Telegram bot admin command not found');
    return { command: publicCommand(command) };
  }

  async claimCommands(workerId: string, limit = 1) {
    const leaseMs = this.config.get<number>('app.telegram.adminCommandLeaseMs') ?? LEASE_MS_DEFAULT;
    const botUsername = this.config.get<string>('app.telegram.botUsername') ?? 'EngganyoBot';
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const candidates = await this.prisma.telegramBotAdminCommand.findMany({
      where: {
        botUsername,
        OR: [
          { status: 'PENDING' },
          { status: 'CLAIMED', leaseUntil: { lt: now }, attempts: { lt: MAX_ATTEMPTS } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: Math.max(1, Math.min(limit, 10)),
    });
    const claimed: Array<{
      commandId: string;
      type: string;
      params: Prisma.JsonValue;
      claimToken: string;
      attempt: number;
    }> = [];
    for (const candidate of candidates) {
      const claimToken = randomUUID();
      const updated = await this.prisma.telegramBotAdminCommand.updateMany({
        where: {
          id: candidate.id,
          OR: [{ status: 'PENDING' }, { status: 'CLAIMED', leaseUntil: { lt: now } }],
        },
        data: {
          status: 'CLAIMED',
          attempts: { increment: 1 },
          workerId,
          claimToken,
          leaseUntil,
          claimedAt: now,
        },
      });
      if (updated.count !== 1) continue;
      const row = await this.prisma.telegramBotAdminCommand.findUnique({
        where: { id: candidate.id },
      });
      if (!row?.claimToken) continue;
      claimed.push({
        commandId: row.id,
        type: row.type,
        params: row.params ?? {},
        claimToken: row.claimToken,
        attempt: row.attempts,
      });
    }
    return { commands: claimed };
  }

  async completeCommand(
    commandId: string,
    claimToken: string,
    resultInput?: Record<string, unknown>,
  ) {
    const result = cleanJson(resultInput, 'result', MAX_RESULT_BYTES, true);
    const updated = await this.prisma.telegramBotAdminCommand.updateMany({
      where: { id: commandId, claimToken, status: 'CLAIMED' },
      data: {
        status: 'DONE',
        result,
        error: null,
        completedAt: new Date(),
        leaseUntil: null,
        claimToken: null,
      },
    });
    if (updated.count !== 1)
      throw new ConflictException('Command completion was rejected by the fencing token');
    return { ok: true };
  }

  async failCommand(commandId: string, claimToken: string, error: string) {
    const row = await this.prisma.telegramBotAdminCommand.findUnique({ where: { id: commandId } });
    if (!row || row.claimToken !== claimToken || row.status !== 'CLAIMED') {
      throw new ConflictException('Command failure was rejected by the fencing token');
    }
    const status = row.attempts >= MAX_ATTEMPTS ? 'DEAD' : 'PENDING';
    const updated = await this.prisma.telegramBotAdminCommand.updateMany({
      where: { id: commandId, claimToken, status: 'CLAIMED' },
      data: {
        status,
        error: redactSecretValues(error),
        workerId: status === 'PENDING' ? null : row.workerId,
        claimToken: null,
        leaseUntil: null,
        completedAt: status === 'DEAD' ? new Date() : null,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException('Command failure was rejected by the fencing token');
    }
    return { ok: true, status };
  }

  async recoverCommands(workerId: string, limit = 10) {
    const now = new Date();
    await this.prisma.telegramBotAdminCommand.updateMany({
      where: { status: 'CLAIMED', leaseUntil: { lt: now }, attempts: { gte: MAX_ATTEMPTS } },
      data: { status: 'DEAD', claimToken: null, leaseUntil: null, completedAt: now },
    });
    const stale = await this.prisma.telegramBotAdminCommand.findMany({
      where: { status: 'CLAIMED', leaseUntil: { lt: now }, attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: Math.max(1, Math.min(limit, 10)),
    });
    let recovered = 0;
    for (const row of stale) {
      const updated = await this.prisma.telegramBotAdminCommand.updateMany({
        where: { id: row.id, status: 'CLAIMED', leaseUntil: { lt: now } },
        data: { status: 'PENDING', workerId: null, claimToken: null, leaseUntil: null },
      });
      recovered += updated.count;
    }
    return { recovered, workerId };
  }
}
