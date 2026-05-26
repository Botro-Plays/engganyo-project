'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { MentionTextarea } from '@/components/mention-textarea';
import Link from 'next/link';
import type { ApiResponse } from '@/types';

export default function NewTopicPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

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

  const [userSearchQuery, setUserSearchQuery] = useState('');

  const handleUserSearch = async (query: string): Promise<{ id: string; username: string; displayName: string | null }[]> => {
    if (!query || query.length < 2) return [];
    try {
      const res = await apiClient.get<ApiResponse<{ id: string; username: string; displayName: string | null }[]>>(`users/search?q=${query}&limit=10`);
      const result = res.data.data;
      return Array.isArray(result) ? result : [];
    } catch (err) {
      console.error('Failed to search users:', err);
      return [];
    }
  };

  const createMutation = useMutation({
    mutationFn: (data: { title: string; content: string }) =>
      apiClient.post('forum/topics', data),
    onSuccess: (res) => {
      router.push(`/forum/${res.data.data.id}`);
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!title.trim() || !content.trim()) {
      setError('Please fill in all fields');
      return;
    }
    
    if (title.trim().length < 5) {
      setError('Title must be at least 5 characters');
      return;
    }
    
    if (content.trim().length < 10) {
      setError('Content must be at least 10 characters');
      return;
    }
    
    createMutation.mutate({ title, content });
  };

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/forum"
        className="inline-flex items-center gap-2 text-zinc-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Forum
      </Link>

      <div className="card-glass rounded-xl p-6">
        <h1 className="text-2xl font-bold text-white mb-6">Create New Topic</h1>

        {error && (
          <div className="mb-4 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's your topic about?"
              className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
              maxLength={200}
              required
            />
            <p className={`text-xs mt-1 ${title.length < 5 ? 'text-red-400' : 'text-zinc-500'}`}>
              {title.length}/200 characters (minimum 5)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Content</label>
            <MentionTextarea
              value={content}
              onChange={setContent}
              campaigns={userCampaigns || []}
              onUserSearch={handleUserSearch}
              placeholder="Share your thoughts, questions, or ideas... Type ! for campaigns, @ for users"
              rows={10}
              className="focus:outline-none focus:border-indigo-500"
            />
            <p className={`text-xs mt-1 ${content.length < 10 ? 'text-red-400' : 'text-zinc-500'}`}>
              {content.length}/10000 characters (minimum 10)
            </p>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={createMutation.isPending || title.trim().length < 5 || content.trim().length < 10}
              className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              <Send className="w-4 h-4" />
              {createMutation.isPending ? 'Creating...' : 'Create Topic'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
