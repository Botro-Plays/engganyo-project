'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Trophy, Star, Pencil, Trash2, Plus, X, Check, ToggleLeft, ToggleRight, Zap,
} from 'lucide-react';
import { apiClient } from '@/lib/api';
import type { ApiResponse } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Achievement {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  requirement: number;
  creditReward: number;
  xpReward: number;
  isActive: boolean;
  sortOrder: number;
  icon: string | null;
  badgeColor: string | null;
}

interface Mission {
  id: string;
  name: string;
  description: string;
  type: string;
  requirement: number;
  creditReward: number;
  xpReward: number;
  isActive: boolean;
  sortOrder: number;
}

const ACHIEVEMENT_CATEGORIES = ['ENGAGEMENT', 'CREATOR', 'COMMUNITY', 'FINANCIAL', 'MILESTONE', 'DEDICATION'];
const MISSION_TYPES = ['COMPLETE_N_TASKS', 'EARN_N_CREDITS', 'CREATE_CAMPAIGN', 'LOGIN_STREAK'];

const CATEGORY_LABELS: Record<string, string> = {
  ENGAGEMENT: 'Engagement', CREATOR: 'Creator', COMMUNITY: 'Community',
  FINANCIAL: 'Financial', MILESTONE: 'Milestone', DEDICATION: 'Dedication',
};

const MISSION_LABELS: Record<string, string> = {
  COMPLETE_N_TASKS: 'Complete N Tasks', EARN_N_CREDITS: 'Earn N Credits',
  CREATE_CAMPAIGN: 'Create Campaign', LOGIN_STREAK: 'Login Streak',
};

// ─── Empty form defaults ──────────────────────────────────────────────────────

const EMPTY_ACHIEVEMENT: Partial<Achievement> = {
  name: '', slug: '', description: '', category: 'ENGAGEMENT',
  requirement: 1, creditReward: 0, xpReward: 0, isActive: true, sortOrder: 0,
};

const EMPTY_MISSION: Partial<Mission> = {
  name: '', description: '', type: 'COMPLETE_N_TASKS',
  requirement: 1, creditReward: 0, xpReward: 0, isActive: true, sortOrder: 0,
};

// ─── Inline edit form ─────────────────────────────────────────────────────────

function AchievementForm({
  initial, onSave, onCancel,
}: { initial: Partial<Achievement>; onSave: (data: Partial<Achievement>) => void; onCancel: () => void }) {
  const [form, setForm] = useState<Partial<Achievement>>(initial);
  const set = (k: keyof Achievement, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="bg-surface-hover border border-brand-500/30 rounded-xl p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-zinc-400">Name</label>
          <input value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} className="mt-1 w-full px-3 py-1.5 bg-surface border border-surface-border rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div>
          <label className="text-xs text-zinc-400">Slug</label>
          <input value={form.slug ?? ''} onChange={(e) => set('slug', e.target.value)} className="mt-1 w-full px-3 py-1.5 bg-surface border border-surface-border rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-zinc-400">Description</label>
          <input value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} className="mt-1 w-full px-3 py-1.5 bg-surface border border-surface-border rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div>
          <label className="text-xs text-zinc-400">Category</label>
          <select value={form.category ?? 'ENGAGEMENT'} onChange={(e) => set('category', e.target.value)} className="mt-1 w-full px-3 py-1.5 bg-surface border border-surface-border rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500">
            {ACHIEVEMENT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-zinc-400">Requirement</label>
          <input type="number" value={form.requirement ?? 1} onChange={(e) => set('requirement', Number(e.target.value))} className="mt-1 w-full px-3 py-1.5 bg-surface border border-surface-border rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div>
          <label className="text-xs text-zinc-400">Credit Reward</label>
          <input type="number" value={form.creditReward ?? 0} onChange={(e) => set('creditReward', Number(e.target.value))} className="mt-1 w-full px-3 py-1.5 bg-surface border border-surface-border rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div>
          <label className="text-xs text-zinc-400">XP Reward</label>
          <input type="number" value={form.xpReward ?? 0} onChange={(e) => set('xpReward', Number(e.target.value))} className="mt-1 w-full px-3 py-1.5 bg-surface border border-surface-border rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
          <input type="checkbox" checked={form.isActive ?? true} onChange={(e) => set('isActive', e.target.checked)} className="rounded" />
          Active
        </label>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-surface-border text-xs text-zinc-400 hover:bg-surface-hover">Cancel</button>
        <button onClick={() => onSave(form)} className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium flex items-center gap-1">
          <Check className="w-3 h-3" /> Save
        </button>
      </div>
    </div>
  );
}

function MissionForm({
  initial, onSave, onCancel,
}: { initial: Partial<Mission>; onSave: (data: Partial<Mission>) => void; onCancel: () => void }) {
  const [form, setForm] = useState<Partial<Mission>>(initial);
  const set = (k: keyof Mission, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="bg-surface-hover border border-brand-500/30 rounded-xl p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-zinc-400">Name</label>
          <input value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} className="mt-1 w-full px-3 py-1.5 bg-surface border border-surface-border rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div>
          <label className="text-xs text-zinc-400">Type</label>
          <select value={form.type ?? 'COMPLETE_N_TASKS'} onChange={(e) => set('type', e.target.value)} className="mt-1 w-full px-3 py-1.5 bg-surface border border-surface-border rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500">
            {MISSION_TYPES.map((t) => <option key={t} value={t}>{MISSION_LABELS[t]}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-xs text-zinc-400">Description</label>
          <input value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} className="mt-1 w-full px-3 py-1.5 bg-surface border border-surface-border rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div>
          <label className="text-xs text-zinc-400">Requirement</label>
          <input type="number" value={form.requirement ?? 1} onChange={(e) => set('requirement', Number(e.target.value))} className="mt-1 w-full px-3 py-1.5 bg-surface border border-surface-border rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div>
          <label className="text-xs text-zinc-400">Credit Reward</label>
          <input type="number" value={form.creditReward ?? 0} onChange={(e) => set('creditReward', Number(e.target.value))} className="mt-1 w-full px-3 py-1.5 bg-surface border border-surface-border rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div>
          <label className="text-xs text-zinc-400">XP Reward</label>
          <input type="number" value={form.xpReward ?? 0} onChange={(e) => set('xpReward', Number(e.target.value))} className="mt-1 w-full px-3 py-1.5 bg-surface border border-surface-border rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
          <input type="checkbox" checked={form.isActive ?? true} onChange={(e) => set('isActive', e.target.checked)} className="rounded" />
          Active
        </label>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-surface-border text-xs text-zinc-400 hover:bg-surface-hover">Cancel</button>
        <button onClick={() => onSave(form)} className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium flex items-center gap-1">
          <Check className="w-3 h-3" /> Save
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminGamificationPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'achievements' | 'missions'>('achievements');
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // ── Achievements ──
  const { data: achievements, isLoading: aLoading } = useQuery<Achievement[]>({
    queryKey: ['admin', 'achievements'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<Achievement[]>>('gamification/admin/achievements');
      return res.data.data;
    },
  });

  const createAchievement = useMutation({
    mutationFn: (body: Partial<Achievement>) => apiClient.post('gamification/admin/achievements', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'achievements'] }); setCreating(false); },
  });

  const updateAchievement = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Achievement> }) =>
      apiClient.patch(`gamification/admin/achievements/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'achievements'] }); setEditing(null); },
  });

  const deleteAchievement = useMutation({
    mutationFn: (id: string) => apiClient.delete(`gamification/admin/achievements/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'achievements'] }); setConfirmDelete(null); },
  });

  // ── Missions ──
  const { data: missions, isLoading: mLoading } = useQuery<Mission[]>({
    queryKey: ['admin', 'missions'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<Mission[]>>('gamification/admin/missions');
      return res.data.data;
    },
  });

  const createMission = useMutation({
    mutationFn: (body: Partial<Mission>) => apiClient.post('gamification/admin/missions', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'missions'] }); setCreating(false); },
  });

  const updateMission = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Mission> }) =>
      apiClient.patch(`gamification/admin/missions/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'missions'] }); setEditing(null); },
  });

  const deleteMission = useMutation({
    mutationFn: (id: string) => apiClient.delete(`gamification/admin/missions/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'missions'] }); setConfirmDelete(null); },
  });

  const isLoading = tab === 'achievements' ? aLoading : mLoading;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Trophy className="w-6 h-6 text-yellow-400" /> Gamification
          </h1>
          <p className="text-zinc-400 text-sm mt-1">Manage achievements and daily missions.</p>
        </div>
        <button
          onClick={() => { setCreating(true); setEditing(null); }}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> New {tab === 'achievements' ? 'Achievement' : 'Mission'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface-hover p-1 rounded-xl w-fit">
        {(['achievements', 'missions'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setCreating(false); setEditing(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
              tab === t ? 'bg-brand-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Create form */}
      {creating && tab === 'achievements' && (
        <div className="mb-4">
          <AchievementForm
            initial={EMPTY_ACHIEVEMENT}
            onSave={(data) => createAchievement.mutate(data)}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}
      {creating && tab === 'missions' && (
        <div className="mb-4">
          <MissionForm
            initial={EMPTY_MISSION}
            onSave={(data) => createMission.mutate(data)}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card-glass rounded-xl h-16 animate-pulse" />
          ))}
        </div>
      ) : tab === 'achievements' ? (
        <div className="space-y-2">
          {(achievements ?? []).map((a) => (
            <div key={a.id}>
              {editing === a.id ? (
                <AchievementForm
                  initial={a}
                  onSave={(data) => updateAchievement.mutate({ id: a.id, body: data })}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="card-glass rounded-xl px-4 py-3 flex items-center gap-3 border border-surface-border">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${a.isActive ? 'bg-green-500' : 'bg-zinc-600'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white">{a.name}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-700 text-zinc-300">{CATEGORY_LABELS[a.category] ?? a.category}</span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5 truncate">{a.description}</p>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-zinc-500 shrink-0">
                    <span className="flex items-center gap-1 text-yellow-400">💰 {a.creditReward}</span>
                    <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-brand-400" />{a.xpReward} XP</span>
                    <span>×{a.requirement}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => updateAchievement.mutate({ id: a.id, body: { isActive: !a.isActive } })}
                      className="p-1.5 rounded-lg hover:bg-surface-border transition-colors"
                      title={a.isActive ? 'Deactivate' : 'Activate'}
                    >
                      {a.isActive
                        ? <ToggleRight className="w-4 h-4 text-green-400" />
                        : <ToggleLeft className="w-4 h-4 text-zinc-500" />}
                    </button>
                    <button onClick={() => { setEditing(a.id); setCreating(false); }} className="p-1.5 rounded-lg hover:bg-surface-border transition-colors">
                      <Pencil className="w-3.5 h-3.5 text-zinc-400" />
                    </button>
                    <button onClick={() => setConfirmDelete(a.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors">
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                  {confirmDelete === a.id && (
                    <div className="absolute z-10 bg-surface border border-red-500/30 rounded-xl p-3 shadow-xl flex items-center gap-3 text-sm">
                      <span className="text-white">Delete <strong>{a.name}</strong>?</span>
                      <button onClick={() => deleteAchievement.mutate(a.id)} className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs">Delete</button>
                      <button onClick={() => setConfirmDelete(null)} className="px-2 py-1 border border-surface-border text-zinc-400 rounded text-xs"><X className="w-3 h-3" /></button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {(missions ?? []).map((m) => (
            <div key={m.id}>
              {editing === m.id ? (
                <MissionForm
                  initial={m}
                  onSave={(data) => updateMission.mutate({ id: m.id, body: data })}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="card-glass rounded-xl px-4 py-3 flex items-center gap-3 border border-surface-border">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${m.isActive ? 'bg-green-500' : 'bg-zinc-600'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white">{m.name}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-700 text-zinc-300">{MISSION_LABELS[m.type] ?? m.type}</span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5 truncate">{m.description}</p>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-zinc-500 shrink-0">
                    <span className="flex items-center gap-1 text-yellow-400">💰 {m.creditReward}</span>
                    <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-brand-400" />{m.xpReward} XP</span>
                    <span>×{m.requirement}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => updateMission.mutate({ id: m.id, body: { isActive: !m.isActive } })}
                      className="p-1.5 rounded-lg hover:bg-surface-border transition-colors"
                      title={m.isActive ? 'Deactivate' : 'Activate'}
                    >
                      {m.isActive
                        ? <ToggleRight className="w-4 h-4 text-green-400" />
                        : <ToggleLeft className="w-4 h-4 text-zinc-500" />}
                    </button>
                    <button onClick={() => { setEditing(m.id); setCreating(false); }} className="p-1.5 rounded-lg hover:bg-surface-border transition-colors">
                      <Pencil className="w-3.5 h-3.5 text-zinc-400" />
                    </button>
                    <button onClick={() => setConfirmDelete(m.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors">
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                  {confirmDelete === m.id && (
                    <div className="absolute z-10 bg-surface border border-red-500/30 rounded-xl p-3 shadow-xl flex items-center gap-3 text-sm">
                      <span className="text-white">Delete <strong>{m.name}</strong>?</span>
                      <button onClick={() => deleteMission.mutate(m.id)} className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs">Delete</button>
                      <button onClick={() => setConfirmDelete(null)} className="px-2 py-1 border border-surface-border text-zinc-400 rounded text-xs"><X className="w-3 h-3" /></button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && tab === 'achievements' && (achievements ?? []).length === 0 && !creating && (
        <div className="text-center py-16 text-zinc-500">
          <Trophy className="w-10 h-10 mx-auto mb-3 text-zinc-700" />
          <p>No achievements yet. Create one above.</p>
        </div>
      )}
      {!isLoading && tab === 'missions' && (missions ?? []).length === 0 && !creating && (
        <div className="text-center py-16 text-zinc-500">
          <Star className="w-10 h-10 mx-auto mb-3 text-zinc-700" />
          <p>No missions yet. Create one above.</p>
        </div>
      )}
    </div>
  );
}
