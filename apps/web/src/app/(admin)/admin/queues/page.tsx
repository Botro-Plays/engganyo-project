'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2, AlertTriangle, CheckCircle2, Clock, PlayCircle,
  PauseCircle, Mail, BarChart2, ShieldAlert, RotateCcw,
  ChevronDown, ChevronUp, XCircle,
} from 'lucide-react';
import { apiClient } from '@/lib/api';

interface QueueJob {
  id: string | number | undefined;
  name: string;
  failedReason?: string;
  attemptsMade?: number;
  timestamp?: number;
  finishedOn?: number;
}

interface QueueStats {
  name: string;
  counts: Record<string, number>;
  recentFailed: QueueJob[];
  recentCompleted: QueueJob[];
}

const queueIcons: Record<string, React.ReactNode | undefined> = {
  email: <Mail className="w-5 h-5" />,
  analytics: <BarChart2 className="w-5 h-5" />,
  'trust-score': <ShieldAlert className="w-5 h-5" />,
};

const queueLabels: Record<string, string> = {
  email: 'Email Queue',
  analytics: 'Analytics Queue',
  'trust-score': 'Trust Score Queue',
};

export default function QueuesPage() {
  const [expandedQueue, setExpandedQueue] = useState<string | null>(null);

  const { data, isLoading } = useQuery<QueueStats[]>({
    queryKey: ['admin', 'queues'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: QueueStats[] }>('admin/queues');
      return res.data.data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Queue Monitor</h1>
        <p className="text-zinc-400 text-sm mt-1">BullMQ queue status, job counts, and recent failures.</p>
      </div>

      {data?.map((queue) => {
        const isExpanded = expandedQueue === queue.name;
        const total = Object.values(queue.counts).reduce((a: number, b: unknown) => a + (b as number), 0);

        return (
          <div key={queue.name} className="card-glass rounded-xl overflow-hidden">
            {/* Header */}
            <button
              onClick={() => setExpandedQueue(isExpanded ? null : queue.name)}
              className="w-full flex items-center justify-between p-5 hover:bg-surface-hover/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-300">
                  {(queueIcons[queue.name] as React.ReactNode) ?? <PlayCircle className="w-5 h-5" />}
                </div>
                <div className="text-left">
                  <h2 className="font-semibold text-white">{queueLabels[queue.name] ?? queue.name}</h2>
                  <p className="text-xs text-zinc-500">{total} total jobs</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                {/* Count badges */}
                <div className="hidden sm:flex items-center gap-2">
                  <CountBadge icon={<Clock className="w-3 h-3" />} count={queue.counts.waiting} label="Waiting" color="amber" />
                  <CountBadge icon={<PlayCircle className="w-3 h-3" />} count={queue.counts.active} label="Active" color="blue" />
                  <CountBadge icon={<CheckCircle2 className="w-3 h-3" />} count={queue.counts.completed} label="Done" color="green" />
                  <CountBadge icon={<XCircle className="w-3 h-3" />} count={queue.counts.failed} label="Failed" color="rose" />
                  <CountBadge icon={<PauseCircle className="w-3 h-3" />} count={queue.counts.delayed} label="Delayed" color="zinc" />
                </div>
                {isExpanded ? <ChevronUp className="w-5 h-5 text-zinc-400" /> : <ChevronDown className="w-5 h-5 text-zinc-400" />}
              </div>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="px-5 pb-5 border-t border-surface-border">
                {/* Mobile counts */}
                <div className="sm:hidden flex flex-wrap gap-2 py-3">
                  <CountBadge icon={<Clock className="w-3 h-3" />} count={queue.counts.waiting} label="Waiting" color="amber" />
                  <CountBadge icon={<PlayCircle className="w-3 h-3" />} count={queue.counts.active} label="Active" color="blue" />
                  <CountBadge icon={<CheckCircle2 className="w-3 h-3" />} count={queue.counts.completed} label="Done" color="green" />
                  <CountBadge icon={<XCircle className="w-3 h-3" />} count={queue.counts.failed} label="Failed" color="rose" />
                  <CountBadge icon={<PauseCircle className="w-3 h-3" />} count={queue.counts.delayed} label="Delayed" color="zinc" />
                </div>

                {/* Recent failed jobs */}
                {queue.recentFailed.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-sm font-medium text-rose-300 flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      Recent Failed Jobs
                    </h3>
                    <div className="space-y-2">
                      {queue.recentFailed.map((job: QueueJob) => (
                        <div key={String(job.id)} className="rounded-lg bg-rose-500/5 border border-rose-500/10 p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-white">{job.name}</span>
                            <span className="text-xs text-zinc-500">ID: {String(job.id)}</span>
                          </div>
                          <p className="text-xs text-rose-400 line-clamp-2">{job.failedReason}</p>
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className="text-xs text-zinc-500">Attempts: {job.attemptsMade ?? 0}</span>
                            {job.timestamp && (
                              <span className="text-xs text-zinc-500">
                                {new Date(job.timestamp).toLocaleString()}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent completed jobs */}
                {queue.recentCompleted.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-sm font-medium text-green-300 flex items-center gap-2 mb-2">
                      <CheckCircle2 className="w-4 h-4" />
                      Recent Completed Jobs
                    </h3>
                    <div className="space-y-2">
                      {queue.recentCompleted.map((job: QueueJob) => (
                        <div key={String(job.id)} className="rounded-lg bg-green-500/5 border border-green-500/10 p-3 flex items-center justify-between">
                          <div>
                            <span className="text-xs font-medium text-white">{job.name}</span>
                            <p className="text-xs text-zinc-500 mt-0.5">ID: {String(job.id)}</p>
                          </div>
                          {job.finishedOn && (
                            <span className="text-xs text-zinc-500">
                              {new Date(job.finishedOn).toLocaleString()}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {queue.recentFailed.length === 0 && queue.recentCompleted.length === 0 && (
                  <p className="text-sm text-zinc-500 py-4">No recent jobs in this queue.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CountBadge({
  icon,
  count,
  label,
  color,
}: {
  icon: React.ReactNode;
  count: number;
  label: string;
  color: 'amber' | 'blue' | 'green' | 'rose' | 'zinc';
}) {
  const colorMap = {
    amber: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    blue: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
    green: 'bg-green-500/10 text-green-300 border-green-500/20',
    rose: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
    zinc: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/20',
  };

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border ${colorMap[color]}`}>
      {icon}
      <span className="font-medium">{count}</span>
      <span className="opacity-70">{label}</span>
    </div>
  );
}
