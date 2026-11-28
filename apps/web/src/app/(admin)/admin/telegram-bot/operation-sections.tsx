'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, Play } from 'lucide-react';
import {
  MutationControl,
  OperationCard,
  TextNumberInput,
  positiveInt,
  signedInt,
  useCommand,
} from './operations';

function fmtUnix(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toLocaleString() : 'Never';
}

function boolText(value: unknown): string {
  return value ? 'Yes' : 'No';
}

function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function Pager({
  result,
  offset,
  onOffset,
}: {
  result: any;
  offset: number;
  onOffset: (offset: number) => void;
}) {
  const total = Number(result?.total ?? 0);
  const limit = Math.max(1, Number(result?.limit ?? 20));
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(offset / limit) + 1;
  if (!total || pages <= 1) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-sc-muted">
      <span>
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onOffset(Math.max(0, offset - limit))}
          disabled={offset <= 0}
          className="min-h-10 rounded-lg border border-surface-border px-3 py-2 hover:bg-surface-hover hover:text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => onOffset(offset + limit)}
          disabled={offset + limit >= total}
          className="min-h-10 rounded-lg border border-surface-border px-3 py-2 hover:bg-surface-hover hover:text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function MiniTable({
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
                className="px-3 py-2 text-left text-xs font-semibold uppercase text-sc-dim"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-border">
          {rows.length ? (
            rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2 align-top text-sc-muted">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length} className="px-3 py-6 text-center text-sc-dim">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ReadPanel({
  title,
  type,
  params,
  onDone,
  children,
}: {
  title: string;
  type: string;
  params?: Record<string, unknown>;
  onDone?: (result: any) => void;
  children: (result: any, reload: (overrides?: Record<string, unknown>) => void) => ReactNode;
}) {
  const cmd = useCommand();
  useEffect(() => {
    if (cmd.command?.status === 'DONE' && cmd.command.result && onDone) {
      onDone(cmd.command.result);
    }
  }, [cmd.command, onDone]);
  const load = (overrides?: Record<string, unknown>) =>
    cmd.run(type, { ...(params ?? {}), ...(overrides ?? {}) });
  return (
    <div className="rounded-lg border border-surface-border bg-surface-hover/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-sc-text">{title}</p>
        <button
          type="button"
          onClick={() => load()}
          disabled={cmd.pending}
          className="inline-flex items-center gap-2 rounded-lg border border-surface-border px-3 py-1.5 text-xs text-sc-muted hover:bg-surface-hover hover:text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
        >
          {cmd.pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {cmd.command ? 'Refresh' : 'Load'}
        </button>
      </div>
      <div aria-live="polite">
        {cmd.command && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-sc-dim">
            <span
              className={`rounded-full border px-2 py-0.5 font-semibold ${
                cmd.command.status === 'DONE'
                  ? 'border-green-500/20 bg-green-500/10 text-green-300'
                  : cmd.command.status === 'FAILED' || cmd.command.status === 'DEAD'
                    ? 'border-red-500/20 bg-red-500/10 text-red-300'
                    : 'border-amber-500/20 bg-amber-500/10 text-amber-300'
              }`}
            >
              {cmd.command.status}
            </span>
            <span>Attempts: {cmd.command.attempts}</span>
          </div>
        )}
        {cmd.error && (
          <p role="alert" className="mb-2 text-xs text-red-300">
            {cmd.error}
          </p>
        )}
        {cmd.command?.status === 'DONE' && cmd.command.result ? (
          children(cmd.command.result, load)
        ) : (
          <p className="text-xs text-sc-dim">
            {cmd.pending ? 'Waiting for the bot worker.' : 'Load this section when needed.'}
          </p>
        )}
      </div>
    </div>
  );
}

export function CloneOperations() {
  const [cloneIdText, setCloneIdText] = useState('');
  const cloneId = positiveInt(cloneIdText);
  return (
    <OperationCard
      title="Clone controls"
      description="Start, stop, or remove one clone by its numeric clone row ID. Removal stops the clone before deleting its registration."
    >
      <TextNumberInput
        id="clone-id"
        label="Clone row ID"
        value={cloneIdText}
        onChange={setCloneIdText}
        placeholder="Example: 1"
      />
      {cloneId ? (
        <>
          <MutationControl
            type="CLONE_SET_ACTIVE"
            params={{ cloneId, active: true }}
            label="Start Clone"
            confirmLabel="Confirm Start"
            description="Starts the cloned bot process if it is stopped. Idempotent."
          />
          <MutationControl
            type="CLONE_SET_ACTIVE"
            params={{ cloneId, active: false }}
            label="Stop Clone"
            confirmLabel="Confirm Stop"
            description="Stops polling for this clone but preserves its registration and audience."
            dangerous
          />
          <MutationControl
            type="CLONE_REMOVE"
            params={{ cloneId }}
            label="Remove Clone"
            confirmLabel="Confirm Remove"
            description="Stops and permanently unregisters this clone. Existing historical audience rows remain."
            dangerous
          />
        </>
      ) : (
        <p className="text-xs text-sc-dim">Enter a positive clone row ID to enable controls.</p>
      )}
    </OperationCard>
  );
}

export function GroupsAdminSection() {
  const [chatIdText, setChatIdText] = useState('');
  const [groupOffset, setGroupOffset] = useState(0);
  const chatId = signedInt(chatIdText);
  return (
    <div className="space-y-5">
      <OperationCard
        title="Group directory"
        description="All chats known to the bot, including inactive and banned states."
      >
        <ReadPanel title="Groups" type="GROUPS_LIST" params={{ limit: 20, offset: groupOffset }}>
          {(result, reload) => (
            <>
              <MiniTable
                headers={['Group', 'Chat ID', 'Members', 'State', 'Owner']}
                empty="No groups are known."
                rows={(result.groups ?? []).map((g: any) => [
                  <span key="t" className="text-sc-text">
                    {g.title ?? 'Untitled'}
                  </span>,
                  <code key="c">{g.chatId}</code>,
                  g.memberCount ?? 0,
                  `${g.active ? 'Active' : 'Inactive'}${g.banned ? ', banned' : ''}`,
                  <code key="o">{g.ownerId ?? '-'}</code>,
                ])}
              />
              <Pager
                result={result}
                offset={groupOffset}
                onOffset={(next) => {
                  setGroupOffset(next);
                  reload({ offset: next });
                }}
              />
            </>
          )}
        </ReadPanel>
        <ReadPanel title="Export all groups" type="GROUPS_EXPORT">
          {(result) => (
            <div className="space-y-3">
              <p className="text-xs text-sc-muted">{result.rowCount ?? 0} rows exported.</p>
              <button
                type="button"
                onClick={() =>
                  downloadCsv(result.filename ?? 'telegram-groups.csv', result.csv ?? '')
                }
                className="rounded-lg border border-surface-border px-3 py-2 text-xs text-sc-muted hover:bg-surface-hover hover:text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                Download CSV
              </button>
              <pre className="max-h-36 overflow-auto rounded border border-surface-border bg-sc-panel-2 p-2 text-[11px] text-sc-muted">
                {result.csv ?? ''}
              </pre>
            </div>
          )}
        </ReadPanel>
      </OperationCard>
      <OperationCard
        title="Group controls"
        description="Explicit state changes are idempotent. Leave and reset require confirmation because they affect live groups."
      >
        <TextNumberInput
          id="group-chat-id"
          label="Chat ID"
          value={chatIdText}
          onChange={setChatIdText}
          placeholder="Example: -100123456789"
        />
        {chatId ? (
          <>
            <ReadPanel title="Group detail" type="GROUP_GET" params={{ chatId }}>
              {(result) =>
                result.group ? (
                  <MiniTable
                    headers={['Field', 'Value']}
                    empty="No detail."
                    rows={Object.entries(result.group).map(([key, value]) => [
                      key,
                      typeof value === 'boolean' ? boolText(value) : String(value ?? '-'),
                    ])}
                  />
                ) : (
                  <p className="text-xs text-sc-dim">Group not found.</p>
                )
              }
            </ReadPanel>
            <MutationControl
              type="GROUP_BAN"
              params={{ chatId }}
              label="Ban Chat"
              confirmLabel="Confirm Ban"
              description="Marks the chat banned. The Telegram leave attempt is performed by the bot when runtime access is available."
              dangerous
            />
            <MutationControl
              type="GROUP_UNBAN"
              params={{ chatId }}
              label="Unban Chat"
              confirmLabel="Confirm Unban"
              description="Clears the banned flag without changing any other group state."
            />
            <MutationControl
              type="GROUP_LEAVE"
              params={{ chatId }}
              label="Leave Group"
              confirmLabel="Confirm Leave"
              description="Asks Telegram to leave the group and marks the chat inactive."
              dangerous
            />
            <MutationControl
              type="GROUP_RESET_SETTINGS"
              params={{ chatId }}
              label="Reset Settings"
              confirmLabel="Confirm Reset"
              description="Restores this group's moderation settings to defaults."
              dangerous
            />
            <MutationControl
              type="GROUP_INVITE_LINK"
              params={{ chatId }}
              label="Invite Link"
              confirmLabel="Confirm Link"
              description="Exports an invite link through the bot. Use only when necessary; this action is audited."
            />
          </>
        ) : (
          <p className="text-xs text-sc-dim">
            Enter a non-zero numeric chat ID to enable controls.
          </p>
        )}
      </OperationCard>
    </div>
  );
}

export function AccessAdminSection() {
  const [userIdText, setUserIdText] = useState('');
  const [reason, setReason] = useState('web_admin');
  const [durationText, setDurationText] = useState('');
  const [importText, setImportText] = useState('');
  const [whitelistText, setWhitelistText] = useState('');
  const [whitelistLoaded, setWhitelistLoaded] = useState(false);
  const [blocklistOffset, setBlocklistOffset] = useState(0);
  const userId = positiveInt(userIdText);
  const durationSeconds = positiveInt(durationText) ?? 0;
  const importIds = Array.from(
    new Set(
      importText
        .split(/[\s,]+/)
        .map((x) => Number(x))
        .filter((x) => Number.isSafeInteger(x) && x > 0),
    ),
  ).slice(0, 1000);
  const entries = whitelistText
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
  return (
    <div className="space-y-5">
      <OperationCard
        title="Global blocklist"
        description="Users blocked across every group. Add and remove operations are idempotent."
      >
        <ReadPanel
          title="Current blocklist"
          type="BLOCKLIST_LIST"
          params={{ limit: 20, offset: blocklistOffset }}
        >
          {(result, reload) => (
            <>
              <MiniTable
                headers={['User', 'Reason', 'Until', 'Created']}
                empty="The global blocklist is empty."
                rows={(result.entries ?? []).map((e: any) => [
                  <span key="u" className="text-sc-text">
                    {e.firstName ?? e.username ?? e.userId} <code>{e.userId}</code>
                  </span>,
                  e.reason ?? '-',
                  e.until ? fmtUnix(e.until) : 'Permanent',
                  fmtUnix(e.createdAt),
                ])}
              />
              <Pager
                result={result}
                offset={blocklistOffset}
                onOffset={(next) => {
                  setBlocklistOffset(next);
                  reload({ offset: next });
                }}
              />
            </>
          )}
        </ReadPanel>
        <div className="grid gap-3 md:grid-cols-3">
          <TextNumberInput
            id="block-user-id"
            label="Telegram user ID"
            value={userIdText}
            onChange={setUserIdText}
          />
          <div>
            <label htmlFor="block-reason" className="block text-xs font-medium text-sc-dim">
              Reason
            </label>
            <input
              id="block-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 300))}
              className="mt-1 w-full rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-sm text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <TextNumberInput
            id="block-duration"
            label="Duration seconds, blank means permanent"
            value={durationText}
            onChange={setDurationText}
          />
        </div>
        {userId ? (
          <>
            <MutationControl
              type="BLOCKLIST_ADD"
              params={{ userId, reason, durationSeconds }}
              label="Block User"
              confirmLabel="Confirm Block"
              description="Adds or replaces this user's global block entry."
              dangerous
            />
            <MutationControl
              type="BLOCKLIST_REMOVE"
              params={{ userId }}
              label="Remove Block"
              confirmLabel="Confirm Remove"
              description="Removes this user from the global blocklist."
            />
          </>
        ) : (
          <p className="text-xs text-sc-dim">
            Enter a positive user ID to enable blocklist controls.
          </p>
        )}
        <div className="rounded-lg border border-surface-border p-3">
          <label htmlFor="blocklist-import" className="block text-xs font-medium text-sc-dim">
            Import user IDs, separated by spaces, commas, or lines
          </label>
          <textarea
            id="blocklist-import"
            value={importText}
            onChange={(e) => setImportText(e.target.value.slice(0, 20000))}
            rows={4}
            className="mt-1 w-full rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-sm text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {importIds.length ? (
            <div className="mt-3">
              <MutationControl
                type="BLOCKLIST_IMPORT"
                params={{ userIds: importIds }}
                label={`Import ${importIds.length} Users`}
                confirmLabel="Confirm Import"
                description="Adds every parsed ID to the global blocklist as a permanent import entry. Duplicate IDs are collapsed before sending."
                dangerous
              />
            </div>
          ) : (
            <p className="mt-2 text-xs text-sc-dim">No valid positive user IDs parsed yet.</p>
          )}
        </div>
      </OperationCard>
      <OperationCard
        title="Global whitelist"
        description="Domains and usernames never treated as spam in any group. The update replaces the full list atomically."
      >
        <ReadPanel
          title="Current whitelist"
          type="WHITELIST_GET"
          onDone={(result) => {
            if (!whitelistLoaded) {
              setWhitelistText((result.entries ?? []).join('\n'));
              setWhitelistLoaded(true);
            }
          }}
        >
          {(result) => (
            <div className="max-h-44 overflow-auto rounded-lg border border-surface-border p-3 text-xs text-sc-muted">
              {(result.entries ?? []).length
                ? result.entries.join('\n')
                : 'The whitelist is empty.'}
            </div>
          )}
        </ReadPanel>
        <div>
          <label htmlFor="whitelist-entries" className="block text-xs font-medium text-sc-dim">
            Entries, one per line
          </label>
          <textarea
            id="whitelist-entries"
            value={whitelistText}
            onChange={(e) => setWhitelistText(e.target.value.slice(0, 20000))}
            rows={5}
            className="mt-1 w-full rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-sm text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="example.com&#10;@trusteduser"
          />
        </div>
        {whitelistLoaded ? (
          <MutationControl
            type="WHITELIST_UPDATE"
            params={{ entries }}
            label="Save Whitelist"
            confirmLabel="Confirm Save"
            description={`Replaces the whitelist with ${entries.length} entries.`}
          />
        ) : (
          <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100">
            Load the current whitelist before replacing it, so existing entries are not erased
            blindly.
          </p>
        )}
        <MutationControl
          type="WHITELIST_CLEAR"
          params={{}}
          label="Clear Whitelist"
          confirmLabel="Confirm Clear"
          description="Removes every global whitelist entry."
          dangerous
        />
      </OperationCard>
    </div>
  );
}

export function TicketsAdminSection() {
  const [ticketIdText, setTicketIdText] = useState('');
  const [reply, setReply] = useState('');
  const [ticketOffset, setTicketOffset] = useState(0);
  const ticketId = positiveInt(ticketIdText);
  return (
    <div className="space-y-5">
      <OperationCard
        title="Support tickets"
        description="Open, answered, and closed support requests tracked by the bot."
      >
        <ReadPanel
          title="Open tickets"
          type="TICKETS_LIST"
          params={{ status: 'open', limit: 20, offset: ticketOffset }}
        >
          {(result, reload) => (
            <>
              <MiniTable
                headers={['ID', 'Kind', 'User', 'Text', 'Created']}
                empty="No open tickets."
                rows={(result.tickets ?? []).map((t: any) => [
                  <code key="i">#{t.id}</code>,
                  t.kind,
                  <code key="u">{t.userId}</code>,
                  <span key="x" className="block max-w-md whitespace-pre-wrap">
                    {t.text}
                  </span>,
                  fmtUnix(t.createdAt),
                ])}
              />
              <Pager
                result={result}
                offset={ticketOffset}
                onOffset={(next) => {
                  setTicketOffset(next);
                  reload({ offset: next });
                }}
              />
            </>
          )}
        </ReadPanel>
      </OperationCard>
      <OperationCard
        title="Ticket controls"
        description="Replies are sent by the bot to the ticket author, then the ticket is marked answered. Closing is idempotent."
      >
        <TextNumberInput
          id="ticket-id"
          label="Ticket ID"
          value={ticketIdText}
          onChange={setTicketIdText}
        />
        {ticketId ? (
          <ReadPanel title="Ticket detail" type="TICKET_GET" params={{ ticketId }}>
            {(result) =>
              result.ticket ? (
                <MiniTable
                  headers={['Field', 'Value']}
                  empty="No ticket detail."
                  rows={[
                    ['ID', <code key="id">#{result.ticket.id}</code>],
                    ['Kind', result.ticket.kind],
                    ['Status', result.ticket.status],
                    ['User', <code key="u">{result.ticket.userId}</code>],
                    ['Chat', <code key="c">{result.ticket.chatId}</code>],
                    ['Created', fmtUnix(result.ticket.createdAt)],
                    [
                      'Text',
                      <span key="x" className="block max-w-xl whitespace-pre-wrap">
                        {result.ticket.text}
                      </span>,
                    ],
                    [
                      'Existing reply',
                      <span key="r" className="block max-w-xl whitespace-pre-wrap">
                        {result.ticket.reply || '-'}
                      </span>,
                    ],
                  ]}
                />
              ) : (
                <p className="text-xs text-sc-dim">Ticket not found.</p>
              )
            }
          </ReadPanel>
        ) : null}
        <div>
          <label htmlFor="ticket-reply" className="block text-xs font-medium text-sc-dim">
            Reply text
          </label>
          <textarea
            id="ticket-reply"
            value={reply}
            onChange={(e) => setReply(e.target.value.slice(0, 3500))}
            rows={4}
            className="mt-1 w-full rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-sm text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        {ticketId ? (
          <>
            {reply.trim() ? (
              <MutationControl
                type="TICKET_REPLY"
                params={{ ticketId, text: reply.trim() }}
                label="Send Reply"
                confirmLabel="Confirm Reply"
                description="Sends the reply through Telegram. Retries are fenced; an identical already-answered reply is reused."
                dangerous={false}
              />
            ) : (
              <p className="text-xs text-sc-dim">Enter reply text before sending.</p>
            )}
            <MutationControl
              type="TICKET_CLOSE"
              params={{ ticketId }}
              label="Close Ticket"
              confirmLabel="Confirm Close"
              description="Marks the ticket closed without sending a message."
            />
          </>
        ) : (
          <p className="text-xs text-sc-dim">Enter a positive ticket ID to enable controls.</p>
        )}
      </OperationCard>
    </div>
  );
}

export function SystemAdminSection() {
  const [adminIdText, setAdminIdText] = useState('');
  const [auditOffset, setAuditOffset] = useState(0);
  const adminId = positiveInt(adminIdText);
  const [reduced, setReduced] = useState(true);
  return (
    <div className="space-y-5">
      <OperationCard
        title="System status"
        description="Non-sensitive runtime state and safe operational toggles."
      >
        <ReadPanel title="Runtime status" type="SYSTEM_STATUS">
          {(result) => (
            <MiniTable
              headers={['Setting', 'Value']}
              empty="No status."
              rows={Object.entries(result.system ?? {}).map(([k, v]) => [
                k,
                typeof v === 'boolean' ? boolText(v) : String(v),
              ])}
            />
          )}
        </ReadPanel>
        <div className="flex items-center gap-3">
          <label htmlFor="reduced-mode" className="text-xs text-sc-dim">
            Reduced mode target
          </label>
          <select
            id="reduced-mode"
            value={reduced ? 'on' : 'off'}
            onChange={(e) => setReduced(e.target.value === 'on')}
            className="rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-sm text-sc-text"
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </div>
        <MutationControl
          type="SYSTEM_SET_REDUCED"
          params={{ enabled: reduced }}
          label="Set Reduced Mode"
          confirmLabel="Confirm Mode"
          description="Sets reduced mode to the selected explicit state. Idempotent."
        />
        <MutationControl
          type="SYSTEM_CLEAR_CACHES"
          params={{}}
          label="Clear Caches"
          confirmLabel="Confirm Clear"
          description="Clears bot runtime settings caches. No user data is deleted."
        />
        <MutationControl
          type="SYSTEM_DB_BACKUP_TO_OWNERS"
          params={{}}
          label="Backup To Owners"
          confirmLabel="Confirm Backup"
          description="Sends the SQLite backup only to configured owner private Telegram chats. The backup never passes through this website."
          dangerous
        />
      </OperationCard>
      <OperationCard
        title="Bot admins and audit"
        description="Owner-equivalent web administrators can manage bot admin IDs and inspect local bot audit events."
      >
        <ReadPanel title="Bot admins" type="ADMINS_LIST">
          {(result) => (
            <MiniTable
              headers={['User', 'Added by', 'Created']}
              empty="No additional bot admins."
              rows={(result.admins ?? []).map((a: any) => [
                <span key="u" className="text-sc-text">
                  {a.firstName ?? a.username ?? a.userId} <code>{a.userId}</code>
                </span>,
                <code key="b">{a.addedBy ?? '-'}</code>,
                fmtUnix(a.createdAt),
              ])}
            />
          )}
        </ReadPanel>
        <TextNumberInput
          id="admin-user-id"
          label="Telegram user ID"
          value={adminIdText}
          onChange={setAdminIdText}
        />
        {adminId ? (
          <>
            <MutationControl
              type="ADMIN_ADD"
              params={{ userId: adminId }}
              label="Add Bot Admin"
              confirmLabel="Confirm Add"
              description="Grants developer-panel access inside Telegram."
              dangerous
            />
            <MutationControl
              type="ADMIN_REMOVE"
              params={{ userId: adminId }}
              label="Remove Bot Admin"
              confirmLabel="Confirm Remove"
              description="Removes developer-panel access. Owners configured in the environment cannot be removed."
              dangerous
            />
          </>
        ) : (
          <p className="text-xs text-sc-dim">
            Enter a positive Telegram user ID to manage bot admins.
          </p>
        )}
        <ReadPanel
          title="Local bot audit"
          type="AUDIT_LIST"
          params={{ limit: 20, offset: auditOffset }}
        >
          {(result, reload) => (
            <>
              <MiniTable
                headers={['Time', 'Admin', 'Action', 'Detail']}
                empty="No audit events."
                rows={(result.entries ?? []).map((e: any) => [
                  fmtUnix(e.createdAt),
                  <code key="a">{e.adminId}</code>,
                  e.action,
                  e.detail ?? '-',
                ])}
              />
              <Pager
                result={result}
                offset={auditOffset}
                onOffset={(next) => {
                  setAuditOffset(next);
                  reload({ offset: next });
                }}
              />
            </>
          )}
        </ReadPanel>
      </OperationCard>
    </div>
  );
}

export function StartOperations() {
  const [botIdText, setBotIdText] = useState('');
  const [text, setText] = useState('');
  const [buttons, setButtons] = useState('');
  const [addButton, setAddButton] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [mediaType, setMediaType] = useState('photo');
  const [mediaUrl, setMediaUrl] = useState('');
  const [removeMedia, setRemoveMedia] = useState(false);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const current = useCommand();
  const botId = positiveInt(botIdText);

  useEffect(() => {
    if (current.command?.status !== 'DONE' || !botId) return;
    const row = current.command.result?.startMessage;
    setText(row?.text ?? '');
    setButtons(row?.buttons ?? '');
    setAddButton(row?.addButton !== false);
    setEnabled(Boolean(row?.enabled));
    setMediaUrl('');
    setRemoveMedia(false);
    setLoadedFor(botId);
  }, [current.command, botId]);

  const canEdit = botId !== null && loadedFor === botId;
  const mediaUrlValid = !mediaUrl.trim() || mediaUrl.trim().startsWith('https://');
  return (
    <OperationCard
      title="Start Studio controls"
      description="Load the current configuration before editing. Supports text, buttons, public media, the add-me button, enable state, disable, and reset."
    >
      <TextNumberInput id="start-bot-id" label="Bot ID" value={botIdText} onChange={setBotIdText} />
      {botId ? (
        <>
          <div className="rounded-lg border border-surface-border p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-sc-text">Current configuration</p>
                <p className="text-xs text-sc-muted">
                  {canEdit
                    ? 'Loaded. Media file identifiers remain hidden; use a public HTTPS URL only when replacing media.'
                    : 'Load before editing so an existing configuration is not overwritten blindly.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => current.run('START_MESSAGE_GET', { botId })}
                disabled={current.pending}
                className="inline-flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2 text-xs text-sc-muted hover:bg-surface-hover hover:text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
              >
                {current.pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Load current
              </button>
            </div>
            {current.error && (
              <p role="alert" className="mt-2 text-xs text-red-300">
                {current.error}
              </p>
            )}
          </div>
          {canEdit ? (
            <>
              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <label htmlFor="start-text" className="block text-xs font-medium text-sc-dim">
                    Welcome text
                  </label>
                  <textarea
                    id="start-text"
                    value={text}
                    onChange={(e) => setText(e.target.value.slice(0, 10000))}
                    rows={5}
                    className="mt-1 w-full rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-sm text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="Hello %name%"
                  />
                </div>
                <div>
                  <label htmlFor="start-buttons" className="block text-xs font-medium text-sc-dim">
                    Buttons, one row per line
                  </label>
                  <textarea
                    id="start-buttons"
                    value={buttons}
                    onChange={(e) => setButtons(e.target.value.slice(0, 8000))}
                    rows={5}
                    className="mt-1 w-full rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-sm text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="Open Engganyo - https://engganyo.com"
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label
                    htmlFor="start-media-type"
                    className="block text-xs font-medium text-sc-dim"
                  >
                    Media type
                  </label>
                  <select
                    id="start-media-type"
                    value={mediaType}
                    onChange={(e) => setMediaType(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-sm text-sc-text"
                  >
                    {['photo', 'video', 'animation', 'document', 'audio'].map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label
                    htmlFor="start-media-url"
                    className="block text-xs font-medium text-sc-dim"
                  >
                    Replacement public HTTPS media URL, optional
                  </label>
                  <input
                    id="start-media-url"
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value.slice(0, 1500))}
                    className="mt-1 w-full rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-sm text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
                    aria-invalid={!mediaUrlValid}
                  />
                  {!mediaUrlValid && (
                    <p className="mt-1 text-xs text-amber-200">
                      Media URL must start with https://.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-4 rounded-lg border border-surface-border p-3 text-sm text-sc-muted">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={addButton}
                    onChange={(e) => setAddButton(e.target.checked)}
                    className="h-4 w-4 rounded border-surface-border"
                  />
                  Show add-me button
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-surface-border"
                  />
                  Custom start enabled
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={removeMedia}
                    onChange={(e) => setRemoveMedia(e.target.checked)}
                    className="h-4 w-4 rounded border-surface-border"
                  />
                  Remove existing media
                </label>
              </div>
              {mediaUrlValid ? (
                <MutationControl
                  type="START_MESSAGE_CONFIGURE"
                  params={{
                    botId,
                    text,
                    buttons,
                    addButton,
                    enabled,
                    mediaType,
                    mediaUrl: mediaUrl.trim(),
                    removeMedia,
                  }}
                  label="Save Start Studio"
                  confirmLabel="Confirm Save"
                  description="Saves the explicit start message configuration. Enabling without text or media fails safely."
                  dangerous
                />
              ) : (
                <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100">
                  Use a public HTTPS media URL or clear the media field before saving.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-sc-dim">Load the current configuration before editing.</p>
          )}
          <MutationControl
            type="START_MESSAGE_SET_ENABLED"
            params={{ botId, enabled: true }}
            label="Enable Start"
            confirmLabel="Confirm Enable"
            description="Enables the existing custom start message. Fails safely if no message exists."
          />
          <MutationControl
            type="START_MESSAGE_SET_ENABLED"
            params={{ botId, enabled: false }}
            label="Disable Start"
            confirmLabel="Confirm Disable"
            description="Disables the custom start without deleting its content."
          />
          <MutationControl
            type="START_MESSAGE_RESET"
            params={{ botId }}
            label="Reset Start"
            confirmLabel="Confirm Reset"
            description="Deletes the custom start configuration and restores the standard welcome."
            dangerous
          />
        </>
      ) : (
        <p className="text-xs text-sc-dim">Enter a positive bot ID to enable controls.</p>
      )}
    </OperationCard>
  );
}

function LookupResult({ type, result }: { type: 'USER_FIND' | 'GROUP_FIND'; result: any }) {
  if (type === 'GROUP_FIND') {
    return (
      <MiniTable
        headers={['Group', 'Chat ID', 'Members', 'State']}
        empty="No matching groups."
        rows={(result.groups ?? []).map((g: any) => [
          <span key="t" className="text-sc-text">
            {g.title ?? 'Untitled'}
          </span>,
          <code key="c">{g.chatId}</code>,
          g.memberCount ?? 0,
          `${g.active ? 'Active' : 'Inactive'}${g.banned ? ', banned' : ''}`,
        ])}
      />
    );
  }
  const user = result.user;
  if (!user) return <p className="text-xs text-sc-dim">No matching user.</p>;
  const rows = [
    ['User', `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || '-'],
    ['User ID', <code key="uid">{user.userId}</code>],
    ['Username', user.username ? `@${user.username}` : '-'],
    ['Language', user.lang ?? '-'],
    ['Started', boolText(user.started)],
    ['Bot account', boolText(user.isBot)],
    ['First seen', fmtUnix(user.firstSeen)],
    ['Last seen', fmtUnix(user.lastSeen)],
    [
      'Global block',
      user.blocklist
        ? `${user.blocklist.reason ?? 'Blocked'} until ${user.blocklist.until ? fmtUnix(user.blocklist.until) : 'permanently'}`
        : 'No',
    ],
  ];
  return (
    <div className="space-y-3">
      <MiniTable headers={['Field', 'Value']} empty="No user detail." rows={rows} />
      <MiniTable
        headers={['Known active group', 'Chat ID']}
        empty="No active group membership is known."
        rows={(user.groups ?? []).map((g: any) => [
          g.title ?? 'Untitled',
          <code key={g.chatId}>{g.chatId}</code>,
        ])}
      />
    </div>
  );
}

function LookupPanel({
  title,
  type,
  placeholder,
}: {
  title: string;
  type: 'USER_FIND' | 'GROUP_FIND';
  placeholder: string;
}) {
  const [query, setQuery] = useState('');
  const cmd = useCommand();
  const canSearch = query.trim().length > 0;
  return (
    <div className="rounded-lg border border-surface-border bg-surface-hover/20 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor={`${type}-query`} className="block text-xs font-medium text-sc-dim">
            {title}
          </label>
          <input
            id={`${type}-query`}
            value={query}
            onChange={(e) => setQuery(e.target.value.slice(0, 120))}
            placeholder={placeholder}
            className="mt-1 w-full rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-sm text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <button
          type="button"
          onClick={() => canSearch && cmd.run(type, { query })}
          disabled={!canSearch || cmd.pending}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-50"
        >
          {cmd.pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Search
        </button>
      </div>
      <div aria-live="polite" className="mt-3">
        {cmd.error && (
          <p role="alert" className="text-xs text-red-300">
            {cmd.error}
          </p>
        )}
        {cmd.command?.status === 'DONE' && cmd.command.result ? (
          <LookupResult type={type} result={cmd.command.result} />
        ) : cmd.pending ? (
          <p className="text-xs text-amber-200">Searching through the bot worker.</p>
        ) : null}
      </div>
    </div>
  );
}

export function LookupPanels() {
  return (
    <OperationCard
      title="Find users and groups"
      description="Search the same local bot directory used by the Telegram developer panel. Results are read-only."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <LookupPanel
          title="Find user by ID or username"
          type="USER_FIND"
          placeholder="Example: 123456789 or @username"
        />
        <LookupPanel
          title="Find group by title or chat ID"
          type="GROUP_FIND"
          placeholder="Example: My Group or -100123456789"
        />
      </div>
    </OperationCard>
  );
}
