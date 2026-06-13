'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Webhook, Copy, Check, Link2, AlertCircle, Loader2,
  CreditCard, Wallet, Bitcoin, ArrowLeft, ExternalLink,
} from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import Link from 'next/link';
import type { ApiResponse } from '@/types';

// ─── Types ────────────────────────────────────────────────────
interface ServerConfigEntry {
  key: string;
  value: unknown;
  description: string;
  isPublic: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface WebhookEndpoint {
  label: string;
  path: string;
  icon: React.ElementType;
  color: string;
  docsUrl?: string;
  description: string;
  secretKey?: string;
}

// ─── Helpers ──────────────────────────────────────────────────
function getApiBaseUrl(): string {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api';
  return apiUrl.replace(/\/+$/, '');
}

const WEBHOOKS: WebhookEndpoint[] = [
  {
    label: 'PayPal',
    path: '/paypal/webhook',
    icon: Wallet,
    color: 'text-blue-400',
    docsUrl: 'https://developer.paypal.com/developer/applications/',
    description: 'Receives CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED, and PAYMENT.CAPTURE.DENIED events.',
    secretKey: 'paypal_webhook_id',
  },
  {
    label: 'PayMongo',
    path: '/paymongo/webhook',
    icon: CreditCard,
    color: 'text-emerald-400',
    docsUrl: 'https://dashboard.paymongo.com/developers',
    description: 'Receives link.payment.paid, link.payment.failed, and source.chargeable events.',
    secretKey: 'paymongo_webhook_secret',
  },
];

// ─── Component ──────────────────────────────────────────────
export default function WebhooksPage() {
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const baseUrl = getApiBaseUrl();
  const [copied, setCopied] = useState<string | null>(null);

  const { data: serverConfig, isLoading } = useQuery({
    queryKey: ['admin-server-config'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<ServerConfigEntry[]>>('admin/server-config');
      return res.data.data ?? [];
    },
    enabled: isSuperAdmin,
  });

  const getConfigValue = (key: string): unknown => {
    return serverConfig?.find((c) => c.key === key)?.value ?? undefined;
  };

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertCircle className="w-10 h-10 text-red-500/60 mb-3" />
        <p className="text-zinc-400 text-sm">This page is restricted to Super Admins only.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Link
            href="/admin/server-config"
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Server Config
          </Link>
        </div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Webhook className="w-5 h-5 text-amber-400" />
          Webhook Endpoints
        </h1>
        <p className="text-zinc-400 text-sm mt-1">
          Public webhook URLs for external payment provider configuration. Copy these into your PayPal / PayMongo dashboard.
        </p>
      </div>

      {/* API Base URL */}
      <div className="card-glass rounded-xl p-4 border border-surface-border mb-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-zinc-500 mb-0.5">API Base URL</p>
            <p className="text-sm text-white font-mono">{baseUrl}</p>
          </div>
          <button
            onClick={() => handleCopy(baseUrl, 'base-url')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-hover border border-surface-border text-xs text-zinc-300 hover:text-white hover:border-zinc-500 transition-all"
          >
            {copied === 'base-url' ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied === 'base-url' ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Webhook Cards */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="card-glass rounded-xl p-6 animate-pulse h-40" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {WEBHOOKS.map((wh) => {
            const fullUrl = `${baseUrl}${wh.path}`;
            const secretConfigured = wh.secretKey ? Boolean(getConfigValue(wh.secretKey)) : false;
            return (
              <div key={wh.label} className="card-glass rounded-xl p-5 border border-surface-border">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl bg-surface-hover border border-surface-border flex items-center justify-center`}>
                      <wh.icon className={`w-4 h-4 ${wh.color}`} />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white">{wh.label}</h3>
                      <p className="text-xs text-zinc-500 mt-0.5">{wh.description}</p>
                    </div>
                  </div>
                  {wh.docsUrl && (
                    <a
                      href={wh.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-brand-400 hover:underline shrink-0"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Dashboard
                    </a>
                  )}
                </div>

                {/* URL row */}
                <div className="flex items-center gap-3 p-3 rounded-lg bg-black/20 border border-surface-border mb-3">
                  <Link2 className="w-4 h-4 text-zinc-500 shrink-0" />
                  <code className="text-xs text-zinc-300 font-mono flex-1 truncate">{fullUrl}</code>
                  <button
                    onClick={() => handleCopy(fullUrl, wh.label)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-hover border border-surface-border text-xs text-zinc-300 hover:text-white hover:border-zinc-500 transition-all shrink-0"
                  >
                    {copied === wh.label ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied === wh.label ? 'Copied' : 'Copy'}
                  </button>
                </div>

                {/* Status + config hint */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {secretConfigured ? (
                      <span className="flex items-center gap-1 text-xs text-green-400">
                        <Check className="w-3.5 h-3.5" /> Secret configured
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-yellow-400">
                        <AlertCircle className="w-3.5 h-3.5" /> Secret not configured
                      </span>
                    )}
                  </div>
                  <Link
                    href="/admin/server-config"
                    className="text-xs text-brand-400 hover:underline"
                  >
                    Configure in Server Config →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Setup Guide */}
      <div className="mt-6 card-glass rounded-xl p-5 border border-surface-border">
        <h3 className="text-sm font-semibold text-white mb-3">Setup Guide</h3>
        <div className="space-y-3 text-xs text-zinc-400">
          <div className="flex gap-3">
            <span className="w-5 h-5 rounded-full bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400 text-[10px] font-bold shrink-0">1</span>
            <p>Copy the webhook URL above for the provider you want to configure.</p>
          </div>
          <div className="flex gap-3">
            <span className="w-5 h-5 rounded-full bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400 text-[10px] font-bold shrink-0">2</span>
            <p>Open the provider dashboard (PayPal Developer / PayMongo) and create a new webhook subscription.</p>
          </div>
          <div className="flex gap-3">
            <span className="w-5 h-5 rounded-full bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400 text-[10px] font-bold shrink-0">3</span>
            <p>Paste the webhook URL. Select the relevant event types (see descriptions above).</p>
          </div>
          <div className="flex gap-3">
            <span className="w-5 h-5 rounded-full bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400 text-[10px] font-bold shrink-0">4</span>
            <p>Copy the webhook ID (PayPal) or secret (PayMongo) from the provider dashboard.</p>
          </div>
          <div className="flex gap-3">
            <span className="w-5 h-5 rounded-full bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400 text-[10px] font-bold shrink-0">5</span>
            <p>Paste it into <Link href="/admin/server-config" className="text-brand-400 hover:underline">Server Config → Finances</Link> and save.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
