'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Play, Plus, SendHorizonal, Trash2 } from 'lucide-react';
import {
  MutationControl,
  OperationCard,
  TextNumberInput,
  positiveInt,
  useCommand,
} from './operations';

type SelectionState = {
  allBots: boolean;
  botIds: number[];
  allGroups: boolean;
  groupIds: number[];
};

function toggle(list: number[], value: number): number[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

function selectionPayload(selection: SelectionState) {
  return {
    bots: selection.allBots ? ['all'] : selection.botIds,
    groups: selection.allGroups ? ['all'] : selection.groupIds,
  };
}

function useAnnouncementOptions() {
  const cmd = useCommand();
  return {
    ...cmd,
    load: () => cmd.run('ANNOUNCEMENT_OPTIONS_GET'),
  };
}

function rowsFromButtons(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function ButtonRowsEditor({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [rows, setRows] = useState(() => rowsFromButtons(value));
  const lastEmitted = useRef(value);
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    setRows(rowsFromButtons(value));
  }, [value]);
  const commit = (next: string[]) => {
    setRows(next);
    const serialized = next
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, 8000);
    lastEmitted.current = serialized;
    onChange(serialized);
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  };
  return (
    <div className="space-y-2">
      {rows.length ? (
        rows.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              id={`${id}-${index}`}
              aria-label={`Button row ${index + 1}`}
              value={row}
              onChange={(event) => {
                const next = [...rows];
                next[index] = event.target.value.slice(0, 500);
                commit(next);
              }}
              placeholder="Label - https://example.com"
              className="min-h-10 flex-1 rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-sm text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              type="button"
              onClick={() => move(index, -1)}
              disabled={index === 0}
              aria-label={`Move button row ${index + 1} up`}
              className="min-h-10 rounded-lg border border-surface-border p-2 text-sc-muted hover:bg-surface-hover hover:text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => move(index, 1)}
              disabled={index === rows.length - 1}
              aria-label={`Move button row ${index + 1} down`}
              className="min-h-10 rounded-lg border border-surface-border p-2 text-sc-muted hover:bg-surface-hover hover:text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-40"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => commit(rows.filter((_, rowIndex) => rowIndex !== index))}
              aria-label={`Delete button row ${index + 1}`}
              className="min-h-10 rounded-lg border border-red-500/20 p-2 text-red-300 hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-red-400"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))
      ) : (
        <p className="rounded-lg border border-dashed border-surface-border p-3 text-xs text-sc-dim">
          No button rows yet.
        </p>
      )}
      <button
        type="button"
        onClick={() => commit([...rows, ''])}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-surface-border px-3 py-2 text-xs text-sc-muted hover:bg-surface-hover hover:text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-40"
      >
        <Plus className="h-4 w-4" /> Add button row
      </button>
      <p className="text-xs text-sc-dim">
        Use <code>Label - target</code>, where target can be a URL, @username, copy:text,
        share:text, or a bot command. Put several buttons on one row with <code>&amp;&amp;</code>.
        Rows can be edited, moved, or deleted before saving.
      </p>
    </div>
  );
}

function AudiencePicker({
  selection,
  setSelection,
  options,
}: {
  selection: SelectionState;
  setSelection: (value: SelectionState) => void;
  options: any;
}) {
  const bots = options?.bots ?? [];
  const groups = options?.groups ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <fieldset className="rounded-lg border border-surface-border p-3">
        <legend className="px-1 text-xs font-semibold text-sc-dim">Bot private audiences</legend>
        <label className="flex items-center gap-2 text-sm text-sc-muted">
          <input
            type="checkbox"
            checked={selection.allBots}
            onChange={(e) => setSelection({ ...selection, allBots: e.target.checked, botIds: [] })}
            className="h-4 w-4 rounded border-surface-border"
          />
          All bots
        </label>
        <div className="mt-2 max-h-40 space-y-1 overflow-auto">
          {bots.map((bot: any) => (
            <label key={bot.botId} className="flex items-center gap-2 text-sm text-sc-muted">
              <input
                type="checkbox"
                disabled={selection.allBots}
                checked={selection.botIds.includes(bot.botId)}
                onChange={() =>
                  setSelection({ ...selection, botIds: toggle(selection.botIds, bot.botId) })
                }
                className="h-4 w-4 rounded border-surface-border"
              />
              {bot.label} <code className="text-xs">{bot.botId}</code>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="rounded-lg border border-surface-border p-3">
        <legend className="px-1 text-xs font-semibold text-sc-dim">Groups, never channels</legend>
        <label className="flex items-center gap-2 text-sm text-sc-muted">
          <input
            type="checkbox"
            checked={selection.allGroups}
            onChange={(e) =>
              setSelection({ ...selection, allGroups: e.target.checked, groupIds: [] })
            }
            className="h-4 w-4 rounded border-surface-border"
          />
          All eligible groups
        </label>
        <div className="mt-2 max-h-40 space-y-1 overflow-auto">
          {groups.map((group: any) => (
            <label key={group.chatId} className="flex items-center gap-2 text-sm text-sc-muted">
              <input
                type="checkbox"
                disabled={selection.allGroups}
                checked={selection.groupIds.includes(group.chatId)}
                onChange={() =>
                  setSelection({ ...selection, groupIds: toggle(selection.groupIds, group.chatId) })
                }
                className="h-4 w-4 rounded border-surface-border"
              />
              <span className="truncate">{group.title ?? group.chatId}</span>{' '}
              <span className="text-xs text-sc-dim">{group.memberCount ?? 0} members</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

export function AnnouncementComposer() {
  const options = useAnnouncementOptions();
  const [text, setText] = useState('');
  const [buttons, setButtons] = useState('');
  const [mediaType, setMediaType] = useState('photo');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mentionEnabled, setMentionEnabled] = useState(false);
  const [every, setEvery] = useState(1);
  const [selection, setSelection] = useState<SelectionState>({
    allBots: false,
    botIds: [],
    allGroups: false,
    groupIds: [],
  });
  const payload = useMemo(
    () => ({
      text,
      buttons,
      mediaUrl: mediaUrl.trim(),
      mediaType,
      mentionEnabled,
      every,
      ...selectionPayload(selection),
    }),
    [text, buttons, mediaUrl, mediaType, mentionEnabled, every, selection],
  );
  const hasAudience =
    selection.allBots ||
    selection.allGroups ||
    selection.botIds.length > 0 ||
    selection.groupIds.length > 0;
  const hasExplicitGroups = selection.groupIds.length > 0;
  const mediaUrlValid = !mediaUrl.trim() || mediaUrl.trim().startsWith('https://');
  const canCreate =
    (text.trim().length > 0 || mediaUrl.trim().length > 0) &&
    hasAudience &&
    mediaUrlValid &&
    (!mentionEnabled || hasExplicitGroups);

  return (
    <OperationCard
      title="Announcement composer"
      description="Create a text or public-media announcement with explicit bot and group targeting. Channels are intentionally not available."
    >
      <div className="flex items-center justify-between rounded-lg border border-surface-border p-3">
        <div>
          <p className="text-sm font-medium text-sc-text">Audience options</p>
          <p className="text-xs text-sc-muted">
            Load the live bot catalog and eligible groups before composing.
          </p>
        </div>
        <button
          type="button"
          onClick={options.load}
          disabled={options.pending}
          className="inline-flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2 text-xs text-sc-muted hover:bg-surface-hover hover:text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
        >
          {options.pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {options.command ? 'Refresh options' : 'Load options'}
        </button>
      </div>
      {options.error && (
        <p role="alert" className="text-xs text-red-300">
          {options.error}
        </p>
      )}
      {options.command?.status === 'DONE' ? (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <label htmlFor="ann-text" className="block text-xs font-medium text-sc-dim">
                Message text
              </label>
              <textarea
                id="ann-text"
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 10000))}
                rows={7}
                className="mt-1 w-full rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-sm text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="Announcement text. Telegram HTML supported by the existing bot renderer."
              />
            </div>
            <div className="space-y-3">
              <div>
                <span id="ann-buttons-label" className="block text-xs font-medium text-sc-dim">
                  Button rows
                </span>
                <div aria-labelledby="ann-buttons-label" className="mt-1">
                  <ButtonRowsEditor id="ann-buttons" value={buttons} onChange={setButtons} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor="ann-media-type" className="block text-xs font-medium text-sc-dim">
                    Media type
                  </label>
                  <select
                    id="ann-media-type"
                    value={mediaType}
                    onChange={(e) => setMediaType(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-sm text-sc-text"
                  >
                    {(options.command.result.mediaTypes ?? ['photo']).map((type: string) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label htmlFor="ann-media-url" className="block text-xs font-medium text-sc-dim">
                    Public HTTPS media URL, optional
                  </label>
                  <input
                    id="ann-media-url"
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value.slice(0, 1500))}
                    className="mt-1 w-full rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-sm text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="https://example.com/image.jpg"
                    aria-invalid={!mediaUrlValid}
                  />
                  {!mediaUrlValid && (
                    <p className="mt-1 text-xs text-amber-200">
                      Media URL must start with https://.
                    </p>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-surface-border bg-surface-hover/30 p-3">
                <p className="text-xs font-medium text-sc-dim">Preview</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-sc-text">
                  {text || (mediaUrl ? `${mediaType} media` : 'No content yet')}
                </p>
                {buttons
                  .split('\n')
                  .filter(Boolean)
                  .map((line) => (
                    <span
                      key={line}
                      className="mr-2 mt-2 inline-block rounded border border-brand-500/30 px-2 py-1 text-xs text-brand-200"
                    >
                      {line.split(' - ')[0]}
                    </span>
                  ))}
              </div>
            </div>
          </div>
          <AudiencePicker
            selection={selection}
            setSelection={setSelection}
            options={options.command.result}
          />
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-surface-border p-3">
            <label className="flex items-center gap-2 text-sm text-sc-muted">
              <input
                type="checkbox"
                checked={mentionEnabled}
                onChange={(e) => setMentionEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-surface-border"
              />
              Enable with /mentionall
            </label>
            <span className="text-xs text-sc-dim">
              Mention mode requires an explicit group selection in this web panel.
            </span>
            <label className="flex items-center gap-2 text-sm text-sc-muted">
              Every
              <select
                value={every}
                onChange={(e) => setEvery(Number(e.target.value))}
                className="rounded-lg border border-surface-border bg-surface-hover px-2 py-1 text-sm text-sc-text"
              >
                {(options.command.result.everyChoices ?? [1, 2, 3, 5, 10, 20]).map((n: number) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              uses
            </label>
          </div>
          {canCreate ? (
            <MutationControl
              type="ANNOUNCEMENT_CREATE"
              params={payload}
              label="Create Announcement"
              confirmLabel="Confirm Create"
              description="Creates the announcement in the bot database. The command ID prevents duplicate creation if the network or worker retries."
            />
          ) : (
            <p className="text-xs text-sc-dim">
              Enter text or media and select at least one audience before creating. Mention mode
              also requires explicit groups.
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-sc-dim">Load audience options to start composing.</p>
      )}
    </OperationCard>
  );
}

export function AnnouncementAdvancedControls() {
  const [idText, setIdText] = useState('');
  const [text, setText] = useState('');
  const [buttons, setButtons] = useState('');
  const [mediaType, setMediaType] = useState('photo');
  const [mediaUrl, setMediaUrl] = useState('');
  const [removeMedia, setRemoveMedia] = useState(false);
  const [clearButtons, setClearButtons] = useState(false);
  const [mentionEnabled, setMentionEnabled] = useState(false);
  const [every, setEvery] = useState(1);
  const [selection, setSelection] = useState<SelectionState>({
    allBots: false,
    botIds: [],
    allGroups: false,
    groupIds: [],
  });
  const delivery = useCommand();
  const options = useAnnouncementOptions();
  const existing = useCommand();
  const audienceRead = useCommand();
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const announcementId = positiveInt(idText);

  useEffect(() => {
    if (existing.command?.status !== 'DONE' || !announcementId) return;
    const row = existing.command.result?.announcement;
    if (!row || row.id !== announcementId) return;
    setText(row.message?.text ?? '');
    setButtons(row.message?.buttons ?? '');
    setMentionEnabled(Boolean(row.groupsMode));
    setEvery(row.mentionEvery || 1);
    setMediaUrl('');
    setRemoveMedia(false);
    setClearButtons(false);
    setLoadedFor(announcementId);
  }, [existing.command, announcementId]);

  useEffect(() => {
    if (audienceRead.command?.status !== 'DONE' || !announcementId) return;
    const audience = audienceRead.command.result?.audience;
    if (!audience || audience.announcementId !== announcementId) return;
    const bots = Array.isArray(audience.botsSelected) ? audience.botsSelected : [];
    const groups = Array.isArray(audience.groupsSelected) ? audience.groupsSelected : [];
    setSelection({
      allBots: bots.includes('all'),
      botIds: bots.filter((x: unknown) => Number.isSafeInteger(Number(x))).map(Number),
      allGroups: groups.includes('all'),
      groupIds: groups.filter((x: unknown) => Number.isSafeInteger(Number(x))).map(Number),
    });
    setMentionEnabled(Boolean(audience.groupsMode));
    setEvery(audience.mentionEvery || 1);
  }, [audienceRead.command, announcementId]);

  useEffect(() => {
    if (loadedFor !== null && announcementId !== loadedFor) setLoadedFor(null);
  }, [announcementId, loadedFor]);

  const canEditExisting = announcementId !== null && loadedFor === announcementId;
  const editMediaUrlValid = !mediaUrl.trim() || mediaUrl.trim().startsWith('https://');
  const canReplaceContent = canEditExisting && editMediaUrlValid;
  return (
    <OperationCard
      title="Advanced announcement controls"
      description="Edit content, configure mention mode, inspect delivery, send now, or delete an existing announcement by ID."
    >
      <TextNumberInput
        id="advanced-announcement-id"
        label="Announcement ID"
        value={idText}
        onChange={setIdText}
      />
      {announcementId ? (
        <>
          <div className="rounded-lg border border-surface-border p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-sc-text">Current announcement</p>
                <p className="text-xs text-sc-muted">
                  {canEditExisting
                    ? 'Loaded. Existing media is preserved unless replacement or removal is selected.'
                    : 'Load the existing content before replacing it, so nothing is overwritten blindly.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => existing.run('ANNOUNCEMENT_GET', { announcementId })}
                disabled={existing.pending}
                className="inline-flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2 text-xs text-sc-muted hover:bg-surface-hover hover:text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
              >
                {existing.pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Load current
              </button>
            </div>
            {existing.error && (
              <p role="alert" className="mt-2 text-xs text-red-300">
                {existing.error}
              </p>
            )}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <label htmlFor="edit-ann-text" className="block text-xs font-medium text-sc-dim">
                Replacement text
              </label>
              <textarea
                id="edit-ann-text"
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 10000))}
                rows={4}
                className="mt-1 w-full rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-sm text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <span id="edit-ann-buttons-label" className="block text-xs font-medium text-sc-dim">
                Replacement button rows
              </span>
              <div aria-labelledby="edit-ann-buttons-label" className="mt-1">
                <ButtonRowsEditor id="edit-ann-buttons" value={buttons} onChange={setButtons} />
              </div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label
                htmlFor="edit-ann-media-type"
                className="block text-xs font-medium text-sc-dim"
              >
                Media type
              </label>
              <select
                id="edit-ann-media-type"
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
              <label htmlFor="edit-ann-media-url" className="block text-xs font-medium text-sc-dim">
                Replacement public HTTPS media URL, optional
              </label>
              <input
                id="edit-ann-media-url"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value.slice(0, 1500))}
                className="mt-1 w-full rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-sm text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
                aria-invalid={!editMediaUrlValid}
              />
              {!editMediaUrlValid && (
                <p className="mt-1 text-xs text-amber-200">Media URL must start with https://.</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-4 rounded-lg border border-surface-border p-3 text-sm text-sc-muted">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={removeMedia}
                onChange={(e) => setRemoveMedia(e.target.checked)}
                className="h-4 w-4 rounded border-surface-border"
              />
              Remove existing media
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={clearButtons}
                onChange={(e) => setClearButtons(e.target.checked)}
                className="h-4 w-4 rounded border-surface-border"
              />
              Clear existing buttons
            </label>
          </div>
          {canReplaceContent ? (
            <MutationControl
              type="ANNOUNCEMENT_UPDATE_CONTENT"
              params={{
                announcementId,
                text,
                buttons,
                clearButtons,
                mediaType,
                mediaUrl: mediaUrl.trim(),
                removeMedia,
              }}
              label="Replace Content"
              confirmLabel="Confirm Replace"
              description="Replaces text and button rows. Existing media and buttons are preserved unless replacement or explicit removal is selected; the backend rejects an empty result."
              dangerous
            />
          ) : (
            <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100">
              {canEditExisting
                ? 'Use a public HTTPS media URL or clear the media field before replacing content.'
                : 'Load the current announcement before replacing its content.'}
            </p>
          )}
          <div className="rounded-lg border border-surface-border p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-sc-text">Audience editor</p>
                <p className="text-xs text-sc-muted">
                  Load live bots and groups, choose the replacement audience, then confirm.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  options.load();
                  audienceRead.run('ANNOUNCEMENT_AUDIENCE_GET', { announcementId });
                }}
                disabled={options.pending || audienceRead.pending}
                className="inline-flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2 text-xs text-sc-muted hover:bg-surface-hover hover:text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
              >
                {options.pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {options.command ? 'Refresh audience options' : 'Load audience options'}
              </button>
            </div>
            {options.error && (
              <p role="alert" className="mt-2 text-xs text-red-300">
                {options.error}
              </p>
            )}
            {audienceRead.error && (
              <p role="alert" className="mt-2 text-xs text-red-300">
                {audienceRead.error}
              </p>
            )}
            {options.command?.status === 'DONE' ? (
              <div className="mt-4 space-y-3">
                <AudiencePicker
                  selection={selection}
                  setSelection={setSelection}
                  options={options.command.result}
                />
                {selection.allBots ||
                selection.allGroups ||
                selection.botIds.length > 0 ||
                selection.groupIds.length > 0 ? (
                  <MutationControl
                    type="ANNOUNCEMENT_SET_AUDIENCE"
                    params={{ announcementId, ...selectionPayload(selection) }}
                    label="Save Audience"
                    confirmLabel="Confirm Audience"
                    description="Replaces the bot private-audience and group targeting for this announcement. Channels are not available."
                    dangerous
                  />
                ) : (
                  <p className="text-xs text-sc-dim">Select at least one bot audience or group.</p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-xs text-sc-dim">Audience options are not loaded yet.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-surface-border p-3">
            <label className="flex items-center gap-2 text-sm text-sc-muted">
              <input
                type="checkbox"
                checked={mentionEnabled}
                onChange={(e) => setMentionEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-surface-border"
              />
              Mention mode enabled
            </label>
            <select
              value={every}
              onChange={(e) => setEvery(Number(e.target.value))}
              className="rounded-lg border border-surface-border bg-surface-hover px-2 py-1 text-sm text-sc-text"
              aria-label="Mention frequency"
            >
              {[1, 2, 3, 5, 10, 20].map((n) => (
                <option key={n} value={n}>
                  Every {n}
                </option>
              ))}
            </select>
          </div>
          <MutationControl
            type="ANNOUNCEMENT_SET_MENTION"
            params={{ announcementId, enabled: mentionEnabled, every }}
            label="Save Mention Mode"
            confirmLabel="Confirm Mention"
            description="Sets mention mode and frequency to explicit values. Enabling requires explicit groups so an empty group selection cannot silently mean every group."
          />
          <div className="rounded-lg border border-surface-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-sc-text">Delivery status</p>
                <p className="text-xs text-sc-muted">
                  Read counters and the latest web-initiated send state.
                </p>
              </div>
              <button
                type="button"
                onClick={() => delivery.run('ANNOUNCEMENT_DELIVERY_GET', { announcementId })}
                disabled={delivery.pending}
                className="inline-flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2 text-xs text-sc-muted hover:bg-surface-hover hover:text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
              >
                {delivery.pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <SendHorizonal className="h-3.5 w-3.5" />
                )}
                Load status
              </button>
            </div>
            {delivery.command?.status === 'DONE' &&
              (() => {
                const row = delivery.command.result?.delivery;
                if (!row) return <p className="mt-3 text-xs text-sc-dim">No delivery data.</p>;
                const items: Array<[string, unknown]> = [
                  ['Exists', row.exists ? 'Yes' : 'No'],
                  ['Sent', row.sent ?? 0],
                  ['Failed', row.failed ?? 0],
                  ['Shown by mention mode', row.shown ?? 0],
                  [
                    'Last delivery',
                    row.lastAt ? new Date(Number(row.lastAt) * 1000).toLocaleString() : 'Never',
                  ],
                  ['Web send state', row.webRun?.status ?? 'Not started'],
                ];
                return (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-lg border border-surface-border bg-surface-hover/30 p-3"
                      >
                        <p className="text-xs text-sc-dim">{label}</p>
                        <p className="mt-1 text-sm font-medium text-sc-text">{String(value)}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}
            {delivery.error && (
              <p role="alert" className="mt-2 text-xs text-red-300">
                {delivery.error}
              </p>
            )}
          </div>
          <MutationControl
            type="ANNOUNCEMENT_SEND_NOW"
            params={{ announcementId }}
            label="Send Now"
            confirmLabel="Confirm Send"
            description="Starts immediate delivery to the configured private bot audiences and groups. Channels are never targeted. The command is deduplicated across retries."
            dangerous
          />
          <MutationControl
            type="ANNOUNCEMENT_DELETE"
            params={{ announcementId }}
            label="Delete Announcement"
            confirmLabel="Confirm Delete"
            description="Permanently deletes the announcement configuration and prevents future mention-mode posts."
            dangerous
          />
        </>
      ) : (
        <p className="text-xs text-sc-dim">
          Enter a positive announcement ID to enable advanced controls.
        </p>
      )}
    </OperationCard>
  );
}
