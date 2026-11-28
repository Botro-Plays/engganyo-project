'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock3,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Users,
  MessageSquare,
  Megaphone,
  Palette,
  Settings2,
  ListOrdered,
  Building2,
} from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import {
  AccessAdminSection,
  CloneOperations,
  GroupsAdminSection,
  LookupPanels,
  StartOperations,
  SystemAdminSection,
  TicketsAdminSection,
} from './operation-sections';
import { AnnouncementAdvancedControls, AnnouncementComposer } from './announcement-composer';

type CommandStatus = 'PENDING' | 'CLAIMED' | 'DONE' | 'FAILED' | 'DEAD';

interface BotCommand {
  id: string;
  requestKey: string;
  type: string;
  status: CommandStatus;
  params: Record<string, unknown>;
  result: any;
  error: string | null;
  attempts: number;
  workerId: string | null;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  completedAt: string | null;
}

interface CommandListResponse {
  items: BotCommand[];
  total: number;
  limit: number;
  offset: number;
}

type SectionKey =
  | 'overview'
  | 'clones'
  | 'groups'
  | 'audience'
  | 'start'
  | 'announcements'
  | 'mention'
  | 'access'
  | 'tickets'
  | 'system'
  | 'settings'
  | 'commands';

const sections: Array<{ key: SectionKey; label: string; icon: typeof Bot }> = [
  { key: 'overview', label: 'Overview', icon: Bot },
  { key: 'clones', label: 'Clone Bots', icon: Building2 },
  { key: 'groups', label: 'Groups', icon: MessageSquare },
  { key: 'audience', label: 'Audience', icon: Users },
  { key: 'start', label: 'Start Studio', icon: Palette },
  { key: 'announcements', label: 'Announcements', icon: Megaphone },
  { key: 'mention', label: 'Mention Mode', icon: MessageSquare },
  { key: 'access', label: 'Access Control', icon: ShieldCheck },
  { key: 'tickets', label: 'Tickets', icon: ListOrdered },
  { key: 'system', label: 'System', icon: Settings2 },
  { key: 'settings', label: 'Owner Settings', icon: Settings2 },
  { key: 'commands', label: 'Command Log', icon: ListOrdered },
];

function fmtUnix(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 'Never';
  return new Date(n * 1000).toLocaleString();
}

function fmtDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : 'Not yet';
}

function boolText(value: unknown): string {
  return value ? 'Yes' : 'No';
}

function statusClass(status: CommandStatus): string {
  if (status === 'DONE') return 'bg-green-500/10 text-green-300 border-green-500/20';
  if (status === 'FAILED' || status === 'DEAD')
    return 'bg-red-500/10 text-red-300 border-red-500/20';
  if (status === 'CLAIMED') return 'bg-amber-500/10 text-amber-300 border-amber-500/20';
  return 'bg-blue-500/10 text-blue-300 border-blue-500/20';
}

function StatusBadge({ status }: { status: CommandStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClass(status)}`}
    >
      {status}
    </span>
  );
}

function useTelegramCommand(type: string, params: Record<string, unknown> = {}) {
  const [commandId, setCommandId] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: async (runParams: Record<string, unknown>) => {
      const res = await apiClient.post(
        'admin/telegram-bot/commands',
        { type, params: runParams, requestKey: crypto.randomUUID() },
        { skipRetry: true },
      );
      return res.data.data as { command: BotCommand; reused: boolean };
    },
    onSuccess: (data) => setCommandId(data.command.id),
  });
  const commandQuery = useQuery({
    queryKey: ['admin', 'telegram-bot', 'command', commandId],
    queryFn: async () => {
      const res = await apiClient.get(`admin/telegram-bot/commands/${commandId}`);
      return (res.data.data as { command: BotCommand }).command;
    },
    enabled: !!commandId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'DONE' || status === 'FAILED' || status === 'DEAD' ? false : 1500;
    },
  });
  const command = commandQuery.data ?? createMutation.data?.command ?? null;
  const waiting =
    createMutation.isPending ||
    (!!command &&
      command.status !== 'DONE' &&
      command.status !== 'FAILED' &&
      command.status !== 'DEAD');
  return {
    command,
    waiting,
    error: createMutation.error
      ? getApiErrorMessage(createMutation.error)
      : (command?.error ?? null),
    run: (overrides: Record<string, unknown> = {}) => {
      if (!createMutation.isPending) createMutation.mutate({ ...params, ...overrides });
    },
  };
}

function CommandCard({
  title,
  description,
  type,
  params,
  children,
}: {
  title: string;
  description: string;
  type: string;
  params?: Record<string, unknown>;
  children: (result: any, reload?: (overrides?: Record<string, unknown>) => void) => ReactNode;
}) {
  const cmd = useTelegramCommand(type, params);
  return (
    <section className="card-glass rounded-xl border border-surface-border p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-sc-text">{title}</h2>
          <p className="mt-1 text-sm text-sc-muted">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => cmd.run()}
          disabled={cmd.waiting}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {cmd.waiting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="h-4 w-4" aria-hidden="true" />
          )}
          {cmd.command ? 'Refresh' : 'Load'}
        </button>
      </div>

      <div aria-live="polite" className="mt-4">
        {cmd.command && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-sc-dim">
            <StatusBadge status={cmd.command.status} />
            <span>Attempts: {cmd.command.attempts}</span>
            <span>Updated: {fmtDate(cmd.command.updatedAt)}</span>
          </div>
        )}
        {cmd.waiting && !cmd.command?.result && (
          <div className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-hover/50 p-4 text-sm text-sc-muted">
            <Clock3 className="h-4 w-4 text-amber-300" aria-hidden="true" />
            Waiting for the Telegram bot worker to claim and complete this read-only command.
          </div>
        )}
        {cmd.error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {cmd.error}
          </div>
        )}
        {cmd.command?.status === 'DONE' && cmd.command.result
          ? children(cmd.command.result, cmd.run)
          : null}
        {!cmd.command && !cmd.waiting && (
          <div className="rounded-lg border border-dashed border-surface-border p-5 text-sm text-sc-dim">
            Select Load to request fresh data from the running Telegram bot.
          </div>
        )}
      </div>
    </section>
  );
}

function StatGrid({ counts }: { counts: Record<string, number> }) {
  const labels: Array<[string, string]> = [
    ['groups', 'Groups'],
    ['activeGroups', 'Active groups'],
    ['users', 'Users'],
    ['startedUsers', 'Started bot'],
    ['botUsers', 'Bot users'],
    ['botChats', 'Bot chats'],
    ['clones', 'Clone bots'],
    ['activeClones', 'Active clones'],
    ['announcements', 'Announcements'],
    ['activeAnnouncements', 'Active announcements'],
    ['openTickets', 'Open tickets'],
    ['channelPosts', 'Channel posts'],
    ['membersTracked', 'Members tracked'],
    ['messagesToday', 'Messages today'],
    ['activeWarns', 'Active warns'],
    ['blockedUsers', 'Blocked users'],
    ['recurringMessages', 'Recurring messages'],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {labels.map(([key, label]) => (
        <div key={key} className="rounded-lg border border-surface-border bg-surface-hover/40 p-4">
          <p className="text-xs text-sc-dim">{label}</p>
          <p className="mt-1 text-2xl font-bold text-sc-text">{counts?.[key] ?? 0}</p>
        </div>
      ))}
    </div>
  );
}

function SimpleTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: ReactNode[][];
  empty: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-surface-border">
      <table className="min-w-full divide-y divide-surface-border text-sm">
        <thead className="bg-surface-hover/50">
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-sc-dim"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-border">
          {rows.length ? (
            rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-3 py-2 align-top text-sc-muted">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length} className="px-3 py-8 text-center text-sc-dim">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function OverviewSection() {
  return (
    <CommandCard
      title="Bot health overview"
      description="Live counts from the Telegram bot SQLite state. No secrets or token material are returned."
      type="OVERVIEW"
    >
      {(result) => (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-green-300">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Snapshot generated {fmtUnix(result.generatedAt)}
          </div>
          <StatGrid counts={result.counts ?? {}} />
        </div>
      )}
    </CommandCard>
  );
}

function ClonesSection() {
  return (
    <div className="space-y-5">
      <CommandCard
        title="Clone bots"
        description="Clone inventory with owner, username, state, and creation time. Bot tokens are intentionally never exposed."
        type="CLONES_LIST"
      >
        {(result) => (
          <SimpleTable
            headers={['Clone Row', 'Bot', 'Bot ID', 'Owner', 'Audience', 'State', 'Created']}
            empty="No clone bots are registered."
            rows={(result.clones ?? []).map((clone: any) => [
              <code key="rid">#{clone.id}</code>,
              <span key="u" className="font-medium text-sc-text">
                @{clone.username ?? 'unknown'}
              </span>,
              <code key="id">{clone.botId}</code>,
              <code key="o">{clone.ownerId}</code>,
              <span key="a" className="block max-w-xs">
                {clone.userCount ?? 0} people, {clone.groupCount ?? 0} groups,{' '}
                {clone.channelCount ?? 0} channels
                {[...(clone.groupTitles ?? []), ...(clone.channelTitles ?? [])].length ? (
                  <span className="block text-xs text-sc-dim">
                    {[...(clone.groupTitles ?? []), ...(clone.channelTitles ?? [])].join(', ')}
                  </span>
                ) : null}
              </span>,
              boolText(clone.active) === 'Yes' ? 'Active' : 'Stopped',
              fmtUnix(clone.createdAt),
            ])}
          />
        )}
      </CommandCard>
      <CloneOperations />
    </div>
  );
}

function AudienceSection() {
  const [usersOffset, setUsersOffset] = useState(0);
  const [botUsersOffset, setBotUsersOffset] = useState(0);
  const [botChatsOffset, setBotChatsOffset] = useState(0);
  const pageButtons = (
    result: any,
    offset: number,
    setOffset: (value: number) => void,
    reload?: (overrides?: Record<string, unknown>) => void,
  ) => {
    const go = (next: number) => {
      setOffset(next);
      reload?.({ offset: next });
    };
    const total = Number(result?.total ?? 0);
    const limit = Math.max(1, Number(result?.limit ?? 25));
    if (!total || total <= limit) return null;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-sc-muted">
        <span>
          Page {Math.floor(offset / limit) + 1} of {Math.max(1, Math.ceil(total / limit))} · {total}{' '}
          total
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => go(Math.max(0, offset - limit))}
            disabled={offset <= 0}
            className="min-h-10 rounded-lg border border-surface-border px-3 py-2 hover:bg-surface-hover hover:text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => go(offset + limit)}
            disabled={offset + limit >= total}
            className="min-h-10 rounded-lg border border-surface-border px-3 py-2 hover:bg-surface-hover hover:text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    );
  };
  return (
    <div className="space-y-5">
      <CommandCard
        title="All known users"
        description="Every Telegram user known to the bot, with the main and clone private audiences they belong to and their known active groups."
        type="USERS_LIST"
        params={{ limit: 25, offset: usersOffset }}
      >
        {(result, reload) => (
          <div className="space-y-3">
            <SimpleTable
              headers={[
                'User',
                'User ID',
                'Bot Audiences',
                'Known Groups',
                'Language',
                'Last Seen',
              ]}
              empty="No users are known yet."
              rows={(result.users ?? []).map((user: any) => [
                <span key="n" className="text-sc-text">
                  {[user.firstName, user.lastName].filter(Boolean).join(' ') ||
                    user.username ||
                    'Unknown'}
                  {user.username ? ` @${user.username}` : ''}
                </span>,
                <code key="u">{user.userId}</code>,
                <span key="ba">
                  {user.botCount ?? 0} bot(s): {(user.botIds ?? []).join(', ') || '-'}
                </span>,
                <span key="g" className="block max-w-xs">
                  {user.activeGroupCount ?? 0} active
                  {(user.groups ?? []).length ? (
                    <span className="block text-xs text-sc-dim">
                      {(user.groups ?? []).map((g: any) => g.title ?? g.chatId).join(', ')}
                    </span>
                  ) : null}
                </span>,
                user.lang ?? '-',
                fmtUnix(user.lastSeen),
              ])}
            />
            {pageButtons(result, usersOffset, setUsersOffset, reload)}
          </div>
        )}
      </CommandCard>
      <CommandCard
        title="Main and clone bot users"
        description="Every tracked private-chat audience row across the main bot and every clone. Bot labels identify exactly which bot each user belongs to."
        type="BOT_USERS_LIST"
        params={{ limit: 25, offset: botUsersOffset }}
      >
        {(result, reload) => (
          <div className="space-y-3">
            <SimpleTable
              headers={['User', 'User ID', 'Bot', 'Bot ID', 'Language', 'Started', 'Seen']}
              empty="No bot users are tracked yet."
              rows={(result.users ?? []).map((user: any) => [
                <span key="n" className="text-sc-text">
                  {[user.firstName, user.lastName].filter(Boolean).join(' ') ||
                    user.username ||
                    'Unknown'}
                  {user.username ? ` @${user.username}` : ''}
                </span>,
                <code key="u">{user.userId}</code>,
                user.botLabel ?? '-',
                <code key="b">{user.botId}</code>,
                user.lang ?? '-',
                boolText(user.started),
                fmtUnix(user.seenAt),
              ])}
            />
            {pageButtons(result, botUsersOffset, setBotUsersOffset, reload)}
          </div>
        )}
      </CommandCard>
      <CommandCard
        title="Main and clone groups and channels"
        description="Every tracked group, supergroup, and channel visible to the main bot and clones, including type, moderation state, member counts, and owning bot."
        type="BOT_CHATS_LIST"
        params={{ limit: 25, offset: botChatsOffset }}
      >
        {(result, reload) => (
          <div className="space-y-3">
            <SimpleTable
              headers={['Chat', 'Type', 'Chat ID', 'Bot', 'Members', 'State', 'Seen']}
              empty="No bot groups or channels are tracked yet."
              rows={(result.chats ?? []).map((chat: any) => [
                <span key="t" className="text-sc-text">
                  {chat.title ?? 'Untitled'}
                </span>,
                chat.type ?? '-',
                <code key="c">{chat.chatId}</code>,
                <span key="b">
                  {chat.botLabel ?? '-'} <code>{chat.botId}</code>
                </span>,
                chat.memberCount ?? 0,
                `${chat.active ? 'Active' : 'Inactive'}${chat.banned ? ', banned' : ''}`,
                fmtUnix(chat.seenAt),
              ])}
            />
            {pageButtons(result, botChatsOffset, setBotChatsOffset, reload)}
          </div>
        )}
      </CommandCard>
      <LookupPanels />
    </div>
  );
}

function StartStudioSection() {
  return (
    <div className="space-y-5">
      <CommandCard
        title="Start Studio configurations"
        description="Read-only inventory of custom start messages for the main bot and clone bots. Media file identifiers are withheld."
        type="START_MESSAGES_LIST"
      >
        {(result) => (
          <SimpleTable
            headers={['Bot ID', 'State', 'Message', 'Buttons', 'Add-me button', 'Media']}
            empty="No custom start messages are configured."
            rows={(result.startMessages ?? []).map((item: any) => [
              <code key="b">{item.botId}</code>,
              item.enabled ? 'Enabled' : 'Disabled',
              <span key="m" className="block max-w-md whitespace-pre-wrap">
                {item.textPreview || `${item.textLength ?? 0} characters`}
              </span>,
              item.buttonRows ?? 0,
              boolText(item.addButton),
              item.media?.type ?? 'None',
            ])}
          />
        )}
      </CommandCard>
      <StartOperations />
    </div>
  );
}

function AnnouncementsSection() {
  return (
    <div className="space-y-5">
      <CommandCard
        title="Announcements"
        description="Delivery inventory, counters, audience flags, and safe content previews. Channels are included in Send Now delivery; mention mode uses groups only."
        type="ANNOUNCEMENTS_LIST"
        params={{ limit: 50 }}
      >
        {(result) => (
          <div className="space-y-3">
            <p className="text-sm text-sc-muted">
              Showing {(result.announcements ?? []).length} of {result.total ?? 0} announcements.
            </p>
            <SimpleTable
              headers={['ID', 'State', 'Audience', 'Delivery', 'Mention mode', 'Created']}
              empty="No announcements exist yet."
              rows={(result.announcements ?? []).map((item: any) => [
                <code key="i">#{item.id}</code>,
                item.active ? 'Active' : 'Inactive',
                `${item.bots?.includes('all') ? 'All bots' : `${(item.bots ?? []).length} bots`}; ${item.selectedGroups?.includes('all') ? 'all groups' : `${(item.selectedGroups ?? []).length} groups`}`,
                `${item.sent ?? 0} sent, ${item.failed ?? 0} failed`,
                `${item.shown ?? 0} shown, every ${item.mentionEvery ?? 1}`,
                fmtUnix(item.createdAt),
              ])}
            />
          </div>
        )}
      </CommandCard>
      <AnnouncementComposer />
      <AnnouncementAdvancedControls />
      <AnnouncementInspector />
    </div>
  );
}

function AnnouncementInspector() {
  const [id, setId] = useState('');
  const numericId = Number(id);
  const valid = Number.isInteger(numericId) && numericId > 0;
  return (
    <div className="card-glass rounded-xl border border-surface-border p-5">
      <h2 className="text-base font-semibold text-sc-text">Announcement details</h2>
      <p className="mt-1 text-sm text-sc-muted">Inspect one announcement and its audience by ID.</p>
      <label className="mt-4 block text-xs font-medium text-sc-dim" htmlFor="announcement-id">
        Announcement ID
      </label>
      <input
        id="announcement-id"
        value={id}
        onChange={(event) => setId(event.target.value.replace(/[^0-9]/g, ''))}
        inputMode="numeric"
        className="mt-1 w-full max-w-xs rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-sm text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
        placeholder="Example: 1"
      />
      {valid ? (
        <div className="mt-5 space-y-5">
          <CommandCard
            title="Content and counters"
            description="Full safe text preview with media type only."
            type="ANNOUNCEMENT_GET"
            params={{ announcementId: numericId }}
          >
            {(result) =>
              result.announcement ? (
                <div className="space-y-3 text-sm text-sc-muted">
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge status={result.announcement.active ? 'DONE' : 'FAILED'} />
                    <span className="rounded-full border border-surface-border px-2 py-0.5 text-xs">
                      {result.announcement.sent} sent
                    </span>
                    <span className="rounded-full border border-surface-border px-2 py-0.5 text-xs">
                      {result.announcement.failed} failed
                    </span>
                    <span className="rounded-full border border-surface-border px-2 py-0.5 text-xs">
                      Media: {result.announcement.message?.media?.type ?? 'none'}
                    </span>
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-surface-border bg-surface-hover/50 p-3 text-xs text-sc-text">
                    {result.announcement.message?.text || 'No text content'}
                  </pre>
                </div>
              ) : (
                <p className="text-sm text-sc-dim">Announcement not found.</p>
              )
            }
          </CommandCard>
          <CommandCard
            title="Audience selection"
            description="Bots and groups selected for this announcement."
            type="ANNOUNCEMENT_AUDIENCE_GET"
            params={{ announcementId: numericId }}
          >
            {(result) =>
              result.audience ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <SimpleTable
                    headers={['Bot', 'Users', 'Groups']}
                    empty="No bots selected."
                    rows={(result.audience.bots ?? []).map((bot: any) => [
                      `@${bot.username} (${bot.botId})`,
                      bot.userCount,
                      bot.chatCount,
                    ])}
                  />
                  <SimpleTable
                    headers={['Group', 'Members', 'State']}
                    empty="No specific groups selected. Depending on mode, every group may be eligible."
                    rows={(result.audience.groups ?? []).map((group: any) => [
                      group.title ?? group.chatId,
                      group.memberCount,
                      `${group.active ? 'Active' : 'Inactive'}${group.banned ? ', banned' : ''}`,
                    ])}
                  />
                </div>
              ) : (
                <p className="text-sm text-sc-dim">Audience not found.</p>
              )
            }
          </CommandCard>
        </div>
      ) : (
        <p className="mt-3 text-sm text-sc-dim">
          Enter a positive numeric announcement ID to inspect it.
        </p>
      )}
    </div>
  );
}

function MentionSection() {
  return (
    <CommandCard
      title="Mention mode"
      description="Read-only /mentionall delivery state, including the one-post-per-group-per-hour safety rule."
      type="MENTION_STATUS_GET"
    >
      {(result) => (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">
            Group cooldown: {Math.round((result.mention?.groupCooldownSeconds ?? 3600) / 60)}{' '}
            minutes. Announcements are posted at most once per group per hour and only after the
            configured usage interval.
          </div>
          <SimpleTable
            headers={[
              'Announcement',
              'Enabled',
              'Shown',
              'Every N uses',
              'Selected groups',
              'Last posted',
            ]}
            empty="No active announcements use mention mode."
            rows={(result.mention?.announcements ?? []).map((item: any) => [
              <code key="i">#{item.id}</code>,
              boolText(item.enabled),
              item.shown ?? 0,
              item.every ?? 1,
              item.selectedGroupCount ?? 0,
              fmtUnix(item.lastAt),
            ])}
          />
        </div>
      )}
    </CommandCard>
  );
}

function SettingsSection() {
  return (
    <CommandCard
      title="Owner settings"
      description="Non-sensitive runtime configuration. Tokens, secrets, database paths, and environment values are deliberately excluded."
      type="OWNER_SETTINGS_GET"
    >
      {(result) => {
        const settings = result.settings ?? {};
        return (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {[
              ['Owner count', settings.ownerCount],
              ['Default language', settings.defaultLanguage],
              ['Default timezone', settings.defaultTimezone],
              ['Log level', settings.logLevel],
              ['Webhook configured', boolText(settings.webhookConfigured)],
              ['Platform channel configured', boolText(settings.platformLinked)],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-lg border border-surface-border bg-surface-hover/40 p-4"
              >
                <p className="text-xs text-sc-dim">{label}</p>
                <p className="mt-1 text-sm font-semibold text-sc-text">{String(value ?? '-')}</p>
              </div>
            ))}
          </div>
        );
      }}
    </CommandCard>
  );
}

function CommandLogSection() {
  const list = useQuery({
    queryKey: ['admin', 'telegram-bot', 'commands'],
    queryFn: async () => {
      const res = await apiClient.get('admin/telegram-bot/commands?limit=50');
      return res.data.data as CommandListResponse;
    },
    refetchInterval: 10000,
  });
  return (
    <section className="card-glass rounded-xl border border-surface-border p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-sc-text">Command log</h2>
          <p className="mt-1 text-sm text-sc-muted">
            Audited bridge requests created by this admin account. The list refreshes every 10
            seconds.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void list.refetch()}
          className="rounded-lg border border-surface-border p-2 text-sc-muted hover:bg-surface-hover hover:text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
          aria-label="Refresh command log"
        >
          <RefreshCw
            className={`h-4 w-4 ${list.isFetching ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>
      <div className="mt-5" aria-live="polite">
        {list.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-sc-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading command log.
          </div>
        ) : list.error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200"
          >
            {getApiErrorMessage(list.error)}
          </div>
        ) : (
          <SimpleTable
            headers={['Type', 'Status', 'Attempts', 'Created', 'Completed', 'Error']}
            empty="No Telegram bot commands have been created yet."
            rows={(list.data?.items ?? []).map((item) => [
              <code key="t">{item.type}</code>,
              <StatusBadge key="s" status={item.status} />,
              item.attempts,
              fmtDate(item.createdAt),
              fmtDate(item.completedAt),
              item.error ?? '-',
            ])}
          />
        )}
      </div>
    </section>
  );
}

export default function TelegramBotAdminPage() {
  const { user } = useAuthStore();
  const [section, setSection] = useState<SectionKey>('overview');
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertCircle className="mb-3 h-10 w-10 text-red-500/60" aria-hidden="true" />
        <p className="text-sm text-sc-muted">
          Telegram bot administration is restricted to Super Admins only.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-xl font-bold text-sc-text">
          <Bot className="h-5 w-5 text-brand-400" aria-hidden="true" />
          Telegram Bot Admin
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-sc-muted">
          Secure operations center for the Telegram developer panel. Reads and confirmed mutations
          travel through the authenticated bot bridge, are audited, and never expose bot tokens or
          raw media identifiers.
        </p>
      </div>

      <div
        className="mb-6 flex gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Telegram bot admin sections"
      >
        {sections.map((item) => {
          const active = section === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSection(item.key)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                active
                  ? 'border-brand-500/30 bg-brand-500/15 text-brand-200'
                  : 'border-surface-border text-sc-muted hover:bg-surface-hover hover:text-sc-text'
              }`}
            >
              <item.icon className="h-4 w-4" aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
      </div>

      {section === 'overview' && <OverviewSection />}
      {section === 'clones' && <ClonesSection />}
      {section === 'groups' && <GroupsAdminSection />}
      {section === 'audience' && <AudienceSection />}
      {section === 'start' && <StartStudioSection />}
      {section === 'announcements' && <AnnouncementsSection />}
      {section === 'mention' && <MentionSection />}
      {section === 'access' && <AccessAdminSection />}
      {section === 'tickets' && <TicketsAdminSection />}
      {section === 'system' && <SystemAdminSection />}
      {section === 'settings' && <SettingsSection />}
      {section === 'commands' && <CommandLogSection />}
    </div>
  );
}
