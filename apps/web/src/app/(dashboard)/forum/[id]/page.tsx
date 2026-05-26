'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, MessageSquare, ThumbsUp, Send, Edit2, Trash2, Lock, Pin, Megaphone } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import { MentionTextarea } from '@/components/mention-textarea';
import { renderContentWithMentions } from '@/lib/render-content';
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
  _count: {
    childReplies: number;
    reactions: number;
  };
}

export default function ForumTopicPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [replyContent, setReplyContent] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['forum', 'topic', params.id],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<ForumTopic>>(`forum/topics/${params.id}`);
      return res.data.data;
    },
  });

  const { data: userCampaigns } = useQuery({
    queryKey: ['user', 'campaigns'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ id: string; title: string; status: string }[]>>('campaigns');
      return res.data.data;
    },
  });

  const handleUserSearch = async (query: string): Promise<{ id: string; username: string; displayName: string | null }[]> => {
    if (!query || query.length < 2) return [];
    const res = await apiClient.get<ApiResponse<{ id: string; username: string; displayName: string | null }[]>>(`users/search?q=${query}&limit=10`);
    return res.data.data;
  };

  const replyMutation = useMutation({
    mutationFn: (data: { content: string }) =>
      apiClient.post(`forum/topics/${params.id}/replies`, data),
    onSuccess: () => {
      setReplyContent('');
      setReplyError(null);
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

  const handleReplySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyContent.trim()) return;
    replyMutation.mutate({ content: replyContent });
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
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-medium text-lg">
              {data.author.displayName?.[0] || data.author.username[0].toUpperCase()}
            </div>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              {data.isPinned && <Pin className="w-4 h-4 text-indigo-400" />}
              {isLocked && <Lock className="w-4 h-4 text-yellow-400" />}
              <h1 className="text-2xl font-bold text-white">{data.title}</h1>
            </div>
            <div className="flex items-center gap-3 text-sm text-zinc-400 mb-3">
              <span>by @{data.author.username}</span>
              <span>·</span>
              <span>{formatRelativeTime(data.createdAt)}</span>
              <span>·</span>
              <div className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                {data.replyCount}
              </div>
              <div className="flex items-center gap-1">
                <ThumbsUp className="w-3 h-3" />
                {data._count.reactions}
              </div>
            </div>
          </div>
        </div>
        {renderContentWithMentions(data.content)}
      </div>

      {!isLocked && (
        <form onSubmit={handleReplySubmit} className="card-glass rounded-xl p-4 mb-6">
          <MentionTextarea
            value={replyContent}
            onChange={setReplyContent}
            campaigns={userCampaigns || []}
            onUserSearch={handleUserSearch}
            placeholder="Write a reply... Type ! for campaigns, @ for users"
            rows={3}
            className="focus:outline-none focus:border-indigo-500"
          />
          {replyError && <p className="text-red-400 text-sm mt-2">{replyError}</p>}
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
      )}

      {isLocked && (
        <div className="card-glass rounded-xl p-4 mb-6 text-center">
          <Lock className="w-5 h-5 text-yellow-400 mx-auto mb-2" />
          <p className="text-zinc-400 text-sm">This topic is locked and no longer accepts replies</p>
        </div>
      )}

      <div className="space-y-4">
        {data.replies.map((reply) => (
          <div key={reply.id} className="card-glass rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-teal-600 flex items-center justify-center text-white font-medium text-sm">
                  {reply.author.displayName?.[0] || reply.author.username[0].toUpperCase()}
                </div>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-medium">@{reply.author.username}</span>
                    <span className="text-zinc-500 text-sm">{formatRelativeTime(reply.createdAt)}</span>
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
                </div>
                {editingReplyId === reply.id ? (
                  <form onSubmit={handleUpdateReply} className="mb-2">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg p-2 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 resize-none"
                      rows={3}
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        type="submit"
                        disabled={updateReplyMutation.isPending}
                        className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm transition-colors"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingReplyId(null);
                          setEditContent('');
                        }}
                        className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-white rounded text-sm transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="text-zinc-300 leading-relaxed">
                    {renderContentWithMentions(reply.content)}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {!data.replies.length && (
        <div className="card-glass rounded-xl p-8 text-center">
          <MessageSquare className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
          <p className="text-zinc-400">No replies yet. Be the first to respond!</p>
        </div>
      )}
    </div>
  );
}
