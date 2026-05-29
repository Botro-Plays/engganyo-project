'use client';

import { useState, useCallback, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, MessageSquare, Send, Edit2, Trash2, Lock, Pin, Megaphone, CornerDownRight, Flag } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import { UserLink } from '@/components/user-link';
import { MentionTextarea } from '@/components/mention-textarea';
import { renderContentWithMentions } from '@/lib/render-content';
import { ReportModal } from '@/components/report-modal';
import { useAuthStore } from '@/store/auth.store';
import type { ApiResponse } from '@/types';
import Link from 'next/link';

interface ForumTopic {
  id: string;
  title: string;
  content: string;
  status: string;
  isPinned: boolean;
  viewCount: number;
  replyCount: number;
  lockedAt: string | null;
  lockedBy: string | null;
  createdAt: string;
  updatedAt: string;
  campaign?: {
    id: string;
    title: string;
    status: string;
    taskType: string;
  };
  author: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  replies: ForumReply[];
  _count: {
    reactions: number;
  };
}

type ReactionType = 'LIKE' | 'DISLIKE' | 'LOVE' | 'LAUGH' | 'ANGRY';
interface ForumReaction { id: string; type: ReactionType; user: { id: string; username: string; avatarUrl: string | null } }
const REACTION_EMOJI: Record<ReactionType, string> = { LIKE: '👍', DISLIKE: '👎', LOVE: '❤️', LAUGH: '😂', ANGRY: '😡' };

interface ForumReply {
  id: string;
  content: string;
  isEdited: boolean;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
  campaign?: {
    id: string;
    title: string;
    status: string;
    taskType: string;
  };
  author: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  parentReplyId: string | null;
  childReplies?: ForumReply[];
  _count: {
    childReplies: number;
    reactions: number;
  };
}

export default function ForumTopicPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuthStore();
  const [replyContent, setReplyContent] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editingTopic, setEditingTopic] = useState(false);
  const [editTopicTitle, setEditTopicTitle] = useState('');
  const [editTopicContent, setEditTopicContent] = useState('');
  const [replyingTo, setReplyingTo] = useState<{ id: string; content: string; author: { username: string } } | null>(null);
  const replyFormRef = useRef<HTMLDivElement>(null);
  const [reportTarget, setReportTarget] = useState<{
    topicId?: string;
    replyId?: string;
    label: string;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['forum', 'topic', params.id],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<ForumTopic>>(`forum/topics/${params.id}`);
      return res.data.data;
    },
  });

  const { data: topicReactions } = useQuery<ForumReaction[]>({
    queryKey: ['forum', 'topic', params.id, 'reactions'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<ForumReaction[]>>(`forum/topics/${params.id}/reactions`);
      return res.data.data ?? [];
    },
    enabled: !!params.id,
  });

  const { data: userCampaigns } = useQuery({
    queryKey: ['user', 'campaigns'],
    queryFn: async () => {
      try {
        const res = await apiClient.get<ApiResponse<{ items: { id: string; title: string; status: string }[]; meta: any }>>('campaigns');
        const result = res.data.data?.items;
        if (Array.isArray(result)) {
          // Filter to only show active campaigns (not cancelled, completed, etc.)
          return result.filter(c => c.status === 'ACTIVE' || c.status === 'PENDING_REVIEW');
        }
        return [];
      } catch (err) {
        console.error('Failed to fetch campaigns:', err);
        return [];
      }
    },
  });

  const handleUserSearch = useCallback(async (query: string): Promise<{ id: string; username: string; displayName: string | null }[]> => {
    if (!query || query.length < 2) return [];
    try {
      const res = await apiClient.get<ApiResponse<{ id: string; username: string; displayName: string | null }[]>>(`users/search?q=${query}&limit=10`);
      const result = res.data.data;
      return Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  }, []);

  const topicReactionMutation = useMutation({
    mutationFn: (type: ReactionType) =>
      apiClient.post(`forum/topics/${params.id}/reactions`, { type }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['forum', 'topic', params.id, 'reactions'] });
      void queryClient.invalidateQueries({ queryKey: ['forum', 'topic', params.id] });
    },
  });

  const deleteTopicMutation = useMutation({
    mutationFn: () => apiClient.delete(`forum/topics/${params.id}`),
    onSuccess: () => router.push('/forum'),
  });

  const updateTopicMutation = useMutation({
    mutationFn: (payload: { title: string; content: string }) =>
      apiClient.patch(`forum/topics/${params.id}`, payload),
    onSuccess: () => {
      setEditingTopic(false);
      void queryClient.invalidateQueries({ queryKey: ['forum', 'topic', params.id] });
    },
  });

  const replyReactionMutation = useMutation({
    mutationFn: ({ replyId, type }: { replyId: string; type: ReactionType }) =>
      apiClient.post(`forum/replies/${replyId}/reactions`, { type }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['forum', 'topic', params.id] }),
  });

  const replyMutation = useMutation({
    mutationFn: (data: { content: string; parentReplyId?: string }) =>
      apiClient.post(`forum/topics/${params.id}/replies`, data),
    onSuccess: () => {
      setReplyContent('');
      setReplyError(null);
      setReplyingTo(null);
      void queryClient.invalidateQueries({ queryKey: ['forum', 'topic', params.id] });
    },
    onError: (err) => setReplyError(getApiErrorMessage(err)),
  });

  const updateReplyMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      apiClient.patch(`forum/replies/${id}`, { content }),
    onSuccess: () => {
      setEditingReplyId(null);
      setEditContent('');
      void queryClient.invalidateQueries({ queryKey: ['forum', 'topic', params.id] });
    },
  });

  const deleteReplyMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`forum/replies/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['forum', 'topic', params.id] });
    },
  });

  const handleReplyTo = (reply: { id: string; content: string; author: { username: string } }) => {
    setReplyingTo(reply);
    setTimeout(() => replyFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
  };

  const handleReplySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyContent.trim()) return;
    replyMutation.mutate({ content: replyContent, parentReplyId: replyingTo?.id });
  };

  const handleEditReply = (reply: ForumReply) => {
    setEditingReplyId(reply.id);
    setEditContent(reply.content);
  };

  const handleUpdateReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editContent.trim() || !editingReplyId) return;
    updateReplyMutation.mutate({ id: editingReplyId, content: editContent });
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="card-glass rounded-xl p-8 animate-pulse h-96" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="card-glass rounded-xl p-12 text-center">
          <p className="text-zinc-400">Topic not found</p>
        </div>
      </div>
    );
  }

  const isLocked = data.status === 'LOCKED';
  const isTopicOwner = currentUser?.id === data.author.id;
  const reactionCounts = (topicReactions ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.type] = (acc[r.type] ?? 0) + 1;
    return acc;
  }, {});
  const myTopicReaction = (topicReactions ?? []).find((r) => r.user.id === currentUser?.id);

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href="/forum"
        className="inline-flex items-center gap-2 text-zinc-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Forum
      </Link>

      <div className="card-glass rounded-xl p-6 mb-6">
        <div className="flex items-start gap-4 mb-4">
          <div className="flex-shrink-0">
            <UserLink user={data.author} size="md" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              {data.isPinned && <Pin className="w-4 h-4 text-indigo-400" />}
              {isLocked && <Lock className="w-4 h-4 text-yellow-400" />}
              {editingTopic ? (
                <input
                  value={editTopicTitle}
                  onChange={(e) => setEditTopicTitle(e.target.value)}
                  className="flex-1 bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-1 text-white focus:outline-none focus:border-indigo-500 text-xl font-bold"
                />
              ) : (
                <h1 className="text-2xl font-bold text-white">{data.title}</h1>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm text-zinc-400 mb-3">
              <UserLink user={data.author} showAvatar={false} />
              <span>·</span>
              <span>{formatRelativeTime(data.createdAt)}</span>
              <span>·</span>
              <div className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                {data.replyCount}
              </div>
            </div>
          </div>
          {isTopicOwner && !isLocked && (
            <div className="flex gap-1 flex-shrink-0">
              {editingTopic ? (
                <>
                  <button
                    onClick={() => updateTopicMutation.mutate({ title: editTopicTitle, content: editTopicContent })}
                    disabled={updateTopicMutation.isPending}
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingTopic(false)}
                    className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-white rounded text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => { setEditingTopic(true); setEditTopicTitle(data.title); setEditTopicContent(data.content); }}
                    className="p-1.5 text-zinc-400 hover:text-white rounded transition-colors"
                    title="Edit topic"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { if (confirm('Delete this topic?')) deleteTopicMutation.mutate(); }}
                    disabled={deleteTopicMutation.isPending}
                    className="p-1.5 text-zinc-400 hover:text-red-400 rounded transition-colors"
                    title="Delete topic"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          )}
          {!isTopicOwner && currentUser && (
            <button
              onClick={() => setReportTarget({ topicId: data.id, label: `Topic: ${data.title}` })}
              className="p-1.5 text-zinc-500 hover:text-red-400 rounded transition-colors flex-shrink-0"
              title="Report topic"
            >
              <Flag className="w-4 h-4" />
            </button>
          )}
        </div>

        {editingTopic ? (
          <textarea
            value={editTopicContent}
            onChange={(e) => setEditTopicContent(e.target.value)}
            rows={6}
            className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 text-white focus:outline-none focus:border-indigo-500 resize-none mb-3"
          />
        ) : (
          <div className="mb-4">{renderContentWithMentions(data.content)}</div>
        )}

        {data.campaign && (
          <Link
            href={`/campaigns/${data.campaign.id}`}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium mb-3 ${
              data.campaign.status === 'ACTIVE' || data.campaign.status === 'PENDING_REVIEW'
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-zinc-500/20 text-zinc-400 border border-zinc-500/30'
            }`}
          >
            <Megaphone className="w-3 h-3" />
            {data.campaign.title}
          </Link>
        )}

        <div className="flex items-center gap-2 pt-3 border-t border-zinc-700/50 flex-wrap">
          {(Object.keys(REACTION_EMOJI) as ReactionType[]).map((type) => (
            <button
              key={type}
              onClick={() => topicReactionMutation.mutate(type)}
              disabled={topicReactionMutation.isPending}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-sm transition-colors ${
                myTopicReaction?.type === type
                  ? 'bg-indigo-500/30 border border-indigo-500/50 text-white'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
              }`}
            >
              <span>{REACTION_EMOJI[type]}</span>
              {reactionCounts[type] ? <span className="text-xs">{reactionCounts[type]}</span> : null}
            </button>
          ))}
          {!isLocked && (
            <button
              onClick={() => { setReplyingTo(null); setTimeout(() => replyFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50); }}
              className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 border border-indigo-500/30 transition-colors"
            >
              <CornerDownRight className="w-3.5 h-3.5" />
              Reply
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4 mt-6">
        {!data.replies.length && (
          <div className="card-glass rounded-xl p-8 text-center">
            <MessageSquare className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
            <p className="text-zinc-400">No replies yet. Be the first to respond!</p>
          </div>
        )}
        {data.replies.map((reply) => (
          <div key={reply.id}>
            <ReplyCard
              reply={reply}
              currentUserId={currentUser?.id}
              isTopicLocked={isLocked}
              editingReplyId={editingReplyId}
              editContent={editContent}
              setEditContent={setEditContent}
              setEditingReplyId={setEditingReplyId}
              onEditReply={handleEditReply}
              onUpdateReply={handleUpdateReply}
              onDeleteReply={(id) => deleteReplyMutation.mutate(id)}
              onReact={(replyId, type) => replyReactionMutation.mutate({ replyId, type })}
              onReply={handleReplyTo}
              onReport={(replyId, label) => setReportTarget({ replyId, label })}
              updatePending={updateReplyMutation.isPending}
            />
            {(reply.childReplies ?? []).length > 0 && (
              <div className="ml-8 mt-2 space-y-2 border-l-2 border-indigo-500/20 pl-4">
                {(reply.childReplies ?? []).map((child) => (
                  <ReplyCard
                    key={child.id}
                    reply={child}
                    currentUserId={currentUser?.id}
                    isTopicLocked={isLocked}
                    editingReplyId={editingReplyId}
                    editContent={editContent}
                    setEditContent={setEditContent}
                    setEditingReplyId={setEditingReplyId}
                    onEditReply={handleEditReply}
                    onUpdateReply={handleUpdateReply}
                    onDeleteReply={(id) => deleteReplyMutation.mutate(id)}
                    onReact={(replyId, type) => replyReactionMutation.mutate({ replyId, type })}
                    onReply={handleReplyTo}
                    onReport={(replyId, label) => setReportTarget({ replyId, label })}
                    updatePending={updateReplyMutation.isPending}
                    isChild
                    parentReply={{ content: reply.content, author: reply.author }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div ref={replyFormRef} className="sticky bottom-4 z-10 mt-6 pb-2">
        {isLocked ? (
          <div className="card-glass rounded-xl p-4 text-center shadow-lg">
            <Lock className="w-5 h-5 text-yellow-400 mx-auto mb-2" />
            <p className="text-zinc-400 text-sm">This topic is locked and no longer accepts replies</p>
          </div>
        ) : (
          <>
            {replyingTo && (
              <div className="mb-2 border-l-4 border-indigo-500/60 bg-zinc-800/90 rounded-r-lg px-3 py-2 flex items-start justify-between gap-3 backdrop-blur-sm">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-indigo-400 mb-0.5">
                    <CornerDownRight className="w-3 h-3 inline mr-1" />
                    Replying to <UserLink user={replyingTo.author} showAvatar={false} />
                  </p>
                  <p className="text-xs text-zinc-400 line-clamp-1">
                    {replyingTo.content
                      .replace(/@\[([^\]]+)\]\(user:[^)]+\)/g, '@$1')
                      .replace(/!\[([^\]]+)\]\(campaign:[^)]+\)/g, '[$1]')
                      .substring(0, 120)}
                  </p>
                </div>
                <button
                  onClick={() => setReplyingTo(null)}
                  className="flex-shrink-0 text-zinc-500 hover:text-white transition-colors"
                >
                  ✕
                </button>
              </div>
            )}
            <form onSubmit={handleReplySubmit} className="card-glass rounded-xl p-4 shadow-xl">
              <MentionTextarea
                value={replyContent}
                onChange={setReplyContent}
                campaigns={userCampaigns || []}
                onUserSearch={handleUserSearch}
                placeholder="Write a reply... Type ! for campaigns, @ for users"
                rows={3}
                className="focus:outline-none focus:border-indigo-500"
              />
              {replyError && (
                <p className={`text-sm mt-2 ${replyError.includes('disabled mentions') || replyError.includes('has disabled') ? 'text-amber-400' : 'text-red-400'}`}>
                  {replyError}
                </p>
              )}
              <div className="flex justify-end mt-3">
                <button
                  type="submit"
                  disabled={replyMutation.isPending || !replyContent.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                >
                  <Send className="w-4 h-4" />
                  {replyMutation.isPending ? 'Sending...' : 'Reply'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      {reportTarget && (
        <ReportModal
          topicId={reportTarget.topicId}
          replyId={reportTarget.replyId}
          targetLabel={reportTarget.label}
          onClose={() => setReportTarget(null)}
        />
      )}
    </div>
  );
}

interface ReplyCardProps {
  reply: ForumReply;
  currentUserId?: string;
  isTopicLocked: boolean;
  editingReplyId: string | null;
  editContent: string;
  setEditContent: (v: string) => void;
  setEditingReplyId: (id: string | null) => void;
  onEditReply: (reply: ForumReply) => void;
  onUpdateReply: (e: React.FormEvent) => void;
  onDeleteReply: (id: string) => void;
  onReact: (replyId: string, type: ReactionType) => void;
  onReply: (reply: { id: string; content: string; author: { username: string } }) => void;
  onReport: (replyId: string, label: string) => void;
  updatePending: boolean;
  isChild?: boolean;
  parentReply?: { content: string; author: { username: string } };
}

function ReplyCard({
  reply, currentUserId, isTopicLocked,
  editingReplyId, editContent, setEditContent, setEditingReplyId,
  onEditReply, onUpdateReply, onDeleteReply, onReact, onReply, onReport,
  updatePending, isChild = false, parentReply,
}: ReplyCardProps) {
  const isOwner = currentUserId === reply.author.id;
  const isEditing = editingReplyId === reply.id;

  const stripMentions = (text: string) =>
    text
      .replace(/@\[([^\]]+)\]\(user:[^)]+\)/g, '@$1')
      .replace(/!\[([^\]]+)\]\(campaign:[^)]+\)/g, '[$1]');

  return (
    <div className={`card-glass rounded-xl p-4 ${isChild ? 'bg-zinc-900/30' : ''}`}>
      {parentReply && (
        <div className="mb-3 border-l-2 border-zinc-600/50 bg-zinc-900/50 rounded-r-lg px-2.5 py-1.5">
          <p className="text-xs text-zinc-500 mb-0.5">↩ <UserLink user={parentReply.author} showAvatar={false} /></p>
          <p className="text-xs text-zinc-500 line-clamp-1">{stripMentions(parentReply.content).substring(0, 120)}</p>
        </div>
      )}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          <UserLink user={reply.author} size={isChild ? 'sm' : 'md'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <UserLink user={reply.author} showAvatar={false} />
              <span className="text-zinc-500 text-xs">{formatRelativeTime(reply.createdAt)}</span>
              {reply.isEdited && <span className="text-zinc-500 text-xs">(edited)</span>}
              {reply.campaign && (
                <Link
                  href={`/campaigns/${reply.campaign.id}`}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                    reply.campaign.status === 'ACTIVE' || reply.campaign.status === 'PENDING_REVIEW'
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : 'bg-zinc-500/20 text-zinc-400 border border-zinc-500/30'
                  }`}
                >
                  <Megaphone className="w-3 h-3" />
                  {reply.campaign.title}
                </Link>
              )}
            </div>
            {isOwner && !isTopicLocked && !isEditing && (
              <div className="flex gap-1 flex-shrink-0">
                <button
                  onClick={() => onEditReply(reply)}
                  className="p-1 text-zinc-500 hover:text-white rounded transition-colors"
                  title="Edit reply"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => { if (confirm('Delete this reply?')) onDeleteReply(reply.id); }}
                  className="p-1 text-zinc-500 hover:text-red-400 rounded transition-colors"
                  title="Delete reply"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {!isOwner && currentUserId && !isEditing && (
              <button
                onClick={() => onReport(reply.id, `Reply by ${reply.author.username}`)}
                className="p-1 text-zinc-500 hover:text-red-400 rounded transition-colors flex-shrink-0"
                title="Report reply"
              >
                <Flag className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {isEditing ? (
            <form onSubmit={onUpdateReply} className="mb-2">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg p-2 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 resize-none"
                rows={3}
              />
              <div className="flex gap-2 mt-2">
                <button
                  type="submit"
                  disabled={updatePending}
                  className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm transition-colors"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingReplyId(null); setEditContent(''); }}
                  className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-white rounded text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="text-zinc-300 leading-relaxed text-sm">
              {renderContentWithMentions(reply.content)}
            </div>
          )}

          <div className="flex items-center gap-1 mt-2 pt-2 border-t border-zinc-700/30 flex-wrap">
            {(Object.keys(REACTION_EMOJI) as ReactionType[]).map((type) => (
              <button
                key={type}
                onClick={() => onReact(reply.id, type)}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
              >
                {REACTION_EMOJI[type]}
              </button>
            ))}
            {reply._count.reactions > 0 && (
              <span className="text-xs text-zinc-500 ml-1">{reply._count.reactions} reaction{reply._count.reactions !== 1 ? 's' : ''}</span>
            )}
            {!isTopicLocked && !isEditing && (
              <button
                onClick={() => onReply({ id: reply.id, content: reply.content, author: reply.author })}
                className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-xs text-zinc-400 hover:text-indigo-400 transition-colors"
              >
                <CornerDownRight className="w-3 h-3" />
                Reply
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
