'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, Play, ShieldAlert, X } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';

type CommandStatus = 'PENDING' | 'CLAIMED' | 'DONE' | 'FAILED' | 'DEAD';

interface BotCommand {
  id: string;
  type: string;
  status: CommandStatus;
  result: any;
  error: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export function useCommand() {
  const [commandId, setCommandId] = useState<string | null>(null);
  const requestKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const createMutation = useMutation({
    mutationFn: async ({
      type,
      params,
      requestKey,
    }: {
      type: string;
      params?: Record<string, unknown>;
      requestKey: string;
    }) => {
      const res = await apiClient.post(
        'admin/telegram-bot/commands',
        { type, params: params ?? {}, requestKey },
        { skipRetry: true },
      );
      return res.data.data as { command: BotCommand };
    },
    onSuccess: (data) => setCommandId(data.command.id),
  });
  const query = useQuery({
    queryKey: ['admin', 'telegram-bot', 'operation', commandId],
    queryFn: async () => {
      const res = await apiClient.get(`admin/telegram-bot/commands/${commandId}`);
      return (res.data.data as { command: BotCommand }).command;
    },
    enabled: !!commandId,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === 'DONE' || status === 'FAILED' || status === 'DEAD' ? false : 1200;
    },
  });
  const command = query.data ?? createMutation.data?.command ?? null;
  const pending =
    createMutation.isPending || (!!command && !['DONE', 'FAILED', 'DEAD'].includes(command.status));
  return {
    command,
    pending,
    error: createMutation.error
      ? getApiErrorMessage(createMutation.error)
      : (command?.error ?? null),
    run: (type: string, params?: Record<string, unknown>) => {
      if (createMutation.isPending || inFlightRef.current) return;
      if (!requestKeyRef.current) requestKeyRef.current = crypto.randomUUID();
      inFlightRef.current = true;
      createMutation.mutate(
        { type, params, requestKey: requestKeyRef.current },
        {
          onSuccess: () => {
            inFlightRef.current = false;
            requestKeyRef.current = null;
          },
          onError: (error) => {
            inFlightRef.current = false;
            if ((error as { response?: unknown }).response) requestKeyRef.current = null;
          },
        },
      );
    },
    reset: () => {
      setCommandId(null);
      requestKeyRef.current = null;
      inFlightRef.current = false;
      createMutation.reset();
    },
  };
}

export function MutationControl({
  type,
  params,
  label,
  confirmLabel,
  description,
  dangerous = false,
  onDone,
}: {
  type: string;
  params?: Record<string, unknown>;
  label: string;
  confirmLabel: string;
  description: string;
  dangerous?: boolean;
  onDone?: (result: any) => void;
}) {
  const [armed, setArmed] = useState(false);
  const cmd = useCommand();
  const done = cmd.command?.status === 'DONE';
  const result = cmd.command?.result;
  useEffect(() => {
    if (done && onDone && result) onDone(result);
  }, [done, onDone, result]);
  return (
    <div
      className={`rounded-lg border p-3 ${dangerous ? 'border-red-500/20 bg-red-500/5' : 'border-surface-border bg-surface-hover/30'}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-sc-text">{label}</p>
          <p className="mt-0.5 text-xs text-sc-muted">{description}</p>
        </div>
        {!armed ? (
          <button
            type="button"
            onClick={() => setArmed(true)}
            disabled={cmd.pending}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 disabled:opacity-50 ${
              dangerous
                ? 'bg-red-600 text-white hover:bg-red-500 focus:ring-red-400'
                : 'bg-brand-600 text-white hover:bg-brand-500 focus:ring-brand-400'
            }`}
          >
            {cmd.pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {label}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setArmed(false);
                cmd.run(type, params);
              }}
              disabled={cmd.pending}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 disabled:opacity-50 ${
                dangerous
                  ? 'bg-red-600 hover:bg-red-500 focus:ring-red-400'
                  : 'bg-brand-600 hover:bg-brand-500 focus:ring-brand-400'
              }`}
            >
              {cmd.pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )}
              {confirmLabel}
            </button>
            <button
              type="button"
              onClick={() => setArmed(false)}
              className="rounded-lg border border-surface-border p-2 text-sc-muted hover:bg-surface-hover hover:text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
              aria-label={`Cancel ${label}`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      <div aria-live="polite" className="mt-3">
        {cmd.pending && (
          <p className="flex items-center gap-2 text-xs text-amber-200">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for the bot worker.
          </p>
        )}
        {done && (
          <p className="flex items-center gap-2 text-xs text-green-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> Completed. Attempts: {cmd.command?.attempts}
          </p>
        )}
        {done && result ? (
          <pre className="mt-2 max-h-28 overflow-auto rounded border border-surface-border bg-sc-panel-2 p-2 text-[11px] text-sc-muted">
            {JSON.stringify(result, null, 2)}
          </pre>
        ) : null}
        {cmd.error && (
          <p role="alert" className="text-xs text-red-300">
            {cmd.error}
          </p>
        )}
      </div>
    </div>
  );
}

export function OperationCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="card-glass rounded-xl border border-surface-border p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-sc-text">
        <ShieldAlert className="h-4 w-4 text-amber-300" />
        {title}
      </h2>
      <p className="mt-1 text-sm text-sc-muted">{description}</p>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

export function TextNumberInput({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-sc-dim">
        {label}
      </label>
      <input
        id={id}
        value={value}
        inputMode="numeric"
        onChange={(event) => onChange(event.target.value.replace(/[^0-9-]/g, ''))}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-sm text-sc-text focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
    </div>
  );
}

export function positiveInt(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function signedInt(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n !== 0 ? n : null;
}
