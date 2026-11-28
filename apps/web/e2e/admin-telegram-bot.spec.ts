import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { totpCodeStable } from './totp';

const API = process.env.E2E_API_URL ?? 'http://localhost:3001/api';
const EMAIL = process.env.E2E_SUPER_ADMIN_EMAIL ?? 'e2esuperadmin@engganyo.com';
const PASSWORD = process.env.E2E_SUPER_ADMIN_PASSWORD ?? 'E2eSuperAdmin@123';
const BOT_KEY = process.env.E2E_TELEGRAM_BOT_SERVICE_KEY ?? 'e2e-telegram-service-key';

let adminToken = '';

function unwrap(body: any) {
  return body?.data ?? body;
}

function resultFor(type: string): Record<string, unknown> {
  if (type === 'OVERVIEW') {
    return {
      generatedAt: Math.floor(Date.now() / 1000),
      counts: {
        groups: 2,
        activeGroups: 2,
        users: 8,
        botUsers: 5,
        botChats: 2,
        clones: 1,
        activeClones: 1,
        announcements: 1,
        activeAnnouncements: 1,
        openTickets: 1,
        channelPosts: 0,
      },
    };
  }
  if (type === 'CLONES_LIST') {
    return {
      clones: [
        {
          id: 1,
          botId: 202,
          username: 'CloneOneBot',
          ownerId: 101,
          active: true,
          userCount: 5,
          groupCount: 1,
          groupTitles: ['Main Group'],
          createdAt: 1770000000,
        },
      ],
      total: 1,
    };
  }
  if (type === 'USERS_LIST') {
    return {
      users: [
        {
          userId: 101,
          firstName: 'Ada',
          lastName: '',
          username: 'ada',
          lang: 'en',
          started: true,
          isBot: false,
          firstSeen: 1770000000,
          lastSeen: 1770000000,
          botIds: [202],
          botCount: 1,
          activeGroupCount: 1,
          groups: [{ chatId: -1001, title: 'Main Group', type: 'supergroup' }],
        },
      ],
      total: 1,
      limit: 25,
      offset: 0,
    };
  }
  if (type === 'BOT_USERS_LIST') {
    return {
      users: [
        {
          botId: 202,
          botLabel: '@CloneOneBot',
          userId: 101,
          firstName: 'Ada',
          lastName: '',
          username: 'ada',
          lang: 'en',
          started: true,
          isBot: false,
          seenAt: 1770000000,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    };
  }
  if (type === 'BOT_CHATS_LIST') {
    return {
      chats: [
        {
          botId: 202,
          botLabel: '@CloneOneBot',
          chatId: -1001,
          title: 'Main Group',
          type: 'supergroup',
          active: true,
          banned: false,
          memberCount: 42,
          ownerId: 101,
          seenAt: 1770000000,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    };
  }
  if (type === 'START_MESSAGES_LIST') {
    return {
      startMessages: [
        {
          botId: 202,
          enabled: true,
          textLength: 11,
          textPreview: 'Welcome',
          buttonRows: 1,
          addButton: true,
          media: null,
        },
      ],
      total: 1,
    };
  }
  if (type === 'ANNOUNCEMENTS_LIST') {
    return {
      announcements: [
        {
          id: 1,
          active: true,
          createdAt: 1770000000,
          sent: 3,
          failed: 0,
          shown: 1,
          lastAt: 1770000000,
          byAdmin: 0,
          dm: true,
          groupsMode: true,
          mentionEvery: 2,
          bots: ['all'],
          selectedGroups: ['all'],
          message: { textLength: 5, hasButtons: false, media: null },
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    };
  }
  if (type === 'MENTION_STATUS_GET') {
    return {
      mention: {
        groupCooldownSeconds: 3600,
        announcements: [
          { id: 1, enabled: true, shown: 2, every: 2, selectedGroupCount: 0, lastAt: 1770000000 },
        ],
      },
    };
  }
  if (type === 'OWNER_SETTINGS_GET') {
    return {
      settings: {
        ownerCount: 1,
        defaultLanguage: 'en',
        defaultTimezone: 'UTC',
        logLevel: 'INFO',
        webhookConfigured: false,
        platformLinked: true,
      },
    };
  }
  if (type === 'GROUPS_LIST') {
    return {
      groups: [
        {
          chatId: -1001,
          title: 'Main Group',
          type: 'supergroup',
          lang: 'en',
          timezone: 'UTC',
          ownerId: 101,
          active: true,
          banned: false,
          banReason: null,
          memberCount: 42,
          logChannel: null,
          staffGroup: null,
          linkedChat: null,
          addedAt: 1770000000,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    };
  }
  if (type === 'GROUPS_EXPORT')
    return {
      filename: 'telegram-groups.csv',
      rowCount: 1,
      csv: 'chat_id,title,type,active,banned,member_count,owner_id\n-1001,"Main Group",supergroup,1,0,42,101\n',
    };
  if (type === 'BLOCKLIST_LIST') return { entries: [], total: 0, limit: 20, offset: 0 };
  if (type === 'WHITELIST_GET') return { entries: ['example.com'], total: 1 };
  if (type === 'TICKETS_LIST')
    return {
      tickets: [
        {
          id: 1,
          userId: 101,
          chatId: 101,
          kind: 'support',
          text: 'Need help',
          status: 'open',
          reply: null,
          createdAt: 1770000000,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    };
  if (type === 'SYSTEM_STATUS')
    return {
      system: { reducedMode: false, ownerCount: 1, webhookConfigured: false, logLevel: 'INFO' },
    };
  if (type === 'ADMINS_LIST') return { owners: [101], admins: [] };
  if (type === 'AUDIT_LIST')
    return {
      entries: [{ id: 1, adminId: 0, action: 'test', detail: 'ok', createdAt: 1770000000 }],
    };
  if (type === 'ANNOUNCEMENT_OPTIONS_GET') {
    return {
      bots: [{ botId: 202, label: '@CloneOneBot' }],
      groups: [{ chatId: -1001, title: 'Main Group', memberCount: 42, botId: 202 }],
      channels: [{ chatId: -2002, title: 'Main Channel', memberCount: 500, botId: 202 }],
      everyChoices: [1, 2, 3, 5, 10, 20],
      mediaTypes: ['animation', 'audio', 'document', 'photo', 'video'],
    };
  }
  if (type === 'ANNOUNCEMENT_CREATE') return { announcementId: 9, created: true };
  if (type === 'ANNOUNCEMENT_DELIVERY_GET')
    return {
      delivery: {
        announcementId: 1,
        exists: true,
        sent: 3,
        failed: 0,
        shown: 1,
        lastAt: 1770000000,
        webRun: { status: 'done' },
      },
    };
  return { ok: true };
}

async function completeBotCommands(request: APIRequestContext, expectedType?: string) {
  const headers = { 'x-telegram-bot-key': BOT_KEY };
  let sawCommand = false;
  let quietRounds = 0;
  for (let round = 0; round < 30; round += 1) {
    const claim = await request.post(`${API}/telegram/bot/admin-commands/claim`, {
      headers,
      data: { workerId: 'playwright-bot', limit: 10 },
    });
    expect(claim.ok()).toBeTruthy();
    const commands = unwrap(await claim.json()).commands ?? [];
    if (!commands.length) {
      if (sawCommand) {
        quietRounds += 1;
        if (quietRounds >= 2) return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    sawCommand = true;
    quietRounds = 0;
    for (const command of commands) {
      const done = await request.post(`${API}/telegram/bot/admin-commands/complete`, {
        headers,
        data: {
          commandId: command.commandId,
          claimToken: command.claimToken,
          result: resultFor(command.type),
        },
      });
      expect(done.ok()).toBeTruthy();
    }
  }
  throw new Error(`No bot command was claimable${expectedType ? ` for ${expectedType}` : ''}`);
}

async function clickAllVisibleLoads(page: Page, request: APIRequestContext) {
  const count = await page.getByRole('button', { name: /^Load$/ }).count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    // Mutations disable sibling actions until the pending command settles.
    // Complete each bridge command before arming the next read operation.
    await page
      .getByRole('button', { name: /^Load$/ })
      .first()
      .click();
    await completeBotCommands(request);
  }
}

test.describe('admin telegram bot control center', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page, request }) => {
    const login = await request.post(`${API}/auth/login`, {
      data: { emailOrUsername: EMAIL, password: PASSWORD },
    });
    expect(login.ok()).toBeTruthy();
    let body = await login.json();
    const twoFactorToken = body.data?.twoFactorToken ?? body.twoFactorToken;
    if ((body.data?.requiresTwoFactor ?? body.requiresTwoFactor) && twoFactorToken) {
      const verify = await request.post(`${API}/auth/2fa/verify`, {
        data: {
          twoFactorToken,
          code: await totpCodeStable(process.env.E2E_ADMIN_TOTP_SECRET ?? ''),
          method: 'totp',
        },
      });
      expect(verify.ok()).toBeTruthy();
      body = await verify.json();
    }
    const token = body.data?.accessToken ?? body.accessToken;
    expect(token).toBeTruthy();
    adminToken = token;
    const me = await request.get(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.ok()).toBeTruthy();
    const user = (await me.json()).data;
    expect(user.role).toBe('SUPER_ADMIN');
    await page.addInitScript(
      ([t, u]) => {
        localStorage.setItem('access_token', t);
        localStorage.setItem(
          'engganyo-auth',
          JSON.stringify({
            state: { accessToken: t, isAuthenticated: true, adminPin: null, user: u },
            version: 0,
          }),
        );
      },
      [token, user],
    );
  });

  test('every read-only section completes through the fenced bot bridge', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/admin/telegram-bot');
    await expect(page.getByRole('heading', { name: 'Telegram Bot Admin' })).toBeVisible();

    const tabs: Array<[string, string, RegExp]> = [
      ['Overview', 'Bot health overview', /Snapshot generated/],
      ['Clone Bots', 'Clone bots', /@CloneOneBot/],
      ['Groups', 'Group directory', /Main Group/],
      ['Audience', 'Bot users', /@ada|Ada/],
      ['Start Studio', 'Start Studio configurations', /Welcome/],
      ['Announcements', 'Delivery inventory', /#1/],
      ['Mention Mode', 'Mention mode', /Group cooldown/],
      ['Access Control', 'Current blocklist', /blocklist is empty|User/],
      ['Tickets', 'Open tickets', /Need help/],
      ['System', 'Runtime status', /reducedMode|Reduced mode|ownerCount/],
      ['Owner Settings', 'Owner settings', /Default language/],
    ];

    for (const [tab, sectionText, expected] of tabs) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.locator('section', { hasText: sectionText }).first()).toBeVisible();
      await clickAllVisibleLoads(page, request);
      await expect(page.getByText(expected).first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('DONE').first()).toBeVisible();
    }

    const list = await request.get(`${API}/admin/telegram-bot/commands?limit=100`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(list.ok()).toBeTruthy();
    const items = unwrap(await list.json()).items ?? [];
    for (const type of [
      'OVERVIEW',
      'CLONES_LIST',
      'GROUPS_LIST',
      'GROUPS_EXPORT',
      'USERS_LIST',
      'BOT_USERS_LIST',
      'BOT_CHATS_LIST',
      'START_MESSAGES_LIST',
      'ANNOUNCEMENTS_LIST',
      'MENTION_STATUS_GET',
      'BLOCKLIST_LIST',
      'WHITELIST_GET',
      'TICKETS_LIST',
      'SYSTEM_STATUS',
      'ADMINS_LIST',
      'AUDIT_LIST',
      'OWNER_SETTINGS_GET',
    ]) {
      expect(
        items.some((item: any) => item.type === type && item.status === 'DONE'),
        type,
      ).toBeTruthy();
    }

    await page.getByRole('tab', { name: 'Command Log' }).click();
    await expect(page.getByRole('heading', { name: 'Command log' })).toBeVisible();
    await expect(page.getByText('OVERVIEW').first()).toBeVisible();
  });

  test('composer and destructive controls require confirmation and finish through the bridge', async ({
    page,
    request,
  }) => {
    await page.goto('/admin/telegram-bot');
    await page.getByRole('tab', { name: 'Announcements' }).click();
    await page.getByRole('button', { name: 'Load options' }).click();
    await completeBotCommands(request, 'ANNOUNCEMENT_OPTIONS_GET');
    await expect(page.getByText('@CloneOneBot')).toBeVisible();

    await page.locator('#ann-text').fill('E2E announcement');
    await page.getByLabel('All bots').check();
    await page.getByLabel(/Main Group/).check();
    await page.getByLabel('All eligible channels').check();
    await page.getByLabel('Enable with /mentionall').check();
    await page.getByRole('button', { name: 'Create Announcement' }).click();
    await expect(page.getByRole('button', { name: 'Confirm Create' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm Create' }).click();
    await completeBotCommands(request, 'ANNOUNCEMENT_CREATE');
    await expect(page.getByText('"announcementId": 9')).toBeVisible({ timeout: 10000 });

    await page.getByRole('tab', { name: 'Clone Bots' }).click();
    await page.locator('#clone-id').fill('1');
    await page.getByRole('button', { name: 'Stop Clone' }).click();
    await expect(page.getByRole('button', { name: 'Confirm Stop' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel Stop Clone' }).click();
    await expect(page.getByRole('button', { name: 'Stop Clone' })).toBeVisible();
    await page.getByRole('button', { name: 'Stop Clone' }).click();
    await page.getByRole('button', { name: 'Confirm Stop' }).click();
    await completeBotCommands(request, 'CLONE_SET_ACTIVE');
    await expect(page.getByText('Completed. Attempts:').first()).toBeVisible({ timeout: 10000 });

    const list = await request.get(`${API}/admin/telegram-bot/commands?limit=20`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(list.ok()).toBeTruthy();
    const items = unwrap(await list.json()).items ?? [];
    expect(
      items.some(
        (item: any) =>
          item.type === 'ANNOUNCEMENT_CREATE' &&
          item.status === 'DONE' &&
          item.params?.mentionEnabled === true &&
          JSON.stringify(item.params?.groups ?? []).includes('-1001') &&
          JSON.stringify(item.params?.channels ?? []).includes('all'),
      ),
    ).toBeTruthy();
    expect(
      items.some((item: any) => item.type === 'CLONE_SET_ACTIVE' && item.status === 'DONE'),
    ).toBeTruthy();
  });
});
