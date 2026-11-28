/**
 * PostgreSQL-backed integration tests for the reverse Telegram bot admin
 * bridge. Requires TEST_DATABASE_URL - skipped when unset.
 *
 * Proves idempotent creation, concurrent claim fencing, expiry recovery,
 * bounded retry/dead-lettering, terminal-state fencing, audit persistence,
 * and rejection of token-shaped or token-named data before results are stored.
 */
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { TelegramAdminService } from './telegram-admin.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;
const PREFIX = `tga_${Date.now().toString(36)}_`;

const cfg = () =>
  new ConfigService({
    app: {
      telegram: {
        botUsername: 'EngganyoBot',
        adminCommandLeaseMs: 60_000,
      },
    },
  });

describe('telegram bot admin validation - no database required', () => {
  const service = new TelegramAdminService({} as PrismaService, cfg());
  const fakeTelegramToken = ['123456', 'abcdefghijklmnopqrstuvwxyz'].join(':');

  it('rejects malformed operational ids before persistence', async () => {
    await expect(
      service.createCommand('admin-user', {
        type: 'START_MESSAGE_GET',
        params: { botId: true },
        requestKey: 'boolean-bot-id',
      }),
    ).rejects.toThrow('botId must be a positive safe integer');
    await expect(
      service.createCommand('admin-user', {
        type: 'GROUP_BAN',
        params: { chatId: 0 },
        requestKey: 'zero-chat-id',
      }),
    ).rejects.toThrow('chatId must be a non-zero safe integer');
  });

  it('rejects implicit mention audiences and invalid frequency before persistence', async () => {
    await expect(
      service.createCommand('admin-user', {
        type: 'ANNOUNCEMENT_CREATE',
        params: {
          text: 'hello',
          bots: [202],
          groups: [],
          mentionEnabled: true,
          every: 1,
        },
        requestKey: 'implicit-mention-audience',
      }),
    ).rejects.toThrow('select explicit groups before enabling mention mode');
    await expect(
      service.createCommand('admin-user', {
        type: 'ANNOUNCEMENT_CREATE',
        params: {
          text: 'hello',
          bots: [202],
          groups: ['all'],
          mentionEnabled: true,
          every: 1,
        },
        requestKey: 'all-mention-audience',
      }),
    ).rejects.toThrow('select explicit groups before enabling mention mode');
    await expect(
      service.createCommand('admin-user', {
        type: 'ANNOUNCEMENT_SET_MENTION',
        params: { announcementId: 1, enabled: false, every: 4 },
        requestKey: 'bad-every',
      }),
    ).rejects.toThrow('every must be one of 1, 2, 3, 5, 10, 20');
  });

  it('rejects token-shaped params and results before any database write', async () => {
    await expect(
      service.createCommand('admin-user', {
        type: 'OVERVIEW',
        params: { botToken: fakeTelegramToken },
        requestKey: 'secret-param',
      }),
    ).rejects.toThrow('Sensitive parameter field');
    await expect(
      service.completeCommand('command-id', 'claim-token', {
        nested: { cloneToken: fakeTelegramToken },
      }),
    ).rejects.toThrow('Sensitive result field');
    await expect(
      service.completeCommand('command-id', 'claim-token', {
        media: { file_id: 'raw-telegram-file-id' },
      }),
    ).rejects.toThrow('Sensitive result field');
    let storedResult: unknown;
    const prismaMock = {
      telegramBotAdminCommand: {
        updateMany: async ({ data }: { data: { result?: unknown } }) => {
          storedResult = data.result;
          return { count: 1 };
        },
      },
    };
    const mockedService = new TelegramAdminService(prismaMock as unknown as PrismaService, cfg());
    await expect(
      mockedService.completeCommand('command-id', 'claim-token', {
        profileId: 'not-a-file-id',
        firstName: `user ${fakeTelegramToken}`,
      }),
    ).resolves.toEqual({ ok: true });
    expect(storedResult).toEqual({
      profileId: 'not-a-file-id',
      firstName: 'user [redacted]',
    });
  });

  it('redacts token-shaped worker errors before storing them', async () => {
    let storedError = '';
    const prismaMock = {
      telegramBotAdminCommand: {
        findUnique: async () => ({
          id: 'command-id',
          claimToken: 'claim-token',
          status: 'CLAIMED',
          attempts: 1,
          workerId: 'worker',
        }),
        updateMany: async ({ data }: { data: { error?: string } }) => {
          storedError = data.error ?? '';
          return { count: 1 };
        },
      },
    };
    const mockedService = new TelegramAdminService(prismaMock as unknown as PrismaService, cfg());
    await mockedService.failCommand(
      'command-id',
      'claim-token',
      `failed with ${fakeTelegramToken}`,
    );
    expect(storedError).toContain('[redacted]');
    expect(storedError).not.toContain(fakeTelegramToken);
  });
});

run('telegram bot admin bridge - real PostgreSQL', () => {
  jest.setTimeout(60000);
  let prisma: PrismaClient;
  let service: TelegramAdminService;
  let seq = 0;

  const mkUser = async () => {
    seq += 1;
    const tag = `${Date.now().toString(36)}_${seq}`;
    return prisma.user.create({
      data: {
        email: `${PREFIX}${tag}@itest.local`,
        username: `${PREFIX}${tag}`,
        passwordHash: 'x',
        referralCode: `${PREFIX}r${tag}`,
      },
    });
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    await prisma.$connect();
    service = new TelegramAdminService(prisma as unknown as PrismaService, cfg());
  });

  beforeEach(async () => {
    // Each fencing test controls the whole queue. TEST_DATABASE_URL is an
    // isolated test database, matching the existing Telegram inbox specs.
    await prisma.telegramBotAdminCommand.deleteMany({});
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: PREFIX } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    await prisma.telegramBotAdminCommand.deleteMany({ where: { adminUserId: { in: ids } } });
    await prisma.auditLog.deleteMany({
      where: { userId: { in: ids }, entityType: 'TelegramBotAdminCommand' },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it('creates idempotently by admin-scoped request key and writes an audit row', async () => {
    const user = await mkUser();
    const first = await service.createCommand(user.id, {
      type: 'OVERVIEW',
      params: { zeta: 1, alpha: { z: 2, a: 1 }, limit: 10 },
      requestKey: 'same-key',
    });
    const second = await service.createCommand(user.id, {
      type: 'OVERVIEW',
      params: { limit: 10, alpha: { a: 1, z: 2 }, zeta: 1 },
      requestKey: 'same-key',
    });
    expect(second.reused).toBe(true);
    expect(second.command.id).toBe(first.command.id);
    await expect(
      service.createCommand(user.id, { type: 'CLONES_LIST', params: {}, requestKey: 'same-key' }),
    ).rejects.toBeInstanceOf(ConflictException);
    const audit = await prisma.auditLog.findFirst({
      where: { userId: user.id, entityType: 'TelegramBotAdminCommand', entityId: first.command.id },
    });
    expect(audit?.action).toBe('telegram_bot_admin.command.create');
    expect((await service.getCommand(user.id, first.command.id)).command.id).toBe(first.command.id);
    const other = await mkUser();
    await expect(service.getCommand(other.id, first.command.id)).rejects.toThrow(
      'Telegram bot admin command not found',
    );
  });

  it('validates unsafe operational input before persistence', async () => {
    const user = await mkUser();
    await expect(
      service.createCommand(user.id, {
        type: 'START_MESSAGE_GET',
        params: { botId: true },
        requestKey: 'boolean-bot-id',
      }),
    ).rejects.toThrow('botId must be a positive safe integer');
    await expect(
      service.createCommand(user.id, {
        type: 'ANNOUNCEMENT_CREATE',
        params: {
          text: 'hello',
          bots: [202],
          groups: [],
          mentionEnabled: true,
          every: 1,
        },
        requestKey: 'implicit-mention-audience',
      }),
    ).rejects.toThrow('select explicit groups before enabling mention mode');
    expect(await prisma.telegramBotAdminCommand.count({ where: { adminUserId: user.id } })).toBe(0);
  });

  it('rejects secret-shaped params and results before persistence', async () => {
    const user = await mkUser();
    const fakeTelegramToken = ['123456', 'abcdefghijklmnopqrstuvwxyz'].join(':');
    await expect(
      service.createCommand(user.id, {
        type: 'OVERVIEW',
        params: { botToken: fakeTelegramToken },
        requestKey: 'secret-param',
      }),
    ).rejects.toThrow('Sensitive parameter field');
    expect(
      await prisma.telegramBotAdminCommand.count({
        where: { requestKey: `${user.id}:secret-param` },
      }),
    ).toBe(0);

    const created = await service.createCommand(user.id, {
      type: 'OVERVIEW',
      params: {},
      requestKey: 'secret-result',
    });
    const claim = await service.claimCommands('w-secret', 1);
    const row = claim.commands.find((c) => c.commandId === created.command.id);
    expect(row).toBeTruthy();
    await expect(
      service.completeCommand(created.command.id, row!.claimToken, {
        nested: { cloneToken: fakeTelegramToken },
      }),
    ).rejects.toThrow('Sensitive result field');
    const stored = await prisma.telegramBotAdminCommand.findUnique({
      where: { id: created.command.id },
    });
    expect(stored?.status).toBe('CLAIMED');
    expect(stored?.result).toBeNull();
  });

  it('concurrent workers cannot both claim one command, and stale completion is fenced', async () => {
    const user = await mkUser();
    const created = await service.createCommand(user.id, {
      type: 'OVERVIEW',
      params: {},
      requestKey: 'claim-once',
    });
    const [a, b] = await Promise.all([
      service.claimCommands('worker-a', 1),
      service.claimCommands('worker-b', 1),
    ]);
    const claims = [...a.commands, ...b.commands].filter((c) => c.commandId === created.command.id);
    expect(claims).toHaveLength(1);
    const row = await prisma.telegramBotAdminCommand.findUnique({
      where: { id: created.command.id },
    });
    expect(row?.attempts).toBe(1);

    await service.completeCommand(created.command.id, claims[0].claimToken, {
      counts: { users: 3 },
    });
    await expect(
      service.completeCommand(created.command.id, claims[0].claimToken, { counts: { users: 4 } }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.failCommand(created.command.id, claims[0].claimToken, 'late failure'),
    ).rejects.toBeInstanceOf(ConflictException);
    const done = await prisma.telegramBotAdminCommand.findUnique({
      where: { id: created.command.id },
    });
    expect(done?.status).toBe('DONE');
    expect((done?.result as { counts?: { users?: number } } | null)?.counts?.users).toBe(3);
    expect(done?.claimToken).toBeNull();
  });

  it('expired claims recover exactly once and can complete after recovery', async () => {
    const user = await mkUser();
    const created = await service.createCommand(user.id, {
      type: 'OWNER_SETTINGS_GET',
      params: {},
      requestKey: 'recover-me',
    });
    const first = await service.claimCommands('worker-a', 1);
    const firstClaim = first.commands.find((c) => c.commandId === created.command.id);
    expect(firstClaim).toBeTruthy();
    await prisma.telegramBotAdminCommand.update({
      where: { id: created.command.id },
      data: { leaseUntil: new Date(Date.now() - 1000) },
    });
    const recovered = await service.recoverCommands('worker-b', 10);
    expect(recovered.recovered).toBeGreaterThanOrEqual(1);
    const second = await service.claimCommands('worker-b', 1);
    const secondClaim = second.commands.find((c) => c.commandId === created.command.id);
    expect(secondClaim).toBeTruthy();
    expect(secondClaim!.claimToken).not.toBe(firstClaim!.claimToken);
    await expect(
      service.completeCommand(created.command.id, firstClaim!.claimToken, { stale: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    await service.completeCommand(created.command.id, secondClaim!.claimToken, {
      settings: { ownerCount: 1 },
    });
  });

  it('crash-abandoned claims dead-letter after the attempt bound', async () => {
    const user = await mkUser();
    const created = await service.createCommand(user.id, {
      type: 'OVERVIEW',
      params: {},
      requestKey: 'crash-dead',
    });
    await prisma.telegramBotAdminCommand.update({
      where: { id: created.command.id },
      data: {
        status: 'CLAIMED',
        attempts: 3,
        leaseUntil: new Date(Date.now() - 1000),
        claimToken: 'stale',
      },
    });
    const recovered = await service.recoverCommands('worker-recovery', 10);
    expect(recovered.recovered).toBe(0);
    const row = await prisma.telegramBotAdminCommand.findUnique({
      where: { id: created.command.id },
    });
    expect(row?.status).toBe('DEAD');
    expect(row?.completedAt).toBeTruthy();
  });

  it('failure requeues bounded attempts and finally dead-letters', async () => {
    const user = await mkUser();
    const created = await service.createCommand(user.id, {
      type: 'OVERVIEW',
      params: {},
      requestKey: 'dead-letter',
    });
    let lastStatus = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const claimed = await service.claimCommands(`worker-${attempt}`, 1);
      const row = claimed.commands.find((c) => c.commandId === created.command.id);
      expect(row).toBeTruthy();
      const failed = await service.failCommand(
        created.command.id,
        row!.claimToken,
        'executor failed',
      );
      lastStatus = failed.status;
    }
    expect(lastStatus).toBe('DEAD');
    const dead = await prisma.telegramBotAdminCommand.findUnique({
      where: { id: created.command.id },
    });
    expect(dead?.status).toBe('DEAD');
    expect(dead?.attempts).toBe(3);
    expect(dead?.completedAt).toBeTruthy();
  });
});
